/**
 * Sign-in codes and confirmation links over UwUMail's JMAP extension
 * (`urn:uwumail:jmap:verification`, the OMXP draft's verification capability under UwUMail's own
 * name). The server finds them when mail comes in and hands them out as `Email.verification` and
 * as the list `VerificationCode/query`. See the server's docs/jmap-verification.md.
 */

import type { CodePurpose, VerificationCode } from "../types";
import type { Invocation, JmapSession } from "./client";

export const VERIFICATION = "urn:uwumail:jmap:verification";

/** The most codes the bar asks for; the server hands out at most 256 per call. */
export const CODE_LIMIT = 50;

/** What `Email/get` needs for a code: the property itself and who sent it about what. */
export const CODE_PROPERTIES = ["id", "threadId", "from", "subject", "receivedAt", "verification"];

const PURPOSES: readonly CodePurpose[] = [
  "login",
  "signup",
  "confirm-email",
  "reset-password",
  "confirm-action",
  "other",
];

/** Whether the session announces the extension, for the own account too. Without it the bar stays hidden. */
export function verificationSupported(session: Pick<JmapSession, "capabilities" | "accounts" | "accountId">): boolean {
  if (!(VERIFICATION in session.capabilities)) return false;
  const account = session.accounts[session.accountId];
  return !!account?.accountCapabilities && VERIFICATION in account.accountCapabilities;
}

/** The codes still valid, newest first, and their mails, in one request. */
export function codeCalls(accountId: string): Invocation[] {
  return [
    ["VerificationCode/query", { accountId, filter: { expired: false }, limit: CODE_LIMIT }, "q"],
    [
      "Email/get",
      {
        accountId,
        "#ids": { resultOf: "q", name: "VerificationCode/query", path: "/ids" },
        properties: CODE_PROPERTIES,
      },
      "e",
    ],
  ];
}

export interface JmapCodeEmail {
  id: string;
  threadId?: string;
  from?: { name?: string | null; email?: string | null }[] | null;
  subject?: string | null;
  receivedAt?: string | null;
  verification?: unknown;
}

/** 4 to 16 letters, digits and dashes, at least one letter or digit (security review L-2). */
const CODE_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9-]{4,16}$/;
const LABEL_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The longest a code may count as valid after its mail arrived, whatever the server says. */
export const MAX_CODE_LIFETIME_MS = 24 * 60 * 60 * 1000;

export function validCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

/** A host name in lower case, without the trailing dot; null for anything else, IP addresses included. */
export function validOrigin(origin: string): string | null {
  const host = origin.toLowerCase().replace(/\.$/, "");
  if (host.length === 0 || host.length > 253) return null;
  const labels = host.split(".");
  if (!labels.every((label) => LABEL_PATTERN.test(label))) return null;
  // A last label of digits only is an IPv4 address (or no real name); IPv6 fails the labels already.
  if (/^\d+$/.test(labels.at(-1)!)) return null;
  return host;
}

/** `expiresAt`, but never later than a day after the mail came in (or a day from now without a date). */
export function capExpiry(expiresAt: number, receivedAt: string | null | undefined, now = Date.now()): number {
  const received = receivedAt ? Date.parse(receivedAt) : Number.NaN;
  const base = Number.isNaN(received) ? now : received;
  return Math.min(expiresAt, base + MAX_CODE_LIFETIME_MS);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/**
 * The code of one mail, or null when it has none or what the server sent can't be shown. Anything
 * unknown falls to the careful side: an unknown source counts as a guess, autofill only on `true`.
 */
export function toVerificationCode(email: JmapCodeEmail, now = Date.now()): VerificationCode | null {
  const raw = email.verification;
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const kind = value.kind === "otp" || value.kind === "link" ? value.kind : null;
  const rawOrigin = text(value.origin);
  const origin = rawOrigin ? validOrigin(rawOrigin) : null;
  const expiresAt = text(value.expiresAt);
  if (!kind || !origin || !expiresAt || Number.isNaN(Date.parse(expiresAt))) return null;
  const code = text(value.code);
  if (code && !validCode(code)) return null;
  const url = kind === "link" ? text(value.url) : null;
  if (kind === "otp" && !code) return null;
  if (kind === "link" && !url && !code) return null;
  const from = email.from?.[0];
  const subject = text(email.subject);
  return {
    id: email.id,
    emailId: email.id,
    ...(email.threadId ? { threadId: email.threadId } : {}),
    kind,
    ...(code ? { code } : {}),
    ...(url ? { url } : {}),
    origin,
    sender: text(from?.name) ?? text(from?.email) ?? origin,
    ...(subject ? { subject } : {}),
    purpose: PURPOSES.includes(value.purpose as CodePurpose) ? (value.purpose as CodePurpose) : "other",
    source: value.source === "header" ? "header" : "heuristic",
    autofill: value.autofill === true,
    expiresAt: new Date(capExpiry(Date.parse(expiresAt), email.receivedAt, now)).toISOString(),
  };
}

/** The codes of an `Email/get` answer in the order the query gave, those valid at `now` only. */
export function activeCodes(ids: string[], emails: JmapCodeEmail[], now = Date.now()): VerificationCode[] {
  const byId = new Map(emails.map((email) => [email.id, email]));
  return ids.flatMap((id) => {
    const email = byId.get(id);
    const code = email ? toVerificationCode(email, now) : null;
    return code && Date.parse(code.expiresAt) > now ? [code] : [];
  });
}
