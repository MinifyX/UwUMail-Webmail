/**
 * Signatures as the server keeps them: `textSignature` and `htmlSignature` of each sending address
 * (`Identity`, RFC 8621 section 6). One per address, used for new mail and replies alike, and the
 * same one the portal and every other JMAP client of the account show.
 *
 * Earlier versions of the webmail kept signatures in the server's settings extension
 * (`signature:<id>`, several per address). Those are copied over once into addresses that have none
 * yet; the settings keys stay, since the UwUMail apps still read them.
 */

import { htmlToPlainText } from "@/lib/safeHtml";
import type { Signature } from "../types";

export interface JmapIdentityWithSignature {
  id: string;
  name: string;
  email: string;
  textSignature?: string | null;
  htmlSignature?: string | null;
}

/** Up to what the server stores for each of the two signature properties (256 KiB). */
export const IDENTITY_SIGNATURE_MAX_BYTES = 262_144;

/** Whether the server hands out identity signatures at all: the property is there, even empty. */
export function hasIdentitySignatures(identities: JmapIdentityWithSignature[]): boolean {
  return identities.length > 0 && identities.every((identity) => "htmlSignature" in identity);
}

function escape(text: string): string {
  return text.replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]!);
}

/** A text-only signature as HTML, line by line. */
export function textSignatureHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => escape(line))
    .join("<br>");
}

/**
 * The signature of an address, or null when it has none. Its id is the identity's. A signature
 * written as text only (by another program) comes as HTML too. Still untrusted: whoever shows or
 * inserts it cleans it first.
 */
export function identitySignature(identity: JmapIdentityWithSignature): Signature | null {
  const html = identity.htmlSignature?.trim()
    ? identity.htmlSignature
    : identity.textSignature?.trim()
      ? `<p>${textSignatureHtml(identity.textSignature)}</p>`
      : "";
  if (!html) return null;
  return {
    id: identity.id,
    email: identity.email,
    name: identity.name || identity.email,
    html,
    forNew: true,
    forReplies: true,
  };
}

/** What `Identity/set` gets for a signature: the HTML, and the same as plain text for text mail. */
export function identitySignaturePatch(html: string): { htmlSignature: string; textSignature: string } {
  const text = html.trim() ? htmlToPlainText(html).trim() : "";
  return { htmlSignature: html.trim() ? html : "", textSignature: text };
}

/**
 * Which of the settings' signatures go to which address, once: for every address without a
 * signature of its own, the one it used for new mail (else the one for replies, else the first).
 */
export function signatureMigration(
  identities: JmapIdentityWithSignature[],
  settingsSignatures: Signature[],
): Record<string, string> {
  const plan: Record<string, string> = {};
  for (const identity of identities) {
    if (identitySignature(identity)) continue;
    const own = settingsSignatures.filter(
      (signature) => signature.email.toLowerCase() === identity.email.toLowerCase() && signature.html.trim(),
    );
    const chosen = own.find((s) => s.forNew) ?? own.find((s) => s.forReplies) ?? own[0];
    if (chosen) plan[identity.id] = chosen.html;
  }
  return plan;
}
