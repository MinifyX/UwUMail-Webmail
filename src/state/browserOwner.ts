import { clearLocalDraft } from "@/features/compose/localDraft";
import { DEFAULT_SETTINGS, useSettings } from "./settings";

/**
 * Whose data this browser holds. The webmail keeps some things in local storage — the settings
 * (trusted senders, remembered link domains, looks per sender), the draft kept for the phone and
 * the settings sync's queue — and none of that may reach the next person who signs in here.
 */
const OWNER_KEY = "uwumail.webmail.owner";
/** The settings sync's own bookkeeping (see state/accountSync). */
export const SYNC_META_KEY = "uwumail.webmail.settingsSync";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Without storage nothing is kept between visits, so there is nothing to hand on either.
  }
}

/**
 * Called once the server has said who is signed in. When that is someone else than last time,
 * everything the webmail kept in this browser for the previous login goes first: the settings
 * start from the defaults (the server brings this account's own back), the kept draft and the
 * sync queue are dropped. Answers whether anything was cleared.
 */
export function claimBrowser(login: string): boolean {
  const owner = login.trim().toLowerCase();
  const previous = read(OWNER_KEY);
  write(OWNER_KEY, owner);
  // The first visit with this check can't tell whose the data is; it stays, as it did before.
  if (previous === null || previous === owner) return false;
  useSettings.setState({ ...DEFAULT_SETTINGS });
  clearLocalDraft();
  write(SYNC_META_KEY, null);
  return true;
}
