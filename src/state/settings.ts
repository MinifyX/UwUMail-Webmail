import { create } from "zustand";
import { persist } from "zustand/middleware";
import { savePreferences, type Preferences } from "@/backend/server";

/** Mail list rows: roomy cards with three lines, or two lines with a small picture. */
export type ListDensity = "relaxed" | "compact";
export type Tone = "playful" | "neutral";
export type ThemeSetting = "system" | "light" | "dark";
/** Animations: follow the system's reduced-motion setting, or override it. */
export type MotionSetting = "system" | "on" | "off";
export type LanguageSetting = "system" | "de" | "en";
export type RemoteImages = "ask" | "always";
/** How HTML mail looks while the webmail is dark. */
export type MailAppearance = "auto" | "light" | "dark";
/** What swiping a mail in the phone list does. */
export type SwipeAction = "read" | "archive" | "spam" | "trash" | "flag" | "none";
/** Seconds a sent mail waits before it goes out, so it can still be taken back. 0 sends at once. */
export const UNDO_SEND_CHOICES = [0, 5, 10, 20, 30] as const;
export type UndoSendSeconds = (typeof UNDO_SEND_CHOICES)[number];

export interface Settings {
  listDensity: ListDensity;
  tone: Tone;
  theme: ThemeSetting;
  motion: MotionSetting;
  language: LanguageSetting;
  conversations: boolean;
  remoteImages: RemoteImages;
  /** Addresses and `@domains` whose remote images are always allowed, see lib/trustedSenders. */
  trustedSenders: string[];
  /** Ask before a link from a mail opens. Disguised links ask anyway. */
  linkConfirm: boolean;
  /** Registrable domains (lower-case, punycode) whose links open without asking, see lib/links. */
  linkDomains: string[];
  /** The message header shows every address in full. Kept on this device only. */
  showAddressDetails: boolean;
  mailAppearance: MailAppearance;
  /** Light images in mails shown dark are recolored too, see features/mail/darkImages. */
  darkImages: boolean;
  /** Light/dark choices remembered per sender address (lowercase). */
  senderAppearance: Record<string, "light" | "dark">;
  /** Folder ids whose subfolders are hidden in the sidebar. */
  collapsedFolders: string[];
  /** Brand logos and website icons for company senders. */
  senderPictures: boolean;
  /** Phone list: swiping right and left. */
  swipeRight: SwipeAction;
  swipeLeft: SwipeAction;
  /** "Undo send": how long a sent mail waits in this page before it goes out. */
  undoSendSeconds: UndoSendSeconds;
}

interface SettingsActions {
  update: (patch: Partial<Settings>) => void;
  /** An address or an `@domain`. */
  trustSender: (entry: string) => void;
  untrustSenders: (entries: string[]) => void;
  rememberLinkDomain: (domain: string) => void;
  forgetLinkDomains: (domains: string[]) => void;
  rememberAppearance: (email: string, appearance: "light" | "dark") => void;
  forgetAppearances: () => void;
  toggleFolder: (folderId: string) => void;
}

export const DEFAULT_SETTINGS: Settings = {
  listDensity: "relaxed",
  tone: "playful",
  theme: "system",
  motion: "system",
  language: "system",
  conversations: true,
  remoteImages: "ask",
  trustedSenders: [],
  linkConfirm: true,
  linkDomains: [],
  showAddressDetails: false,
  mailAppearance: "auto",
  darkImages: true,
  senderAppearance: {},
  collapsedFolders: [],
  senderPictures: true,
  swipeRight: "read",
  swipeLeft: "archive",
  undoSendSeconds: 10,
};

/**
 * Settings the portal keeps as the account's preferences although they are about the device:
 * how the list looks and moves. They follow the login from browser to browser, but not into
 * the app. What follows the account everywhere (theme, tone, language, trusted senders, …)
 * goes through the server's settings extension instead, see state/accountSync.
 */
const ON_SERVER = {
  motion: "motion",
  listDensity: "mailDensity",
  swipeRight: "mailSwipeRight",
  swipeLeft: "mailSwipeLeft",
} as const satisfies Partial<Record<keyof Settings, keyof Preferences>>;

type ServerKey = keyof typeof ON_SERVER;

const ALLOWED: { [K in ServerKey]: readonly string[] } = {
  motion: ["system", "on", "off"],
  listDensity: ["relaxed", "compact"],
  swipeRight: ["read", "archive", "trash", "flag", "spam", "none"],
  swipeLeft: ["read", "archive", "trash", "flag", "spam", "none"],
};

function toServerValue(key: ServerKey, value: unknown): string | null {
  return typeof value === "string" && ALLOWED[key].includes(value) ? value : null;
}

function fromServerValue(key: ServerKey, value: string): Partial<Settings> | null {
  if (!ALLOWED[key].includes(value)) return null;
  return { [key]: value } as Partial<Settings>;
}

/** Applies what the server sent at sign-in; does not write anything back. */
export function applyServerPreferences(preferences: Preferences): void {
  const patch: Partial<Settings> = {};
  for (const [local, remote] of Object.entries(ON_SERVER) as [ServerKey, keyof Preferences][]) {
    const value = preferences[remote];
    if (typeof value !== "string") continue;
    Object.assign(patch, fromServerValue(local, value) ?? {});
  }
  if (Object.keys(patch).length > 0) useSettings.setState(patch);
}

function sendToServer(patch: Partial<Settings>): void {
  const changes: Preferences = {};
  for (const [local, remote] of Object.entries(ON_SERVER) as [ServerKey, keyof Preferences][]) {
    if (!(local in patch)) continue;
    const value = toServerValue(local, patch[local]);
    if (value !== null) changes[remote] = value;
  }
  if (Object.keys(changes).length === 0) return;
  // A setting that can't reach the server still holds for this browser.
  void savePreferences(changes).catch(() => undefined);
}

export const useSettings = create<Settings & SettingsActions>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      update: (patch) => {
        set(patch);
        sendToServer(patch);
      },
      trustSender: (entry) =>
        set((state) => ({
          trustedSenders: [...new Set([...state.trustedSenders, entry.toLowerCase()])],
        })),
      untrustSenders: (entries) =>
        set((state) => ({ trustedSenders: state.trustedSenders.filter((entry) => !entries.includes(entry)) })),
      rememberLinkDomain: (domain) =>
        set((state) => ({ linkDomains: [...new Set([...state.linkDomains, domain.toLowerCase()])] })),
      forgetLinkDomains: (domains) =>
        set((state) => ({ linkDomains: state.linkDomains.filter((domain) => !domains.includes(domain)) })),
      rememberAppearance: (email, appearance) =>
        set((state) => ({ senderAppearance: { ...state.senderAppearance, [email.toLowerCase()]: appearance } })),
      forgetAppearances: () => set({ senderAppearance: {} }),
      toggleFolder: (folderId) =>
        set((state) => ({
          collapsedFolders: state.collapsedFolders.includes(folderId)
            ? state.collapsedFolders.filter((id) => id !== folderId)
            : [...state.collapsedFolders, folderId],
        })),
    }),
    // Kept per browser so the first paint is right; the server has the say once it answers.
    { name: "uwumail.webmail", version: 1 },
  ),
);
