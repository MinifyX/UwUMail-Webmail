import { describe, expect, it } from "vitest";
import { assistFeaturesFrom, extractedEventsFrom, imageTextFrom } from "./eventSources";

describe("imageTextFrom", () => {
  it("takes the contract's answer and drops empty pictures", () => {
    expect(
      imageTextFrom({
        accountId: "a",
        emailId: "e",
        unavailable: false,
        images: [
          { source: "cid:poster@shop.example", text: "Sa 17.10.", width: 420, height: 560 },
          { source: "blob:b1", text: "  ", width: 10, height: 10 },
        ],
        skipped: 2,
      }),
    ).toEqual({
      unavailable: false,
      images: [{ source: "cid:poster@shop.example", text: "Sa 17.10.", width: 420, height: 560 }],
      skipped: 2,
    });
  });

  it("survives nonsense and bounds what it keeps", () => {
    expect(imageTextFrom(null)).toEqual({ unavailable: false, images: [], skipped: 0 });
    expect(imageTextFrom({ unavailable: true, images: "x", skipped: -3 })).toEqual({
      unavailable: true,
      images: [],
      skipped: 0,
    });
    const many = { images: Array.from({ length: 80 }, () => ({ source: "blob:x", text: "a".repeat(30_000) })) };
    const result = imageTextFrom(many);
    expect(result.images).toHaveLength(50);
    expect(result.images[0]!.text).toHaveLength(20_000);
  });
});

describe("assistFeaturesFrom", () => {
  it("reads the flags, false unless true", () => {
    expect(assistFeaturesFrom({ features: { extractEvents: true, compose: "yes" } })).toEqual({
      compose: false,
      summarize: false,
      spamCheck: false,
      extractEvents: true,
      autoLabels: false,
    });
    expect(assistFeaturesFrom(null)).toBeNull();
  });
});

describe("extractedEventsFrom", () => {
  it("keeps valid events and fills the gaps", () => {
    expect(
      extractedEventsFrom({
        events: [
          {
            title: "Prime Day",
            start: "2026-10-06T00:00:00",
            end: "2026-10-10T00:00:00",
            allDay: true,
            timeZone: null,
            location: "",
            description: null,
            url: "https://shop.example/deals",
            participants: [{ name: "Leni", email: "leni@wanders.example" }],
            confidence: 1.4,
            quote: "vom 6. – 9. Okt",
          },
          { title: "Broken", start: "tomorrow", end: "2026-10-10T00:00:00" },
          { title: "Backwards", start: "2026-10-10T10:00:00", end: "2026-10-10T09:00:00" },
          { title: "Short", start: "2026-10-10T10:00", end: "2026-10-10T11:00" },
        ],
      }),
    ).toEqual([
      {
        title: "Prime Day",
        start: "2026-10-06T00:00:00",
        end: "2026-10-10T00:00:00",
        allDay: true,
        timeZone: null,
        location: null,
        description: null,
        url: "https://shop.example/deals",
        participants: [{ name: "Leni", email: "leni@wanders.example" }],
        confidence: 1,
        quote: "vom 6. – 9. Okt",
      },
      {
        title: "Short",
        start: "2026-10-10T10:00:00",
        end: "2026-10-10T11:00:00",
        allDay: false,
        timeZone: null,
        location: null,
        description: null,
        url: null,
        participants: [],
        confidence: 0.5,
        quote: "",
      },
    ]);
  });

  it("keeps at most twenty", () => {
    const event = { title: "x", start: "2026-10-10T10:00:00", end: "2026-10-10T11:00:00" };
    expect(extractedEventsFrom({ events: Array.from({ length: 40 }, () => event) })).toHaveLength(20);
  });
});
