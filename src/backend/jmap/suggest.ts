/**
 * Recipient suggestions from the server (`urn:uwumail:jmap:suggest`): the address books and the
 * mail the person sent and received, ranked by the server. See the server's docs/jmap-suggest.md.
 */

import type { Contact } from "../types";

export const SUGGEST = "urn:uwumail:jmap:suggest";

export interface JmapAddressSuggestion {
  email: string;
  name?: string | null;
  source?: string;
  sources?: string[];
  lastUsedAt?: string | null;
}

/** The server's ranked list as the composer's suggestions, keeping its order and skipping broken entries. */
export function suggestionsToContacts(list: JmapAddressSuggestion[]): Contact[] {
  const seen = new Set<string>();
  const contacts: Contact[] = [];
  for (const entry of list) {
    if (typeof entry.email !== "string" || !entry.email.includes("@")) continue;
    const key = entry.email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    contacts.push({
      email: entry.email,
      ...(entry.name?.trim() ? { name: entry.name.trim() } : {}),
      ...(entry.lastUsedAt ? { lastUsed: entry.lastUsedAt } : {}),
      timesContacted: 0,
    });
  }
  return contacts;
}

/** How many to ask for: what the composer shows, within the server's `maxLimit`. */
export function suggestionLimit(wanted: number, capability: { maxLimit?: unknown } | null): number {
  const max = typeof capability?.maxLimit === "number" && capability.maxLimit > 0 ? capability.maxLimit : wanted;
  return Math.max(1, Math.min(wanted, max));
}
