import { useQueryClient } from "@tanstack/react-query";
import { Info } from "lucide-react";
import { useMemo, useState } from "react";
import { BackendError, backend } from "@/backend/backend";
import type { Signature } from "@/backend/types";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { useT } from "@/i18n";
import {
  ALL_DOMAINS,
  domainChange,
  editableHtml,
  editorStart,
  identitiesOf,
  previewFor,
  replacedByAllDomains,
  toggleTarget,
  tooLarge,
  type DomainSignatureChange,
  type DomainSignatureOverview,
  type IdentitySignatureInfo,
  type SignatureText,
} from "@/lib/domainSignatures";
import { queryKeys, useDomainSignatures } from "@/lib/queries";
import { htmlToPlainText } from "@/lib/safeHtml";
import { cleanSignatureHtml } from "@/lib/signatures";
import { toast } from "@/state/toasts";
import { Row } from "./Row";
import { SignatureEditor } from "./SignatureEditor";

/** What the rich editor gives, as both parts the server keeps: the HTML and the same as text. */
function fromEditor(html: string): SignatureText {
  return html.trim() ? { text: htmlToPlainText(html).trim(), html } : { text: "", html: "" };
}

function asSignature(id: string, signature: SignatureText | null): Signature {
  return { id, email: "", name: "", html: editableHtml(signature), forNew: true, forReplies: true };
}

function useSave() {
  const { t } = useT();
  const client = useQueryClient();
  return async (change: DomainSignatureChange) => {
    try {
      // Made on the overview shown; refused when another tab or device changed it since (WF-3).
      const shown = client.getQueryData<DomainSignatureOverview>(queryKeys.domainSignatures);
      const overview = await backend().saveDomainSignatures(shown ? { ...change, ifInState: shown.state } : change);
      client.setQueryData(queryKeys.domainSignatures, overview);
      // The addresses' effective signatures, which the composer inserts, changed with it.
      await client.invalidateQueries({ queryKey: queryKeys.signatures });
      await client.invalidateQueries({ queryKey: queryKeys.identities });
      toast(t("settings.signatureSaved"), "success");
    } catch (reason) {
      if (reason instanceof BackendError && reason.code === "state_mismatch") {
        await client.invalidateQueries({ queryKey: queryKeys.domainSignatures });
        toast(t("settings.signatureChangedElsewhere"), "error");
        return;
      }
      toast(reason instanceof Error ? reason.message : String(reason), "error");
    }
  };
}

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex gap-2 rounded-2xl bg-canvas px-3 py-2 text-[13px] text-muted">
      <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{children}</span>
    </p>
  );
}

/** One address that may have a signature of its own instead of its domain's. */
function AddressOverride({ identity, fallback }: { identity: IdentitySignatureInfo; fallback: SignatureText }) {
  const { t } = useT();
  const save = useSave();
  const own = identity.signature !== null;
  const [editing, setEditing] = useState(own);

  return (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
          {identity.name ? `${identity.name} <${identity.email}>` : identity.email}
        </span>
        <span className="text-[12px] text-muted">
          {own ? t("settings.signatureOwn") : t("settings.signatureFollowsDomain")}
        </span>
      </div>
      {editing ? (
        <>
          <SignatureEditor
            signature={asSignature(identity.id, identity.signature ?? fallback)}
            simple
            placeholders
            onSave={async (signature) => {
              const value = fromEditor(signature.html);
              if (tooLarge(value)) {
                toast(t("settings.signatureTooBig"), "error");
                return;
              }
              await save({ identities: { [identity.id]: value } });
            }}
          />
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => {
              setEditing(false);
              if (own) void save({ identities: { [identity.id]: null } });
            }}
          >
            {t("settings.signatureBackToDomain")}
          </Button>
        </>
      ) : (
        <Button size="sm" variant="ghost" className="self-start" onClick={() => setEditing(true)}>
          {t("settings.signatureOverride")}
        </Button>
      )}
    </li>
  );
}

function DomainEditor({ overview, domain }: { overview: DomainSignatureOverview; domain: string }) {
  const { t } = useT();
  const save = useSave();
  const start = useMemo(() => editorStart(overview, domain), [overview, domain]);
  const [targets, setTargets] = useState<string[]>(start.targets);
  const info = overview.domains.find((entry) => entry.domain === domain);
  const identities = identitiesOf(overview, domain);
  const all = targets.includes(ALL_DOMAINS);
  const replaced = all ? replacedByAllDomains(overview, domain) : [];
  const exceptions = identities.filter((identity) => identity.signature !== null).length;
  const sample = identities[0];
  const footer = info?.company?.mode === "footer" ? info.company : null;

  return (
    <div className="flex flex-col gap-3">
      {start.origin === "template" && <Note>{t("settings.signatureFromTemplate")}</Note>}
      {start.origin === "allDomains" && <Note>{t("settings.signatureFromAllDomains")}</Note>}
      <SignatureEditor
        signature={asSignature(`domain:${domain}`, start.signature)}
        simple
        placeholders
        onSave={async (signature) => {
          const value = fromEditor(cleanSignatureHtml(signature.html));
          if (tooLarge(value)) {
            toast(t("settings.signatureTooBig"), "error");
            return;
          }
          await save(domainChange(overview, targets, value));
        }}
      />
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1 text-[13px] font-semibold text-muted">{t("settings.signatureAppliesTo")}</legend>
        <label className="flex items-center gap-2 text-[13.5px]">
          <input
            type="checkbox"
            checked={all}
            onChange={(event) => setTargets(toggleTarget(targets, ALL_DOMAINS, event.target.checked, domain))}
          />
          {t("settings.signatureAllDomains")}
        </label>
        {!all &&
          overview.domains.map((entry) => (
            <label key={entry.domain} className="flex items-center gap-2 text-[13.5px]">
              <input
                type="checkbox"
                checked={targets.includes(entry.domain)}
                onChange={(event) => setTargets(toggleTarget(targets, entry.domain, event.target.checked, domain))}
              />
              {t("settings.signatureDomainOption", { domain: entry.domain, count: entry.addressCount })}
            </label>
          ))}
        {replaced.length > 0 && (
          <p className="text-[12px] text-muted">{t("settings.signatureReplaces", { domains: replaced.join(", ") })}</p>
        )}
      </fieldset>
      {(start.origin === "domain" || start.origin === "allDomains") && (
        <Button
          size="sm"
          variant="ghost"
          className="self-start"
          onClick={() => void save(domainChange(overview, start.targets, null))}
        >
          {t("settings.signatureRemove")}
        </Button>
      )}
      {footer && (
        <Note>
          {t("settings.signatureCompanyFooter")}
          <span className="mt-1 block whitespace-pre-wrap">
            {sample ? previewFor({ text: footer.text, html: "" }, sample).text : footer.text}
          </span>
        </Note>
      )}
      {identities.length > 0 && (
        <details className="rounded-2xl border border-hairline px-3 py-1.5" open={exceptions > 0}>
          <summary className="cursor-pointer py-1 text-[13.5px] font-semibold">
            {t("settings.signatureExceptions", { count: exceptions })}
          </summary>
          <ul className="flex flex-col divide-y divide-hairline">
            {identities.map((identity) => (
              <AddressOverride
                key={`${identity.id}:${identity.signature?.html ?? ""}:${identity.signature?.text ?? ""}`}
                identity={identity}
                fallback={start.signature}
              />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Signatures per domain: pick a domain, write one signature for all its addresses; a single
 * address may differ. The server fills the placeholders and hands each address its signature.
 */
export function DomainSignatures() {
  const { t } = useT();
  const { data: overview } = useDomainSignatures();
  const [chosen, setChosen] = useState<string | null>(null);
  if (!overview) return null;
  const domains = overview.domains;
  const domain = chosen && domains.some((entry) => entry.domain === chosen) ? chosen : (domains[0]?.domain ?? null);

  return (
    <Row label={t("settings.signatures")} description={t("settings.signaturesPerDomainDesc")}>
      {domain ? (
        <>
          <Select
            aria-label={t("settings.signatureDomain")}
            value={domain}
            onChange={(event) => setChosen(event.target.value)}
          >
            {domains.map((entry) => (
              <option key={entry.domain} value={entry.domain}>
                {t("settings.signatureDomainOption", { domain: entry.domain, count: entry.addressCount })}
              </option>
            ))}
          </Select>
          <DomainEditor key={`${domain}:${overview.state}`} overview={overview} domain={domain} />
        </>
      ) : (
        <p className="text-[13px] text-muted">{t("settings.signaturesEmpty")}</p>
      )}
    </Row>
  );
}
