/**
 * Keeps the service worker's filter (`FILTER_KEY`) in step with the synced settings: which
 * mailboxes stay quiet (named by address in the settings, by JMAP account id in the worker) and
 * the quiet hours. Written whenever either, or the mailboxes, change while push is on.
 */

import { useEffect } from "react";
import { isDemo } from "@/backend/backend";
import { accountAddress } from "@/lib/arrangement";
import { useMailboxes } from "@/lib/queries";
import { useSettings, type QuietHours } from "@/state/settings";
import { FILTER_KEY, idbKeyValue, type KeyValue, type PushFilter } from "./shared";

/** The filter for these mailboxes and settings. */
export function pushFilterOf(
  mailboxes: readonly { id: string; email: string }[],
  notifyMuted: readonly string[],
  quietHours: QuietHours,
): PushFilter {
  const muted = new Set(notifyMuted.map((address) => address.trim().toLowerCase()));
  return {
    mutedAccounts: [...new Set(mailboxes.filter((mailbox) => muted.has(accountAddress(mailbox))).map((m) => m.id))],
    quietHours: quietHours.enabled ? { from: quietHours.from, to: quietHours.to, days: [...quietHours.days] } : null,
  };
}

/** Leaves the filter for the service worker; a store that fails is tried again with the next change. */
export async function writePushFilter(kv: KeyValue, filter: PushFilter): Promise<void> {
  await kv.set(FILTER_KEY, filter).catch(() => undefined);
}

/**
 * Mount once in the signed-in page (next to `startWebPush`): writes the service worker's filter
 * whenever the muted mailboxes, the quiet hours or the mailboxes change while push is on.
 */
export function usePushFilterSync(kv: KeyValue = idbKeyValue): void {
  const enabled = useSettings((s) => s.pushNotifications);
  const notifyMuted = useSettings((s) => s.notifyMuted);
  const quietHours = useSettings((s) => s.quietHours);
  const { mailboxes, loaded } = useMailboxes();
  const filter = JSON.stringify(pushFilterOf(mailboxes, notifyMuted, quietHours));
  useEffect(() => {
    if (!enabled || !loaded || isDemo()) return;
    void writePushFilter(kv, JSON.parse(filter) as PushFilter);
  }, [enabled, loaded, filter, kv]);
}
