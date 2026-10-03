/**
 * Labels in the mail list: `label:` in the search, sections per label, and what several
 * conversations have of a label for the quick picker.
 */

import {
  attachmentValue,
  type AssistLabel,
  type AssistLabelLogEntry,
  type LabelBase,
  type LabelOverlap,
  type LabelRules,
  type LabelVerdict,
  type ThreadSummary,
} from "@/backend/types";

/** The classifier only puts a label on by itself once it learned from this many mails. */
export const CLASSIFIER_MIN_EXAMPLES = 15;

/** How many own conditions a label may have. */
export const MAX_LABEL_CONDITIONS = 10;

/** A condition's value is at most this long. */
export const MAX_CONDITION_LENGTH = 200;

/**
 * The indexes of conditions that can't be saved: an empty value (only "has attachment" needs
 * none) or one that is too long.
 */
export function ruleProblems(rules: LabelRules | null | undefined): number[] {
  if (!rules) return [];
  return rules.conditions.flatMap((condition, index) => {
    if (condition.field === "hasAttachment") return [];
    const value = condition.value.trim();
    return value === "" || [...value].length > MAX_CONDITION_LENGTH ? [index] : [];
  });
}

/** Conditions as they are kept: none at all becomes null. */
export function cleanRules(rules: LabelRules | null | undefined): LabelRules | null {
  if (!rules || rules.conditions.length === 0) return null;
  return {
    match: rules.match,
    conditions: rules.conditions.map((condition) => ({
      field: condition.field,
      value: condition.field === "hasAttachment" ? attachmentValue(condition.value) : condition.value.trim(),
    })),
  };
}

export interface LabelSearch {
  /** The search without its `label:` parts, for the server's full-text search. */
  text: string;
  /** Keywords every mail must have. */
  keywords: string[];
  /** Names after `label:` that are no label; the list is empty then. */
  unknown: string[];
}

/** `label:Rechnungen`, `label:"Orders & shipping"` or `label:'…'`, anywhere in the search. */
const LABEL_TERM = /(?:^|\s)label:(?:"([^"]*)"?|'([^']*)'?|(\S*))/giu;

/** A keyword that no mail has: the list shows nothing for a label that doesn't exist. */
export const NO_SUCH_LABEL = "uwumail-no-such-label";

/**
 * Splits `label:` terms off a search. A label is found by its name (ignoring case) or its keyword;
 * with a name that is no label the search can find nothing.
 */
export function parseLabelSearch(search: string, labels: readonly AssistLabel[]): LabelSearch {
  const keywords: string[] = [];
  const unknown: string[] = [];
  const text = search
    .replace(LABEL_TERM, (_match, double?: string, single?: string, bare?: string) => {
      const name = (double ?? single ?? bare ?? "").trim();
      if (!name) return " ";
      const wanted = name.toLowerCase();
      const label =
        labels.find((entry) => entry.name.trim().toLowerCase() === wanted) ??
        labels.find((entry) => entry.keyword === wanted);
      if (label) {
        if (!keywords.includes(label.keyword)) keywords.push(label.keyword);
      } else {
        unknown.push(name);
      }
      return " ";
    })
    .replace(/\s+/g, " ")
    .trim();
  return { text, keywords, unknown };
}

/** The keywords a list asks for: the chips' and the search's, and none that can't be found. */
export function listKeywords(chips: readonly string[], search: LabelSearch): string[] {
  const all = [...new Set([...chips, ...search.keywords])];
  return search.unknown.length > 0 ? [...all, NO_SUCH_LABEL] : all;
}

/** `label:"Orders & shipping"` for the search field: quoted when the name has spaces or quotes. */
export function labelSearchTerm(label: Pick<AssistLabel, "name">): string {
  const name = label.name.trim();
  return /[\s"']/.test(name) ? `label:"${name.replaceAll('"', "")}"` : `label:${name}`;
}

export interface LabelSection {
  /** Null for the conversations without any label. */
  label: AssistLabel | null;
  threads: ThreadSummary[];
}

/**
 * The list in sections, one per label in the person's order, then the conversations without one.
 * A conversation with several labels sits under the first of them, so it is listed once and the
 * keyboard walks through the list as it is shown. Empty sections are left out.
 */
export function groupByLabel(threads: readonly ThreadSummary[], labels: readonly AssistLabel[]): LabelSection[] {
  const sections: LabelSection[] = labels.map((label) => ({ label, threads: [] }));
  const rest: ThreadSummary[] = [];
  for (const thread of threads) {
    const keywords = new Set((thread.keywords ?? []).map((keyword) => keyword.toLowerCase()));
    const section = sections.find((entry) => keywords.has(entry.label!.keyword));
    (section ? section.threads : rest).push(thread);
  }
  return [...sections, { label: null, threads: rest }].filter((section) => section.threads.length > 0);
}

export type LabelPresence = "all" | "some" | "none";

/** Whether all, some or none of these conversations (or mails) carry the label. */
export function labelPresence(items: readonly { keywords?: string[] }[], keyword: string): LabelPresence {
  if (items.length === 0) return "none";
  const count = items.filter((item) => item.keywords?.includes(keyword)).length;
  return count === 0 ? "none" : count === items.length ? "all" : "some";
}

/**
 * The keywords to change for "Label again": what was ticked differs from what the mail has. Labels
 * the person left as they are don't appear, so nothing is set twice or taken off by accident.
 */
export function suggestionChanges(
  verdicts: readonly LabelVerdict[],
  ticked: Readonly<Record<string, boolean>>,
  labels: readonly AssistLabel[],
): Record<string, boolean> {
  const changes: Record<string, boolean> = {};
  for (const verdict of verdicts) {
    const label = labels.find((entry) => entry.id === verdict.labelId);
    const wanted = ticked[verdict.labelId];
    if (!label || wanted === undefined || wanted === verdict.isSet) continue;
    changes[label.keyword] = wanted;
  }
  return changes;
}

/** What "Label again" ticks at first: the labels that fit, whether they are set or not. */
export function initialTicks(verdicts: readonly LabelVerdict[]): Record<string, boolean> {
  return Object.fromEntries(verdicts.map((verdict) => [verdict.labelId, verdict.fits]));
}

/** Labels whose name contains the typed text (ignoring case), for the quick picker. */
export function filterLabels(labels: readonly AssistLabel[], query: string): AssistLabel[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [...labels];
  const starts = labels.filter((label) => label.name.toLowerCase().startsWith(wanted));
  const contains = labels.filter((label) => !starts.includes(label) && label.name.toLowerCase().includes(wanted));
  return [...starts, ...contains];
}

type Translate = (key: string, options?: Record<string, unknown>) => string;

function param(params: Record<string, unknown>, key: string): string | null {
  const value = params[key];
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

/** One of the label's conditions that matched, in words ("subject contains “Rechnung”"). */
function conditionText(raw: unknown, t: Translate): string | null {
  if (!raw || typeof raw !== "object") return null;
  const { field, value } = raw as { field?: unknown; value?: unknown };
  const text = typeof value === "string" ? value : "";
  if (field === "hasAttachment")
    return t(`labels.reason.field.${attachmentValue(text) === "true" ? "attachmentYes" : "attachmentNo"}`);
  if (field === "from" || field === "subject" || field === "text")
    return t(`labels.reason.field.${field}`, { value: text });
  return null;
}

/**
 * Why a label is on a mail, in the person's language: the model's own words for the assistant,
 * otherwise put together from the server's `code` and `params`. A code this app doesn't know yet
 * (or details that don't fit it) shows the server's English sentence.
 */
export function labelReasonText(
  entry: Pick<AssistLabelLogEntry, "source" | "reason" | "code" | "params">,
  t: Translate,
  language: string,
): string {
  const { code, params, reason } = entry;
  if (entry.source === "ai" || !code) return reason;
  switch (code) {
    case "rule": {
      const conditions = Array.isArray(params.conditions) ? params.conditions : [];
      const parts = conditions.map((condition) => conditionText(condition, t)).filter((part) => part !== null);
      if (parts.length === 0) return reason;
      return t(params.match === "any" ? "labels.reason.ruleAny" : "labels.reason.rule", {
        conditions: parts.join(", "),
      });
    }
    case "sender": {
      const address = param(params, "address");
      if (!address) return reason;
      return t("labels.reason.sender", { address, count: param(params, "count") ?? "2" });
    }
    case "invoice": {
      const attachment = param(params, "attachment");
      if (attachment) return t("labels.reason.invoiceAttachment", { attachment });
      const number = param(params, "number");
      const total = param(params, "amount");
      if (number && total) return t("labels.reason.invoiceNumber", { number, amount: total });
      const word = param(params, "word");
      if (!word) return reason;
      const amount = param(params, "amount");
      return amount ? t("labels.reason.invoiceWordAmount", { word, amount }) : t("labels.reason.invoiceWord", { word });
    }
    case "appointment": {
      if (params.calendar === true) return t("labels.reason.appointmentCalendar");
      const word = param(params, "word");
      if (!word) return reason;
      const when = [param(params, "date"), param(params, "time")].filter(Boolean).join(" ");
      return when
        ? t("labels.reason.appointmentWordDate", { word, when })
        : t("labels.reason.appointmentWord", { word });
    }
    case "newsletter": {
      const header = param(params, "header");
      return header ? t("labels.reason.newsletter", { header }) : reason;
    }
    case "shipping": {
      const carrier = param(params, "carrier");
      const tracking = param(params, "tracking");
      if (carrier && tracking) return t("labels.reason.shippingBoth", { carrier, tracking });
      if (carrier) return t("labels.reason.shippingCarrier", { carrier });
      if (tracking) return t("labels.reason.shippingTracking", { tracking });
      return t("labels.reason.shipping");
    }
    case "account": {
      const word = param(params, "word");
      if (word) return t("labels.reason.accountWord", { word });
      return params.code === true ? t("labels.reason.accountCode") : reason;
    }
    case "personal":
      if (typeof params.known !== "boolean") return reason;
      return t(params.known ? "labels.reason.personalKnown" : "labels.reason.personalPrivate");
    case "work":
      if (params.colleague === true) return t("labels.reason.workColleague");
      return params.known === true ? t("labels.reason.workContact") : reason;
    case "advertising": {
      const words = Array.isArray(params.words)
        ? params.words.filter((word): word is string => typeof word === "string" && word.trim() !== "")
        : [];
      return words.length > 0 ? t("labels.reason.advertising", { words: words.join(", ") }) : reason;
    }
    case "similar": {
      const similarity = params.similarity;
      const count = param(params, "neighbours");
      if (typeof similarity !== "number" || !count) return reason;
      const percent = new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(
        Math.min(1, Math.max(0, similarity)),
      );
      return t("labels.reason.similar", { count, percent });
    }
    case "classifier": {
      const probability = params.probability;
      const examples = param(params, "examples");
      if (typeof probability !== "number" || !examples) return reason;
      const percent = new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1 }).format(
        Math.min(1, Math.max(0, probability)),
      );
      return t("labels.reason.classifier", { percent, examples });
    }
    default:
      return reason;
  }
}

/**
 * The base labels the person deleted, in the server's order: they can be made again. `known` are
 * the ones the server announces; an older server announces none, but one whose labels carry a
 * base knows them all.
 */
export function missingBases(
  labels: readonly Pick<AssistLabel, "base">[],
  all: readonly LabelBase[],
  known: readonly LabelBase[] = [],
): LabelBase[] {
  const candidates =
    known.length > 0 ? all.filter((base) => known.includes(base)) : labels.some((l) => l.base) ? all : [];
  const present = new Set(labels.map((label) => label.base));
  return candidates.filter((base) => !present.has(base));
}

/**
 * The overlap warning, one line per label: the same name, the meaning of a base label, or very
 * similar words (which ones). A label named twice keeps only its first, strongest reason.
 */
export function overlapLines(overlaps: readonly LabelOverlap[], t: Translate): string[] {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const overlap of overlaps) {
    if (seen.has(overlap.id)) continue;
    seen.add(overlap.id);
    switch (overlap.kind) {
      case "name":
        lines.push(t("labels.overlap.name", { name: overlap.name }));
        break;
      case "meaning":
        lines.push(t("labels.overlap.meaning", { name: overlap.name }));
        break;
      case "words":
        lines.push(t("labels.overlap.words", { name: overlap.name, words: overlap.words.join(", ") || "…" }));
        break;
    }
  }
  return lines;
}
