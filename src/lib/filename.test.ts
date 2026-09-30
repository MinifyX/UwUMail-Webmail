import { describe, expect, it } from "vitest";
import { cleanFilename } from "./filename";

describe("attachment names", () => {
  it("lose direction marks and invisible characters, controls become _", () => {
    expect(cleanFilename("invoice‮fdp.exe")).toBe("invoicefdp.exe");
    expect(cleanFilename("⁧report⁩.pdf")).toBe("report.pdf");
    expect(cleanFilename("a​b\nc.txt")).toBe("ab_c.txt");
    expect(cleanFilename("Ünïcødé 名前.pdf")).toBe("Ünïcødé 名前.pdf");
    expect(cleanFilename("‮ ")).toBe("attachment");
  });
});
