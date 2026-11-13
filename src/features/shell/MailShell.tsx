import { ResizeHandle } from "@uwusuite/design";
import clsx from "clsx";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { backend } from "@/backend/backend";
import { useT } from "@/i18n";
import { useIsPhone, useMediaQuery } from "@/lib/device";
import { useBackLayer } from "@/lib/backStack";
import { useHotkeys, type HotkeyMap } from "@/lib/hotkeys";
import { fitPanes, KEY_STEP, PANE_LIMITS, type Pane } from "@/lib/paneSizes";
import { useAccounts, useBackendEvents, useIdentities, useSignatures } from "@/lib/queries";
import { usePanes } from "@/state/panes";
import { useUi } from "@/state/ui";
import { CalendarShell } from "../calendar/CalendarShell";
import { DeleteScopeQuestion } from "../calendar/DeleteScopeQuestion";
import { EventEditor } from "../calendar/EventEditor";
import { openLinkedMail } from "../dates/mailLink";
import { ContactEditor } from "../contacts/ContactEditor";
import { ContactsShell } from "../contacts/ContactsShell";
import { DeleteContactQuestion } from "../contacts/DeleteContactQuestion";
import { useContactsAvailable } from "../contacts/useContactsData";
import { useCalendarsAvailable } from "../calendar/useCalendarData";
import { Composer } from "../compose/Composer";
import { loadLocalDraft } from "../compose/localDraft";
import { useAssistOptions } from "../assist/useAssist";
import { LabelPicker } from "../labels/LabelMenus";
import { LabelSuggestDialog } from "../labels/LabelSuggest";
import { FolderDialogs } from "../mail/FolderDialogs";
import { MailboxNav } from "../mail/MailboxNav";
import { scrollReader, wantsTextSelectAll } from "../mail/readerKeys";
import { MoveDialog } from "../mail/MoveDialog";
import { useSnoozeRunner } from "../mail/snooze";
import { usePushFilterSync } from "@/push";
import { SnoozeDialog } from "../mail/SnoozeDialog";
import { MobileShell } from "../mobile/MobileShell";
import { ThreadList } from "../mail/ThreadList";
import { ThreadReader } from "../mail/ThreadReader";
import { SettingsDialog } from "../settings/SettingsDialog";
import { buildCommands } from "./commands";
import { CommandPalette } from "./CommandPalette";
import { IconRail, MoreScreen, PhoneTabBar, TopBar, useFrameHotkeys } from "./Frame";
import { ShortcutsDialog } from "./ShortcutsDialog";

/** Keys that scroll the open mail from the list as well. */
const SCROLL_KEYS = [" ", "PageDown", "PageUp", "Home", "End"];

/** Wide enough for folders, list and reader side by side. */
const THREE_COLUMNS = "(min-width: 1100px)";
/** Wide enough for list and reader side by side (Tailwind's `lg`). */
const TWO_COLUMNS = "(min-width: 1024px)";
/** The border around list and reader, and the handle right of the folders, in pixels. */
const CHROME = 2;
const HANDLE = 12;

/** The width of an element, following it as the window changes. */
function useWidth() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry?.contentRect.width ?? null));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function MailShell() {
  const { t } = useT();
  const client = useQueryClient();
  const selectedThreadId = useUi((s) => s.selectedThreadId);
  const drawerOpen = useUi((s) => s.folderDrawerOpen);
  const setDrawerOpen = useUi((s) => s.setFolderDrawerOpen);
  const moreOpen = useUi((s) => s.moreOpen);
  const phone = useIsPhone();
  const roomForFolders = useMediaQuery(THREE_COLUMNS);
  const sideBySide = useMediaQuery(TWO_COLUMNS);
  const stored = usePanes((s) => s.widths);
  const [shellRef, shellWidth] = useWidth();
  // What the columns really get: the reader keeps its minimum in narrow windows.
  const widths =
    shellWidth === null
      ? stored
      : fitPanes(stored, shellWidth - CHROME - (roomForFolders ? HANDLE : 0), roomForFolders);
  useAccounts();
  useSnoozeRunner();
  usePushFilterSync();
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

  // A link back to a mail, as an event found in it carries in its notes.
  useEffect(() => openLinkedMail(), []);

  const section = useUi((s) => s.section);
  const { data: calendarAvailable = false } = useCalendarsAvailable();
  const { data: contactsAvailable = false } = useContactsAvailable();
  const { data: assistOptions } = useAssistOptions();
  const labelsAvailable = Boolean(assistOptions);
  const commands = useMemo(
    () =>
      buildCommands(client, t, { calendar: calendarAvailable, contacts: contactsAvailable, labels: labelsAvailable }),
    [client, t, calendarAvailable, contactsAvailable, labelsAvailable],
  );

  const hotkeys = useMemo(() => {
    const map: HotkeyMap = {
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
  useFrameHotkeys();
  useBackLayer(phone && moreOpen, () => useUi.getState().setMoreOpen(false));

  return (
    <div className="flex h-full flex-col">
      {backend().kind === "demo" && (
        <p className="shrink-0 bg-pink-tint py-1 text-center text-caption font-semibold text-pink-ink">
          {t("status.demo")}
        </p>
      )}

      {phone ? (
        <div className="flex min-h-0 flex-1 flex-col pt-[env(safe-area-inset-top)]">
          <div className="relative min-h-0 flex-1">
            {moreOpen ? (
              <MoreScreen />
            ) : section === "calendar" ? (
              <CalendarShell />
            ) : section === "contacts" ? (
              <ContactsShell />
            ) : (
              <MobileShell />
            )}
          </div>
          {!(section === "mail" && selectedThreadId && !moreOpen) && <PhoneTabBar />}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <IconRail />
          <div className="flex min-w-0 flex-1 flex-col">
            <TopBar />
            {section === "calendar" ? (
              <CalendarShell />
            ) : section === "contacts" ? (
              <ContactsShell />
            ) : (
              <div
                ref={shellRef}
                className="relative flex min-h-0 flex-1 pr-3 pb-3"
                style={{ "--list-w": `${widths.list}px`, "--sidebar-w": `${widths.sidebar}px` } as CSSProperties}
              >
                {roomForFolders && (
                  <>
                    <MailboxNav className="min-h-0 w-(--sidebar-w) shrink-0 overflow-y-auto" />
                    <PaneHandle pane="sidebar" width={widths.sidebar} label={t("layout.resizeFolders")} />
                  </>
                )}
                {/* List and reader share one card, with a hairline between them. */}
                <div className="flex min-w-0 flex-1 overflow-hidden rounded-card border border-hairline bg-surface">
                  <ThreadList
                    variant="simple"
                    showMenu={!roomForFolders}
                    className={clsx(
                      "shrink-0 border-hairline lg:w-(--list-w) lg:border-r",
                      selectedThreadId ? "hidden lg:flex" : "w-full",
                    )}
                  />
                  {sideBySide && (
                    <PaneHandle
                      pane="list"
                      width={widths.list}
                      label={t("layout.resizeList")}
                      className="relative z-10 -mx-1.5"
                    />
                  )}
                  <ThreadReader
                    variant="simple"
                    className={clsx("min-w-0 flex-1 overflow-hidden", !selectedThreadId && "max-lg:hidden")}
                  />
                </div>

                {drawerOpen && !roomForFolders && (
                  <div className="absolute inset-0 z-30 flex" role="presentation">
                    <button
                      type="button"
                      aria-label={t("common.close")}
                      onClick={() => setDrawerOpen(false)}
                      className="absolute inset-0 animate-fade bg-backdrop"
                    />
                    <MailboxNav className="relative w-[280px] animate-slide-up overflow-y-auto rounded-r-dialog bg-surface shadow-float" />
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Composer />
      <SettingsDialog />
      <CommandPalette commands={commands} />
      <ShortcutsDialog />
      <MoveDialog />
      <SnoozeDialog />
      <FolderDialogs />
      {labelsAvailable && (
        <>
          <LabelPicker />
          <LabelSuggestDialog />
        </>
      )}
      <ContactEditor />
      <DeleteContactQuestion />
      {/* Also for appointments found in a mail, so outside the calendar too. */}
      {calendarAvailable && (
        <>
          <EventEditor />
          <DeleteScopeQuestion />
        </>
      )}
    </div>
  );
}

/** The handle right of a column, which drags it wider or narrower. */
function PaneHandle({
  pane,
  width,
  label,
  className,
}: {
  pane: Pane;
  width: number;
  label: string;
  className?: string;
}) {
  const setWidth = usePanes((s) => s.setWidth);
  const save = usePanes((s) => s.save);
  const reset = usePanes((s) => s.reset);
  return (
    <ResizeHandle
      label={label}
      className={className}
      width={width}
      min={PANE_LIMITS[pane].min}
      max={PANE_LIMITS[pane].max}
      onResize={(next) => setWidth(pane, next)}
      onCommit={save}
      onReset={() => reset(pane)}
      step={KEY_STEP}
    />
  );
}
