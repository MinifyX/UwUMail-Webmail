import type { Folder, FolderRights } from "@/backend/types";

/**
 * What can be done with some mail, from the folders it lies in. The account's own mail allows
 * everything; mail in a folder somebody shares allows what they chose, and never archive, trash or
 * spam: those are the account's own folders, and shared mail stays in its owner's mailbox.
 */
export interface MailRights {
  /** Somebody else's folder. */
  shared: boolean;
  markSeen: boolean;
  flag: boolean;
  /** Move to another folder (of the same mailbox), or delete for good in a shared one. */
  remove: boolean;
  archive: boolean;
  spam: boolean;
}

const ALL: MailRights = { shared: false, markSeen: true, flag: true, remove: true, archive: true, spam: true };

function has(rights: FolderRights | undefined, right: keyof FolderRights): boolean {
  return rights ? rights[right] : true;
}

/** The rights every one of these folders allows; unknown folders count as the account's own. */
export function mailRights(folderIds: string[], folders: Folder[]): MailRights {
  const found = folderIds.map((id) => folders.find((folder) => folder.id === id)).filter((f): f is Folder => !!f);
  if (found.length === 0) return ALL;
  const shared = found.some((folder) => folder.shared === true);
  const every = (right: keyof FolderRights) => found.every((folder) => has(folder.rights, right));
  return {
    shared,
    markSeen: every("maySetSeen"),
    flag: every("maySetKeywords"),
    remove: every("mayRemoveItems"),
    archive: !shared,
    spam: !shared,
  };
}

/** The rights of a folder on screen, for the list's actions; the unified views are the own mail. */
export function folderRights(folder: Folder | undefined): MailRights {
  return folder ? mailRights([folder.id], [folder]) : ALL;
}
