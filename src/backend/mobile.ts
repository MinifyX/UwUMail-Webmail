import type { ThreadPage, ThreadQuery } from "./types";

/**
 * What the app gets from Android, as far as a browser can do it.
 *
 * The phone layout is shared with the app, so the pieces it calls exist here
 * too — most of them simply do nothing. The one thing a browser really has is
 * vibration, which is what a swipe needs.
 */
export const nativeAndroid = false;

/** The server searches everything anyway, so there is no second path here. */
export async function searchServer(_query: ThreadQuery): Promise<ThreadPage | null> {
  return null;
}

export const mobile = {
  /** A short tick, e.g. when a swipe crosses its threshold. */
  async haptic(style: "light" | "medium" = "light") {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      navigator.vibrate(style === "light" ? 8 : 16);
    }
  },
};
