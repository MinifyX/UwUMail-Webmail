import { describe, expect, it } from "vitest";
import type { ThreadSummary } from "@/backend/types";
import { formatDayHeading, groupByDay } from "./dayGroups";

const thread = (id: string, lastDate: string) => ({ id, lastDate }) as ThreadSummary;

describe("groupByDay", () => {
  const now = new Date(2048, 2, 4, 12, 0);

  it("puts today, yesterday and older days under their own heading", () => {
    const groups = groupByDay(
      [
        thread("a", new Date(2048, 2, 4, 9).toISOString()),
        thread("b", new Date(2048, 2, 4, 1).toISOString()),
        thread("c", new Date(2048, 2, 3, 22).toISOString()),
        thread("d", new Date(2048, 1, 20, 8).toISOString()),
      ],
      now,
    );
    expect(groups.map((group) => [group.day, group.threads.map((t) => t.id)])).toEqual([
      ["today", ["a", "b"]],
      ["yesterday", ["c"]],
      ["date", ["d"]],
    ]);
  });

  it("names older days with the year only when it isn't this one", () => {
    expect(formatDayHeading(new Date(2048, 1, 20), "de", now)).toBe("Donnerstag, 20. Februar");
    expect(formatDayHeading(new Date(2047, 1, 20), "de", now)).toContain("2047");
  });
});
