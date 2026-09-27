// @vitest-environment node
import { describe, expect, it } from "vitest";
import { DEFAULT_TEXTS, newMailIn, notificationsFor, openUrl, parsePayload } from "./shared";

describe("what the server pushes", () => {
  it("reads verifications and state changes, nothing else", () => {
    expect(parsePayload({ "@type": "PushVerification", pushSubscriptionId: "w1", verificationCode: "c" })).toEqual({
      kind: "verification",
      subscriptionId: "w1",
      code: "c",
    });
    const change = parsePayload({ "@type": "StateChange", changed: { a1: { EmailDelivery: "5", Email: "5" } } });
    expect(change.kind).toBe("state");
    expect(newMailIn(change, "a1")).toBe(true);
    expect(newMailIn(change, "a2")).toBe(false);
    expect(newMailIn(parsePayload({ "@type": "StateChange", changed: { a1: { Email: "6" } } }), "a1")).toBe(false);
    for (const junk of [null, "text", 5, { "@type": "PushVerification" }, { "@type": "Other" }]) {
      expect(parsePayload(junk)).toEqual({ kind: "unknown" });
    }
  });

  it("leads a click to the message", () => {
    expect(openUrl("/mail/", "e12", "t3")).toBe("/mail/?open=e12&thread=t3");
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
