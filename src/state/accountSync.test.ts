import { afterEach, describe, expect, it, vi } from "vitest";
import { loadMeta } from "./accountSync";
import { SYNC_META_KEY } from "./browserOwner";

vi.mock("@/backend/backend", () => ({ backend: () => ({}) }));

afterEach(() => localStorage.clear());

describe("the settings sync's bookkeeping in this browser", () => {
  it("comes back when it has the expected shape", () => {
    const meta = { account: "a@example.org", state: "s1", pending: {}, refused: ["x"], synced: true, lastSync: 5 };
    localStorage.setItem(SYNC_META_KEY, JSON.stringify(meta));
    expect(loadMeta()).toEqual(meta);
  });

  it("starts over when it is broken", () => {
    for (const broken of [
      { account: "a@example.org" },
      { account: "a@example.org", state: null, pending: [], refused: [], synced: true, lastSync: null },
      { account: "a@example.org", state: null, pending: {}, refused: [1], synced: true, lastSync: null },
      "text",
    ]) {
      localStorage.setItem(SYNC_META_KEY, JSON.stringify(broken));
      expect(loadMeta()).toBeNull();
    }
  });
});
