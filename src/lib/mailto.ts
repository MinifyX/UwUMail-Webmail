import type { Address, MailtoDraft } from "@/backend/types";

function addresses(value: string | null): Address[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.includes("@"))
    .map((email) => ({ email }));
}

/**
 * Reads a `mailto:` link into a draft.
 *
 * The server hands one over as `?mailto=…` when someone follows such a link
 * with the webmail set as their mail program.
 */
export function parseMailto(link: string): MailtoDraft | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  if (url.protocol !== "mailto:") return null;
  const params = url.searchParams;
  const to = addresses(decodeURIComponent(url.pathname) || null);
  const extra = addresses(params.get("to"));
  return {
    to: [...to, ...extra],
    cc: addresses(params.get("cc")),
    bcc: addresses(params.get("bcc")),
    subject: params.get("subject") ?? "",
    body: params.get("body") ?? "",
  };
}
