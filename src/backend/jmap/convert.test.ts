import { describe, expect, it } from "vitest";
import type { Folder } from "../types";
import { toMessage, type JmapEmail } from "./convert";

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
