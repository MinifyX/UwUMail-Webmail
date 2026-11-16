import { describe, expect, it } from "vitest";
import {
  refreshOutcome,
  SHIPMENTS,
  shipmentCalls,
  shipmentCreate,
  shipmentSetError,
  shipmentsSupport,
  shipmentUpdate,
  toShipment,
  webUrl,
} from "./shipments";

function session(top: boolean, account: boolean, capability: unknown = {}) {
  return {
    accountId: "a1",
    capabilities: top ? { [SHIPMENTS]: {} } : {},
    accounts: {
      a1: {
        name: "mini@uwumail.example",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: account ? { [SHIPMENTS]: capability } : {},
      },
    },
  };
}

describe("JMAP shipments", () => {
  it("is off when the admin switched it off, offered when only the account did, on with both", () => {
    expect(shipmentsSupport(session(false, false))).toEqual({ offered: false, enabled: false, lookupCarriers: [] });
    expect(shipmentsSupport(session(true, false))).toEqual({ offered: true, enabled: false, lookupCarriers: [] });
    expect(shipmentsSupport(session(true, true))).toEqual({ offered: true, enabled: true, lookupCarriers: [] });
    // The account alone doesn't count, nor does an account that isn't there.
    expect(shipmentsSupport(session(false, true)).enabled).toBe(false);
    expect(shipmentsSupport({ ...session(true, true), accountId: "gone" }).enabled).toBe(false);
  });

  it("reads the carriers the server asks itself, known ones only", () => {
    const capability = { maxEvents: 200, lookupCarriers: ["dhl", "deutschePost", "pigeon", 7] };
    expect(shipmentsSupport(session(true, true, capability)).lookupCarriers).toEqual(["dhl", "deutschePost"]);
    expect(shipmentsSupport(session(true, true, { lookupCarriers: "dhl" })).lookupCarriers).toEqual([]);
  });

  it("reads what Shipment/refresh did", () => {
    const response = {
      refreshed: ["s7"],
      notRefreshed: { s8: { type: "tooSoon" }, s9: { type: "notSupported" }, s10: { type: "somethingNew" } },
    };
    expect(refreshOutcome(response, "s7")).toBeNull();
    expect(refreshOutcome(response, "s8")).toBe("tooSoon");
    expect(refreshOutcome(response, "s9")).toBe("notSupported");
    // Unknown or missing reasons read as no answer.
    expect(refreshOutcome(response, "s10")).toBe("unavailable");
    expect(refreshOutcome({}, "s7")).toBe("unavailable");
  });

  it("reads a server shipment and drops what it can't trust", () => {
    const shipment = toShipment({
      id: "s1",
      carrier: "pigeon",
      number: "123",
      trackingUrl: "javascript:alert(1)",
      status: "teleported",
      expected: { from: "2026-11-14", allDay: true },
      emailIds: ["e1", 7],
      events: [
        { at: "2026-11-13T10:00:00Z", status: "inTransit", source: "client", clientName: "Home Assistant" },
        { at: "2026-11-12T10:00:00Z", status: "shipped" },
        { status: "lost" },
      ],
      updated: "2026-11-13T10:00:00Z",
    })!;
    expect(shipment).toMatchObject({ carrier: "other", status: "inTransit", trackingUrl: null, emailIds: ["e1"] });
    expect(shipment.expected).toEqual({ from: "2026-11-14", to: null, allDay: true });
    expect(shipment.events.map((e) => e.status)).toEqual(["shipped", "inTransit"]);
    expect(shipment.events[0]!.source).toBe("mail");
    // Older servers lack the lookup fields.
    expect(shipment).toMatchObject({ shopTrackingUrl: null, lookedUpAt: null, lookupError: null });
    expect(
      toShipment({
        id: "s2",
        shopTrackingUrl: "https://shop.example/track?orderNo=1",
        lookedUpAt: "2026-11-15T08:00:00Z",
        lookupError: "rateLimited",
        events: [{ at: "2026-11-15T08:00:00Z", status: "inTransit", source: "carrier" }],
      }),
    ).toMatchObject({
      shopTrackingUrl: "https://shop.example/track?orderNo=1",
      lookedUpAt: "2026-11-15T08:00:00Z",
      lookupError: "rateLimited",
      events: [{ source: "carrier" }],
    });
    expect(toShipment({ id: "s3", shopTrackingUrl: "javascript:alert(1)", lookupError: "odd" })).toMatchObject({
      shopTrackingUrl: null,
      lookupError: null,
    });
    expect(toShipment({ carrier: "dhl" })).toBeNull();
  });

  it("keeps only web links", () => {
    expect(webUrl("https://track.example/1")).toBe("https://track.example/1");
    expect(webUrl("data:text/html,hi")).toBeNull();
    expect(webUrl("not a url")).toBeNull();
  });

  it("builds the calls", () => {
    const [query, get] = shipmentCalls("a1") as [[string, object, string], [string, object, string]];
    expect(query[0]).toBe("Shipment/query");
    expect(query[1]).toMatchObject({ filter: { hidden: false }, limit: 100 });
    expect(get[1]).toMatchObject({ "#ids": { resultOf: "q", path: "/ids" } });
    expect(shipmentCalls("a1", true)[0]![1]).toMatchObject({ filter: { hidden: true } });
    expect(shipmentCreate({ carrier: "dpd", number: " 0150 5012 ", title: " " })).toEqual({
      carrier: "dpd",
      number: "01505012",
    });
    expect(shipmentUpdate({ title: "" })).toEqual({ title: null });
    expect(shipmentUpdate({ hidden: true })).toEqual({ hidden: true });
    const mark = { at: "2026-11-15T10:00:00Z", status: "delivered" as const };
    expect(shipmentUpdate({ addEvents: [mark] })).toEqual({ addEvents: [mark] });
    expect(shipmentUpdate({ removeEvents: [mark], addEvents: [] })).toEqual({ removeEvents: [mark] });
    expect(shipmentSetError({ type: "notFound" }).code).toBe("not_found");
    expect(shipmentSetError({ type: "alreadyExists" }).code).toBe("invalid_input");
  });
});
