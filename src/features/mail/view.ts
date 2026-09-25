import {
  FileText,
  Folder as FolderIcon,
  Inbox,
  Mailbox,
  Send,
  ShieldAlert,
  Archive,
  Trash,
  Star,
  MailOpen,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Account, Folder, FolderRole, MailboxView } from "@/backend/types";
import { useT } from "@/i18n";
import { useAccounts, useFolders, useSharedAccounts } from "@/lib/queries";
import { folderRights, type MailRights } from "./rights";

export const ROLE_ICONS: Record<FolderRole, LucideIcon> = {
  inbox: Inbox,
  drafts: FileText,
  sent: Send,
  archive: Archive,
  junk: ShieldAlert,
  trash: Trash,
};

export const UNIFIED_ICONS = {
  inbox: Mailbox,
  unread: MailOpen,
  flagged: Star,
  drafts: FileText,
  sent: Send,
} as const;

export function folderIcon(folder: Folder): LucideIcon {
  return folder.role ? ROLE_ICONS[folder.role] : FolderIcon;
}

export function sameView(a: MailboxView, b: MailboxView): boolean {
  if (a.kind === "unified" && b.kind === "unified") return a.role === b.role;
  if (a.kind === "folder" && b.kind === "folder") return a.folderId === b.folderId;
  return false;
}

export interface ViewInfo {
  title: string;
  subtitle?: string;
  account?: Account;
  /** The folder on screen, when it is one. */
  folder?: Folder;
  isInbox: boolean;
  /** Opening a conversation here continues the draft instead of reading it. */
  isDrafts: boolean;
  /** Deleting here means for good. */
  isTrash: boolean;
  /** Mail here is spam already, so "spam" means "not spam". */
  isJunk: boolean;
  /** What the list's actions may do here: everything but in folders somebody shares. */
  rights: MailRights;
}

export function useViewInfo(view: MailboxView): ViewInfo {
  const { t } = useT();
  const { data: accounts = [] } = useAccounts();
  const { data: folders = [] } = useFolders();
  const { data: shared = [] } = useSharedAccounts();

  if (view.kind === "unified") {
    const title = view.role === "inbox" ? t("nav.inbox") : t(`nav.${view.role}`);
    return {
      title,
      isInbox: view.role === "inbox",
      isDrafts: view.role === "drafts",
      isTrash: false,
      isJunk: false,
      rights: folderRights(undefined),
    };
  }
  const folder = folders.find((f) => f.id === view.folderId);
  const account = accounts.find((a) => a.id === view.accountId);
  const owner = folder?.shared ? shared.find((entry) => entry.id === folder.accountId) : undefined;
  return {
    title: folder?.name ?? "",
    subtitle: owner ? t("sharing.sharedBy", { name: owner.name }) : account?.email,
    account,
    folder,
    isInbox: folder?.role === "inbox",
    isDrafts: folder?.role === "drafts",
    // A shared folder has no trash of this account: deleting there is for good.
    isTrash: folder?.role === "trash" || folder?.shared === true,
    isJunk: folder?.role === "junk",
    rights: folderRights(folder),
  };
}
