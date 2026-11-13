import { afterEach, describe, expect, it, vi } from "vitest";

const jmap = vi.hoisted(() => ({ load: vi.fn(), one: vi.fn() }));

vi.mock("./client", async (original) => {
  const actual = await original<typeof import("./client")>();
  const session = () => ({
    accountId: "a1",
    accounts: { a1: { name: "mini@uwumail.example", isPersonal: true, isReadOnly: false, accountCapabilities: {} } },
    apiUrl: "/jmap/api",
    downloadUrl: "",
    uploadUrl: "",
    eventSourceUrl: "",
    capabilities: {},
    state: "s1",
  });
  return {
    ...actual,
    loadJmapSession: jmap.load,
    jmapSession: session,
    whenSessionChanges: () => {},
    watchPush: () => () => {},
    call: async () => ({
      methodResponses: [["Mailbox/get", { list: [], notFound: [], state: "1" }, "m0"]],
      sessionState: "s1",
    }),
    one: jmap.one,
  };
});

const load = async () => new (await import("./JmapBackend")).JmapBackend();

describe("JmapBackend and the server's per-call limits", () => {
  afterEach(() => {
    jmap.load.mockReset();
    jmap.one.mockReset();
  });

  it("tries the start again after it failed once", async () => {
    jmap.load.mockRejectedValueOnce(new Error("503")).mockResolvedValue({});
    const backend = await load();
    await expect(backend.listFolders()).rejects.toThrow("503");
    await expect(backend.listFolders()).resolves.toEqual([]);
  });

  it("moves 600 mails in calls the server accepts", async () => {
    jmap.load.mockResolvedValue({});
    jmap.one.mockImplementation(async (name: string, args: { ids?: string[]; update?: object }) => {
      if (name === "Email/get") {
        return { list: args.ids!.map((id) => ({ id, mailboxIds: { inbox: true }, keywords: {} })) };
      }
      return { updated: Object.fromEntries(Object.keys(args.update ?? {}).map((id) => [id, null])) };
    });
    const ids = Array.from({ length: 600 }, (_, index) => `m${index}`);
    const moved = await (await load()).moveMessages(ids, "archive");
    expect(moved).toHaveLength(600);
    for (const [name, args] of jmap.one.mock.calls as [string, { ids?: string[]; update?: object }][]) {
      const size = name === "Email/get" ? args.ids!.length : Object.keys(args.update!).length;
      expect(size).toBeLessThanOrEqual(500);
    }
    expect(jmap.one.mock.calls.filter(([name]) => name === "Email/get")).toHaveLength(2);
  });
});
