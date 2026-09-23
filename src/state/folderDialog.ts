import { create } from "zustand";
import type { Folder } from "@/backend/types";

/** The folder question on screen: a new folder, a new name, deleting or emptying one. */
export type FolderDialog =
  | { kind: "create"; accountId: string; parent: Folder | null }
  | { kind: "rename"; folder: Folder }
  | { kind: "delete"; folder: Folder }
  | { kind: "empty"; folder: Folder };

export const useFolderDialog = create<{ dialog: FolderDialog | null }>()(() => ({ dialog: null }));

export function openFolderDialog(dialog: FolderDialog) {
  useFolderDialog.setState({ dialog });
}

export function closeFolderDialog() {
  useFolderDialog.setState({ dialog: null });
}
