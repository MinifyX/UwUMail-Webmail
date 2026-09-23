import { describe, expect, it } from "vitest";
import { folderNameProblem } from "./folderName";

describe("folderNameProblem", () => {
  it("accepts an ordinary name, also with umlauts and spaces around it", () => {
    expect(folderNameProblem("  Rechnungen 2026 ", [])).toBeNull();
    expect(folderNameProblem("Grüße", ["Kunden"])).toBeNull();
  });

  it("names what's wrong", () => {
    expect(folderNameProblem("   ", [])).toBe("empty");
    expect(folderNameProblem("Work/Boss", [])).toBe("slash");
    expect(folderNameProblem("Tab\there", [])).toBe("control");
    expect(folderNameProblem(`Line${String.fromCharCode(0x2028)}break`, [])).toBe("control");
    expect(folderNameProblem("kunden", ["Kunden"])).toBe("taken");
  });

  it("counts bytes, not characters", () => {
    expect(folderNameProblem("a".repeat(255), [])).toBeNull();
    expect(folderNameProblem("a".repeat(256), [])).toBe("tooLong");
    // Two bytes each in UTF-8.
    expect(folderNameProblem("ü".repeat(128), [])).toBe("tooLong");
  });
});
