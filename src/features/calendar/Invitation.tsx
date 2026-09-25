import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarCheck, Check, CircleHelp, X } from "lucide-react";
import { useState } from "react";
import { backend } from "@/backend/backend";
import type { Invitation, Message, ParticipationStatus } from "@/backend/types";
import { useT } from "@/i18n";
import { errorText, queryKeys } from "@/lib/queries";
import { toast } from "@/state/toasts";
import { useCalendarsAvailable } from "./useCalendarData";

const ANSWERS: { status: Exclude<ParticipationStatus, "needs-action">; icon: typeof Check }[] = [
  { status: "accepted", icon: Check },
  { status: "tentative", icon: CircleHelp },
  { status: "declined", icon: X },
];

/** The key of a mail's invitation query, so answering elsewhere refreshes it too. */
const invitationKey = (messageId: string) => ["invitation", messageId] as const;

/** Accept, maybe, decline: the answer goes into the event, and the server tells the organizer. */
export function InvitationAnswer({
  invitation,
  compact = false,
  onAnswered,
}: {
  invitation: Invitation;
  compact?: boolean;
  /** Runs after an answer went through, e.g. to close the event's popover. */
  onAnswered?: () => void;
}) {
  const { t } = useT();
  const client = useQueryClient();
  const [busy, setBusy] = useState<ParticipationStatus | null>(null);

  const answer = async (status: ParticipationStatus) => {
    setBusy(status);
    try {
      await backend().respondToInvitation(invitation.eventId, invitation.participantKey, status);
      toast(t(`invitation.answered.${status}`), "success");
      onAnswered?.();
    } catch (error) {
      toast(t("invitation.failed", { reason: errorText(error) }), "error");
    } finally {
      setBusy(null);
      await Promise.all([
        client.invalidateQueries({ queryKey: queryKeys.calendarEvents }),
        client.invalidateQueries({ queryKey: ["invitation"] }),
      ]);
    }
  };

  return (
    <div role="group" aria-label={t("invitation.answer")} className="flex flex-wrap gap-1.5">
      {ANSWERS.map(({ status, icon: Icon }) => {
        const chosen = invitation.status === status;
        return (
          <button
            key={status}
            type="button"
            aria-pressed={chosen}
            disabled={busy !== null}
            onClick={() => void answer(status)}
            className={clsx(
              "inline-flex items-center gap-1.5 rounded-full border font-semibold transition-colors disabled:opacity-55",
              compact ? "h-8 px-3 text-[12.5px]" : "h-9 px-3.5 text-[13px]",
              chosen
                ? "border-pink-solid bg-pink-solid text-on-pink"
                : "border-line bg-surface text-ink hover:bg-pink-tint/60",
            )}
          >
            <Icon className="size-3.5" aria-hidden />
            {t(`invitation.${status}`)}
          </button>
        );
      })}
    </div>
  );
}

/** What the answer is so far, in words. */
export function invitationStatusKey(status: ParticipationStatus): string {
  return `invitation.status.${status}`;
}

function carriesInvitation(message: Pick<Message, "attachments">): boolean {
  return message.attachments.some(
    (attachment) =>
      attachment.mimeType.toLowerCase().startsWith("text/calendar") || /\.ics$/i.test(attachment.filename),
  );
}

/**
 * An invitation in a mail: the event it put into the calendar, with the answer buttons. Only for
 * mail with an iCalendar part, and only where the server keeps calendars.
 */
export function MailInvitationCard({ message }: { message: Message }) {
  const { t, i18n } = useT();
  const { data: calendars = false } = useCalendarsAvailable();
  const wanted = calendars && carriesInvitation(message);
  const { data: invitation } = useQuery({
    queryKey: invitationKey(message.id),
    queryFn: () => backend().mailInvitation(message.id),
    enabled: wanted,
    retry: false,
    staleTime: 60_000,
  });
  if (!wanted || !invitation) return null;
  const when = invitation.start
    ? invitation.allDay
      ? new Date(`${invitation.start}T00:00:00`).toLocaleDateString(i18n.language, { dateStyle: "full" })
      : new Date(invitation.start).toLocaleString(i18n.language, { dateStyle: "full", timeStyle: "short" })
    : null;

  return (
    <section
      aria-label={t("invitation.title")}
      className="mx-1 mb-3 flex flex-col gap-2.5 rounded-2xl border border-hairline bg-canvas p-3.5"
    >
      <div className="flex gap-3">
        <CalendarCheck className="mt-0.5 size-5 shrink-0 text-pink" aria-hidden />
        <div className="min-w-0">
          <p className="text-[12px] font-bold tracking-wide text-muted uppercase">
            {invitation.organizer ? t("invitation.from", { name: invitation.organizer }) : t("invitation.title")}
          </p>
          <p className="truncate text-[14.5px] font-bold">{invitation.title || t("calendar.untitled")}</p>
          {when && <p className="text-[13px] text-muted">{when}</p>}
        </div>
      </div>
      {invitation.cancelled ? (
        <p className="text-[13px] font-semibold text-danger">{t("invitation.cancelled")}</p>
      ) : (
        <>
          <InvitationAnswer invitation={invitation} />
          <p className="text-[12px] text-muted">{t(invitationStatusKey(invitation.status))}</p>
        </>
      )}
    </section>
  );
}
