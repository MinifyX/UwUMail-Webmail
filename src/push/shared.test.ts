// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTS, deliveredTo, messageTarget, notificationsFor, openUrl, parsePayload } from "./shared";

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
