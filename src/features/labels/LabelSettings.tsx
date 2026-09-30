import { useQuery } from "@tanstack/react-query";
import clsx from "clsx";
import { ArrowRight, Check, Pencil, Plus, Sparkles, Tags, Trash, Wand2, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { AssistError, backend } from "@/backend/backend";
import {
  attachmentValue,
  LABEL_DETECTORS,
  LABEL_RULE_FIELDS,
  type AssistLabel,
  type AssistLabelInput,
  type AssistOptions,
  type LabelDetector,
  type LabelRuleCondition,
  type LabelRuleField,
  type LabelRules,
} from "@/backend/types";
import { Button, IconButton } from "@/components/ui/Button";
import { Field, Segmented, Select, TextInput, Toggle } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { formatLongDate } from "@/lib/format";
import { queryKeys } from "@/lib/queries";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";
import {
  chipStyle,
  LABEL_COLORS,
  LABEL_LIMITS,
  labelPatch,
  labelProblems,
  missingStarters,
  type StarterLabel,
} from "../assist/labels";
import { Note, Section } from "../assist/settings/common";
import {
  assistErrorText,
  providerLabel,
  useAssistLabels,
  useAssistOptions,
  useAssistSettings,
} from "../assist/useAssist";
import { LabelDot } from "./LabelMenus";
import {
  CLASSIFIER_MIN_EXAMPLES,
  cleanRules,
  labelReasonText,
  MAX_CONDITION_LENGTH,
  MAX_LABEL_CONDITIONS,
  ruleProblems,
} from "./logic";

/** How many of the newest inbox mails "label now" looks at: what `AssistLabel/apply` takes at once. */
const APPLY_COUNT = 20;

/** Whether labels are set by themselves without AI; on unless the person switched it off. */
export function useLabelSettings() {
  const { data: options } = useAssistOptions();
  return useQuery({
    queryKey: queryKeys.labelSettings,
    queryFn: () => backend().labelSettings(),
    enabled: Boolean(options),
    retry: false,
  });
}

/**
 * Settings → Labels: the labels themselves and everything that puts them on mail without AI. Only
 * the AI part (the model labelling new mail) lives with the assistant.
 */
export function LabelsSettingsPage() {
  const { t } = useT();
  const { data: options } = useAssistOptions();
  if (!options) return null;
  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-pink-tint text-pink">
          <Tags className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold">{t("labels.settings.title")}</p>
          <p className="text-[13px] text-muted">{t("labels.settings.description")}</p>
        </div>
      </div>
      <AutomaticSettings options={options} />
      <LabelSettings options={options} />
      <LabelLog />
    </div>
  );
}

/** Non-AI labelling on or off, and where the AI part is. */
function AutomaticSettings({ options }: { options: AssistOptions }) {
  const { t } = useT();
  const { data: settings } = useLabelSettings();
  const { data: assist } = useAssistSettings(options.features.autoLabels);
  const openSettings = useUi((s) => s.openSettings);
  return (
    <Section title={t("labels.settings.autoTitle")} description={t("labels.settings.autoDescription")}>
      {settings && (
        <Toggle
          checked={settings.nonAiLabels}
          onChange={(nonAiLabels) =>
            void backend()
              .updateLabelSettings({ nonAiLabels })
              .catch((error: unknown) => toast(assistErrorText(error), "error"))
          }
          label={t("labels.settings.auto")}
          description={t("labels.settings.autoDesc")}
        />
      )}
      {options.features.autoLabels && assist && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-canvas px-3.5 py-2.5">
          <Sparkles className="size-4 shrink-0 text-pink" aria-hidden />
          <p className="min-w-[min(100%,14rem)] flex-1 text-[12.5px] text-muted">
            {assist.autoLabels ? t("labels.settings.aiOn") : t("labels.settings.aiOff")}
          </p>
          <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => openSettings("assistant")}>
            {t("labels.settings.toAi")}
          </Button>
        </div>
      )}
    </Section>
  );
}

/** Settings → AI assistant: whether the model labels new mail, and labelling recent mail now. */
export function AiLabelSettings({ options }: { options: AssistOptions }) {
  const { t } = useT();
  const { data: labels = [] } = useAssistLabels();
  const { data: settings } = useAssistSettings();
  const [applying, setApplying] = useState(false);
  const openSettings = useUi((s) => s.openSettings);
  if (!options.features.autoLabels) return null;

  const applyNow = async () => {
    setApplying(true);
    try {
      const ids = await backend().recentInboxIds(APPLY_COUNT);
      const labeled = await backend().applyAssistLabels(ids);
      const count = Object.values(labeled).filter((list) => list.length > 0).length;
      toast(count > 0 ? t("assist.labels.applied", { count }) : t("assist.labels.appliedNone"), "success");
    } catch (error) {
      toast(assistErrorText(error), "error");
    } finally {
      setApplying(false);
    }
  };

  return (
    <Section
      title={t("assist.labels.title")}
      description={t("assist.labels.description")}
      action={
        <Button size="sm" variant="ghost" icon={ArrowRight} onClick={() => openSettings("labels")}>
          {t("labels.settings.manage")}
        </Button>
      }
    >
      {settings && (
        <Toggle
          checked={settings.autoLabels}
          onChange={(autoLabels) =>
            void backend()
              .updateAssistSettings({ autoLabels })
              .catch((error: unknown) => toast(assistErrorText(error), "error"))
          }
          label={t("assist.labels.auto")}
          description={labels.length === 0 ? t("assist.labels.autoNoLabels") : t("assist.labels.autoDesc")}
        />
      )}
      {settings && !settings.effective.autoLabels && <Note tone="warning">{t("assist.labels.noProvider")}</Note>}
      {labels.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-canvas px-3.5 py-2.5">
          <p className="min-w-[min(100%,14rem)] flex-1 text-[12.5px] text-muted">
            {t("assist.labels.applyDesc", { count: APPLY_COUNT })}
          </p>
          <Button size="sm" icon={Sparkles} busy={applying} onClick={() => void applyNow()}>
            {t("assist.labels.apply")}
          </Button>
        </div>
      )}
    </Section>
  );
}

/** The labels: the list, new ones and suggestions for the first ones. */
export function LabelSettings({ options }: { options: AssistOptions }) {
  const { t } = useT();
  const { data: labels = [], isPending } = useAssistLabels();
  const [editing, setEditing] = useState<string | "new" | null>(null);
  const [adding, setAdding] = useState(false);
  const setSettingsFormDirty = useUi((s) => s.setSettingsFormDirty);
  useEffect(() => {
    setSettingsFormDirty(editing !== null);
    return () => setSettingsFormDirty(false);
  }, [editing, setSettingsFormDirty]);

  const starters = missingStarters(labels, (id: StarterLabel) => ({
    name: t(`assist.starter.${id}.name`),
    description: t(`assist.starter.${id}.description`),
  })).slice(0, Math.max(0, options.maxLabels - labels.length));
  const room = labels.length < options.maxLabels;

  const addStarters = async () => {
    setAdding(true);
    let made = 0;
    try {
      for (const input of starters) {
        await backend().createAssistLabel(input);
        made += 1;
      }
      toast(t("assist.labels.startersAdded", { count: made }), "success");
    } catch (error) {
      toast(assistErrorText(error), "error");
    } finally {
      setAdding(false);
    }
  };

  return (
    <Section
      title={t("labels.settings.listTitle")}
      description={t("labels.settings.listDescription")}
      action={
        room &&
        editing !== "new" && (
          <Button size="sm" icon={Plus} onClick={() => setEditing("new")}>
            {t("assist.labels.new")}
          </Button>
        )
      }
    >
      {editing === "new" && <LabelEditor label={null} labels={labels} onDone={() => setEditing(null)} />}

      {starters.length > 0 && editing !== "new" && (
        <div className="flex flex-col gap-2 rounded-2xl bg-pink-tint/35 px-3.5 py-3">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold">
            <Wand2 className="size-4 text-pink" aria-hidden />
            {labels.length === 0 ? t("assist.labels.startersTitle") : t("assist.labels.startersMore")}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {starters.map((starter) => (
              <span
                key={starter.name}
                style={chipStyle(starter.color)}
                title={starter.description}
                className="inline-flex h-6 items-center rounded-full border px-2 text-[11.5px] font-semibold"
              >
                {starter.name}
              </span>
            ))}
          </div>
          <Button
            size="sm"
            variant="primary"
            icon={Plus}
            busy={adding}
            className="self-start"
            onClick={() => void addStarters()}
          >
            {t("assist.labels.addStarters", { count: starters.length })}
          </Button>
        </div>
      )}

      {!isPending && labels.length === 0 && starters.length === 0 && editing !== "new" && (
        <p className="text-[13px] text-muted">{t("assist.labels.empty")}</p>
      )}

      {labels.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {labels.map((label) =>
            editing === label.id ? (
              <li key={label.id}>
                <LabelEditor label={label} labels={labels} onDone={() => setEditing(null)} />
              </li>
            ) : (
              <LabelRow key={label.id} label={label} onEdit={() => setEditing(label.id)} />
            ),
          )}
        </ul>
      )}
      {!room && <p className="text-[12.5px] text-muted">{t("assist.labels.full", { count: options.maxLabels })}</p>}
    </Section>
  );
}

/** What puts a label on by itself, in a few words: "Detector: invoices · 2 conditions · learns". */
function automationSummary(label: AssistLabel, t: (key: string, options?: Record<string, unknown>) => string) {
  const parts: string[] = [];
  if (label.detector) parts.push(t(`labels.detector.${label.detector}`));
  if (label.rules) parts.push(t("labels.settings.conditionCount", { count: label.rules.conditions.length }));
  if (label.learnSenders) parts.push(t("labels.settings.learnsSenders"));
  if (label.classifier) parts.push(t("labels.settings.learnsFrom", { count: label.examples }));
  return parts.join(" · ");
}

function LabelRow({ label, onEdit }: { label: AssistLabel; onEdit: () => void }) {
  const { t } = useT();
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const remove = () => {
    setBusy(true);
    backend()
      .deleteAssistLabel(label.id)
      .then(() => toast(t("assist.labels.deleted", { name: label.name }), "success"))
      .catch((error: unknown) => toast(assistErrorText(error), "error"))
      .finally(() => {
        setBusy(false);
        setConfirm(false);
      });
  };
  const automation = automationSummary(label, t);
  return (
    <li className="flex flex-col gap-2 rounded-2xl border border-hairline bg-surface px-3.5 py-2.5">
      <div className="flex items-start gap-3">
        <LabelDot color={label.color} className="mt-1 size-3" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-[13.5px] font-bold break-words">{label.name}</span>
            <code className="font-mono text-[11px] text-faint" title={t("assist.labels.keyword")}>
              {label.keyword}
            </code>
            <span className="text-[11.5px] text-muted tabular-nums">
              {t("labels.settings.mailCount", { count: label.totalEmails })}
            </span>
          </p>
          <p className="text-[12.5px] break-words text-muted">
            {label.description || <span className="italic">{t("assist.labels.noDescription")}</span>}
          </p>
          {automation && <p className="text-[11.5px] text-faint">{automation}</p>}
        </div>
        <IconButton icon={Pencil} size="sm" label={t("assist.labels.edit", { name: label.name })} onClick={onEdit} />
        <IconButton
          icon={Trash}
          size="sm"
          label={t("assist.labels.delete", { name: label.name })}
          onClick={() => setConfirm(true)}
        />
      </div>
      {confirm && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-danger-tint px-3 py-2 text-[12.5px] text-danger">
          <span className="min-w-0 flex-1">{t("assist.labels.confirmDelete", { name: label.name })}</span>
          <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
            {t("common.cancel")}
          </Button>
          <Button size="sm" variant="danger" icon={Trash} busy={busy} onClick={remove}>
            {t("assist.labels.deleteShort")}
          </Button>
        </div>
      )}
    </li>
  );
}

type LabelForm = Required<AssistLabelInput>;

function formOf(label: AssistLabel | null, count: number): LabelForm {
  return label
    ? {
        name: label.name,
        description: label.description,
        color: label.color,
        rules: label.rules && structuredClone(label.rules),
        detector: label.detector,
        learnSenders: label.learnSenders,
        classifier: label.classifier,
      }
    : {
        name: "",
        description: "",
        color: LABEL_COLORS[count % LABEL_COLORS.length]!,
        rules: null,
        detector: null,
        learnSenders: true,
        classifier: true,
      };
}

export function LabelEditor({
  label,
  labels,
  onDone,
}: {
  label: AssistLabel | null;
  labels: AssistLabel[];
  onDone: () => void;
}) {
  const { t } = useT();
  const [form, setForm] = useState<LabelForm>(() => formOf(label, labels.length));
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const problems = labelProblems(form, labels, label?.id);
  const badConditions = ruleProblems(form.rules);
  const problemText = (field: "name" | "description") => {
    const problem = touched ? problems[field] : undefined;
    return problem ? t(`assist.labels.problem.${problem}`, { max: LABEL_LIMITS[field] }) : undefined;
  };
  const change = (patch: Partial<LabelForm>) => {
    setForm((current) => ({ ...current, ...patch }));
    setFailure(null);
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setTouched(true);
    if (Object.keys(problems).length > 0 || badConditions.length > 0) return;
    setBusy(true);
    const input: LabelForm = { ...form, rules: cleanRules(form.rules) };
    const work = label
      ? backend().updateAssistLabel(label.id, labelPatch(label, input))
      : backend().createAssistLabel(input);
    Promise.resolve(work)
      .then(() => {
        toast(label ? t("assist.labels.saved") : t("assist.labels.created", { name: form.name.trim() }), "success");
        onDone();
      })
      .catch((error: unknown) =>
        setFailure(
          error instanceof AssistError && error.type === "invalidProperties" && error.description
            ? error.description
            : assistErrorText(error),
        ),
      )
      .finally(() => setBusy(false));
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className="flex flex-col gap-3 rounded-2xl border border-pink/30 bg-pink-tint/20 px-4 py-3.5"
    >
      <p className="flex items-center gap-1.5 text-[13.5px] font-bold">
        <Tags className="size-4 text-pink" aria-hidden />
        {label ? t("assist.labels.editTitle", { name: label.name }) : t("assist.labels.newTitle")}
      </p>
      <Field label={t("assist.labels.name")} error={problemText("name")}>
        {(id) => (
          <TextInput
            id={id}
            value={form.name}
            placeholder={t("assist.labels.namePlaceholder")}
            onChange={(event) => change({ name: event.target.value })}
          />
        )}
      </Field>
      <Field
        label={t("assist.labels.descriptionField")}
        hint={t("assist.labels.descriptionHint")}
        error={problemText("description")}
      >
        {(id) => (
          <textarea
            id={id}
            rows={2}
            value={form.description}
            placeholder={t("assist.labels.descriptionPlaceholder")}
            onChange={(event) => change({ description: event.target.value })}
            className="w-full resize-y rounded-control border border-line bg-surface px-3.5 py-2.5 text-sm placeholder:text-faint focus:border-pink focus:shadow-focus focus:outline-none"
          />
        )}
      </Field>
      <div className="flex flex-col gap-1.5">
        <p className="text-[13px] font-semibold text-muted">{t("assist.labels.color")}</p>
        <div role="radiogroup" aria-label={t("assist.labels.color")} className="flex flex-wrap gap-1.5">
          {[null, ...LABEL_COLORS].map((color) => (
            <button
              key={color ?? "none"}
              type="button"
              role="radio"
              aria-checked={form.color === color}
              aria-label={color ?? t("assist.labels.noColor")}
              title={color ?? t("assist.labels.noColor")}
              onClick={() => change({ color })}
              className={clsx(
                "grid size-7 place-items-center rounded-full border-2 transition-transform focus-visible:shadow-focus focus-visible:outline-none",
                form.color === color ? "scale-110 border-ink" : "border-transparent",
                !color && "bg-canvas",
              )}
              style={color ? { backgroundColor: color } : undefined}
            >
              {form.color === color && (
                <Check className={clsx("size-3.5", color ? "text-white" : "text-muted")} strokeWidth={3} aria-hidden />
              )}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-2xl bg-surface px-3.5 py-3">
        <legend className="sr-only">{t("labels.settings.automaticTitle")}</legend>
        <div>
          <p className="text-[13px] font-bold">{t("labels.settings.automaticTitle")}</p>
          <p className="text-[12.5px] text-muted">{t("labels.settings.automaticHint")}</p>
        </div>
        <Field label={t("labels.settings.detector")} hint={t("labels.settings.detectorHint")}>
          {(id) => (
            <Select
              id={id}
              value={form.detector ?? ""}
              onChange={(event) => change({ detector: (event.target.value || null) as LabelDetector | null })}
            >
              <option value="">{t("labels.detector.none")}</option>
              {LABEL_DETECTORS.map((detector) => (
                <option key={detector} value={detector}>
                  {t(`labels.detector.${detector}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <ConditionsEditor
          rules={form.rules}
          problems={touched ? badConditions : []}
          onChange={(rules) => change({ rules })}
        />
        <Toggle
          checked={form.learnSenders}
          onChange={(learnSenders) => change({ learnSenders })}
          label={t("labels.settings.learnSenders")}
          description={t("labels.settings.learnSendersDesc")}
        />
        <Toggle
          checked={form.classifier}
          onChange={(classifier) => change({ classifier })}
          label={t("labels.settings.classifier")}
          description={
            <>
              {t("labels.settings.classifierDesc", { min: CLASSIFIER_MIN_EXAMPLES })}{" "}
              <span className="font-semibold">
                {(label?.examples ?? 0) >= CLASSIFIER_MIN_EXAMPLES
                  ? t("labels.settings.examplesReady", { count: label?.examples ?? 0 })
                  : t("labels.settings.examples", { count: label?.examples ?? 0, min: CLASSIFIER_MIN_EXAMPLES })}
              </span>
            </>
          }
        />
      </fieldset>

      {failure && (
        <p role="alert" className="rounded-xl bg-danger-tint px-3 py-2 text-[13px] text-danger">
          {failure}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={onDone}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {label ? t("common.save") : t("assist.labels.create")}
        </Button>
      </div>
    </form>
  );
}

/** A label's own conditions: from, subject, text or attachment, all or any of them. */
/** A condition moved to another field: "has attachment" starts at "yes", the others empty. */
function withField(condition: LabelRuleCondition, field: LabelRuleField): LabelRuleCondition {
  if (field === condition.field) return condition;
  if (field === "hasAttachment") return { field, value: "true" };
  return { field, value: condition.field === "hasAttachment" ? "" : condition.value };
}

function ConditionsEditor({
  rules,
  problems,
  onChange,
}: {
  rules: LabelRules | null;
  problems: number[];
  onChange: (rules: LabelRules | null) => void;
}) {
  const { t } = useT();
  const conditions = rules?.conditions ?? [];
  const match = rules?.match ?? "all";
  const set = (next: LabelRules["conditions"], nextMatch = match) =>
    onChange(next.length > 0 ? { match: nextMatch, conditions: next } : null);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-[13px] font-semibold text-muted">{t("labels.settings.conditions")}</p>
      {conditions.length === 0 && <p className="text-[12.5px] text-muted">{t("labels.settings.noConditions")}</p>}
      {conditions.length > 1 && (
        <Segmented
          label={t("labels.settings.conditions")}
          value={match}
          onChange={(value) => set(conditions, value)}
          options={[
            { value: "all", label: t("labels.settings.matchAll") },
            { value: "any", label: t("labels.settings.matchAny") },
          ]}
        />
      )}
      {conditions.map((condition, index) => {
        const bad = problems.includes(index);
        return (
          <div key={index} className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
              <Select
                aria-label={t("labels.settings.conditionField")}
                value={condition.field}
                onChange={(event) =>
                  set(
                    conditions.map((entry, i) =>
                      i === index ? withField(entry, event.target.value as LabelRuleField) : entry,
                    ),
                  )
                }
                className="w-full sm:w-48 sm:shrink-0"
              >
                {LABEL_RULE_FIELDS.map((field) => (
                  <option key={field} value={field}>
                    {t(`labels.condition.${field}`)}
                  </option>
                ))}
              </Select>
              {condition.field === "hasAttachment" ? (
                <Select
                  aria-label={t("labels.settings.conditionValue")}
                  value={attachmentValue(condition.value)}
                  onChange={(event) =>
                    set(conditions.map((entry, i) => (i === index ? { ...entry, value: event.target.value } : entry)))
                  }
                  className="min-w-0 flex-1"
                >
                  <option value="true">{t("labels.condition.attachmentYes")}</option>
                  <option value="false">{t("labels.condition.attachmentNo")}</option>
                </Select>
              ) : (
                <TextInput
                  aria-label={t("labels.settings.conditionValue")}
                  aria-invalid={bad}
                  maxLength={MAX_CONDITION_LENGTH + 20}
                  placeholder={t(`labels.condition.${condition.field}Placeholder`)}
                  value={condition.value}
                  onChange={(event) =>
                    set(conditions.map((entry, i) => (i === index ? { ...entry, value: event.target.value } : entry)))
                  }
                  className="min-w-0 flex-1"
                />
              )}
              <IconButton
                icon={X}
                size="sm"
                label={t("labels.settings.removeCondition")}
                onClick={() => set(conditions.filter((_, i) => i !== index))}
              />
            </div>
            {bad && (
              <p role="alert" className="text-[12.5px] text-danger">
                {t("labels.settings.conditionProblem", { max: MAX_CONDITION_LENGTH })}
              </p>
            )}
          </div>
        );
      })}
      {conditions.length < MAX_LABEL_CONDITIONS && (
        <Button
          size="sm"
          variant="ghost"
          icon={Plus}
          className="self-start"
          onClick={() => set([...conditions, { field: conditions.length === 0 ? "from" : "subject", value: "" }])}
        >
          {t("labels.settings.addCondition")}
        </Button>
      )}
    </div>
  );
}

/** Labels set by themselves lately, and who or what set them. */
function LabelLog() {
  const { t, i18n } = useT();
  const { data: labels = [] } = useAssistLabels();
  const { data: log = [], isPending } = useQuery({
    queryKey: [...queryKeys.assistLabelLog, "recent"],
    queryFn: () => backend().assistLabelLog(null, 30),
    staleTime: 60_000,
  });
  if (labels.length === 0) return null;
  return (
    <Section title={t("labels.log.title")} description={t("labels.log.description")}>
      {!isPending && log.length === 0 && <p className="text-[13px] text-muted">{t("labels.log.empty")}</p>}
      {log.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {log.map((entry) => {
            const label = labels.find((item) => item.id === entry.labelId);
            return (
              <li
                key={entry.id}
                className={clsx(
                  "flex flex-col gap-0.5 rounded-2xl border border-hairline px-3.5 py-2",
                  entry.undone && "opacity-60",
                )}
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span
                    style={chipStyle(label?.color ?? null)}
                    className={clsx(
                      "inline-flex h-[18px] items-center rounded-full border px-1.5 text-[10.5px] font-semibold",
                      !label?.color && "border-line bg-canvas text-muted",
                    )}
                  >
                    {label?.name ?? entry.name}
                  </span>
                  <span className="text-[11.5px] font-semibold text-muted">{t(`labels.source.${entry.source}`)}</span>
                  {entry.undone && <span className="text-[11.5px] text-muted">{t("labels.log.undone")}</span>}
                  <span className="ml-auto text-[11.5px] text-faint">
                    {formatLongDate(entry.createdAt, i18n.language)}
                  </span>
                </p>
                {entry.reason && (
                  <p className="text-[12.5px] break-words">{labelReasonText(entry, t, i18n.language)}</p>
                )}
                {entry.source === "ai" && entry.providerName && (
                  <p className="text-[11px] text-faint">
                    {providerLabel({ providerName: entry.providerName, model: entry.model })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}
