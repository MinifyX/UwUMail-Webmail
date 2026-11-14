/**
 * The person's own mail in the server's backups, over UwUMail's JMAP extension
 * `urn:uwumail:jmap:backups` (`BackupEmail/query`, `/get`, `/restore`). See the server's
 * docs/jmap-backups.md.
 */

import type {
  Address,
  BackupMail,
  BackupMailContent,
  BackupQuery,
  BackupRestoreProblem,
  BackupRestoreResult,
  BackupSearchResult,
} from "../types";

export const BACKUPS = "urn:uwumail:jmap:backups";

interface JmapAddress {
  name?: string | null;
  email?: string | null;
}

export interface JmapBackupEmail {
  id: string;
  subject?: string | null;
  from?: JmapAddress[] | null;
  to?: JmapAddress[] | null;
  receivedAt?: string | null;
  size?: number | null;
  folder?: string | null;
  snapshots?: string[] | null;
  inMailbox?: boolean | null;
  textBody?: string | null;
  attachments?: { name?: string | null; type?: string | null; size?: number | null }[] | null;
}

export interface JmapBackupQueryResponse {
  list?: JmapBackupEmail[];
  indexing?: { done?: number; total?: number };
}

export interface JmapBackupRestoreResponse {
  restored?: Record<string, string> | null;
  alreadyThere?: string[] | null;
  notRestored?: Record<string, { type?: string }> | null;
}

/** Whether the own account's capabilities carry the extension. */
export function backupsSupported(accountCapabilities: Record<string, unknown> | undefined): boolean {
  const value = accountCapabilities?.[BACKUPS];
  return Boolean(value) && typeof value === "object";
}

/** The filter, with only what was filled in. */
export function backupFilter(query: BackupQuery): Record<string, string> {
  const filter: Record<string, string> = {};
  const text = query.text?.trim();
  if (text) filter.text = text.slice(0, 256);
  if (query.after) filter.after = query.after;
  if (query.before) filter.before = query.before;
  return filter;
}

function addresses(list: JmapAddress[] | null | undefined): Address[] {
  return (list ?? []).flatMap((entry) =>
    entry.email ? [{ email: entry.email, ...(entry.name ? { name: entry.name } : {}) }] : [],
  );
}

export function toBackupMail(raw: JmapBackupEmail): BackupMail {
  return {
    id: raw.id,
    subject: raw.subject ?? "",
    from: addresses(raw.from),
    to: addresses(raw.to),
    receivedAt: raw.receivedAt ?? new Date(0).toISOString(),
    size: raw.size ?? 0,
    folder: raw.folder ?? "",
    snapshots: raw.snapshots ?? [],
    inMailbox: raw.inMailbox === true,
  };
}

export function toBackupSearch(raw: JmapBackupQueryResponse): BackupSearchResult {
  const total = raw.indexing?.total ?? 0;
  return {
    list: (raw.list ?? []).map(toBackupMail),
    indexing: { done: Math.min(raw.indexing?.done ?? total, total), total },
  };
}

export function toBackupContent(raw: JmapBackupEmail): BackupMailContent {
  return {
    ...toBackupMail(raw),
    text: raw.textBody ?? "",
    attachments: (raw.attachments ?? []).map((item) => ({
      name: item.name ?? "",
      type: item.type ?? "application/octet-stream",
      size: item.size ?? 0,
    })),
  };
}

const PROBLEMS: readonly BackupRestoreProblem[] = ["notFound", "overQuota", "invalidEmail"];

export function toRestoreResult(raw: JmapBackupRestoreResponse): BackupRestoreResult {
  return {
    restored: raw.restored ?? {},
    alreadyThere: raw.alreadyThere ?? [],
    notRestored: Object.fromEntries(
      Object.entries(raw.notRestored ?? {}).map(([id, error]) => [
        id,
        PROBLEMS.includes(error.type as BackupRestoreProblem) ? (error.type as BackupRestoreProblem) : "other",
      ]),
    ),
  };
}
