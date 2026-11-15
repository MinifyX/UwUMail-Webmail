import { describe, expect, it } from "vitest";
import {
  SHIPMENTS,
  shipmentCalls,
  shipmentCreate,
  shipmentSetError,
  shipmentsSupport,
  shipmentUpdate,
  toShipment,
  webUrl,
} from "./shipments";

function session(top: boolean, account: boolean) {
  return {
    accountId: "a1",
    capabilities: top ? { [SHIPMENTS]: {} } : {},
    accounts: {
      a1: {
        name: "mini@uwumail.example",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: account ? { [SHIPMENTS]: {} } : {},
      },
    },
  };
}

describe("JMAP shipments", () => {
  it("is off when the admin switched it off, offered when only the account did, on with both", () => {
    expect(shipmentsSupport(session(false, false))).toEqual({ offered: false, enabled: false });
    expect(shipmentsSupport(session(true, false))).toEqual({ offered: true, enabled: false });
    expect(shipmentsSupport(session(true, true))).toEqual({ offered: true, enabled: true });
    // The account alone doesn't count, nor does an account that isn't there.
    expect(shipmentsSupport(session(false, true)).enabled).toBe(false);
    expect(shipmentsSupport({ ...session(true, true), accountId: "gone" }).enabled).toBe(false);
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
    expect(shipmentSetError({ type: "notFound" }).code).toBe("not_found");
    expect(shipmentSetError({ type: "alreadyExists" }).code).toBe("invalid_input");
  });
});
