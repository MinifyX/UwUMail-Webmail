import { describe, expect, it } from "vitest";
import type { Shipment } from "@/backend/types";
import { agoText, dayOf, groupShipments, markable, markNow, shipmentOfMail, stepOf } from "./shipments";

const now = new Date(2026, 10, 14, 9, 0);
const at = (days: number) => new Date(now.getTime() + days * 86_400_000).toISOString();
const parcel = (id: string, patch: Partial<Shipment>): Shipment => ({
  id,
  carrier: "dhl",
  number: id,
  trackingUrl: null,
  shopTrackingUrl: null,
  title: null,
  merchant: null,
  orderRef: null,
  status: "inTransit",
  statusAt: null,
  expected: null,
  deliveredAt: null,
  pickup: null,
  hidden: false,
  emailIds: [],
  events: [],
  lookedUpAt: null,
  lookupError: null,
  created: at(-5),
  updated: at(-1),
  ...patch,
});

describe("shipments", () => {
  it("puts parcels into today, on the way and the last week", () => {
    const groups = groupShipments(
      [
        parcel("late", {}),
        parcel("soon", { expected: { from: "2026-11-15", to: null, allDay: true } }),
        parcel("today", { expected: { from: "2026-11-14", to: null, allDay: true } }),
        parcel("van", { status: "outForDelivery" }),
        parcel("old", { status: "delivered", deliveredAt: at(-8) }),
        parcel("new", { status: "delivered", deliveredAt: at(-1) }),
        parcel("back", { status: "returned", statusAt: at(-2) }),
        parcel("gone", { hidden: true }),
      ],
      now,
    );
    expect(groups.today.map((s) => s.id)).toEqual(["today", "van"]);
    expect(groups.onTheWay.map((s) => s.id)).toEqual(["soon", "late"]);
    expect(groups.delivered.map((s) => s.id)).toEqual(["new", "back"]);
  });

  it("knows the step and the day", () => {
    expect(stepOf("ordered")).toBe(0);
    expect(stepOf("readyForPickup")).toBe(3);
    expect(stepOf("delivered")).toBe(4);
    expect(dayOf("2026-11-14")).toBe("2026-11-14");
    expect(dayOf(new Date(2026, 10, 14, 23, 30).toISOString())).toBe("2026-11-14");
  });

  it("finds the parcel of a mail", () => {
    const list = [parcel("a", { emailIds: ["m1"] }), parcel("b", { emailIds: ["m2"], hidden: true })];
    expect(shipmentOfMail(list, "m1")?.id).toBe("a");
    expect(shipmentOfMail(list, "m2")).toBeNull();
  });
});

describe("marking by hand", () => {
  it("offers what the server takes", () => {
    expect(markable("ordered")).toEqual([
      "shipped",
      "inTransit",
      "outForDelivery",
      "delivered",
      "readyForPickup",
      "deliveryFailed",
      "returned",
      "cancelled",
    ]);
    expect(markable("readyForPickup")).toEqual(["delivered", "deliveryFailed", "returned", "cancelled"]);
    expect(markable("deliveryFailed")).toEqual([
      "shipped",
      "inTransit",
      "outForDelivery",
      "delivered",
      "readyForPickup",
      "returned",
      "cancelled",
    ]);
    expect(markable("delivered")).toEqual(["readyForPickup", "deliveryFailed", "returned", "cancelled"]);
    expect(markNow()).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  });

  it("says how long ago the carrier was asked", () => {
    const base = Date.parse("2026-11-16T12:00:00Z");
    expect(agoText("2026-11-16T11:59:40Z", "en", base)).toBe("this minute");
    expect(agoText("2026-11-16T11:35:00Z", "en", base)).toBe("25 minutes ago");
    expect(agoText("2026-11-16T09:00:00Z", "de", base)).toBe("vor 3 Stunden");
    expect(agoText("2026-11-15T10:00:00Z", "en", base)).toBe("yesterday");
  });
});
