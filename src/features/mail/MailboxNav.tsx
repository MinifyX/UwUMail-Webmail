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
  WifiOff,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { backend } from "@/backend/backend";
import type { Account, Folder, MailboxView } from "@/backend/types";
import { AccountDot } from "@/components/ui/Avatar";
import { Button, IconButton } from "@/components/ui/Button";
import { Wordmark } from "@/components/ui/Logo";
import { ContextMenu } from "@/components/ui/Menu";
import { Badge } from "@/components/ui/Pill";
import { useT } from "@/i18n";
import { useFolders, useMessageActions, useVisibleAccounts } from "@/lib/queries";
import { openFolderDialog } from "@/state/folderDialog";
import { toast } from "@/state/toasts";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import { PORTAL_URL } from "@/backend/server";
import { buildFolderTree, countsUnread, type FolderNode } from "./folderTree";
import { THREAD_DRAG_TYPE, useSelectionActions } from "./selection";
import { folderIcon, sameView, UNIFIED_ICONS } from "./view";

const UNIFIED_ROLES = ["inbox", "unread", "flagged", "drafts", "sent"] as const;

interface NavItemProps {
  icon: LucideIcon;
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}

function NavItem({ icon: Icon, label, count, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={clsx(
        "group flex h-9 w-full items-center gap-3 rounded-xl px-3 text-left text-[13.5px] transition-colors",
        active ? "bg-pink-tint font-semibold text-pink-ink" : "text-ink/85 hover:bg-pink-tint/50",
      )}
    >
      <Icon className={clsx("size-[17px] shrink-0", active ? "text-pink" : "text-muted")} strokeWidth={2} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && count > 0 && <Badge count={count} />}
    </button>
  );
}

const INDENT = 16;

function Glyph({ icon: Icon, active }: { icon: LucideIcon; active: boolean }) {
  return (
    <Icon className={clsx("size-[17px] shrink-0", active ? "text-pink" : "text-muted")} strokeWidth={2} aria-hidden />
  );
}

/** What can be done to a folder from its menu. Role folders keep their name and stay. */
function useFolderMenuItems(folder: Folder, account: Account) {
  const { t } = useT();
  const items: { label: string; onSelect: () => void; danger?: boolean }[] = [];
  if (folder.role === "trash" || folder.role === "junk") {
    const role = folder.role;
    items.push({ label: t(`folders.empty.${role}`), onSelect: () => openFolderDialog({ kind: "empty", folder }) });
    return items;
  }
  items.push({
    label: t("folders.newInside"),
    onSelect: () => openFolderDialog({ kind: "create", accountId: account.id, parent: folder }),
  });
  if (!folder.role) {
    items.push({ label: t("folders.rename"), onSelect: () => openFolderDialog({ kind: "rename", folder }) });
    items.push({
      label: t("folders.delete"),
      danger: true,
      onSelect: () => openFolderDialog({ kind: "delete", folder }),
    });
  }
  return items;
}

/** How long a finger rests on a folder before its menu opens. */
const LONG_PRESS = 550;

function FolderItem({ node, account }: { node: FolderNode; account: Account }) {
  const { t } = useT();
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const press = useRef<{ timer: number; x: number; y: number; fired: boolean } | null>(null);
  const menuItems = useFolderMenuItems(node.folder, account);
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const collapsed = useSettings((s) => s.collapsedFolders.includes(node.folder.id));
  const toggleFolder = useSettings((s) => s.toggleFolder);
  const { folder, depth, children } = node;
  const hasChildren = children.length > 0;
  const target: MailboxView = { kind: "folder", accountId: account.id, folderId: folder.id };
  const active = sameView(view, target);
  const icon = folder.selectable ? folderIcon(folder) : FolderOpen;
  // A collapsed folder also shows what's unread inside it.
  const count = hasChildren && collapsed ? node.unreadInside : countsUnread(folder) ? folder.unread : 0;
  const label = folder.role ? t(`folder.${folder.role}`) : folder.name;
  const selection = useSelectionActions();
  const actions = useMessageActions();
  const [dropping, setDropping] = useState(false);
  const accepts = (event: React.DragEvent) => folder.selectable && event.dataTransfer.types.includes(THREAD_DRAG_TYPE);

  return (
    <li role="treeitem" aria-expanded={hasChildren ? !collapsed : undefined} aria-selected={active}>
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
          const threadIds = JSON.parse(event.dataTransfer.getData(THREAD_DRAG_TYPE) || "[]") as string[];
          void selection.messagesOf(threadIds).then((messages) => {
            const here = messages.filter((message) => message.accountId === account.id).map((message) => message.id);
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
          {count > 0 && (
            <Badge count={count} className={clsx(menuAt === null && "pointer-fine:group-hover:invisible")} />
          )}
        </button>
        <button
          type="button"
          aria-label={t("folders.actions", { name: label })}
          title={t("folders.actions", { name: label })}
          aria-haspopup="menu"
          aria-expanded={menuAt !== null}
          onClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            setMenuAt(menuAt ? null : { x: rect.right - 200, y: rect.bottom + 4 });
          }}
          className={clsx(
            "absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-full text-muted hover:bg-pink-tint-strong hover:text-ink focus-visible:opacity-100 pointer-coarse:hidden",
            menuAt ? "opacity-100" : "opacity-0 group-hover:opacity-100",
          )}
        >
          <Ellipsis className="size-4" aria-hidden />
        </button>
        <ContextMenu
          at={menuAt}
          items={menuItems}
          onClose={() => setMenuAt(null)}
          label={t("folders.actions", { name: label })}
        />
      </div>
      {hasChildren && !collapsed && (
        <ul role="group" className="flex flex-col gap-0.5 pt-0.5">
          {children.map((child) => (
            <FolderItem key={child.folder.id} node={child} account={account} />
          ))}
        </ul>
      )}
    </li>
  );
}

function AccountSection({ account, folders }: { account: Account; folders: Folder[] }) {
  const [open, setOpen] = useState(true);
  const { t } = useT();
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
      <div className="flex items-center">
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
      </div>
      {open && (
        <ul role="tree" aria-label={account.email} className="flex flex-col gap-0.5">
          {tree.map((node) => (
            <FolderItem key={node.folder.id} node={node} account={account} />
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
  const view = useUi((s) => s.view);
  const setView = useUi((s) => s.setView);
  const openCompose = useUi((s) => s.openCompose);
  const openSettings = useUi((s) => s.openSettings);

  const folders = allFolders.filter((f) => accounts.some((account) => account.id === f.accountId));
  const unreadInboxes = folders.filter((f) => f.role === "inbox").reduce((sum, f) => sum + f.unread, 0);

  return (
    <nav className={clsx("flex h-full flex-col gap-4 px-3 pt-4 pb-3", className)}>
      <div className="flex items-center justify-between px-2">
        <Wordmark className="text-[19px]" hop={hops} />
      </div>

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
            return (
              <NavItem
                key={role}
                icon={UNIFIED_ICONS[role]}
                label={t(`nav.${role}`)}
                count={role === "inbox" ? unreadInboxes : undefined}
                active={sameView(view, target)}
                onClick={() => setView(target)}
              />
            );
          })}
        </section>

        {accounts.map((account) => (
          <AccountSection
            key={account.id}
            account={account}
            folders={folders.filter((f) => f.accountId === account.id)}
          />
        ))}
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
