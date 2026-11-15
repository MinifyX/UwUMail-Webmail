import { describe, expect, it, vi } from "vitest";
import { groupShipments } from "@/lib/shipments";
import { DemoShipments, sampleShipments } from "./demo-shipments";

describe("demo parcels", () => {
  it("fills every section and links the Pixel Parts mail", () => {
    const now = new Date(2026, 10, 14, 9, 0);
    const shipments = sampleShipments("de", now.getTime(), "msg-7");
    const groups = groupShipments(shipments, now);
    expect(groups.today.map((s) => s.id)).toEqual(["p1"]);
    expect(groups.onTheWay.map((s) => s.id)).toEqual(["p2", "p4", "p5", "p6", "p3"]);
    // The one delivered ten days ago is gone.
    expect(groups.delivered.map((s) => s.id)).toEqual(["p7", "p8"]);
    expect(shipments[0]!.emailIds).toEqual(["msg-7"]);
    for (const s of shipments) if (s.trackingUrl) expect(new URL(s.trackingUrl).hostname).toBe("track.example");
  });

  it("creates, renames, hides and deletes", () => {
    const changed = vi.fn();
    const store = new DemoShipments("en", null, changed);
    const id = store.create({ carrier: "dhl", number: " 1234 5678 ", title: "Lamp" });
    expect(store.list().find((s) => s.id === id)).toMatchObject({ number: "12345678", title: "Lamp" });
    expect(() => store.create({ carrier: "dhl", number: "12345678" })).toThrow();
    expect(() => store.create({ carrier: "dhl", number: "  " })).toThrow();

    store.update(id, { title: "  " });
    expect(store.list().find((s) => s.id === id)!.title).toBeNull();
    store.update(id, { hidden: true });
    expect(store.list().some((s) => s.id === id)).toBe(false);
    expect(store.list(true).map((s) => s.id)).toEqual([id, "p10"]);
    store.update(id, { hidden: false });
    store.remove(id);
    expect(store.list().some((s) => s.id === id)).toBe(false);
    expect(() => store.remove(id)).toThrow();
    expect(changed).toHaveBeenCalledTimes(5);
  });
});
