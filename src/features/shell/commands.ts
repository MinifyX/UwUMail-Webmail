import type { LucideIcon } from "lucide-react";
import {
  Archive,
  CheckSquare,
  FolderInput,
  Forward,
  Keyboard,
  ListChecks,
  Mailbox,
  MailOpen,
  Moon,
  PenLine,
  Reply,
  ReplyAll,
  Search,
  Settings,
  ShieldAlert,
  Sparkles,
  Star,
  Trash,
  Undo2,
} from "lucide-react";
import { backend } from "@/backend/backend";
import { i18n } from "@/i18n";
import { leaveThread, queryKeys, trashMail } from "@/lib/queries";
import { useSettings } from "@/state/settings";
import { announceMove, runLastUndo } from "@/state/undo";
import { useUi } from "@/state/ui";
import type { QueryClient } from "@tanstack/react-query";
import type { ThreadDetail } from "@/backend/types";
import { requestMove } from "../mail/selection";
import { SEARCH_INPUT_ID } from "../mail/ThreadList";

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

/** App commands shared by the shortcuts and the command palette. Addons will add their own. */
export function buildCommands(
  client: QueryClient,
  t: (key: string, options?: Record<string, unknown>) => string,
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
      icon: PenLine,
      keys: ["c"],
      run: () => ui.openCompose({ mode: "new" }),
    },
    {
      id: "search",
      title: t("shortcuts.search"),
      icon: Search,
      keys: ["/"],
      run: () => document.getElementById(SEARCH_INPUT_ID)?.focus(),
    },
    {
      id: "reply",
      title: t("shortcuts.reply"),
      icon: Reply,
      keys: ["r"],
      needsThread: true,
      run: withThread((thread) => ui.openCompose({ mode: "reply", source: latest(thread) })),
    },
    {
      id: "replyAll",
      title: t("shortcuts.replyAll"),
      icon: ReplyAll,
      keys: ["a"],
      needsThread: true,
      run: withThread((thread) => ui.openCompose({ mode: "replyAll", source: latest(thread) })),
    },
    {
      id: "forward",
      title: t("shortcuts.forward"),
      icon: Forward,
      keys: ["f"],
      needsThread: true,
      run: withThread((thread) => ui.openCompose({ mode: "forward", source: latest(thread) })),
    },
    {
      id: "archive",
      title: t("shortcuts.archive"),
      icon: Archive,
      keys: ["e"],
      needsThread: true,
      run: withThread(async (thread) => {
        leaveThread(thread.thread.id);
        announceMove(await backend().archive(ids(thread)), t("toast.archived"), () => afterChange(client));
        await afterChange(client);
      }),
    },
    {
      id: "trash",
      title: t("shortcuts.trash"),
      icon: Trash,
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
      icon: FolderInput,
      keys: ["v"],
      needsThread: true,
      run: withThread((thread) => requestMove(thread.messages, () => ui.selectThread(null))),
    },
    {
      id: "spam",
      title: t("shortcuts.spam"),
      icon: ShieldAlert,
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
      icon: CheckSquare,
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
      icon: ListChecks,
      // The shell only takes Ctrl+A where no text is meant; see MailShell.
      keys: ["mod+a"],
      run: () => useUi.getState().checkAllVisible(),
    },
    {
      id: "undo",
      title: t("shortcuts.undo"),
      icon: Undo2,
      keys: ["z"],
      run: () => {
        runLastUndo();
      },
    },
    {
      id: "flag",
      title: t("shortcuts.flag"),
      icon: Star,
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
      icon: MailOpen,
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
      icon: Mailbox,
      keys: ["g i"],
      run: () => ui.setView({ kind: "unified", role: "inbox" }),
    },
    {
      id: "goSent",
      title: t("shortcuts.goSent"),
      icon: Mailbox,
      keys: ["g s"],
      run: () => ui.setView({ kind: "unified", role: "sent" }),
    },
    {
      id: "goDrafts",
      title: t("shortcuts.goDrafts"),
      icon: Mailbox,
      keys: ["g d"],
      run: () => ui.setView({ kind: "unified", role: "drafts" }),
    },
    {
      id: "goFlagged",
      title: t("shortcuts.goFlagged"),
      icon: Star,
      keys: ["g f"],
      run: () => ui.setView({ kind: "unified", role: "flagged" }),
    },
    {
      id: "tone",
      title: `${t("settings.tone")}: ${i18n.t(`tone.${settings.tone === "playful" ? "neutral" : "playful"}.name`)}`,
      icon: Sparkles,
      run: () => settings.update({ tone: settings.tone === "playful" ? "neutral" : "playful" }),
    },
    {
      id: "theme",
      title: `${t("settings.theme")}: ${i18n.t(document.documentElement.dataset.theme === "dark" ? "theme.light" : "theme.dark")}`,
      icon: Moon,
      run: () => settings.update({ theme: document.documentElement.dataset.theme === "dark" ? "light" : "dark" }),
    },
    { id: "settings", title: t("nav.settings"), icon: Settings, keys: ["mod+,"], run: () => ui.openSettings() },
    {
      id: "shortcuts",
      title: t("settings.shortcuts"),
      icon: Keyboard,
      keys: ["?"],
      run: () => ui.setShortcutsOpen(true),
    },
  ];
}
