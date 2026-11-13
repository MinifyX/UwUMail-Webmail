import { afterEach, describe, expect, it, vi } from "vitest";

const jmap = vi.hoisted(() => ({ load: vi.fn(), one: vi.fn(), upload: vi.fn() }));

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
    call: async (batch: [string][]) => ({
      methodResponses:
        batch[0]![0] === "Mailbox/get"
          ? [["Mailbox/get", { list: [{ id: "d", name: "Drafts", role: "drafts" }], notFound: [], state: "1" }, "m0"]]
          : [["Email/get", { list: [] }, "e"]],
      sessionState: "s1",
    }),
    one: jmap.one,
    uploadBlob: jmap.upload,
    supports: () => false,
  };
});
vi.mock("../server", () => ({ currentSession: () => ({ account: { login: "mini@uwumail.example" } }) }));

const load = async () => new (await import("./JmapBackend")).JmapBackend();

describe("JmapBackend and the server's per-call limits", () => {
  afterEach(() => {
    jmap.load.mockReset();
    jmap.one.mockReset();
    jmap.upload.mockReset();
  });

  it("tries the start again after it failed once", async () => {
    jmap.load.mockRejectedValueOnce(new Error("503")).mockResolvedValue({});
    const backend = await load();
    await expect(backend.listFolders()).rejects.toThrow("503");
    await expect(backend.listFolders()).resolves.toHaveLength(1);
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

  it("uploads a draft's attachment once, not on every save", async () => {
    jmap.load.mockResolvedValue({});
    jmap.upload.mockResolvedValue({ blobId: "upload1" });
    const created: { attachments?: { blobId: string }[] }[] = [];
    jmap.one.mockImplementation(async (name: string, args: { create?: { draft: (typeof created)[0] } }) => {
      if (name === "Identity/get") return { list: [{ id: "i1", email: "mini@uwumail.example", name: "Mini" }] };
      if (name === "Email/set") {
        created.push(args.create!.draft);
        return { created: { draft: { id: `draft${created.length}` } } };
      }
      return { list: [{ id: "draft1", attachments: [{ blobId: `part${created.length}` }] }] };
    });
    const backend = await load();
    const draft = {
      accountId: "a1",
      to: [],
      cc: [],
      bcc: [],
      subject: "Plan",
      html: "",
      text: "",
      attachments: [
        { filename: "plan.txt", mimeType: "text/plain", size: 2, source: { kind: "base64" as const, data: "aGk=" } },
      ],
    };
    const first = await backend.saveDraft(draft);
    await backend.saveDraft({ ...draft, draftKey: first.draftKey, attachments: first.attachments! });
    expect(jmap.upload).toHaveBeenCalledTimes(1);
    expect(created.map((email) => email.attachments![0]!.blobId)).toEqual(["upload1", "part1"]);
  });
  it("reads a selection of conversations in one request, without bodies", async () => {
    jmap.load.mockResolvedValue({});
    jmap.one.mockImplementation(async (name: string, args: { ids: string[] }) => {
      if (name === "Thread/get") return { list: args.ids.map((id) => ({ id, emailIds: [`${id}-a`, `${id}-b`] })) };
      return {
        list: args.ids.map((id) => ({
          id,
          threadId: id.split("-")[0],
          mailboxIds: {},
          keywords: {},
          receivedAt: "2026-11-13T10:00:00Z",
        })),
      };
    });
    const messages = await (await load()).selectionMessages(["t1", "t2"], true);
    expect(messages.map((message) => message.id)).toEqual(["t1-a", "t1-b", "t2-a", "t2-b"]);
    const calls = jmap.one.mock.calls as [string, Record<string, unknown>][];
    expect(calls.map(([name]) => name)).toEqual(["Thread/get", "Email/get"]);
    expect(calls[1]![1].fetchAllBodyValues).toBeUndefined();
  });
});
