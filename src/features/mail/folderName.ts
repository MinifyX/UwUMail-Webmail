/** What a folder name may be: something every server, IMAP client and Sieve path can carry. */
export type FolderNameProblem = "empty" | "slash" | "control" | "tooLong" | "taken";

const MAX_BYTES = 255;

/** Control characters, including the Unicode line and paragraph separators. */
// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]");

/** Checks a trimmed name against the folders it would sit next to (their names, any case). */
export function folderNameProblem(name: string, siblings: string[]): FolderNameProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return "empty";
  // Rules address folders by their "/"-separated path, so a "/" inside a name would split it.
  if (trimmed.includes("/")) return "slash";
  if (CONTROL.test(trimmed)) return "control";
  if (new TextEncoder().encode(trimmed).length > MAX_BYTES) return "tooLong";
  const lower = trimmed.toLowerCase();
  if (siblings.some((sibling) => sibling.toLowerCase() === lower)) return "taken";
  return null;
}
