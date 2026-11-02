// Changing how mailboxes and folders are arranged (lib/arrangement). Everything here is a synced
// setting, so it follows the account to the app and other browsers.

import { useMemo } from "react";
import type { Account } from "@/backend/types";
import { accountAddress, hiddenFromUnified, moveInOrder, orderAccounts, resolveRefs, withRef } from "@/lib/arrangement";
import { useAccounts, useFolders } from "@/lib/queries";
import { type FolderRef, useSettings } from "@/state/settings";

type FolderList = "unifiedFolders" | "favoriteFolders" | "hiddenFolders";

/** Adds a folder (see `folderRefOf`) to one of the folder lists, or takes it out. */
export function setFolderListed(list: FolderList, ref: FolderRef, on: boolean) {
  const settings = useSettings.getState();
  settings.update({ [list]: withRef(settings[list], ref, on) });
}

/** Leaves a mailbox out of the unified views and their counts, or takes it back in. */
export function setHiddenFromUnified(account: Pick<Account, "email">, hide: boolean) {
  const settings = useSettings.getState();
  const address = accountAddress(account);
  const others = settings.unifiedHidden.filter((each) => each !== address);
  settings.update({ unifiedHidden: hide ? [...others, address] : others });
}

/**
 * Moves a mailbox (the own one or somebody's who shares folders) to the place of another one,
 * `mailboxes` being all of them as the sidebar shows them. Addresses the app knows and this page
 * doesn't keep their places behind.
 */
export function moveMailbox(mailboxes: readonly Pick<Account, "email">[], from: number, to: number) {
  const settings = useSettings.getState();
  const addresses = [...new Set(orderAccounts(mailboxes, settings.accountsOrder).map(accountAddress))];
  settings.update({ accountsOrder: moveInOrder(addresses, from, to, settings.accountsOrder) });
}

/** What the unified inbox's count leaves out and takes in besides the inbox. */
export function useUnifiedTally() {
  const { data: accounts = [] } = useAccounts();
  const { data: folders = [] } = useFolders();
  const hidden = useSettings((s) => s.unifiedHidden);
  const extra = useSettings((s) => s.unifiedFolders);
  return useMemo(
    () => ({
      leftOut: accounts.filter((account) => hiddenFromUnified(account, hidden)).map((account) => account.id),
      extraFolderIds: resolveRefs(extra, accounts, folders).map((folder) => folder.id),
    }),
    [accounts, folders, hidden, extra],
  );
}
