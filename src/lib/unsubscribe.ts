import { BackendError } from "@/backend/backend";
import type { Unsubscribe, UnsubscribeFallback, UnsubscribeOutcome } from "@/backend/types";
import { isEmail } from "./format";

/** What unsubscribing by mail would send. */
export interface UnsubscribeMail {
  address: string;
  subject: string;
}

/**
 * Reads the `mailto:` form of `List-Unsubscribe`.
 *
 * Every part of that header was written by whoever sent the mail, and what comes out of it is a
 * message sent from the reader's own account. So only two pieces are taken, and both are held to
 * something: one address that really looks like a single address, and a subject on one line —
 * list managers match on it, so it cannot simply be dropped. The body is not taken at all. A mail
 * going out under somebody's own name should not carry text a stranger wrote.
 */
export function unsubscribeMail(mailto: string): UnsubscribeMail | null {
  let target: URL;
  try {
    target = new URL(mailto);
  } catch {
    return null;
  }
  if (target.protocol !== "mailto:") return null;
  let address: string;
  try {
    address = decodeURIComponent(target.pathname).trim();
  } catch {
    return null;
  }
  // One recipient, and nothing in it that could turn into a second one or into a header of its own.
  if (address.includes(",") || /[\s<>;"]/.test(address) || !isEmail(address)) return null;
  const subject = (target.searchParams.get("subject") ?? "unsubscribe").replace(/\s+/g, " ").trim().slice(0, 200);
  return { address, subject: subject || "unsubscribe" };
}

/** What the server's one click came to: done, not possible for this mail, or tried and failed. */
export type OneClickResult = { kind: "done" } | { kind: "cannot" } | { kind: "failed"; reason: string };

export interface UnsubscribeSteps {
  /** Asks the server to do the one-click POST (`Email/unsubscribe`). */
  oneClick: () => Promise<OneClickResult>;
  /** Sends the unsubscribe mail from the reader's own account. */
  sendMail: (target: UnsubscribeMail) => Promise<void>;
}

/**
 * What an `Email/unsubscribe` error means: `cannotUnsubscribe` sends the reader the old way,
 * `unsubscribeFailed` says what went wrong; anything else (the mail is gone, the server is away)
 * is an error like any other.
 */
export function oneClickResultOf(error: unknown): OneClickResult {
  const type = (error as { type?: unknown } | null)?.type;
  if (type === "cannotUnsubscribe") return { kind: "cannot" };
  if (type === "unsubscribeFailed") {
    const description = (error as { description?: unknown }).description;
    return { kind: "failed", reason: typeof description === "string" && description.trim() ? description.trim() : "" };
  }
  if (type === "notFound") throw new BackendError("not_found", "That mail is gone.");
  throw error;
}

/** The way that is left besides the one click. */
export function unsubscribeFallback(options: Unsubscribe): UnsubscribeFallback {
  if (options.mailto && unsubscribeMail(options.mailto)) return "mail";
  return options.url ? "page" : null;
}

/**
 * Unsubscribing, in order: the server's one click where it offers that for the mail; if the
 * mail can't be unsubscribed that way (`cannot`), a mail to the header's address, else the page.
 * When the one click was tried and failed, that is said, and the other way only taken when asked
 * for again with `tryOneClick` false.
 */
export async function runUnsubscribe(
  options: Unsubscribe,
  steps: UnsubscribeSteps,
  tryOneClick = true,
): Promise<UnsubscribeOutcome> {
  if (tryOneClick && options.oneClick) {
    const result = await steps.oneClick();
    if (result.kind === "done") return { kind: "done", via: "oneClick" };
    if (result.kind === "failed") {
      return { kind: "oneClickFailed", reason: result.reason, fallback: unsubscribeFallback(options) };
    }
  }
  const target = options.mailto ? unsubscribeMail(options.mailto) : null;
  if (target) {
    await steps.sendMail(target);
    return { kind: "done", via: "mail" };
  }
  if (options.url) return { kind: "openPage", url: options.url };
  if (options.mailto) throw new BackendError("invalid_input", "That unsubscribe address makes no sense.");
  throw new BackendError("not_supported", "This mail says nothing about unsubscribing.");
}
