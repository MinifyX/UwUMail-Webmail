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

  it("keep the arrangement, templates and quiet hours, without broken entries", async () => {
    const ref = { account: "mini@uwumail.test", folder: "INBOX/Work" };
    const template = { name: "Thanks", subject: "", html: "<p>Hi</p>" };
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: {
          unifiedHidden: ["leni@uwumail.test", 5],
          accountsOrder: ["mini@uwumail.test", null],
          notifyMuted: ["leni@uwumail.test", {}],
          unifiedFolders: [ref, { account: "x" }, null],
          favoriteFolders: [ref, "INBOX"],
          hiddenFolders: "everything",
          showHiddenFolders: true,
          attachmentReminder: false,
          templates: { ok: template, half: { name: "x" }, text: "hi" },
          quietHours: { enabled: true, from: "22:00", to: "07:00", days: [1, 2, 9, "3"] },
        },
        version: 1,
      }),
    );
    await useSettings.persist.rehydrate();
    const state = useSettings.getState();
    expect(state.unifiedHidden).toEqual(["leni@uwumail.test"]);
    expect(state.accountsOrder).toEqual(["mini@uwumail.test"]);
    expect(state.notifyMuted).toEqual(["leni@uwumail.test"]);
    expect(state.unifiedFolders).toEqual([ref]);
    expect(state.favoriteFolders).toEqual([ref]);
    expect(state.hiddenFolders).toEqual([]);
    expect(state.showHiddenFolders).toBe(true);
    expect(state.attachmentReminder).toBe(false);
    expect(state.templates).toEqual({ ok: template });
    expect(state.quietHours).toEqual({ enabled: true, from: "22:00", to: "07:00", days: [1, 2] });
  });

  it("fall back to no quiet hours when they are broken", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { quietHours: { enabled: "yes" } }, version: 1 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().quietHours).toEqual(DEFAULT_SETTINGS.quietHours);
  });

  it("drop snoozes that are not whole", async () => {
    const snooze = {
      account: "mini@uwumail.test",
      messageId: "a@uwumail.test",
      folder: "INBOX",
      until: "2026-10-21T07:00:00Z",
    };
    localStorage.setItem(
      KEY,
      JSON.stringify({
        state: { snoozes: { ok: snooze, empty: null, half: { ...snooze, until: 5 }, text: "soon" } },
        version: 1,
      }),
    );
    await useSettings.persist.rehydrate();
    expect(useSettings.getState().snoozes).toEqual({ ok: snooze });
  });
});

describe("font settings", () => {
  afterEach(() => {
    useSettings.setState({ font: DEFAULT_SETTINGS.font, senderFonts: DEFAULT_SETTINGS.senderFonts });
  });

  it("start with UwU Sans and serif fonts replaced", () => {
    expect(DEFAULT_SETTINGS.font).toBe("uwu");
    expect(DEFAULT_SETTINGS.senderFonts).toBe("replace");
  });

  it("are kept in this browser and come back", async () => {
    useSettings.getState().update({ font: "rubik", senderFonts: "keep" });
    const saved = localStorage.getItem(KEY)!;
    expect(JSON.parse(saved).state).toMatchObject({ font: "rubik", senderFonts: "keep" });
    useSettings.setState({ font: "uwu", senderFonts: "replace" });
    localStorage.setItem(KEY, saved);
    await useSettings.persist.rehydrate();
    expect(useSettings.getState()).toMatchObject({ font: "rubik", senderFonts: "keep" });
  });

  it("fall back to the defaults for values this version doesn't know", async () => {
    localStorage.setItem(KEY, JSON.stringify({ state: { font: "comic", senderFonts: 3 }, version: 1 }));
    await useSettings.persist.rehydrate();
    expect(useSettings.getState()).toMatchObject({ font: "uwu", senderFonts: "replace" });
  });
});
