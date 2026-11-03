/**
 * Accounts that may only send to addresses on their own server (see `SendPolicy`). The server
 * refuses every other recipient; the composer says so before sending instead of after a bounce.
 */

import type { Address, SendPolicy } from "@/backend/types";

/** Every account may send anywhere until the server says otherwise. */
export const OPEN_SEND_POLICY: SendPolicy = { internalOnly: false, internalDomains: [] };

/** A domain as the server compares it: lowercase, without a trailing dot, international names in ASCII. */
export function normalizeDomain(domain: string): string {
  const trimmed = domain.trim().replace(/\.+$/, "").toLowerCase();
  if (!trimmed) return "";
  try {
    // The URL parser writes international names the way DNS has them (punycode).
    return new URL(`http://${trimmed}/`).hostname;
  } catch {
    return trimmed;
  }
}

/**
 * The domain of a recipient: from a bare address, "Name <address>" or an address with a
 * subaddress ("name+tag@domain"). Null when there is no domain to read.
 */
export function recipientDomain(address: string): string | null {
  let email = address.trim();
  const bracketed = /<([^<>]*)>\s*$/.exec(email);
  if (bracketed) email = bracketed[1]!.trim();
  // The last "@": a quoted local part may hold one of its own.
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = normalizeDomain(email.slice(at + 1));
  return domain || null;
}

/** The server's domains, normalized once; empty where any address goes. */
function internalSet(policy: SendPolicy): Set<string> | null {
  if (!policy.internalOnly || policy.internalDomains.length === 0) return null;
  return new Set(policy.internalDomains.map(normalizeDomain).filter(Boolean));
}

/**
 * Whether the account can send to this address. Always true for an account without the limit,
 * and for one whose server didn't name its domains: then only the server can tell.
 */
export function canSendTo(address: string, policy: SendPolicy): boolean {
  const domains = internalSet(policy);
  if (!domains) return true;
  const domain = recipientDomain(address);
  return domain !== null && domains.has(domain);
}

/** The recipients the account can't send to, each address once, in the order given. */
export function undeliverableRecipients(addresses: Address[], policy: SendPolicy): Address[] {
  const domains = internalSet(policy);
  if (!domains) return [];
  const seen = new Set<string>();
  return addresses.filter((address) => {
    const key = address.email.trim().toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    const domain = recipientDomain(address.email);
    return domain === null || !domains.has(domain);
  });
}
