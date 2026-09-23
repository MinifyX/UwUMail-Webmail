import { describe, expect, it } from "vitest";
import { draggedThreadIds } from "./selection";

describe("draggedThreadIds", () => {
  it("reads the thread ids a mail list row put there", () => {
    expect(draggedThreadIds(JSON.stringify(["t1", "t2"]))).toEqual(["t1", "t2"]);
  });

  it("ignores drag data from somewhere else instead of throwing", () => {
    expect(draggedThreadIds("")).toEqual([]);
    expect(draggedThreadIds("not json")).toEqual([]);
    expect(draggedThreadIds('{"0":"t1"}')).toEqual([]);
    expect(draggedThreadIds("[1,2]")).toEqual([]);
  });
});
