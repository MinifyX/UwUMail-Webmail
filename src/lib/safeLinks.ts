// Microsoft Defender for Office 365 "Safe Links" wrap every link of a mail that went through
// Exchange Online: `https://eur01.safelinks.protection.outlook.com/?url=<the real link>&data=…`.
// The reader shows and opens the real link instead, so its address, the phishing checks and the
// question before opening all look at where the link really goes. Display only: the stored mail
// keeps the wrapped link. Nothing is ever fetched.

/** Wrappers inside wrappers (a mail forwarded between two tenants) are unwrapped this deep. */
const MAX_LEVELS = 3;

/** Safe Links hosts: every region of the commercial cloud, GCC High/DoD and the 21Vianet cloud. */
const SAFELINKS_HOST = /(?:^|\.)safelinks\.protection\.(?:outlook\.com|office365\.us|partner\.outlook\.cn)$/;

/** Safe Links in Teams and Office apps: `statics.teams.cdn.office.net/evergreen-assets/safelinks/1/atp-safelinks.html?url=…`. */
function isAtpPage(url: URL, host: string): boolean {
  return host === "statics.teams.cdn.office.net" && /\/atp-safelinks\.html$/i.test(url.pathname);
}

export function isSafeLinkWrapper(url: URL): boolean {
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;
  const host = url.hostname.toLowerCase().replace(/\.$/, "");
  return SAFELINKS_HOST.test(host) || isAtpPage(url, host);
}

/** The wrapped link when it is a web or mail link; anything else (javascript:, data:, …) is not unwrapped. */
function wrappedTarget(url: URL): string | null {
  let value: string | null = null;
  for (const [key, entry] of url.searchParams) {
    if (key.toLowerCase() === "url") {
      value = entry;
      break;
    }
  }
  if (value === null) return null;
  let candidate = value.trim();
  // Some gateways encode the link once more.
  for (let round = 0; round < 2 && /^(?:https?|mailto)%3a/i.test(candidate); round++) {
    try {
      candidate = decodeURIComponent(candidate);
    } catch {
      return null;
    }
  }
  if (/^mailto:/i.test(candidate)) return /^mailto:[^\s]+$/i.test(candidate) ? candidate : null;
  try {
    const target = new URL(candidate);
    return target.protocol === "http:" || target.protocol === "https:" ? target.href : null;
  } catch {
    return null;
  }
}

export interface SafeLink {
  /** The link inside the wrapper. */
  target: string;
  /** The Safe Links host that was removed, outermost. */
  host: string;
}

/** The real link inside a Microsoft Safe Link, or null when the link is no Safe Link or holds no web or mail link. */
export function unwrapSafeLink(href: string): SafeLink | null {
  let current = href.trim();
  let host: string | null = null;
  for (let level = 0; level < MAX_LEVELS; level++) {
    let url: URL;
    try {
      url = new URL(current);
    } catch {
      break;
    }
    if (!isSafeLinkWrapper(url)) break;
    const target = wrappedTarget(url);
    if (!target) break;
    host ??= url.hostname.toLowerCase();
    current = target;
  }
  return host ? { target: current, host } : null;
}

/** Marks a link in the reader whose Safe Link was removed; holds the wrapper host. */
export const SAFE_LINK_MARKER = "data-uwu-safelink";

/**
 * Shows the real link in an `<a>` or `<area>` of the reader. Link text that spelled out the
 * wrapped address (plain text turned into links, or a pasted Safe Link) spells out the real one.
 */
export function unwrapSafeLinkElement(element: Element): void {
  const href = element.getAttribute("href");
  if (!href) return;
  const safe = unwrapSafeLink(href);
  if (!safe) return;
  element.setAttribute("href", safe.target);
  element.setAttribute(SAFE_LINK_MARKER, safe.host);
  const only = element.childNodes.length === 1 ? element.firstChild : null;
  if (only && only.nodeType === 3 && only.textContent?.trim() === href.trim()) only.textContent = safe.target;
}
