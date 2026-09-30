// Kept apart from lib/attachments (loaded on demand), since every mail list converts names.

/**
 * An attachment's name as the app shows and saves it: without direction marks and other invisible
 * characters, which would turn the name around (`invoice<U+202E>fdp.exe` showing as `…exe.pdf`)
 * or hide part of it, and with control characters as `_`. The warning already reads the name
 * this way; now the person sees what it read (security-audit W-43).
 */
export function cleanFilename(filename: string): string {
  const cleaned = filename
    .replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\u061c\u200b\u2060-\u2064\ufeff]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, "_")
    .trim();
  return cleaned || "attachment";
}
