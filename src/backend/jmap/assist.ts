/**
 * The AI assistant over UwUMail Server's `urn:uwumail:jmap:assist` extension, see the server's
 * docs/jmap-assist.md. Every call to a model is made by the server: the webmail asks it to write,
 * summarize, give a second opinion on spam or read appointments out of a mail, and shows what
 * comes back. Nothing a model answers ever changes a draft or a mail without the person.
 *
 * Writing and summarizing can also stream: the same method posted to the capability's
 * `streamUrl` answers `text/event-stream` with the text in pieces.
 */

import { AssistError, BackendError } from "../backend";
import {
  ASSIST_FEATURES,
  type AssistAnswer,
  type AssistChoice,
  type AssistEffective,
  type AssistEvent,
  type AssistFeature,
  type AssistFeatures,
  type AssistLabel,
  type AssistLabelInput,
  type AssistLabelLogEntry,
  type AssistModels,
  type AssistOptions,
  type AssistProvider,
  type AssistProviderInput,
  type AssistProviderKind,
  type AssistSettings,
  type AssistSettingsPatch,
  type AssistSpamCheck,
  type AssistStreamHandlers,
  type AssistUsage,
  type AssistVerdict,
  type ChatgptLogin,
  type ChatgptPoll,
} from "../types";
import { CORE, JmapMethodError } from "./client";

export const ASSIST = "urn:uwumail:jmap:assist";
export const ASSIST_USING = [CORE, ASSIST];
export const SETTINGS_ID = "singleton";

type Raw = Record<string, unknown>;

const asString = (value: unknown): string | null => (typeof value === "string" ? value : null);
const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;
const asCount = (value: unknown): number => Math.max(0, Math.round(asNumber(value) ?? 0));
const asObject = (value: unknown): Raw | null =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : null;
const asStrings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

const KINDS: readonly AssistProviderKind[] = [
  "openai",
  "anthropic",
  "gemini",
  "mistral",
  "openrouter",
  "ollama",
  "openaiCompatible",
  "chatgpt",
];

function featureFlags(value: unknown): AssistFeatures {
  const raw = asObject(value) ?? {};
  return Object.fromEntries(ASSIST_FEATURES.map((feature) => [feature, raw[feature] === true])) as AssistFeatures;
}

/**
 * What the own account's capabilities say about the assistant; null without it. The limits fall
 * back to the server's own defaults where an older one leaves them out.
 */
export function assistOptionsFrom(accountCapabilities: Record<string, unknown> | undefined): AssistOptions | null {
  const raw = asObject(accountCapabilities?.[ASSIST]);
  if (!raw) return null;
  return {
    features: featureFlags(raw.features),
    mayAddProviders: raw.mayAddProviders === true,
    mayUsePrivateAddresses: raw.mayUsePrivateAddresses === true,
    maxProviders: asNumber(raw.maxProviders) ?? 10,
    maxLabels: asNumber(raw.maxLabels) ?? 30,
    maxInstructionChars: asNumber(raw.maxInstructionChars) ?? 2000,
    maxTextChars: asNumber(raw.maxTextChars) ?? 20000,
  };
}

/** Where the server streams answers, from the session's capabilities; null where it doesn't. */
export function streamUrlFrom(capabilities: Record<string, unknown>): string | null {
  return asString(asObject(capabilities[ASSIST])?.streamUrl);
}

export function toAssistProvider(raw: Raw): AssistProvider {
  const kind = KINDS.includes(raw.kind as AssistProviderKind) ? (raw.kind as AssistProviderKind) : "openaiCompatible";
  const quota = asObject(raw.quota);
  return {
    id: String(raw.id),
    name: asString(raw.name) ?? String(raw.id),
    kind,
    scope: raw.scope === "personal" ? "personal" : "server",
    baseUrl: asString(raw.baseUrl),
    hasKey: raw.hasKey === true,
    keyHint: asString(raw.keyHint),
    model: asString(raw.model),
    fastModel: asString(raw.fastModel),
    features: asStrings(raw.features).filter((feature): feature is AssistFeature =>
      ASSIST_FEATURES.includes(feature as AssistFeature),
    ),
    quota: quota
      ? { requestsPerDay: asNumber(quota.requestsPerDay), tokensPerDay: asNumber(quota.tokensPerDay) }
      : null,
    experimental: raw.experimental === true || kind === "chatgpt",
    connected: raw.connected === true,
  };
}

/** The create object of `AssistProvider/set`: only what may be set, `apiKey` only when typed. */
export function providerCreate(input: AssistProviderInput): Raw {
  return providerPatch(input, true);
}

/** The update: only what the patch names. `kind` never changes. */
export function providerUpdate(patch: AssistProviderInput): Raw {
  return providerPatch(patch, false);
}

function providerPatch(input: AssistProviderInput, creating: boolean): Raw {
  const out: Raw = {};
  if (input.name !== undefined) out.name = input.name.trim();
  if (creating && input.kind !== undefined) out.kind = input.kind;
  if (input.baseUrl !== undefined) out.baseUrl = input.baseUrl?.trim() || null;
  if (input.apiKey !== undefined && (input.apiKey !== "" || !creating)) out.apiKey = input.apiKey.trim();
  if (input.model !== undefined) out.model = input.model?.trim() || null;
  if (input.fastModel !== undefined) out.fastModel = input.fastModel?.trim() || null;
  return out;
}

export function toAssistModels(raw: Raw): AssistModels {
  const models = Array.isArray(raw.models) ? raw.models : [];
  return {
    models: models
      .map((entry) => asObject(entry))
      .filter((entry): entry is Raw => entry !== null && typeof entry.id === "string")
      .map((entry) => ({ id: entry.id as string, name: asString(entry.name) ?? (entry.id as string) })),
    model: asString(raw.model),
    fastModel: asString(raw.fastModel),
  };
}

export function toChatgptLogin(raw: Raw): ChatgptLogin {
  const userCode = asString(raw.userCode);
  const verificationUri = asString(raw.verificationUri);
  // Opened in a new tab: a web page, never a script or a local address (security-audit W-44).
  if (!userCode || !verificationUri || !/^https:\/\/[^/\\]/i.test(verificationUri)) {
    throw new BackendError("internal", "The server started no sign-in.");
  }
  return {
    userCode,
    verificationUri,
    interval: Math.max(1, asNumber(raw.interval) ?? 5),
    expiresAt: asString(raw.expiresAt),
  };
}

export function toChatgptPoll(raw: Raw): ChatgptPoll {
  const status = raw.status;
  return {
    status: status === "connected" || status === "expired" || status === "failed" ? status : "pending",
    description: asString(raw.description),
  };
}

function toChoice(value: unknown): AssistChoice | null {
  const raw = asObject(value);
  const providerId = asString(raw?.providerId);
  return providerId ? { providerId, model: asString(raw?.model) } : null;
}

function toEffective(value: unknown): AssistEffective | null {
  const raw = asObject(value);
  const providerId = asString(raw?.providerId);
  if (!raw || !providerId) return null;
  return {
    providerId,
    providerName: asString(raw.providerName) ?? providerId,
    model: asString(raw.model),
    scope: raw.scope === "personal" ? "personal" : "server",
  };
}

export function toAssistSettings(raw: Raw | undefined): AssistSettings {
  const features = asObject(raw?.features) ?? {};
  const effective = asObject(raw?.effective) ?? {};
  return {
    default: toChoice(raw?.default),
    features: Object.fromEntries(ASSIST_FEATURES.map((feature) => [feature, toChoice(features[feature])])) as Record<
      AssistFeature,
      AssistChoice | null
    >,
    autoLabels: raw?.autoLabels === true,
    effective: Object.fromEntries(
      ASSIST_FEATURES.map((feature) => [feature, toEffective(effective[feature])]),
    ) as Record<AssistFeature, AssistEffective | null>,
  };
}

/** The update of `AssistSettings/set`: one path per feature, so other features' choices stay. */
export function assistSettingsUpdate(patch: AssistSettingsPatch): Raw {
  const update: Raw = {};
  if (patch.default !== undefined) update.default = patch.default;
  for (const [feature, choice] of Object.entries(patch.features ?? {})) {
    if (choice !== undefined) update[`features/${feature}`] = choice;
  }
  if (patch.autoLabels !== undefined) update.autoLabels = patch.autoLabels;
  return update;
}

export function toAssistLabel(raw: Raw): AssistLabel {
  const color = asString(raw.color);
  return {
    id: String(raw.id),
    name: asString(raw.name) ?? "",
    description: asString(raw.description) ?? "",
    keyword: (asString(raw.keyword) ?? "").toLowerCase(),
    color: color && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : null,
  };
}

export function labelCreate(input: AssistLabelInput): Raw {
  return { name: input.name.trim(), description: input.description.trim(), color: input.color };
}

export function labelUpdate(patch: Partial<AssistLabelInput>): Raw {
  const out: Raw = {};
  if (patch.name !== undefined) out.name = patch.name.trim();
  if (patch.description !== undefined) out.description = patch.description.trim();
  if (patch.color !== undefined) out.color = patch.color;
  return out;
}

export function toLabelLogEntry(raw: Raw): AssistLabelLogEntry {
  return {
    id: String(raw.id),
    emailId: String(raw.emailId),
    labelId: String(raw.labelId),
    name: asString(raw.name) ?? "",
    keyword: (asString(raw.keyword) ?? "").toLowerCase(),
    reason: asString(raw.reason) ?? "",
    createdAt: asString(raw.createdAt) ?? new Date(0).toISOString(),
    undone: raw.undone === true,
    providerName: asString(raw.providerName),
    model: asString(raw.model),
  };
}

/** Who answered, as every answer of a model says. */
export function answerOf(raw: Raw): AssistAnswer {
  const usage = asObject(raw.usage);
  return {
    providerId: asString(raw.providerId) ?? "",
    providerName: asString(raw.providerName) ?? "",
    model: asString(raw.model),
    usage: usage ? { inputTokens: asCount(usage.inputTokens), outputTokens: asCount(usage.outputTokens) } : null,
  };
}

const VERDICTS: readonly AssistVerdict[] = ["legitimate", "suspicious", "spam", "phishing"];

export function toSpamCheck(raw: Raw, emailId: string): AssistSpamCheck {
  const signals = asObject(raw.signals) ?? {};
  const auth = asObject(signals.authentication) ?? {};
  const sender = asObject(signals.sender) ?? {};
  const confidence = asNumber(raw.confidence) ?? 0;
  return {
    ...answerOf(raw),
    emailId: asString(raw.emailId) ?? emailId,
    verdict: VERDICTS.includes(raw.verdict as AssistVerdict) ? (raw.verdict as AssistVerdict) : "suspicious",
    confidence: Math.min(1, Math.max(0, confidence)),
    reasons: asStrings(raw.reasons).slice(0, 6),
    signals: {
      authentication: {
        spf: asString(auth.spf),
        dkim: asString(auth.dkim),
        dmarc: asString(auth.dmarc),
        fromDomain: asString(auth.fromDomain),
      },
      spamScore: asNumber(signals.spamScore),
      spamThreshold: asNumber(signals.spamThreshold),
      tests: asStrings(signals.tests),
      inJunk: signals.inJunk === true,
      sender: {
        address: asString(sender.address) ?? "",
        earlierMessages: asCount(sender.earlierMessages),
        earlierInJunk: asCount(sender.earlierInJunk),
        writtenTo: asCount(sender.writtenTo),
        inContacts: sender.inContacts === true,
        firstSeen: asString(sender.firstSeen),
      },
    },
  };
}

const LOCAL_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/** The most events of one mail taken from the assistant, and how long their texts may be. */
export const MAX_ASSIST_EVENTS = 20;
const MAX_EVENT_TEXT = { title: 200, location: 300, description: 2000, quote: 1000 } as const;

/** At most `max` characters (never half an emoji); what the model wrote comes from the mail. */
function clip(value: string | null, max: number): string | null {
  if (value === null || value.length <= max) return value;
  return Array.from(value).slice(0, max).join("");
}

/** The events of `Assist/extractEvents`; one without a readable start is left out. */
export function toEvents(raw: Raw): AssistEvent[] {
  const list = Array.isArray(raw.events) ? raw.events.slice(0, MAX_ASSIST_EVENTS * 2) : [];
  return list
    .map((entry) => asObject(entry))
    .filter((entry): entry is Raw => entry !== null)
    .flatMap((entry) => {
      const start = asString(entry.start);
      if (!start || !LOCAL_DATE_TIME.test(start)) return [];
      const allDay = entry.allDay === true;
      const given = asString(entry.end);
      const end = given && LOCAL_DATE_TIME.test(given) && given > start ? given : defaultEnd(start, allDay);
      const url = asString(entry.url);
      const participants = Array.isArray(entry.participants) ? entry.participants : [];
      return [
        {
          title: clip(asString(entry.title), MAX_EVENT_TEXT.title) ?? "",
          start,
          end,
          allDay,
          timeZone: asString(entry.timeZone),
          location: clip(asString(entry.location), MAX_EVENT_TEXT.location),
          description: clip(asString(entry.description), MAX_EVENT_TEXT.description),
          url: url && url.startsWith("https://") ? url : null,
          participants: participants
            .map((person) => asObject(person))
            .filter((person): person is Raw => person !== null && typeof person.email === "string")
            .map((person) => ({ name: asString(person.name) ?? "", email: person.email as string })),
          confidence: Math.min(1, Math.max(0, asNumber(entry.confidence) ?? 0)),
          quote: clip(asString(entry.quote), MAX_EVENT_TEXT.quote) ?? "",
        },
      ];
    })
    .slice(0, MAX_ASSIST_EVENTS);
}

/** An hour after `start`, or the next day for an all-day event, as the server does. */
function defaultEnd(start: string, allDay: boolean): string {
  const [date, time] = start.split("T") as [string, string];
  const [year, month, day] = date.split("-").map(Number) as [number, number, number];
  const [hour, minute, second] = time.split(":").map(Number) as [number, number, number];
  const moved = new Date(Date.UTC(year, month - 1, day + (allDay ? 1 : 0), hour + (allDay ? 0 : 1), minute, second));
  return moved.toISOString().slice(0, 19);
}

export function toUsage(raw: Raw): AssistUsage {
  const days = Array.isArray(raw.days) ? raw.days : [];
  const today = Array.isArray(raw.today) ? raw.today : [];
  return {
    days: days
      .map((entry) => asObject(entry))
      .filter((entry): entry is Raw => entry !== null)
      .map((entry) => ({
        day: asString(entry.day) ?? "",
        providerId: asString(entry.providerId) ?? "",
        providerName: asString(entry.providerName) ?? "",
        feature: asString(entry.feature) ?? "",
        requests: asCount(entry.requests),
        inputTokens: asCount(entry.inputTokens),
        outputTokens: asCount(entry.outputTokens),
      })),
    today: today
      .map((entry) => asObject(entry))
      .filter((entry): entry is Raw => entry !== null)
      .map((entry) => ({
        providerId: asString(entry.providerId) ?? "",
        providerName: asString(entry.providerName) ?? "",
        requests: asCount(entry.requests),
        tokens: asCount(entry.tokens),
        requestsPerDay: asNumber(entry.requestsPerDay),
        tokensPerDay: asNumber(entry.tokensPerDay),
      })),
  };
}

/** A method error of the extension as an `AssistError`; anything else stays as it is. */
export function assistError(error: unknown): unknown {
  if (!(error instanceof JmapMethodError)) return error;
  return new AssistError(error.type, error.description, { retryAfter: asNumber(error.details.retryAfter) });
}

/** A refused create, update or destroy of `AssistProvider/set` or `AssistLabel/set`. */
export function assistSetError(problem: { type: string; description?: string; properties?: string[] }): AssistError {
  return new AssistError(problem.type, problem.description ?? null, { properties: problem.properties ?? [] });
}

// --- Streaming -------------------------------------------------------------------------------

export interface EventStreamEvent {
  event: string;
  data: string;
}

/**
 * A `text/event-stream` parser (the WHATWG rules the server's answer needs): lines end in CRLF,
 * LF or CR, `event:` names the event, `data:` lines join with a newline, a blank line hands the
 * event out, and lines starting with `:` (the server's `: ping`) are comments. Chunks may break
 * anywhere, a CRLF included.
 */
export function createEventStreamParser(onEvent: (event: EventStreamEvent) => void) {
  let buffer = "";
  let name = "";
  let data: string[] = [];
  let hasData = false;

  const line = (text: string) => {
    if (text === "") {
      if (hasData) onEvent({ event: name || "message", data: data.join("\n") });
      name = "";
      data = [];
      hasData = false;
      return;
    }
    if (text.startsWith(":")) return;
    const colon = text.indexOf(":");
    const field = colon < 0 ? text : text.slice(0, colon);
    let value = colon < 0 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") name = value;
    else if (field === "data") {
      data.push(value);
      hasData = true;
    }
  };

  return {
    push(chunk: string) {
      buffer += chunk;
      for (;;) {
        const match = /\r\n|\n|\r/.exec(buffer);
        if (!match) break;
        // A CR at the very end may be the first half of a CRLF still on its way.
        if (match[0] === "\r" && match.index === buffer.length - 1) break;
        line(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
      }
    },
    /** The stream ended: a last event without its blank line still counts. */
    end() {
      if (buffer !== "") line(buffer.replace(/\r$/, ""));
      buffer = "";
      line("");
    },
  };
}

function parseData(data: string): Raw {
  try {
    return asObject(JSON.parse(data)) ?? {};
  } catch {
    return {};
  }
}

/**
 * Reads the stream's events into the handlers and resolves with the method's whole answer (the
 * `done` event). An `error` event rejects with an `AssistError`; a stream that ends without
 * either one broke off.
 */
/** More than any answer of a model; a stream that goes on beyond it is broken off. */
export const MAX_STREAM_BYTES = 4 * 1024 * 1024;

export async function readAssistStream(
  body: ReadableStream<Uint8Array>,
  handlers: AssistStreamHandlers = {},
): Promise<Raw> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let result: Raw | null = null;
  let failure: AssistError | null = null;
  const parser = createEventStreamParser(({ event, data }) => {
    if (result || failure) return;
    const value = parseData(data);
    if (event === "subject" && typeof value.subject === "string") handlers.onSubject?.(value.subject);
    else if (event === "delta" && typeof value.text === "string") handlers.onDelta?.(value.text);
    else if (event === "done") result = value;
    else if (event === "error") {
      failure = new AssistError(asString(value.type) ?? "providerFailed", asString(value.description), {
        retryAfter: asNumber(value.retryAfter),
      });
    }
  });
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > MAX_STREAM_BYTES) throw new BackendError("internal", "The answer is too long.");
      parser.push(decoder.decode(value, { stream: true }));
      if (result || failure) break;
    }
    parser.push(decoder.decode());
    parser.end();
  } finally {
    // Closing stops the model once the answer is complete, or when the page gave up on it.
    void reader.cancel().catch(() => undefined);
  }
  if (failure) throw failure;
  if (!result) throw new BackendError("connection_failed", "The answer broke off.");
  return result;
}

/**
 * Posts a method to the stream endpoint with the same login as the API (the portal's cookie and
 * its CSRF header) and reads the answer as it comes.
 */
export async function streamAssist(
  url: string,
  csrfToken: string,
  method: string,
  args: Raw,
  handlers: AssistStreamHandlers = {},
): Promise<Raw> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        accept: "text/event-stream",
        "x-csrf-token": csrfToken,
      },
      body: JSON.stringify({ using: ASSIST_USING, method, arguments: args }),
      signal: handlers.signal,
    });
  } catch (error) {
    if (handlers.signal?.aborted) throw error;
    throw new BackendError("connection_failed", "The mail server can't be reached.");
  }
  if (response.status === 401) throw new BackendError("signed_out", "The session ended.");
  if (response.status === 400) throw new BackendError("invalid_input", "The server didn't take the request.");
  if (!response.ok || !response.body) {
    throw new BackendError("internal", `The mail server answered ${response.status}.`);
  }
  return readAssistStream(response.body, handlers);
}
