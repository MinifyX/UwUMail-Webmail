import { ICONS } from "@uwusuite/design";
import type { LucideIcon } from "lucide-react";
import { backend } from "@/backend/backend";
import { playNyu } from "@/components/nyu/cameo";
import { i18n } from "@/i18n";
import { leaveThread, queryKeys, trashMail } from "@/lib/queries";
import { useSettings } from "@/state/settings";
import { announceMove, runLastUndo } from "@/state/undo";
import { useUi } from "@/state/ui";
import type { QueryClient } from "@tanstack/react-query";
import type { ThreadDetail } from "@/backend/types";
import { startNewEvent } from "../calendar/CalendarSidebar";
import { startNewContact } from "../contacts/state";
import { markAllRead, viewScope } from "../mail/markAllRead";
import { requestMove } from "../mail/selection";
import { requestSnooze } from "../mail/snooze";
import { focusSearch } from "./search";
import { replySource } from "@/features/compose/draft";

export interface Command {
  id: string;
  title: string;
  icon: LucideIcon;
  keys?: string[];
  run: () => void | Promise<void>;
  /** Only offered while a thread is open. */
  needsThread?: boolean;
}

function currentThread(client: QueryClient): ThreadDetail | undefined {
  const { selectedThreadId } = useUi.getState();
  if (!selectedThreadId) return undefined;
  const { conversations } = useSettings.getState();
  return client.getQueryData<ThreadDetail>([...queryKeys.thread, selectedThreadId, conversations]);
}

async function afterChange(client: QueryClient) {
  await Promise.all([
    client.invalidateQueries({ queryKey: queryKeys.threads }),
    client.invalidateQueries({ queryKey: queryKeys.thread }),
    client.invalidateQueries({ queryKey: queryKeys.folders }),
  ]);
}

/** App commands shared by the shortcuts and the command palette. */
export function buildCommands(
  client: QueryClient,
  t: (key: string, options?: Record<string, unknown>) => string,
  {
    calendar = false,
    contacts = false,
    labels = false,
  }: { calendar?: boolean; contacts?: boolean; labels?: boolean } = {},
): Command[] {
  const ui = useUi.getState();
  const settings = useSettings.getState();

  const withThread = (fn: (thread: ThreadDetail) => void | Promise<void>) => () => {
    const thread = currentThread(client);
    if (thread) return fn(thread);
  };
  const latest = (thread: ThreadDetail) => thread.messages[thread.messages.length - 1]!;
  const ids = (thread: ThreadDetail) => thread.messages.map((m) => m.id);

  return [
    {
      id: "compose",
      title: t("shortcuts.compose"),
      icon: ICONS.compose,
      keys: ["c"],
      run: () => ui.openCompose({ mode: "new" }),
    },
    {
      id: "search",
      title: t("shortcuts.search"),
      icon: ICONS.search,
      keys: ["/"],
      run: focusSearch,
    },
    {
      id: "reply",
      title: t("shortcuts.reply"),
      icon: ICONS.reply,
      keys: ["r"],
      needsThread: true,
      run: withThread((thread) => ui.openCompose({ mode: "reply", source: replySource(thread.messages) })),
    },
    {
      id: "replyAll",
      title: t("shortcuts.replyAll"),
      icon: ICONS.replyAll,
      keys: ["a"],
      needsThread: true,
      run: withThread((thread) => ui.openCompose({ mode: "replyAll", source: replySource(thread.messages) })),
    },
    {
      id: "forward",
      title: t("shortcuts.forward"),
      icon: ICONS.forward,
      keys: ["f"],
      needsThread: true,
      run: withThread((thread) => ui.openCompose({ mode: "forward", source: replySource(thread.messages) })),
    },
    {
      id: "archive",
      title: t("shortcuts.archive"),
      icon: ICONS.archive,
      keys: ["e"],
      needsThread: true,
      run: withThread(async (thread) => {
        leaveThread(thread.thread.id);
        announceMove(await backend().archive(ids(thread)), t("toast.archived"), () => afterChange(client));
        playNyu("archived");
        await afterChange(client);
      }),
    },
    {
      id: "trash",
      title: t("shortcuts.trash"),
      icon: ICONS.delete,
      keys: ["#", "Delete"],
      needsThread: true,
      // In the trash this deletes for good, after Nyu asked.
      run: withThread(async (thread) => {
        await trashMail(client, thread.messages, () => leaveThread(thread.thread.id));
      }),
    },
    {
      id: "move",
      title: t("shortcuts.move"),
      icon: ICONS.move,
      keys: ["v"],
      needsThread: true,
      run: withThread((thread) => requestMove(thread.messages, () => ui.selectThread(null))),
    },
    {
      id: "snooze",
      title: t("shortcuts.snooze"),
      icon: ICONS.reminder,
      keys: ["b"],
      needsThread: true,
      run: withThread((thread) => requestSnooze(thread.messages, () => ui.selectThread(null))),
    },
    {
      id: "spam",
      title: t("shortcuts.spam"),
      icon: ICONS.spam,
      keys: ["!"],
      needsThread: true,
      run: withThread(async (thread) => {
        leaveThread(thread.thread.id);
        announceMove(await backend().markSpam(ids(thread), true), t("toast.markedSpam"), () => afterChange(client));
        await afterChange(client);
      }),
    },
    {
      id: "select",
      title: t("shortcuts.select"),
      icon: ICONS.select,
      keys: ["x"],
      needsThread: true,
      run: () => {
        const { selectedThreadId, checkedThreadIds, setCheckedThreadIds } = useUi.getState();
        if (!selectedThreadId) return;
        setCheckedThreadIds(
          checkedThreadIds.includes(selectedThreadId)
            ? checkedThreadIds.filter((id) => id !== selectedThreadId)
            : [...checkedThreadIds, selectedThreadId],
        );
      },
    },
    {
      id: "selectAll",
      title: t("shortcuts.selectAll"),
      icon: ICONS.review,
      // The shell only takes Ctrl+A where no text is meant; see MailShell.
      keys: ["mod+a"],
      run: () => useUi.getState().checkAllVisible(),
    },
    ...(labels
      ? [
          {
            id: "label",
            title: t("shortcuts.label"),
            icon: ICONS.label,
            keys: ["l"],
            needsThread: true,
            // The ticked conversations, or else the open one.
            run: () => {
              const { checkedThreadIds, selectedThreadId, openLabelPicker } = useUi.getState();
              openLabelPicker(
                checkedThreadIds.length > 0 ? checkedThreadIds : selectedThreadId ? [selectedThreadId] : [],
              );
            },
          },
        ]
      : []),
    {
      id: "markAllRead",
      title: t("shortcuts.markAllRead"),
      icon: ICONS.selectAll,
      keys: ["shift+i"],
      run: () => markAllRead(client, viewScope(client, useUi.getState().view)),
    },
    {
      id: "undo",
      title: t("shortcuts.undo"),
      icon: ICONS.undo,
      keys: ["z"],
      run: () => {
        runLastUndo();
      },
    },
    {
      id: "flag",
      title: t("shortcuts.flag"),
      icon: ICONS.favorite,
      keys: ["s"],
      needsThread: true,
      run: withThread(async (thread) => {
        await backend().setFlags(ids(thread), { flagged: !thread.thread.flagged });
        await afterChange(client);
      }),
    },
    {
      id: "unread",
      title: t("shortcuts.unread"),
      icon: ICONS.unread,
      keys: ["u"],
      needsThread: true,
      run: withThread(async (thread) => {
        await backend().setFlags([latest(thread).id], { seen: false });
        ui.selectThread(null);
        await afterChange(client);
      }),
    },
    {
      id: "inbox",
      title: t("shortcuts.goInbox"),
      icon: ICONS.allMailboxes,
      keys: ["g i"],
      run: () => ui.setView({ kind: "unified", role: "inbox" }),
    },
    {
      id: "goSent",
      title: t("shortcuts.goSent"),
      icon: ICONS.allMailboxes,
      keys: ["g s"],
      run: () => ui.setView({ kind: "unified", role: "sent" }),
    },
    {
      id: "goDrafts",
      title: t("shortcuts.goDrafts"),
      icon: ICONS.allMailboxes,
      keys: ["g d"],
      run: () => ui.setView({ kind: "unified", role: "drafts" }),
    },
    {
      id: "goFlagged",
      title: t("shortcuts.goFlagged"),
      icon: ICONS.favorite,
      keys: ["g f"],
      run: () => ui.setView({ kind: "unified", role: "flagged" }),
    },
    ...(calendar
      ? [
          {
            id: "goCalendar",
            title: t("shortcuts.goCalendar"),
            icon: ICONS.calendar,
            keys: ["g c"],
            run: () => ui.setSection("calendar"),
          },
          {
            id: "newEvent",
            title: t("calendar.newEvent"),
            icon: ICONS.addEvent,
            run: () => {
              ui.setSection("calendar");
              startNewEvent();
            },
          },
        ]
      : []),
    ...(contacts
      ? [
          {
            id: "goContacts",
            title: t("shortcuts.goContacts"),
            icon: ICONS.contacts,
            keys: ["g p"],
            run: () => ui.setSection("contacts"),
          },
          {
            id: "newContact",
            title: t("contacts.newContact"),
            icon: ICONS.addContact,
            run: () => {
              ui.setSection("contacts");
              startNewContact();
            },
          },
        ]
      : []),
    {
      id: "tone",
      title: `${t("settings.tone")}: ${i18n.t(`tone.${settings.tone === "playful" ? "neutral" : "playful"}.name`)}`,
      icon: ICONS.ai,
      run: () => settings.update({ tone: settings.tone === "playful" ? "neutral" : "playful" }),
    },
    {
      id: "theme",
      title: `${t("settings.theme")}: ${i18n.t(document.documentElement.dataset.theme === "dark" ? "theme.light" : "theme.dark")}`,
      icon: ICONS.darkTheme,
      run: () => settings.update({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }),
    },
    { id: "settings", title: t("nav.settings"), icon: ICONS.settings, keys: ["mod+,"], run: () => ui.openSettings() },
    {
      id: "shortcuts",
      title: t("settings.shortcuts"),
      icon: ICONS.keyboard,
      keys: ["?"],
      run: () => ui.setShortcutsOpen(true),
    },
  ];
}
