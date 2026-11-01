import clsx from "clsx";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n";
import { addMinutes, localWall, withClock } from "@/lib/calendarDates";
import { CalendarList } from "./CalendarList";
import { MiniMonth } from "./MiniMonth";
import { useCalendarUi } from "./state";

/** A new event on the day on screen, at the next full hour (or at nine on another day). */
export function startNewEvent() {
  const { date, openEditor } = useCalendarUi.getState();
  const now = localWall();
  const start =
    date === now.slice(0, 10)
      ? withClock(date, `${String(Math.min(23, Number(now.slice(11, 13)) + 1)).padStart(2, "0")}:00`)
      : withClock(date, "09:00");
  openEditor({ occurrence: null, draft: { start, end: addMinutes(start, 60), allDay: false } });
}

/** Beside the calendar: a new event, a small month and the calendars. */
export function CalendarSidebar({ className, onNavigate }: { className?: string; onNavigate?: () => void }) {
  const { t } = useT();
  return (
    <nav className={clsx("flex h-full flex-col gap-4 px-3 pt-3 pb-3", className)} aria-label={t("calendar.title")}>
      <Button
        size="lg"
        icon={Plus}
        onClick={() => {
          onNavigate?.();
          startNewEvent();
        }}
        className="w-full"
      >
        {t("calendar.newEvent")}
      </Button>
      <div className="-mx-1 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-1">
        <MiniMonth onPick={onNavigate} />
        <CalendarList />
      </div>
    </nav>
  );
}
