import { describe, expect, it } from "vitest";
import { bareMessageId } from "./JmapBackend";

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
