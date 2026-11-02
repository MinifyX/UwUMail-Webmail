/**
 * Turning JMAP Calendars objects (JSCalendar events, draft-ietf-jmap-calendars) into the shapes
 * the calendar works with, and back. Property names follow JSCalendar-bis as the server's calcard
 * crate writes them: `recurrenceRule` (one), `showWithoutTime`, `locations`.
 */

import {
  addDays,
  atMidnight,
  dateOf,
  diffDays,
  diffMinutes,
  addMinutes,
  formatDuration,
  parseDuration,
  zonedToUtc,
  zonedWall,
  type WallTime,
} from "@/lib/calendarDates";
import type {
  CalendarInfo,
  CalendarOccurrence,
  EventInput,
  EventParticipant,
  Invitation,
  OccurrenceBirthday,
  ParticipationStatus,
  Recurrence,
  SchedulingMethod,
  ShareLevel,
  Weekday,
} from "../types";

export interface JmapCalendar {
  id: string;
  name: string;
  color?: string | null;
  sortOrder?: number;
  isVisible?: boolean;
  isDefault?: boolean;
  myRights?: { mayWriteAll?: boolean; mayWriteOwn?: boolean; mayDelete?: boolean; mayShare?: boolean } | null;
  shareWith?: Record<string, Record<string, boolean> | null> | null;
  uwuSharedBy?: { email?: string; name?: string | null } | null;
  /** The server's birthdays calendar, made from the contacts. */
  uwuBirthdays?: boolean;
}

export interface JmapParticipant {
  name?: string | null;
  email?: string | null;
  calendarAddress?: string | null;
  sendTo?: Record<string, string> | null;
  participationStatus?: string | null;
  roles?: Record<string, boolean> | null;
}

export interface JmapRecurrenceRule {
  "@type"?: string;
  frequency: string;
  interval?: number;
  byDay?: { "@type"?: string; day: string; nthOfPeriod?: number }[] | null;
  until?: string | null;
  count?: number | null;
  [other: string]: unknown;
}

export interface JmapCalendarEvent {
  id: string;
  baseEventId?: string | null;
  calendarIds: Record<string, boolean>;
  isOrigin?: boolean;
  title?: string | null;
  description?: string | null;
  locations?: Record<string, { name?: string | null }> | null;
  start: string;
  duration?: string | null;
  timeZone?: string | null;
  showWithoutTime?: boolean | null;
  recurrenceId?: string | null;
  recurrenceRule?: JmapRecurrenceRule | null;
  /** RFC 8984's plural form, in case a server still hands it out. */
  recurrenceRules?: JmapRecurrenceRule[] | null;
  excludedRecurrenceRules?: JmapRecurrenceRule[] | null;
  color?: string | null;
  utcStart?: string | null;
  utcEnd?: string | null;
  participants?: Record<string, JmapParticipant> | null;
  organizerCalendarAddress?: string | null;
  status?: string | null;
  /** An event of the birthdays calendar: whose date it is. */
  uwuBirthday?: {
    contactId?: string;
    kind?: string;
    label?: string | null;
    name?: string;
    year?: number | null;
  } | null;
}

/** What calendarEvents asks for of every occurrence. */
export const EVENT_PROPERTIES = [
  "id",
  "baseEventId",
  "calendarIds",
  "isOrigin",
  "title",
  "description",
  "locations",
  "start",
  "duration",
  "timeZone",
  "showWithoutTime",
  "recurrenceId",
  "recurrenceRule",
  "color",
  "utcStart",
  "utcEnd",
  "participants",
  "organizerCalendarAddress",
  "uwuBirthday",
];

/** What a series needs besides its occurrences: its rule. */
export const RULE_PROPERTIES = ["id", "recurrenceRule", "recurrenceRules", "excludedRecurrenceRules"];

/** What updateEvent compares against before it patches. */
export const EDIT_PROPERTIES = [
  "id",
  "calendarIds",
  "title",
  "description",
  "locations",
  "start",
  "duration",
  "timeZone",
  "showWithoutTime",
  "recurrenceRule",
  "recurrenceRules",
  "excludedRecurrenceRules",
];

/** Only plain hex colours reach a style attribute. */
export function safeColor(color: string | null | undefined): string | null {
  if (!color) return null;
  const trimmed = color.trim();
  if (/^#[0-9a-f]{6}$/i.test(trimmed)) return trimmed.toLowerCase();
  if (/^#[0-9a-f]{8}$/i.test(trimmed)) return trimmed.slice(0, 7).toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(trimmed)) {
    return `#${[...trimmed.slice(1)].map((digit) => digit + digit).join("")}`.toLowerCase();
  }
  return null;
}

export function toCalendarInfo(calendar: JmapCalendar, accountId: string): CalendarInfo {
  const rights = calendar.myRights ?? {};
  return {
    id: calendar.id,
    accountId,
    // A calendar without a name would break sorting the list (security-audit W-27).
    name: typeof calendar.name === "string" ? calendar.name : "",
    color: safeColor(calendar.color),
    isDefault: calendar.isDefault === true,
    isVisible: calendar.isVisible !== false,
    sortOrder: calendar.sortOrder ?? 0,
    // Servers that leave out the rights mean the account's own calendars.
    mayWrite: calendar.myRights ? rights.mayWriteAll === true || rights.mayWriteOwn === true : true,
    mayDelete: calendar.myRights ? rights.mayDelete === true : true,
    mayShare: calendar.myRights ? rights.mayShare === true : false,
    sharedBy: calendar.uwuSharedBy?.email
      ? { email: calendar.uwuSharedBy.email, name: calendar.uwuSharedBy.name?.trim() || calendar.uwuSharedBy.email }
      : null,
    ...(calendar.shareWith && typeof calendar.shareWith === "object"
      ? { sharedWith: calendarSharedWith(calendar.shareWith) }
      : {}),
    ...(calendar.uwuBirthdays === true ? { isBirthdays: true } : {}),
  };
}

const BIRTHDAY_KINDS = new Set(["birth", "wedding", "other"]);

/**
 * What a birthdays calendar event is for, with the years of the occurrence starting on `start`
 * ("YYYY-MM-DD…"); null for every other event.
 */
export function birthdayOf(event: Pick<JmapCalendarEvent, "uwuBirthday">, start: string): OccurrenceBirthday | null {
  const found = event.uwuBirthday;
  if (!found || typeof found.contactId !== "string" || !found.contactId) return null;
  const year = Number.isInteger(found.year) ? (found.year as number) : null;
  const shownYear = Number(start.slice(0, 4));
  const age = year !== null && shownYear > year ? shownYear - year : null;
  return {
    contactId: found.contactId,
    kind: BIRTHDAY_KINDS.has(found.kind ?? "") ? (found.kind as OccurrenceBirthday["kind"]) : "other",
    label: typeof found.label === "string" && found.label ? found.label : null,
    name: typeof found.name === "string" ? found.name : "",
    year,
    age,
  };
}

/** `shareWith` of a calendar as principal id → level: sharing on means everything, writing means write. */
export function calendarSharedWith(
  shareWith: Record<string, Record<string, boolean> | null>,
): Record<string, ShareLevel> {
  const levels: Record<string, ShareLevel> = {};
  for (const [principal, rights] of Object.entries(shareWith)) {
    if (!rights) continue;
    levels[principal] = rights.mayShare
      ? "all"
      : rights.mayWriteAll || rights.mayWriteOwn || rights.mayUpdatePrivate || rights.mayRSVP
        ? "write"
        : "read";
  }
  return levels;
}

/** The CalendarRights a level stands for, as `shareWith` takes them. */
export function calendarRightsFor(level: ShareLevel): Record<string, boolean> {
  const read = { mayReadFreeBusy: true, mayReadItems: true };
  if (level === "read") return read;
  const write = { ...read, mayWriteAll: true, mayWriteOwn: true, mayUpdatePrivate: true, mayRSVP: true };
  return level === "write" ? write : { ...write, mayShare: true };
}

const STATUSES = new Set(["needs-action", "accepted", "tentative", "declined"]);

function addressOf(participant: JmapParticipant): string {
  const raw = participant.calendarAddress ?? participant.sendTo?.imip ?? participant.email ?? "";
  return raw
    .replace(/^mailto:/i, "")
    .trim()
    .toLowerCase();
}

/**
 * The account's part in somebody else's event: the participant with one of its addresses, and
 * how it answered. Null for its own events (it is the origin) and for events without it.
 */
export function invitationOf(
  event: Pick<JmapCalendarEvent, "id" | "baseEventId" | "isOrigin" | "participants" | "organizerCalendarAddress">,
  ownAddresses: string[],
): Invitation | null {
  if (event.isOrigin !== false || !event.participants) return null;
  const own = new Set(ownAddresses.map((address) => address.toLowerCase()));
  const found = Object.entries(event.participants).find(([, participant]) => own.has(addressOf(participant)));
  if (!found) return null;
  const [participantKey, participant] = found;
  const status = statusOf(participant);
  const organizerAddress = event.organizerCalendarAddress?.replace(/^mailto:/i, "").trim() || null;
  const organizer = Object.values(event.participants).find(
    (entry) => organizerAddress && addressOf(entry) === organizerAddress.toLowerCase(),
  );
  return {
    eventId: event.baseEventId ?? event.id,
    participantKey,
    status,
    organizer: organizer?.name?.trim() || organizerAddress || null,
    organizerEmail: organizerAddress?.includes("@") ? organizerAddress.toLowerCase() : null,
  };
}

/** What a scheduling message (iTIP) in a mail says about itself. */
export interface IcsInvitation {
  uid: string;
  /** REQUEST, REPLY, CANCEL …; null when the part names none. */
  method: string | null;
  /** The address the part names as organizer, lower case; null when it names none. */
  organizer: string | null;
  /** The RECURRENCE-ID of the first date the part names alone; null when it is about the whole event. */
  occurrence: string | null;
}

/**
 * The value of the first `name` property in a block of unfolded iCalendar lines. Parameters may
 * quote a colon (`CN="Doe: Jo"`); each character is matched one way only, so a crafted line can't
 * make this backtrack.
 */
function propertyValue(block: string, name: string): string | null {
  const pattern = new RegExp(`^${name}(?=[;:])(?:"[^"\\r\\n]*"|[^":\\r\\n])*:(.*)$`, "im");
  return pattern.exec(block)?.[1]?.trim() || null;
}

/** A calendar address (`mailto:…`) as a lower-case email address; null for anything else. */
function mailtoAddress(value: string | null): string | null {
  const address =
    value
      ?.replace(/^mailto:/i, "")
      .trim()
      .toLowerCase() ?? "";
  return address.includes("@") && !/\s/.test(address) ? address : null;
}

/** The UID, METHOD and ORGANIZER of an iCalendar invitation (RFC 5545 with folded lines, RFC 5546). */
export function icsInvitation(text: string): IcsInvitation | null {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const inEvent = unfolded.split(/BEGIN:VEVENT/i)[1] ?? "";
  const uid = propertyValue(inEvent, "UID");
  if (!uid) return null;
  const method = propertyValue(unfolded, "METHOD")?.toUpperCase() ?? null;
  return {
    uid,
    method,
    organizer: mailtoAddress(propertyValue(inEvent, "ORGANIZER")),
    occurrence: propertyValue(inEvent, "RECURRENCE-ID"),
  };
}

/**
 * Whether a scheduling mail may speak for the stored event it names, the way the server checks
 * it before it changes anything (security-audit-0.16.0 WEBMAIL-2): an invitation, an update or a
 * cancellation only from the event's organizer, naming the same organizer; an answer only from
 * one of the event's participants. Anyone can write a mail naming someone else's event UID, so
 * a mail that fails this is shown as unverified and nothing is offered on its account. (The
 * server also wants SPF or DKIM to vouch for the sender, which the webmail can't see; what it
 * shows of the event itself is always what the server stored.)
 */
export function schedulingMailVerified(
  ics: Pick<IcsInvitation, "method" | "organizer">,
  from: string | null | undefined,
  event: Pick<JmapCalendarEvent, "organizerCalendarAddress" | "participants">,
): boolean {
  const sender = mailtoAddress(from ?? null);
  if (!sender) return false;
  if (ics.method === "REPLY") {
    return Object.values(event.participants ?? {}).some((participant) => addressOf(participant) === sender);
  }
  const organizer = mailtoAddress(event.organizerCalendarAddress ?? null);
  return organizer !== null && sender === organizer && ics.organizer === organizer;
}

/**
 * Whether the calendar bears out what a scheduling mail says about cancelling. The server cancels
 * the stored event only when SPF or DKIM vouch for the organizer's address; the webmail sees only
 * the From, which anyone can write. So a cancellation of the whole event counts once the stored
 * event is cancelled, and is not believed otherwise (security-audit W-33). One that names single
 * dates (RECURRENCE-ID) is never taken for the whole event's; mail of any other kind isn't concerned.
 */
export function cancellationApplied(
  ics: Pick<IcsInvitation, "method" | "occurrence">,
  event: Pick<JmapCalendarEvent, "status">,
): boolean {
  return ics.method !== "CANCEL" || ics.occurrence !== null || event.status === "cancelled";
}

/** The most participants an occurrence carries; a huge event only shows its first ones. */
export const MAX_PARTICIPANTS = 50;

/** Who takes part in an event, the organizer first, each with an address or a name. */
export function participantsOf(
  event: Pick<JmapCalendarEvent, "participants" | "organizerCalendarAddress">,
): EventParticipant[] {
  const organizer = mailtoAddress(event.organizerCalendarAddress ?? null);
  return Object.values(event.participants ?? {})
    .map((participant) => {
      const email = mailtoAddress(addressOf(participant)) ?? "";
      return {
        name: participant.name?.trim() || email,
        email,
        status: statusOf(participant),
        organizer: email !== "" && email === organizer,
      };
    })
    .filter((participant) => participant.name !== "")
    .sort((a, b) => Number(b.organizer) - Number(a.organizer))
    .slice(0, MAX_PARTICIPANTS);
}

/** An iCalendar METHOD as the webmail tells them apart. */
export function schedulingMethod(method: string | null): SchedulingMethod {
  if (method === null || method === "REQUEST") return "request";
  if (method === "CANCEL") return "cancel";
  if (method === "REPLY") return "reply";
  return "other";
}

/** The participant of an event with this address, and their key. */
export function participantWith(
  event: Pick<JmapCalendarEvent, "participants">,
  address: string,
): { key: string; participant: JmapParticipant } | null {
  const wanted = address.trim().toLowerCase();
  const found = Object.entries(event.participants ?? {}).find(([, participant]) => addressOf(participant) === wanted);
  return found ? { key: found[0], participant: found[1] } : null;
}

/** A participant's answer, "needs-action" where it says none the webmail knows. */
export function statusOf(participant: JmapParticipant): ParticipationStatus {
  return STATUSES.has(participant.participationStatus ?? "")
    ? (participant.participationStatus as ParticipationStatus)
    : "needs-action";
}

const FREQUENCIES = new Set(["daily", "weekly", "monthly", "yearly"]);
const WEEKDAY_NAMES = new Set<string>(["mo", "tu", "we", "th", "fr", "sa", "su"]);
/** Rule properties that mean nothing beyond the defaults the editor assumes. */
const HARMLESS: Record<string, (value: unknown) => boolean> = {
  "@type": () => true,
  frequency: () => true,
  interval: () => true,
  byDay: () => true,
  until: () => true,
  count: () => true,
  rscale: (value) => value === "gregorian",
  skip: (value) => value === "omit",
  firstDayOfWeek: (value) => value === "mo",
};

/**
 * The rule as the editor understands it. `editable` is false when the rule says more than
 * Recurrence can (by month day, nth weekday, hourly, several rules …); the editor then leaves it
 * alone, and `recurrence` is only a rough picture for showing that the event repeats.
 */
export function toRecurrence(
  event: Pick<JmapCalendarEvent, "recurrenceRule" | "recurrenceRules" | "excludedRecurrenceRules">,
): {
  recurrence: Recurrence | null;
  editable: boolean;
} {
  const rules = event.recurrenceRule ? [event.recurrenceRule] : (event.recurrenceRules ?? []);
  const rule = rules[0];
  if (!rule) return { recurrence: null, editable: true };
  let editable = rules.length === 1 && !event.excludedRecurrenceRules?.length;
  const frequency = FREQUENCIES.has(rule.frequency) ? (rule.frequency as Recurrence["frequency"]) : "daily";
  if (frequency !== rule.frequency) editable = false;
  for (const [key, value] of Object.entries(rule)) {
    if (value === null || value === undefined) continue;
    if (!HARMLESS[key]?.(value)) editable = false;
  }
  const interval = Number.isInteger(rule.interval) && (rule.interval ?? 0) >= 1 ? rule.interval! : 1;
  let byDay: Weekday[] | null = null;
  if (rule.byDay?.length) {
    if (frequency !== "weekly" || rule.byDay.some((day) => day.nthOfPeriod || !WEEKDAY_NAMES.has(day.day))) {
      editable = false;
    }
    byDay = rule.byDay.map((day) => day.day).filter((day): day is Weekday => WEEKDAY_NAMES.has(day));
    if (byDay.length === 0) byDay = null;
  }
  return {
    recurrence: {
      frequency,
      interval,
      byDay: frequency === "weekly" ? byDay : null,
      until: rule.until ? rule.until.slice(0, 10) : null,
      count: Number.isInteger(rule.count) && (rule.count ?? 0) > 0 ? rule.count! : null,
    },
    editable,
  };
}

/** The JSCalendar rule for what the editor says. `until` includes its whole day. */
export function fromRecurrence(recurrence: Recurrence): JmapRecurrenceRule {
  return {
    "@type": "RecurrenceRule",
    frequency: recurrence.frequency,
    interval: Math.max(1, Math.floor(recurrence.interval)),
    ...(recurrence.frequency === "weekly" && recurrence.byDay?.length
      ? { byDay: recurrence.byDay.map((day) => ({ "@type": "NDay", day })) }
      : {}),
    ...(recurrence.until ? { until: `${recurrence.until}T23:59:59` } : {}),
    ...(recurrence.count ? { count: recurrence.count } : {}),
  };
}

function sameRecurrence(a: Recurrence | null, b: Recurrence | null): boolean {
  if (a === null || b === null) return a === b;
  const days = (list: Weekday[] | null) => [...(list ?? [])].sort().join(",");
  return (
    a.frequency === b.frequency &&
    a.interval === b.interval &&
    (a.frequency !== "weekly" || days(a.byDay) === days(b.byDay)) &&
    a.until === b.until &&
    a.count === b.count
  );
}

export function locationOf(event: Pick<JmapCalendarEvent, "locations">): string {
  return Object.values(event.locations ?? {}).find((location) => location?.name)?.name ?? "";
}

/** Whole days of an all-day event; anything shorter still covers its day. */
function allDayLength(duration: string | null | undefined): number {
  const parsed = parseDuration(duration ?? "P1D") ?? { days: 1, seconds: 0 };
  return Math.max(1, parsed.days + Math.ceil(parsed.seconds / 86_400));
}

function exactSeconds(duration: string | null | undefined): number {
  const parsed = parseDuration(duration ?? "PT0S") ?? { days: 0, seconds: 0 };
  return parsed.days * 86_400 + parsed.seconds;
}

interface OccurrenceContext {
  accountId: string;
  /** The viewer's zone, which every wall time on screen is in. */
  viewerZone: string;
  calendar: CalendarInfo | undefined;
  /** The base event of a series, for its rule. */
  base: JmapCalendarEvent | undefined;
  /** The account's addresses, to find it among an invitation's participants. */
  ownAddresses?: string[];
}

export function toOccurrence(event: JmapCalendarEvent, context: OccurrenceContext): CalendarOccurrence {
  const allDay = event.showWithoutTime === true;
  let start: WallTime;
  let end: WallTime;
  if (allDay) {
    start = atMidnight(dateOf(event.start));
    end = atMidnight(addDays(dateOf(event.start), allDayLength(event.duration)));
  } else if (event.utcStart && event.utcEnd) {
    start = zonedWall(event.utcStart, context.viewerZone);
    end = zonedWall(event.utcEnd, context.viewerZone);
  } else {
    // Floating events (no zone) happen at the same wall time everywhere.
    const startUtc = zonedToUtc(event.start, event.timeZone ?? context.viewerZone);
    start = zonedWall(startUtc, context.viewerZone);
    end = zonedWall(startUtc + exactSeconds(event.duration) * 1000, context.viewerZone);
  }
  const { recurrence, editable } = toRecurrence(context.base ?? event);
  return {
    id: event.id,
    eventId: event.baseEventId ?? event.id,
    accountId: context.accountId,
    calendarId: Object.keys(event.calendarIds).find((id) => event.calendarIds[id]) ?? "",
    title: event.title ?? "",
    description: event.description ?? "",
    location: locationOf(event),
    allDay,
    start,
    end,
    timeZone: allDay ? null : (event.timeZone ?? null),
    recurrence,
    recurrenceEditable: editable,
    recurrenceId: event.recurrenceId ?? null,
    readOnly: !(context.calendar?.mayWrite ?? true) || event.isOrigin === false,
    color: safeColor(event.color),
    invitation: invitationOf(event, context.ownAddresses ?? []),
    participants: participantsOf(event),
    birthday: birthdayOf(event, start),
  };
}

function exactDuration(input: EventInput, zone: string): string {
  const seconds = Math.max(0, Math.round((zonedToUtc(input.end, zone) - zonedToUtc(input.start, zone)) / 1000));
  return formatDuration({ days: 0, seconds });
}

function locationsFor(name: string): Record<string, unknown> | null {
  const trimmed = name.trim();
  return trimmed ? { loc1: { "@type": "Location", name: trimmed } } : null;
}

/** A new event for CalendarEvent/set. Timed events keep the device's zone, all-day ones float. */
export function newEventObject(input: EventInput, deviceZone: string): Record<string, unknown> {
  const zone = input.timeZone ?? deviceZone;
  const object: Record<string, unknown> = {
    "@type": "Event",
    calendarIds: { [input.calendarId]: true },
    title: input.title,
    description: input.description,
    showWithoutTime: input.allDay,
  };
  if (input.allDay) {
    object.start = atMidnight(dateOf(input.start));
    object.duration = `P${Math.max(1, diffDays(dateOf(input.start), dateOf(input.end)))}D`;
    object.timeZone = null;
  } else {
    object.start = input.start;
    object.duration = exactDuration(input, zone);
    object.timeZone = zone;
  }
  const locations = locationsFor(input.location);
  if (locations) object.locations = locations;
  if (input.recurrence) object.recurrenceRule = fromRecurrence(input.recurrence);
  return object;
}

/**
 * The JMAP patch from the stored event to what the editor saved: only what changed. Times are
 * compared as instants, so an event kept in another zone doesn't move into ours by being saved.
 * For a series, `occurrenceStart` is where the edited occurrence was shown; the series moves by
 * as much as that occurrence did.
 */
export function eventPatch(
  current: JmapCalendarEvent,
  input: EventInput,
  viewerZone: string,
  occurrenceStart?: WallTime,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  if ((current.title ?? "") !== input.title) patch.title = input.title;
  if ((current.description ?? "") !== input.description) patch.description = input.description;
  if (locationOf(current) !== input.location.trim()) patch.locations = locationsFor(input.location);
  if (!current.calendarIds[input.calendarId]) patch.calendarIds = { [input.calendarId]: true };

  const stored = toRecurrence(current);
  const series = stored.recurrence !== null && occurrenceStart !== undefined;
  const wasAllDay = current.showWithoutTime === true;

  if (input.allDay) {
    const days = Math.max(1, diffDays(dateOf(input.start), dateOf(input.end)));
    const startDate = series
      ? addDays(dateOf(current.start), diffDays(dateOf(occurrenceStart), dateOf(input.start)))
      : dateOf(input.start);
    if (!wasAllDay) {
      patch.showWithoutTime = true;
      patch.timeZone = null;
    }
    if (!wasAllDay || dateOf(current.start) !== startDate) patch.start = atMidnight(startDate);
    if (!wasAllDay || allDayLength(current.duration) !== days) patch.duration = `P${days}D`;
  } else {
    const zone = input.timeZone ?? viewerZone;
    const duration = exactDuration(input, zone);
    if (wasAllDay) {
      const date = series
        ? addDays(dateOf(current.start), diffDays(dateOf(occurrenceStart), dateOf(input.start)))
        : dateOf(input.start);
      patch.showWithoutTime = false;
      patch.start = `${date}${input.start.slice(10)}`;
      patch.timeZone = zone;
      patch.duration = duration;
    } else {
      if (series) {
        const shift = diffMinutes(occurrenceStart, input.start);
        if (shift !== 0) patch.start = addMinutes(current.start, shift);
      } else {
        const currentZone = current.timeZone ?? viewerZone;
        if (zonedToUtc(current.start, currentZone) !== zonedToUtc(input.start, zone)) {
          patch.start = input.start;
          if (current.timeZone !== zone) patch.timeZone = zone;
        }
      }
      if (exactSeconds(current.duration) !== exactSeconds(duration)) patch.duration = duration;
    }
  }

  if (stored.editable && !sameRecurrence(stored.recurrence, input.recurrence)) {
    patch.recurrenceRule = input.recurrence ? fromRecurrence(input.recurrence) : null;
    if (current.recurrenceRules) patch.recurrenceRules = null;
    // Exceptions belong to the old rule's dates.
    if (!input.recurrence) patch.recurrenceOverrides = null;
  }
  return patch;
}
