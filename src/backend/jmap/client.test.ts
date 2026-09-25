import { afterEach, describe, expect, it, vi } from "vitest";
import { loadJmapSession, reconnectDelay, remoteImagePath, senderPicturePath, socketUrlFor } from "./client";

describe("remote pictures through the server", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fills the server's templates on our own origin", async () => {
    expect(remoteImagePath("https://cdn.example/a.png")).toBeNull();
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
