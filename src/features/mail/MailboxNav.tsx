import clsx from "clsx";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Ellipsis,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  PenLine,
  Settings,
  SlidersHorizontal,
  Users,
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { backend } from "@/backend/backend";
import type { Account, Folder, FolderRights, MailboxView, SharedAccount } from "@/backend/types";
import { AccountDot } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Wordmark } from "@/components/ui/Logo";
import { ContextMenu, type MenuItem } from "@/components/ui/Menu";
import { Badge } from "@/components/ui/Pill";
import { useT } from "@/i18n";
import { accountAddress, folderRefOf, hasRef, hiddenFromUnified, orderAccounts, resolveRefs } from "@/lib/arrangement";
import {
  type MailboxRef,
  useFolders,
  useMailboxes,
  useMessageActions,
  useSharedAccounts,
  useSharingAvailable,
  useVisibleAccounts,
} from "@/lib/queries";
import { moveMailbox, setFolderListed, setHiddenFromUnified, useUnifiedTally } from "@/state/arrangement";
import { openFolderDialog } from "@/state/folderDialog";
import { toast } from "@/state/toasts";
import { type FolderRef, useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import { PORTAL_URL } from "@/backend/server";
import { ScheduledNavItem } from "../compose/ScheduledSends";
import { LabelNavSection } from "../labels/LabelNav";
import { AppSwitch } from "../shell/AppSwitch";
import { ShareDialog } from "../sharing/ShareDialog";
import { buildFolderTree, countsUnread, type FolderNode } from "./folderTree";
import { draggedThreadIds, THREAD_DRAG_TYPE, useSelectionActions } from "./selection";
import { markAllRead, viewScope } from "./markAllRead";
import { folderIcon, folderLabel, sameView, UNIFIED_ICONS } from "./view";

const UNIFIED_ROLES = ["inbox", "unread", "flagged", "drafts", "sent"] as const;

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
  /** Shown on hover, e.g. whose a favorite folder is. */
  title?: string;
  /** What else can be done with it, behind "…" and the context menu. */
  menu?: { label: string; items: MenuItem[] };
}

function NavItem({ icon: Icon, label, count, active, onClick, title, menu }: NavItemProps) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const button = (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group flex h-9 w-full min-w-0 items-center gap-3 rounded-xl px-3 text-left text-[13.5px] transition-colors",
        active ? "bg-pink-tint font-semibold text-pink-ink" : "text-ink/85 hover:bg-pink-tint/50",
      )}
    >
      <Icon className={clsx("size-[17px] shrink-0", active ? "text-pink" : "text-muted")} strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && (
        <Badge count={count} className={clsx(menu && menuAt === null && "pointer-fine:group-hover:invisible")} />
      )}
    </button>
  );
  if (!menu) return button;
  return (
    <div
      className="group relative"
      onContextMenu={(event) => {
        event.preventDefault();
        setMenuAt({ x: event.clientX, y: event.clientY });
      }}
    >
      {button}
      <MoreButton label={menu.label} open={menuAt !== null} onToggle={(at) => setMenuAt(menuAt ? null : at)} />
      <ContextMenu at={menuAt} items={menu.items} onClose={() => setMenuAt(null)} label={menu.label} />
    </div>
  );
}

/** The "…" that opens a sidebar entry's menu; shown on hover where there's a mouse. */
function MoreButton({
  label,
  open,
  onToggle,
  inline = false,
}: {
  label: string;
  open: boolean;
  onToggle: (at: { x: number; y: number }) => void;
  /** Next to the other buttons of a heading instead of over the entry's end. */
  inline?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onToggle({ x: rect.right - 200, y: rect.bottom + 4 });
      }}
      className={clsx(
        "grid size-7 shrink-0 place-items-center rounded-full text-muted hover:bg-pink-tint-strong hover:text-ink focus-visible:opacity-100",
        inline ? "pointer-coarse:opacity-100" : "absolute top-1/2 right-1.5 -translate-y-1/2 pointer-coarse:hidden",
        open ? "opacity-100" : "opacity-0 group-hover:opacity-100",
      )}
    >
      <Ellipsis className="size-4" aria-hidden />
    </button>
  );
}

const INDENT = 16;

function Glyph({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <Icon className={clsx("size-[17px] shrink-0", active ? "text-pink" : "text-muted")} strokeWidth={2} aria-hidden />
  );
}

/**
 * What can be done to a folder from its menu. Role folders keep their name and stay; a folder
 * somebody shares offers what its owner allows. "Share…" wherever the server lets the account.
 */
function useFolderMenuItems(folder: Folder, accountId: string, place: FolderPlace, onShare: () => void) {
  const { t } = useT();
  const client = useQueryClient();
  const { data: sharing = false } = useSharingAvailable();
  const items: { label: string; onSelect: () => void; danger?: boolean }[] = [];
  const may = (right: keyof FolderRights) => folder.rights?.[right] ?? true;
  if (folder.selectable) {
    if (may("maySetSeen")) {
      items.push({
        label: t("markAllRead.folder"),
        onSelect: () =>
          void markAllRead(client, { kind: "view", view: { kind: "folder", accountId, folderId: folder.id } }),
      });
    }
    items.push({
      label: place.favorite ? t("folders.unfavorite") : t("folders.favorite"),
      onSelect: () => setFolderListed("favoriteFolders", place.ref, !place.favorite),
    });
    // The unified inbox covers the account's own mailbox only.
    if (folder.role !== "inbox" && !folder.shared) {
      items.push({
        label: place.unified ? t("folders.leaveUnified") : t("folders.joinUnified"),
        onSelect: () => setFolderListed("unifiedFolders", place.ref, !place.unified),
      });
    }
  }
  if (folder.role !== "inbox") {
    items.push({
      label: place.hidden ? t("folders.unhide") : t("folders.hide"),
      onSelect: () => setFolderListed("hiddenFolders", place.ref, !place.hidden),
    });
  }
  if (folder.role === "trash" || folder.role === "junk") {
    const role = folder.role;
    items.push({ label: t(`folders.empty.${role}`), onSelect: () => openFolderDialog({ kind: "empty", folder }) });
    return items;
  }
  if (may("mayCreateChild")) {
    items.push({
      label: t("folders.newInside"),
      onSelect: () => openFolderDialog({ kind: "create", accountId, parent: folder }),
    });
  }
  if (!folder.role && may("mayRename")) {
    items.push({ label: t("folders.rename"), onSelect: () => openFolderDialog({ kind: "rename", folder }) });
  }
  if (sharing && folder.rights?.mayAdmin) items.push({ label: t("sharing.shareFolder"), onSelect: onShare });
  if (!folder.role && may("mayDelete")) {
    items.push({
      label: t("folders.delete"),
      danger: true,
      onSelect: () => openFolderDialog({ kind: "delete", folder }),
    });
  }
  return items;
}

interface FolderPlace {
  ref: FolderRef;
  favorite: boolean;
  hidden: boolean;
  /** Taken into the unified inbox. */
  unified: boolean;
}

/** Where a folder stands in the synced arrangement: favorite, hidden, in the unified inbox. */
function useFolderPlace(folder: Folder, owner: MailboxRef): FolderPlace {
  const { data: folders = [] } = useFolders();
  const ref = folderRefOf(
    folder,
    owner,
    folders.filter((each) => each.accountId === folder.accountId),
  );
  return {
    ref,
    favorite: useSettings((s) => hasRef(s.favoriteFolders, ref)),
    hidden: useSettings((s) => hasRef(s.hiddenFolders, ref)),
    unified: useSettings((s) => hasRef(s.unifiedFolders, ref)),
  };
}

/** How long a finger rests on a folder before its menu opens. */
const LONG_PRESS = 550;

function FolderItem({ node, accountId, owner }: { node: FolderNode; accountId: string; owner: MailboxRef }) {
  const { t } = useT();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const place = useFolderPlace(node.folder, owner);
  const showHidden = useSettings((s) => s.showHiddenFolders);
  const menuItems = useFolderMenuItems(node.folder, accountId, place, () => setSharing(true));
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const collapsed = useSettings((s) => s.collapsedFolders.includes(node.folder.id));
  const toggleFolder = useSettings((s) => s.toggleFolder);
  const { folder, depth, children } = node;
  const hasChildren = children.length > 0;
  const target: MailboxView = { kind: "folder", accountId, folderId: folder.id };
  const active = sameView(view, target);
  const icon = folder.selectable ? folderIcon(folder) : FolderOpen;
  // A collapsed folder also shows what's unread inside it.
  const count = hasChildren && collapsed ? node.unreadInside : countsUnread(folder) ? folder.unread : 0;
  const label = folderLabel(folder, t);
  const selection = useSelectionActions();
  const actions = useMessageActions();
  const [dropping, setDropping] = useState(false);
  const accepts = (event: React.DragEvent) =>
    folder.selectable &&
    // A folder somebody shares only takes mail where they allowed adding it.
    folder.rights?.mayAddItems !== false &&
    event.dataTransfer.types.includes(THREAD_DRAG_TYPE);
  const sharedWith = folder.sharedWith ?? {};
  const sharedCount = Object.keys(sharedWith).length;
  // A hidden folder takes its subfolders with it.
  if (place.hidden && !showHidden) return null;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? !collapsed : undefined}
      aria-selected={active}
      className={clsx(place.hidden && "opacity-60")}
    >
      <div
        onDragOver={(event) => {
          if (!accepts(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "move";
          setDropping(true);
        }}
        onDragLeave={() => setDropping(false)}
        onDrop={(event) => {
          setDropping(false);
          if (!accepts(event)) return;
          event.preventDefault();
          const threadIds = draggedThreadIds(event.dataTransfer.getData(THREAD_DRAG_TYPE));
          if (threadIds.length === 0) return;
          void selection.messagesOf(threadIds).then((messages) => {
            const here = messages.filter((message) => message.accountId === accountId).map((message) => message.id);
            if (here.length === 0) {
              toast(t("move.mixedAccounts"), "error");
              return;
            }
            useUi.getState().setCheckedThreadIds([]);
            return actions.move(here, { id: folder.id, name: label });
          });
        }}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
        // Phones without a context menu event (iOS) get the menu from a long press.
        onPointerDown={(event) => {
          if (event.pointerType !== "touch") return;
          const { clientX: x, clientY: y } = event;
          const timer = window.setTimeout(() => {
            if (press.current) press.current.fired = true;
            setMenuAt({ x, y });
          }, LONG_PRESS);
          press.current = { timer, x, y, fired: false };
        }}
        onPointerMove={(event) => {
          const start = press.current;
          if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) {
            window.clearTimeout(start.timer);
            press.current = null;
          }
        }}
        onPointerUp={() => {
          if (press.current) window.clearTimeout(press.current.timer);
        }}
        onPointerCancel={() => {
          if (press.current) window.clearTimeout(press.current.timer);
          press.current = null;
        }}
        onClickCapture={(event) => {
          // The finger lifting after a long press isn't a tap on the folder.
          if (press.current?.fired) {
            event.stopPropagation();
            event.preventDefault();
          }
          press.current = null;
        }}
        className={clsx(
          "group relative flex h-9 items-center rounded-xl transition-colors",
          dropping
            ? "bg-pink-tint-strong text-pink-ink ring-2 ring-pink"
            : active
              ? "bg-pink-tint font-semibold text-pink-ink"
              : "text-ink/85 hover:bg-pink-tint/50",
        )}
        style={{ paddingLeft: 6 + depth * INDENT }}
      >
        {hasChildren ? (
          <button
            type="button"
            onClick={() => toggleFolder(folder.id)}
            aria-label={t("nav.toggleFolder", { name: label })}
            title={t("nav.toggleFolder", { name: label })}
            className="grid size-5 shrink-0 place-items-center rounded-md text-muted hover:bg-pink-tint-strong hover:text-ink"
          >
            {collapsed ? (
              <ChevronRight className="size-3.5" aria-hidden />
            ) : (
              <ChevronDown className="size-3.5" aria-hidden />
            )}
          </button>
        ) : (
          <span className="size-5 shrink-0" aria-hidden />
        )}
        <button
          type="button"
          onClick={() => (folder.selectable ? setView(target) : toggleFolder(folder.id))}
          aria-current={active ? "page" : undefined}
          className="flex h-full min-w-0 flex-1 items-center gap-2.5 pr-3 pl-1 text-left text-[13.5px]"
        >
          <Glyph icon={icon} active={active} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {sharedCount > 0 && (
            <Users
              className="size-3.5 shrink-0 text-muted"
              aria-label={t("sharing.sharedWithCount", { count: sharedCount })}
            />
          )}
          {count > 0 && (
            <Badge count={count} className={clsx(menuAt === null && "pointer-fine:group-hover:invisible")} />
          )}
        </button>
        <MoreButton
          label={t("folders.actions", { name: label })}
          open={menuAt !== null}
          onToggle={(at) => setMenuAt(menuAt ? null : at)}
        />
        <ContextMenu
          at={menuAt}
          items={menuItems}
          onClose={() => setMenuAt(null)}
          label={t("folders.actions", { name: label })}
        />
      </div>
      <ShareDialog
        open={sharing}
        onClose={() => setSharing(false)}
        name={label}
        kind="folder"
        sharedWith={sharedWith}
        onShare={(personId, level) => backend().shareFolder(folder.id, personId, level)}
      />
      {hasChildren && !collapsed && (
        <ul role="group" className="flex flex-col gap-0.5 pt-0.5">
          {children.map((child) => (
            <FolderItem key={child.folder.id} node={child} accountId={accountId} owner={owner} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** What a dragged mailbox heading carries: the mailbox's address. */
const MAILBOX_DRAG = "application/x-uwumail-mailbox";

/** Dragging a mailbox heading onto another one puts it in that one's place. */
function useReorderDrop(owner: MailboxRef, onReorder: (moved: string, target: string) => void) {
  const [dropping, setDropping] = useState(false);
  const address = accountAddress(owner);
  return {
    dropping,
    props: {
      draggable: true,
      onDragStart: (event: React.DragEvent) => {
        event.dataTransfer.setData(MAILBOX_DRAG, address);
        event.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (event: React.DragEvent) => {
        if (!event.dataTransfer.types.includes(MAILBOX_DRAG)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setDropping(true);
      },
      onDragLeave: () => setDropping(false),
      onDrop: (event: React.DragEvent) => {
        setDropping(false);
        const moved = event.dataTransfer.getData(MAILBOX_DRAG);
        if (!moved) return;
        event.preventDefault();
        if (moved !== address) onReorder(moved, address);
      },
    },
  };
}

/** Mark all read, leaving the mailbox out of All mailboxes, showing its hidden folders. */
function useMailboxMenu(owner: MailboxRef, { unified }: { unified: boolean }): MenuItem[] {
  const { t } = useT();
  const client = useQueryClient();
  const address = accountAddress(owner);
  const leftOut = useSettings((s) => hiddenFromUnified(owner, s.unifiedHidden));
  const showHidden = useSettings((s) => s.showHiddenFolders);
  const hasHidden = useSettings((s) => s.hiddenFolders.some((ref) => ref.account === address));
  const items: MenuItem[] = [];
  if (!owner.readOnly) {
    items.push({
      label: t("markAllRead.account"),
      onSelect: () => void markAllRead(client, { kind: "account", accountId: owner.id }),
    });
  }
  if (unified) {
    items.push({
      label: leftOut ? t("unified.include") : t("unified.leaveOut"),
      onSelect: () => setHiddenFromUnified(owner, !leftOut),
    });
  }
  if (hasHidden) {
    items.push({
      label: showHidden ? t("folders.hideHidden") : t("folders.showHidden"),
      onSelect: () => useSettings.getState().update({ showHiddenFolders: !showHidden }),
    });
  }
  return items;
}

function AccountSection({
  account,
  owner,
  folders,
  onReorder,
}: {
  account: Account;
  owner: MailboxRef;
  folders: Folder[];
  onReorder: (moved: string, target: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const { t } = useT();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const menuItems = useMailboxMenu(owner, { unified: true });
  const reorder = useReorderDrop(owner, onReorder);
  const { status } = account;
  const statusLabel =
    status.state === "syncing"
      ? t("status.syncing")
      : status.state === "offline"
        ? t("status.offline")
        : status.state === "error"
          ? `${t("status.error", { account: account.email })}: ${status.message}`
          : undefined;
  const tree = buildFolderTree(folders);

  return (
    <section className="flex flex-col gap-0.5">
      <div
        className={clsx("group relative flex items-center rounded-lg", reorder.dropping && "ring-2 ring-pink")}
        onContextMenu={(event) => {
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
        {...reorder.props}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={statusLabel}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg pr-1 pl-3 text-[12px] font-bold tracking-wide text-muted uppercase hover:text-ink"
        >
          <AccountDot color={account.color} />
          <span className="min-w-0 flex-1 truncate text-left tracking-normal normal-case">{account.email}</span>
          {status.state === "syncing" && (
            <LoaderCircle className="size-3.5 animate-spin text-pink" aria-label={statusLabel} />
          )}
          {status.state === "offline" && <WifiOff className="size-3.5 text-warning" aria-label={statusLabel} />}
          {status.state === "error" && <CircleAlert className="size-3.5 text-danger" aria-label={statusLabel} />}
          <ChevronDown className={clsx("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden />
        </button>
        <IconButton
          icon={FolderPlus}
          size="sm"
          label={t("folders.new")}
          onClick={() => openFolderDialog({ kind: "create", accountId: account.id, parent: null })}
          className="size-7"
        />
        <MoreButton
          inline
          label={t("folders.actions", { name: account.email })}
          open={menuAt !== null}
          onToggle={(at) => setMenuAt(menuAt ? null : at)}
        />
        <ContextMenu
          at={menuAt}
          items={menuItems}
          onClose={() => setMenuAt(null)}
          label={t("folders.actions", { name: account.email })}
        />
      </div>
      {open && (
        <ul role="tree" aria-label={account.email} className="flex flex-col gap-0.5">
          {tree.map((node) => (
            <FolderItem key={node.folder.id} node={node} accountId={account.id} owner={owner} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** The folders one person shares with the account, under their name. */
function SharedSection({
  owner,
  mailbox,
  folders,
  onReorder,
}: {
  owner: SharedAccount;
  mailbox: MailboxRef;
  folders: Folder[];
  onReorder: (moved: string, target: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const { t } = useT();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const menuItems = useMailboxMenu(mailbox, { unified: false });
  const reorder = useReorderDrop(mailbox, onReorder);
  const title = t("sharing.sharedBy", { name: owner.name });
  const tree = buildFolderTree(folders);
  if (tree.length === 0) return null;
  return (
    <section className="flex flex-col gap-0.5">
      <div
        className={clsx("group relative flex items-center rounded-lg", reorder.dropping && "ring-2 ring-pink")}
        onContextMenu={(event) => {
          if (menuItems.length === 0) return;
          event.preventDefault();
          setMenuAt({ x: event.clientX, y: event.clientY });
        }}
        {...reorder.props}
      >
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          title={owner.email}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg pr-1 pl-3 text-[12px] font-bold text-muted hover:text-ink"
        >
          <Users className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate text-left">{title}</span>
          {owner.readOnly && <span className="shrink-0 text-[11px] font-semibold">{t("sharing.readOnlyShort")}</span>}
          <ChevronDown className={clsx("size-3.5 transition-transform", !open && "-rotate-90")} aria-hidden />
        </button>
        {menuItems.length > 0 && (
          <MoreButton
            inline
            label={t("folders.actions", { name: title })}
            open={menuAt !== null}
            onToggle={(at) => setMenuAt(menuAt ? null : at)}
          />
        )}
        <ContextMenu
          at={menuAt}
          items={menuItems}
          onClose={() => setMenuAt(null)}
          label={t("folders.actions", { name: title })}
        />
      </div>
      {open && (
        <ul role="tree" aria-label={title} className="flex flex-col gap-0.5">
          {tree.map((node) => (
            <FolderItem key={node.folder.id} node={node} accountId={owner.id} owner={mailbox} />
          ))}
        </ul>
      )}
    </section>
  );
}

/** Counts arriving mail so Nyu in the logo hops once each time. Syncs without new mail don't count. */
function useNewMailHops() {
  const [hops, setHops] = useState(0);
  useEffect(
    () =>
      backend().subscribe((event) => {
        if (event.type === "mail:received") setHops((count) => count + 1);
      }),
    [],
  );
  return hops;
}

export function MailboxNav({ className }: { className?: string }) {
  const { t } = useT();
  const hops = useNewMailHops();
  const { accounts } = useVisibleAccounts();
  const { data: allFolders = [] } = useFolders();
  const { data: sharedAccounts = [] } = useSharedAccounts();
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const openCompose = useUi((s) => s.openCompose);
  const openSettings = useUi((s) => s.openSettings);

  const { mailboxes } = useMailboxes();
  const client = useQueryClient();
  const order = useSettings((s) => s.accountsOrder);
  const favoriteRefs = useSettings((s) => s.favoriteFolders);
  const tally = useUnifiedTally();

  const folders = allFolders.filter((f) => accounts.some((account) => account.id === f.accountId));
  // The unified inbox's count: without a mailbox left out of it, with the folders it takes in.
  const unreadInboxes = folders
    .filter((f) => !tally.leftOut.includes(f.accountId))
    .filter((f) => f.role === "inbox" || tally.extraFolderIds.includes(f.id))
    .reduce((sum, f) => sum + f.unread, 0);
  const favorites = resolveRefs(favoriteRefs, mailboxes, allFolders).filter((folder) => folder.selectable);
  const ordered = orderAccounts(mailboxes, order);
  const reorder = (moved: string, target: string) => {
    const addresses = ordered.map(accountAddress);
    moveMailbox(mailboxes, addresses.indexOf(moved), addresses.indexOf(target));
  };

  return (
    <nav className={clsx("flex h-full flex-col gap-4 px-3 pt-4 pb-3", className)}>
      <div className="flex items-center justify-between px-2">
        <Wordmark className="text-[19px]" hop={hops} />
      </div>

      <AppSwitch />

      <Button
        variant="primary"
        size="lg"
        icon={PenLine}
        onClick={() => openCompose({ mode: "new" })}
        className="w-full"
      >
        {t("nav.compose")}
      </Button>

      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        <section className="flex flex-col gap-0.5">
          {UNIFIED_ROLES.map((role) => {
            const target: MailboxView = { kind: "unified", role };
            const label = t(`nav.${role}`);
            return (
              <NavItem
                key={role}
                icon={UNIFIED_ICONS[role]}
                label={label}
                count={role === "inbox" ? unreadInboxes : undefined}
                active={sameView(view, target)}
                onClick={() => setView(target)}
                menu={
                  role === "drafts"
                    ? undefined
                    : {
                        label: t("folders.actions", { name: label }),
                        items: [
                          {
                            label: t("markAllRead.view"),
                            onSelect: () => void markAllRead(client, viewScope(client, target)),
                          },
                        ],
                      }
                }
              />
            );
          })}
          <ScheduledNavItem />
        </section>

        {favorites.length > 0 && (
          <section className="flex flex-col gap-0.5" aria-label={t("nav.favorites")}>
            <p className="px-3 pb-1 text-[12px] font-bold tracking-wide text-muted uppercase">{t("nav.favorites")}</p>
            {favorites.map((folder) => {
              const mailbox = mailboxes.find((each) => each.id === folder.accountId)!;
              const target: MailboxView = { kind: "folder", accountId: folder.accountId, folderId: folder.id };
              const label = folderLabel(folder, t);
              const ref = folderRefOf(
                folder,
                mailbox,
                allFolders.filter((each) => each.accountId === folder.accountId),
              );
              const items: MenuItem[] = [];
              if (folder.rights?.maySetSeen !== false) {
                items.push({
                  label: t("markAllRead.folder"),
                  onSelect: () => void markAllRead(client, { kind: "view", view: target }),
                });
              }
              items.push({
                label: t("folders.unfavorite"),
                onSelect: () => setFolderListed("favoriteFolders", ref, false),
              });
              return (
                <NavItem
                  key={folder.id}
                  icon={folderIcon(folder)}
                  label={mailboxes.length > 1 ? `${label} · ${mailbox.email}` : label}
                  title={mailbox.email}
                  count={countsUnread(folder) ? folder.unread : undefined}
                  active={sameView(view, target)}
                  onClick={() => setView(target)}
                  menu={{ label: t("folders.actions", { name: label }), items }}
                />
              );
            })}
          </section>
        )}

        {ordered.map((mailbox) => {
          const account = accounts.find((each) => each.id === mailbox.id);
          if (account) {
            return (
              <AccountSection
                key={account.id}
                account={account}
                owner={mailbox}
                onReorder={reorder}
                folders={folders.filter((f) => f.accountId === account.id)}
              />
            );
          }
          const owner = sharedAccounts.find((each) => each.id === mailbox.id);
          return (
            owner && (
              <SharedSection
                key={owner.id}
                owner={owner}
                mailbox={mailbox}
                onReorder={reorder}
                folders={allFolders.filter((f) => f.accountId === owner.id)}
              />
            )
          );
        })}

        <LabelNavSection />
      </div>

      <div className="flex flex-col gap-0.5 border-t border-hairline pt-3">
        <NavItem icon={Settings} label={t("nav.settings")} active={false} onClick={() => openSettings()} />
        <NavItem
          icon={SlidersHorizontal}
          label={t("nav.portal")}
          active={false}
          onClick={() => window.location.assign(PORTAL_URL)}
        />
      </div>
    </nav>
  );
}
