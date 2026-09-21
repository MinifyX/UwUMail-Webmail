/**
 * The mail engine of the webmail: JMAP from the browser.
 *
 * In the app a Rust engine answers these calls from a local cache. Here the
 * server is asked directly every time, which is fine because it is the same
 * machine that served the page. Two things the app does for itself are the
 * server's job here, because a page in a browser may not do them: cleaning
 * message HTML, and building the MIME of a message that is being sent.
 */

import { textToHtml } from "@/lib/format";
import { SendQueue } from "@/lib/sendQueue";
import type { SaveOutcome } from "@/lib/settingsSyncQueue";
import { unsubscribeMail } from "@/lib/unsubscribe";
import { BackendError, type Backend } from "../backend";
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
  ThreadSummary,
  UnsubscribeOutcome,
} from "../types";
import {
  CORE,
  MAIL,
  SENDERS,
  SUBMISSION,
  WEBMAIL,
  call,
  downloadBlob,
  jmapSession,
  loadJmapSession,
  one,
  responseOf,
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

interface JmapIdentity {
  id: string;
  name: string;
  email: string;
}

interface JmapSenderEntry {
  id: string;
  value: string;
  action: "allow" | "block";
  scope?: string;
}

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

export class JmapBackend implements Backend {
  readonly kind = "jmap" as const;

  private folders: Folder[] = [];
  private folderMap = new Map<string, Folder>();
  private identities: Identity[] | null = null;
  private listeners = new Set<(event: BackendEvent) => void>();
  private stopPush: (() => void) | null = null;
  private ready: Promise<void> | null = null;
  private mailtoTaken = false;
  private sendQueue = new SendQueue({
    done: (sendId) => this.emit({ type: "send:done", sendId, accountId: this.accountId }),
    failed: (sendId, message, reason) =>
      this.emit({ type: "send:failed", sendId, accountId: this.accountId, reason, message }),
  });

  private async start(): Promise<void> {
    if (!this.ready) {
      this.ready = (async () => {
        await loadJmapSession();
        await this.loadFolders();
        this.listenForPush();
      })();
    }
    return this.ready;
  }

  private get accountId(): string {
    return jmapSession().accountId;
  }

  private emit(event: BackendEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  private listenForPush(): void {
    this.stopPush?.();
    this.stopPush = watchPush((changed) => {
      if (changed.Mailbox) void this.loadFolders();
      if (changed.Email || changed.Mailbox) this.emit({ type: "mail:changed", accountId: this.accountId });
      if (changed.UserSettings) {
        this.emit({ type: "settings:changed", accountId: this.accountId, state: changed.UserSettings });
      }
    });
  }

  private async loadFolders(): Promise<Folder[]> {
    const response = await one<GetResponse<JmapMailbox>>("Mailbox/get", { ids: null });
    const boxes = response.list;
    this.folders = boxes.map((box) => toFolder(box, this.accountId, boxes));
    this.folderMap = new Map(this.folders.map((folder) => [folder.id, folder]));
    return this.folders;
  }

  private folderWithRole(role: Folder["role"]): Folder | undefined {
    return this.folders.find((folder) => folder.role === role);
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
    await this.start();
    if (this.identities) return this.identities;
    const response = await one<GetResponse<JmapIdentity>>("Identity/get", { ids: null }, [CORE, SUBMISSION]);
    const { account } = (await import("../server")).currentSession();
    const own = account.login.toLowerCase();
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
    return this.identities;
  }

  /** Signatures live in the server's settings extension, shared with the app. */
  async signaturesAvailable(): Promise<boolean> {
    await this.start();
    return supports(SETTINGS);
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
    if (!(await this.signaturesAvailable())) return [];
    return signaturesFrom((await loadUserSettings()).values);
  }

  async saveSignature(signature: Signature): Promise<Signature> {
    if (!(await this.signaturesAvailable())) {
      throw new BackendError("not_supported", "This server can't keep signatures.");
    }
    const saved = { ...signature, id: signature.id || newSignatureId() };
    // Read right before writing, so the defaults of the address's other signatures are current.
    const existing = signaturesFrom((await loadUserSettings()).values);
    await patchUserSettings(signaturePatch(saved, existing));
    return saved;
  }

  async deleteSignature(signatureId: string): Promise<void> {
    if (!(await this.signaturesAvailable())) return;
    await patchUserSettings({ [signatureKey(signatureId)]: null });
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

  private filterFor(query: ThreadQuery): Record<string, unknown> {
    const conditions: Record<string, unknown>[] = [];
    const view = query.view;
    if (view.kind === "folder") {
      conditions.push({ inMailbox: view.folderId });
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

    const calls: [string, Record<string, unknown>, string][] = [
      [
        "Email/query",
        {
          accountId: this.accountId,
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
          accountId: this.accountId,
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
          accountId: this.accountId,
          "#ids": { resultOf: "e", name: "Email/get", path: "/list/*/threadId" },
        },
        "t",
      ]);
      calls.push([
        "Email/get",
        {
          accountId: this.accountId,
          "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" },
          properties: LIST_PROPERTIES,
        },
        "m",
      ]);
    }

    const body = await call(calls);
    const found = responseOf<QueryResponse>(body, "q");
    const heads = responseOf<GetResponse<JmapEmail>>(body, "e").list;

    let threads: ThreadSummary[];
    if (collapse) {
      const threadList = responseOf<GetResponse<JmapThread>>(body, "t").list;
      const members = responseOf<GetResponse<JmapEmail>>(body, "m").list;
      const byId = new Map(members.map((email) => [email.id, email]));
      const byThread = new Map(threadList.map((thread) => [thread.id, thread]));
      threads = heads.map((head) => {
        const thread = byThread.get(head.threadId);
        const emails = (thread?.emailIds ?? [head.id]).map((id) => byId.get(id)).filter((e): e is JmapEmail => !!e);
        return toThreadSummary(head.threadId, emails.length > 0 ? emails : [head], this.accountId);
      });
    } else {
      threads = heads.map((email) => toThreadSummary(`${SINGLE}${email.id}`, [email], this.accountId));
    }

    const next = position + found.ids.length;
    return {
      threads,
      ...(found.ids.length === query.limit ? { nextCursor: String(next) } : {}),
    };
  }

  async getThread(threadId: string, conversations: boolean): Promise<ThreadDetail> {
    await this.start();
    const properties = this.messageProperties();
    const single = threadId.startsWith(SINGLE);
    const ids = single ? [threadId.slice(SINGLE.length)] : null;

    const calls: [string, Record<string, unknown>, string][] = single
      ? [["Email/get", { accountId: this.accountId, ids, properties, fetchAllBodyValues: true }, "e"]]
      : [
          ["Thread/get", { accountId: this.accountId, ids: [threadId] }, "t"],
          [
            "Email/get",
            {
              accountId: this.accountId,
              "#ids": { resultOf: "t", name: "Thread/get", path: "/list/*/emailIds" },
              properties,
              fetchAllBodyValues: true,
            },
            "e",
          ],
        ];
    const body = await call(calls, supports(WEBMAIL) ? [CORE, MAIL, WEBMAIL] : [CORE, MAIL]);
    let emails = responseOf<GetResponse<JmapEmail>>(body, "e").list;
    if (emails.length === 0) throw new BackendError("not_found", "That mail is gone.");
    if (!conversations && !single) {
      const newest = [...emails].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))[0]!;
      emails = [newest];
    }
    const messages = emails
      .map((email) => toMessage(email, this.accountId, this.folderMap))
      .sort((a, b) => a.date.localeCompare(b.date));
    return {
      thread: toThreadSummary(threadId, emails, this.accountId),
      messages,
    };
  }

  async setFlags(messageIds: string[], change: FlagChange): Promise<void> {
    await this.start();
    const patch: Record<string, unknown> = {};
    if (change.seen !== undefined) patch["keywords/$seen"] = change.seen ? true : null;
    if (change.flagged !== undefined) patch["keywords/$flagged"] = change.flagged ? true : null;
    if (Object.keys(patch).length === 0) return;
    const update = Object.fromEntries(messageIds.map((id) => [id, patch]));
    throwOnError(await one<SetResponse>("Email/set", { update }));
    this.emit({ type: "mail:changed", accountId: this.accountId });
  }

  /** Moves mail into one folder and reports where each message came from. */
  private async moveTo(
    messageIds: string[],
    targetId: string,
    keywords?: Record<string, unknown>,
  ): Promise<MovedMessage[]> {
    await this.start();
    const current = await one<GetResponse<JmapEmail>>("Email/get", {
      ids: messageIds,
      properties: ["id", "mailboxIds", "keywords"],
    });
    const update: Record<string, Record<string, unknown>> = {};
    const moved: MovedMessage[] = [];
    for (const email of current.list) {
      const from = Object.keys(email.mailboxIds).filter((id) => email.mailboxIds[id]);
      if (from.includes(targetId) && from.length === 1) continue;
      update[email.id] = { mailboxIds: { [targetId]: true }, ...(keywords ?? {}) };
      const fromFolderId = from.find((id) => id !== targetId) ?? from[0] ?? "";
      moved.push({ id: email.id, fromFolderId });
    }
    if (moved.length === 0) return [];
    throwOnError(await one<SetResponse>("Email/set", { update }));
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
    return moved;
  }

  private folderOrFail(role: Exclude<Folder["role"], null>): Folder {
    const folder = this.folderWithRole(role);
    if (!folder) throw new BackendError("not_found", `This mailbox has no ${role} folder.`);
    return folder;
  }

  async archive(messageIds: string[]): Promise<MovedMessage[]> {
    await this.start();
    return this.moveTo(messageIds, this.folderOrFail("archive").id);
  }

  async trash(messageIds: string[]): Promise<MovedMessage[]> {
    await this.start();
    return this.moveTo(messageIds, this.folderOrFail("trash").id);
  }

  async moveMessages(messageIds: string[], folderId: string): Promise<MovedMessage[]> {
    return this.moveTo(messageIds, folderId);
  }

  async markSpam(messageIds: string[], spam: boolean): Promise<MovedMessage[]> {
    await this.start();
    const target = spam ? this.folderOrFail("junk") : this.folderOrFail("inbox");
    // The keywords teach the server's filter; the move alone would not.
    const keywords = spam
      ? { "keywords/$junk": true, "keywords/$notjunk": null }
      : { "keywords/$junk": null, "keywords/$notjunk": true };
    return this.moveTo(messageIds, target.id, keywords);
  }

  async deleteForever(messageIds: string[]): Promise<number> {
    await this.start();
    const trash = this.folderOrFail("trash");
    const current = await one<GetResponse<JmapEmail>>("Email/get", {
      ids: messageIds,
      properties: ["id", "mailboxIds"],
    });
    // Only what really lies in the trash, so deleting twice can never take mail elsewhere.
    const destroy = current.list.filter((email) => email.mailboxIds[trash.id] === true).map((email) => email.id);
    if (destroy.length === 0) return 0;
    const response = await one<SetResponse>("Email/set", { destroy });
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
    return response.destroyed?.length ?? 0;
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
    const response = await one<GetResponse<JmapEmail>>("Email/get", {
      ids: [messageId],
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
      const original = await one<GetResponse<JmapEmail>>("Email/get", {
        ids: [message.inReplyTo],
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

  async send(message: OutgoingMessage): Promise<void> {
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
    throwOnError(responseOf<SetResponse>(body, "s"));
    // An earlier version of this draft, from another device or a previous save.
    if (message.draftKey) await this.destroyDrafts(message.draftKey, drafts.id);
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
  }

  /**
   * Holds a mail back for "undo send". The server sends at once on submission, so the wait
   * happens in this page (see lib/sendQueue): the mail is saved as a draft first, and that very
   * draft is submitted when the time is up. Closing the tab meanwhile leaves it in Drafts, unsent.
   */
  async queueSend(message: OutgoingMessage, delaySeconds: number): Promise<QueuedSend> {
    await this.start();
    if (message.to.length + message.cc.length + message.bcc.length === 0) {
      throw new BackendError("invalid_input", "There is nobody to send this to.");
    }
    const saved = await this.storeDraft(message);
    const waiting = { ...message, draftKey: saved.draftKey };
    return this.sendQueue.add(waiting, delaySeconds, () => this.submitDraft(saved.emailId, waiting));
  }

  /** Takes a held-back mail back; its draft stays in the Drafts folder. */
  async cancelSend(sendId: string): Promise<OutgoingMessage> {
    try {
      return this.sendQueue.cancel(sendId);
    } catch {
      throw new BackendError("invalid_input", "This mail is already on its way.");
    }
  }

  /** Sends a draft that already lies in the Drafts folder and moves it to Sent. */
  private async submitDraft(emailId: string, message: OutgoingMessage): Promise<void> {
    await this.start();
    const drafts = this.folderOrFail("drafts");
    const sent = this.folderOrFail("sent");
    const identities = await this.listIdentities();
    const envelope = {
      mailFrom: { email: message.fromEmail ?? identities.find((i) => i.primary)?.email ?? "" },
      rcptTo: [...message.to, ...message.cc, ...message.bcc].map((address) => ({ email: address.email })),
    };
    const body = await call(
      [
        [
          "EmailSubmission/set",
          {
            accountId: this.accountId,
            create: { send: { emailId, identityId: this.identityIdFor(message.fromEmail, identities), envelope } },
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
    const submitted = responseOf<SetResponse>(body, "s");
    throwOnError(submitted);
    if (!submitted.created?.send) throw new BackendError("internal", "The server didn't take the mail.");
    await this.loadFolders();
    this.emit({ type: "mail:changed", accountId: this.accountId });
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
      inReplyTo: null,
      attachments,
    };
  }

  /** Address suggestions come from the server in 0.5.1. */
  async searchContacts(): Promise<Contact[]> {
    return [];
  }

  private splitAttachmentId(attachmentId: string): { emailId: string; blobId: string } {
    const separator = attachmentId.indexOf(":");
    if (separator < 0) throw new BackendError("invalid_input", "That attachment id makes no sense.");
    return { emailId: attachmentId.slice(0, separator), blobId: attachmentId.slice(separator + 1) };
  }

  private async attachmentBlob(attachmentId: string, filename: string): Promise<Blob> {
    const { blobId } = this.splitAttachmentId(attachmentId);
    return downloadBlob(blobId, filename);
  }

  async getAttachment(attachmentId: string): Promise<AttachmentContent> {
    await this.start();
    const { emailId } = this.splitAttachmentId(attachmentId);
    const response = await one<GetResponse<JmapEmail>>("Email/get", {
      ids: [emailId],
      properties: ["id", "attachments"],
    });
    const email = response.list[0];
    const part = email?.attachments?.find((candidate) => `${emailId}:${candidate.blobId}` === attachmentId);
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
    if (content.dangerous) {
      const { confirmDangerousFile } = await import("@/state/dangerousFile");
      if (!(await confirmDangerousFile(content.filename))) return false;
    }
    offerDownload(content.url, content.filename);
    return true;
  }

  async saveMessage(messageId: string): Promise<boolean> {
    await this.start();
    const response = await one<GetResponse<JmapEmail & { blobId?: string }>>("Email/get", {
      ids: [messageId],
      properties: ["id", "blobId", "subject"],
    });
    const email = response.list[0];
    if (!email?.blobId) throw new BackendError("not_found", "That mail is gone.");
    const name = `${(email.subject ?? "mail").replace(/[\\/:*?"<>|]/g, "_").slice(0, 60) || "mail"}.eml`;
    const blob = await downloadBlob(email.blobId, name);
    const url = URL.createObjectURL(blob);
    offerDownload(url, name);
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    return true;
  }

  /** Sender pictures come from the server in 0.5.1; until then the interface shows initials. */
  async getSenderPicture(): Promise<SenderPicture | null> {
    return null;
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
