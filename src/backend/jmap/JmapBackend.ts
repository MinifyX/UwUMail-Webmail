/**
 * The mail engine of the webmail: JMAP from the browser.
 *
 * In the app a Rust engine answers these calls from a local cache. Here the
 * server is asked directly every time, which is fine because it is the same
 * machine that served the page. Two things the app does for itself are the
 * server's job here, because a page in a browser may not do them: cleaning
 * message HTML, and building the MIME of a message that is being sent.
 */

import { deviceTimeZone } from "@/lib/calendarDates";
import { textToHtml } from "@/lib/format";
import { cleanSignatureHtml } from "@/lib/signatures";
import type { ImageProxy } from "@/lib/remoteImages";
import type { SaveOutcome } from "@/lib/settingsSyncQueue";
import { unsubscribeMail } from "@/lib/unsubscribe";
import { BackendError, type Backend, type SignatureStore } from "../backend";
import type {
  Account,
  AddressBookInfo,
  AttachmentContent,
  BackendEvent,
  BlockedSender,
  CalendarInfo,
  CalendarOccurrence,
  Contact,
  ContactInput,
  ContactRecord,
  DraftContent,
  DraftSaveResult,
  EventDeleteScope,
  EventInput,
  FlagChange,
  Folder,
  FolderRights,
  Identity,
  MailtoDraft,
  MovedMessage,
  OutgoingMessage,
  Person,
  ScheduledSend,
  SendOptions,
  SendReceipt,
  SenderPicture,
  ShareLevel,
  SharedAccount,
  Signature,
  ThreadDetail,
  ThreadPage,
  ThreadQuery,
  ThreadSummary,
  UnsubscribeOutcome,
} from "../types";
import {
  EDIT_PROPERTIES,
  EVENT_PROPERTIES,
  RULE_PROPERTIES,
  eventPatch,
  newEventObject,
  toCalendarInfo,
  toOccurrence,
  type JmapCalendar,
  type JmapCalendarEvent,
} from "./calendar";
import {
  CARD_PROPERTIES,
  cardFromInput,
  contactSuggestions,
  patchFromInput,
  toAddressBookInfo,
  toContactRecord,
  type JmapAddressBook,
  type JmapCard,
} from "./contacts";
import {
  CALENDARS,
  CONTACTS,
  CORE,
  MAIL,
  REMOTE,
  SENDERS,
  SIEVE,
  SUBMISSION,
  WEBMAIL,
  accountCapability,
  call,
  downloadBlob,
  jmapSession,
  loadJmapSession,
  reloadJmapSession,
  whenSessionChanges,
  one,
  remoteImagePath,
  responseOf,
  senderPicturePath,
  supports,
  uploadBlob,
  watchPush,
} from "./client";
import {
  SETTINGS,
  loadUserSettings,
  newSignatureId,
  patchUserSettings,
  saveUserSettings,
  type UserSettingsSnapshot,
  signatureKey,
  signaturePatch,
  signaturesFrom,
} from "./userSettings";
import {
  IDENTITY_SIGNATURE_MAX_BYTES,
  hasIdentitySignatures,
  identitySignature,
  identitySignaturePatch,
  signatureMigration,
  type JmapIdentityWithSignature,
} from "./identitySignatures";
import { SUGGEST, suggestionLimit, suggestionsToContacts, type JmapAddressSuggestion } from "./suggest";
import {
  PRINCIPALS,
  groupByAccount,
  peopleFrom,
  scopeEmail,
  scopeId,
  sharedAccountsFrom,
  sharedWithFrom,
  toFolderRights,
  unscopeId,
  type JmapPrincipal,
} from "./sharing";
import {
  maxDelayOf,
  scheduledFrom,
  submissionReceipt,
  submissionSendAt,
  type JmapCreatedSubmission,
  type JmapSubmission,
} from "./submission";
import {
  toAddresses,
  toFolder,
  toMessage,
  toThreadSummary,
  toUnsubscribe,
  type JmapEmail,
  type JmapMailbox,
  type JmapThread,
} from "./convert";

/** What the list needs of every message; bodies are fetched when a mail is opened. */
const LIST_PROPERTIES = [
  "id",
  "threadId",
  "mailboxIds",
  "keywords",
  "from",
  "to",
  "subject",
  "receivedAt",
  "preview",
  "hasAttachment",
];

const MESSAGE_PROPERTIES = [
  ...LIST_PROPERTIES,
  "blobId",
  "cc",
  "bcc",
  "replyTo",
  "messageId",
  "inReplyTo",
  "references",
  "size",
  "attachments",
  "htmlBody",
  "textBody",
  "bodyValues",
  "header:List-Unsubscribe:asURLs",
  "header:List-Unsubscribe-Post:asText",
];

/** Added by the server's webmail extension: the cleaned body. */
const SAFE_PROPERTIES = ["uwuSafeHtml", "uwuHasRemoteContent"];

/** Mail providers never get a logo lookup, see the app's sender pictures. */
const MAIL_PROVIDERS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "yahoo.com",
  "gmx.de",
  "gmx.net",
  "web.de",
  "t-online.de",
  "freenet.de",
  "posteo.de",
  "mailbox.org",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "zoho.com",
]);

interface QueryResponse {
  ids: string[];
  position: number;
  total?: number;
}

interface GetResponse<T> {
  list: T[];
  notFound: string[];
  state: string;
}

interface SetResponse {
  created?: Record<string, { id: string; blobId?: string; threadId?: string }>;
  updated?: Record<string, unknown>;
  destroyed?: string[];
  notCreated?: Record<string, { type: string; description?: string }>;
  notUpdated?: Record<string, { type: string; description?: string }>;
  notDestroyed?: Record<string, { type: string; description?: string }>;
}

type JmapIdentity = JmapIdentityWithSignature;

interface JmapSenderEntry {
  id: string;
  value: string;
  action: "allow" | "block";
  scope?: string;
}

interface JmapSieveScript {
  id: string;
  name: string | null;
  blobId: string;
  isActive: boolean;
}

const CALENDAR_PROPERTIES = ["id", "name", "color", "sortOrder", "isVisible", "isDefault", "myRights"];

/** The one script the rules editor owns, see lib/sieveRules. */
const RULES_SCRIPT = "UwUMail";
const SIEVE_TYPE = "application/sieve";

function firstError(response: SetResponse): BackendError | null {
  const problem =
    Object.values(response.notCreated ?? {})[0] ??
    Object.values(response.notUpdated ?? {})[0] ??
    Object.values(response.notDestroyed ?? {})[0];
  if (!problem) return null;
  const text = problem.description ?? problem.type;
  if (problem.type === "overQuota") return new BackendError("invalid_input", "The mailbox is full.");
  if (problem.type === "forbiddenFrom") return new BackendError("invalid_input", "You may not send from that address.");
  return new BackendError("internal", text);
}

function throwOnError(response: SetResponse): void {
  const error = firstError(response);
  if (error) throw error;
}

/** ContactCard/set refusals the contact editor shows as they are: they name what to fix. */
function throwOnContactError(response: SetResponse): void {
  const problem = Object.values(response.notCreated ?? {})[0] ?? Object.values(response.notUpdated ?? {})[0];
  if (!problem) return;
  if (problem.type === "tooLarge") throw new BackendError("invalid_input", "This contact is too large to store.");
  if (problem.type === "invalidProperties") {
    throw new BackendError("invalid_input", problem.description ?? "The server didn't take this contact.");
  }
  throwOnError(response);
}

/** Cards per ContactCard/get, the server's maxObjectsInGet. */
const CARDS_PER_GET = 500;
/** Cards a composer search looks at, and the suggestions it shows. */
const SUGGESTION_CARDS = 20;
const SUGGESTIONS = 8;

/** Mailbox/set refusals the folder dialogs explain themselves. */
function throwOnMailboxError(response: SetResponse): void {
  const problem =
    Object.values(response.notCreated ?? {})[0] ??
    Object.values(response.notUpdated ?? {})[0] ??
    Object.values(response.notDestroyed ?? {})[0];
  if (!problem) return;
  if (problem.type === "mailboxHasChild") throw new BackendError("invalid_input", "This folder still holds folders.");
  if (problem.type === "mailboxHasEmail") throw new BackendError("invalid_input", "This folder still holds mail.");
  if (problem.type === "invalidProperties" || problem.type === "alreadyExists") {
    throw new BackendError("invalid_input", problem.description ?? "That folder name doesn't work here.");
  }
  throw new BackendError("internal", problem.description ?? problem.type);
}

/** A conversation id the list uses when conversations are switched off. */
const SINGLE = "msg:";

/**
 * A Message-ID without its angle brackets.
 *
 * JMAP hands out `messageId` bare (RFC 8621) while the header itself is written `<…>`, and a
 * draft key may arrive either way. Comparing the bare form means a draft saved by an older
 * version, or by another mail program, is still recognised as the same draft.
 */
export function bareMessageId(id: string | undefined): string {
  return (id ?? "").trim().replace(/^</, "").replace(/>$/, "");
}

/**
 * The local id of the mail a draft answers: the one in its conversation whose Message-ID its
 * In-Reply-To names. Null when the draft answers nothing or that mail is gone.
 */
export function answeredMail(
  draft: Pick<JmapEmail, "id" | "inReplyTo">,
  conversation: Pick<JmapEmail, "id" | "messageId">[],
): string | null {
  const wanted = bareMessageId(draft.inReplyTo?.[0]);
  if (!wanted) return null;
  const found = conversation.find(
    (email) => email.id !== draft.id && (email.messageId ?? []).some((id) => bareMessageId(id) === wanted),
  );
  return found?.id ?? null;
}

export class JmapBackend implements Backend {
  readonly kind = "jmap" as const;

  private folders: Folder[] = [];
  private folderMap = new Map<string, Folder>();
  private identities: Identity[] | null = null;
  private rawIdentities: JmapIdentity[] | null = null;
  private listeners = new Set<(event: BackendEvent) => void>();
  private stopPush: (() => void) | null = null;
  private ready: Promise<void> | null = null;
  private mailtoTaken = false;

  private async start(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await loadJmapSession();
        whenSessionChanges(() => void this.sessionChanged());
        await this.loadFolders();
        this.listenForPush();
      })();
    }
    return this.ready;
  }

  /** Somebody started or stopped sharing folders (or the account changed): read who shares what anew. */
  private async sessionChanged(): Promise<void> {
    try {
      await reloadJmapSession();
      await this.loadFolders();
    } catch {
      return;
    }
    this.principalList = null;
    this.emit({ type: "accounts:changed" });
    this.emit({ type: "mail:changed", accountId: this.accountId });
  }

  private get accountId(): string {
    return jmapSession().accountId;
  }

  private emit(event: BackendEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private listenForPush(): void {
    this.stopPush?.();
    this.stopPush = watchPush((all) => {
      // Folders somebody shares: only their mail and folders, under their account.
      for (const [accountId, types] of Object.entries(all)) {
        if (accountId === this.accountId || !this.sharedIds().includes(accountId)) continue;
        if (types.Mailbox) void this.loadFolders();
        if (types.Email || types.Mailbox) this.emit({ type: "mail:changed", accountId });
      }
      const changed = all[this.accountId];
      if (!changed) return;
      if (changed.Mailbox) void this.loadFolders();
      if (changed.Email || changed.Mailbox) this.emit({ type: "mail:changed", accountId: this.accountId });
      if (changed.EmailSubmission) this.emit({ type: "scheduled:changed" });
      if (changed.Calendar || changed.CalendarEvent) this.emit({ type: "calendar:changed" });
      if (changed.AddressBook || changed.ContactCard) this.emit({ type: "contacts:changed" });
      if (changed.Identity) {
        this.forgetIdentities();
        this.emit({ type: "settings:changed", accountId: this.accountId });
      }
      if (changed.UserSettings) {
        this.emit({ type: "settings:changed", accountId: this.accountId, state: changed.UserSettings });
      }
    });
  }

  /** The ids of the accounts that share folders with this one. */
  private sharedIds(): string[] {
    const { accounts } = jmapSession();
    return Object.keys(accounts).filter((id) => id !== this.accountId && !accounts[id]!.isPersonal);
  }

  /**
   * The own folders and those every sharing person shares, in one request. A shared account's
   * folders carry its account in their ids (see ./sharing) and never a role: somebody else's
   * Inbox is not this account's Inbox.
   */
  private async loadFolders(): Promise<Folder[]> {
    const own = this.accountId;
    const accounts = [own, ...this.sharedIds()];
    const body = await call(accounts.map((accountId, index) => ["Mailbox/get", { accountId, ids: null }, `m${index}`]));
    const folders: Folder[] = [];
    accounts.forEach((accountId, index) => {
      let boxes: JmapMailbox[];
      try {
        boxes = responseOf<GetResponse<JmapMailbox>>(body, `m${index}`).list;
      } catch {
        return;
      }
      for (const box of boxes) {
        const folder = toFolder(box, accountId, boxes);
        folder.rights = toFolderRights(box.myRights);
        const sharedWith = sharedWithFrom(box.shareWith);
        if (sharedWith) folder.sharedWith = sharedWith;
        if (accountId !== own) {
          folder.id = scopeId(accountId, folder.id, own);
          folder.parentId = folder.parentId ? scopeId(accountId, folder.parentId, own) : null;
          folder.role = null;
          folder.shared = true;
        }
        folders.push(folder);
      }
    });
    this.folders = folders;
    this.folderMap = new Map(folders.map((folder) => [folder.id, folder]));
    return folders;
  }

  /** The folder an id names, or a clear refusal when it is gone. */
  private folderOf(folderId: string): Folder {
    const folder = this.folderMap.get(folderId);
    if (!folder) throw new BackendError("not_found", "That folder is gone.");
    return folder;
  }

  /** Refuses what the owner of a shared folder didn't allow, before the server has to. */
  private allowed(folderIds: string[], right: keyof FolderRights): void {
    for (const id of folderIds) {
      const rights = this.folderMap.get(id)?.rights;
      if (rights && !rights[right]) throw new BackendError("forbidden", "The owner of this folder didn't allow that.");
    }
  }

  private folderWithRole(role: Folder["role"]): Folder | undefined {
    return this.folders.find((folder) => folder.role === role && folder.accountId === this.accountId);
  }

  private messageProperties(): string[] {
    return supports(WEBMAIL) ? [...MESSAGE_PROPERTIES, ...SAFE_PROPERTIES] : MESSAGE_PROPERTIES;
  }

  async listAccounts(): Promise<Account[]> {
    await this.start();
    const { account } = (await import("../server")).currentSession();
    return [
      {
        id: this.accountId,
        name: account.name || account.login,
        email: account.login,
        displayName: account.name || account.login,
        color: "pink",
        auth: "password",
        status: { state: "idle" },
        protocol: "jmap",
        protocols: ["jmap"],
      },
    ];
  }

  async listIdentities(): Promise<Identity[]> {
    return (await this.loadIdentities()).identities;
  }

  /** The sending addresses, with their signatures as the server hands them out. */
  private async loadIdentities(): Promise<{ identities: Identity[]; raw: JmapIdentity[] }> {
    await this.start();
    if (this.identities && this.rawIdentities) return { identities: this.identities, raw: this.rawIdentities };
    const response = await one<GetResponse<JmapIdentity>>("Identity/get", { ids: null }, [CORE, SUBMISSION]);
    const { account } = (await import("../server")).currentSession();
    const own = account.login.toLowerCase();
    this.rawIdentities = response.list;
    this.identities = response.list
      .map((identity) => ({
        id: identity.id,
        accountId: this.accountId,
        email: identity.email,
        name: identity.name,
        primary: identity.email.toLowerCase() === own,
        fromServer: true,
      }))
      .sort((a, b) => Number(b.primary) - Number(a.primary) || a.email.localeCompare(b.email));
    return { identities: this.identities, raw: this.rawIdentities };
  }

  /**
   * Signatures are the sending addresses' own (`Identity` signatures) on servers that keep them;
   * older ones only had the settings extension, where the app keeps several per address.
   */
  async signatureStore(): Promise<SignatureStore> {
    const { raw } = await this.loadIdentities();
    if (hasIdentitySignatures(raw)) return "identity";
    return supports(SETTINGS) ? "settings" : null;
  }

  async userSettingsAvailable(): Promise<boolean> {
    await this.start();
    return supports(SETTINGS);
  }

  async loadUserSettings(): Promise<UserSettingsSnapshot> {
    await this.start();
    return loadUserSettings();
  }

  async saveUserSettings(patch: Record<string, unknown>, ifInState?: string): Promise<SaveOutcome> {
    await this.start();
    return saveUserSettings(patch, ifInState);
  }

  async listSignatures(): Promise<Signature[]> {
    const store = await this.signatureStore();
    if (store === "settings") return signaturesFrom((await loadUserSettings()).values);
    if (store !== "identity") return [];
    await this.migrateSignatures();
    const { raw, identities } = await this.loadIdentities();
    const order = new Map(identities.map((identity, index) => [identity.id, index]));
    return raw
      .map(identitySignature)
      .filter((signature): signature is Signature => signature !== null)
      .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  }

  private migration: Promise<void> | null = null;

  /**
   * Once per account and browser: signatures the webmail kept in the settings extension go to
   * the addresses that have none of their own yet. The settings keys stay for the app.
   */
  private migrateSignatures(): Promise<void> {
    this.migration ??= (async () => {
      const flag = `uwu-signatures-migrated:${this.accountId}`;
      try {
        if (localStorage.getItem(flag) || !supports(SETTINGS)) return;
        const { raw } = await this.loadIdentities();
        const plan = signatureMigration(raw, signaturesFrom((await loadUserSettings()).values));
        if (Object.keys(plan).length > 0) {
          const update = Object.fromEntries(
            Object.entries(plan).map(([id, html]) => [id, identitySignaturePatch(cleanSignatureHtml(html))]),
          );
          throwOnError(await one<SetResponse>("Identity/set", { update }, [CORE, SUBMISSION]));
          this.forgetIdentities();
        }
        localStorage.setItem(flag, new Date().toISOString());
      } catch {
        // Tried again with the next page load; the signatures are still where they were.
      }
    })();
    return this.migration;
  }

  private forgetIdentities(): void {
    this.identities = null;
    this.rawIdentities = null;
  }

  /** On the address the signature is for; `id` doesn't matter, an address has exactly one. */
  async saveSignature(signature: Signature): Promise<Signature> {
    const store = await this.signatureStore();
    if (store === "identity") {
      const { identities } = await this.loadIdentities();
      const identity = identities.find((entry) => entry.email.toLowerCase() === signature.email.toLowerCase());
      if (!identity) throw new BackendError("not_found", "That sender address is gone.");
      const patch = identitySignaturePatch(cleanSignatureHtml(signature.html));
      if (new TextEncoder().encode(patch.htmlSignature).length > IDENTITY_SIGNATURE_MAX_BYTES) {
        throw new BackendError("invalid_input", "The signature is too big. Try a smaller picture.");
      }
      throwOnError(await one<SetResponse>("Identity/set", { update: { [identity.id]: patch } }, [CORE, SUBMISSION]));
      this.forgetIdentities();
      return { ...signature, id: identity.id, forNew: true, forReplies: true };
    }
    if (store !== "settings") throw new BackendError("not_supported", "This server can't keep signatures.");
    const saved = { ...signature, id: signature.id || newSignatureId() };
    // Read right before writing, so the defaults of the address's other signatures are current.
    const existing = signaturesFrom((await loadUserSettings()).values);
    await patchUserSettings(signaturePatch(saved, existing));
    return saved;
  }

  async deleteSignature(signatureId: string): Promise<void> {
    const store = await this.signatureStore();
    if (store === "identity") {
      throwOnError(
        await one<SetResponse>("Identity/set", { update: { [signatureId]: identitySignaturePatch("") } }, [
          CORE,
          SUBMISSION,
        ]),
      );
      this.forgetIdentities();
      return;
    }
    if (store === "settings") await patchUserSettings({ [signatureKey(signatureId)]: null });
  }

  /** The people who share folders with this account, each an account of their own. */
  async sharedAccounts(): Promise<SharedAccount[]> {
    await this.start();
    const principals = this.sharedIds().length > 0 ? await this.principals() : [];
    return sharedAccountsFrom(jmapSession().accounts, this.accountId, principals);
  }

  async sharingAvailable(): Promise<boolean> {
    await this.start();
    return supports(PRINCIPALS);
  }

  private principalList: Promise<JmapPrincipal[]> | null = null;

  /** Everyone on the server, as the server lists them for sharing; asked once per session. */
  private principals(): Promise<JmapPrincipal[]> {
    if (!supports(PRINCIPALS)) return Promise.resolve([]);
    this.principalList ??= one<GetResponse<JmapPrincipal>>(
      "Principal/get",
      { ids: null, properties: ["id", "type", "name", "email", "accounts"] },
      [CORE, PRINCIPALS],
    )
      .then((response) => response.list)
      .catch((error: unknown) => {
        this.principalList = null;
        throw error;
      });
    return this.principalList;
  }

  async people(): Promise<Person[]> {
    await this.start();
    const own = accountCapability<{ currentUserPrincipalId?: string }>(PRINCIPALS)?.currentUserPrincipalId ?? null;
    const { account } = (await import("../server")).currentSession();
    return peopleFrom(await this.principals(), own, account.login);
  }

  /** Shares a folder with somebody at a level, or stops sharing it with them (`null`). */
  async shareFolder(folderId: string, personId: string, level: ShareLevel | null): Promise<void> {
    await this.start();
    this.allowed([folderId], "mayAdmin");
    const { accountId, id } = unscopeId(folderId, this.accountId);
    const response = await one<SetResponse>(
      "Mailbox/set",
      { accountId, update: { [id]: { [`shareWith/${personId}`]: level } } },
      [CORE, MAIL, PRINCIPALS],
    );
    throwOnMailboxError(response);
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId });
  }

  async syncNow(): Promise<void> {
    await this.start();
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
  }

  async listFolders(): Promise<Folder[]> {
    await this.start();
    return this.folders.length > 0 ? this.folders : this.loadFolders();
  }

  /** Inside a shared folder it goes into its owner's mailbox, where they allowed that. */
  async createFolder(input: { name: string; parentId: string | null }): Promise<string> {
    await this.start();
    const own = this.accountId;
    const parent = input.parentId ? unscopeId(input.parentId, own) : { accountId: own, id: null };
    if (input.parentId) this.allowed([input.parentId], "mayCreateChild");
    const response = await one<SetResponse>("Mailbox/set", {
      accountId: parent.accountId,
      create: { new: { name: input.name, parentId: parent.id } },
    });
    throwOnMailboxError(response);
    const id = response.created?.new?.id;
    if (!id) throw new BackendError("internal", "The server didn't create the folder.");
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: parent.accountId });
    return scopeId(parent.accountId, id, own);
  }

  async renameFolder(folderId: string, name: string): Promise<void> {
    await this.start();
    this.allowed([folderId], "mayRename");
    const { accountId, id } = unscopeId(folderId, this.accountId);
    throwOnMailboxError(await one<SetResponse>("Mailbox/set", { accountId, update: { [id]: { name } } }));
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId });
  }

  async deleteFolder(folderId: string): Promise<void> {
    await this.start();
    await this.loadFolders();
    const folder = this.folderOf(folderId);
    if (folder.role) throw new BackendError("invalid_input", "System folders stay.");
    if (this.folders.some((other) => other.parentId === folderId)) {
      throw new BackendError("invalid_input", "This folder still holds folders.");
    }
    if (folder.accountId !== this.accountId) {
      // Somebody else's folder: its mail can't go to this account's trash, so it has to be empty.
      this.allowed([folderId], "mayDelete");
      const { id } = unscopeId(folderId, this.accountId);
      throwOnMailboxError(
        await one<SetResponse>("Mailbox/set", {
          accountId: folder.accountId,
          destroy: [id],
          onDestroyRemoveEmails: false,
        }),
      );
      await this.loadFolders();
      this.emit({ type: "mail:changed", accountId: folder.accountId });
      return;
    }
    const trash = this.folderOrFail("trash");
    // Page by page: whatever moved has left the folder, so the next page starts at 0 again.
    for (let round = 0; round < 200; round += 1) {
      const found = await one<QueryResponse>("Email/query", {
        filter: { inMailbox: folderId },
        limit: 500,
        calculateTotal: false,
      });
      if (found.ids.length === 0) break;
      const patch = { [`mailboxIds/${folderId}`]: null, [`mailboxIds/${trash.id}`]: true };
      throwOnError(
        await one<SetResponse>("Email/set", { update: Object.fromEntries(found.ids.map((id) => [id, patch])) }),
      );
    }
    throwOnMailboxError(await one<SetResponse>("Mailbox/set", { destroy: [folderId], onDestroyRemoveEmails: false }));
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
  }

  /** The portal's own call, which deletes on the server in one go instead of message by message. */
  async emptyFolder(folderId: string): Promise<number> {
    await this.start();
    const role = this.folderMap.get(folderId)?.role;
    if (role !== "trash" && role !== "junk") throw new BackendError("invalid_input", "Only trash and junk empty.");
    const { api } = await import("../server");
    const result = await api<{ removed: number }>(`/api/account/mailboxes/${role}/empty`, { method: "POST" });
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
    return result.removed;
  }

  private filterFor(query: ThreadQuery): Record<string, unknown> {
    const conditions: Record<string, unknown>[] = [];
    const view = query.view;
    if (view.kind === "folder") {
      conditions.push({ inMailbox: unscopeId(view.folderId, this.accountId).id });
    } else {
      const role = view.role === "unread" || view.role === "flagged" ? "inbox" : view.role;
      const folder = this.folderWithRole(role);
      if (folder) conditions.push({ inMailbox: folder.id });
      if (view.role === "unread") conditions.push({ notKeyword: "$seen" });
      if (view.role === "flagged") conditions.push({ hasKeyword: "$flagged" });
    }
    if (query.filter === "unread") conditions.push({ notKeyword: "$seen" });
    if (query.filter === "flagged") conditions.push({ hasKeyword: "$flagged" });
    if (query.filter === "attachments") conditions.push({ hasAttachment: true });
    if (query.search?.trim()) conditions.push({ text: query.search.trim() });
    // Trash and junk stay out of every view but their own.
    const view_is_folder = view.kind === "folder";
    if (!view_is_folder) {
      for (const role of ["trash", "junk"] as const) {
        const folder = this.folderWithRole(role);
        if (folder) conditions.push({ operator: "NOT", conditions: [{ inMailbox: folder.id }] });
      }
    }
    if (conditions.length === 0) return {};
    if (conditions.length === 1) return conditions[0]!;
    return { operator: "AND", conditions };
  }

  async listThreads(query: ThreadQuery): Promise<ThreadPage> {
    await this.start();
    const position = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;
    const filter = this.filterFor(query);
    const collapse = query.conversations;
    const own = this.accountId;
    // A shared folder is asked for in its owner's account; everything else is the own mail.
    const accountId = query.view.kind === "folder" ? unscopeId(query.view.folderId, own).accountId : own;

    const calls: [string, Record<string, unknown>, string][] = [
      [
        "Email/query",
        {
          accountId,
          filter,
          sort: [{ property: "receivedAt", isAscending: false }],
          collapseThreads: collapse,
          position,
          limit: query.limit,
          calculateTotal: false,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: LIST_PROPERTIES,
        },
        "e",
      ],
    ];
    if (collapse) {
      calls.push([
        "Thread/get",
        {
          accountId,
          "#ids": { resultOf: "e", name: "Email/get", path: "/list/*/threadId" },
        },
        "t",
      ]);
      calls.push([
        "Email/get",
        {
          accountId,
          "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" },
          properties: LIST_PROPERTIES,
        },
        "m",
      ]);
    }

    const body = await call(calls);
    const found = responseOf<QueryResponse>(body, "q");
    const scope = (email: JmapEmail) => scopeEmail(email, accountId, own);
    const heads = responseOf<GetResponse<JmapEmail>>(body, "e").list.map(scope);

    let threads: ThreadSummary[];
    if (collapse) {
      const threadList = responseOf<GetResponse<JmapThread>>(body, "t").list.map((thread) => ({
        id: scopeId(accountId, thread.id, own),
        emailIds: thread.emailIds.map((id) => scopeId(accountId, id, own)),
      }));
      const members = responseOf<GetResponse<JmapEmail>>(body, "m").list.map(scope);
      const byId = new Map(members.map((email) => [email.id, email]));
      const byThread = new Map(threadList.map((thread) => [thread.id, thread]));
      threads = heads.map((head) => {
        const thread = byThread.get(head.threadId);
        const emails = (thread?.emailIds ?? [head.id]).map((id) => byId.get(id)).filter((e): e is JmapEmail => !!e);
        return toThreadSummary(head.threadId, emails.length > 0 ? emails : [head], accountId);
      });
    } else {
      threads = heads.map((email) => toThreadSummary(`${SINGLE}${email.id}`, [email], accountId));
    }

    const next = position + found.ids.length;
    return {
      threads,
      ...(found.ids.length === query.limit ? { nextCursor: String(next) } : {}),
    };
  }

  async getThread(threadId: string, conversations: boolean): Promise<ThreadDetail> {
    await this.start();
    const own = this.accountId;
    const properties = this.messageProperties();
    const single = threadId.startsWith(SINGLE);
    const target = unscopeId(single ? threadId.slice(SINGLE.length) : threadId, own);
    const accountId = target.accountId;

    const calls: [string, Record<string, unknown>, string][] = single
      ? [["Email/get", { accountId, ids: [target.id], properties, fetchAllBodyValues: true }, "e"]]
      : [
          ["Thread/get", { accountId, ids: [target.id] }, "t"],
          [
            "Email/get",
            {
              accountId,
              "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" },
              properties,
              fetchAllBodyValues: true,
            },
            "e",
          ],
        ];
    const body = await call(calls, supports(WEBMAIL) ? [CORE, MAIL, WEBMAIL] : [CORE, MAIL]);
    let emails = responseOf<GetResponse<JmapEmail>>(body, "e").list.map((email) => scopeEmail(email, accountId, own));
    if (emails.length === 0) throw new BackendError("not_found", "That mail is gone.");
    if (!conversations && !single) {
      const newest = [...emails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]!;
      emails = [newest];
    }
    const messages = emails
      .map((email) => toMessage(email, accountId, this.folderMap))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      thread: toThreadSummary(threadId, emails, accountId),
      messages,
    };
  }

  async setFlags(messageIds: string[], change: FlagChange): Promise<void> {
    await this.start();
    const patch: Record<string, unknown> = {};
    if (change.seen !== undefined) patch["keywords/$seen"] = change.seen ? true : null;
    if (change.flagged !== undefined) patch["keywords/$flagged"] = change.flagged ? true : null;
    if (Object.keys(patch).length === 0) return;
    const groups = groupByAccount(messageIds, this.accountId);
    for (const [accountId, ids] of groups) {
      const update = Object.fromEntries(ids.map((id) => [id, patch]));
      const response = await one<SetResponse>("Email/set", { accountId, update });
      if (Object.values(response.notUpdated ?? {}).some((problem) => problem.type === "forbidden")) {
        throw new BackendError("forbidden", "The owner of this folder didn't allow that.");
      }
      throwOnError(response);
      this.emit({ type: "mail:changed", accountId });
    }
  }

  /**
   * Moves mail into one folder and reports where each message came from. Mail stays in its own
   * account: somebody else's folder only takes mail from their own mailbox.
   */
  private async moveTo(
    messageIds: string[],
    targetId: string,
    keywords?: Record<string, unknown>,
  ): Promise<MovedMessage[]> {
    await this.start();
    const own = this.accountId;
    const target = unscopeId(targetId, own);
    const groups = groupByAccount(messageIds, own);
    if ([...groups.keys()].some((accountId) => accountId !== target.accountId)) {
      throw new BackendError("invalid_input", "Mail can only move to folders of its own mailbox.");
    }
    const accountId = target.accountId;
    const current = await one<GetResponse<JmapEmail>>("Email/get", {
      accountId,
      ids: groups.get(accountId) ?? [],
      properties: ["id", "mailboxIds", "keywords"],
    });
    const update: Record<string, Record<string, unknown>> = {};
    const moved: MovedMessage[] = [];
    for (const email of current.list) {
      const from = Object.keys(email.mailboxIds).filter((id) => email.mailboxIds[id]);
      if (from.includes(target.id) && from.length === 1) continue;
      if (accountId !== own) {
        this.allowed([targetId], "mayAddItems");
        this.allowed(
          from.map((id) => scopeId(accountId, id, own)),
          "mayRemoveItems",
        );
      }
      update[email.id] = { mailboxIds: { [target.id]: true }, ...(keywords ?? {}) };
      const fromFolderId = from.find((id) => id !== target.id) ?? from[0] ?? "";
      moved.push({ id: scopeId(accountId, email.id, own), fromFolderId: scopeId(accountId, fromFolderId, own) });
    }
    if (moved.length === 0) return [];
    const response = await one<SetResponse>("Email/set", { accountId, update });
    if (Object.values(response.notUpdated ?? {}).some((problem) => problem.type === "forbidden")) {
      throw new BackendError("forbidden", "The owner of this folder didn't allow that.");
    }
    throwOnError(response);
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId });
    return moved;
  }

  /** Archive, trash and junk are the account's own: mail somebody shares can't go there. */
  private ownOnly(messageIds: string[]): void {
    if ([...groupByAccount(messageIds, this.accountId).keys()].some((id) => id !== this.accountId)) {
      throw new BackendError("forbidden", "Mail in a shared folder stays in its owner's folders.");
    }
  }

  private folderOrFail(role: Exclude<Folder["role"], null>): Folder {
    const folder = this.folderWithRole(role);
    if (!folder) throw new BackendError("not_found", `This mailbox has no ${role} folder.`);
    return folder;
  }

  async archive(messageIds: string[]): Promise<MovedMessage[]> {
    await this.start();
    this.ownOnly(messageIds);
    return this.moveTo(messageIds, this.folderOrFail("archive").id);
  }

  async trash(messageIds: string[]): Promise<MovedMessage[]> {
    await this.start();
    this.ownOnly(messageIds);
    return this.moveTo(messageIds, this.folderOrFail("trash").id);
  }

  async moveMessages(messageIds: string[], folderId: string): Promise<MovedMessage[]> {
    return this.moveTo(messageIds, folderId);
  }

  async markSpam(messageIds: string[], spam: boolean): Promise<MovedMessage[]> {
    await this.start();
    this.ownOnly(messageIds);
    const target = spam ? this.folderOrFail("junk") : this.folderOrFail("inbox");
    // The keywords teach the server's filter; the move alone would not.
    const keywords = spam
      ? { "keywords/$junk": true, "keywords/$notjunk": null }
      : { "keywords/$junk": null, "keywords/$notjunk": true };
    return this.moveTo(messageIds, target.id, keywords);
  }

  /**
   * Deletes mail for good: the own account's only from its trash, so deleting twice can never take
   * mail elsewhere; a shared folder has no trash of this account, so its mail goes straight away
   * where the owner allows removing it.
   */
  async deleteForever(messageIds: string[]): Promise<number> {
    await this.start();
    const own = this.accountId;
    let count = 0;
    for (const [accountId, ids] of groupByAccount(messageIds, own)) {
      let destroy = ids;
      if (accountId === own) {
        const trash = this.folderOrFail("trash");
        const current = await one<GetResponse<JmapEmail>>("Email/get", { ids, properties: ["id", "mailboxIds"] });
        destroy = current.list.filter((email) => email.mailboxIds[trash.id] === true).map((email) => email.id);
      } else {
        const current = await one<GetResponse<JmapEmail>>("Email/get", {
          accountId,
          ids,
          properties: ["id", "mailboxIds"],
        });
        const folders = current.list.flatMap((email) =>
          Object.keys(email.mailboxIds).map((id) => scopeId(accountId, id, own)),
        );
        this.allowed(folders, "mayRemoveItems");
      }
      if (destroy.length === 0) continue;
      const response = await one<SetResponse>("Email/set", { accountId, destroy });
      if (Object.values(response.notDestroyed ?? {}).some((problem) => problem.type === "forbidden")) {
        throw new BackendError("forbidden", "The owner of this folder didn't allow that.");
      }
      count += response.destroyed?.length ?? 0;
      this.emit({ type: "mail:changed", accountId });
    }
    await this.loadFolders();
    return count;
  }

  async blockedSenders(): Promise<BlockedSender[]> {
    await this.start();
    if (!supports(SENDERS)) return [];
    const response = await one<GetResponse<JmapSenderEntry>>("SenderList/get", { ids: null }, [CORE, SENDERS]);
    return response.list
      .filter((entry) => entry.action === "block")
      .map((entry) => ({ entry: entry.value, accountId: this.accountId, serverId: entry.id }));
  }

  async blockSender(entry: string): Promise<BlockedSender> {
    await this.start();
    if (!supports(SENDERS)) throw new BackendError("not_supported", "This server can't block senders.");
    const response = await one<SetResponse>("SenderList/set", { create: { new: { value: entry, action: "block" } } }, [
      CORE,
      SENDERS,
    ]);
    throwOnError(response);
    const created = response.created?.new;
    return { entry, accountId: this.accountId, serverId: created?.id ?? null };
  }

  async unblockSender(sender: BlockedSender): Promise<void> {
    await this.start();
    if (!sender.serverId) return;
    throwOnError(await one<SetResponse>("SenderList/set", { destroy: [sender.serverId] }, [CORE, SENDERS]));
  }

  /**
   * Unsubscribing from a newsletter.
   *
   * The app can also do the one-click POST (RFC 8058) itself, because its engine may talk to
   * other servers. A page in a browser may not, and having the server do it would mean letting a
   * mail header decide where the server sends requests — so the mail way is taken where there is
   * one, and otherwise the browser opens the sender's page.
   */
  async unsubscribe(messageId: string): Promise<UnsubscribeOutcome> {
    await this.start();
    const target = unscopeId(messageId, this.accountId);
    const response = await one<GetResponse<JmapEmail>>("Email/get", {
      accountId: target.accountId,
      ids: [target.id],
      properties: ["id", "to", "subject", "header:List-Unsubscribe:asURLs", "header:List-Unsubscribe-Post:asText"],
    });
    const email = response.list[0];
    if (!email) throw new BackendError("not_found", "That mail is gone.");
    const options = toUnsubscribe(email);
    if (!options) throw new BackendError("not_supported", "This mail says nothing about unsubscribing.");

    if (options.mailto) {
      const target = unsubscribeMail(options.mailto);
      if (!target) throw new BackendError("invalid_input", "That unsubscribe address makes no sense.");
      const identities = await this.listIdentities();
      // From the address the newsletter went to, where that is one of ours.
      const wentTo = (email.to ?? []).map((entry) => entry.email.toLowerCase());
      const from =
        identities.find((identity) => wentTo.includes(identity.email.toLowerCase())) ??
        identities.find((identity) => identity.primary);
      await this.send({
        accountId: this.accountId,
        to: [{ email: target.address }],
        cc: [],
        bcc: [],
        subject: target.subject,
        text: "unsubscribe",
        html: "",
        attachments: [],
        ...(from ? { fromEmail: from.email } : {}),
      });
      return { kind: "done" };
    }
    if (options.url) return { kind: "openPage", url: options.url };
    throw new BackendError("not_supported", "This mail says nothing about unsubscribing.");
  }

  async inboxMessagesFrom(email: string): Promise<string[]> {
    await this.start();
    const inbox = this.folderWithRole("inbox");
    if (!inbox) return [];
    const response = await one<QueryResponse>("Email/query", {
      filter: { operator: "AND", conditions: [{ inMailbox: inbox.id }, { from: email }] },
      sort: [{ property: "receivedAt", isAscending: false }],
      limit: 200,
      calculateTotal: false,
    });
    return response.ids;
  }

  /** The JMAP object for a message we are about to save or send. */
  private async buildEmail(
    message: OutgoingMessage,
    mailboxId: string,
    draft: boolean,
  ): Promise<Record<string, unknown>> {
    const identities = await this.listIdentities();
    const from = message.fromEmail
      ? identities.find((identity) => identity.email.toLowerCase() === message.fromEmail?.toLowerCase())
      : identities.find((identity) => identity.primary);
    if (!from) throw new BackendError("invalid_input", "That sender address isn't set up for this mailbox.");

    const attachments: Record<string, unknown>[] = [];
    for (const attachment of message.attachments) {
      const bytes = Uint8Array.from(atob(attachment.source.data), (char) => char.charCodeAt(0));
      const uploaded = await uploadBlob(new Blob([bytes], { type: attachment.mimeType }), attachment.mimeType);
      attachments.push({
        blobId: uploaded.blobId,
        name: attachment.filename,
        type: attachment.mimeType,
        disposition: "attachment",
      });
    }

    const object: Record<string, unknown> = {
      mailboxIds: { [mailboxId]: true },
      keywords: draft ? { $draft: true, $seen: true } : { $seen: true },
      from: [{ name: from.name || null, email: from.email }],
      to: message.to.map((address) => ({ name: address.name ?? null, email: address.email })),
      cc: message.cc.map((address) => ({ name: address.name ?? null, email: address.email })),
      bcc: message.bcc.map((address) => ({ name: address.name ?? null, email: address.email })),
      subject: message.subject,
      bodyValues: {
        text: { value: message.text },
        html: { value: message.html },
      },
      textBody: [{ partId: "text", type: "text/plain" }],
      htmlBody: [{ partId: "html", type: "text/html" }],
      ...(attachments.length > 0 ? { attachments } : {}),
    };
    // The draft key is the message id, so every version of one draft replaces the last.
    if (message.draftKey) object.messageId = [message.draftKey];
    if (message.inReplyTo) {
      // The answered mail may lie in a folder somebody shares; the answer is this account's own.
      const answered = unscopeId(message.inReplyTo, this.accountId);
      const original = await one<GetResponse<JmapEmail>>("Email/get", {
        accountId: answered.accountId,
        ids: [answered.id],
        properties: ["messageId", "references"],
      });
      const parent = original.list[0];
      const parentId = parent?.messageId?.[0];
      if (parentId) {
        object.inReplyTo = [parentId];
        object.references = [...(parent?.references ?? []), parentId];
      }
    }
    return object;
  }

  private identityIdFor(email: string | undefined, identities: Identity[]): string {
    const found = email
      ? identities.find((identity) => identity.email.toLowerCase() === email.toLowerCase())
      : identities.find((identity) => identity.primary);
    if (!found) throw new BackendError("invalid_input", "That sender address isn't set up for this mailbox.");
    return found.id;
  }

  /**
   * Stores the mail and submits it in one request. The server holds the submission back for the
   * person's undo window (or until `options.sendAt`) and moves the mail to Sent right away; the
   * receipt says until when it can still be taken back with `cancelSend`.
   */
  async send(message: OutgoingMessage, options: SendOptions = {}): Promise<SendReceipt> {
    await this.start();
    const drafts = this.folderOrFail("drafts");
    const sent = this.folderOrFail("sent");
    const identities = await this.listIdentities();
    const email = await this.buildEmail(message, drafts.id, true);
    const envelope = {
      mailFrom: { email: message.fromEmail ?? identities.find((i) => i.primary)?.email ?? "" },
      rcptTo: [...message.to, ...message.cc, ...message.bcc].map((address) => ({ email: address.email })),
    };
    if (envelope.rcptTo.length === 0) throw new BackendError("invalid_input", "There is nobody to send this to.");
    const later = options.sendAt ? { sendAt: submissionSendAt(options.sendAt) } : {};
    if (later.sendAt && (await this.maxSendDelay()) === 0) {
      throw new BackendError("not_supported", "This server can't send mail later.");
    }

    const body = await call(
      [
        ["Email/set", { accountId: this.accountId, create: { draft: email } }, "e"],
        [
          "EmailSubmission/set",
          {
            accountId: this.accountId,
            create: {
              send: {
                emailId: "#draft",
                identityId: this.identityIdFor(message.fromEmail, identities),
                envelope,
                ...later,
              },
            },
            onSuccessUpdateEmail: {
              "#send": {
                [`mailboxIds/${drafts.id}`]: null,
                [`mailboxIds/${sent.id}`]: true,
                "keywords/$draft": null,
              },
            },
          },
          "s",
        ],
      ],
      [CORE, MAIL, SUBMISSION],
    );
    throwOnError(responseOf<SetResponse>(body, "e"));
    const submitted = responseOf<SetResponse>(body, "s");
    throwOnError(submitted);
    const created = submitted.created?.send as JmapCreatedSubmission | undefined;
    if (!created) throw new BackendError("internal", "The server didn't take the mail.");
    // An earlier version of this draft, from another device or a previous save.
    if (message.draftKey) await this.destroyDrafts(message.draftKey, drafts.id);
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
    const receipt = submissionReceipt(created);
    if (receipt.pending) this.emit({ type: "scheduled:changed" });
    return receipt;
  }

  /**
   * Stops a held-back mail. The server already moved it to Sent when it took it, so it goes back
   * into Drafts here, as a draft again, and comes back for the composer.
   */
  async cancelSend(submissionId: string): Promise<DraftContent> {
    await this.start();
    const drafts = this.folderOrFail("drafts");
    const body = await call(
      [
        ["EmailSubmission/get", { accountId: this.accountId, ids: [submissionId], properties: ["id", "emailId"] }, "g"],
        [
          "EmailSubmission/set",
          { accountId: this.accountId, update: { [submissionId]: { undoStatus: "canceled" } } },
          "c",
        ],
      ],
      [CORE, MAIL, SUBMISSION],
    );
    const cancelled = responseOf<SetResponse>(body, "c");
    const problem = cancelled.notUpdated?.[submissionId];
    if (problem?.type === "cannotUnsend") throw new BackendError("too_late", "This mail is already on its way.");
    if (problem?.type === "notFound") throw new BackendError("too_late", "This mail is already on its way.");
    throwOnError(cancelled);
    const emailId = responseOf<GetResponse<JmapSubmission>>(body, "g").list[0]?.emailId;
    if (!emailId) throw new BackendError("not_found", "The mail is gone.");
    throwOnError(
      await one<SetResponse>("Email/set", {
        update: { [emailId]: { mailboxIds: { [drafts.id]: true }, "keywords/$draft": true, "keywords/$seen": true } },
      }),
    );
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
    this.emit({ type: "scheduled:changed" });
    return this.openDraft(emailId);
  }

  async scheduledSends(): Promise<ScheduledSend[]> {
    await this.start();
    if ((await this.maxSendDelay()) === 0) return [];
    const accountId = this.accountId;
    const body = await call(
      [
        ["EmailSubmission/query", { accountId, filter: { undoStatus: "pending" } }, "q"],
        [
          "EmailSubmission/get",
          {
            accountId,
            "#ids": { resultOf: "q", name: "EmailSubmission/query", path: "/ids" },
            properties: ["id", "emailId", "sendAt", "undoStatus", "envelope"],
          },
          "g",
        ],
        [
          "Email/get",
          {
            accountId,
            "#ids": { resultOf: "g", name: "EmailSubmission/get", path: "/list/*/emailId" },
            properties: ["id", "subject", "to"],
          },
          "e",
        ],
      ],
      [CORE, MAIL, SUBMISSION],
    );
    return scheduledFrom(
      responseOf<GetResponse<JmapSubmission>>(body, "g").list,
      responseOf<GetResponse<JmapEmail>>(body, "e").list,
    );
  }

  async maxSendDelay(): Promise<number> {
    await this.start();
    return maxDelayOf(accountCapability(SUBMISSION));
  }

  /** Every draft carrying this key, newest first. */
  private async draftsWithKey(draftKey: string, draftsId: string): Promise<JmapEmail[]> {
    const body = await call([
      [
        "Email/query",
        {
          accountId: this.accountId,
          filter: { operator: "AND", conditions: [{ inMailbox: draftsId }, { hasKeyword: "$draft" }] },
          sort: [{ property: "receivedAt", isAscending: false }],
          limit: 50,
          calculateTotal: false,
        },
        "q",
      ],
      [
        "Email/get",
        {
          accountId: this.accountId,
          "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
          properties: ["id", "messageId", "receivedAt"],
        },
        "e",
      ],
    ]);
    // Servers don't filter by this header reliably, so the comparison happens here.
    const wanted = bareMessageId(draftKey);
    return responseOf<GetResponse<JmapEmail>>(body, "e").list.filter(
      (email) => bareMessageId(email.messageId?.[0]) === wanted,
    );
  }

  private async destroyDrafts(draftKey: string, draftsId: string, keep?: string): Promise<void> {
    const found = await this.draftsWithKey(draftKey, draftsId);
    const destroy = found.map((email) => email.id).filter((id) => id !== keep);
    if (destroy.length > 0) await one<SetResponse>("Email/set", { destroy });
  }

  async saveDraft(draft: OutgoingMessage): Promise<DraftSaveResult> {
    const saved = await this.storeDraft(draft);
    return { draftKey: saved.draftKey, savedAt: new Date().toISOString() };
  }

  /** Writes the newest version of a draft and removes every older one with the same key. */
  private async storeDraft(draft: OutgoingMessage): Promise<{ draftKey: string; emailId: string }> {
    await this.start();
    const drafts = this.folderOrFail("drafts");
    const key = draft.draftKey ?? `uwu-${crypto.randomUUID()}@webmail.local`;
    const email = await this.buildEmail({ ...draft, draftKey: key }, drafts.id, true);
    const response = await one<SetResponse>("Email/set", { create: { draft: email } });
    throwOnError(response);
    const created = response.created?.draft;
    if (!created) throw new BackendError("internal", "The server didn't keep the draft.");
    await this.destroyDrafts(key, drafts.id, created.id);
    this.emit({ type: "mail:changed", accountId: this.accountId });
    return { draftKey: key, emailId: created.id };
  }

  async deleteDraft(_accountId: string, draftKey: string): Promise<void> {
    await this.start();
    const drafts = this.folderWithRole("drafts");
    if (!drafts) return;
    await this.destroyDrafts(draftKey, drafts.id);
    this.emit({ type: "mail:changed", accountId: this.accountId });
  }

  async openDraft(messageId: string): Promise<DraftContent> {
    await this.start();
    const response = await one<GetResponse<JmapEmail>>(
      "Email/get",
      { ids: [messageId], properties: this.messageProperties(), fetchAllBodyValues: true },
      supports(WEBMAIL) ? [CORE, MAIL, WEBMAIL] : [CORE, MAIL],
    );
    const email = response.list[0];
    if (!email) throw new BackendError("not_found", "That draft is gone.");
    const message = toMessage(email, this.accountId, this.folderMap);
    const attachments = [];
    for (const attachment of message.attachments.filter((part) => !part.inline)) {
      const blob = await this.attachmentBlob(attachment.id, attachment.filename);
      attachments.push({
        filename: attachment.filename,
        mimeType: attachment.mimeType,
        size: attachment.size,
        source: { kind: "base64" as const, data: await blobToBase64(blob) },
      });
    }
    return {
      accountId: this.accountId,
      fromEmail: message.from.email || null,
      draftKey: email.messageId?.[0] ?? null,
      to: message.to,
      cc: message.cc,
      // Bcc recipients saved with the draft come back too, so continuing a draft does not silently
      // send without them (security-audit W-10).
      bcc: toAddresses(email.bcc),
      subject: message.subject,
      // A draft without HTML is plain text, and plain text is not markup: the reader escapes it
      // the same way before it shows it.
      html: message.bodyHtml ?? (message.bodyText ? textToHtml(message.bodyText) : ""),
      // Sending looks the answered mail up again, so a reopened reply keeps its threading.
      inReplyTo: await this.answeredMailOf(email),
      attachments,
    };
  }

  /** The mail a saved draft answers, looked up in the draft's conversation. */
  private async answeredMailOf(draft: JmapEmail): Promise<string | null> {
    if (!draft.inReplyTo?.length || !draft.threadId) return null;
    try {
      const body = await call([
        ["Thread/get", { accountId: this.accountId, ids: [draft.threadId] }, "t"],
        [
          "Email/get",
          {
            accountId: this.accountId,
            "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" },
            properties: ["id", "messageId"],
          },
          "e",
        ],
      ]);
      return answeredMail(draft, responseOf<GetResponse<JmapEmail>>(body, "e").list);
    } catch {
      // The draft itself is there; it only goes on as a new mail, as it did before.
      return null;
    }
  }

  async calendarsAvailable(): Promise<boolean> {
    await this.start();
    return supports(CALENDARS);
  }

  private calendarCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return one<T>(name, args, [CORE, CALENDARS]);
  }

  async calendars(): Promise<CalendarInfo[]> {
    await this.start();
    const response = await this.calendarCall<GetResponse<JmapCalendar>>("Calendar/get", {
      ids: null,
      properties: CALENDAR_PROPERTIES,
    });
    return response.list
      .map((calendar) => toCalendarInfo(calendar, this.accountId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async createCalendar(input: { name: string; color: string | null }): Promise<CalendarInfo> {
    await this.start();
    const response = await this.calendarCall<SetResponse>("Calendar/set", {
      create: { new: { name: input.name, color: input.color, isVisible: true } },
    });
    throwOnError(response);
    const id = response.created?.new?.id;
    if (!id) throw new BackendError("internal", "The server didn't create the calendar.");
    this.emit({ type: "calendar:changed" });
    const created = (await this.calendars()).find((calendar) => calendar.id === id);
    return (
      created ?? {
        id,
        accountId: this.accountId,
        name: input.name,
        color: input.color,
        isDefault: false,
        isVisible: true,
        sortOrder: 0,
        mayWrite: true,
        mayDelete: true,
      }
    );
  }

  async updateCalendar(id: string, patch: { name?: string; color?: string | null; isVisible?: boolean }) {
    await this.start();
    throwOnError(await this.calendarCall<SetResponse>("Calendar/set", { update: { [id]: patch } }));
    this.emit({ type: "calendar:changed" });
  }

  async deleteCalendar(id: string): Promise<void> {
    await this.start();
    throwOnError(await this.calendarCall<SetResponse>("Calendar/set", { destroy: [id], onDestroyRemoveEvents: true }));
    this.emit({ type: "calendar:changed" });
  }

  async setDefaultCalendar(id: string): Promise<void> {
    await this.start();
    throwOnError(
      await this.calendarCall<SetResponse>("Calendar/set", { update: { [id]: {} }, onSuccessSetIsDefault: id }),
    );
    this.emit({ type: "calendar:changed" });
  }

  /**
   * One request for the calendars, the expanded query and its occurrences, and a second one for
   * the rules of the series among them, which expanded instances don't carry.
   */
  async calendarEvents(from: string, to: string, timeZone: string): Promise<CalendarOccurrence[]> {
    await this.start();
    const accountId = this.accountId;
    const body = await call(
      [
        ["Calendar/get", { accountId, ids: null, properties: CALENDAR_PROPERTIES }, "c"],
        [
          "CalendarEvent/query",
          {
            accountId,
            filter: { after: from, before: to },
            sort: [{ property: "start", isAscending: true }],
            expandRecurrences: true,
            timeZone,
            limit: 5000,
          },
          "q",
        ],
        [
          "CalendarEvent/get",
          {
            accountId,
            "#ids": { resultOf: "q", name: "CalendarEvent/query", path: "/ids" },
            properties: EVENT_PROPERTIES,
            timeZone,
          },
          "e",
        ],
      ],
      [CORE, CALENDARS],
    );
    const calendars = new Map(
      responseOf<GetResponse<JmapCalendar>>(body, "c").list.map((calendar) => [
        calendar.id,
        toCalendarInfo(calendar, accountId),
      ]),
    );
    const events = responseOf<GetResponse<JmapCalendarEvent>>(body, "e").list;
    const baseIds = [...new Set(events.map((event) => event.baseEventId).filter((id): id is string => !!id))];
    const bases = new Map<string, JmapCalendarEvent>();
    if (baseIds.length > 0) {
      const found = await this.calendarCall<GetResponse<JmapCalendarEvent>>("CalendarEvent/get", {
        ids: baseIds,
        properties: RULE_PROPERTIES,
      });
      for (const base of found.list) bases.set(base.id, base);
    }
    return events.map((event) =>
      toOccurrence(event, {
        accountId,
        viewerZone: timeZone,
        calendar: calendars.get(Object.keys(event.calendarIds)[0] ?? ""),
        base: event.baseEventId ? bases.get(event.baseEventId) : undefined,
      }),
    );
  }

  async createEvent(input: EventInput): Promise<string> {
    await this.start();
    const response = await this.calendarCall<SetResponse>("CalendarEvent/set", {
      create: { new: newEventObject(input, deviceTimeZone()) },
    });
    throwOnError(response);
    const id = response.created?.new?.id;
    if (!id) throw new BackendError("internal", "The server didn't keep the event.");
    this.emit({ type: "calendar:changed" });
    return id;
  }

  async updateEvent(eventId: string, input: EventInput, occurrenceStart?: string): Promise<void> {
    await this.start();
    const found = await this.calendarCall<GetResponse<JmapCalendarEvent>>("CalendarEvent/get", {
      ids: [eventId],
      properties: EDIT_PROPERTIES,
    });
    const current = found.list[0];
    if (!current) throw new BackendError("not_found", "That event is gone.");
    const patch = eventPatch(current, input, deviceTimeZone(), occurrenceStart);
    if (Object.keys(patch).length === 0) return;
    throwOnError(await this.calendarCall<SetResponse>("CalendarEvent/set", { update: { [eventId]: patch } }));
    this.emit({ type: "calendar:changed" });
  }

  /** An instance of a series goes by its own (synthetic) id: the server records the exception. */
  async deleteEvent(occurrenceId: string, scope: EventDeleteScope): Promise<void> {
    await this.start();
    let target = occurrenceId;
    if (scope === "series") {
      const found = await this.calendarCall<GetResponse<JmapCalendarEvent>>("CalendarEvent/get", {
        ids: [occurrenceId],
        properties: ["id", "baseEventId"],
      });
      target = found.list[0]?.baseEventId ?? occurrenceId;
    }
    throwOnError(await this.calendarCall<SetResponse>("CalendarEvent/set", { destroy: [target] }));
    this.emit({ type: "calendar:changed" });
  }

  async mailRulesAvailable(): Promise<boolean> {
    await this.start();
    return supports(SIEVE);
  }

  private async rulesScript(): Promise<JmapSieveScript | null> {
    const response = await one<GetResponse<JmapSieveScript>>("SieveScript/get", { ids: null }, [CORE, SIEVE]);
    return response.list.find((script) => script.name === RULES_SCRIPT) ?? null;
  }

  async mailRules(): Promise<{ script: string | null; active: boolean }> {
    await this.start();
    if (!supports(SIEVE)) throw new BackendError("not_supported", "This server has no mail rules.");
    const found = await this.rulesScript();
    if (!found) return { script: null, active: false };
    const blob = await downloadBlob(found.blobId, `${RULES_SCRIPT}.sieve`);
    return { script: await blob.text(), active: found.isActive };
  }

  private async uploadScript(script: string): Promise<string> {
    const uploaded = await uploadBlob(new Blob([script], { type: SIEVE_TYPE }), SIEVE_TYPE);
    return uploaded.blobId;
  }

  async validateMailRules(script: string): Promise<string | null> {
    await this.start();
    const blobId = await this.uploadScript(script);
    const response = await one<{ error: { type: string; description?: string } | null }>(
      "SieveScript/validate",
      { blobId },
      [CORE, SIEVE],
    );
    return response.error ? (response.error.description ?? response.error.type) : null;
  }

  async saveMailRules(script: string): Promise<void> {
    await this.start();
    const blobId = await this.uploadScript(script);
    const existing = await this.rulesScript();
    const response = await one<SetResponse>(
      "SieveScript/set",
      existing
        ? { update: { [existing.id]: { blobId } }, onSuccessActivateScript: existing.id }
        : { create: { rules: { name: RULES_SCRIPT, blobId } }, onSuccessActivateScript: "#rules" },
      [CORE, SIEVE],
    );
    const problem = Object.values(response.notCreated ?? {})[0] ?? Object.values(response.notUpdated ?? {})[0] ?? null;
    if (problem) {
      throw new BackendError(
        problem.type === "invalidSieve" || problem.type === "tooLarge" ? "invalid_input" : "internal",
        problem.description ?? problem.type,
      );
    }
  }

  async contactsAvailable(): Promise<boolean> {
    await this.start();
    return supports(CONTACTS);
  }

  private contactCall<T>(name: string, args: Record<string, unknown>): Promise<T> {
    return one<T>(name, args, [CORE, CONTACTS]);
  }

  async addressBooks(): Promise<AddressBookInfo[]> {
    await this.start();
    const response = await this.contactCall<GetResponse<JmapAddressBook>>("AddressBook/get", { ids: null });
    return response.list
      .map((book) => toAddressBookInfo(book, this.accountId))
      .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }

  async createAddressBook(name: string): Promise<AddressBookInfo> {
    await this.start();
    const response = await this.contactCall<SetResponse>("AddressBook/set", { create: { new: { name } } });
    throwOnError(response);
    const id = response.created?.new?.id;
    if (!id) throw new BackendError("internal", "The server didn't create the address book.");
    this.emit({ type: "contacts:changed" });
    return { id, accountId: this.accountId, name, isDefault: false, sortOrder: 0, mayDelete: true };
  }

  async renameAddressBook(id: string, name: string): Promise<void> {
    await this.start();
    throwOnError(await this.contactCall<SetResponse>("AddressBook/set", { update: { [id]: { name } } }));
    this.emit({ type: "contacts:changed" });
  }

  async deleteAddressBook(id: string): Promise<void> {
    await this.start();
    throwOnError(
      await this.contactCall<SetResponse>("AddressBook/set", { destroy: [id], onDestroyRemoveContents: true }),
    );
    this.emit({ type: "contacts:changed" });
  }

  async setDefaultAddressBook(id: string): Promise<void> {
    await this.start();
    throwOnError(
      await this.contactCall<SetResponse>("AddressBook/set", { update: { [id]: {} }, onSuccessSetIsDefault: id }),
    );
    this.emit({ type: "contacts:changed" });
  }

  /** The ids first, then the cards in pages the server takes, all in one more request. */
  async contacts(): Promise<ContactRecord[]> {
    await this.start();
    const query = await this.contactCall<{ ids: string[] }>("ContactCard/query", {});
    if (query.ids.length === 0) return [];
    const pages: string[][] = [];
    for (let start = 0; start < query.ids.length; start += CARDS_PER_GET) {
      pages.push(query.ids.slice(start, start + CARDS_PER_GET));
    }
    const body = await call(
      pages.map((ids, index) => [
        "ContactCard/get",
        { accountId: this.accountId, ids, properties: CARD_PROPERTIES },
        `p${index}`,
      ]),
      [CORE, CONTACTS],
    );
    return pages.flatMap((_, index) =>
      responseOf<GetResponse<JmapCard>>(body, `p${index}`).list.map((card) => toContactRecord(card, this.accountId)),
    );
  }

  async createContact(input: ContactInput): Promise<string> {
    await this.start();
    const response = await this.contactCall<SetResponse>("ContactCard/set", {
      create: { new: cardFromInput(input) },
    });
    throwOnContactError(response);
    const id = response.created?.new?.id;
    if (!id) throw new BackendError("internal", "The server didn't save the contact.");
    this.emit({ type: "contacts:changed" });
    return id;
  }

  /** Reads the card as it is now, so the patch only touches what the editor changed. */
  async updateContact(id: string, input: ContactInput): Promise<void> {
    await this.start();
    const current = await this.contactCall<GetResponse<JmapCard>>("ContactCard/get", {
      ids: [id],
      properties: CARD_PROPERTIES,
    });
    const card = current.list[0];
    if (!card) throw new BackendError("not_found", "This contact is gone.");
    const patch = patchFromInput(card, input);
    if (Object.keys(patch).length === 0) return;
    throwOnContactError(await this.contactCall<SetResponse>("ContactCard/set", { update: { [id]: patch } }));
    this.emit({ type: "contacts:changed" });
  }

  async deleteContact(id: string): Promise<void> {
    await this.start();
    throwOnError(await this.contactCall<SetResponse>("ContactCard/set", { destroy: [id] }));
    this.emit({ type: "contacts:changed" });
  }

  /**
   * Recipient suggestions: ranked by the server from the address books and the mail history where
   * it offers that (`AddressSuggestion/query`), otherwise the address books' matches.
   */
  async searchContacts(query: string): Promise<Contact[]> {
    const wanted = query.trim();
    if (!wanted) return [];
    await this.start();
    if (supports(SUGGEST)) {
      try {
        const response = await one<{ list: JmapAddressSuggestion[] }>(
          "AddressSuggestion/query",
          { text: wanted.slice(0, 256), limit: suggestionLimit(SUGGESTIONS, accountCapability(SUGGEST)) },
          [CORE, SUGGEST],
        );
        return suggestionsToContacts(response.list ?? []);
      } catch {
        // The address books still know some.
      }
    }
    return this.searchAddressBooks(wanted);
  }

  /** The address books' matches by name, address or company, fetched in the same request. */
  private async searchAddressBooks(wanted: string): Promise<Contact[]> {
    if (!supports(CONTACTS)) return [];
    const accountId = this.accountId;
    const body = await call(
      [
        [
          "ContactCard/query",
          {
            accountId,
            filter: {
              operator: "OR",
              conditions: [{ name: wanted }, { email: wanted }, { organization: wanted }],
            },
            limit: SUGGESTION_CARDS,
          },
          "q",
        ],
        [
          "ContactCard/get",
          {
            accountId,
            "#ids": { resultOf: "q", name: "ContactCard/query", path: "/ids" },
            properties: ["id", "name", "emails", "organizations"],
          },
          "g",
        ],
      ],
      [CORE, CONTACTS],
    );
    const lower = wanted.toLowerCase();
    return contactSuggestions(responseOf<GetResponse<JmapCard>>(body, "g").list, accountId)
      .sort(
        (a, b) => Number(!a.email.toLowerCase().startsWith(lower)) - Number(!b.email.toLowerCase().startsWith(lower)),
      )
      .slice(0, SUGGESTIONS);
  }

  private splitAttachmentId(attachmentId: string): { emailId: string; blobId: string } {
    const separator = attachmentId.indexOf(":");
    if (separator < 0) throw new BackendError("invalid_input", "That attachment id makes no sense.");
    return { emailId: attachmentId.slice(0, separator), blobId: attachmentId.slice(separator + 1) };
  }

  /** From the account the mail belongs to: a shared folder's mail downloads from its owner's. */
  private async attachmentBlob(attachmentId: string, filename: string): Promise<Blob> {
    const { emailId, blobId } = this.splitAttachmentId(attachmentId);
    return downloadBlob(blobId, filename, unscopeId(emailId, this.accountId).accountId);
  }

  async getAttachment(attachmentId: string): Promise<AttachmentContent> {
    await this.start();
    const { emailId } = this.splitAttachmentId(attachmentId);
    const target = unscopeId(emailId, this.accountId);
    const response = await one<GetResponse<JmapEmail>>("Email/get", {
      accountId: target.accountId,
      ids: [target.id],
      properties: ["id", "attachments"],
    });
    const email = response.list[0];
    const part = email?.attachments?.find((candidate) => `${emailId}:${candidate.blobId}` === attachmentId);
    // (`emailId` is the id as the interface knows it, so the comparison holds for shared mail too.)
    if (!part) throw new BackendError("not_found", "That attachment is gone.");
    const filename = part.name ?? "attachment";
    const blob = await this.attachmentBlob(attachmentId, filename);
    const { isDangerous } = await import("@/lib/attachments");
    return {
      url: URL.createObjectURL(blob),
      filename,
      mimeType: part.type ?? "application/octet-stream",
      size: part.size ?? blob.size,
      dangerous: isDangerous(filename),
    };
  }

  async saveAttachment(attachmentId: string): Promise<boolean> {
    const content = await this.getAttachment(attachmentId);
    // This copy is made for the download alone; the viewer and the tiles fetch their own.
    const release = () => URL.revokeObjectURL(content.url);
    if (content.dangerous) {
      const { confirmDangerousFile } = await import("@/state/dangerousFile");
      if (!(await confirmDangerousFile(content.filename))) {
        release();
        return false;
      }
    }
    offerDownload(content.url, content.filename);
    setTimeout(release, 60_000);
    return true;
  }

  async saveMessage(messageId: string): Promise<boolean> {
    await this.start();
    const target = unscopeId(messageId, this.accountId);
    const response = await one<GetResponse<JmapEmail & { blobId?: string }>>("Email/get", {
      accountId: target.accountId,
      ids: [target.id],
      properties: ["id", "blobId", "subject"],
    });
    const email = response.list[0];
    if (!email?.blobId) throw new BackendError("not_found", "That mail is gone.");
    const name = `${(email.subject ?? "mail").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "mail"}.eml`;
    const blob = await downloadBlob(email.blobId, name, target.accountId);
    const url = URL.createObjectURL(blob);
    offerDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  }

  /**
   * The server fetches and keeps sender pictures, so the sender's website never sees who reads
   * their mail. A server without them leaves the initials.
   */
  async getSenderPicture(email: string): Promise<SenderPicture | null> {
    const path = senderPicturePath(email);
    if (!path) return null;
    try {
      const response = await fetch(path, { credentials: "same-origin" });
      if (!response.ok) return null;
      const kind = response.headers.get("x-picture-kind") === "logo" ? "logo" : "icon";
      return { url: URL.createObjectURL(await response.blob()), kind };
    } catch {
      return null;
    }
  }

  /**
   * Through the server's picture proxy, which is on our own origin, so the page may read what it
   * hands back. Without one, the page may only read images whose server allows it (CORS); dark
   * mode tries that itself.
   */
  async fetchMailImage(url: string): Promise<Blob | null> {
    const own = url.startsWith(`${window.location.origin}/`) ? url : remoteImagePath(url);
    if (!own) return null;
    try {
      const response = await fetch(own, { credentials: "same-origin" });
      return response.ok ? await response.blob() : null;
    } catch {
      return null;
    }
  }

  imageProxy(): ImageProxy | null {
    // Whatever can't be sent through it stays blocked by the reader's CSP, so `url` is a safe answer.
    return supports(REMOTE) ? (url) => remoteImagePath(url) ?? url : null;
  }

  async companyDomain(email: string): Promise<string | null> {
    const domain = email.split("@")[1]?.toLowerCase();
    if (!domain || MAIL_PROVIDERS.has(domain)) return null;
    return domain;
  }

  async takeMailto(): Promise<MailtoDraft | null> {
    if (this.mailtoTaken) return null;
    this.mailtoTaken = true;
    const params = new URLSearchParams(window.location.search);
    const target = params.get("mailto");
    if (!target) return null;
    const { parseMailto } = await import("@/lib/mailto");
    return parseMailto(target);
  }

  subscribe(listener: (event: BackendEvent) => void): () => void {
    this.listeners.add(listener);
    void this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) {
        this.stopPush?.();
        this.stopPush = null;
      }
    };
  }
}

function offerDownload(url: string, filename: string): void {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let index = 0; index < buffer.length; index += 8192) {
    binary += String.fromCharCode(...buffer.subarray(index, index + 8192));
  }
  return btoa(binary);
}
