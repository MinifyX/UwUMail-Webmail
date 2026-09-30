/**
 * The widths of the desktop columns (folders | list | reader), dragged by the person and kept per
 * browser. The reader takes what is left; the other two stay within their limits and give way
 * when the window gets too narrow for the reader.
 */

export type Pane = "sidebar" | "list";
export type PaneWidths = Record<Pane, number>;

export const PANE_LIMITS: Record<Pane, { min: number; max: number; initial: number }> = {
  sidebar: { min: 200, max: 380, initial: 240 },
  list: { min: 300, max: 720, initial: 400 },
};

/** The reader keeps at least this much, whatever the other two want. */
export const READER_MIN = 420;

/** How far an arrow key moves a handle; with Shift four times as far. */
export const KEY_STEP = 16;

export const PANES_STORAGE_KEY = "uwumail.webmail.panes";

export const INITIAL_WIDTHS: PaneWidths = {
  sidebar: PANE_LIMITS.sidebar.initial,
  list: PANE_LIMITS.list.initial,
};

export function clampPane(pane: Pane, width: number): number {
  const { min, max, initial } = PANE_LIMITS[pane];
  if (!Number.isFinite(width)) return initial;
  return Math.round(Math.min(max, Math.max(min, width)));
}

/** What this browser kept; the initial widths where nothing (or nothing usable) is stored. */
export function loadPaneWidths(storage: Pick<Storage, "getItem"> | null = safeStorage()): PaneWidths {
  try {
    const raw = storage?.getItem(PANES_STORAGE_KEY);
    if (!raw) return { ...INITIAL_WIDTHS };
    const parsed: unknown = JSON.parse(raw);
    const stored = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    const read = (pane: Pane) =>
      typeof stored[pane] === "number" ? clampPane(pane, stored[pane]) : PANE_LIMITS[pane].initial;
    return { sidebar: read("sidebar"), list: read("list") };
  } catch {
    return { ...INITIAL_WIDTHS };
  }
}

/** Keeps the widths for the next visit; a browser that refuses (private mode, full) just forgets them. */
export function savePaneWidths(widths: PaneWidths, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(PANES_STORAGE_KEY, JSON.stringify(widths));
  } catch {
    // Nothing to do: the widths still hold for this page.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The widths that fit into `available` pixels (the handles already taken off) with room for the
 * reader: the list gives way first, then the folders, never below their minimum.
 */
export function fitPanes(widths: PaneWidths, available: number, sidebar: boolean): PaneWidths {
  const fitted = { ...widths };
  let over = (sidebar ? fitted.sidebar : 0) + fitted.list + READER_MIN - available;
  if (over <= 0) return fitted;
  const fromList = Math.min(over, fitted.list - PANE_LIMITS.list.min);
  fitted.list -= Math.max(0, fromList);
  over -= Math.max(0, fromList);
  if (sidebar && over > 0) {
    fitted.sidebar -= Math.max(0, Math.min(over, fitted.sidebar - PANE_LIMITS.sidebar.min));
  }
  return fitted;
}

/** The width a key on a handle asks for; null for keys that don't move it. */
export function keyedWidth(pane: Pane, width: number, key: string, shift: boolean): number | null {
  const step = shift ? KEY_STEP * 4 : KEY_STEP;
  switch (key) {
    case "ArrowLeft":
      return clampPane(pane, width - step);
    case "ArrowRight":
      return clampPane(pane, width + step);
    case "Home":
      return PANE_LIMITS[pane].min;
    case "End":
      return PANE_LIMITS[pane].max;
    default:
      return null;
  }
}
