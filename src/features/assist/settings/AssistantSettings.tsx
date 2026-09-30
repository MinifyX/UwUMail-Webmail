import { Sparkles } from "lucide-react";
import { backend } from "@/backend/backend";
import {
  ASSIST_FEATURES,
  type AssistChoice,
  type AssistFeature,
  type AssistOptions,
  type AssistProvider,
  type AssistSettings,
  type AssistSettingsPatch,
} from "@/backend/types";
import { Field, Select, Toggle } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { CURRENCY_CHOICES, useSettings, type CurrencyChoice } from "@/state/settings";
import { toast } from "@/state/toasts";
import { mayChooseCurrency } from "../cost";
import { nextChoice, providersFor } from "../providerForm";
import { assistErrorText, providerLabel, useAssistOptions, useAssistProviders, useAssistSettings } from "../useAssist";
import { LabelSettings } from "./LabelSettings";
import { ModelInput, Note, Section } from "./common";
import { ProviderSettings } from "./ProviderSettings";
import { UsageSettings } from "./UsageSettings";

/**
 * Settings → AI assistant: which provider and model each feature uses, the person's own
 * providers, the labels and whether they are set by themselves, and what was used. Everything
 * here depends on what the server's admin allows.
 */
export function AssistantSettings() {
  const { t } = useT();
  const { data: options } = useAssistOptions();
  if (!options) return null;
  const available = ASSIST_FEATURES.filter((feature) => options.features[feature]);
  return (
    <div className="flex flex-col gap-5 py-4">
      <div className="flex gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-pink-tint text-pink">
          <Sparkles className="size-5" aria-hidden />
        </span>
        <div>
          <p className="text-sm font-semibold">{t("assist.settings.title")}</p>
          <p className="text-[13px] text-muted">{t("assist.settings.description")}</p>
        </div>
      </div>
      {available.length === 0 && (
        <Note>
          <p className="font-semibold text-ink">{t("assist.settings.noneTitle")}</p>
          <p>{t("assist.settings.noneBody")}</p>
        </Note>
      )}
      <ChoiceSettings options={options} />
      <ProviderSettings options={options} />
      <LabelSettings options={options} />
      {options.features.extractEvents && <EventSettings />}
      <CurrencySetting />
      <UsageSettings />
    </div>
  );
}

/** Saves a change of the choices, and says so when the server refuses it. */
function saveSettings(patch: AssistSettingsPatch) {
  backend()
    .updateAssistSettings(patch)
    .catch((error: unknown) => toast(assistErrorText(error), "error"));
}

/** Which provider and model: one for everything, and per feature where wanted. */
function ChoiceSettings({ options }: { options: AssistOptions }) {
  const { t } = useT();
  const { data: settings } = useAssistSettings();
  const { data: providers = [] } = useAssistProviders();
  const features = ASSIST_FEATURES.filter((feature) => options.features[feature]);
  if (!settings || features.length === 0) return null;
  const usable = providersFor(providers, null);
  return (
    <Section title={t("assist.settings.choiceTitle")} description={t("assist.settings.choiceDescription")}>
      <ChoiceRow
        label={t("assist.settings.default")}
        choice={settings.default}
        providers={usable}
        noneLabel={t("assist.settings.automatic")}
        onChange={(choice) => saveSettings({ default: choice })}
      />
      <div className="flex flex-col gap-1 rounded-2xl bg-canvas p-1.5">
        {features.map((feature) => (
          <FeatureChoice
            key={feature}
            feature={feature}
            settings={settings}
            providers={providersFor(providers, feature)}
          />
        ))}
      </div>
    </Section>
  );
}

function ChoiceRow({
  label,
  choice,
  providers,
  noneLabel,
  onChange,
}: {
  label: string;
  choice: AssistChoice | null;
  providers: AssistProvider[];
  noneLabel: string;
  onChange: (choice: AssistChoice | null) => void;
}) {
  const { t } = useT();
  const provider = providers.find((entry) => entry.id === choice?.providerId);
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-[13px] font-semibold text-muted">{label}</p>
      <div className="flex flex-wrap gap-2">
        <Select
          aria-label={label}
          value={choice?.providerId ?? ""}
          onChange={(event) => onChange(nextChoice(choice, { providerId: event.target.value }))}
          className="min-w-[12rem] flex-1"
        >
          <option value="">{noneLabel}</option>
          {providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
              {entry.scope === "server" ? ` · ${t("assist.settings.fromServer")}` : ""}
            </option>
          ))}
        </Select>
        {choice && (
          <ModelInput
            providerId={choice.providerId}
            value={choice.model ?? ""}
            label={t("assist.settings.model")}
            placeholder={provider?.model ?? t("assist.settings.providerModel")}
            onCommit={(model) => onChange(nextChoice(choice, { model }))}
            className="min-w-[10rem] flex-1"
          />
        )}
      </div>
    </div>
  );
}

/** One feature: what it really uses, and its own choice. */
function FeatureChoice({
  feature,
  settings,
  providers,
}: {
  feature: AssistFeature;
  settings: AssistSettings;
  providers: AssistProvider[];
}) {
  const { t } = useT();
  const choice = settings.features[feature];
  const effective = settings.effective[feature];
  const provider = providers.find((entry) => entry.id === choice?.providerId);
  const set = (next: AssistChoice | null) => saveSettings({ features: { [feature]: next } });
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-surface px-3 py-2.5 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-semibold">{t(`assist.feature.${feature}`)}</p>
        <p className="truncate text-[12px] text-muted">
          {effective
            ? t("assist.settings.effective", { provider: providerLabel(effective) })
            : t("assist.settings.effectiveNone")}
        </p>
      </div>
      <div className="flex flex-wrap gap-2 sm:w-[55%] sm:flex-nowrap">
        <Select
          aria-label={t("assist.settings.featureProvider", { feature: t(`assist.feature.${feature}`) })}
          value={choice?.providerId ?? ""}
          onChange={(event) => set(nextChoice(choice, { providerId: event.target.value }))}
          className="min-w-[9rem] flex-1 [&_select]:h-9 [&_select]:text-[13px]"
        >
          <option value="">{t("assist.settings.asDefault")}</option>
          {providers.map((entry) => (
            <option key={entry.id} value={entry.id}>
              {entry.name}
            </option>
          ))}
        </Select>
        {choice && (
          <ModelInput
            providerId={choice.providerId}
            value={choice.model ?? ""}
            label={t("assist.settings.model")}
            placeholder={
              (feature === "compose" ? provider?.model : (provider?.fastModel ?? provider?.model)) ??
              t("assist.settings.providerModel")
            }
            onCommit={(model) => set(nextChoice(choice, { model }))}
            className="min-w-[8rem] flex-1"
          />
        )}
      </div>
    </div>
  );
}

/** Appointments: whether the webmail asks the model by itself whenever a mail opens. */
function EventSettings() {
  const { t } = useT();
  const refine = useSettings((s) => s.assistRefineEvents);
  const update = useSettings((s) => s.update);
  return (
    <Section title={t("assist.settings.eventsTitle")}>
      <Toggle
        checked={refine}
        onChange={(assistRefineEvents) => update({ assistRefineEvents })}
        label={t("assist.settings.refineEvents")}
        description={t("assist.settings.refineEventsDesc")}
      />
    </Section>
  );
}

/** In English the person picks euros or dollars for the costs; other languages have their own. */
export function CurrencySetting() {
  const { t, i18n } = useT();
  const currency = useSettings((s) => s.assistCurrency);
  const update = useSettings((s) => s.update);
  if (!mayChooseCurrency(i18n.language)) return null;
  return (
    <Section title={t("assist.settings.costsTitle")}>
      <Field label={t("assist.settings.currency")} hint={t("assist.settings.currencyHint")}>
        {(id) => (
          <Select
            id={id}
            value={currency}
            onChange={(event) => update({ assistCurrency: event.target.value as CurrencyChoice })}
          >
            {CURRENCY_CHOICES.map((choice) => (
              <option key={choice} value={choice}>
                {t(`assist.settings.currencies.${choice}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </Section>
  );
}
