import { create } from "zustand";
import { backend } from "@/backend/backend";
import { applyToSettings, settingsToValues, SYNCED_FIELDS } from "@/lib/settingsSync";
import { SettingsSyncQueue, type SyncMeta, type SyncStatus } from "@/lib/settingsSyncQueue";
import { SYNC_META_KEY } from "./browserOwner";
import { useSettings } from "./settings";

/**
 * The webmail's end of the settings sync: the settings that follow the account (see
 * lib/settingsSync) are read from the server's settings extension once the mailbox is open,
 * taken over whenever the server says they changed, and changes made here go back to it.
 * A server without the extension leaves everything in this browser, as before.
 */

const STORAGE_KEY = SYNC_META_KEY;

export const useSettingsSync = create<{ status: SyncStatus | null }>(() => ({ status: null }));

function loadMeta(): SyncMeta | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SyncMeta) : null;
  } catch {
    return null;
  }
}

function saveMeta(meta: SyncMeta): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(meta));
  } catch {
    // Without storage the queue lives as long as the page, which is still worth something.
  }
}

let running: Promise<void> | null = null;

export function startSettingsSync(): Promise<void> {
  running ??= start().catch(() => {
    running = null;
  });
  return running;
}

async function start(): Promise<void> {
  const engine = backend();
  if (!(await engine.userSettingsAvailable())) return;
  const [account] = await engine.listAccounts();
  if (!account) return;
  const queue = new SettingsSyncQueue({
    // The login, not the JMAP id: another person signing in on this browser starts over.
    account: account.email.toLowerCase(),
    // Signatures are read from the server directly, never kept here.
    signatures: false,
    // Settings left in this browser by another login are theirs, not this account's.
    onAccountSwitch: "server",
    transport: {
      load: () => engine.loadUserSettings(),
      save: (patch, ifInState) => engine.saveUserSettings(patch, ifInState),
    },
    local: {
      read: () => settingsToValues(useSettings.getState()),
      apply: (patch) => {
        useSettings.setState(applyToSettings(useSettings.getState(), patch));
      },
    },
    storage: { load: loadMeta, save: saveMeta },
    onStatus: (status) => useSettingsSync.setState({ status }),
  });
  useSettings.subscribe((state, previous) => {
    if (SYNCED_FIELDS.some((field) => state[field] !== previous[field])) void queue.localChanged();
  });
  engine.subscribe((event) => {
    if (event.type === "settings:changed") void queue.remoteChanged(event.state);
  });
  window.addEventListener("online", () => void queue.refresh());
  await queue.start();
}
