/**
 * The search field's operators (lib/searchQuery) as an RFC 8621 `Email/query` filter. Every term
 * must hold; `to:` matches To or Cc; days are local days, sent to the server as UTC instants.
 */

import { parseSearch, type SearchQuery } from "@/lib/searchQuery";

export type FilterCondition = Record<string, unknown>;

/** The local midnight a `YYYY-MM-DD` day starts at, as a JMAP UTCDate. */
function dayStartUtc(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${new Date(y, m - 1, d).toISOString().slice(0, 19)}Z`;
}

export function searchConditions(query: SearchQuery): FilterCondition[] {
  const conditions: FilterCondition[] = [];
  for (const word of query.words) conditions.push({ text: word });
  for (const value of query.from) conditions.push({ from: value });
  for (const value of query.to) conditions.push({ operator: "OR", conditions: [{ to: value }, { cc: value }] });
  for (const value of query.subject) conditions.push({ subject: value });
  if (query.hasAttachment) conditions.push({ hasAttachment: true });
  if (query.unread) conditions.push({ notKeyword: "$seen" });
  if (query.flagged) conditions.push({ hasKeyword: "$flagged" });
  if (query.after) conditions.push({ after: dayStartUtc(query.after) });
  if (query.before) conditions.push({ before: dayStartUtc(query.before) });
  return conditions;
}

/** The conditions for what was typed into the search field; none for an empty search. */
export function searchFilter(search: string | undefined): FilterCondition[] {
  if (!search?.trim()) return [];
  return searchConditions(parseSearch(search));
}
