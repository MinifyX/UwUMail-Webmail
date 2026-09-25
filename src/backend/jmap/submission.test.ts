import { describe, expect, it } from "vitest";
import { maxDelayOf, scheduledFrom, submissionReceipt, submissionSendAt } from "./submission";

describe("what sending hands back", () => {
  it("keeps a held-back submission cancellable until its time", () => {
    expect(submissionReceipt({ id: "s9", undoStatus: "pending", sendAt: "2026-09-25T10:00:10Z" })).toEqual({
      submissionId: "s9",
      sendAt: "2026-09-25T10:00:10Z",
      pending: true,
    });
  });

  it("reads an older server's answer as sent", () => {
    const now = new Date("2026-09-25T10:00:00Z");
    expect(submissionReceipt({ id: "s9" }, now)).toEqual({
      submissionId: "s9",
      sendAt: "2026-09-25T10:00:00.000Z",
      pending: false,
    });
    expect(submissionReceipt({ id: "s9", undoStatus: "final", sendAt: "2026-09-25T10:00:00Z" }).pending).toBe(false);
  });
});

describe("the send later limit", () => {
  it("comes from the account's submission capability", () => {
    expect(maxDelayOf({ maxDelayedSend: 2592000 })).toBe(2592000);
  });

  it("is nothing for servers that send at once", () => {
    expect(maxDelayOf({ maxDelayedSend: 0 })).toBe(0);
    expect(maxDelayOf({})).toBe(0);
    expect(maxDelayOf(null)).toBe(0);
    expect(maxDelayOf({ maxDelayedSend: "30" })).toBe(0);
  });
});

describe("the time of a submission", () => {
  it("is a UTCDate in whole seconds", () => {
    expect(submissionSendAt("2026-09-26T06:00:00.250Z")).toBe("2026-09-26T06:00:00Z");
    expect(submissionSendAt("2026-09-26T08:00:00+02:00")).toBe("2026-09-26T06:00:00Z");
  });

  it("refuses what isn't a time", () => {
    expect(() => submissionSendAt("tomorrow")).toThrow();
  });
});

describe("the scheduled list", () => {
  it("pairs each waiting submission with its mail, soonest first", () => {
    const list = scheduledFrom(
      [
        { id: "s2", emailId: "e2", sendAt: "2026-09-28T06:00:00Z", undoStatus: "pending" },
        { id: "s1", emailId: "e1", sendAt: "2026-09-26T06:00:00Z", undoStatus: "pending" },
        { id: "s0", emailId: "e0", sendAt: "2026-09-20T06:00:00Z", undoStatus: "final" },
      ],
      [
        { id: "e1", subject: "Invoice", to: [{ name: "Nyu", email: "nyu@example.com" }] },
        { id: "e2", subject: null, to: null },
      ],
    );
    expect(list).toEqual([
      {
        id: "s1",
        emailId: "e1",
        sendAt: "2026-09-26T06:00:00Z",
        subject: "Invoice",
        to: [{ name: "Nyu", email: "nyu@example.com" }],
      },
      { id: "s2", emailId: "e2", sendAt: "2026-09-28T06:00:00Z", subject: "", to: [] },
    ]);
  });

  it("falls back to the envelope when the mail has no To", () => {
    const [entry] = scheduledFrom(
      [
        {
          id: "s1",
          emailId: "e1",
          sendAt: "2026-09-26T06:00:00Z",
          envelope: { rcptTo: [{ email: "kai@example.org" }] },
        },
      ],
      [{ id: "e1", subject: "Hi", to: [] }],
    );
    expect(entry?.to).toEqual([{ email: "kai@example.org" }]);
  });
});
