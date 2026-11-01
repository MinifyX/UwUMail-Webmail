import { useEffect, useState } from "react";

/** What a code or a sign-in link is for, as the server reads it from the mail. */
export type CodePurpose = "login" | "signup" | "confirm-email" | "reset-password" | "confirm-action" | "other";

/**
 * A one-time code or a sign-in link the server found in a mail. "header" means the sender stated
 * it in signed headers (Verification-Info, DKIM checked), "heuristic" that it was read from the
 * text, so the origin is a guess and the code is never filled in by itself.
 */
export interface VerificationCode {
  id: string;
  emailId: string;
  /** The conversation of the mail, so the list can mark its row. */
  threadId?: string;
  kind: "otp" | "link";
  code?: string;
  url?: string;
  /** The site the code is for, e.g. login.bank.example. */
  origin: string;
  /** The sender's display name. */
  sender: string;
  purpose: CodePurpose;
  source: "header" | "heuristic";
  /** The browser extension or the apps may fill it in on `origin` by themselves. */
  autofill: boolean;
  /** ISO 8601. */
  expiresAt: string;
}

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

/** Only http(s) links open; anything else in `url` is ignored. */
export function safeUrl(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : null;
  } catch {
    return null;
  }
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

/** Copies a code. The code itself never goes to the console or a log. */
export async function copyCode(code: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
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

/**
 * The codes of the current mail, newest first.
 * TODO: wire to the server: JMAP `VerificationCode/query` + `/get` for the list and
 * `Email/get` with the `verification` property for the reader, refreshed on push.
 */
export function useVerificationCodes(): VerificationCode[] {
  const [codes] = useState<VerificationCode[]>(() => (wantsDemoCodes() ? demoCodes() : []));
  return codes;
}
