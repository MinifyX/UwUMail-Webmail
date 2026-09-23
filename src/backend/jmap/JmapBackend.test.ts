import { describe, expect, it } from "vitest";
import { answeredMail, bareMessageId } from "./JmapBackend";

describe("bareMessageId", () => {
  /**
   * The bug this is here for: the draft key was written `<uwu-…@webmail.local>` while JMAP hands
   * `messageId` back without the brackets. Every comparison failed, so no older version of a
   * draft was ever deleted — after three saves and a send, three dead drafts stayed behind. It
   * only showed against a real server, because the demo data never went through JMAP.
   */
  it("compares a draft key with what JMAP hands back", () => {
    const written = "<uwu-1234@webmail.local>";
    const returned = "uwu-1234@webmail.local";
    expect(bareMessageId(written)).toBe(bareMessageId(returned));
  });

  it("leaves a bare id alone", () => {
    expect(bareMessageId("uwu-1234@webmail.local")).toBe("uwu-1234@webmail.local");
  });

  it("copes with nothing at all", () => {
    expect(bareMessageId(undefined)).toBe("");
    expect(bareMessageId("")).toBe("");
  });

  it("only strips the outer brackets and ignores surrounding space", () => {
    expect(bareMessageId("  <a@b>  ")).toBe("a@b");
    expect(bareMessageId("<a<b>@c>")).toBe("a<b>@c");
  });
});

describe("answeredMail", () => {
  const conversation = [
    { id: "m1", messageId: ["first@shop.example"] },
    { id: "m2", messageId: ["second@shop.example"] },
    { id: "d1", messageId: ["uwu-1@webmail.local"] },
  ];

  // Regression (security-audit W-10): a reopened reply came back without the mail it answers,
  // so saving or sending it again dropped In-Reply-To and References.
  it("finds the mail a reopened reply answers", () => {
    expect(answeredMail({ id: "d1", inReplyTo: ["second@shop.example"] }, conversation)).toBe("m2");
    expect(answeredMail({ id: "d1", inReplyTo: ["<first@shop.example>"] }, conversation)).toBe("m1");
  });

  it("leaves a new mail and a vanished original alone", () => {
    expect(answeredMail({ id: "d1", inReplyTo: null }, conversation)).toBeNull();
    expect(answeredMail({ id: "d1", inReplyTo: ["gone@shop.example"] }, conversation)).toBeNull();
    expect(answeredMail({ id: "d1", inReplyTo: ["uwu-1@webmail.local"] }, conversation)).toBeNull();
  });
});
