import { ICONS } from "@uwusuite/design";
// shortcut: lucide's Package, the Design vocabulary has no parcel icon yet; swap once it has one.
import { Package } from "lucide-react";
import type { AppSection } from "@/state/ui";
import { useCalendarsAvailable } from "../calendar/useCalendarData";
import { useContactsAvailable } from "../contacts/useContactsData";
import { useShipmentsAvailable } from "../shipments/useShipments";

export const SECTIONS: { id: AppSection; icon: typeof ICONS.mail }[] = [
  { id: "mail", icon: ICONS.mail },
  { id: "calendar", icon: ICONS.calendar },
  { id: "contacts", icon: ICONS.contacts },
  { id: "shipments", icon: Package },
];

/** The sections the server offers besides mail. */
export function useAvailableSections(): AppSection[] {
  const { data: calendar = false } = useCalendarsAvailable();
  const { data: contacts = false } = useContactsAvailable();
  const { data: shipments = false } = useShipmentsAvailable();
  const offered: Record<AppSection, boolean> = { mail: true, calendar, contacts, shipments };
  return SECTIONS.map((s) => s.id).filter((id) => offered[id]);
}
