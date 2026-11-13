import { describe, expect, it } from "vitest";
import {
  clampPane,
  fitPanes,
  INITIAL_WIDTHS,
  loadPaneWidths,
  PANE_LIMITS,
  PANES_STORAGE_KEY,
  READER_MIN,
  savePaneWidths,
} from "./paneSizes";

function memory(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

const refusing = {
  getItem: () => {
    throw new DOMException("denied", "SecurityError");
  },
  setItem: () => {
    throw new DOMException("full", "QuotaExceededError");
  },
};

describe("column widths", () => {
  it("come back as they were kept", () => {
    const storage = memory();
    savePaneWidths({ sidebar: 280, list: 512 }, storage);
    expect(JSON.parse(storage.values.get(PANES_STORAGE_KEY)!)).toEqual({ sidebar: 280, list: 512 });
    expect(loadPaneWidths(storage)).toEqual({ sidebar: 280, list: 512 });
  });

  it("start at the initial widths without storage, with garbage, or when the browser refuses", () => {
    expect(loadPaneWidths(memory())).toEqual(INITIAL_WIDTHS);
    expect(loadPaneWidths(memory({ [PANES_STORAGE_KEY]: "{nope" }))).toEqual(INITIAL_WIDTHS);
    expect(loadPaneWidths(memory({ [PANES_STORAGE_KEY]: '{"list":"wide"}' }))).toEqual(INITIAL_WIDTHS);
    expect(loadPaneWidths(refusing)).toEqual(INITIAL_WIDTHS);
    expect(loadPaneWidths(null)).toEqual(INITIAL_WIDTHS);
    expect(() => savePaneWidths(INITIAL_WIDTHS, refusing)).not.toThrow();
  });

  it("stay within their limits, also when stored by hand", () => {
    expect(loadPaneWidths(memory({ [PANES_STORAGE_KEY]: '{"sidebar":10,"list":99999}' }))).toEqual({
      sidebar: PANE_LIMITS.sidebar.min,
      list: PANE_LIMITS.list.max,
    });
    expect(clampPane("list", 333.6)).toBe(334);
    expect(clampPane("list", Number.NaN)).toBe(PANE_LIMITS.list.initial);
  });

  it("give way to the reader in a narrow window, the list first, never below their minimum", () => {
    const wide = { sidebar: 300, list: 600 };
    expect(fitPanes(wide, 300 + 600 + READER_MIN, true)).toEqual(wide);
    expect(fitPanes(wide, 300 + 600 + READER_MIN - 100, true)).toEqual({ sidebar: 300, list: 500 });
    expect(fitPanes(wide, 800, true)).toEqual({ sidebar: PANE_LIMITS.sidebar.min, list: PANE_LIMITS.list.min });
    // Without the folders only the list gives way.
    expect(fitPanes(wide, 900, false)).toEqual({ sidebar: 300, list: 900 - READER_MIN });
  });
});
