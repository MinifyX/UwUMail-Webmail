import { useQuery, useQueryClient } from "@tanstack/react-query";
import clsx from "clsx";
import { CalendarCheck, Check, CircleHelp, ShieldAlert, X } from "lucide-react";
import { useState } from "react";
import { backend } from "@/backend/backend";
import type { Invitation, MailScheduling, Message, ParticipationStatus } from "@/backend/types";
import { Avatar } from "@/components/ui/Avatar";
import { useT } from "@/i18n";
import { visibleText } from "@/lib/links";
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

export function carriesInvitation(message: Pick<Message, "attachments">): boolean {
  return message.attachments.some(
    (attachment) =>
      attachment.mimeType.toLowerCase().startsWith("text/calendar") || /\.ics$/i.test(attachment.filename),
  );
}

/**
 * An invitation, cancellation or answer in a mail: the event it names as the calendar has it,
 * with the answer buttons. Only for mail with an iCalendar part, and only where the server keeps
 * calendars. A mail that doesn't come from who may say what it says — anyone can name someone
 * else's event — is shown as unverified, and nothing is offered on its account (WEBMAIL-2).
 */
export function MailInvitationCard({ message }: { message: Message }) {
  const { t, i18n } = useT();
  const { data: calendars = false } = useCalendarsAvailable();
  const wanted = calendars && carriesInvitation(message);
  const { data: found } = useQuery({
    queryKey: invitationKey(message.id),
    queryFn: () => backend().mailInvitation(message.id),
    enabled: wanted,
    retry: false,
    staleTime: 60_000,
  });
  if (!wanted || !found) return null;
  const when = found.start
    ? found.allDay
      ? new Date(`${found.start}T00:00:00`).toLocaleDateString(i18n.language, { dateStyle: "full" })
      : new Date(found.start).toLocaleString(i18n.language, { dateStyle: "full", timeStyle: "short" })
    : null;

  const heading =
    found.kind === "reply"
      ? t("invitation.reply.title")
      : found.organizer && found.verified
        ? t("invitation.from", { name: found.organizer })
        : t("invitation.title");
  const person =
    found.kind === "reply"
      ? found.verified
        ? { name: found.attendee, email: found.attendeeEmail }
        : null
      : found.organizerEmail
        ? { name: found.organizer ?? undefined, email: found.organizerEmail }
        : null;

  return (
    <section
      aria-label={heading}
      className="mx-1 mb-3 flex flex-col gap-2.5 rounded-2xl border border-hairline bg-canvas p-3.5"
    >
      <div className="flex gap-3">
        {person ? (
          <Avatar address={person} size="sm" />
        ) : (
          <CalendarCheck className="mt-0.5 size-5 shrink-0 text-pink" aria-hidden />
        )}
        <div className="min-w-0">
          <p className="text-[12px] font-bold tracking-wide text-muted uppercase">{heading}</p>
          <p className="truncate text-[14.5px] font-bold">{found.title || t("calendar.untitled")}</p>
          {when && <p className="text-[13px] text-muted">{when}</p>}
        </div>
      </div>
      {!found.verified ? (
        <Unverified found={found} sender={message.from.email} />
      ) : found.kind === "reply" ? (
        <p className="text-[13px]">{t(`invitation.reply.status.${found.status}`, { name: found.attendee })}</p>
      ) : found.cancelled ? (
        <p className="text-[13px] font-semibold text-danger">{t("invitation.cancelled")}</p>
      ) : found.method === "cancel" ? (
        // Single dates cancelled: the event itself goes on, and the mail is no reason to answer it.
        <p className="text-[12px] text-muted">{t(invitationStatusKey(found.status))}</p>
      ) : (
        <>
          <InvitationAnswer invitation={found} />
          <p className="text-[12px] text-muted">{t(invitationStatusKey(found.status))}</p>
        </>
      )}
    </section>
  );
}

/** Why this mail isn't believed, and what the calendar says instead. No buttons. */
function Unverified({ found, sender }: { found: MailScheduling; sender: string }) {
  const { t } = useT();
  const text =
    found.kind === "reply"
      ? t("invitation.unverified.reply")
      : found.method === "cancel"
        ? t("invitation.unverified.cancel")
        : t("invitation.unverified.invitation");
  const organizer = found.kind === "invitation" ? (found.organizerEmail ?? found.organizer) : null;
  // This line tells who wrote the mail from who may; direction marks and invisible characters in
  // either would let one read as the other, so they are shown, not obeyed (security-audit W-34).
  return (
    <div role="note" className="flex gap-2.5 rounded-xl bg-warning-tint px-3 py-2.5 text-[13px] text-warning">
      <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-col gap-1">
        <p className="font-semibold">{text}</p>
        <p className="break-words">
          {organizer
            ? t("invitation.unverified.senderAndOrganizer", {
                sender: visibleText(sender),
                organizer: visibleText(organizer),
              })
            : t("invitation.unverified.sender", { sender: visibleText(sender) })}
        </p>
        {found.kind === "invitation" && found.cancelled && <p>{t("invitation.cancelled")}</p>}
      </div>
    </div>
  );
}
