import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imageSizesPath,
  loadJmapSession,
  onOwnOrigin,
  pictureKind,
  pictureSource,
  reconnectDelay,
  remoteImagePath,
  senderPicturePath,
  reloadJmapSession,
  socketUrlFor,
  uploadBlob,
  withPictureOptions,
} from "./client";

vi.mock("../server", () => ({ currentSession: () => ({ csrfToken: "t0k" }) }));

describe("remote pictures through the server", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fills the server's templates on our own origin", async () => {
    expect(remoteImagePath("https://cdn.example/a.png")).toBeNull();
    expect(imageSizesPath()).toBeNull();
    const session = {
      accounts: { a7: {} },
      primaryAccounts: { "urn:ietf:params:jmap:mail": "a7" },
      apiUrl: "https://mail.example.com/jmap/api",
      downloadUrl: "https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
      uploadUrl: "https://mail.example.com/jmap/upload/{accountId}/",
      eventSourceUrl: "https://mail.example.com/jmap/eventsource/",
      state: "1",
      capabilities: {
        "urn:uwumail:jmap:remote": {
          imageUrl: "https://mail.example.com/jmap/image/{accountId}?url={url}",
          pictureUrl: "https://mail.example.com/jmap/picture/{accountId}?email={email}",
          imageSizesUrl: "https://mail.example.com/jmap/image/{accountId}/sizes",
        },
      },
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })),
    );
    await loadJmapSession();

    expect(remoteImagePath("https://cdn.example/a.png?w=1&h=2")).toBe(
      "/jmap/image/a7?url=https%3A%2F%2Fcdn.example%2Fa.png%3Fw%3D1%26h%3D2",
    );
    expect(senderPicturePath("news@shop.example")).toBe("/jmap/picture/a7?email=news%40shop.example");
    expect(imageSizesPath()).toBe("/jmap/image/a7/sizes");
    // Per address, and with the lookup's options: only what needs no other server, or only the logo.
    expect(senderPicturePath("mina@example.org", { local: true })).toBe(
      "/jmap/picture/a7?email=mina%40example.org&local=1",
    );
    expect(senderPicturePath("news@shop.example", { logo: true })).toBe(
      "/jmap/picture/a7?email=news%40shop.example&source=logo",
    );
  });

  it("appends lookup options to any template", () => {
    expect(withPictureOptions("/p/a7/x%40y.example")).toBe("/p/a7/x%40y.example");
    expect(withPictureOptions("/p/a7/x%40y.example", { local: true })).toBe("/p/a7/x%40y.example?local=1");
    expect(withPictureOptions("/p?email=x", { logo: true, local: true })).toBe("/p?email=x&source=logo&local=1");
  });

  it("hands out an SVG logo as data, never as a page of our own origin (W-35)", async () => {
    const create = vi.spyOn(URL, "createObjectURL").mockImplementation(() => "blob:own/1");
    expect(await pictureSource(new Blob(["png"], { type: "image/png" }))).toBe("blob:own/1");
    expect(await pictureSource(new Blob(["jpeg"], { type: "image/JPEG" }))).toBe("blob:own/1");
    expect(create).toHaveBeenCalledTimes(2);
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>x</script></svg>';
    expect(await pictureSource(new Blob([svg], { type: "image/svg+xml; charset=utf-8" }))).toBe(
      `data:image/svg+xml;base64,${btoa(svg)}`,
    );
    expect(await pictureSource(new Blob(["<html>"], { type: "text/html" }))).toBe(
      `data:application/octet-stream;base64,${btoa("<html>")}`,
    );
    expect(create).toHaveBeenCalledTimes(2);
    create.mockRestore();
  });

  it("reads what kind of picture the server found", () => {
    expect(pictureKind("photo")).toBe("photo");
    expect(pictureKind(" Logo ")).toBe("logo");
    expect(pictureKind("icon")).toBe("icon");
    expect(pictureKind(null)).toBe("icon");
    expect(pictureKind("anything")).toBe("icon");
  });
});

describe("push over the WebSocket", () => {
  it("goes to the page's own origin with the CSRF token", () => {
    expect(
      socketUrlFor("wss://mail.example.com/jmap/ws", { protocol: "https:", host: "mail.example.com" }, "t0k"),
    ).toBe("wss://mail.example.com/jmap/ws?csrf=t0k");
    expect(socketUrlFor("wss://mail.example.com/jmap/ws", { protocol: "http:", host: "127.0.0.1:1440" }, "a b")).toBe(
      "ws://127.0.0.1:1440/jmap/ws?csrf=a+b",
    );
  });

  it("waits longer after each lost connection, up to half a minute", () => {
    expect([0, 1, 2, 5, 10].map(reconnectDelay)).toEqual([1000, 2000, 4000, 30_000, 30_000]);
  });
});

describe("uploads", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fill the account into the server's template before the URL is parsed", async () => {
    const session = {
      accounts: { a1: {} },
      primaryAccounts: { "urn:ietf:params:jmap:mail": "a1" },
      apiUrl: "https://mail.example.com/jmap/api",
      downloadUrl: "https://mail.example.com/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
      uploadUrl: "https://mail.example.com/jmap/upload/{accountId}/",
      eventSourceUrl: "https://mail.example.com/jmap/eventsource/?types={types}",
      state: "1",
      capabilities: {},
    };
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("/jmap/upload/")
        ? new Response(JSON.stringify({ blobId: "b1", type: "application/sieve", size: 3 }), { status: 201 })
        : new Response(JSON.stringify(session), { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await reloadJmapSession();

    await expect(uploadBlob(new Blob(["abc"]), "application/sieve")).resolves.toMatchObject({ blobId: "b1" });
    const [url, init] = fetchMock.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(url).toBe("/jmap/upload/a1/");
    expect((init.headers as Record<string, string>)["x-csrf-token"]).toBe("t0k");
  });
});

describe("URLs the server announces", () => {
  it("keep their path on our own origin and never name another host", () => {
    expect(onOwnOrigin("https://mail.example.com/jmap/api?x=1")).toBe("/jmap/api?x=1");
    expect(onOwnOrigin("https://mail.example.com//other.example/jmap")).toBe("/other.example/jmap");
    expect(onOwnOrigin("/\\\\other.example/jmap")).toBe("/jmap");
    expect(onOwnOrigin("//other.example/jmap")).toBe("/jmap");
  });
});
