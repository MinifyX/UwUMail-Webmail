import { describe, expect, it } from "vitest";
import type { CalendarInfo, EventInput } from "../types";
import {
  eventPatch,
  fromRecurrence,
  newEventObject,
  safeColor,
  toCalendarInfo,
  toOccurrence,
  toRecurrence,
  type JmapCalendarEvent,
} from "./calendar";

const calendar: CalendarInfo = {
  id: "c1",
  accountId: "a",
  name: "Home",
  color: "#ff4d8d",
  isDefault: true,
  isVisible: true,
  sortOrder: 0,
  mayWrite: true,
  mayDelete: true,
};

const context = { accountId: "a", viewerZone: "Europe/Berlin", calendar, base: undefined };

const event = (patch: Partial<JmapCalendarEvent>): JmapCalendarEvent => ({
  id: "e1",
  calendarIds: { c1: true },
  title: "Yoga",
  description: "",
  start: "2026-09-22T18:30:00",
  duration: "PT1H",
  timeZone: "Europe/Berlin",
  showWithoutTime: false,
  ...patch,
});

const input = (patch: Partial<EventInput>): EventInput => ({
  calendarId: "c1",
  title: "Yoga",
  description: "",
  location: "",
  allDay: false,
  start: "2026-09-22T18:30:00",
  end: "2026-09-22T19:30:00",
  timeZone: "Europe/Berlin",
  recurrence: null,
  ...patch,
});

describe("recurrence mapping", () => {
  it("reads the rules the editor can describe", () => {
    expect(
      toRecurrence({
        recurrenceRule: {
          "@type": "RecurrenceRule",
          frequency: "weekly",
          interval: 2,
          byDay: [
            { "@type": "NDay", day: "tu" },
            { "@type": "NDay", day: "th" },
          ],
          until: "2026-12-31T23:59:59",
          rscale: "gregorian",
          skip: "omit",
          firstDayOfWeek: "mo",
        },
      }),
    ).toEqual({
      recurrence: { frequency: "weekly", interval: 2, byDay: ["tu", "th"], until: "2026-12-31", count: null },
      editable: true,
    });
    expect(toRecurrence({ recurrenceRule: { frequency: "monthly", count: 5 } })).toEqual({
      recurrence: { frequency: "monthly", interval: 1, byDay: null, until: null, count: 5 },
      editable: true,
    });
    expect(toRecurrence({ recurrenceRule: null })).toEqual({ recurrence: null, editable: true });
  });

  it("marks what it can't describe as not editable, but still as repeating", () => {
    const cases = [
      { frequency: "monthly", byMonthDay: [1, 15] },
      { frequency: "monthly", byDay: [{ day: "mo", nthOfPeriod: 1 }] },
      { frequency: "daily", byDay: [{ day: "mo" }] },
      { frequency: "hourly", interval: 4 },
      { frequency: "weekly", firstDayOfWeek: "su" },
      { frequency: "yearly", rscale: "hebrew" },
    ];
    for (const rule of cases) {
      const read = toRecurrence({ recurrenceRule: rule });
      expect(read.editable, JSON.stringify(rule)).toBe(false);
      expect(read.recurrence).not.toBeNull();
    }
    expect(toRecurrence({ recurrenceRules: [{ frequency: "daily" }, { frequency: "weekly" }] }).editable).toBe(false);
    expect(
      toRecurrence({ recurrenceRule: { frequency: "daily" }, excludedRecurrenceRules: [{ frequency: "weekly" }] })
        .editable,
    ).toBe(false);
  });

  it("writes rules back the way it reads them", () => {
    const recurrence = {
      frequency: "weekly" as const,
      interval: 1,
      byDay: ["mo" as const, "we" as const],
      until: "2027-01-31",
      count: null,
    };
    const rule = fromRecurrence(recurrence);
    expect(rule).toEqual({
      "@type": "RecurrenceRule",
      frequency: "weekly",
      interval: 1,
      byDay: [
        { "@type": "NDay", day: "mo" },
        { "@type": "NDay", day: "we" },
      ],
      until: "2027-01-31T23:59:59",
    });
    expect(toRecurrence({ recurrenceRule: rule })).toEqual({ recurrence, editable: true });
    expect(fromRecurrence({ frequency: "yearly", interval: 1, byDay: ["mo"], until: null, count: 3 })).toEqual({
      "@type": "RecurrenceRule",
      frequency: "yearly",
      interval: 1,
      count: 3,
    });
  });
});

describe("toOccurrence", () => {
  it("shows a timed event in the viewer's zone from utcStart and utcEnd", () => {
    const occurrence = toOccurrence(
      event({
        start: "2026-09-22T12:30:00",
        timeZone: "America/New_York",
        utcStart: "2026-09-22T16:30:00Z",
        utcEnd: "2026-09-22T17:30:00Z",
        locations: { l: { name: "Studio" } },
        color: "#00AA00",
      }),
      context,
    );
    expect(occurrence).toMatchObject({
      start: "2026-09-22T18:30:00",
      end: "2026-09-22T19:30:00",
      timeZone: "America/New_York",
      location: "Studio",
      color: "#00aa00",
      allDay: false,
      readOnly: false,
    });
  });

  it("works out the times itself when the server leaves out the UTC ones", () => {
    const occurrence = toOccurrence(
      event({ start: "2026-09-22T09:00:00", timeZone: "UTC", duration: "PT45M" }),
      context,
    );
    expect(occurrence.start).toBe("2026-09-22T11:00:00");
    expect(occurrence.end).toBe("2026-09-22T11:45:00");
  });

  it("gives all-day events whole days with an exclusive end", () => {
    const occurrence = toOccurrence(
      event({ start: "2026-09-25T00:00:00", duration: "P2D", showWithoutTime: true, timeZone: null }),
      context,
    );
    expect(occurrence).toMatchObject({ allDay: true, start: "2026-09-25T00:00:00", end: "2026-09-27T00:00:00" });
  });

  it("takes the rule from the series for an expanded instance", () => {
    const occurrence = toOccurrence(
      event({ id: "e1~1", baseEventId: "e1", recurrenceId: "2026-09-29T18:30:00", recurrenceRule: null }),
      { ...context, base: event({ recurrenceRule: { frequency: "weekly" } }) },
    );
    expect(occurrence.eventId).toBe("e1");
    expect(occurrence.recurrenceId).toBe("2026-09-29T18:30:00");
    expect(occurrence.recurrence?.frequency).toBe("weekly");
  });

  it("is read-only in a calendar without write rights and for other people's invitations", () => {
    expect(toOccurrence(event({}), { ...context, calendar: { ...calendar, mayWrite: false } }).readOnly).toBe(true);
    expect(toOccurrence(event({ isOrigin: false }), context).readOnly).toBe(true);
  });
});

describe("newEventObject", () => {
  it("creates timed events in the device's zone with an exact duration", () => {
    expect(newEventObject(input({ location: " Studio ", end: "2026-09-22T20:00:00" }), "Europe/Berlin")).toEqual({
      "@type": "Event",
      calendarIds: { c1: true },
      title: "Yoga",
      description: "",
      showWithoutTime: false,
      start: "2026-09-22T18:30:00",
      duration: "PT1H30M",
      timeZone: "Europe/Berlin",
      locations: { loc1: { "@type": "Location", name: "Studio" } },
    });
  });

  it("keeps all-day events floating and counts whole days", () => {
    expect(
      newEventObject(
        input({ allDay: true, start: "2026-09-25T00:00:00", end: "2026-09-27T00:00:00", timeZone: null }),
        "Europe/Berlin",
      ),
    ).toMatchObject({ showWithoutTime: true, start: "2026-09-25T00:00:00", duration: "P2D", timeZone: null });
  });

  it("counts a duration across the daylight saving change exactly", () => {
    const object = newEventObject(input({ start: "2026-10-24T22:00:00", end: "2026-10-25T06:00:00" }), "Europe/Berlin");
    // The night the clocks go back is an hour longer.
    expect(object.duration).toBe("PT9H");
  });
});

describe("eventPatch", () => {
  it("sends nothing when nothing changed, even for an event kept in another zone", () => {
    const stored = event({ start: "2026-09-22T12:30:00", timeZone: "America/New_York" });
    expect(eventPatch(stored, input({}), "Europe/Berlin")).toEqual({});
  });

  it("sends only the fields that changed", () => {
    expect(
      eventPatch(
        event({}),
        input({ title: "Yin Yoga", location: "Hall 2", end: "2026-09-22T20:00:00" }),
        "Europe/Berlin",
      ),
    ).toEqual({
      title: "Yin Yoga",
      locations: { loc1: { "@type": "Location", name: "Hall 2" } },
      duration: "PT1H30M",
    });
  });

  it("moves a single event to the new time in the device's zone", () => {
    expect(
      eventPatch(
        event({ start: "2026-09-22T12:30:00", timeZone: "America/New_York" }),
        input({ start: "2026-09-23T09:00:00", end: "2026-09-23T10:00:00" }),
        "Europe/Berlin",
      ),
    ).toEqual({ start: "2026-09-23T09:00:00", timeZone: "Europe/Berlin" });
  });

  it("shifts a series by as much as the edited occurrence moved", () => {
    const series = event({ start: "2026-09-01T18:30:00", recurrenceRule: { frequency: "weekly" } });
    const recurrence = { frequency: "weekly" as const, interval: 1, byDay: null, until: null, count: null };
    expect(
      eventPatch(
        series,
        input({ start: "2026-09-22T19:00:00", end: "2026-09-22T20:00:00", recurrence }),
        "Europe/Berlin",
        "2026-09-22T18:30:00",
      ),
    ).toEqual({ start: "2026-09-01T19:00:00" });
  });

  it("changes and removes the rule", () => {
    const series = event({ recurrenceRule: { frequency: "weekly" } });
    expect(
      eventPatch(
        series,
        input({ recurrence: { frequency: "daily", interval: 1, byDay: null, until: null, count: 10 } }),
        "Europe/Berlin",
        "2026-09-22T18:30:00",
      ),
    ).toEqual({ recurrenceRule: { "@type": "RecurrenceRule", frequency: "daily", interval: 1, count: 10 } });
    expect(eventPatch(series, input({ recurrence: null }), "Europe/Berlin", "2026-09-22T18:30:00")).toEqual({
      recurrenceRule: null,
      recurrenceOverrides: null,
    });
  });

  it("leaves a rule it can't describe alone", () => {
    const series = event({ recurrenceRule: { frequency: "monthly", byMonthDay: [1, 15] } });
    expect(
      eventPatch(series, input({ title: "Rent", recurrence: null }), "Europe/Berlin", "2026-09-22T18:30:00"),
    ).toEqual({
      title: "Rent",
    });
  });

  it("turns a timed event into an all-day one and back", () => {
    expect(
      eventPatch(
        event({}),
        input({ allDay: true, start: "2026-09-22T00:00:00", end: "2026-09-23T00:00:00", timeZone: null }),
        "Europe/Berlin",
      ),
    ).toEqual({ showWithoutTime: true, timeZone: null, start: "2026-09-22T00:00:00", duration: "P1D" });
    expect(
      eventPatch(
        event({ showWithoutTime: true, start: "2026-09-22T00:00:00", duration: "P1D", timeZone: null }),
        input({}),
        "Europe/Berlin",
      ),
    ).toEqual({ showWithoutTime: false, start: "2026-09-22T18:30:00", timeZone: "Europe/Berlin", duration: "PT1H" });
  });

  it("moves an event to another calendar", () => {
    expect(eventPatch(event({}), input({ calendarId: "c2" }), "Europe/Berlin")).toEqual({ calendarIds: { c2: true } });
  });
});

describe("calendars", () => {
  it("reads rights and colours defensively", () => {
    expect(
      toCalendarInfo(
        { id: "c", name: "Shared", color: "#FF4D8DFF", myRights: { mayWriteAll: false, mayDelete: false } },
        "a",
      ),
    ).toMatchObject({ color: "#ff4d8d", mayWrite: false, mayDelete: false, isVisible: true, isDefault: false });
    expect(toCalendarInfo({ id: "c", name: "Own" }, "a")).toMatchObject({ mayWrite: true, mayDelete: true });
    expect(safeColor("red; background: url(x)")).toBeNull();
    expect(safeColor("#abc")).toBe("#aabbcc");
  });
});
