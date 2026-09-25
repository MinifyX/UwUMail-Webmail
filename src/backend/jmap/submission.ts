/**
 * Mail the server holds back (RFC 8621 `EmailSubmission`, with the server's delayed sending).
 *
 * Every submission without a time of its own waits for the person's "undo send" window on the
 * server (`undoStatus: "pending"`, `sendAt` when it goes); one with `sendAt` waits until then, at
 * most `maxDelayedSend` seconds ahead. `undoStatus: "canceled"` stops it while it waits. Servers
 * from before that send at once and answer without `undoStatus`, which reads as sent.
 */

import type { Address, ScheduledSend, SendReceipt } from "../types";
import { toAddresses, type JmapAddress } from "./convert";

export interface JmapCreatedSubmission {
  id: string;
  undoStatus?: string;
  sendAt?: string;
}

export interface JmapSubmission {
  id: string;
  emailId: string;
  sendAt?: string | null;
  undoStatus?: string;
  envelope?: { rcptTo?: { email: string }[] } | null;
}

/** What `EmailSubmission/set` created, as the interface sees it. */
export function submissionReceipt(created: JmapCreatedSubmission, now: Date = new Date()): SendReceipt {
  const pending = created.undoStatus === "pending";
  return {
    submissionId: created.id,
    sendAt: created.sendAt ?? now.toISOString(),
    pending,
  };
}

/** The longest "send later" the account's submission capability allows; 0 for servers without. */
export function maxDelayOf(capability: { maxDelayedSend?: unknown } | null): number {
  const value = capability?.maxDelayedSend;
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The `sendAt` to put into a submission: whole seconds in UTC, which is what a `UTCDate` is.
 * A time in the past means now, and the server says so itself; beyond `maxDelay` it refuses.
 */
export function submissionSendAt(sendAt: string): string {
  const date = new Date(sendAt);
  if (Number.isNaN(date.getTime())) throw new Error(`Not a time: ${sendAt}`);
  date.setUTCMilliseconds(0);
  return date.toISOString().replace(".000Z", "Z");
}

/** Pending submissions with the subject and recipients of their mail, soonest first. */
export function scheduledFrom(
  submissions: JmapSubmission[],
  emails: { id: string; subject?: string | null; to?: JmapAddress[] | null }[],
): ScheduledSend[] {
  const byId = new Map(emails.map((email) => [email.id, email]));
  return submissions
    .filter((submission) => submission.undoStatus === undefined || submission.undoStatus === "pending")
    .map((submission) => {
      const email = byId.get(submission.emailId);
      const to: Address[] =
        email?.to && email.to.length > 0
          ? toAddresses(email.to)
          : (submission.envelope?.rcptTo ?? []).map((recipient) => ({ email: recipient.email }));
      return {
        id: submission.id,
        emailId: submission.emailId,
        sendAt: submission.sendAt ?? "",
        subject: email?.subject ?? "",
        to,
      };
    })
    .sort((a, b) => a.sendAt.localeCompare(b.sendAt));
}
