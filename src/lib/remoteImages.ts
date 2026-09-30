/**
 * A mail's remote pictures, sent through the server instead of loaded from their senders.
 *
 * A picture loaded from the sender tells them the mail was opened, when, and from where. The
 * server fetches it for us (`urn:uwumail:jmap:remote`), so they only ever see the server. This
 * only swaps addresses; whatever it misses stays blocked by the frame's CSP, which then allows
 * pictures from our own origin only.
 */

import { isEmbeddedSource } from "./safeHtml";

/** Where the server fetches a remote picture for us. */
export type ImageProxy = (url: string) => string;

const REMOTE = /^\s*https?:\/\//i;
/**
 * `url(...)` with a quoted or bare address. The spaces around it are taken whole (a lookahead
 * captures them and nothing ever gives a space back), and a bare address stops at the next `(`,
 * which it can't contain anyway. Otherwise a long run of spaces or of `url(url(…` makes this
 * backtrack for minutes and freezes the tab.
 */
const CSS_URL = /url\((?=(\s*))\1(?:"([^"]*)"|'([^']*)'|([^\s"'()]*))(?=(\s*))\5\)/gi;

/** One address through the proxy when it points at the web; anything else as it is. */
export function proxyAddress(url: string, proxy: ImageProxy): string {
  return REMOTE.test(url) ? proxy(url.trim()) : url;
}

/** Every `url(...)` in a piece of CSS that points at the web, through the proxy. */
export function proxyCss(css: string, proxy: ImageProxy): string {
  return css.replace(CSS_URL, (whole, _space: string, double?: string, single?: string, bare?: string) => {
    const url = double ?? single ?? bare ?? "";
    // The proxy's address is percent-encoded throughout, so it needs no escaping inside quotes.
    return REMOTE.test(url) ? `url("${proxy(url.trim())}")` : whole;
  });
}

/**
 * `srcset` candidates are "address [descriptor]", separated by a comma and a space. Addresses may
 * hold commas themselves (`w_100,h_100`), so a bare comma is not taken as a separator; a candidate
 * written that way stays unproxied and blocked.
 */
export function proxySrcset(srcset: string, proxy: ImageProxy): string {
  return srcset
    .split(/,\s+/)
    .map((candidate) => {
      const [url = "", ...descriptor] = candidate.trim().split(/\s+/);
      return [proxyAddress(url, proxy), ...descriptor].join(" ");
    })
    .join(", ");
}

const ADDRESSES = ["src", "background", "poster", "href", "xlink:href"] as const;

/** SVG elements that load a picture from their `href`. */
const loadsHref = (element: Element) => ["image", "feimage"].includes(element.localName.toLowerCase());

/**
 * Sends the remote pictures of an already sanitized mail body through `proxy`. Parsed in a
 * `<template>`, where nothing loads.
 */
export function proxyRemoteImages(html: string, proxy: ImageProxy): string {
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    for (const name of ADDRESSES) {
      // Links stay links; only an SVG <image> or <feImage> loads what its href names.
      if ((name === "href" || name === "xlink:href") && !loadsHref(element)) continue;
      const value = element.getAttribute(name);
      if (value !== null) element.setAttribute(name, proxyAddress(value, proxy));
    }
    const srcset = element.getAttribute("srcset");
    if (srcset !== null) element.setAttribute("srcset", proxySrcset(srcset, proxy));
    const style = element.getAttribute("style");
    if (style !== null) element.setAttribute("style", proxyCss(style, proxy));
    if (element.localName === "style" && element.textContent) {
      element.textContent = proxyCss(element.textContent, proxy);
    }
  }
  return template.innerHTML;
}

/** An address no mail has, to find where the proxy puts the picture's address in its own. */
const PROBE = "https://uwu-probe.invalid/picture";

/**
 * The one source the reader frame's CSP needs for the proxy: its path on our own origin (up to
 * where the picture's address goes), not the whole origin, so a mail can't make the frame load
 * other pages of the webmail's server with the session. Null when the proxy leaves addresses as
 * they are or answers with `data:` (the demo): then there is nothing on our origin to allow.
 */
export function proxyCspSource(proxy: ImageProxy, origin: string): string | null {
  const sample = proxy(PROBE);
  const at = sample.indexOf(encodeURIComponent(PROBE));
  if (at <= 0 || !sample.startsWith("/") || sample.startsWith("//")) return null;
  const before = sample.slice(0, at);
  const query = before.search(/[?#]/);
  // In the query: exactly that path. In the path: everything below its last slash.
  const path = query >= 0 ? before.slice(0, query) : before.slice(0, before.lastIndexOf("/") + 1);
  if (!path.startsWith("/")) return null;
  // A CSP source ends at a space, `;` or `,`; the path is percent-encoded for them.
  return origin + path.replace(/[;,\s]/g, (char) => encodeURIComponent(char));
}

/**
 * Whether a picture's address may stay in the reader once pictures are allowed: one that loads
 * nothing (`data:`, `cid:`) or one on another host on the web. A relative address, or one on the
 * webmail's own origin, would load from the webmail's server with the session (security-audit
 * W-40, like W-22 for quotes).
 */
export function isForeignOrEmbedded(value: string, origin: string): boolean {
  if (isEmbeddedSource(value)) return true;
  if (!REMOTE.test(value)) return false;
  try {
    return new URL(value.trim()).origin !== origin;
  } catch {
    return false;
  }
}

/** A `srcset` without the candidates `keep` refuses; null when none is left. */
function filterSrcset(srcset: string, keep: (url: string) => boolean): string | null {
  const kept = srcset
    .split(/,\s+/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate && keep(candidate.split(/\s+/)[0] ?? ""));
  return kept.length > 0 ? kept.join(", ") : null;
}

/** Every `url(...)` in CSS that `keep` refuses, pointed at nothing instead. */
function filterCss(css: string, keep: (url: string) => boolean): string {
  return css.replace(CSS_URL, (whole, _space: string, double?: string, single?: string, bare?: string) =>
    keep(double ?? single ?? bare ?? "") ? whole : 'url("data:,")',
  );
}

/**
 * Takes out of an already sanitized mail body every picture address that would load from the
 * webmail's own origin: relative ones and absolute ones on this origin, in `src`, `background`,
 * `poster`, `srcset`, SVG `<image>` and CSS `url()`. Runs before the proxy, once pictures may load.
 */
export function dropLocalPictures(html: string, origin: string): string {
  const keep = (url: string) => isForeignOrEmbedded(url, origin);
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of Array.from(template.content.querySelectorAll("*"))) {
    for (const name of ADDRESSES) {
      if ((name === "href" || name === "xlink:href") && !loadsHref(element)) continue;
      const value = element.getAttribute(name);
      if (value !== null && !keep(value)) element.removeAttribute(name);
    }
    const srcset = element.getAttribute("srcset");
    if (srcset !== null) {
      const kept = filterSrcset(srcset, keep);
      if (kept === null) element.removeAttribute("srcset");
      else element.setAttribute("srcset", kept);
    }
    const style = element.getAttribute("style");
    if (style !== null) element.setAttribute("style", filterCss(style, keep));
    if (element.localName === "style" && element.textContent) {
      element.textContent = filterCss(element.textContent, keep);
    }
  }
  return template.innerHTML;
}
