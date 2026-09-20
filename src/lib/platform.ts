/** Opens a link in a new tab, never inside the webmail's own page. */
export async function openExternal(url: string) {
  window.open(url, "_blank", "noopener,noreferrer");
}

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

export const modKey = isMac ? "⌘" : "Ctrl";
