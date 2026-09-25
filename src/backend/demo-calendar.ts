// Fictional calendars and events for the demo, placed around today. No real people.

import {
  addDays,
  addMinutes,
  dateOf,
  diffDays,
  diffMinutes,
  startOfWeek,
  todayKey,
  withClock,
  type WallTime,
} from "@/lib/calendarDates";
import { expandRecurrence, weekdayOf } from "@/lib/recurrence";
import { BackendError } from "./backend";
import type {
  CalendarInfo,
  CalendarOccurrence,
  EventDeleteScope,
  EventInput,
  Invitation,
  MailInvitation,
  ParticipationStatus,
  Recurrence,
  ShareLevel,
} from "./types";

type Lang = "de" | "en";

interface DemoEvent {
  id: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  /** Wall times in the viewer's zone: the demo has no other. */
  start: WallTime;
  end: WallTime;
  recurrence: Recurrence | null;
  /** Starts of occurrences taken out of a series. */
  excluded: string[];
  /** Somebody else's event the demo was invited to. */
  invitation?: Invitation;
}

/** Occurrence ids of a series: the event's id and the occurrence's original start. */
const SEPARATOR = "~";

function sampleCalendars(lang: Lang, accountId: string): CalendarInfo[] {
  const base = { accountId, isVisible: true, mayWrite: true, mayDelete: true };
  const list: CalendarInfo[] = [
    {
      ...base,
      id: "cal-private",
      name: lang === "de" ? "Privat" : "Personal",
      color: "#ff4d8d",
      isDefault: true,
      sortOrder: 0,
    },
    { ...base, id: "cal-studio", name: "Studio", color: "#8b5cf6", isDefault: false, sortOrder: 1 },
    { ...base, id: "cal-sport", name: "Sport", color: "#10b981", isDefault: false, sortOrder: 2 },
    {
      ...base,
      id: "cal-leni",
      name: "Team",
      color: "#f59e0b",
      isDefault: false,
      sortOrder: 3,
      mayWrite: false,
      sharedBy: { email: "leni@uwumail.example", name: "Leni" },
    },
  ];
  return list.map((calendar) => ({ ...calendar, mayShare: !calendar.sharedBy, sharedBy: calendar.sharedBy ?? null }));
}

function sampleEvents(lang: Lang): DemoEvent[] {
  const de = lang === "de";
  const today = todayKey();
  const monday = startOfWeek(today, 1);
  const at = (days: number, clock: string) => withClock(addDays(today, days), clock);
  const event = (patch: Partial<DemoEvent> & Pick<DemoEvent, "id" | "title" | "start" | "end">): DemoEvent => ({
    calendarId: "cal-private",
    description: "",
    location: "",
    allDay: false,
    recurrence: null,
    excluded: [],
    ...patch,
  });
  const weekly = (byDay: Recurrence["byDay"], extra: Partial<Recurrence> = {}): Recurrence => ({
    frequency: "weekly",
    interval: 1,
    byDay,
    until: null,
    count: null,
    ...extra,
  });
  return [
    event({
      id: "ev-yoga",
      calendarId: "cal-sport",
      title: "Yoga",
      location: de ? "Studio Lotus, Raum 2" : "Lotus studio, room 2",
      start: withClock(addDays(monday, -14 + 1), "18:30"),
      end: withClock(addDays(monday, -14 + 1), "19:30"),
      recurrence: weekly(["tu", "th"]),
    }),
    event({
      id: "ev-standup",
      calendarId: "cal-studio",
      title: de ? "Kurzes Team-Update" : "Team stand-up",
      start: withClock(addDays(monday, -7), "09:30"),
      end: withClock(addDays(monday, -7), "09:45"),
      recurrence: weekly(["mo", "tu", "we", "th", "fr"], { count: 60 }),
    }),
    event({
      id: "ev-review",
      calendarId: "cal-studio",
      title: de ? "Sprint-Review" : "Sprint review",
      start: withClock(addDays(monday, -14), "15:00"),
      end: withClock(addDays(monday, -14), "16:00"),
      recurrence: weekly(["mo"], { interval: 2 }),
    }),
    event({
      id: "ev-client",
      calendarId: "cal-studio",
      title: de ? "Kundentermin Bright Labs" : "Client call: Bright Labs",
      description: de
        ? "Logo-Entwürfe durchgehen.\nEinwahl: https://meet.brightlabs.example/uwu-42"
        : "Go through the logo drafts.\nJoin: https://meet.brightlabs.example/uwu-42",
      location: de ? "Videocall" : "Video call",
      start: at(0, "10:00"),
      end: at(0, "11:00"),
    }),
    event({
      id: "ev-feedback",
      calendarId: "cal-studio",
      title: de ? "Feedback einarbeiten" : "Work in feedback",
      start: at(0, "10:30"),
      end: at(0, "12:00"),
    }),
    event({
      id: "ev-lunch",
      title: de ? "Mittagessen mit Noah" : "Lunch with Noah",
      location: "Kaffee & Kuchen",
      start: at(0, "12:30"),
      end: at(0, "13:30"),
    }),
    event({
      id: "ev-dentist",
      title: de ? "Zahnarzt" : "Dentist",
      start: at(1, "08:00"),
      end: at(1, "08:45"),
    }),
    event({
      id: "ev-games",
      title: de ? "Spieleabend" : "Game night",
      description: de ? "Mia bringt Snacks mit." : "Mia brings snacks.",
      start: at(3, "19:00"),
      end: at(3, "23:30"),
    }),
    event({
      id: "ev-conference",
      calendarId: "cal-studio",
      title: "Pixel Days",
      location: "Messe Nord, Halle 3",
      allDay: true,
      start: withClock(addDays(today, 6), "00:00"),
      end: withClock(addDays(today, 8), "00:00"),
    }),
    event({
      id: "ev-birthday",
      title: de ? "Geburtstag Leni" : "Leni's birthday",
      allDay: true,
      start: withClock(addDays(today, 2), "00:00"),
      end: withClock(addDays(today, 3), "00:00"),
      recurrence: { frequency: "yearly", interval: 1, byDay: null, until: null, count: null },
    }),
    event({
      id: "ev-run",
      calendarId: "cal-sport",
      title: de ? "Laufen im Park" : "Run in the park",
      start: at(-2, "07:00"),
      end: at(-2, "08:00"),
    }),
    event({
      id: "ev-standup",
      calendarId: "cal-leni",
      title: de ? "Team-Runde" : "Team check-in",
      start: at(1, "09:30"),
      end: at(1, "10:00"),
    }),
    event({
      id: "ev-invite",
      title: de ? "Logo-Besprechung" : "Logo review",
      location: "Video",
      start: at(2, "10:00"),
      end: at(2, "11:00"),
      // The invitation that came with Emma's mail about the logo draft.
      invitation: {
        eventId: "ev-invite",
        participantKey: "mini",
        status: "needs-action",
        organizer: "Emma",
      },
    }),
  ];
}

/** The demo's calendars, kept in memory like the rest of the demo. */
export class DemoCalendar {
  private calendarList: CalendarInfo[];
  private events: DemoEvent[];
  private nextId = 1;

  constructor(
    lang: Lang,
    private accountId: string,
    private changed: () => void,
  ) {
    this.calendarList = sampleCalendars(lang, accountId);
    this.events = sampleEvents(lang);
  }

  /** Like the server: the answer goes into the event (and, for real, to the organizer). */
  respond(eventId: string, status: ParticipationStatus) {
    const event = this.events.find((candidate) => candidate.id === eventId);
    if (!event?.invitation) throw new BackendError("not_found", "That invitation is gone.");
    event.invitation.status = status;
    this.changed();
  }

  /** The invitation the demo's mail with an .ics part belongs to. */
  invitation(): MailInvitation | null {
    const event = this.events.find((candidate) => candidate.invitation);
    if (!event?.invitation) return null;
    return {
      ...event.invitation,
      title: event.title,
      start: new Date(event.start).toISOString(),
      allDay: event.allDay,
      cancelled: false,
    };
  }

  share(calendarId: string, personId: string, level: ShareLevel | null) {
    const calendar = this.calendar(calendarId);
    const sharedWith = { ...calendar.sharedWith };
    if (level) sharedWith[personId] = level;
    else delete sharedWith[personId];
    calendar.sharedWith = sharedWith;
    this.changed();
  }

  calendars(): CalendarInfo[] {
    return structuredClone(this.calendarList).sort((a, b) => a.sortOrder - b.sortOrder);
  }

  createCalendar(input: { name: string; color: string | null }): CalendarInfo {
    const calendar: CalendarInfo = {
      id: `cal-${this.nextId++}`,
      accountId: this.accountId,
      name: input.name,
      color: input.color,
      isDefault: false,
      isVisible: true,
      sortOrder: this.calendarList.length,
      mayWrite: true,
      mayDelete: true,
      mayShare: true,
      sharedBy: null,
    };
    this.calendarList.push(calendar);
    this.changed();
    return structuredClone(calendar);
  }

  updateCalendar(id: string, patch: { name?: string; color?: string | null; isVisible?: boolean }) {
    const calendar = this.calendar(id);
    Object.assign(calendar, patch);
    this.changed();
  }

  deleteCalendar(id: string) {
    const calendar = this.calendar(id);
    if (calendar.isDefault && this.calendarList.length === 1) {
      throw new BackendError("invalid_input", "The only calendar stays.");
    }
    this.calendarList = this.calendarList.filter((other) => other.id !== id);
    this.events = this.events.filter((event) => event.calendarId !== id);
    if (calendar.isDefault && this.calendarList[0]) this.calendarList[0].isDefault = true;
    this.changed();
  }

  setDefaultCalendar(id: string) {
    this.calendar(id);
    for (const calendar of this.calendarList) calendar.isDefault = calendar.id === id;
    this.changed();
  }

  occurrences(from: WallTime, to: WallTime): CalendarOccurrence[] {
    const colors = new Map(this.calendarList.map((calendar) => [calendar.id, calendar]));
    const found: CalendarOccurrence[] = [];
    for (const event of this.events) {
      if (!colors.has(event.calendarId)) continue;
      const length = diffMinutes(event.start, event.end);
      const shared = {
        eventId: event.id,
        accountId: this.accountId,
        calendarId: event.calendarId,
        title: event.title,
        description: event.description,
        location: event.location,
        allDay: event.allDay,
        timeZone: null,
        recurrence: event.recurrence ? structuredClone(event.recurrence) : null,
        recurrenceEditable: true,
        readOnly: !colors.get(event.calendarId)!.mayWrite || event.invitation !== undefined,
        color: null,
        invitation: event.invitation ? { ...event.invitation } : null,
      };
      if (!event.recurrence) {
        if (event.start < to && event.end > from) {
          found.push({ ...shared, id: event.id, start: event.start, end: event.end, recurrenceId: null });
        }
        continue;
      }
      for (const start of expandRecurrence(event.start, length, event.recurrence, from, to)) {
        if (event.excluded.includes(start)) continue;
        found.push({
          ...shared,
          id: `${event.id}${SEPARATOR}${start}`,
          start,
          end: addMinutes(start, length),
          recurrenceId: start,
        });
      }
    }
    return found.sort((a, b) => a.start.localeCompare(b.start));
  }

  createEvent(input: EventInput): string {
    this.calendar(input.calendarId);
    const id = `ev-${this.nextId++}`;
    this.events.push({
      id,
      calendarId: input.calendarId,
      title: input.title,
      description: input.description,
      location: input.location.trim(),
      allDay: input.allDay,
      start: input.start,
      end: input.end,
      recurrence: input.recurrence ? this.withWeekday(input.recurrence, input.start) : null,
      excluded: [],
    });
    this.changed();
    return id;
  }

  updateEvent(eventId: string, input: EventInput, occurrenceStart?: string) {
    const event = this.events.find((candidate) => candidate.id === eventId);
    if (!event) throw new BackendError("not_found", "That event is gone.");
    this.calendar(input.calendarId);
    const length = diffMinutes(input.start, input.end);
    let start = input.start;
    if (event.recurrence && occurrenceStart) {
      // The series moves by as much as the edited occurrence did.
      start = input.allDay
        ? withClock(addDays(dateOf(event.start), diffDays(dateOf(occurrenceStart), dateOf(input.start))), "00:00")
        : addMinutes(event.start, diffMinutes(occurrenceStart, input.start));
    }
    Object.assign(event, {
      calendarId: input.calendarId,
      title: input.title,
      description: input.description,
      location: input.location.trim(),
      allDay: input.allDay,
      start,
      end: addMinutes(start, length),
      recurrence: input.recurrence ? this.withWeekday(input.recurrence, start) : null,
    });
    if (!event.recurrence) event.excluded = [];
    this.changed();
  }

  deleteEvent(occurrenceId: string, scope: EventDeleteScope) {
    const [eventId = "", start] = occurrenceId.split(SEPARATOR);
    const event = this.events.find((candidate) => candidate.id === eventId);
    if (!event) throw new BackendError("not_found", "That event is gone.");
    if (scope === "occurrence" && start && event.recurrence) event.excluded.push(start);
    else this.events = this.events.filter((candidate) => candidate !== event);
    this.changed();
  }

  private calendar(id: string): CalendarInfo {
    const calendar = this.calendarList.find((candidate) => candidate.id === id);
    if (!calendar) throw new BackendError("not_found", "That calendar is gone.");
    return calendar;
  }

  /** A weekly rule without days repeats on the start's weekday, like the server does it. */
  private withWeekday(recurrence: Recurrence, start: WallTime): Recurrence {
    if (recurrence.frequency !== "weekly" || recurrence.byDay?.length) return structuredClone(recurrence);
    return { ...recurrence, byDay: [weekdayOf(dateOf(start))] };
  }
}
