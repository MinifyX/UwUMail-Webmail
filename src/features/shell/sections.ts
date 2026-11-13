import { ICONS } from "@uwusuite/design";
import type { AppSection } from "@/state/ui";
import { useCalendarsAvailable } from "../calendar/useCalendarData";
import { useContactsAvailable } from "../contacts/useContactsData";

export const SECTIONS: { id: AppSection; icon: typeof ICONS.mail }[] = [
  { id: "mail", icon: ICONS.mail },
  { id: "calendar", icon: ICONS.calendar },
  { id: "contacts", icon: ICONS.contacts },
];

/** The sections the server offers besides mail. */
export function useAvailableSections(): AppSection[] {
  const { data: calendar = false } = useCalendarsAvailable();
  const { data: contacts = false } = useContactsAvailable();
  return SECTIONS.map((s) => s.id).filter(
    (id) => id === "mail" || (id === "calendar" && calendar) || (id === "contacts" && contacts),
  );
}
