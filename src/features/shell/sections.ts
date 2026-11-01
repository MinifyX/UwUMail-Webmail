import { CalendarDays, Mail, UsersRound } from "lucide-react";
import type { AppSection } from "@/state/ui";
import { useCalendarsAvailable } from "../calendar/useCalendarData";
import { useContactsAvailable } from "../contacts/useContactsData";

export const SECTIONS: { id: AppSection; icon: typeof Mail }[] = [
  { id: "mail", icon: Mail },
  { id: "calendar", icon: CalendarDays },
  { id: "contacts", icon: UsersRound },
];

/** The sections the server offers besides mail. */
export function useAvailableSections(): AppSection[] {
  const { data: calendar = false } = useCalendarsAvailable();
  const { data: contacts = false } = useContactsAvailable();
  return SECTIONS.map((s) => s.id).filter(
    (id) => id === "mail" || (id === "calendar" && calendar) || (id === "contacts" && contacts),
  );
}
