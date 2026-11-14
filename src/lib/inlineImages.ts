// Mails show their embedded images (logos, signatures, screenshots) through `cid:` links to parts of
// the same message. The reader swaps those links for the locally cached files.

const CID = /cid:([^"'\s)>]+)/gi;

/** The Content-IDs an HTML body points at, as written after `cid:`. */
export function referencedContentIds(html: string | null): Set<string> {
  const ids = new Set<string>();
  if (!html) return ids;
  for (const match of html.matchAll(CID)) ids.add(decodeContentId(match[1]!));
  return ids;
}

/** Attributes that load a picture (`href` only on SVG's picture elements). */
const PICTURE_ATTRIBUTES = ["src", "srcset", "background", "poster"] as const;
const PICTURE_LINKS = new Set(["image", "feimage"]);

/**
 * `cid:` addresses replaced by the URLs of the files, but only where a picture loads: `src`,
 * `srcset`, `background`, `poster`, an SVG picture's `href` and CSS (`style` attributes and
 * elements). A link (`<a href="cid:…">`) never becomes one of the webmail's own blob URLs, so a
 * click can't open such a file on the webmail's origin. Addresses without a file stay as they are.
 * Parsed in a `<template>`, where nothing loads.
 */
export function replaceContentIds(html: string, urls: ReadonlyMap<string, string>): string {
  if (urls.size === 0) return html;
  const swap = (value: string) => value.replace(CID, (link, id: string) => urls.get(decodeContentId(id)) ?? link);
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    for (const name of PICTURE_ATTRIBUTES) {
      const value = element.getAttribute(name);
      if (value !== null) element.setAttribute(name, swap(value));
    }
    if (PICTURE_LINKS.has(element.localName.toLowerCase())) {
      for (const name of ["href", "xlink:href"]) {
        const value = element.getAttribute(name);
        if (value !== null) element.setAttribute(name, swap(value));
      }
    }
    const style = element.getAttribute("style");
    if (style !== null) element.setAttribute("style", swap(style));
    if (element.localName === "style" && element.textContent) element.textContent = swap(element.textContent);
  }
  return template.innerHTML;
}

/** Picture types a mail may embed; anything else (HTML, SVG, PDF, …) stays an attachment tile. */
const INLINE_PICTURE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif", "image/bmp"]);

export function isInlinePicture(mimeType: string) {
  return INLINE_PICTURE_TYPES.has(mimeType.split(";")[0]!.trim().toLowerCase());
}

function decodeContentId(id: string) {
  try {
    return decodeURIComponent(id).toLowerCase();
  } catch {
    return id.toLowerCase();
  }
}

/** Content-IDs compare without angle brackets and case. */
export function normalizeContentId(id: string) {
  return id.trim().replace(/^<|>$/g, "").toLowerCase();
}
