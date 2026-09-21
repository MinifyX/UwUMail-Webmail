import type { Signature } from "@/backend/types";
import { quotableHtml } from "./safeHtml";

/** Marks the signature block in the composer, so switching replaces it. Removed before sending. */
export const SIGNATURE_ATTRIBUTE = "data-uwu-signature";

export type SignaturePlacement = "end" | "beforeQuote";

/** The largest settings value the server keeps (`maxValueSize`); a whole signature must fit. */
export const SIGNATURE_MAX_BYTES = 262_144;
export const SIGNATURE_MAX_NAME = 100;

/** What the server stores for a signature: everything but the id, which is part of the key. */
export type SignatureValue = Omit<Signature, "id">;

export function signatureValue(signature: Signature): SignatureValue {
  return {
    email: signature.email,
    name: signature.name.slice(0, SIGNATURE_MAX_NAME),
    html: signature.html,
    forNew: signature.forNew,
    forReplies: signature.forReplies,
  };
}

/** Bytes a value takes on the server, as UTF-8 JSON. */
export function valueSize(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).length;
}

/**
 * Signature HTML made safe to show or insert: the composer's own cleaner (no scripts, styles,
 * forms or remote content), and pictures only as embedded `data:image/…` URLs. Signatures come
 * from the server's shared settings, which other clients write too, so they are never trusted.
 */
export function cleanSignatureHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${quotableHtml(html)}</body>`, "text/html");
  for (const image of doc.body.querySelectorAll("img")) {
    if (!/^data:image\/(png|jpeg|gif|webp);/i.test(image.getAttribute("src") ?? "")) image.remove();
  }
  return doc.body.innerHTML;
}

/** The signature an address uses by default for new mail or for replies and forwards. */
export function defaultSignature(signatures: Signature[], email: string, kind: "new" | "reply"): Signature | undefined {
  const own = signatures.filter((s) => s.email.toLowerCase() === email.toLowerCase());
  return own.find((s) => (kind === "new" ? s.forNew : s.forReplies));
}

/**
 * The composer body with `signature` in place of the current one (or without one for null).
 * A new signature goes at the end of new mail, and between the typing space and the quote of
 * replies and forwards.
 */
export function withSignature(html: string, signature: Signature | null, placement: SignaturePlacement): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  const body = doc.body;
  const current = body.querySelector(`[${SIGNATURE_ATTRIBUTE}]`);
  if (!signature) {
    current?.remove();
    return body.innerHTML;
  }
  const block = doc.createElement("div");
  block.setAttribute(SIGNATURE_ATTRIBUTE, signature.id);
  // Signatures come from the server's settings, which other clients write too: untrusted HTML.
  block.innerHTML = cleanSignatureHtml(signature.html);
  if (current) {
    current.replaceWith(block);
  } else if (placement === "beforeQuote" && body.firstElementChild) {
    body.firstElementChild.after(block);
  } else {
    if (!body.lastElementChild || body.textContent?.trim()) body.append(doc.createElement("p"));
    body.lastElementChild?.replaceChildren(doc.createElement("br"));
    body.append(block);
  }
  return body.innerHTML;
}

/** What goes out: the signature stays, its marker doesn't. */
export function withoutSignatureMarker(html: string): string {
  return html.replace(new RegExp(`\\s${SIGNATURE_ATTRIBUTE}="[^"]*"`, "g"), "");
}
