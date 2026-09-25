/**
 * Folders other people share with the account, and sharing one's own (see the server's
 * docs/sharing.md).
 *
 * Everyone who shares folders is an account of its own in the session (`isPersonal: false`),
 * holding only what they share. The interface works with one list of folders and messages, so ids
 * from those accounts carry their account: `a3~m12`. JMAP ids never contain `~` (RFC 8620 allows
 * only `A-Za-z0-9_-`), so the own account's ids stay as they are and nothing can be mistaken.
 */

import type { FolderRights, Person, ShareLevel, SharedAccount } from "../types";
import type { JmapAccount } from "./client";
import type { JmapEmail } from "./convert";

export const PRINCIPALS = "urn:ietf:params:jmap:principals";
export const PRINCIPALS_OWNER = "urn:ietf:params:jmap:principals:owner";

const SEPARATOR = "~";

/** An id as the interface knows it: bare for the own account, with its account for a shared one. */
export function scopeId(accountId: string, id: string, ownAccountId: string): string {
  return accountId === ownAccountId ? id : `${accountId}${SEPARATOR}${id}`;
}

/** The account an id belongs to, and the id that account knows it by. */
export function unscopeId(id: string, ownAccountId: string): { accountId: string; id: string } {
  const at = id.indexOf(SEPARATOR);
  return at < 0 ? { accountId: ownAccountId, id } : { accountId: id.slice(0, at), id: id.slice(at + 1) };
}

/** Ids grouped by the account they belong to, bare. */
export function groupByAccount(ids: string[], ownAccountId: string): Map<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const scoped of ids) {
    const { accountId, id } = unscopeId(scoped, ownAccountId);
    groups.set(accountId, [...(groups.get(accountId) ?? []), id]);
  }
  return groups;
}

/** A message of a shared account with its ids (own, thread, mailboxes) as the interface knows them. */
export function scopeEmail<T extends Pick<JmapEmail, "id" | "threadId" | "mailboxIds">>(
  email: T,
  accountId: string,
  ownAccountId: string,
): T {
  if (accountId === ownAccountId) return email;
  return {
    ...email,
    id: scopeId(accountId, email.id, ownAccountId),
    threadId: email.threadId ? scopeId(accountId, email.threadId, ownAccountId) : email.threadId,
    mailboxIds: Object.fromEntries(
      Object.entries(email.mailboxIds ?? {}).map(([id, value]) => [scopeId(accountId, id, ownAccountId), value]),
    ),
  };
}

export interface JmapRights {
  mayReadItems?: boolean;
  mayAddItems?: boolean;
  mayRemoveItems?: boolean;
  maySetSeen?: boolean;
  maySetKeywords?: boolean;
  mayCreateChild?: boolean;
  mayRename?: boolean;
  mayDelete?: boolean;
  maySubmit?: boolean;
  mayAdmin?: boolean;
}

/** `myRights` as the interface uses them; a server that leaves them out means everything. */
export function toFolderRights(rights: JmapRights | null | undefined): FolderRights {
  const has = (value: boolean | undefined) => (rights ? value === true : true);
  return {
    mayReadItems: has(rights?.mayReadItems),
    mayAddItems: has(rights?.mayAddItems),
    mayRemoveItems: has(rights?.mayRemoveItems),
    maySetSeen: has(rights?.maySetSeen),
    maySetKeywords: has(rights?.maySetKeywords),
    mayCreateChild: has(rights?.mayCreateChild),
    mayRename: has(rights?.mayRename),
    mayDelete: has(rights?.mayDelete),
    // Older servers had no sharing, and without `mayAdmin` nobody can share.
    mayAdmin: rights?.mayAdmin === true,
  };
}

/** The level a share's rights amount to, as the portal shows it. */
export function shareLevel(rights: JmapRights | string | null | undefined): ShareLevel {
  if (rights === "read" || rights === "write" || rights === "all") return rights;
  if (!rights || typeof rights !== "object") return "read";
  if (rights.mayAdmin) return "all";
  if (rights.mayAddItems || rights.mayRemoveItems || rights.maySetKeywords || rights.maySetSeen) return "write";
  return "read";
}

/** `shareWith` as principal id → level; nothing for a folder the account may not share. */
export function sharedWithFrom(
  shareWith: Record<string, JmapRights | string | null> | null | undefined,
): Record<string, ShareLevel> | undefined {
  if (!shareWith || typeof shareWith !== "object") return undefined;
  const levels: Record<string, ShareLevel> = {};
  for (const [principal, rights] of Object.entries(shareWith)) {
    if (rights) levels[principal] = shareLevel(rights);
  }
  return levels;
}

export interface JmapPrincipal {
  id: string;
  type?: string;
  name?: string | null;
  email?: string | null;
  accounts?: Record<string, unknown> | null;
}

/** People to share with: everyone the server lists but the account itself, by name. */
export function peopleFrom(principals: JmapPrincipal[], ownPrincipalId: string | null, ownEmail: string): Person[] {
  const own = ownEmail.toLowerCase();
  return principals
    .filter((principal) => (principal.type ?? "individual") === "individual")
    .filter((principal) => principal.id !== ownPrincipalId && (principal.email ?? "").toLowerCase() !== own)
    .map((principal) => ({
      id: principal.id,
      email: principal.email ?? "",
      name: principal.name?.trim() || principal.email || principal.id,
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.email.localeCompare(b.email));
}

/** The accounts of people who share folders, with their names where the principals say them. */
export function sharedAccountsFrom(
  accounts: Record<string, JmapAccount>,
  ownAccountId: string,
  principals: JmapPrincipal[] = [],
): SharedAccount[] {
  return Object.entries(accounts)
    .filter(
      ([id, account]) =>
        id !== ownAccountId && !account.isPersonal && "urn:ietf:params:jmap:mail" in account.accountCapabilities,
    )
    .map(([id, account]) => {
      const owner = account.accountCapabilities[PRINCIPALS_OWNER] as { principalId?: unknown } | undefined;
      const principal = principals.find(
        (entry) =>
          (typeof owner?.principalId === "string" && entry.id === owner.principalId) ||
          (entry.accounts !== null && entry.accounts !== undefined && id in entry.accounts),
      );
      return {
        id,
        email: account.name,
        name: principal?.name?.trim() || account.name,
        readOnly: account.isReadOnly,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}
