/** Turning JMAP objects (RFC 8621) into the shapes the interface works with. */

import type { JmapRights } from "./sharing";
import type {
  Address,
  Attachment,
  Folder,
  FolderRole,
  Message,
  MessageFlags,
  ThreadSummary,
  Unsubscribe,
} from "../types";

export interface JmapMailbox {
  id: string;
  name: string;
  parentId: string | null;
  role: string | null;
  sortOrder?: number;
  totalEmails: number;
  unreadEmails: number;
  myRights?: JmapRights | null;
  /** Who else sees it (RFC 9670), by principal id; null when the account may not share it. */
  shareWith?: Record<string, JmapRights | string | null> | null;
}

export interface JmapAddress {
  name?: string | null;
  email: string;
}

export interface JmapBodyPart {
  partId?: string | null;
  blobId?: string | null;
  size?: number;
  name?: string | null;
  type?: string | null;
  cid?: string | null;
  disposition?: string | null;
}

export interface JmapEmail {
  id: string;
  threadId: string;
  mailboxIds: Record<string, boolean>;
  keywords: Record<string, boolean>;
  from?: JmapAddress[] | null;
  to?: JmapAddress[] | null;
  cc?: JmapAddress[] | null;
  bcc?: JmapAddress[] | null;
  replyTo?: JmapAddress[] | null;
  subject?: string | null;
  receivedAt: string;
  sentAt?: string | null;
  preview?: string | null;
  hasAttachment?: boolean;
  attachments?: JmapBodyPart[] | null;
  htmlBody?: JmapBodyPart[] | null;
  textBody?: JmapBodyPart[] | null;
  bodyValues?: Record<string, { value: string; isTruncated?: boolean }>;
  messageId?: string[] | null;
  inReplyTo?: string[] | null;
  references?: string[] | null;
  size?: number;
  /** Our extension: the HTML body cleaned by the server, ready for the frame. */
  uwuSafeHtml?: string | null;
  /** Our extension: the cleaned body left out remote images or frames. */
  uwuHasRemoteContent?: boolean;
  "header:List-Unsubscribe:asURLs"?: string[] | null;
  "header:List-Unsubscribe-Post:asText"?: string | null;
}

export interface JmapThread {
  id: string;
  emailIds: string[];
}

const ROLES: Record<string, FolderRole> = {
  inbox: "inbox",
  sent: "sent",
  drafts: "drafts",
  archive: "archive",
  trash: "trash",
  junk: "junk",
};

/** Which mailbox a message is shown in when it sits in several. */
const ROLE_ORDER: (FolderRole | "custom")[] = ["trash", "junk", "inbox", "custom", "drafts", "sent", "archive"];

export function folderRole(role: string | null | undefined): FolderRole | null {
  return role ? (ROLES[role.toLowerCase()] ?? null) : null;
}

export function toFolder(mailbox: JmapMailbox, accountId: string, all: JmapMailbox[]): Folder {
  const byId = new Map(all.map((box) => [box.id, box]));
  const parts: string[] = [];
  let current: JmapMailbox | undefined = mailbox;
  // Guarded against a cycle a broken server could hand us.
  for (let depth = 0; current && depth < 64; depth += 1) {
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return {
    id: mailbox.id,
    accountId,
    name: mailbox.name,
    path: parts.join("/"),
    role: folderRole(mailbox.role),
    parentId: mailbox.parentId,
    selectable: mailbox.myRights?.mayReadItems !== false,
    unread: mailbox.unreadEmails,
    total: mailbox.totalEmails,
  };
}

export function toAddress(address: JmapAddress | undefined): Address {
  if (!address) return { email: "" };
  return address.name ? { name: address.name, email: address.email } : { email: address.email };
}

export function toAddresses(list: JmapAddress[] | null | undefined): Address[] {
  return (list ?? []).map(toAddress);
}

export function toFlags(keywords: Record<string, boolean>): MessageFlags {
  return {
    seen: keywords.$seen === true,
    flagged: keywords.$flagged === true,
    answered: keywords.$answered === true,
    draft: keywords.$draft === true,
  };
}

/** The own keywords of a mail: set, lower case, without the `$` system ones (`$seen`, `$junk`, …). */
export function ownKeywords(keywords: Record<string, boolean> | undefined): string[] {
  return [
    ...new Set(
      Object.entries(keywords ?? {})
        .filter(([keyword, set]) => set === true && !keyword.startsWith("$"))
        .map(([keyword]) => keyword.toLowerCase()),
    ),
  ].sort();
}

/** The mailbox a message is filed under for the interface: the most telling one. */
export function mainMailbox(email: JmapEmail, folders: Map<string, Folder>): string {
  const ids = Object.keys(email.mailboxIds).filter((id) => email.mailboxIds[id]);
  let best: { id: string; rank: number } | null = null;
  for (const id of ids) {
    const role = folders.get(id)?.role ?? null;
    const rank = ROLE_ORDER.indexOf(role ?? "custom");
    if (rank >= 0 && (best === null || rank < best.rank)) best = { id, rank };
  }
  return best?.id ?? ids[0] ?? "";
}

function partText(email: JmapEmail, part: JmapBodyPart | undefined): string | null {
  if (!part?.partId) return null;
  return email.bodyValues?.[part.partId]?.value ?? null;
}

export function toAttachments(email: JmapEmail): Attachment[] {
  return (email.attachments ?? [])
    .filter((part) => !!part.blobId)
    .map((part) => ({
      id: `${email.id}:${part.blobId}`,
      filename: part.name ?? "attachment",
      mimeType: part.type ?? "application/octet-stream",
      size: part.size ?? 0,
      inline: part.disposition === "inline" || !!part.cid,
      ...(part.cid ? { contentId: part.cid } : {}),
    }));
}

/**
 * How the mail says to unsubscribe. `serverOneClick` says the server does the one-click POST
 * (UwUMail's unsubscribe extension); it is offered for every mail with a List-Unsubscribe-Post
 * header, and the server checks the rest (the https link, the DKIM signature over both headers).
 */
export function toUnsubscribe(email: JmapEmail, serverOneClick = false): Unsubscribe | undefined {
  const values = email["header:List-Unsubscribe:asURLs"] ?? [];
  if (values.length === 0) return undefined;
  const url = values.find((value) => value.startsWith("https://"));
  const mailto = values.find((value) => value.startsWith("mailto:"));
  const oneClick = serverOneClick && (email["header:List-Unsubscribe-Post:asText"] ?? "").trim() !== "";
  return {
    oneClick,
    ...(url ? { url } : {}),
    ...(mailto ? { mailto } : {}),
  };
}

export function toMessage(
  email: JmapEmail,
  accountId: string,
  folders: Map<string, Folder>,
  serverOneClick = false,
): Message {
  const text = partText(email, email.textBody?.[0] ?? undefined);
  const unsubscribe = toUnsubscribe(email, serverOneClick);
  const keywords = ownKeywords(email.keywords);
  return {
    id: email.id,
    threadId: email.threadId,
    accountId,
    folderId: mainMailbox(email, folders),
    from: toAddress(email.from?.[0] ?? undefined),
    to: toAddresses(email.to),
    cc: toAddresses(email.cc),
    bcc: toAddresses(email.bcc),
    replyTo: toAddresses(email.replyTo),
    subject: email.subject ?? "",
    date: email.receivedAt,
    flags: toFlags(email.keywords),
    snippet: email.preview ?? "",
    bodyHtml: email.uwuSafeHtml ?? null,
    bodyText: text,
    hasRemoteContent: email.uwuHasRemoteContent === true,
    attachments: toAttachments(email),
    ...(unsubscribe ? { unsubscribe } : {}),
    ...(keywords.length > 0 ? { keywords } : {}),
  };
}

/** One row of the list, built from every message of a conversation the query matched. */
export function toThreadSummary(id: string, emails: JmapEmail[], accountId: string): ThreadSummary {
  const sorted = [...emails].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const newest = sorted[sorted.length - 1];
  const participants: Address[] = [];
  const seen = new Set<string>();
  const keywords = [...new Set(sorted.flatMap((email) => ownKeywords(email.keywords)))].sort();
  for (const email of sorted) {
    const address = toAddress(email.from?.[0] ?? undefined);
    const key = address.email.toLowerCase();
    if (address.email && !seen.has(key)) {
      seen.add(key);
      participants.push(address);
    }
  }
  return {
    id,
    accountIds: [accountId],
    subject: sorted[0]?.subject ?? newest?.subject ?? "",
    participants,
    snippet: newest?.preview ?? "",
    lastDate: newest?.receivedAt ?? new Date(0).toISOString(),
    messageCount: sorted.length,
    unreadCount: sorted.filter((email) => email.keywords.$seen !== true).length,
    flagged: sorted.some((email) => email.keywords.$flagged === true),
    hasAttachments: sorted.some((email) => email.hasAttachment === true),
    hasDraft: sorted.some((email) => email.keywords.$draft === true),
    ...(keywords.length > 0 ? { keywords } : {}),
  };
}
