import type {
  Account,
  AttachmentContent,
  BackendEvent,
  BlockedSender,
  Contact,
  DraftContent,
  DraftSaveResult,
  FlagChange,
  Folder,
  Identity,
  MailtoDraft,
  MovedMessage,
  OutgoingMessage,
  QueuedSend,
  SenderPicture,
  Signature,
  ThreadDetail,
  ThreadPage,
  ThreadQuery,
  UnsubscribeOutcome,
} from "./types";
import type { SaveOutcome } from "@/lib/settingsSyncQueue";

export type BackendErrorCode =
  | "auth_failed"
  | "connection_failed"
  | "not_found"
  | "invalid_input"
  | "not_supported"
  | "internal"
  /** The session ended: the portal has to sign in again. */
  | "signed_out"
  /** An administrator switched the webmail off for this server or this account. */
  | "webmail_disabled";

export class BackendError extends Error {
  readonly code: BackendErrorCode;

  constructor(code: BackendErrorCode, message: string) {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }
}

/**
 * Everything the webmail needs from the server.
 *
 * The shape comes from the UwUMail app, where a Rust engine answers it. Here a
 * JMAP client in the browser does, which is why some of it is simpler: there is
 * exactly one account, it is never set up from this side, and anything about
 * the account itself (passwords, forwarding, away messages) belongs to the
 * portal, not here.
 */
export interface Backend {
  readonly kind: "jmap" | "demo";

  /** Always exactly one: the mailbox this session belongs to. */
  listAccounts(): Promise<Account[]>;
  /** The mailbox's own address first, then the aliases the server knows. */
  listIdentities(): Promise<Identity[]>;
  /** Whether the server keeps signatures (its settings extension); without it there are none. */
  signaturesAvailable(): Promise<boolean>;
  /** Whether the server keeps the account's settings (its settings extension) for the settings sync. */
  userSettingsAvailable(): Promise<boolean>;
  /** The account's shared settings, see lib/settingsSync. */
  loadUserSettings(): Promise<{ state: string; values: Record<string, unknown> }>;
  /** Sets keys (`null` removes); with `ifInState` only if nothing was written since. */
  saveUserSettings(patch: Record<string, unknown>, ifInState?: string): Promise<SaveOutcome>;
  listSignatures(): Promise<Signature[]>;
  /** Creates the signature when its id is empty. Taking a default for an address takes it from the others. */
  saveSignature(signature: Signature): Promise<Signature>;
  deleteSignature(signatureId: string): Promise<void>;
  syncNow(accountId?: string): Promise<void>;

  listFolders(accountId?: string): Promise<Folder[]>;
  /** Returns the new folder's id; `parentId` null puts it at the top level. */
  createFolder(input: { accountId?: string; name: string; parentId: string | null }): Promise<string>;
  renameFolder(folderId: string, name: string): Promise<void>;
  /** Moves the folder's mail to the trash first; refuses while it holds folders. Not for role folders. */
  deleteFolder(folderId: string): Promise<void>;
  /** Trash and junk only: deletes everything in it for good and returns how many went. */
  emptyFolder(folderId: string): Promise<number>;
  listThreads(query: ThreadQuery): Promise<ThreadPage>;
  getThread(threadId: string, conversations: boolean): Promise<ThreadDetail>;

  setFlags(messageIds: string[], change: FlagChange): Promise<void>;
  /** These return what moved and from where, for undoing. Mail already in that folder stays and isn't returned. */
  archive(messageIds: string[]): Promise<MovedMessage[]>;
  trash(messageIds: string[]): Promise<MovedMessage[]>;
  /** Deletes mail in the trash for good; mail elsewhere stays. Returns how many went. */
  deleteForever(messageIds: string[]): Promise<number>;
  moveMessages(messageIds: string[], folderId: string): Promise<MovedMessage[]>;
  /** Spam goes into the junk folder; not spam back to the inbox. */
  markSpam(messageIds: string[], spam: boolean): Promise<MovedMessage[]>;
  /** What this server keeps on the account's blocked list. */
  blockedSenders(): Promise<BlockedSender[]>;
  /** One click or a mail where possible; otherwise the page to open. */
  unsubscribe(messageId: string): Promise<UnsubscribeOutcome>;
  /** Inbox mail from an address, e.g. a newsletter's earlier issues. */
  inboxMessagesFrom(email: string): Promise<string[]>;
  blockSender(entry: string, accountId?: string): Promise<BlockedSender>;
  unblockSender(sender: BlockedSender): Promise<void>;
  send(message: OutgoingMessage): Promise<void>;
  /** Sends after `delaySeconds` unless `cancelSend` comes first; the result arrives as send:done or send:failed. */
  queueSend(message: OutgoingMessage, delaySeconds: number): Promise<QueuedSend>;
  /** Takes a queued mail back and returns it for the composer. */
  cancelSend(sendId: string): Promise<OutgoingMessage>;
  /** Saves into the Drafts folder, replacing the draft's earlier version. */
  saveDraft(draft: OutgoingMessage): Promise<DraftSaveResult>;
  deleteDraft(accountId: string, draftKey: string): Promise<void>;
  openDraft(messageId: string): Promise<DraftContent>;

  /** Whether the server filters incoming mail with rules (JMAP Sieve); without an id, whether any mailbox does. */
  mailRulesAvailable(accountId?: string): Promise<boolean>;
  /** The script named "UwUMail" (see lib/sieveRules), null when there is none yet, and whether it filters. */
  mailRules(accountId?: string): Promise<{ script: string | null; active: boolean }>;
  /** Stores the script as "UwUMail" and makes it the active one. */
  saveMailRules(script: string, accountId?: string): Promise<void>;
  /** The server's complaint about a script, or null when it would take it. */
  validateMailRules(script: string, accountId?: string): Promise<string | null>;

  searchContacts(query: string): Promise<Contact[]>;

  /** Downloads the attachment and hands out a blob URL for it. */
  getAttachment(attachmentId: string): Promise<AttachmentContent>;
  /** Hands the file to the browser's downloads. */
  saveAttachment(attachmentId: string): Promise<boolean>;
  /** The whole mail as an .eml file. */
  saveMessage(messageId: string): Promise<boolean>;

  /** Brand logo or website icon for a company address; null for people and mail providers. */
  getSenderPicture(email: string): Promise<SenderPicture | null>;
  /** Main domain of a company address (`news.shop.example` → `shop.example`); null for mail providers. */
  companyDomain(email: string): Promise<string | null>;

  /** The mailto: link the webmail was opened with, handed out once. */
  takeMailto(): Promise<MailtoDraft | null>;

  subscribe(listener: (event: BackendEvent) => void): () => void;
}

let instance: Backend | null = null;

/** Sample data instead of a server: `pnpm dev:demo`, or `pnpm dev` without one configured. */
export function isDemo(): boolean {
  return import.meta.env.MODE === "demo" || import.meta.env.VITE_DEMO === "1";
}

let loading: Promise<Backend> | null = null;

/** Loads the backend once; calls that overlap (React runs effects twice in development) share it. */
export function loadBackend(): Promise<Backend> {
  loading ??= (async () => {
    if (isDemo()) {
      const { DemoBackend } = await import("./demo");
      instance = new DemoBackend();
    } else {
      const { JmapBackend } = await import("./jmap/JmapBackend");
      instance = new JmapBackend();
    }
    return instance;
  })();
  return loading;
}

export function backend(): Backend {
  if (!instance) throw new Error("Backend not loaded yet. Call loadBackend() first.");
  return instance;
}
