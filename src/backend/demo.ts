import { BackendError, type Backend } from "./backend";
import { isDangerous } from "@/lib/attachments";
import { SendQueue } from "@/lib/sendQueue";
import type { SaveOutcome } from "@/lib/settingsSyncQueue";
import { demoAttachmentBlob } from "./demo-attachments";
import { DemoCalendar } from "./demo-calendar";
import { DemoContacts } from "./demo-contacts";
import { rulesToSieve } from "@/lib/sieveRules";
import { buildFolders, buildMessages, DEMO_ACCOUNTS, demoRules, welcomeMessage } from "./demo-data";
import { demoSenderPicture } from "./demo-pictures";
import type {
  BlockedSender,
  Account,
  AttachmentContent,
  Address,
  BackendEvent,
  Contact,
  ContactInput,
  DraftContent,
  DraftSaveResult,
  EventDeleteScope,
  EventInput,
  FlagChange,
  Folder,
  Identity,
  MailtoDraft,
  MovedMessage,
  Message,
  OutgoingMessage,
  QueuedSend,
  SenderPicture,
  Signature,
  ThreadDetail,
  ThreadPage,
  ThreadQuery,
  ThreadSummary,
  UnsubscribeOutcome,
} from "./types";

const DEMO_FREEMAIL = new Set(["gmail.com", "gmx.de", "web.de", "outlook.com", "icloud.com", "posteo.de", "proton.me"]);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Like the engine: conversations the trash lists hold only their trashed messages. */
const TRASHED_THREAD = "trash:";

function lang(): "de" | "en" {
  return navigator.language.toLowerCase().startsWith("de") ? "de" : "en";
}

function uniqueAddresses(addresses: Address[]): Address[] {
  const seen = new Set<string>();
  return addresses.filter((a) => {
    const key = a.email.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A stand-in for the server's Sieve check: enough to try the text mode with. Braces and quotes
 * must pair up, and the commands UwUMail's server doesn't run are refused like it would.
 */
function demoSieveProblem(script: string): string | null {
  const code = script
    .split(/\r?\n/)
    .filter((line) => !line.trimStart().startsWith("#"))
    .join("\n")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');
  if (code.includes('"')) return "line ?: unterminated string";
  let depth = 0;
  for (const char of code) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) break;
  }
  if (depth !== 0) return "unbalanced braces";
  const unsupported = /\b(reject|ereject|vacation|notify|include)\b/.exec(code);
  return unsupported ? `the command "${unsupported[1]}" is not supported here` : null;
}

/** In-memory engine with sample data. Used by `pnpm dev` in a normal browser. */
export class DemoBackend implements Backend {
  readonly kind = "demo";

  private accounts: Account[] = structuredClone(DEMO_ACCOUNTS);
  private folders: Folder[] = DEMO_ACCOUNTS.flatMap((a) => buildFolders(a.id, lang()));
  // Newsletters and offers carry a List-Unsubscribe like the real ones.
  private messages: Message[] = buildMessages(lang()).map((message) =>
    /newsletter|aktion|offer|deal/i.test(message.subject)
      ? { ...message, unsubscribe: { oneClick: true, url: "https://pixelparts.example/unsubscribe" } }
      : message,
  );
  private listeners = new Set<(event: BackendEvent) => void>();
  private nextId = 1000;
  private attachmentUrls = new Map<string, string>();
  private mailtoTaken = false;
  /** Draft key → the demo message that holds the draft, and what the composer sent. */
  private drafts = new Map<string, { messageId: string; draft: OutgoingMessage }>();
  private blocked: BlockedSender[] = [];
  private signatures: Signature[] = [
    {
      id: "sig-demo",
      email: DEMO_ACCOUNTS[0]!.email,
      name: lang() === "de" ? "Lang" : "Long",
      html:
        lang() === "de"
          ? "<p>Liebe Grüße<br><b>Mini</b> · UwUMail-Team</p>"
          : "<p>Kind regards<br><b>Mini</b> · UwUMail team</p>",
      forNew: true,
      forReplies: true,
    },
  ];
  private identities: Identity[] = [
    {
      id: "id-studio",
      accountId: DEMO_ACCOUNTS[0]!.id,
      email: "hallo@uwumail.dev",
      name: "Mini vom Studio",
      primary: false,
      fromServer: true,
    },
  ];
  private sendQueue = new SendQueue({
    done: (sendId, message) => this.emit({ type: "send:done", sendId, accountId: message.accountId }),
    failed: (sendId, message, reason) =>
      this.emit({ type: "send:failed", sendId, accountId: message.accountId, reason, message }),
  });

  constructor() {
    setTimeout(() => {
      const message = welcomeMessage(lang(), `msg-${this.nextId++}`);
      this.messages.push(message);
      this.emit({ type: "mail:received", accountId: message.accountId, messageIds: [message.id] });
      this.emit({ type: "mail:changed", accountId: message.accountId });
    }, 20_000);
  }

  async listAccounts() {
    await wait(80);
    return structuredClone(this.accounts);
  }

  async listIdentities(): Promise<Identity[]> {
    await wait(60);
    const own = this.accounts.map((a) => ({
      id: a.id,
      accountId: a.id,
      email: a.email,
      name: a.displayName,
      primary: true,
      fromServer: false,
    }));
    return structuredClone(own.flatMap((o) => [o, ...this.identities.filter((i) => i.accountId === o.accountId)]));
  }

  async signaturesAvailable() {
    return true;
  }

  /** The demo plays a server with the settings extension, kept in memory like everything else. */
  private userSettings: { state: number; values: Record<string, unknown> } = { state: 0, values: {} };

  async userSettingsAvailable() {
    return true;
  }

  async loadUserSettings() {
    await wait(60);
    return { state: String(this.userSettings.state), values: structuredClone(this.userSettings.values) };
  }

  async saveUserSettings(patch: Record<string, unknown>, ifInState?: string): Promise<SaveOutcome> {
    await wait(80);
    if (ifInState !== undefined && ifInState !== String(this.userSettings.state)) {
      return { ok: false, type: "stateMismatch" };
    }
    const values = { ...this.userSettings.values };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) delete values[key];
      else values[key] = structuredClone(value);
    }
    this.userSettings = { state: this.userSettings.state + 1, values };
    const state = String(this.userSettings.state);
    this.emit({ type: "settings:changed", accountId: this.accounts[0]!.id, state });
    return { ok: true, state };
  }

  async listSignatures() {
    await wait(60);
    return structuredClone(this.signatures);
  }

  /** Kept in memory only, like everything in the demo. */
  async saveSignature(signature: Signature) {
    await wait(120);
    const saved = { ...signature, id: signature.id || `sig-${this.nextId++}` };
    const email = saved.email.toLowerCase();
    this.signatures = this.signatures.map((s) =>
      s.email.toLowerCase() === email && s.id !== saved.id
        ? { ...s, forNew: saved.forNew ? false : s.forNew, forReplies: saved.forReplies ? false : s.forReplies }
        : s,
    );
    const index = this.signatures.findIndex((s) => s.id === saved.id);
    if (index >= 0) this.signatures[index] = saved;
    else this.signatures.push(saved);
    return structuredClone(saved);
  }

  async deleteSignature(signatureId: string) {
    await wait(80);
    this.signatures = this.signatures.filter((s) => s.id !== signatureId);
  }

  async syncNow(accountId?: string) {
    const targets = this.accounts.filter((a) => !accountId || a.id === accountId);
    for (const account of targets) {
      account.status = { state: "syncing" };
      this.emit({ type: "account:status", accountId: account.id, status: account.status });
    }
    await wait(900);
    for (const account of targets) {
      account.status = { state: "idle" };
      this.emit({ type: "account:status", accountId: account.id, status: account.status });
    }
  }

  async listFolders(accountId?: string) {
    await wait(60);
    return this.folders
      .filter((f) => !accountId || f.accountId === accountId)
      .map((folder) => {
        const inFolder = this.messages.filter((m) => m.folderId === folder.id);
        return { ...folder, total: inFolder.length, unread: inFolder.filter((m) => !m.flags.seen).length };
      });
  }

  async createFolder(input: { accountId?: string; name: string; parentId: string | null }) {
    await wait(120);
    const parent = input.parentId ? this.folders.find((f) => f.id === input.parentId) : undefined;
    if (input.parentId && !parent) throw new BackendError("not_found", "This folder no longer exists.");
    const accountId = parent?.accountId ?? input.accountId ?? this.accounts[0]!.id;
    this.assertFreeName(accountId, input.parentId, input.name);
    const id = `${accountId}:f${this.nextId++}`;
    this.folders.push({
      id,
      accountId,
      name: input.name,
      path: parent ? `${parent.path}/${input.name}` : input.name,
      role: null,
      parentId: input.parentId,
      selectable: true,
      unread: 0,
      total: 0,
    });
    this.emit({ type: "mail:changed", accountId });
    return id;
  }

  async renameFolder(folderId: string, name: string) {
    await wait(100);
    const folder = this.folders.find((f) => f.id === folderId);
    if (!folder) throw new BackendError("not_found", "This folder no longer exists.");
    if (folder.role) throw new BackendError("invalid_input", "System folders keep their names.");
    this.assertFreeName(folder.accountId, folder.parentId, name, folderId);
    const oldPath = folder.path;
    folder.name = name;
    folder.path = oldPath.includes("/") ? `${oldPath.slice(0, oldPath.lastIndexOf("/"))}/${name}` : name;
    for (const other of this.folders) {
      if (other.path.startsWith(`${oldPath}/`)) other.path = folder.path + other.path.slice(oldPath.length);
    }
    this.emit({ type: "mail:changed", accountId: folder.accountId });
  }

  async deleteFolder(folderId: string) {
    await wait(150);
    const folder = this.folders.find((f) => f.id === folderId);
    if (!folder) throw new BackendError("not_found", "This folder no longer exists.");
    if (folder.role) throw new BackendError("invalid_input", "System folders stay.");
    if (this.folders.some((f) => f.parentId === folderId)) {
      throw new BackendError("invalid_input", "This folder still holds folders.");
    }
    for (const message of this.messages) {
      if (message.folderId === folderId) message.folderId = `${folder.accountId}:trash`;
    }
    this.folders = this.folders.filter((f) => f.id !== folderId);
    this.emit({ type: "mail:changed", accountId: folder.accountId });
  }

  async emptyFolder(folderId: string) {
    await wait(200);
    const folder = this.folders.find((f) => f.id === folderId);
    if (folder?.role !== "trash" && folder?.role !== "junk") {
      throw new BackendError("invalid_input", "Only trash and junk empty.");
    }
    const before = this.messages.length;
    this.messages = this.messages.filter((m) => m.folderId !== folderId);
    this.emit({ type: "mail:changed", accountId: folder.accountId });
    return before - this.messages.length;
  }

  /** Like a server: two folders side by side can't share a name. */
  private assertFreeName(accountId: string, parentId: string | null, name: string, except?: string) {
    const taken = this.folders.some(
      (f) =>
        f.accountId === accountId &&
        f.parentId === parentId &&
        f.id !== except &&
        f.name.toLowerCase() === name.toLowerCase(),
    );
    if (taken) throw new BackendError("invalid_input", "A folder with that name is already there.");
  }

  async listThreads(query: ThreadQuery): Promise<ThreadPage> {
    await wait(120);
    const matching = this.messages.filter((m) => this.inView(m, query) && this.matchesFilter(m, query));
    const { view } = query;
    const trash = view.kind === "folder" && this.folders.find((f) => f.id === view.folderId)?.role === "trash";
    const groups = new Map<string, Message[]>();
    for (const message of matching) {
      const key = query.conversations ? `${trash ? TRASHED_THREAD : ""}${message.threadId}` : `m:${message.id}`;
      const list = groups.get(key) ?? [];
      list.push(message);
      groups.set(key, list);
    }
    const threads = [...groups.entries()]
      .map(([id, list]) =>
        this.summarize(id, query.conversations ? this.threadMessages(list[0]!.threadId, trash) : list),
      )
      .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
    const offset = query.cursor ? Number(query.cursor) : 0;
    const page = threads.slice(offset, offset + query.limit);
    const next = offset + query.limit;
    return { threads: page, nextCursor: next < threads.length ? String(next) : undefined };
  }

  async getThread(threadId: string, conversations: boolean): Promise<ThreadDetail> {
    await wait(90);
    const list = threadId.startsWith("m:")
      ? this.messages.filter((m) => m.id === threadId.slice(2))
      : threadId.startsWith(TRASHED_THREAD)
        ? this.threadMessages(threadId.slice(TRASHED_THREAD.length), true)
        : this.threadMessages(threadId, false);
    if (list.length === 0) throw new BackendError("not_found", "Thread not found");
    const messages = conversations || threadId.startsWith("m:") ? list : list.slice(-1);
    return { thread: this.summarize(threadId, list), messages: structuredClone(messages) };
  }

  async setFlags(messageIds: string[], change: FlagChange) {
    for (const message of this.messages) {
      if (!messageIds.includes(message.id)) continue;
      if (change.seen !== undefined) message.flags.seen = change.seen;
      if (change.flagged !== undefined) message.flags.flagged = change.flagged;
    }
    this.emitChanged(messageIds);
  }

  async archive(messageIds: string[]) {
    return this.moveToRole(messageIds, "archive");
  }

  async trash(messageIds: string[]) {
    return this.moveToRole(messageIds, "trash");
  }

  async deleteForever(messageIds: string[]) {
    await wait(120);
    const doomed = new Set(
      this.messages.filter((m) => messageIds.includes(m.id) && this.roleOf(m) === "trash").map((m) => m.id),
    );
    this.emitChanged([...doomed]);
    this.messages = this.messages.filter((m) => !doomed.has(m.id));
    return doomed.size;
  }

  async moveMessages(messageIds: string[], folderId: string) {
    await wait(120);
    const folder = this.folders.find((f) => f.id === folderId);
    if (!folder) throw new BackendError("not_found", "This folder no longer exists.");
    const moved: MovedMessage[] = [];
    for (const message of this.messages) {
      if (!messageIds.includes(message.id) || message.folderId === folderId) continue;
      if (message.accountId !== folder.accountId) {
        throw new BackendError("invalid_input", "Mail can only move to folders of its own mailbox.");
      }
      moved.push({ id: message.id, fromFolderId: message.folderId });
      message.folderId = folderId;
    }
    this.emitChanged(messageIds);
    return moved;
  }

  async markSpam(messageIds: string[], spam: boolean) {
    return this.moveToRole(messageIds, spam ? "junk" : "inbox");
  }

  async unsubscribe(messageId: string): Promise<UnsubscribeOutcome> {
    await wait(700);
    const message = this.messages.find((m) => m.id === messageId);
    if (!message?.unsubscribe) throw new BackendError("invalid_input", "This mail has no way to unsubscribe.");
    for (const other of this.messages) {
      if (other.from.email === message.from.email) delete other.unsubscribe;
    }
    return { kind: "done" };
  }

  async inboxMessagesFrom(email: string) {
    await wait(60);
    return this.messages
      .filter((m) => m.from.email.toLowerCase() === email.toLowerCase() && this.roleOf(m) === "inbox")
      .map((m) => m.id);
  }

  async blockedSenders() {
    await wait(40);
    return [...this.blocked];
  }

  async blockSender(entry: string, accountId?: string) {
    await wait(80);
    const normalized = entry.trim().toLowerCase();
    if (!/^(@[^@\s]+\.[^@\s]+|[^@\s]+@[^@\s]+\.[^@\s]+)$/.test(normalized)) {
      throw new BackendError("invalid_input", `"${entry}" isn't an address or @domain.`);
    }
    // The demo's JMAP mailbox plays a UwUMail server that keeps the list itself.
    const onServer = this.accounts.find((account) => account.id === accountId)?.protocol === "jmap";
    const existing = this.blocked.find(
      (sender) => sender.entry === normalized && sender.accountId === (onServer ? accountId : null),
    );
    if (existing) return existing;
    const sender: BlockedSender = {
      entry: normalized,
      accountId: onServer ? accountId! : null,
      serverId: onServer ? `l${this.nextId++}` : null,
    };
    this.blocked.push(sender);
    return sender;
  }

  async unblockSender(sender: BlockedSender) {
    await wait(60);
    this.blocked = this.blocked.filter(
      (other) => !(other.entry === sender.entry && other.accountId === sender.accountId),
    );
  }

  /** Like the server's webmail: the mail waits as a draft, then goes out when the time is up. */
  async queueSend(message: OutgoingMessage, delaySeconds: number): Promise<QueuedSend> {
    if (message.to.length + message.cc.length + message.bcc.length === 0) {
      throw new BackendError("invalid_input", "No recipients");
    }
    const { draftKey } = await this.saveDraft(message);
    const waiting = { ...message, draftKey };
    return this.sendQueue.add(waiting, delaySeconds, () => this.send(waiting));
  }

  async cancelSend(sendId: string) {
    try {
      return this.sendQueue.cancel(sendId);
    } catch {
      throw new BackendError("invalid_input", "This mail is already on its way.");
    }
  }

  async saveDraft(draft: OutgoingMessage): Promise<DraftSaveResult> {
    await wait(350);
    const account = this.accounts.find((a) => a.id === draft.accountId);
    if (!account) throw new BackendError("not_found", "Account not found");
    const draftKey = draft.draftKey ?? `demo-${this.nextId++}@${account.email.split("@")[1] ?? "uwumail.dev"}`;
    this.removeDraftMessage(draftKey);
    const original = draft.inReplyTo ? this.messages.find((m) => m.id === draft.inReplyTo) : undefined;
    const id = `msg-${this.nextId++}`;
    this.messages.push({
      id,
      threadId: original?.threadId ?? `thr-${id}`,
      accountId: account.id,
      folderId: `${account.id}:drafts`,
      from: this.senderOf(account, draft.fromEmail),
      to: draft.to,
      cc: draft.cc,
      bcc: draft.bcc,
      replyTo: [],
      subject: draft.subject,
      date: new Date().toISOString(),
      flags: { seen: true, flagged: false, answered: false, draft: true },
      snippet: draft.text.slice(0, 140),
      bodyHtml: draft.html,
      bodyText: draft.text,
      hasRemoteContent: false,
      attachments: draft.attachments.map((a, i) => ({
        id: `att-${id}-${i}`,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        inline: false,
      })),
    });
    this.drafts.set(draftKey, { messageId: id, draft: { ...draft, draftKey } });
    this.emit({ type: "mail:changed", accountId: account.id });
    return { draftKey, savedAt: new Date().toISOString() };
  }

  async deleteDraft(accountId: string, draftKey: string) {
    await wait(150);
    this.removeDraftMessage(draftKey);
    this.emit({ type: "mail:changed", accountId });
  }

  async openDraft(messageId: string): Promise<DraftContent> {
    await wait(200);
    const entry = [...this.drafts.values()].find((d) => d.messageId === messageId);
    const message = this.messages.find((m) => m.id === messageId);
    if (!message) throw new BackendError("not_found", "This draft no longer exists.");
    const draft = entry?.draft;
    return {
      accountId: message.accountId,
      fromEmail: draft?.fromEmail ?? null,
      draftKey: draft?.draftKey ?? null,
      to: message.to,
      cc: message.cc,
      bcc: draft?.bcc ?? [],
      subject: message.subject,
      html: message.bodyHtml ?? message.bodyText ?? "",
      inReplyTo: draft?.inReplyTo ?? null,
      attachments: draft?.attachments ?? [],
    };
  }

  private senderOf(account: Account, fromEmail?: string): Address {
    const identity = this.identities.find(
      (i) => i.accountId === account.id && i.email.toLowerCase() === fromEmail?.toLowerCase(),
    );
    return identity
      ? { name: identity.name || account.displayName, email: identity.email }
      : { name: account.displayName, email: account.email };
  }

  private removeDraftMessage(draftKey: string) {
    const entry = this.drafts.get(draftKey);
    if (!entry) return;
    this.messages = this.messages.filter((m) => m.id !== entry.messageId);
    this.drafts.delete(draftKey);
  }

  async send(outgoing: OutgoingMessage) {
    await wait(900);
    if (outgoing.to.length + outgoing.cc.length + outgoing.bcc.length === 0) {
      throw new BackendError("invalid_input", "No recipients");
    }
    const account = this.accounts.find((a) => a.id === outgoing.accountId);
    if (!account) throw new BackendError("not_found", "Account not found");
    if (outgoing.draftKey) this.removeDraftMessage(outgoing.draftKey);
    const original = outgoing.inReplyTo ? this.messages.find((m) => m.id === outgoing.inReplyTo) : undefined;
    const id = `msg-${this.nextId++}`;
    if (original) original.flags.answered = true;
    this.messages.push({
      id,
      threadId: original?.threadId ?? `thr-${id}`,
      accountId: account.id,
      folderId: `${account.id}:sent`,
      from: this.senderOf(account, outgoing.fromEmail),
      to: outgoing.to,
      cc: outgoing.cc,
      bcc: outgoing.bcc,
      replyTo: [],
      subject: outgoing.subject,
      date: new Date().toISOString(),
      flags: { seen: true, flagged: false, answered: false, draft: false },
      snippet: outgoing.text.slice(0, 140),
      bodyHtml: outgoing.html,
      bodyText: outgoing.text,
      hasRemoteContent: false,
      attachments: outgoing.attachments.map((a, i) => ({
        id: `att-${id}-${i}`,
        filename: a.filename,
        mimeType: a.mimeType,
        size: a.size,
        inline: false,
      })),
    });
    this.emit({ type: "mail:changed", accountId: account.id });
  }

  async getAttachment(attachmentId: string): Promise<AttachmentContent> {
    await wait(250);
    const attachment = this.messages.flatMap((m) => m.attachments).find((a) => a.id === attachmentId);
    if (!attachment) throw new BackendError("not_found", "This attachment no longer exists.");
    let url = this.attachmentUrls.get(attachmentId);
    if (!url) {
      url = URL.createObjectURL(demoAttachmentBlob(attachment.filename, attachment.mimeType));
      this.attachmentUrls.set(attachmentId, url);
    }
    return {
      url,
      filename: attachment.filename,
      mimeType: attachment.mimeType,
      size: attachment.size,
      dangerous: isDangerous(attachment.filename),
    };
  }

  async saveMessage(messageId: string) {
    const message = this.messages.find((m) => m.id === messageId);
    if (!message) throw new BackendError("not_found", "This message no longer exists.");
    const eml = [
      `From: ${message.from.name ?? ""} <${message.from.email}>`,
      `To: ${message.to.map((a) => a.email).join(", ")}`,
      `Subject: ${message.subject}`,
      `Date: ${new Date(message.date).toUTCString()}`,
      "Content-Type: text/html; charset=utf-8",
      "",
      message.bodyHtml ?? message.bodyText ?? "",
    ].join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([eml], { type: "message/rfc822" }));
    link.download = `${message.subject || "Mail"}.eml`;
    link.click();
    return true;
  }

  async saveAttachment(attachmentId: string) {
    const file = await this.getAttachment(attachmentId);
    const link = document.createElement("a");
    link.href = file.url;
    link.download = file.filename;
    link.click();
    return true;
  }

  async getSenderPicture(email: string): Promise<SenderPicture | null> {
    await wait(150);
    return demoSenderPicture(email);
  }

  async fetchMailImage(): Promise<Blob | null> {
    // The demo's images are embedded; remote ones can only be read where their server allows it.
    return null;
  }

  async companyDomain(email: string) {
    // Good enough for made-up addresses; the real engine uses the public suffix list.
    const labels = (email.split("@")[1] ?? "").toLowerCase().split(".").filter(Boolean);
    const domain = labels.slice(-2).join(".");
    return labels.length < 2 || DEMO_FREEMAIL.has(domain) ? null : domain;
  }

  private calendar = new DemoCalendar(lang(), DEMO_ACCOUNTS[0]!.id, () => this.emit({ type: "calendar:changed" }));

  async calendarsAvailable() {
    return true;
  }

  async calendars() {
    await wait(80);
    return this.calendar.calendars();
  }

  async createCalendar(input: { name: string; color: string | null }) {
    await wait(120);
    return this.calendar.createCalendar(input);
  }

  async updateCalendar(id: string, patch: { name?: string; color?: string | null; isVisible?: boolean }) {
    await wait(60);
    this.calendar.updateCalendar(id, patch);
  }

  async deleteCalendar(id: string) {
    await wait(120);
    this.calendar.deleteCalendar(id);
  }

  async setDefaultCalendar(id: string) {
    await wait(60);
    this.calendar.setDefaultCalendar(id);
  }

  /** The demo keeps every time in the viewer's zone, so there is nothing to convert. */
  async calendarEvents(from: string, to: string) {
    await wait(120);
    return this.calendar.occurrences(from, to);
  }

  async createEvent(input: EventInput) {
    await wait(150);
    return this.calendar.createEvent(input);
  }

  async updateEvent(eventId: string, input: EventInput, occurrenceStart?: string) {
    await wait(150);
    this.calendar.updateEvent(eventId, input, occurrenceStart);
  }

  async deleteEvent(occurrenceId: string, scope: EventDeleteScope) {
    await wait(120);
    this.calendar.deleteEvent(occurrenceId, scope);
  }

  private addressBook = new DemoContacts(lang(), DEMO_ACCOUNTS[0]!.id, () => this.emit({ type: "contacts:changed" }));

  async contactsAvailable() {
    return true;
  }

  async addressBooks() {
    await wait(60);
    return this.addressBook.addressBooks();
  }

  async createAddressBook(name: string) {
    await wait(120);
    return this.addressBook.createAddressBook(name);
  }

  async renameAddressBook(id: string, name: string) {
    await wait(60);
    this.addressBook.renameAddressBook(id, name);
  }

  async deleteAddressBook(id: string) {
    await wait(120);
    this.addressBook.deleteAddressBook(id);
  }

  async setDefaultAddressBook(id: string) {
    await wait(60);
    this.addressBook.setDefaultAddressBook(id);
  }

  async contacts() {
    await wait(100);
    return this.addressBook.contacts();
  }

  async createContact(input: ContactInput) {
    await wait(150);
    return this.addressBook.createContact(input);
  }

  async updateContact(id: string, input: ContactInput) {
    await wait(150);
    this.addressBook.updateContact(id, input);
  }

  async deleteContact(id: string) {
    await wait(120);
    this.addressBook.deleteContact(id);
  }

  /** Only the demo's JMAP mailbox plays a server with mail rules; its script starts with examples. */
  private sieveScripts = new Map<string, { script: string; active: boolean }>([
    [DEMO_ACCOUNTS[0]!.id, { script: rulesToSieve(demoRules(lang(), DEMO_ACCOUNTS[0]!.id)), active: true }],
  ]);

  private rulesAccount(accountId?: string) {
    const account = accountId ? this.accounts.find((a) => a.id === accountId) : this.accounts[0];
    if (account?.protocol !== "jmap") throw new BackendError("not_supported", "This mailbox has no mail rules.");
    return account.id;
  }

  async mailRulesAvailable(accountId?: string) {
    return this.accounts.some((a) => a.protocol === "jmap" && (!accountId || a.id === accountId));
  }

  async mailRules(accountId?: string) {
    await wait(150);
    return structuredClone(this.sieveScripts.get(this.rulesAccount(accountId)) ?? { script: null, active: false });
  }

  async validateMailRules(script: string) {
    await wait(120);
    return demoSieveProblem(script);
  }

  async saveMailRules(script: string, accountId?: string) {
    await wait(200);
    const problem = demoSieveProblem(script);
    if (problem) throw new BackendError("invalid_input", problem);
    this.sieveScripts.set(this.rulesAccount(accountId), { script, active: true });
  }

  async searchContacts(query: string): Promise<Contact[]> {
    const q = query.trim().toLowerCase();
    const counts = new Map<string, Contact>();
    for (const message of this.messages) {
      for (const address of [message.from, ...message.to, ...message.cc]) {
        if (this.accounts.some((a) => a.email === address.email)) continue;
        const key = address.email.toLowerCase();
        const existing = counts.get(key);
        if (existing) existing.timesContacted += 1;
        else counts.set(key, { name: address.name, email: address.email, timesContacted: 1, lastUsed: message.date });
      }
    }
    const fromHistory = [...counts.values()]
      .filter((c) => !q || c.email.toLowerCase().includes(q) || c.name?.toLowerCase().includes(q))
      .sort((a, b) => b.timesContacted - a.timesContacted);
    // The address books first, as the server's search puts them.
    const fromBooks = this.addressBook.search(q);
    const known = new Set(fromBooks.map((c) => c.email.toLowerCase()));
    return [...fromBooks, ...fromHistory.filter((c) => !known.has(c.email.toLowerCase()))].slice(0, 8);
  }

  async takeMailto(): Promise<MailtoDraft | null> {
    // Try it in the browser: open the demo with ?mailto=mailto:someone@example.com
    const link = new URLSearchParams(window.location.search).get("mailto");
    if (!link?.toLowerCase().startsWith("mailto:") || this.mailtoTaken) return null;
    this.mailtoTaken = true;
    const [recipients = "", query = ""] = link.slice(7).split("?");
    const params = new URLSearchParams(query);
    const addresses = (value: string | null) =>
      (value ?? "")
        .split(",")
        .map((email) => email.trim())
        .filter((email) => email.includes("@"))
        .map((email) => ({ email }));
    return {
      to: [...addresses(decodeURIComponent(recipients)), ...addresses(params.get("to"))],
      cc: addresses(params.get("cc")),
      bcc: addresses(params.get("bcc")),
      subject: params.get("subject") ?? "",
      body: params.get("body") ?? "",
    };
  }

  subscribe(listener: (event: BackendEvent) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(event: BackendEvent) {
    for (const listener of this.listeners) listener(event);
  }

  private emitChanged(messageIds: string[]) {
    const accounts = new Set(this.messages.filter((m) => messageIds.includes(m.id)).map((m) => m.accountId));
    for (const accountId of accounts) this.emit({ type: "mail:changed", accountId });
  }

  private moveToRole(messageIds: string[], role: "archive" | "trash" | "junk" | "inbox") {
    const moved: MovedMessage[] = [];
    for (const message of this.messages) {
      const target = `${message.accountId}:${role}`;
      if (!messageIds.includes(message.id) || message.folderId === target) continue;
      moved.push({ id: message.id, fromFolderId: message.folderId });
      message.folderId = target;
    }
    this.emitChanged(messageIds);
    return moved;
  }

  private roleOf(message: Message) {
    return this.folders.find((f) => f.id === message.folderId)?.role ?? null;
  }

  private inView(message: Message, query: ThreadQuery) {
    const { view } = query;
    if (query.accountIds && !query.accountIds.includes(message.accountId)) return false;
    if (view.kind === "folder") return message.folderId === view.folderId;
    const role = this.roleOf(message);
    switch (view.role) {
      case "inbox":
        return role === "inbox";
      case "unread":
        return role === "inbox" && !message.flags.seen;
      case "flagged":
        return message.flags.flagged && role !== "trash";
      case "drafts":
        return role === "drafts";
      case "sent":
        return role === "sent";
    }
  }

  private matchesFilter(message: Message, query: ThreadQuery) {
    if (query.filter === "unread" && message.flags.seen) return false;
    if (query.filter === "flagged" && !message.flags.flagged) return false;
    if (query.filter === "attachments" && message.attachments.length === 0) return false;
    const search = query.search?.trim().toLowerCase();
    if (!search) return true;
    return [message.subject, message.from.name ?? "", message.from.email, message.bodyText ?? ""]
      .join("\n")
      .toLowerCase()
      .includes(search);
  }

  private threadMessages(threadId: string, trashed: boolean) {
    return this.messages
      .filter((m) => m.threadId === threadId && (this.roleOf(m) === "trash") === trashed)
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  private summarize(id: string, list: Message[]): ThreadSummary {
    const sorted = [...list].sort((a, b) => a.date.localeCompare(b.date));
    const last = sorted[sorted.length - 1]!;
    const firstSubject = sorted[0]!.subject;
    return {
      id,
      accountIds: [...new Set(sorted.map((m) => m.accountId))],
      subject: firstSubject,
      participants: uniqueAddresses(sorted.map((m) => m.from)),
      snippet: last.snippet,
      lastDate: last.date,
      messageCount: sorted.length,
      unreadCount: sorted.filter((m) => !m.flags.seen).length,
      flagged: sorted.some((m) => m.flags.flagged),
      hasAttachments: sorted.some((m) => m.attachments.length > 0),
      hasDraft: sorted.some((m) => m.flags.draft),
    };
  }
}
