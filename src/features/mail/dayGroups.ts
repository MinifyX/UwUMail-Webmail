import type { ThreadSummary } from "@/backend/types";

export interface DayGroup {
  /** yyyy-mm-dd in local time. */
  key: string;
  /** "today", "yesterday", or a date to show as it is. */
  day: "today" | "yesterday" | "date";
  date: Date;
  threads: ThreadSummary[];
}

function localKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** The list by the day of each conversation's last mail, in the order it comes. */
export function groupByDay(threads: ThreadSummary[], now = new Date()): DayGroup[] {
  const today = localKey(now);
  const before = new Date(now);
  before.setDate(before.getDate() - 1);
  const yesterday = localKey(before);
  const groups: DayGroup[] = [];
  for (const thread of threads) {
    const date = new Date(thread.lastDate);
    const key = localKey(date);
    const last = groups[groups.length - 1];
    if (last?.key === key) {
      last.threads.push(thread);
      continue;
    }
    groups.push({
      key,
      day: key === today ? "today" : key === yesterday ? "yesterday" : "date",
      date,
      threads: [thread],
    });
  }
  return groups;
}

/** "Montag, 3. März", with the year when it isn't this one. */
export function formatDayHeading(date: Date, locale: string, now = new Date()): string {
  return date.toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    ...(date.getFullYear() !== now.getFullYear() && { year: "numeric" }),
  });
}
