import { describe, expect, it } from "vitest";
import type { Folder } from "../types";
import { toMessage, toUnsubscribe, type JmapEmail } from "./convert";

const sent: Folder = {
  id: "mb-sent",
  accountId: "acc",
  name: "Sent",
  path: "Sent",
  role: "sent",
  parentId: null,
  selectable: true,
  unread: 0,
  total: 1,
};

describe("toMessage", () => {
  it("keeps every address line of the header", () => {
    const email: JmapEmail = {
      id: "e1",
      threadId: "t1",
      mailboxIds: { "mb-sent": true },
      keywords: { $seen: true },
      from: [{ name: "Mini", email: "mini@uwumail.test" }],
      to: [{ name: "Leni", email: "leni@example.org" }],
      cc: null,
      bcc: [{ name: null, email: "noah@example.net" }],
      replyTo: [{ email: "antwort@uwumail.test" }],
      subject: "Geheim",
      receivedAt: "2026-09-21T10:00:00Z",
    };
    const message = toMessage(email, "acc", new Map([[sent.id, sent]]));
    expect(message.bcc).toEqual([{ email: "noah@example.net" }]);
    expect(message.replyTo).toEqual([{ email: "antwort@uwumail.test" }]);
    expect(message.cc).toEqual([]);
  });
});

describe("toUnsubscribe", () => {
  const email = (post: string | null): JmapEmail => ({
    id: "e1",
    threadId: "t1",
    mailboxIds: {},
    keywords: {},
    receivedAt: "2026-09-21T10:00:00Z",
    "header:List-Unsubscribe:asURLs": ["mailto:leave@list.example", "https://list.example/leave?u=1"],
    "header:List-Unsubscribe-Post:asText": post,
  });

  it("offers the one click where the server does it and the mail asks for the POST", () => {
    expect(toUnsubscribe(email("List-Unsubscribe=One-Click"), true)).toEqual({
      oneClick: true,
      url: "https://list.example/leave?u=1",
      mailto: "mailto:leave@list.example",
    });
    expect(toUnsubscribe(email("List-Unsubscribe=One-Click"), false)?.oneClick).toBe(false);
    expect(toUnsubscribe(email(null), true)?.oneClick).toBe(false);
    expect(toUnsubscribe(email("  "), true)?.oneClick).toBe(false);
  });
});
