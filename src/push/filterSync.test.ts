// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pushFilterOf, writePushFilter } from "./filterSync";
import { FILTER_KEY, readFilter, type KeyValue } from "./shared";

function memory(): KeyValue & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => void data.set(key, structuredClone(value)),
    delete: async (key) => void data.delete(key),
  };
}

const MAILBOXES = [
  { id: "a1", email: "Mini@Example.org" },
  { id: "a3", email: "support@example.org" },
  { id: "a4", email: "sales@example.org" },
];
const QUIET = { enabled: true, from: "22:00", to: "07:00", days: [1, 2, 3, 4, 5] };

describe("the service worker's filter", () => {
  it("names muted mailboxes by their account id, matched by address", () => {
    expect(pushFilterOf(MAILBOXES, ["mini@example.org", " SUPPORT@example.org", "gone@example.org"], QUIET)).toEqual({
      mutedAccounts: ["a1", "a3"],
      quietHours: { from: "22:00", to: "07:00", days: [1, 2, 3, 4, 5] },
    });
  });

  it("leaves quiet hours out while they are off", () => {
    expect(pushFilterOf(MAILBOXES, [], { ...QUIET, enabled: false })).toEqual({ mutedAccounts: [], quietHours: null });
  });

  it("is kept where the service worker reads it, replaced by the next one", async () => {
    const kv = memory();
    await writePushFilter(kv, pushFilterOf(MAILBOXES, ["sales@example.org"], QUIET));
    expect(readFilter(await kv.get(FILTER_KEY))).toEqual({
      mutedAccounts: ["a4"],
      quietHours: {
        from: "22:00",
        to: "07:00",
        days: [1, 2, 3, 4, 5],
      },
    });
    await writePushFilter(kv, pushFilterOf(MAILBOXES, [], { ...QUIET, enabled: false }));
    expect(readFilter(await kv.get(FILTER_KEY))).toEqual({ mutedAccounts: [], quietHours: null });
  });

  it("lets a store that fails go without throwing", async () => {
    const broken: KeyValue = {
      get: async () => undefined,
      set: async () => {
        throw new Error("IndexedDB is not available");
      },
      delete: async () => undefined,
    };
    await expect(writePushFilter(broken, { mutedAccounts: [], quietHours: null })).resolves.toBeUndefined();
  });
});
