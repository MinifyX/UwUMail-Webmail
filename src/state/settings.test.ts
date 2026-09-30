import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS, useSettings } from "./settings";

const KEY = "uwumail.webmail";

afterEach(() => {
  useSettings.setState({ nyuAnimations: DEFAULT_SETTINGS.nyuAnimations });
  localStorage.removeItem(KEY);
});

describe("Nyu animations setting", () => {
  it("is on by default", () => {
    expect(DEFAULT_SETTINGS.nyuAnimations).toBe("on");
  });

  it("is kept in this browser and comes back", async () => {
    useSettings.getState().update({ nyuAnimations: "reduced" });
    const saved = localStorage.getItem(KEY)!;
    expect(JSON.parse(saved).state.nyuAnimations).toBe("reduced");
    // A new page: the store starts from the defaults and reads what the browser kept.
    useSettings.setState({ nyuAnimations: "on" });
    localStorage.setItem(KEY, saved);
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().nyuAnimations).toBe("reduced");
  });

  it("falls back to on for a value this version doesn't know", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { nyuAnimations: "wild" }, version: 1 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().nyuAnimations).toBe("on");
  });
});

describe("settings kept in this browser", () => {
  afterEach(() => useSettings.setState({ ...DEFAULT_SETTINGS }));

  it("take only known settings of the right type", async () => {
    const update = useSettings.getState().update;
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { update: "not a function", trustedSenders: "everyone", linkConfirm: false, undoSendSeconds: "10" },
        version: 1,
      }),
    );
    await useSettings.persist.rehydrate();
    const state = useSettings.getState();
    expect(state.update).toBe(update);
    expect(state.trustedSenders).toEqual([]);
    expect(state.linkConfirm).toBe(false);
    expect(state.undoSendSeconds).toBe(DEFAULT_SETTINGS.undoSendSeconds);
    expect("unknown" in state).toBe(false);
  });
});
