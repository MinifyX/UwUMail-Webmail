import { describe, expect, it } from "vitest";
import { mailFontFiles, mailStack } from "./fonts";

describe("fonts for mail frames", () => {
  it("names the chosen font's files exactly, as absolute addresses", () => {
    const { faces, sources } = mailFontFiles("rubik", "https://mail.example.org/mail/inbox");
    const files = sources.split(" ");
    expect(files).toHaveLength(2);
    for (const file of files) {
      expect(file).toMatch(/^https:\/\/mail\.example\.org\/.+\.woff2$/);
      expect(faces).toContain(`url("${file}")`);
    }
    expect(faces).toContain("unicode-range:U+0000-00FF");
  });

  it("needs no files for the system font", () => {
    expect(mailFontFiles("system")).toEqual({ faces: "", sources: "" });
    expect(mailStack("system")).toMatch(/^system-ui/);
    expect(mailStack("uwu")).toMatch(/^"uwu-mail-font", system-ui/);
  });
});
