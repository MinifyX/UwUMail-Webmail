import { useUi } from "@/state/ui";

/** The search field in the top bar, or above the list on a phone. */
export const SEARCH_INPUT_ID = "uwu-search";

/** ⌘K and /: back to the mail if needed, then into the search field. */
export function focusSearch() {
  const ui = useUi.getState();
  if (ui.section !== "mail") ui.setSection("mail");
  requestAnimationFrame(() => {
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  });
}
