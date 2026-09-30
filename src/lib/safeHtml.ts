import DOMPurify from "dompurify";

/** Sources that carry their content along or point into the mail itself, so nothing is fetched. */
const EMBEDDED = /^(data|cid):/i;

/**
 * Whether a picture's address loads nothing from a server, read the way a browser reads it: it
 * drops leading control characters and spaces and every tab and line break, and takes a
 * backslash for a slash. So `https:\\host`, `\\host`, `h&#9;ttps://host` and
 * `&#1;https://host` all load from `host`, and a relative address loads from the webmail's own
 * server with the session. Only what is known to stay local may stay (security-audit W-22).
 */
export function isEmbeddedSource(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  const address = value.replace(/[\t\n\r]/g, "").replace(/^[\u0000- ]+/, "");
  return EMBEDDED.test(address);
}

/**
 * Mail HTML for places inside the app's own page, such as a quoted reply in
 * the composer. Unlike the mail view, there is no sandboxed frame around it,
 * so styles must not leak into the app and nothing may load from the internet
 * (a tracking pixel would otherwise fire just by pressing "Reply").
 *
 * With `foreign`, the markup comes from somebody else (a quoted or forwarded mail, a paste, a
 * drop) and loses the composer's own `data-uwu-*` markers too, so it can't pose as the
 * signature block that switching signatures replaces (security-audit W-42). The composer's own
 * body keeps them when it is cleaned again.
 */
export function quotableHtml(html: string, { foreign = false }: { foreign?: boolean } = {}): string {
  const purify = DOMPurify();
  if (foreign) {
    purify.addHook("uponSanitizeAttribute", (_node, data) => {
      if (/^data-uwu-/i.test(data.attrName)) data.keepAttr = false;
    });
  }
  purify.addHook("afterSanitizeAttributes", (node) => {
    if (node instanceof Element) {
      for (const name of ["src", "srcset", "background", "poster"]) {
        const value = node.getAttribute(name);
        if (value !== null && (name === "srcset" || !isEmbeddedSource(value))) node.removeAttribute(name);
      }
      // Quoted mail renders in the app page, not the sandboxed reader frame, so inline styles could
      // leak into or overlay the composer. Drop them entirely; the quote keeps its text and structure.
      if (node.hasAttribute("style")) node.removeAttribute("style");
      if (node.tagName === "IMG" && !node.hasAttribute("src")) node.remove();
      if (node.tagName === "A") {
        const href = node.getAttribute("href") ?? "";
        if (!/^(https?:|mailto:)/i.test(href.trim())) node.removeAttribute("href");
      }
    }
  });
  return purify.sanitize(html, {
    FORBID_TAGS: [
      "style",
      "link",
      "meta",
      "base",
      "script",
      "iframe",
      "frame",
      "object",
      "embed",
      "form",
      "input",
      "button",
      "textarea",
      "select",
      "video",
      "audio",
      "source",
      "svg",
      "math",
    ],
    FORBID_ATTR: ["class", "id", "srcdoc", "formaction", "ping"],
    FORCE_BODY: true,
  });
}

/** Plain text of some HTML, without loading anything it references. */
export function htmlToPlainText(html: string): string {
  const withBreaks = html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n");
  const doc = new DOMParser().parseFromString(withBreaks, "text/html");
  return (doc.body.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Only web and mail links may go into a message the user writes. */
export function isSafeLinkTarget(url: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(url.trim());
}
