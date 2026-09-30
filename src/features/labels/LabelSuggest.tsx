import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { Check, Plus, RotateCcw, Sparkles } from "lucide-react";
import { useState } from "react";
import { backend } from "@/backend/backend";
import type { AssistLabel, LabelSuggestions, LabelVerdict, NewLabelSuggestion } from "@/backend/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { useT } from "@/i18n";
import { errorText, queryKeys } from "@/lib/queries";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";
import { Thinking } from "../assist/ComposeAssist";
import { chipStyle, LABEL_COLORS } from "../assist/labels";
import { assistErrorDetail, assistErrorText, providerLabel, useAssistLabels } from "../assist/useAssist";
import { LabelDot } from "./LabelMenus";
import { initialTicks, suggestionChanges } from "./logic";

/**
 * "Label again": the assistant judges every label for one mail, with a sentence why. What fits is
 * ticked; the person changes what they like and applies it, which can also take labels off that
 * no longer fit. When nothing fits, new labels can be made and put on with one click.
 */
export function LabelSuggestDialog() {
  const { t } = useT();
  const request = useUi((s) => s.labelSuggest);
  const close = useUi((s) => s.closeLabelSuggest);
  return (
    <Dialog open={request !== null} onClose={close} title={t("labels.suggest.title")} width="md">
      {request && <SuggestBody key={request.emailId} emailId={request.emailId} onClose={close} />}
    </Dialog>
  );
}

export function SuggestBody({ emailId, onClose }: { emailId: string; onClose: () => void }) {
  const { t, i18n } = useT();
  const language = i18n.language;
  const { data: labels = [] } = useAssistLabels();
  const query = useQuery({
    queryKey: ["labelSuggest", emailId, language],
    queryFn: () => backend().suggestLabels(emailId, language),
    // Every opening asks again: that is the point of "again".
    staleTime: 0,
    gcTime: 0,
    retry: false,
  });

  if (query.isPending) {
    return (
      <div className="px-6 pt-2 pb-6" aria-live="polite">
        <Thinking />
      </div>
    );
  }
  if (query.isError) {
    const detail = assistErrorDetail(query.error);
    return (
      <div className="flex flex-col gap-3 px-6 pt-2 pb-6">
        <p role="alert" className="rounded-xl bg-danger-tint px-3 py-2 text-[13px] text-danger">
          {assistErrorText(query.error)}
        </p>
        {detail && <p className="text-[12px] break-words text-muted">{detail}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {t("common.close")}
          </Button>
          <Button icon={RotateCcw} onClick={() => void query.refetch()}>
            {t("labels.suggest.retry")}
          </Button>
        </div>
      </div>
    );
  }
  return <Verdicts result={query.data} labels={labels} onClose={onClose} />;
}

function Verdicts({
  result,
  labels,
  onClose,
}: {
  result: LabelSuggestions;
  labels: AssistLabel[];
  onClose: () => void;
}) {
  const { t } = useT();
  const client = useQueryClient();
  const [ticked, setTicked] = useState(() => initialTicks(result.verdicts));
  const [busy, setBusy] = useState(false);
  const known = result.verdicts.filter((verdict) => labels.some((label) => label.id === verdict.labelId));
  const changes = suggestionChanges(known, ticked, labels);
  const changeCount = Object.keys(changes).length;

  const apply = async () => {
    setBusy(true);
    try {
      if (changeCount > 0) await backend().setFlags([result.emailId], { keywords: changes });
      toast(
        changeCount > 0 ? t("labels.suggest.applied", { count: changeCount }) : t("labels.suggest.unchanged"),
        "success",
      );
      onClose();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(false);
      for (const key of [queryKeys.threads, queryKeys.thread, queryKeys.assistLabels, queryKeys.assistLabelLog]) {
        void client.invalidateQueries({ queryKey: key });
      }
    }
  };

  return (
    <div className="flex flex-col gap-4 px-6 pt-1 pb-5">
      {known.length === 0 ? (
        <p className="text-[13px] text-muted">{t("labels.suggest.noLabels")}</p>
      ) : (
        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 text-[13px] text-muted">{t("labels.suggest.intro")}</legend>
          {known.map((verdict) => (
            <VerdictRow
              key={verdict.labelId}
              verdict={verdict}
              label={labels.find((label) => label.id === verdict.labelId)!}
              checked={ticked[verdict.labelId] === true}
              onChange={(on) => setTicked((current) => ({ ...current, [verdict.labelId]: on }))}
            />
          ))}
        </fieldset>
      )}

      {result.newLabels.length > 0 && (
        <section className="flex flex-col gap-2" aria-labelledby="label-suggest-new">
          <h3 id="label-suggest-new" className="flex items-center gap-1.5 text-[13px] font-bold">
            <Sparkles className="size-4 text-pink" aria-hidden />
            {t("labels.suggest.newTitle")}
          </h3>
          {result.newLabels.map((suggestion) => (
            <NewLabelCard key={suggestion.name} suggestion={suggestion} emailId={result.emailId} labels={labels} />
          ))}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-2 border-t border-hairline pt-4">
        <p className="min-w-0 flex-1 truncate text-[11.5px] text-muted">{providerLabel(result)}</p>
        <Button variant="ghost" onClick={onClose}>
          {t("common.cancel")}
        </Button>
        <Button variant="primary" icon={Check} busy={busy} disabled={known.length === 0} onClick={() => void apply()}>
          {changeCount > 0 ? t("labels.suggest.apply", { count: changeCount }) : t("labels.suggest.keep")}
        </Button>
      </div>
    </div>
  );
}

function VerdictRow({
  verdict,
  label,
  checked,
  onChange,
}: {
  verdict: LabelVerdict;
  label: AssistLabel;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const { t } = useT();
  const change = checked === verdict.isSet ? null : checked ? "add" : "remove";
  return (
    <label
      className={clsx(
        "flex cursor-pointer gap-3 rounded-2xl border px-3.5 py-2.5",
        checked ? "border-pink/40 bg-pink-tint/30" : "border-hairline",
      )}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 size-4 shrink-0 accent-pink"
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <LabelDot color={label.color} />
          <span className="text-[13.5px] font-bold break-words">{label.name}</span>
          <span
            className={clsx(
              "rounded-full px-2 text-[11px] leading-[18px] font-bold",
              verdict.fits ? "bg-success-tint text-success" : "bg-canvas text-muted",
            )}
          >
            {verdict.fits ? t("labels.suggest.fits") : t("labels.suggest.fitsNot")}
          </span>
          {verdict.isSet && <span className="text-[11.5px] text-muted">{t("labels.suggest.isSet")}</span>}
          {change && (
            <span className={clsx("text-[11.5px] font-semibold", change === "add" ? "text-pink-ink" : "text-danger")}>
              {change === "add" ? t("labels.suggest.willAdd") : t("labels.suggest.willRemove")}
            </span>
          )}
        </span>
        {verdict.reason && <span className="selectable text-[12.5px] text-muted">{verdict.reason}</span>}
      </span>
    </label>
  );
}

function NewLabelCard({
  suggestion,
  emailId,
  labels,
}: {
  suggestion: NewLabelSuggestion;
  emailId: string;
  labels: AssistLabel[];
}) {
  const { t } = useT();
  const client = useQueryClient();
  const [state, setState] = useState<"idle" | "busy" | "done">("idle");
  const taken = labels.some((label) => label.name.trim().toLowerCase() === suggestion.name.trim().toLowerCase());
  const color = suggestion.color ?? LABEL_COLORS[labels.length % LABEL_COLORS.length]!;

  const create = async () => {
    setState("busy");
    try {
      const label = await backend().createAssistLabel({
        name: suggestion.name,
        description: suggestion.description,
        color,
      });
      await backend().setFlags([emailId], { keywords: { [label.keyword]: true } });
      toast(t("labels.suggest.created", { name: label.name }), "success");
      setState("done");
    } catch (error) {
      toast(assistErrorText(error), "error");
      setState("idle");
    } finally {
      for (const key of [queryKeys.threads, queryKeys.thread, queryKeys.assistLabels]) {
        void client.invalidateQueries({ queryKey: key });
      }
    }
  };

  return (
    <div className="flex flex-col gap-1.5 rounded-2xl bg-pink-tint/30 px-3.5 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          style={chipStyle(color)}
          className="inline-flex h-6 items-center rounded-full border px-2 text-[11.5px] font-semibold"
        >
          {suggestion.name}
        </span>
        <span className="flex-1" />
        {state === "done" || taken ? (
          <span className="flex items-center gap-1 text-[12px] font-semibold text-success">
            <Check className="size-3.5" aria-hidden />
            {state === "done" ? t("labels.suggest.createdShort") : t("labels.suggest.exists")}
          </span>
        ) : (
          <Button
            size="sm"
            icon={Plus}
            busy={state === "busy"}
            onClick={() => void create()}
            aria-label={t("labels.suggest.createNamed", { name: suggestion.name })}
          >
            {t("labels.suggest.create")}
          </Button>
        )}
      </div>
      {suggestion.description && <p className="text-[12.5px]">{suggestion.description}</p>}
      {suggestion.reason && <p className="text-[12px] text-muted">{suggestion.reason}</p>}
    </div>
  );
}
