import { describe, expect, it } from "vitest";
import { searchFilter } from "./search";

const localMidnight = (y: number, m: number, d: number) => `${new Date(y, m - 1, d).toISOString().slice(0, 19)}Z`;

describe("search operators as an Email/query filter", () => {
  it("turns every operator into its condition", () => {
    expect(
      searchFilter(
        'Leni from:shop@example.com to:noah subject:"big news" has:attachment is:unread is:flagged after:2026-10-01 before:2026-10-31',
      ),
    ).toEqual([
      { text: "Leni" },
      { from: "shop@example.com" },
      { operator: "OR", conditions: [{ to: "noah" }, { cc: "noah" }] },
      { subject: "big news" },
      { hasAttachment: true },
      { notKeyword: "$seen" },
      { hasKeyword: "$flagged" },
      { after: localMidnight(2026, 10, 1) },
      { before: localMidnight(2026, 10, 31) },
    ]);
  });

  it("keeps plain words and broken operators as text", () => {
    expect(searchFilter('"two words" before:someday is:big')).toEqual([
      { text: "two words" },
      { text: "before:someday" },
      { text: "is:big" },
    ]);
  });

  it("is empty for an empty search", () => {
    expect(searchFilter(undefined)).toEqual([]);
    expect(searchFilter("   ")).toEqual([]);
  });
});
