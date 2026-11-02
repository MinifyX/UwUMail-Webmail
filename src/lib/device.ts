import { useSyncExternalStore } from "react";

/** Running inside the Android app (also true for Android tablets). */
export const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

/**
 * Whether the browser is WebKit: Safari on macOS, any browser on iOS and iPadOS (they all must use
 * WebKit, and name themselves CriOS/FxiOS/EdgiOS rather than Chrome/Firefox/Edge), and WKWebView.
 * Chromium-based browsers also say AppleWebKit, but always with a Chrome/ token. iPadOS asks for
 * desktop sites with a Mac user agent, but has touch points.
 */
export function detectWebKit(userAgent: string, maxTouchPoints = 0): boolean {
  if (/\b(iPhone|iPad|iPod)\b/.test(userAgent)) return true;
  if (/Macintosh/.test(userAgent) && maxTouchPoints > 1) return true;
  return /AppleWebKit\//.test(userAgent) && !/Chrome\/|Chromium\/|Edg\/|OPR\/|Firefox\/|Android/.test(userAgent);
}

export const isWebKit =
  typeof navigator !== "undefined" && detectWebKit(navigator.userAgent, navigator.maxTouchPoints ?? 0);

/** Below this width UwUMail uses the one-column phone layout. */
export const PHONE_QUERY = "(max-width: 699px)";
/** The Pro layout needs room for three columns; narrower windows fall back to Simple. */
export const PRO_QUERY = "(min-width: 1100px)";

export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (callback) => {
      const media = window.matchMedia(query);
      media.addEventListener("change", callback);
      return () => media.removeEventListener("change", callback);
    },
    () => window.matchMedia(query).matches,
  );
}

export function useIsPhone() {
  return useMediaQuery(PHONE_QUERY);
}
