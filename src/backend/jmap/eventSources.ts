/**
 * What the server adds to finding appointments in mail: the text in a mail's pictures (contract
 * C1, `urn:uwumail:jmap:imagetext`) and the assistant's reading of a mail (contract C2,
 * `urn:uwumail:jmap:assist`). Both answers are checked and bounded before the reader sees them.
 */

import { isWallTime } from "@/lib/calendarDates";
import type { AssistFeatures, AssistEvent, ImageText, ImageTextResult } from "../types";

// contract C1
export const IMAGETEXT = "urn:uwumail:jmap:imagetext";
// contract C2
export const ASSIST = "urn:uwumail:jmap:assist";

const MAX_IMAGES = 50;
const MAX_IMAGE_TEXT = 20_000;
const MAX_EVENTS = 20;
const MAX_FIELD = 500;
const MAX_DESCRIPTION = 5_000;

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");
const nullableText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.slice(0, max) : null;
const count = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;

// contract C1
export function imageTextFrom(response: unknown): ImageTextResult {
  const body = (response ?? {}) as Record<string, unknown>;
  const images: ImageText[] = (Array.isArray(body.images) ? body.images : [])
    .slice(0, MAX_IMAGES)
    .filter((image): image is Record<string, unknown> => typeof image === "object" && image !== null)
    .map((image) => ({
      source: text(image.source, 2048),
      text: text(image.text, MAX_IMAGE_TEXT),
      width: count(image.width),
      height: count(image.height),
    }))
    .filter((image) => image.text.trim() !== "");
  return { unavailable: body.unavailable === true, images, skipped: count(body.skipped) };
}

// contract C2
export function assistFeaturesFrom(capability: unknown): AssistFeatures | null {
  if (typeof capability !== "object" || capability === null) return null;
  const features = (capability as { features?: unknown }).features;
  const flags = (typeof features === "object" && features !== null ? features : {}) as Record<string, unknown>;
  return {
    compose: flags.compose === true,
    summarize: flags.summarize === true,
    spamCheck: flags.spamCheck === true,
    extractEvents: flags.extractEvents === true,
    autoLabels: flags.autoLabels === true,
  };
}

/** A LocalDateTime as the server may write it ("2026-10-06T00:00", with seconds or without). */
function localDateTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const wall = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value.slice(0, 19);
  return isWallTime(wall) ? wall : null;
}

// contract C2
export function extractedEventsFrom(response: unknown): AssistEvent[] {
  const body = (response ?? {}) as Record<string, unknown>;
  const events: AssistEvent[] = [];
  for (const raw of (Array.isArray(body.events) ? body.events : []).slice(0, MAX_EVENTS)) {
    if (typeof raw !== "object" || raw === null) continue;
    const event = raw as Record<string, unknown>;
    const start = localDateTime(event.start);
    const end = localDateTime(event.end);
    if (!start || !end || end < start) continue;
    const confidence = typeof event.confidence === "number" ? Math.min(1, Math.max(0, event.confidence)) : 0.5;
    events.push({
      title: text(event.title, MAX_FIELD).trim(),
      start,
      end,
      allDay: event.allDay === true,
      timeZone: nullableText(event.timeZone, 64),
      location: nullableText(event.location, MAX_FIELD),
      description: nullableText(event.description, MAX_DESCRIPTION),
      url: nullableText(event.url, 2048),
      participants: (Array.isArray(event.participants) ? event.participants : [])
        .slice(0, 50)
        .filter((person): person is Record<string, unknown> => typeof person === "object" && person !== null)
        .map((person) => ({ name: text(person.name, 200), email: text(person.email, 254) })),
      confidence: Number.isNaN(confidence) ? 0.5 : confidence,
      quote: text(event.quote, 1000),
    });
  }
  return events;
}
