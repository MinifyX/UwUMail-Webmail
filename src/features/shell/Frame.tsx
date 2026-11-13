import { Button, Icon, IconButton, ICONS } from "@uwusuite/design";
import clsx from "clsx";
import type { LucideIcon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PORTAL_URL } from "@/backend/server";
import { Avatar } from "@/components/ui/Avatar";
import { LogoSymbol } from "@/components/ui/Logo";
import { Menu } from "@/components/ui/Menu";
import { useT } from "@/i18n";
import { useHotkeys, type HotkeyMap } from "@/lib/hotkeys";
import { modKey } from "@/lib/platform";
import { useAccounts } from "@/lib/queries";
import { useBrand } from "@/state/brand";
import { withSearchTerm } from "@/lib/searchQuery";
import { useUi, type AppSection } from "@/state/ui";
import { SearchHelp } from "../mail/SearchHelp";
import { useNewMailHops } from "../mail/MailboxNav";
import { focusSearch, SEARCH_INPUT_ID } from "./search";
import { SECTIONS, useAvailableSections } from "./sections";

/** ⌘K goes to the search everywhere, ⌘⇧K opens the command palette. */
export function useFrameHotkeys() {
  const map = useMemo<HotkeyMap>(
    () => ({
      "mod+k": () => focusSearch(),
      "mod+shift+k": () => useUi.getState().setPaletteOpen(true),
    }),
    [],
  );
  useHotkeys(map);
}

const RAIL_BUTTON = "grid size-11 place-items-center rounded-control transition-colors";

/** The account at the bottom of the rail: its picture, and a menu with account, settings and keys. */
function AccountMenu({ side = "above" }: { side?: "above" | "below" }) {
  const { t } = useT();
  const { data: accounts = [] } = useAccounts();
  const account = accounts[0];
  const ui = useUi.getState();
  return (
    <Menu
      side={side}
      items={[
        {
          label: t("nav.portal"),
          onSelect: () => window.location.assign(PORTAL_URL),
          group: account?.email ?? t("nav.account"),
        },
        { label: t("nav.settings"), onSelect: () => ui.openSettings(), group: account?.email ?? t("nav.account") },
        {
          label: t("settings.shortcuts"),
          onSelect: () => ui.setShortcutsOpen(true),
          group: account?.email ?? t("nav.account"),
        },
      ]}
      trigger={({ open, toggle, ...aria }) => (
        <button
          type="button"
          {...aria}
          onClick={toggle}
          aria-label={t("nav.account")}
          title={account?.email}
          className={clsx(RAIL_BUTTON, open ? "bg-pink-tint" : "hover:bg-pink-tint/50")}
        >
          {account ? (
            <Avatar address={{ name: account.name, email: account.email }} size="sm" />
          ) : (
            <Icon icon={ICONS.account} size="lg" className="text-muted" />
          )}
        </button>
      )}
    />
  );
}

/** The 64 px strip on the left: the symbol, mail, calendar and contacts, settings and the account. */
export function IconRail() {
  const { t } = useT();
  const hops = useNewMailHops();
  const name = useBrand((s) => s.name);
  const available = useAvailableSections();
  const section = useUi((s) => s.section);
  const settingsOpen = useUi((s) => s.settingsOpen !== null);
  const { setSection, setView, openSettings } = useUi.getState();
  return (
    <nav aria-label={t("nav.apps")} className="flex w-16 shrink-0 flex-col items-center gap-1.5 py-3">
      <button
        type="button"
        aria-label={name}
        title={name}
        onClick={() => setView({ kind: "unified", role: "inbox" })}
        className={clsx(RAIL_BUTTON, "mb-3")}
      >
        <LogoSymbol className="h-8 w-auto max-w-10" hop={hops} />
      </button>
      {SECTIONS.filter(({ id }) => available.includes(id)).map(({ id, icon: Glyph }) => (
        <button
          key={id}
          type="button"
          aria-label={t(`nav.section.${id}`)}
          aria-current={section === id ? "page" : undefined}
          title={t(`nav.section.${id}`)}
          onClick={() => setSection(id)}
          className={clsx(
            RAIL_BUTTON,
            section === id ? "bg-pink-tint text-pink-ink" : "text-muted hover:bg-pink-tint/50 hover:text-ink",
          )}
        >
          <Icon icon={Glyph} size="lg" />
        </button>
      ))}
      <span className="flex-1" aria-hidden />
      <button
        type="button"
        aria-label={t("nav.settings")}
        title={t("nav.settings")}
        onClick={() => openSettings()}
        className={clsx(
          RAIL_BUTTON,
          settingsOpen ? "bg-pink-tint text-pink-ink" : "text-muted hover:bg-pink-tint/50 hover:text-ink",
        )}
      >
        <Icon icon={ICONS.settings} size="lg" />
      </button>
      <AccountMenu />
    </nav>
  );
}

/**
 * The search over all mailboxes. Typing goes back to the mail and narrows the list there,
 * a moment after the last key.
 */
export function GlobalSearch({ className, autoFocus }: { className?: string; autoFocus?: boolean }) {
  const { t } = useT();
  const search = useUi((s) => s.search);
  const [draft, setDraft] = useState(search);
  const [focused, setFocused] = useState(false);

  // Cleared elsewhere (e.g. a new folder): the field follows.
  const [seen, setSeen] = useState(search);
  if (search !== seen) {
    setSeen(search);
    setDraft(search);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      const ui = useUi.getState();
      if (draft === ui.search) return;
      if (draft && ui.section !== "mail") ui.setSection("mail");
      ui.setSearch(draft);
    }, 180);
    return () => clearTimeout(timer);
  }, [draft]);

  return (
    <div role="search" className={clsx("relative", className)}>
      <Icon icon={ICONS.search} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-muted" />
      <input
        id={SEARCH_INPUT_ID}
        type="search"
        value={draft}
        autoFocus={autoFocus}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setDraft("");
            event.currentTarget.blur();
          }
        }}
        placeholder={t("nav.searchAll")}
        aria-label={t("nav.searchAll")}
        enterKeyHint="search"
        className="h-10 w-full rounded-full border border-hairline bg-surface pr-22 pl-10 text-body placeholder:text-muted focus:border-pink focus:shadow-focus focus:outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      <div className="absolute top-1/2 right-1 flex -translate-y-1/2 items-center">
        {!draft && !focused && (
          <kbd
            aria-hidden
            className="pointer-events-none mr-1 rounded-small border border-line bg-canvas px-1.5 font-sans text-badge font-bold text-muted max-md:hidden"
          >
            {modKey} K
          </kbd>
        )}
        <SearchHelp
          onInsert={(term) => {
            setDraft(withSearchTerm(draft, term));
            document.getElementById(SEARCH_INPUT_ID)?.focus();
          }}
        />
        {draft && (
          <IconButton icon={ICONS.close} size="sm" label={t("list.clearSearch")} onClick={() => setDraft("")} />
        )}
      </div>
    </div>
  );
}

/** Above the content on a desktop: the search in the middle, writing on the right. */
export function TopBar() {
  const { t } = useT();
  const openCompose = useUi((s) => s.openCompose);
  return (
    <header className="grid h-14 shrink-0 grid-cols-[1fr_minmax(0,520px)_1fr] items-center gap-3 pr-3">
      <span aria-hidden />
      <GlobalSearch className="w-full" />
      <div className="flex justify-end">
        <Button variant="primary" icon={ICONS.compose} onClick={() => openCompose({ mode: "new" })}>
          {t("nav.compose")}
        </Button>
      </div>
    </header>
  );
}

type PhoneTab = "inbox" | "folders" | AppSection | "more";

function useActiveTab(): PhoneTab {
  return useUi((s) =>
    s.moreOpen ? "more" : s.section !== "mail" ? s.section : s.folderDrawerOpen ? "folders" : "inbox",
  );
}

/** The phone's tabs at the bottom: inbox, folders, calendar, contacts, more. */
export function PhoneTabBar() {
  const { t } = useT();
  const active = useActiveTab();
  const available = useAvailableSections();
  const unread = useUi((s) => s.view.kind === "unified" && s.view.role === "inbox");
  const tabs: { id: PhoneTab; icon: LucideIcon; label: string; run: () => void }[] = [
    {
      id: "inbox",
      icon: ICONS.inbox,
      label: t("nav.inbox"),
      run: () => {
        const ui = useUi.getState();
        // A second tap, or from elsewhere when the list already shows the inbox, goes to the inbox.
        if (active === "inbox" || unread) ui.setView({ kind: "unified", role: "inbox" });
        else ui.setSection("mail");
      },
    },
    {
      id: "folders",
      icon: ICONS.folderOpen,
      label: t("nav.menu"),
      run: () => {
        const ui = useUi.getState();
        ui.setSection("mail");
        ui.setFolderDrawerOpen(true);
      },
    },
    ...(available.includes("calendar")
      ? [
          {
            id: "calendar" as const,
            icon: ICONS.calendar,
            label: t("nav.section.calendar"),
            run: () => useUi.getState().setSection("calendar"),
          },
        ]
      : []),
    ...(available.includes("contacts")
      ? [
          {
            id: "contacts" as const,
            icon: ICONS.contacts,
            label: t("nav.section.contacts"),
            run: () => useUi.getState().setSection("contacts"),
          },
        ]
      : []),
    { id: "more", icon: ICONS.more, label: t("mobile.more"), run: () => useUi.getState().setMoreOpen(true) },
  ];
  return (
    <nav
      aria-label={t("nav.tabs")}
      className="flex shrink-0 border-t border-hairline bg-surface/95 px-1 pt-1 pb-[calc(0.25rem+env(safe-area-inset-bottom))] backdrop-blur"
    >
      {tabs.map(({ id, icon: Glyph, label, run }) => (
        <button
          key={id}
          type="button"
          onClick={run}
          aria-current={active === id ? "page" : undefined}
          className={clsx(
            "flex h-12 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-control text-badge font-semibold transition-colors",
            active === id ? "text-pink-ink" : "text-muted",
          )}
        >
          <span
            className={clsx(
              "grid h-7 w-12 place-items-center rounded-full transition-colors",
              active === id && "bg-pink-tint",
            )}
          >
            <Icon icon={Glyph} size="lg" />
          </span>
          <span className="max-w-full truncate">{label}</span>
        </button>
      ))}
    </nav>
  );
}

/** The phone's "More" tab: what the rail holds on a desktop. */
export function MoreScreen() {
  const { t } = useT();
  const { data: accounts = [] } = useAccounts();
  const ui = useUi.getState();
  const rows: { label: string; run: () => void }[] = [
    { label: t("nav.settings"), run: () => ui.openSettings() },
    { label: t("nav.portal"), run: () => window.location.assign(PORTAL_URL) },
    { label: t("shortcuts.palette"), run: () => ui.setPaletteOpen(true) },
    { label: t("settings.shortcuts"), run: () => ui.setShortcutsOpen(true) },
  ];
  return (
    <section className="flex h-full flex-col overflow-y-auto bg-surface" aria-label={t("mobile.more")}>
      <header className="px-4 pt-4 pb-3">
        <h1 className="text-large leading-tight font-extrabold tracking-[-0.02em]">{t("mobile.more")}</h1>
      </header>
      {accounts.length > 0 && (
        <ul className="mx-3 mb-4 flex flex-col overflow-hidden rounded-card border border-hairline">
          {accounts.map((account) => (
            <li key={account.id} className="flex items-center gap-3 border-b border-hairline px-4 py-3 last:border-0">
              <Avatar address={{ name: account.name, email: account.email }} size="md" />
              <span className="min-w-0">
                {account.name && <span className="block truncate text-body font-semibold">{account.name}</span>}
                <span className="block truncate text-meta text-muted">{account.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <ul className="mx-3 flex flex-col overflow-hidden rounded-card border border-hairline">
        {rows.map((row) => (
          <li key={row.label} className="border-b border-hairline last:border-0">
            <button
              type="button"
              onClick={row.run}
              className="flex h-12 w-full items-center px-4 text-left text-reading hover:bg-pink-tint/50"
            >
              {row.label}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
