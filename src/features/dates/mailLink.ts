/**
 * A link back to a mail, for the notes of an appointment found in it: this webmail's own address
 * with `#mail=<thread id>`. Opening it shows that mail, wherever it is filed.
 */

import { useUi } from "@/state/ui";

const PREFIX = "#mail=";
/** More than any id the server hands out; a longer one is no link of ours. */
const MAX_ID = 512;

/** The address that opens the thread `threadId` in this webmail. */
export function mailLink(threadId: string, location: Pick<Location, "origin" | "pathname"> = window.location): string {
  return `${location.origin}${location.pathname}${PREFIX}${encodeURIComponent(threadId)}`;
}

/** The thread a location's hash points to, or null. */
export function linkedThread(hash: string): string | null {
  if (!hash.startsWith(PREFIX)) return null;
  try {
    const id = decodeURIComponent(hash.slice(PREFIX.length));
    return id.length > 0 && id.length <= MAX_ID && !/[\s\p{Cc}]/u.test(id) ? id : null;
  } catch {
    return null;
  }
}

/** Opens the mail the address points to, now and whenever the hash changes; returns the cleanup. */
export function openLinkedMail(): () => void {
  const open = () => {
    const threadId = linkedThread(window.location.hash);
    if (!threadId) return;
    // The hash is spent: going back or reloading shouldn't open it again.
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${window.location.search}`);
    const ui = useUi.getState();
    ui.setSection("mail");
    ui.selectThread(threadId);
  };
  open();
  window.addEventListener("hashchange", open);
  return () => window.removeEventListener("hashchange", open);
}
