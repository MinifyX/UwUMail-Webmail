import { create } from "zustand";
import { clampPane, INITIAL_WIDTHS, loadPaneWidths, savePaneWidths, type Pane, type PaneWidths } from "@/lib/paneSizes";

interface PaneState {
  widths: PaneWidths;
  /** While dragging: follows the pointer without writing to the storage every time. */
  setWidth: (pane: Pane, width: number) => void;
  /** Keeps the widths as they are now, e.g. when a drag ends. */
  save: () => void;
  /** Back to the initial width (a double-click on the handle). */
  reset: (pane: Pane) => void;
}

/** The desktop columns' widths, kept in this browser (see lib/paneSizes). */
export const usePanes = create<PaneState>()((set, get) => ({
  widths: loadPaneWidths(),
  setWidth: (pane, width) => set((state) => ({ widths: { ...state.widths, [pane]: clampPane(pane, width) } })),
  save: () => savePaneWidths(get().widths),
  reset: (pane) => {
    set((state) => ({ widths: { ...state.widths, [pane]: INITIAL_WIDTHS[pane] } }));
    savePaneWidths(get().widths);
  },
}));
