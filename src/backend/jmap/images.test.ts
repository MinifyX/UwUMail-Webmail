import { afterEach, describe, expect, it, vi } from "vitest";
import type { RemoteImageSize } from "../types";
import { MAX_SIZE_URLS, probeImageSizes, toImageTextResult, toRemoteImageSize } from "./images";

describe("the server's picture sizes", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reads each kind of line and skips anything else", () => {
    expect(toRemoteImageSize({ url: "https://cdn.example/a.jpg", width: 600, height: 300 })).toEqual({
      url: "https://cdn.example/a.jpg",
      width: 600,
      height: 300,
      failed: false,
    });
    expect(toRemoteImageSize({ url: "https://cdn.example/a.jpg", width: null, height: null })).toEqual({
      url: "https://cdn.example/a.jpg",
      width: null,
      height: null,
      failed: false,
    });
    expect(toRemoteImageSize({ url: "https://cdn.example/a.jpg", failed: true })).toEqual({
      url: "https://cdn.example/a.jpg",
      width: null,
      height: null,
      failed: true,
    });
    // Half a size, or a nonsense one, is no size.
    expect(toRemoteImageSize({ url: "https://cdn.example/a.jpg", width: 600 })?.width).toBeNull();
    expect(toRemoteImageSize({ url: "https://cdn.example/a.jpg", width: -1, height: 5 })?.width).toBeNull();
    expect(toRemoteImageSize({ width: 1, height: 1 })).toBeNull();
    expect(toRemoteImageSize("line")).toBeNull();
  });

  it("asks once per address and hands out each answer as it streams in", async () => {
    const lines = [
      '{"url":"https://track.example/o.gif","failed":true}\n',
      '{"url":"https://cdn.example/a.jpg","width":600,"height":300}\n{"url":"https://cdn.example/a.jpg","width":1,"height":1}\n',
      '{"url":"https://other.example/never-asked.png","width":5,"height":5}\n',
      '{"url":"https://cdn.example/b.png","width":null,"height":null}',
    ];
    const encoder = new TextEncoder();
    const fetch = vi.fn(
      async (_path: string, _init: RequestInit) =>
        new Response(
          new ReadableStream({
            start(controller) {
              for (const line of lines) controller.enqueue(encoder.encode(line));
              controller.close();
            },
          }),
          { status: 200, headers: { "content-type": "application/x-ndjson" } },
        ),
    );
    vi.stubGlobal("fetch", fetch);
    const sizes: RemoteImageSize[] = [];
    await probeImageSizes(
      "/jmap/image/a1/sizes",
      "token",
      [
        "https://cdn.example/a.jpg",
        "https://track.example/o.gif",
        "https://cdn.example/a.jpg",
        "https://cdn.example/b.png",
      ],
      (size) => sizes.push(size),
      new AbortController().signal,
    );
    const [path, init] = fetch.mock.calls[0]!;
    expect(path).toBe("/jmap/image/a1/sizes");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(init.headers).toMatchObject({ "content-type": "application/json", "x-csrf-token": "token" });
    expect(JSON.parse(init.body as string)).toEqual({
      urls: ["https://cdn.example/a.jpg", "https://track.example/o.gif", "https://cdn.example/b.png"],
    });
    expect(sizes).toEqual([
      { url: "https://track.example/o.gif", width: null, height: null, failed: true },
      { url: "https://cdn.example/a.jpg", width: 600, height: 300, failed: false },
      { url: "https://cdn.example/b.png", width: null, height: null, failed: false },
    ]);
  });

  it("sends at most as many addresses as the server takes", async () => {
    const fetch = vi.fn(async (_path: string, _init: RequestInit) => new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const urls = Array.from({ length: MAX_SIZE_URLS + 5 }, (_, index) => `https://cdn.example/${index}.png`);
    await probeImageSizes("/sizes", "t", urls, () => {}, new AbortController().signal);
    expect(JSON.parse(fetch.mock.calls[0]![1].body as string).urls).toHaveLength(MAX_SIZE_URLS);
  });

  it("fails when the server can't answer, so the pictures load directly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    await expect(
      probeImageSizes("/sizes", "t", ["https://cdn.example/a.jpg"], () => {}, new AbortController().signal),
    ).rejects.toThrow();
  });
});

describe("Email/imageText answers", () => {
  it("fill in what the server leaves out and drop what isn't text", () => {
    expect(
      toImageTextResult("m1", {
        accountId: "a1",
        emailId: "m1",
        unavailable: false,
        images: [
          { source: "cid:poster@shop.example", text: "Fr 9. Okt", width: 800, height: 1200 },
          { source: "blob:b7", text: "Hallo" },
          { source: "https://cdn.example/a.jpg" },
        ],
      }),
    ).toEqual({
      emailId: "m1",
      unavailable: false,
      images: [
        { source: "cid:poster@shop.example", text: "Fr 9. Okt", width: 800, height: 1200 },
        { source: "blob:b7", text: "Hallo", width: 0, height: 0 },
      ],
      skipped: 0,
    });
    expect(toImageTextResult("m2", { unavailable: true, images: [], skipped: 2 })).toEqual({
      emailId: "m2",
      unavailable: true,
      images: [],
      skipped: 2,
    });
  });
});

// The backend's method, with the transport answering like the server.
const jmap = vi.hoisted(() => ({
  capabilities: {} as Record<string, unknown>,
  one: vi.fn(),
}));

vi.mock("./client", async (original) => {
  const actual = await original<typeof import("./client")>();
  const session = () => ({
    accountId: "a1",
    accounts: {
      a1: { name: "mini@uwumail.example", isPersonal: true, isReadOnly: false, accountCapabilities: {} },
      a3: { name: "leni@uwumail.example", isPersonal: false, isReadOnly: true, accountCapabilities: {} },
    },
    apiUrl: "/jmap/api",
    downloadUrl: "",
    uploadUrl: "",
    eventSourceUrl: "",
    capabilities: jmap.capabilities,
    state: "s1",
  });
  return {
    ...actual,
    loadJmapSession: async () => session(),
    jmapSession: session,
    supports: (capability: string) => capability in jmap.capabilities,
    whenSessionChanges: () => {},
    watchPush: () => () => {},
    call: async () => ({
      methodResponses: [["Mailbox/get", { list: [], notFound: [], state: "1" }, "m0"]],
      sessionState: "s1",
    }),
    one: jmap.one,
  };
});

describe("JmapBackend.imageText", () => {
  afterEach(() => {
    jmap.one.mockReset();
    jmap.capabilities = {};
  });

  const load = async () => new (await import("./JmapBackend")).JmapBackend();

  it("asks nothing where the server reads no pictures", async () => {
    expect(await (await load()).imageText("m1", true)).toEqual({
      emailId: "m1",
      unavailable: true,
      images: [],
      skipped: 0,
    });
    expect(jmap.one).not.toHaveBeenCalled();
  });

  it("asks Email/imageText for the mail's own account", async () => {
    jmap.capabilities = { "urn:uwumail:jmap:imagetext": {} };
    jmap.one.mockResolvedValueOnce({
      accountId: "a3",
      emailId: "m12",
      unavailable: false,
      images: [{ source: "https://cdn.example/poster.png", text: "Sommerfest 12.7.", width: 600, height: 800 }],
      skipped: 1,
    });
    const result = await (await load()).imageText("a3~m12", true);
    expect(jmap.one).toHaveBeenCalledWith("Email/imageText", { accountId: "a3", emailId: "m12", remote: true }, [
      "urn:ietf:params:jmap:core",
      "urn:ietf:params:jmap:mail",
      "urn:uwumail:jmap:imagetext",
    ]);
    expect(result).toEqual({
      emailId: "a3~m12",
      unavailable: false,
      images: [{ source: "https://cdn.example/poster.png", text: "Sommerfest 12.7.", width: 600, height: 800 }],
      skipped: 1,
    });
  });
});
