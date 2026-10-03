import { useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash } from "lucide-react";
import { useEffect, useState } from "react";
import { backend } from "@/backend/backend";
import type { Signature } from "@/backend/types";
import { Button, IconButton } from "@/components/ui/Button";
import { Select } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { queryKeys, useDomainSignatures, useIdentities, useSignatureStore, useSignatures } from "@/lib/queries";
import { DomainSignatures } from "./DomainSignatures";
import { SignatureEditor } from "./SignatureEditor";
import { cleanSignatureHtml } from "@/lib/signatures";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";
import { Row } from "./Row";

/**
 * Signatures per sender address. A current server keeps one on each address (its `Identity`), so
 * the portal and every mail program of the account see the same one; older servers kept several
 * per address in the shared settings, next to the app's. Without either there are none, and this
 * says so instead.
 */
export function Signatures() {
  const { t } = useT();
  const { data: store } = useSignatureStore();
  const domains = useDomainSignatures();
  if (store === undefined || domains.isPending) return null;
  // Servers with signatures per domain get those: one per domain instead of one per address.
  if (domains.data) return <DomainSignatures />;
  if (store === null) {
    return (
      <Row label={t("settings.signatures")} description={t("settings.signaturesUnavailable")}>
        {null}
      </Row>
    );
  }
  return <SignatureList perAddress={store === "identity"} />;
}

/** `perAddress`: one signature for each address, for new mail and replies alike. */
function SignatureList({ perAddress }: { perAddress: boolean }) {
  const { t } = useT();
  const client = useQueryClient();
  const { data: identities = [] } = useIdentities();
  const { data: signatures = [] } = useSignatures();
  const [chosen, setChosen] = useState<string | null>(null);
  const email = chosen ?? identities[0]?.email ?? "";
  const [editing, setEditing] = useState<Signature | null>(null);
  const own = signatures.filter((s) => s.email.toLowerCase() === email.toLowerCase());
  const setSettingsFormDirty = useUi((s) => s.setSettingsFormDirty);
  // The settings window shouldn't vanish (backdrop click, Escape) while a signature is mid-edit.
  useEffect(() => {
    setSettingsFormDirty(editing !== null);
    return () => setSettingsFormDirty(false);
  }, [editing, setSettingsFormDirty]);

  const refresh = () => client.invalidateQueries({ queryKey: queryKeys.signatures });
  const failed = (reason: unknown) => toast(reason instanceof Error ? reason.message : String(reason), "error");

  return (
    <Row
      label={t("settings.signatures")}
      description={t(perAddress ? "settings.signaturesPerAddressDesc" : "settings.signaturesDesc")}
    >
      {identities.length > 1 && (
        <Select
          aria-label={t("settings.signatureFor")}
          value={email}
          onChange={(event) => {
            setChosen(event.target.value);
            setEditing(null);
          }}
        >
          {identities.map((identity) => (
            <option key={identity.id} value={identity.email}>
              {identity.name ? `${identity.name} <${identity.email}>` : identity.email}
            </option>
          ))}
        </Select>
      )}

      {editing ? (
        <SignatureEditor
          key={editing.id || "new"}
          signature={editing}
          simple={perAddress}
          onCancel={() => setEditing(null)}
          onSave={async (signature) => {
            try {
              await backend().saveSignature(signature);
              toast(t("settings.signatureSaved"), "success");
              setEditing(null);
              await refresh();
            } catch (reason) {
              failed(reason);
            }
          }}
        />
      ) : (
        <>
          {own.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-4 py-3 text-[13px] text-muted">
              {t("settings.signaturesEmpty")}
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {own.map((signature) => (
                <li key={signature.id} className="rounded-2xl border border-hairline p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13.5px] font-semibold">
                      {perAddress ? signature.email : signature.name}
                    </span>
                    {!perAddress && signature.forNew && <Badge>{t("settings.signatureDefaultNew")}</Badge>}
                    {!perAddress && signature.forReplies && <Badge>{t("settings.signatureDefaultReplies")}</Badge>}
                    <IconButton
                      icon={Pencil}
                      size="sm"
                      label={t("settings.editSignature", { name: signature.name })}
                      onClick={() => setEditing(signature)}
                    />
                    <IconButton
                      icon={Trash}
                      size="sm"
                      label={t("settings.deleteSignature", { name: signature.name })}
                      onClick={() => void backend().deleteSignature(signature.id).then(refresh, failed)}
                    />
                  </div>
                  <div
                    className="mt-2 text-[13px] text-muted [&_img]:max-h-16 [&_img]:w-auto [&_p]:m-0"
                    // Written by any client of this account: cleaned like the composer's content.
                    dangerouslySetInnerHTML={{ __html: cleanSignatureHtml(signature.html) }}
                  />
                </li>
              ))}
            </ul>
          )}
          {(!perAddress || own.length === 0) && (
            <Button
              size="sm"
              variant="ghost"
              icon={Plus}
              className="self-start"
              disabled={!email}
              onClick={() =>
                setEditing({
                  id: "",
                  email,
                  name: "",
                  html: "",
                  forNew: perAddress || own.length === 0,
                  forReplies: perAddress || own.length === 0,
                })
              }
            >
              {t(perAddress ? "settings.addSignature" : "settings.newSignature")}
            </Button>
          )}
        </>
      )}
    </Row>
  );
}

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-pink-tint px-2 py-0.5 text-[11.5px] font-bold text-pink-ink">{children}</span>
  );
}
