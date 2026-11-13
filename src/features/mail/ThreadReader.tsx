import clsx from "clsx";
import {
  AlarmClock,
  Archive,
  ArrowLeft,
  FolderInput,
  Forward,
  Inbox,
  MailOpen,
  RefreshCw,
  Reply,
  ReplyAll,
  ShieldAlert,
  ShieldCheck,
  Star,
  Trash,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Message } from "@/backend/types";
import { Button, IconButton } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { useT } from "@/i18n";
import { inTrash, useAccounts, useFolders, useMessageActions, useThread } from "@/lib/queries";
import { useUi } from "@/state/ui";
import { ListLabelChips } from "../assist/LabelChips";
import { ThreadAssistButton, ThreadSummary } from "../assist/ReaderAssist";
import { codeForMessages, useVerificationCodes } from "../codes/codes";
import { CodeHint } from "../codes/VerificationCodeBar";
import { MessageView } from "./MessageView";
import { mailRights } from "./rights";
import { requestMove } from "./selection";
import { requestSnooze, someSnoozed, useSnooze } from "./snooze";
import { useNyuOnOpen } from "./nyuOnOpen";
import { replySource } from "@/features/compose/draft";

interface ThreadReaderProps {
  variant: "simple" | "pro";
  className?: string;
}

/** Messages that start expanded: the newest one plus every unread one. */
function initiallyExpanded(messages: Message[]) {
  const ids = new Set(messages.filter((m) => !m.flags.seen).map((m) => m.id));
  const last = messages[messages.length - 1];
  if (last) ids.add(last.id);
  return ids;
}

export function ThreadReader({ variant, className }: ThreadReaderProps) {
  const { t } = useT();
  const threadId = useUi((s) => s.selectedThreadId);
  const selectThread = useUi((s) => s.selectThread);
  const openCompose = useUi((s) => s.openCompose);
  const { data, isPending, isError, refetch, isRefetching } = useThread(threadId);
  const { data: accounts = [] } = useAccounts();
  const { data: folders = [] } = useFolders();
  const actions = useMessageActions();
  const codes = useVerificationCodes();
  const { unsnooze } = useSnooze();
  const messages = data?.messages;
  const loadedThreadId = data?.thread.id;
  useNyuOnOpen(data);

  // Snapshot per thread: marking messages as read must not collapse them again.
  const initial = useMemo(
    () => (messages ? initiallyExpanded(messages) : new Set<string>()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [loadedThreadId],
  );
  const [opened, setOpened] = useState<{ threadId: string; ids: Set<string> } | null>(null);
  const expanded = opened && opened.threadId === loadedThreadId ? opened.ids : initial;
  const expand = (ids: string[]) => {
    if (loadedThreadId) setOpened({ threadId: loadedThreadId, ids: new Set([...expanded, ...ids]) });
  };

  useEffect(() => {
    if (!messages) return;
    const unseen = messages.filter((m) => !m.flags.seen);
    // In a folder shared to read only, opening a mail leaves it unread for its owner.
    const allowed = mailRights(
      unseen.map((m) => m.folderId),
      folders,
    ).markSeen;
    if (unseen.length > 0 && allowed)
      void actions.setFlags(
        unseen.map((m) => m.id),
        { seen: true },
      );
    // Only when a different thread finished loading, not on every refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedThreadId]);

  if (!threadId) {
    return (
      <section className={clsx("flex h-full items-center justify-center bg-surface", className)}>
        <EmptyState
          scene="pick"
          compact={variant === "pro"}
          title={t("reader.empty.title")}
          body={t("reader.empty.body")}
        />
      </section>
    );
  }

  if (isError && !data) {
    return (
      <section className={clsx("flex h-full items-center justify-center bg-surface", className)}>
        <EmptyState
          scene="loadError"
          compact={variant === "pro"}
          title={t("reader.error.title")}
          body={t("reader.error.body")}
          action={
            <Button icon={RefreshCw} busy={isRefetching} onClick={() => void refetch()}>
              {t("reader.error.retry")}
            </Button>
          }
        />
      </section>
    );
  }

  if (isPending || !data) {
    return (
      <section className={clsx("flex h-full items-center justify-center bg-surface text-meta text-muted", className)}>
        {t("reader.loading")}
      </section>
    );
  }

  const all = data.messages;
  const latest = all[all.length - 1]!;
  const source = replySource(all);
  const ids = all.map((m) => m.id);
  const flagged = data.thread.flagged;
  const hiddenCount = all.filter((m) => !expanded.has(m.id)).length;
  const inJunk = all.every((m) => folders.find((f) => f.id === m.folderId)?.role === "junk");
  const trashed = inTrash(all, folders);
  const rights = mailRights(
    all.map((m) => m.folderId),
    folders,
  );
  const folder = folders.find((f) => f.id === latest.folderId);
  const code = codeForMessages(all, data.thread.id, codes);
  const snoozed = someSnoozed(all, folders);

  return (
    <section
      data-reader
      className={clsx("@container flex h-full min-w-0 flex-col bg-surface", className)}
      aria-label={data.thread.subject}
    >
      <header className="flex items-center gap-1 border-b border-hairline bg-surface px-3 py-2">
        {variant === "simple" && (
          <IconButton
            icon={ArrowLeft}
            label={t("reader.back")}
            onClick={() => selectThread(null)}
            className="mr-1 lg:hidden"
          />
        )}
        <ReplyButton
          icon={Reply}
          label={t("reader.reply")}
          primary
          onClick={() => openCompose({ mode: "reply", source })}
        />
        <ReplyButton
          icon={ReplyAll}
          label={t("reader.replyAll")}
          onClick={() => openCompose({ mode: "replyAll", source })}
        />
        <ReplyButton
          icon={Forward}
          label={t("reader.forward")}
          onClick={() => openCompose({ mode: "forward", source })}
        />
        <span className="min-w-2 flex-1" aria-hidden />
        {rights.archive && (
          <IconButton
            icon={Archive}
            label={t("reader.archive")}
            onClick={() => void actions.archive(ids).then(() => selectThread(null))}
          />
        )}
        {rights.remove && (
          <IconButton
            icon={Trash}
            label={trashed ? t("reader.deleteForever") : t("reader.trash")}
            onClick={() => void actions.trash(all).then((gone) => gone && selectThread(null))}
          />
        )}
        {rights.remove && (
          <IconButton
            icon={FolderInput}
            label={t("reader.move")}
            onClick={() => requestMove(all, () => selectThread(null))}
          />
        )}
        {/* Snoozed mail waits in the account's own Snoozed folder. */}
        {rights.remove && !rights.shared && (
          <IconButton
            icon={AlarmClock}
            label={t("snooze.action")}
            onClick={() => requestSnooze(all, () => selectThread(null))}
          />
        )}
        {snoozed && (
          <IconButton
            icon={Inbox}
            label={t("snooze.unsnooze")}
            onClick={() => void unsnooze(all, [data.thread.id]).then(() => selectThread(null))}
          />
        )}
        {rights.spam && (
          <IconButton
            icon={inJunk ? ShieldCheck : ShieldAlert}
            label={inJunk ? t("reader.notSpam") : t("reader.spam")}
            onClick={() => void actions.spam(ids, !inJunk).then(() => selectThread(null))}
          />
        )}
        {rights.flag && (
          <IconButton
            icon={Star}
            label={flagged ? t("reader.unflag") : t("reader.flag")}
            active={flagged}
            onClick={() => void actions.setFlags(flagged ? ids : [latest.id], { flagged: !flagged })}
          />
        )}
        {rights.markSeen && (
          <IconButton
            icon={MailOpen}
            label={t("reader.markUnread")}
            onClick={() => void actions.setFlags([latest.id], { seen: false }).then(() => selectThread(null))}
          />
        )}
        <ThreadAssistButton
          threadId={latest.threadId}
          messages={all}
          own={!rights.shared}
          mine={new Set(accounts.map((account) => account.email.toLowerCase()))}
        />
        {rights.shared && !rights.flag && (
          <span className="ml-2 truncate text-caption font-semibold text-muted">{t("sharing.readOnly")}</span>
        )}
      </header>

      <div data-reader-scroll className="min-h-0 flex-1 overflow-y-auto">
        {/* The mail fills the reading pane; only very wide windows keep lines readable with a cap. */}
        <div className={clsx("mx-auto flex w-full max-w-[1400px] flex-col gap-3", variant === "pro" ? "p-4" : "p-3")}>
          <div className="flex flex-wrap items-center gap-1.5 px-1 pt-1">
            {folder && (
              <span className="inline-flex h-6 items-center rounded-full bg-elevated px-2.5 text-caption font-semibold text-muted">
                {folder.name}
              </span>
            )}
            <ListLabelChips keywords={data.thread.keywords} />
            {code && (
              <span className="inline-flex h-6 items-center rounded-full bg-pink-tint px-2.5 text-caption font-bold text-pink-ink">
                {t("codes.tag")}
              </span>
            )}
          </div>
          <h2 className="selectable -mt-1 px-1 pb-2 text-title leading-tight font-extrabold tracking-[-0.01em]">
            {data.thread.subject || t("reader.noSubject")}
          </h2>
          {code && <CodeHint code={code} />}
          <ThreadSummary threadId={latest.threadId} count={all.length} />
          {hiddenCount > 1 && (
            <button
              type="button"
              onClick={() => expand(ids)}
              className="self-start rounded-full bg-pink-tint px-3 py-1 text-meta font-semibold text-pink-ink hover:bg-pink-tint-strong"
            >
              {t("reader.earlier", { count: hiddenCount })}
            </button>
          )}
          {all.map((message) => (
            <MessageView
              key={message.id}
              message={message}
              accounts={accounts}
              collapsed={!expanded.has(message.id)}
              onExpand={() => expand([message.id])}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

/** Reply, reply all and forward: with their names where the reader has room, else just the icon. */
function ReplyButton({
  icon: Icon,
  label,
  primary,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={clsx(
        "inline-flex h-9 shrink-0 items-center gap-2 rounded-full px-2.5 text-meta font-semibold transition-colors @[640px]:px-3.5",
        primary
          ? "bg-pink-tint text-pink-ink hover:bg-pink-tint-strong"
          : "border border-line bg-surface text-ink hover:bg-elevated",
      )}
    >
      <Icon className="size-4 shrink-0" strokeWidth={2.2} aria-hidden />
      <span className="hidden @[640px]:inline">{label}</span>
    </button>
  );
}
