// Made-up parcels for the demo, tracked on reserved domains only. They start over with every reload.

import { movesTo } from "@/lib/shipments";
import { BackendError } from "./backend";
import type { Shipment, ShipmentEvent, ShipmentInput, ShipmentPatch } from "./types";

type Lang = "de" | "en";

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** A local date (YYYY-MM-DD) some days from now. */
function dayKey(now: number, days: number): string {
  const date = new Date(now + days * DAY);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** Today at a local wall time, as an instant. */
function todayAt(now: number, hours: number, minutes: number): string {
  const date = new Date(now);
  date.setHours(hours, minutes, 0, 0);
  return date.toISOString();
}

export function sampleShipments(lang: Lang, now: number, pixelPartsMail: string | null): Shipment[] {
  const de = lang === "de";
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const event = (at: string, patch: Partial<ShipmentEvent>): ShipmentEvent => ({
    at,
    status: null,
    text: "",
    location: null,
    source: "mail",
    clientName: null,
    emailId: null,
    ...patch,
  });
  const item = (patch: Partial<Shipment> & Pick<Shipment, "id" | "carrier" | "status">): Shipment => ({
    number: "",
    trackingUrl: null,
    title: null,
    merchant: null,
    orderRef: null,
    statusAt: ago(3 * HOUR),
    expected: null,
    deliveredAt: null,
    pickup: null,
    hidden: false,
    emailIds: [],
    events: [],
    created: ago(3 * DAY),
    updated: patch.statusAt ?? ago(3 * HOUR),
    ...patch,
  });
  return [
    item({
      id: "p1",
      carrier: "dhl",
      number: "00340434161094042557",
      trackingUrl: "https://track.example/dhl/00340434161094042557",
      merchant: "Pixel Parts Shop",
      title: de ? "Keycaps „Bubblegum“" : "“Bubblegum” keycaps",
      orderRef: "UWU-2048",
      status: "outForDelivery",
      statusAt: ago(40 * 60 * 1000),
      expected: { from: todayAt(now, 10, 15), to: todayAt(now, 12, 15), allDay: false },
      emailIds: pixelPartsMail ? [pixelPartsMail] : [],
      events: [
        event(ago(2 * DAY), {
          status: "shipped",
          text: de ? "Versandbestätigung vom Shop" : "Shipping confirmation from the shop",
          emailId: pixelPartsMail,
        }),
        event(ago(DAY + 5 * HOUR), {
          status: "inTransit",
          text: de ? "Im Paketzentrum bearbeitet" : "Processed at the parcel centre",
          location: "Hamburg",
          source: "client",
          clientName: "Home Assistant",
        }),
        event(ago(40 * 60 * 1000), {
          status: "outForDelivery",
          text: de ? "In Zustellung, Zeitfenster 10:15–12:15" : "Out for delivery, window 10:15–12:15",
          source: "client",
          clientName: "Home Assistant",
        }),
      ],
    }),
    item({
      id: "p2",
      carrier: "hermes",
      number: "H1002345678901",
      trackingUrl: "https://track.example/hermes/H1002345678901",
      merchant: "Tierbedarf Schnurr",
      status: "inTransit",
      statusAt: ago(9 * HOUR),
      expected: { from: dayKey(now, 1), to: null, allDay: true },
      events: [
        event(ago(DAY), { status: "shipped", text: de ? "Paket angekündigt" : "Parcel announced" }),
        event(ago(9 * HOUR), {
          status: "inTransit",
          text: de ? "Zustellung morgen erwartet" : "Delivery expected tomorrow",
          source: "ai",
        }),
      ],
    }),
    item({
      id: "p3",
      carrier: "dpd",
      number: "01505012345678",
      trackingUrl: "https://track.example/dpd/01505012345678",
      merchant: "Fahrradladen Speiche",
      title: de ? "Fahrradschloss" : "Bike lock",
      status: "readyForPickup",
      statusAt: ago(20 * HOUR),
      pickup: {
        kind: "parcelShop",
        name: "Kiosk am Markt",
        address: de ? "Marktplatz 3, 12345 Musterstadt" : "3 Market Square, Sampletown",
        until: dayKey(now, 6),
      },
      events: [
        event(ago(2 * DAY), { status: "inTransit", text: de ? "Unterwegs" : "On its way" }),
        event(ago(20 * HOUR), {
          status: "readyForPickup",
          text: de ? "Im Paketshop abholbereit" : "Ready for pickup at the parcel shop",
        }),
      ],
    }),
    item({
      id: "p4",
      carrier: "gls",
      number: "ZK4P8M2Q",
      trackingUrl: "https://track.example/gls/ZK4P8M2Q",
      merchant: "Gartenglück",
      status: "deliveryFailed",
      statusAt: ago(4 * HOUR),
      expected: { from: dayKey(now, 2), to: null, allDay: true },
      events: [
        event(ago(4 * HOUR), {
          status: "deliveryFailed",
          text: de ? "Empfänger nicht angetroffen, neuer Versuch übermorgen" : "Nobody home, next try in two days",
          source: "ai",
        }),
      ],
    }),
    item({
      id: "p5",
      carrier: "amazonLogistics",
      number: "TBA301234567890",
      title: de ? "Geburtstagsgeschenk Leni" : "Birthday present for Leni",
      merchant: "Online-Kaufhaus",
      status: "shipped",
      statusAt: ago(30 * HOUR),
      expected: { from: dayKey(now, 3), to: null, allDay: true },
    }),
    item({
      id: "p6",
      carrier: "other",
      number: "",
      merchant: "Teeladen Blattwerk",
      orderRef: "BW-7719",
      status: "ordered",
      statusAt: ago(5 * HOUR),
    }),
    item({
      id: "p7",
      carrier: "deutschePost",
      number: "RR123456785DE",
      trackingUrl: "https://track.example/post/RR123456785DE",
      merchant: "Buchhandlung Seitenweise",
      status: "delivered",
      statusAt: ago(2 * DAY),
      deliveredAt: ago(2 * DAY),
      events: [
        event(ago(3 * DAY), { status: "shipped", text: de ? "Brief eingeliefert" : "Letter posted" }),
        event(ago(2 * DAY), { status: "delivered", text: de ? "Zugestellt in Briefkasten" : "Delivered to mailbox" }),
      ],
    }),
    item({
      id: "p8",
      carrier: "ups",
      number: "1Z999AA10123456784",
      trackingUrl: "https://track.example/ups/1Z999AA10123456784",
      merchant: "Schuhwerk",
      status: "returned",
      statusAt: ago(4 * DAY),
      events: [
        event(ago(4 * DAY), {
          status: "returned",
          text: de ? "Zurück an den Absender" : "Returned to sender",
        }),
      ],
    }),
    // Delivered too long ago for the list.
    item({
      id: "p9",
      carrier: "dhl",
      number: "00340434161094000011",
      merchant: "Kaffeekuchen",
      status: "delivered",
      statusAt: ago(10 * DAY),
      deliveredAt: ago(10 * DAY),
      created: ago(14 * DAY),
    }),
    item({
      id: "p10",
      carrier: "dpd",
      number: "01505098765432",
      trackingUrl: "https://track.example/dpd/01505098765432",
      merchant: "Kabelkiste",
      title: de ? "Ersatzkabel (schon abgeholt)" : "Spare cable (already collected)",
      status: "inTransit",
      statusAt: ago(2 * DAY),
      hidden: true,
    }),
  ];
}

/** The demo's parcel store, played like the server's `Shipment/*`. */
export class DemoShipments {
  private items: Shipment[];
  private next = 1;

  constructor(
    lang: Lang,
    pixelPartsMail: string | null,
    private changed: () => void,
    now = Date.now(),
  ) {
    this.items = sampleShipments(lang, now, pixelPartsMail);
  }

  /** Like the server's query: not hidden (or only the hidden ones), last changed first. */
  list(hidden = false): Shipment[] {
    return this.items
      .filter((s) => s.hidden === hidden)
      .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
      .map((s) => structuredClone(s));
  }

  create(input: ShipmentInput): string {
    const number = input.number.replace(/\s+/g, "");
    if (!number) throw new BackendError("invalid_input", "number");
    if (this.items.some((s) => s.carrier === input.carrier && s.number === number)) {
      throw new BackendError("invalid_input", "alreadyExists");
    }
    const now = new Date().toISOString();
    const id = `n${this.next++}`;
    this.items.push({
      id,
      carrier: input.carrier,
      number,
      trackingUrl: null,
      title: input.title?.trim() || null,
      merchant: null,
      orderRef: null,
      status: "shipped",
      statusAt: now,
      expected: null,
      deliveredAt: null,
      pickup: null,
      hidden: false,
      emailIds: [],
      events: [
        {
          at: now,
          status: "shipped",
          text: "",
          location: null,
          source: "client",
          clientName: "Webmail",
          emailId: null,
        },
      ],
      created: now,
      updated: now,
    });
    this.changed();
    return id;
  }

  update(id: string, patch: ShipmentPatch) {
    const item = this.find(id);
    if (patch.title !== undefined) item.title = patch.title?.trim() || null;
    if (patch.hidden !== undefined) item.hidden = patch.hidden;
    if (patch.addEvents?.length || patch.removeEvents?.length) {
      const gone = (e: ShipmentEvent) =>
        e.source === "client" && !!patch.removeEvents?.some((r) => r.at === e.at && r.status === e.status);
      const added = (patch.addEvents ?? []).map(
        (e): ShipmentEvent => ({ ...e, text: "", location: null, source: "client", clientName: "Webmail", emailId: null }),
      );
      item.events = [...item.events.filter((e) => !gone(e)), ...added];
      // As the server does: the status follows the events in the order they came.
      let first = true;
      for (const event of item.events) {
        if (!event.status) continue;
        if (first || (Date.parse(event.at) >= Date.parse(item.statusAt ?? "") && movesTo(item.status, event.status))) {
          item.status = event.status;
          item.statusAt = event.at;
          if (first) item.deliveredAt = null;
          if (event.status === "delivered") item.deliveredAt = event.at;
          first = false;
        }
      }
    }
    item.updated = new Date().toISOString();
    this.changed();
  }

  remove(id: string) {
    this.find(id);
    this.items = this.items.filter((s) => s.id !== id);
    this.changed();
  }

  private find(id: string): Shipment {
    const item = this.items.find((s) => s.id === id);
    if (!item) throw new BackendError("not_found", id);
    return item;
  }
}
