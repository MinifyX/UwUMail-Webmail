import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { backend } from "@/backend/backend";
import type { Message } from "@/backend/types";
import { useT } from "@/i18n";
import { deviceTimeZone, localWall, zonedWall } from "@/lib/calendarDates";
import {
  eventsInImageText,
  eventsInMail,
  fromAssist,
  mergeEvents,
  type DetectedEvent,
  type Mark,
  type MailContext,
} from "@/lib/dates";
import { useSettings } from "@/state/settings";
import { useAssistReader } from "../assist/readerState";
import { carriesInvitation } from "../calendar/Invitation";
import { useCalendarsAvailable } from "../calendar/useCalendarData";
import { readableBody } from "../mail/MessageBody";
import { useDismissedDates } from "./dismissed";
import { whenLabel } from "./format";

export interface MailEventsOptions {
  /** The mail is open, not a collapsed line of its thread. */
  open: boolean;
  /** The person allowed this mail's remote pictures. */
  allowRemote: boolean;
  /** Filed as junk: its dates are no offer worth making. */
  inJunk: boolean;
  /**
   * The mail is the person's own, not in a mailbox someone shared: only that goes to their
   * assistant, like summaries and spam checks (security-audit W-45). Defaults to true.
   */
  own?: boolean;
}

export interface MailEvents {
  /** Everything found, the same appointment once, in the order it happens. */
  events: DetectedEvent[];
  /** The hits in the mail's text to underline; `index` points into `textEvents`. */
  marks: Mark[];
  textEvents: DetectedEvent[];
  /** The assistant can read this mail for appointments. */
  canRefine: boolean;
  /** The person asked the assistant themselves ("Find appointment"), so its outcome is shown even without finds. */
  requested: boolean;
  /** Whether the assistant gets the text of the mail's pictures too. */
  includeImages: boolean;
  refining: boolean;
  refined: boolean;
  refineFailed: boolean;
  /** Asks the assistant now (it costs the person tokens, so only on their click or setting). */
  refine: () => void;
}

const NONE: DetectedEvent[] = [];

/**
 * The mail has pictures of its own the server could read: embedded ones (cid:, data:) or attached
 * ones. Remote ones count separately, only once they may load.
 */
function hasOwnPictures(message: Message): boolean {
  return (
    /<img\b[^>]*\ssrc\s*=\s*["']?\s*(?:cid|data):/i.test(message.bodyHtml ?? "") ||
    message.attachments.some((attachment) => attachment.mimeType.toLowerCase().startsWith("image/"))
  );
}

/**
 * Whether reading the mail for appointments takes its pictures' text along: its own pictures, and
 * remote ones once they may load; never while remote ones are held back.
 */
export function includesImages(message: Message, allowRemote: boolean): boolean {
  const remote = allowRemote && message.hasRemoteContent;
  return (remote || hasOwnPictures(message)) && (!message.hasRemoteContent || allowRemote);
}

/**
 * "Find appointment": the assistant reads the mail now, whatever the automatic setting says, and
 * the bar shows what it found (or that it found nothing), even where it was put away before.
 */
export function findEventsWithAssistant(emailId: string) {
  useDismissedDates.getState().restore(emailId);
  useAssistReader.getState().findEvents(emailId);
}

/**
 * The appointments in one mail: found by rules in its text right away, by the same rules in the
 * text of its pictures once the server has read them (`Email/imageText`), and refined by the
 * assistant only when the person asks, by click or by their `assist.refineEvents` setting.
 */
export function useMailEvents(
  message: Message,
  { open, allowRemote, inJunk, own = true }: MailEventsOptions,
): MailEvents {
  const { t, i18n } = useT();
  const detect = useSettings((s) => s.detectEvents);
  const refineAlways = useSettings((s) => s.assistRefineEvents);
  const { data: calendars = false } = useCalendarsAvailable();
  const on = open && detect && calendars && !inJunk && !message.flags.draft && !carriesInvitation(message);

  const context = useMemo<MailContext>(
    () => ({
      subject: message.subject,
      reference: zonedWall(message.date, deviceTimeZone()),
      locale: navigator.language,
    }),
    [message.subject, message.date],
  );

  const textEvents = useMemo(() => (on ? eventsInMail(readableBody(message), context) : NONE), [on, message, context]);

  // Remote pictures only once they may load for the person anyway.
  const remote = allowRemote && message.hasRemoteContent;
  const pictures = on && (remote || hasOwnPictures(message));
  const imageText = useQuery({
    queryKey: ["imageText", message.id, remote],
    queryFn: () => backend().imageText(message.id, remote),
    enabled: pictures,
    staleTime: Infinity,
    retry: false,
  });
  const imageEvents = useMemo(
    () => (imageText.data?.images ?? []).flatMap((image) => eventsInImageText(image.text, context)).slice(0, 20),
    [imageText.data, context],
  );

  // Asked for by click: in the bar, or "Find appointment" even where nothing was found by rules.
  const requested = useAssistReader((s) => s.eventSearches[message.id] === true);
  const findable = own && calendars && !message.flags.draft;
  const features = useQuery({
    queryKey: ["assistFeatures"],
    queryFn: () => backend().assistFeatures(),
    enabled: own && (on || (requested && findable)),
    staleTime: Infinity,
    retry: false,
  });
  const extractable = features.data?.extractEvents === true;
  const canRefine = on && own && extractable;
  const includeImages = includesImages(message, allowRemote);
  const assistant = useQuery({
    queryKey: ["extractEvents", message.id, includeImages],
    queryFn: () => backend().extractEvents(message.id, includeImages),
    enabled: (canRefine && refineAlways) || (requested && findable && extractable),
    staleTime: Infinity,
    retry: false,
  });
  const aiEvents = useMemo(
    () =>
      (assistant.data?.events ?? [])
        .map((event) => fromAssist(event, context.reference))
        .filter((event): event is DetectedEvent => event !== null),
    [assistant.data, context],
  );

  const events = useMemo(() => mergeEvents(textEvents, imageEvents, aiEvents), [textEvents, imageEvents, aiEvents]);

  const language = i18n.language;
  const marks = useMemo(
    () =>
      textEvents.flatMap((event, index) =>
        // What was over before the mail came is history, not an offer.
        event.past
          ? []
          : [
              {
                from: event.from,
                to: event.to,
                index,
                label: t("dates.markLabel", { when: whenLabel(event, language) }),
              },
            ],
      ),
    // `t` changes with the language and the tone.
    [textEvents, t, language],
  );

  return {
    events,
    marks,
    textEvents,
    canRefine,
    requested: requested && findable && extractable,
    includeImages,
    refining: assistant.isFetching,
    refined: assistant.isSuccess,
    refineFailed: assistant.isError,
    refine: () => {
      useAssistReader.getState().findEvents(message.id);
      if (assistant.isError) void assistant.refetch();
    },
  };
}

/** Whether an appointment still lies ahead of now. */
export function isUpcoming(event: DetectedEvent, now: string = localWall()): boolean {
  return !event.past && event.end > now;
}
