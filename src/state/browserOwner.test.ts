import { beforeEach, describe, expect, it } from "vitest";
import { loadLocalDraft, saveLocalDraft } from "@/features/compose/localDraft";
import { claimBrowser, SYNC_META_KEY } from "./browserOwner";
import { DEFAULT_SETTINGS, useSettings } from "./settings";

function leaveTraces() {
  useSettings.setState({
    trustedSenders: ["news@shop.example"],
    linkDomains: ["shop.example"],
    senderAppearance: { "news@shop.example": "dark" },
    linkConfirm: false,
    remoteImages: "always",
  });
  saveLocalDraft({
    mode: "new",
    accountId: "a",
    to: [{ email: "friend@example.org" }],
    cc: [],
    bcc: [{ email: "secret@example.org" }],
    subject: "Private",
    html: "<p>Only for me</p>",
  });
  localStorage.setItem(SYNC_META_KEY, JSON.stringify({ account: "a@example.org", pending: {} }));
}

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({ ...DEFAULT_SETTINGS });
});

describe("claimBrowser", () => {
  it("keeps everything for the same login, in any spelling", () => {
    expect(claimBrowser("A@Example.org")).toBe(false);
    leaveTraces();
    expect(claimBrowser("a@example.org")).toBe(false);
    expect(useSettings.getState().trustedSenders).toEqual(["news@shop.example"]);
    expect(loadLocalDraft()).not.toBeNull();
    expect(localStorage.getItem(SYNC_META_KEY)).not.toBeNull();
  });

  it("clears what the last login left when someone else signs in", () => {
    claimBrowser("a@example.org");
    leaveTraces();
    expect(claimBrowser("b@example.org")).toBe(true);
    const settings = useSettings.getState();
    expect(settings.trustedSenders).toEqual([]);
    expect(settings.linkDomains).toEqual([]);
    expect(settings.senderAppearance).toEqual({});
    expect(settings.linkConfirm).toBe(true);
    expect(settings.remoteImages).toBe("ask");
    expect(loadLocalDraft()).toBeNull();
    expect(localStorage.getItem(SYNC_META_KEY)).toBeNull();
    // And the new login is the owner from now on.
    expect(claimBrowser("b@example.org")).toBe(false);
  });
});
