import { backend, BackendError } from "@/backend/backend";
import type { SendReceipt } from "@/backend/types";
import { i18n, translate } from "@/i18n";
import { toast } from "@/state/toasts";
import { openDraftContent } from "./openDraft";

/**
 * Stops a mail the server still holds back (its undo window, or a later time) and opens it in
 * the composer again. The server keeps nothing of it; the mail is a draft in Drafts once more.
 */
export async function undoSend(submissionId: string) {
  try {
    openDraftContent(await backend().cancelSend(submissionId));
    toast(translate("toast.sendUndone"));
  } catch (reason) {
    if (reason instanceof BackendError && reason.code === "too_late") {
      toast(translate("toast.undoTooLate"), "error");
    } else {
      toast(
        translate("toast.undoFailed", { reason: reason instanceof Error ? reason.message : String(reason) }),
        "error",
      );
    }
  }
}

/**
 * Submissions this page made that are only in their undo window, not sent later on purpose: the
 * "Scheduled" list leaves them out, the countdown toast is theirs.
 */
export const undoWindowSends = new Set<string>();

/** Tells what became of a mail just handed to the server: going in a few seconds, later, or gone. */
export function announceSent(receipt: SendReceipt, later: boolean) {
  const id = receipt.submissionId;
  const undo = id ? { label: translate("toast.undo"), run: () => void undoSend(id) } : undefined;
  if (later && receipt.pending) {
    const time = new Date(receipt.sendAt).toLocaleString(i18n.language, {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    toast(translate("toast.scheduled", { time }), "success", undefined, { duration: 8000, action: undo });
    return;
  }
  const left = Date.parse(receipt.sendAt) - Date.now();
  if (receipt.pending && id && left > 1000) {
    undoWindowSends.add(id);
    // It goes out when the toast does; the server counts, the toast only shows it.
    toast(translate("toast.sending"), "info", undefined, {
      duration: left,
      countdownTo: receipt.sendAt,
      action: undo,
      onTimeout: () => toast(translate("toast.sent"), "success", "sent"),
    });
    return;
  }
  toast(translate("toast.sent"), "success", "sent");
}
