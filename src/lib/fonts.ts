/**
 * The font the webmail and the mails use (Settings → Appearance → Font). Kept in this browser only.
 *
 * The interface gets the font through `--font-ui` on <html>; the web fonts are declared in
 * styles/fonts.css. Mails are shown in a sandboxed frame that can't see the page's fonts. The
 * server's policy only lets fonts come from our own origin, and a mail must never reach our own
 * origin (security audit W-40), so the frame's policy names the chosen font's files exactly and
 * nothing else (see `mailFontFaces`).
 */

import dmSansLatinExt from "@fontsource-variable/dm-sans/files/dm-sans-latin-ext-wght-normal.woff2?url";
import dmSansLatin from "@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?url";
import rubikLatinExt from "@fontsource-variable/rubik/files/rubik-latin-ext-wght-normal.woff2?url";
import rubikLatin from "@fontsource-variable/rubik/files/rubik-latin-wght-normal.woff2?url";
import uwuSans from "@/assets/fonts/UwUSans[wght].woff2?url";

export const FONT_CHOICES = ["uwu", "rubik", "dmsans", "system"] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

/** What happens to the fonts a sender wrote into an HTML mail. */
export const SENDER_FONT_CHOICES = ["replace", "keep"] as const;
export type SenderFonts = (typeof SENDER_FONT_CHOICES)[number];

const SYSTEM_STACK = 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", "Noto Sans", Arial, sans-serif';

/** The family list for each choice; web fonts fall back to the system's. */
export const FONT_STACKS: Record<FontChoice, string> = {
  uwu: `"UwU Sans", ${SYSTEM_STACK}`,
  rubik: `"Rubik Variable", ${SYSTEM_STACK}`,
  dmsans: `"DM Sans Variable", ${SYSTEM_STACK}`,
  system: SYSTEM_STACK,
};

/** The names the picker shows (font names stay untranslated). */
export const FONT_NAMES: Record<Exclude<FontChoice, "system">, string> = {
  uwu: "UwU Sans",
  rubik: "Rubik",
  dmsans: "DM Sans",
};

/**
 * A little tighter than the fonts are set, for interface text. UwU Sans (Atkinson Hyperlegible) is
 * spaced generously for reading; the others are fine as they come.
 */
export const FONT_TRACKING: Record<FontChoice, string> = {
  uwu: "-0.008em",
  rubik: "0em",
  dmsans: "-0.004em",
  system: "0em",
};

export function isFontChoice(value: unknown): value is FontChoice {
  return (FONT_CHOICES as readonly unknown[]).includes(value);
}

export function isSenderFonts(value: unknown): value is SenderFonts {
  return (SENDER_FONT_CHOICES as readonly unknown[]).includes(value);
}

/** Puts the chosen font on the whole interface at once. */
export function applyUiFont(choice: FontChoice, root: HTMLElement = document.documentElement) {
  root.style.setProperty("--font-ui", FONT_STACKS[choice]);
  root.style.setProperty("--tracking-ui", FONT_TRACKING[choice]);
  root.dataset.font = choice;
}

// --- mail frames ---------------------------------------------------------------------------------

/** The family name the mail frame knows the chosen font by (see lib/mailFonts). */
export const MAIL_FAMILY = "uwu-mail-font";

interface Face {
  url: string;
  unicodeRange?: string;
}

// Unicode ranges as @fontsource declares them for its two Latin files.
const LATIN =
  "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD";
const LATIN_EXT =
  "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF";

/** The same files the page itself uses, so the browser has them already. */
const FACES: Record<Exclude<FontChoice, "system">, Face[]> = {
  uwu: [{ url: uwuSans }],
  rubik: [
    { url: rubikLatin, unicodeRange: LATIN },
    { url: rubikLatinExt, unicodeRange: LATIN_EXT },
  ],
  dmsans: [
    { url: dmSansLatin, unicodeRange: LATIN },
    { url: dmSansLatinExt, unicodeRange: LATIN_EXT },
  ],
};

export interface MailFontFiles {
  /** @font-face rules for the frame ("" for the system font). */
  faces: string;
  /** The files as the frame's `font-src` lists them: each one exactly, never a whole origin. */
  sources: string;
}

/** Characters that would end a CSS url() or a CSP source; asset paths never have them. */
const UNSAFE = /["'()\s;,\\]/;

export function mailFontFiles(choice: FontChoice, base: string = window.location.href): MailFontFiles {
  if (choice === "system") return { faces: "", sources: "" };
  const files = FACES[choice]
    .map((face) => ({ ...face, url: new URL(face.url, base).href }))
    .filter((face) => /^https?:/.test(face.url) && !UNSAFE.test(face.url));
  return {
    faces: files
      .map(
        (face) =>
          `@font-face{font-family:"${MAIL_FAMILY}";src:url("${face.url}") format("woff2");font-weight:100 900;font-style:normal;font-display:block${face.unicodeRange ? `;unicode-range:${face.unicodeRange}` : ""}}`,
      )
      .join("\n"),
    sources: files.map((face) => face.url).join(" "),
  };
}

/** The family list the frame uses for the chosen font. */
export function mailStack(choice: FontChoice) {
  return choice === "system" ? SYSTEM_STACK : `"${MAIL_FAMILY}", ${SYSTEM_STACK}`;
}
