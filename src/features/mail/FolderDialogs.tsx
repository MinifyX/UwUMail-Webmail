import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { backend } from "@/backend/backend";
import type { Folder } from "@/backend/types";
import { NyuScene } from "@/components/nyu/scenes";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, TextInput } from "@/components/ui/Field";
import { useT } from "@/i18n";
import { queryKeys, useFolders } from "@/lib/queries";
import { closeFolderDialog, useFolderDialog, type FolderDialog } from "@/state/folderDialog";
import { toast } from "@/state/toasts";
import { useUi } from "@/state/ui";
import { folderNameProblem } from "./folderName";

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** New folder, rename, delete and empty: one question at a time, see state/folderDialog. */
export function FolderDialogs() {
  const dialog = useFolderDialog((s) => s.dialog);
  const key =
    dialog === null
      ? "none"
      : dialog.kind === "create"
        ? `create:${dialog.parent?.id}`
        : `${dialog.kind}:${dialog.folder.id}`;
  return (
    <Dialog open={dialog !== null} onClose={closeFolderDialog} width="sm">
      {dialog && <FolderQuestion key={key} dialog={dialog} />}
    </Dialog>
  );
}

function FolderQuestion({ dialog }: { dialog: FolderDialog }) {
  switch (dialog.kind) {
    case "create":
    case "rename":
      return <NameForm dialog={dialog} />;
    case "delete":
      return <DeleteQuestion folder={dialog.folder} />;
    case "empty":
      return <EmptyQuestion folder={dialog.folder} />;
  }
}

function useRefreshFolders() {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.folders }),
      client.invalidateQueries({ queryKey: queryKeys.threads }),
    ]);
}

function NameForm({ dialog }: { dialog: Extract<FolderDialog, { kind: "create" | "rename" }> }) {
  const { t } = useT();
  const { data: folders = [] } = useFolders();
  const refresh = useRefreshFolders();
  const renaming = dialog.kind === "rename" ? dialog.folder : null;
  const [name, setName] = useState(renaming?.name ?? "");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const accountId = renaming?.accountId ?? (dialog.kind === "create" ? dialog.accountId : "");
  const parentId = renaming ? renaming.parentId : dialog.kind === "create" ? (dialog.parent?.id ?? null) : null;
  const siblings = folders
    .filter((f) => f.accountId === accountId && f.parentId === parentId && f.id !== renaming?.id)
    .map((f) => f.name);
  const problem = folderNameProblem(name, siblings);
  const unchanged = renaming !== null && name.trim() === renaming.name;
  // "Empty" waits for a submit; the rest shows while typing.
  const shownProblem = problem && (problem !== "empty" || touched) ? problem : null;

  const submit = async () => {
    setTouched(true);
    if (problem || unchanged) {
      if (unchanged) closeFolderDialog();
      return;
    }
    const trimmed = name.trim();
    setBusy(true);
    try {
      if (renaming) {
        await backend().renameFolder(renaming.id, trimmed);
        toast(t("folders.renamed", { name: trimmed }), "success");
      } else {
        await backend().createFolder({ accountId, name: trimmed, parentId });
        toast(t("folders.created", { name: trimmed }), "success");
      }
      closeFolderDialog();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const parent = dialog.kind === "create" ? dialog.parent : null;
  return (
    <form
      className="flex flex-col gap-4 px-6 pt-5 pb-6"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <h2 className="text-lg font-bold">{renaming ? t("folders.renameTitle") : t("folders.createTitle")}</h2>
        {parent && (
          <p className="text-[13px] text-muted">
            {t("folders.inside", { name: parent.role ? t(`folder.${parent.role}`) : parent.name })}
          </p>
        )}
      </div>
      <Field label={t("folders.name")} error={shownProblem ? t(`folders.problem.${shownProblem}`) : undefined}>
        {(id) => (
          <TextInput
            id={id}
            autoFocus
            value={name}
            maxLength={255}
            aria-invalid={shownProblem !== null}
            onChange={(event) => setName(event.target.value)}
          />
        )}
      </Field>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={closeFolderDialog}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" variant="primary" busy={busy}>
          {renaming ? t("common.save") : t("folders.create")}
        </Button>
      </div>
    </form>
  );
}

function DeleteQuestion({ folder }: { folder: Folder }) {
  const { t } = useT();
  const { data: folders = [] } = useFolders();
  const refresh = useRefreshFolders();
  const [busy, setBusy] = useState(false);
  const current = folders.find((f) => f.id === folder.id) ?? folder;
  const hasChildren = folders.some((f) => f.parentId === folder.id);

  if (hasChildren) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 pt-5 pb-6 text-center">
        <h2 className="text-[18px] font-extrabold text-balance">
          {t("folders.hasChildrenTitle", { name: folder.name })}
        </h2>
        <p className="text-[13px] text-muted">{t("folders.hasChildrenBody")}</p>
        <Button autoFocus onClick={closeFolderDialog}>
          {t("common.close")}
        </Button>
      </div>
    );
  }

  const remove = async () => {
    setBusy(true);
    try {
      await backend().deleteFolder(folder.id);
      const ui = useUi.getState();
      if (ui.view.kind === "folder" && ui.view.folderId === folder.id) ui.setView({ kind: "unified", role: "inbox" });
      toast(t("folders.deleted", { name: folder.name }), "success");
      closeFolderDialog();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-2 pb-6 text-center">
      <NyuScene name="goodbye" className="w-36" />
      <h2 className="text-[18px] font-extrabold text-balance">{t("folders.deleteTitle", { name: folder.name })}</h2>
      <p className="text-[13px] text-muted">
        {current.total > 0 ? t("folders.deleteBody", { count: current.total }) : t("folders.deleteBodyEmpty")}
      </p>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <Button variant="danger" autoFocus busy={busy} onClick={() => void remove()}>
          {t("folders.deleteConfirm")}
        </Button>
        <Button variant="ghost" onClick={closeFolderDialog}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}

function EmptyQuestion({ folder }: { folder: Folder }) {
  const { t } = useT();
  const { data: folders = [] } = useFolders();
  const refresh = useRefreshFolders();
  const [busy, setBusy] = useState(false);
  const count = (folders.find((f) => f.id === folder.id) ?? folder).total;
  const role = folder.role === "junk" ? "junk" : "trash";

  const empty = async () => {
    setBusy(true);
    try {
      const removed = await backend().emptyFolder(folder.id);
      useUi.getState().selectThread(null);
      toast(t("folders.emptied", { count: removed }), "success");
      closeFolderDialog();
    } catch (error) {
      toast(errorText(error), "error");
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  return (
    <div className="flex flex-col items-center gap-3 px-6 pt-2 pb-6 text-center">
      <NyuScene name="goodbye" className="w-36" />
      <h2 className="text-[18px] font-extrabold text-balance">{t(`folders.emptyTitle.${role}`)}</h2>
      <p className="text-[13px] text-muted">{t("folders.emptyBody", { count })}</p>
      <div className="flex flex-wrap justify-center gap-2 pt-1">
        <Button variant="danger" autoFocus busy={busy} onClick={() => void empty()}>
          {t(`folders.empty.${role}`)}
        </Button>
        <Button variant="ghost" onClick={closeFolderDialog}>
          {t("common.cancel")}
        </Button>
      </div>
    </div>
  );
}
