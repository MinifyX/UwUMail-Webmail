// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXTS,
  deliveredTo,
  inQuietHours,
  messageTarget,
  notificationName,
  notificationsFor,
  openUrl,
  parsePayload,
  readFilter,
} from "./shared";

describe("what the server pushes", () => {
  it("reads verifications and state changes, nothing else", () => {
    expect(parsePayload({ "@type": "PushVerification", pushSubscriptionId: "w1", verificationCode: "c" })).toEqual({
      kind: "verification",
      subscriptionId: "w1",
      code: "c",
    });
    const change = parsePayload({ "@type": "StateChange", changed: { a1: { EmailDelivery: "5", Email: "5" } } });
    expect(change.kind).toBe("state");
    expect(deliveredTo(change)).toEqual(["a1"]);
    const shared = parsePayload({
      "@type": "StateChange",
      changed: { a1: { Email: "6" }, a3: { Email: "2", EmailDelivery: "2" } },
    });
    expect(deliveredTo(shared)).toEqual(["a3"]);
    expect(deliveredTo(parsePayload({ "@type": "StateChange", changed: { a1: { Email: "6" } } }))).toEqual([]);
    for (const junk of [null, "text", 5, { "@type": "PushVerification" }, { "@type": "Other" }]) {
      expect(parsePayload(junk)).toEqual({ kind: "unknown" });
    }
  });

  it("leads a click to the message, in a shared folder too", () => {
    expect(openUrl("/mail/", { emailId: "e12", threadId: "t3" })).toBe("/mail/?open=e12&thread=t3");
    expect(openUrl("/mail/", { emailId: "e12", threadId: "t3", accountId: "a3", mailboxId: "s2" })).toBe(
      "/mail/?open=e12&thread=t3&account=a3&mailbox=s2",
    );
    expect(messageTarget({ emailId: "e1", threadId: "t1", accountId: null })).toEqual({
      emailId: "e1",
      threadId: "t1",
    });
    expect(messageTarget({ emailId: "e1" })).toBeNull();
  });

  it("names the sender, or falls back to the address and a plain title", () => {
    const [named, unnamed] = notificationsFor(
      [
        {
          id: "e1",
          threadId: "t1",
          subject: " Hi ",
          from: [{ name: "Nyu", email: "nyu@example.org" }],
          receivedAt: "",
        },
        { id: "e2", threadId: "t2", subject: null, from: null, receivedAt: "" },
      ],
      { showContent: true, texts: DEFAULT_TEXTS },
    );
    expect([named!.title, named!.options.body]).toEqual(["Nyu", "Hi"]);
    expect([unnamed!.title, unnamed!.options.body]).toEqual([DEFAULT_TEXTS.newMail, DEFAULT_TEXTS.noSubject]);
  });
});

describe("sender names in notifications", () => {
  it("drop direction marks and line breaks and stay short", () => {
    expect(notificationName("\u202eAnna\u202c\nMeier")).toBe("Anna Meier");
    expect(notificationName("Family 👨\u200d👩\u200d👧")).toBe("Family 👨\u200d👩\u200d👧");
    const long = notificationName("x".repeat(500));
    expect([...long]).toHaveLength(80);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("quiet hours", () => {
  // Local time, as the settings mean it: 18 October 2026 was a Sunday (day 0).
  const at = (day: number, hours: number, minutes = 0) => new Date(2026, 9, 18 + day, hours, minutes);
  const WEEKDAYS = [1, 2, 3, 4, 5];

  it("covers the hours between on the listed days", () => {
    const quiet = { from: "09:00", to: "17:30", days: WEEKDAYS };
    expect(inQuietHours(quiet, at(1, 9, 0))).toBe(true);
    expect(inQuietHours(quiet, at(1, 17, 29))).toBe(true);
    expect(inQuietHours(quiet, at(1, 17, 30))).toBe(false);
    expect(inQuietHours(quiet, at(1, 8, 59))).toBe(false);
    expect(inQuietHours(quiet, at(0, 12))).toBe(false);
    expect(inQuietHours(quiet, at(6, 12))).toBe(false);
  });

  it("spans midnight into the day after a listed one", () => {
    const quiet = { from: "22:00", to: "07:00", days: [5] };
    expect(inQuietHours(quiet, at(5, 22, 0))).toBe(true);
    expect(inQuietHours(quiet, at(5, 23, 59))).toBe(true);
    // Saturday morning still belongs to Friday night.
    expect(inQuietHours(quiet, at(6, 0, 0))).toBe(true);
    expect(inQuietHours(quiet, at(6, 6, 59))).toBe(true);
    expect(inQuietHours(quiet, at(6, 7, 0))).toBe(false);
    expect(inQuietHours(quiet, at(6, 22, 30))).toBe(false);
    // Friday morning would belong to Thursday night, which isn't listed.
    expect(inQuietHours(quiet, at(5, 3, 0))).toBe(false);
    expect(inQuietHours(quiet, at(5, 21, 59))).toBe(false);
  });

  it("wraps from Saturday night into Sunday", () => {
    const quiet = { from: "23:00", to: "01:00", days: [6] };
    expect(inQuietHours(quiet, at(7, 0, 30))).toBe(true);
    expect(inQuietHours(quiet, at(1, 0, 30))).toBe(false);
  });

  it("takes the whole listed day when from and to are the same", () => {
    const quiet = { from: "08:00", to: "08:00", days: [0] };
    expect(inQuietHours(quiet, at(0, 0, 0))).toBe(true);
    expect(inQuietHours(quiet, at(0, 7, 59))).toBe(true);
    expect(inQuietHours(quiet, at(0, 23, 59))).toBe(true);
    expect(inQuietHours(quiet, at(1, 0, 0))).toBe(false);
    expect(inQuietHours(quiet, at(6, 23, 59))).toBe(false);
  });

  it("never holds when off, without days, or for broken times", () => {
    expect(inQuietHours(null, at(1, 12))).toBe(false);
    expect(inQuietHours({ from: "00:00", to: "00:00", days: [] }, at(1, 12))).toBe(false);
    expect(inQuietHours({ from: "25:00", to: "07:00", days: [1] }, at(1, 23))).toBe(false);
    expect(inQuietHours({ from: "7:00", to: "09:00", days: [1] }, at(1, 8))).toBe(false);
  });

  it("reads a stored filter back, and nothing that isn't one", () => {
    expect(
      readFilter({ mutedAccounts: ["a3", 5], quietHours: { from: "22:00", to: "07:00", days: [1, "x"] } }),
    ).toEqual({ mutedAccounts: ["a3"], quietHours: { from: "22:00", to: "07:00", days: [1] } });
    expect(readFilter({ mutedAccounts: "a3", quietHours: { from: 1 } })).toEqual({
      mutedAccounts: [],
      quietHours: null,
    });
    for (const junk of [null, undefined, "filter", 5]) expect(readFilter(junk)).toBeNull();
  });
});
