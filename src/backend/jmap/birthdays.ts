/**
 * The server's birthdays extension (`urn:uwumail:jmap:birthdays`, docs/birthdays.md there):
 * birthday events of other calendars, found and matched to contacts by the server, and moved into
 * the contacts, the event deleted in the same go.
 */

import { formatDay, partialDay } from "@/lib/birthdays";
import type {
  BirthdayCandidate,
  BirthdayImportEntry,
  BirthdayImportResult,
  BirthdayMatch,
  BirthdayScan,
} from "../types";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");

const MATCHES = new Set<BirthdayMatch>(["matched", "known", "conflict", "ambiguous", "unmatched"]);

/** `{month, day, year}` as "YYYY-MM-DD" or "--MM-DD"; null when it's no day. */
function dayOf(value: unknown): string | null {
  if (!isObject(value)) return null;
  const year = typeof value.year === "number" ? value.year : null;
  const day = partialDay(year, Number(value.month), Number(value.day));
  return day ? formatDay(day) : null;
}

function candidateOf(value: unknown): BirthdayCandidate | null {
  if (!isObject(value)) return null;
  const birthday = dayOf(value.birthday);
  const eventId = text(value.eventId);
  if (!birthday || !eventId) return null;
  const match = MATCHES.has(value.match as BirthdayMatch) ? (value.match as BirthdayMatch) : "unmatched";
  const contacts = (Array.isArray(value.contacts) ? value.contacts : [])
    .filter(isObject)
    .map((contact) => ({
      contactId: text(contact.contactId),
      name: text(contact.name),
      birthday: dayOf(contact.birthday),
    }))
    .filter((contact) => contact.contactId !== "");
  return {
    eventId,
    calendarId: text(value.calendarId),
    title: text(value.title),
    name: text(value.name),
    birthday,
    mayDeleteEvent: value.mayDeleteEvent === true,
    // A match without its contact is none.
    match:
      (match === "matched" || match === "known" || match === "conflict") && contacts.length === 0 ? "unmatched" : match,
    contacts,
  };
}

/** `Birthdays/scan`'s answer read. */
export function scanFrom(response: Json): BirthdayScan {
  const candidates = (Array.isArray(response.candidates) ? response.candidates : [])
    .map(candidateOf)
    .filter((candidate): candidate is BirthdayCandidate => candidate !== null);
  return { candidates, truncated: response.truncated === true };
}

/** The `entries` of `Birthdays/import`. */
export function importEntries(entries: BirthdayImportEntry[]): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const entry of entries) {
    out[entry.eventId] =
      "contactId" in entry
        ? { contactId: entry.contactId, ...(entry.overwrite ? { overwrite: true } : {}) }
        : { newContact: { name: entry.newContactName.trim() } };
  }
  return out;
}

/** `Birthdays/import`'s answer read. */
export function importResultFrom(response: Json): BirthdayImportResult {
  const imported = Object.entries(isObject(response.imported) ? response.imported : {})
    .filter((entry): entry is [string, Json] => isObject(entry[1]))
    .map(([eventId, done]) => ({
      eventId,
      contactId: text(done.contactId),
      created: done.created === true,
      eventDeleted: done.eventDeleted === true,
    }));
  const failed = Object.entries(isObject(response.notImported) ? response.notImported : {}).map(([eventId, error]) => ({
    eventId,
    reason: isObject(error) ? text(error.description) || text(error.type) : "",
  }));
  return { imported, failed };
}
