/**
 * Parcels over UwUMail's JMAP extension `urn:uwumail:jmap:shipments` (`Shipment/query`, `/get`,
 * `/set`). The server finds them in shipping mails; clients like Home Assistant write the live
 * status back. See the server's docs/jmap-shipments.md.
 */

import { BackendError } from "../backend";
import type { JmapSession } from "./client";
import type {
  Shipment,
  ShipmentCarrier,
  ShipmentEvent,
  ShipmentInput,
  ShipmentPatch,
  ShipmentPickup,
  ShipmentStatus,
  ShipmentsSupport,
} from "../types";

export const SHIPMENTS = "urn:uwumail:jmap:shipments";

/** The UserSettings key of the account's switch: "on" or "off", absent is on. */
export const SHIPMENTS_SETTING = "shipments";

/**
 * Offered when the session names the extension at all (the admin allows it), enabled when the own
 * account carries it too (the account kept it on). Only then are there parcels to ask for.
 */
export function shipmentsSupport(
  session: Pick<JmapSession, "capabilities" | "accounts" | "accountId">,
): ShipmentsSupport {
  const offered = SHIPMENTS in session.capabilities;
  const account = session.accounts[session.accountId];
  return { offered, enabled: offered && !!account && SHIPMENTS in account.accountCapabilities };
}

/** Parcels one list shows at most; the most recently changed ones. */
export const SHIPMENTS_LIMIT = 100;

export const CARRIERS: readonly ShipmentCarrier[] = [
  "dhl",
  "deutschePost",
  "dpd",
  "hermes",
  "gls",
  "ups",
  "amazonLogistics",
  "fedex",
  "other",
];

export const STATUSES: readonly ShipmentStatus[] = [
  "ordered",
  "shipped",
  "inTransit",
  "outForDelivery",
  "delivered",
  "readyForPickup",
  "deliveryFailed",
  "returned",
  "cancelled",
];

const PICKUP_KINDS: readonly ShipmentPickup["kind"][] = ["packstation", "postOffice", "parcelShop", "accessPoint"];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const textOrNull = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const oneOf = <T extends string>(list: readonly T[], value: unknown): T | null =>
  list.includes(value as T) ? (value as T) : null;

/** Only web links open from a card; anything else the server passes on is dropped. */
export function webUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function eventOf(value: unknown): ShipmentEvent | null {
  if (!isObject(value) || typeof value.at !== "string") return null;
  return {
    at: value.at,
    status: oneOf(STATUSES, value.status),
    text: text(value.text),
    location: textOrNull(value.location),
    source: text(value.source) || "mail",
    clientName: textOrNull(value.clientName),
    emailId: textOrNull(value.emailId),
  };
}

function pickupOf(value: unknown): ShipmentPickup | null {
  if (!isObject(value)) return null;
  const kind = oneOf(PICKUP_KINDS, value.kind) ?? "parcelShop";
  return { kind, name: text(value.name), address: text(value.address), until: textOrNull(value.until) };
}

/** One `Shipment` as the server sends it; null when it lacks its id. */
export function toShipment(value: unknown): Shipment | null {
  if (!isObject(value) || typeof value.id !== "string") return null;
  const expected = isObject(value.expected) && typeof value.expected.from === "string" ? value.expected : null;
  const events = (Array.isArray(value.events) ? value.events : [])
    .map(eventOf)
    .filter((event): event is ShipmentEvent => event !== null)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const updated = text(value.updated) || text(value.statusAt) || new Date(0).toISOString();
  return {
    id: value.id,
    carrier: oneOf(CARRIERS, value.carrier) ?? "other",
    number: text(value.number),
    trackingUrl: webUrl(value.trackingUrl),
    title: textOrNull(value.title),
    merchant: textOrNull(value.merchant),
    orderRef: textOrNull(value.orderRef),
    // A status this webmail doesn't know yet still means the parcel is on its way.
    status: oneOf(STATUSES, value.status) ?? "inTransit",
    statusAt: textOrNull(value.statusAt),
    expected: expected
      ? { from: expected.from as string, to: textOrNull(expected.to), allDay: expected.allDay === true }
      : null,
    deliveredAt: textOrNull(value.deliveredAt),
    pickup: pickupOf(value.pickup),
    hidden: value.hidden === true,
    emailIds: (Array.isArray(value.emailIds) ? value.emailIds : []).filter(
      (id): id is string => typeof id === "string",
    ),
    events,
    created: text(value.created) || updated,
    updated,
  };
}

/** The calls for the list: the parcels not hidden (or only the hidden ones), newest change first, fetched in the same go. */
export function shipmentCalls(accountId: string, hidden = false): [string, Json, string][] {
  return [
    [
      "Shipment/query",
      {
        accountId,
        filter: { hidden },
        sort: [{ property: "updated", isAscending: false }],
        limit: SHIPMENTS_LIMIT,
      },
      "q",
    ],
    ["Shipment/get", { accountId, "#ids": { resultOf: "q", name: "Shipment/query", path: "/ids" } }, "g"],
  ];
}

/** The create object: only carrier, number and an own name; the server fills in the rest. */
export function shipmentCreate(input: ShipmentInput): Json {
  const title = input.title?.trim();
  return { carrier: input.carrier, number: input.number.replace(/\s+/g, ""), ...(title ? { title } : {}) };
}

/** The update, with only what the patch names; an empty title goes back to the shop. */
export function shipmentUpdate(patch: ShipmentPatch): Json {
  const out: Json = {};
  if (patch.title !== undefined) out.title = patch.title?.trim() || null;
  if (patch.hidden !== undefined) out.hidden = patch.hidden;
  if (patch.addEvents?.length) out.addEvents = patch.addEvents.map(({ at, status }) => ({ at, status }));
  if (patch.removeEvents?.length) out.removeEvents = patch.removeEvents.map(({ at, status }) => ({ at, status }));
  return out;
}

/** A refused create, update or destroy, in the codes the view explains. */
export function shipmentSetError(problem: { type: string; description?: string }): BackendError {
  const description = problem.description ?? problem.type;
  if (problem.type === "notFound") return new BackendError("not_found", description);
  if (problem.type === "invalidProperties" || problem.type === "alreadyExists") {
    return new BackendError("invalid_input", description);
  }
  if (problem.type === "forbidden" || problem.type === "overQuota") return new BackendError("forbidden", description);
  return new BackendError("internal", description);
}
