import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { backend } from "@/backend/backend";
import { useT } from "@/i18n";
import { useIsPhone, useMediaQuery } from "@/lib/device";
import { useHotkeys, type HotkeyMap } from "@/lib/hotkeys";
import { useAccounts, useBackendEvents, useIdentities, useSignatures } from "@/lib/queries";
import { useUi } from "@/state/ui";
import { CalendarShell } from "../calendar/CalendarShell";
import { ContactEditor } from "../contacts/ContactEditor";
import { ContactsShell } from "../contacts/ContactsShell";
import { DeleteContactQuestion } from "../contacts/DeleteContactQuestion";
import { useContactsAvailable } from "../contacts/useContactsData";
import { useCalendarsAvailable } from "../calendar/useCalendarData";
import { Composer } from "../compose/Composer";
import { loadLocalDraft } from "../compose/localDraft";
import { FolderDialogs } from "../mail/FolderDialogs";
import { MailboxNav } from "../mail/MailboxNav";
import { scrollReader, wantsTextSelectAll } from "../mail/readerKeys";
import { MoveDialog } from "../mail/MoveDialog";
import { MobileShell } from "../mobile/MobileShell";
import { ThreadList } from "../mail/ThreadList";
import { ThreadReader } from "../mail/ThreadReader";
import { SettingsDialog } from "../settings/SettingsDialog";
import { buildCommands } from "./commands";
import { CommandPalette } from "./CommandPalette";
import { ShortcutsDialog } from "./ShortcutsDialog";

/** Keys that scroll the open mail from the list as well. */
const SCROLL_KEYS = [" ", "PageDown", "PageUp", "Home", "End"];

/** Wide enough for folders, list and reader side by side. */
const THREE_COLUMNS = "(min-width: 1100px)";

export function MailShell() {
  const { t } = useT();
  const client = useQueryClient();
  const selectedThreadId = useUi((s) => s.selectedThreadId);
  const drawerOpen = useUi((s) => s.folderDrawerOpen);
  const setDrawerOpen = useUi((s) => s.setFolderDrawerOpen);
  const phone = useIsPhone();
  const roomForFolders = useMediaQuery(THREE_COLUMNS);
  useAccounts();
  // Loaded early, so a reply opens with the right sender address.
  useIdentities();
  // Likewise the signatures, so a new mail starts with its default one already in place.
  useSignatures();
  useBackendEvents();

  // A draft that never reached the Drafts folder comes back when the tab opens again.
  // The phone brings back every kept draft as its bar (MobileShell).
  useEffect(() => {
    if (phone) return;
    const saved = loadLocalDraft();
    const ui = useUi.getState();
    if (!saved || saved.savedToServer !== false || ui.compose) return;
    ui.openCompose({ mode: saved.mode, restore: saved });
    ui.setComposeMinimized(true);
  }, [phone]);

  const section = useUi((s) => s.section);
  const { data: calendarAvailable = false } = useCalendarsAvailable();
  const { data: contactsAvailable = false } = useContactsAvailable();
  const commands = useMemo(
    () => buildCommands(client, t, { calendar: calendarAvailable, contacts: contactsAvailable }),
    [client, t, calendarAvailable, contactsAvailable],
  );

  const hotkeys = useMemo(() => {
    const map: HotkeyMap = {
      "mod+k": () => useUi.getState().setPaletteOpen(true),
      j: () => useUi.getState().selectRelative(1),
      k: () => useUi.getState().selectRelative(-1),
      Escape: () => {
        const ui = useUi.getState();
        if (ui.folderDrawerOpen) ui.setFolderDrawerOpen(false);
        else if (ui.checkedThreadIds.length > 0) ui.setCheckedThreadIds([]);
        else if (ui.selectedThreadId) ui.selectThread(null);
      },
    };
    for (const command of commands) {
      for (const key of command.keys ?? []) map[key] = () => void command.run();
    }
    // The phone keeps its own gestures and selection; these belong to the list and reader side by side.
    if (phone) {
      delete map["mod+a"];
    } else {
      // Always the mail above or below, also while reading; with Shift they tick a range instead.
      map.ArrowDown = (event) => {
        const ui = useUi.getState();
        if (event.shiftKey) ui.extendSelection(1);
        else ui.selectRelative(1);
      };
      map.ArrowUp = (event) => {
        const ui = useUi.getState();
        if (event.shiftKey) ui.extendSelection(-1);
        else ui.selectRelative(-1);
      };
      // Ticks what the list has loaded, unless the user means the text in a field or the mail.
      map["mod+a"] = (event) => {
        const ui = useUi.getState();
        if (wantsTextSelectAll(event) || ui.visibleThreadIds.length === 0) return false;
        ui.checkAllVisible();
      };
      for (const key of SCROLL_KEYS) map[key] = scrollReader;
    }
    return map;
  }, [commands, phone]);
  // The calendar and the contacts bring their own keys.
  useHotkeys(hotkeys, { enabled: section === "mail", repeat: ["j", "k", "ArrowDown", "ArrowUp", ...SCROLL_KEYS] });

  return (
    <div className="flex h-full flex-col">
      {backend().kind === "demo" && (
        <p className="shrink-0 bg-pink-tint py-1 text-center text-[12px] font-semibold text-pink-ink">
          {t("status.demo")}
        </p>
      )}

      {section === "calendar" ? (
        <CalendarShell />
      ) : section === "contacts" ? (
        <ContactsShell />
      ) : phone ? (
        <MobileShell />
      ) : (
        <div className="relative flex min-h-0 flex-1 gap-3 p-3">
          {roomForFolders && (
            <MailboxNav className="min-h-0 w-[240px] shrink-0 rounded-[22px] border border-hairline" />
          )}
          <ThreadList
            variant="simple"
            className={clsx(
              "rounded-[22px] border border-hairline",
              selectedThreadId
                ? "hidden w-[380px] shrink-0 lg:flex"
                : "w-full max-w-[560px] shrink-0 max-lg:max-w-none",
            )}
          />
          <ThreadReader
            variant="simple"
            className={clsx(
              "min-w-0 flex-1 overflow-hidden rounded-[22px] border border-hairline",
              !selectedThreadId && "max-lg:hidden",
            )}
          />

          {drawerOpen && !roomForFolders && (
            <div className="absolute inset-0 z-30 flex" role="presentation">
              <button
                type="button"
                aria-label={t("common.close")}
                onClick={() => setDrawerOpen(false)}
                className="absolute inset-0 animate-fade bg-[#1c1420]/30"
              />
              <MailboxNav className="relative w-[280px] animate-slide-up rounded-r-[22px] bg-surface shadow-float" />
            </div>
          )}
        </div>
      )}

      <Composer />
      <SettingsDialog />
      <CommandPalette commands={commands} />
      <ShortcutsDialog />
      <MoveDialog />
      <FolderDialogs />
      <ContactEditor />
      <DeleteContactQuestion />
    </div>
  );
}
