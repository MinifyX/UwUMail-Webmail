import { useEffect } from "react";
import { useT } from "@/i18n";
import { useBackLayer } from "@/lib/backStack";
import { useUi } from "@/state/ui";
import { loadLocalDraft } from "../compose/localDraft";
import { reopenSavedDraft } from "../compose/openDraft";
import { MailboxNav } from "../mail/MailboxNav";
import { MobileList } from "./MobileList";
import { MobileReader } from "./MobileReader";

/** The "Folders" tab: mailboxes and folders as a screen of their own, with rows for thumbs. */
function FoldersScreen() {
  const { t } = useT();
  const open = useUi((s) => s.folderDrawerOpen);
  const setOpen = useUi((s) => s.setFolderDrawerOpen);
  useBackLayer(open, () => setOpen(false));
  if (!open) return null;
  return (
    <section aria-label={t("nav.menu")} className="absolute inset-0 z-20 flex flex-col overflow-hidden bg-surface">
      <header className="px-4 pt-4 pb-1">
        <h1 className="text-large leading-tight font-extrabold tracking-[-0.02em]">{t("nav.menu")}</h1>
      </header>
      <MailboxNav className="min-h-0 flex-1 overflow-y-auto pb-6 [&_.h-9]:h-11 [&_.h-9]:text-reading" />
    </section>
  );
}

/** UwUMail on a phone: the list, the conversation on top of it, the folders as their own tab. */
export function MobileShell() {
  const selectedThreadId = useUi((s) => s.selectedThreadId);
  const selectThread = useUi((s) => s.selectThread);
  const settingsOpen = useUi((s) => s.settingsOpen);
  const addAccountOpen = useUi((s) => s.addAccountOpen);
  const compose = useUi((s) => s.compose);

  useBackLayer(selectedThreadId !== null, () => selectThread(null));
  useBackLayer(settingsOpen !== null, () => useUi.getState().closeSettings());
  useBackLayer(addAccountOpen, () => useUi.getState().setAddAccountOpen(false));

  // Whatever opens on top of the folders closes them.
  useEffect(() => {
    if (settingsOpen || addAccountOpen || compose) useUi.getState().setFolderDrawerOpen(false);
  }, [settingsOpen, addAccountOpen, compose]);

  // A draft Android didn't let us finish comes back as the bar above the write button.
  useEffect(() => {
    const saved = loadLocalDraft();
    const ui = useUi.getState();
    if (!saved || ui.compose) return;
    if (saved.emailId) {
      // Only its id was kept: the draft itself comes back from the Drafts folder.
      void reopenSavedDraft(saved.emailId);
      return;
    }
    ui.openCompose({ mode: saved.mode, restore: saved });
    ui.setComposeMinimized(true);
  }, []);

  return (
    <div className="relative h-full overflow-hidden bg-surface">
      <MobileList />
      {selectedThreadId && (
        <div className="absolute inset-0 z-10 animate-[uwu-screen-in_220ms_cubic-bezier(0.2,0.9,0.3,1)]">
          <MobileReader key={selectedThreadId} threadId={selectedThreadId} />
        </div>
      )}
      <FoldersScreen />
    </div>
  );
}
