import { afterEach, describe, expect, it, vi } from "vitest";
import { loadJmapSession, remoteImagePath, senderPicturePath } from "./client";

describe("remote pictures through the server", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("fills the server's templates on our own origin", async () => {
    expect(remoteImagePath("https://cdn.example/a.png")).toBeNull();
    const session = {
      accounts: { a7: {} },
      primaryAccounts: { "urn:ietf:params:jmap:mail": "a7" },
      apiUrl: "https://mail.example.de/jmap/api",
      downloadUrl: "https://mail.example.de/jmap/download/{accountId}/{blobId}/{name}?accept={type}",
      uploadUrl: "https://mail.example.de/jmap/upload/{accountId}/",
      eventSourceUrl: "https://mail.example.de/jmap/eventsource/",
      state: "1",
      capabilities: {
        "urn:uwumail:jmap:remote": {
          imageUrl: "https://mail.example.de/jmap/image/{accountId}?url={url}",
          pictureUrl: "https://mail.example.de/jmap/picture/{accountId}?email={email}",
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
    expect(senderPicturePath("news@shop.de")).toBe("/jmap/picture/a7?email=news%40shop.de");
  });
});
