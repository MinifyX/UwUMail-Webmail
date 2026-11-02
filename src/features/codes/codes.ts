import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { backend } from "@/backend/backend";
import type { Message, VerificationCode } from "@/backend/types";
import { queryKeys } from "@/lib/queries";

export type { CodePurpose, VerificationCode } from "@/backend/types";

/** "482913" → "482 913" with an en space, so the digits read in two groups; longer codes in threes. */
export function formatCode(code: string): string {
  if (!/^\d{6,}$/.test(code)) return code;
  return code.replace(/(\d{3})(?=\d)/g, "$1 ");
}

/** "m:ss" until `expiresAt`, never below 0:00. */
export function remaining(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function secondsLeft(expiresAt: string, now: number): number {
  return (Date.parse(expiresAt) - now) / 1000;
}

export function isActive(code: VerificationCode, now: number): boolean {
  return Date.parse(code.expiresAt) > now;
}

/** A host as compared: lower case, without the trailing dot of a fully qualified name. */
function normalHost(host: string): string {
  return host.toLowerCase().replace(/\.$/, "");
}

/**
 * A sign-in link opens only over https, without a user name in front of the host, and only on
 * the code's own origin or a subdomain of it (security review L-1). Anything else gives null.
 */
export function safeUrl(url: string | undefined, origin: string): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) return null;
    const host = normalHost(parsed.hostname);
    const own = normalHost(origin);
    if (!own || (host !== own && !host.endsWith(`.${own}`))) return null;
    return parsed.href;
  } catch {
    return null;
  }
}

/**
 * The link a code's "Open" may follow: only from signed headers, never one read from the text,
 * and only where `safeUrl` lets it.
 */
export function openableUrl(code: Pick<VerificationCode, "kind" | "url" | "origin" | "source">): string | null {
  if (code.kind !== "link" || code.source !== "header") return null;
  return safeUrl(code.url, code.origin);
}

/** The current time, every second while `enabled`. */
export function useNow(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [enabled]);
  return now;
}

/** How long a copied code stays on the clipboard. */
export const CLIPBOARD_CLEAR_MS = 60_000;

/**
 * Copies a code, and after a minute empties the clipboard if it still holds that code
 * (best effort: reading the clipboard may be denied). The code never goes to a log.
 */
export async function copyCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    return false;
  }
  window.setTimeout(() => void clearCopiedCode(code), CLIPBOARD_CLEAR_MS);
  return true;
}

/** Empties the clipboard when it still holds `code`; any error is ignored. */
export async function clearCopiedCode(code: string): Promise<void> {
  try {
    if ((await navigator.clipboard.readText()) === code) await navigator.clipboard.writeText("");
  } catch {
    // Reading may be denied or the page not focused: then the code simply stays.
  }
}

/** When the dev fixtures were made, so their countdowns stay put across renders. */
let fixturesAt: number | null = null;

/**
 * Dev only (`pnpm dev`, then `?demoCodes`): three codes to look at the bar, the list chips and the
 * reader hint without a server. They hang on the first three demo conversations.
 */
export function demoCodes(now = Date.now()): VerificationCode[] {
  fixturesAt ??= now;
  const at = (seconds: number) => new Date(fixturesAt! + seconds * 1000).toISOString();
  return [
    {
      id: "code-1",
      emailId: "msg-1",
      threadId: "thr-1",
      kind: "otp",
      code: "482913",
      origin: "login.bank.example",
      sender: "Bank Beispiel",
      purpose: "login",
      source: "header",
      autofill: true,
      expiresAt: at(280),
    },
    {
      id: "code-2",
      emailId: "msg-2",
      threadId: "thr-2",
      kind: "otp",
      code: "730215",
      origin: "shop.example.com",
      sender: "Beispiel-Shop",
      purpose: "confirm-email",
      source: "heuristic",
      autofill: false,
      expiresAt: at(850),
    },
    {
      id: "code-3",
      emailId: "msg-3",
      threadId: "thr-3",
      kind: "link",
      url: "https://forum.example.net/login/magic",
      origin: "forum.example.net",
      sender: "Forum Beispiel",
      purpose: "login",
      source: "header",
      autofill: false,
      expiresAt: at(560),
    },
  ];
}

function wantsDemoCodes(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).has("demoCodes");
}

/** The longest a timer may wait (setTimeout counts in a signed 32-bit number). */
const MAX_DELAY = 2 ** 31 - 1;

/** When the first of these codes runs out after `now`, or null when none is left. */
export function nextExpiry(codes: VerificationCode[], now: number): number | null {
  let next: number | null = null;
  for (const code of codes) {
    const at = Date.parse(code.expiresAt);
    if (at > now && (next === null || at < next)) next = at;
  }
  return next;
}

/**
 * The codes still valid, newest first: `VerificationCode/query` and `Email/get` with the
 * `verification` property, asked anew on every Email state change (push) and when the first
 * one expires. Empty when the server has no verification extension, so the bar stays hidden.
 */
export function useVerificationCodes(): VerificationCode[] {
  const demo = wantsDemoCodes();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.verificationCodes,
    queryFn: () => backend().verificationCodes(),
    enabled: !demo,
    staleTime: 30_000,
  });
  const [fixtures] = useState(() => (demo ? demoCodes() : []));
  const all = demo ? fixtures : (query.data ?? fixtures);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = nextExpiry(all, Date.now());
    if (next === null) return;
    const timer = window.setTimeout(
      () => {
        setNow(Date.now());
        if (!demo) void client.invalidateQueries({ queryKey: queryKeys.verificationCodes });
      },
      Math.min(MAX_DELAY, Math.max(0, next - Date.now()) + 50),
    );
    return () => window.clearTimeout(timer);
  }, [all, now, demo, client]);
  return useMemo(() => all.filter((code) => isActive(code, now)), [all, now]);
}

/**
 * The code for a row of the list: its conversation, or its mail when conversations are off.
 * `useVerificationCodes` already hands out only valid ones; `now` checks again where given.
 */
export function codeForThread(codes: VerificationCode[], threadId: string, now?: number): VerificationCode | undefined {
  return codes.find(
    (code) =>
      (code.threadId === threadId || `msg:${code.emailId}` === threadId) && (now === undefined || isActive(code, now)),
  );
}

/**
 * The code for the reader: what the newest mail of the conversation carries in
 * `Email.verification` (expired ones too, the hint then says so), else one of the list's.
 */
export function codeForMessages(
  messages: Pick<Message, "id" | "verification">[],
  threadId: string,
  codes: VerificationCode[],
): VerificationCode | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const found = messages[i]!.verification;
    if (found) return found;
  }
  return (
    codes.find((entry) => messages.some((message) => message.id === entry.emailId)) ??
    codes.find((entry) => entry.threadId === threadId)
  );
}
