import { CalendarSearch, FileText, ShieldQuestion, Sparkles, Tags, type LucideIcon } from "lucide-react";
import type { ReactElement } from "react";
import type { AssistEstimateRequest, Message } from "@/backend/types";
import { IconButton } from "@/components/ui/Button";
import type { MenuItem } from "@/components/ui/Menu";
import { Menu } from "@/components/ui/Menu";
import { useT } from "@/i18n";
import { useUi } from "@/state/ui";
import { useCalendarsAvailable } from "../calendar/useCalendarData";
import { findEventsWithAssistant, includesImages } from "../dates/useMailEvents";
import { EstimateTip } from "./Estimate";
import { mailKey, threadKey, useAssistReader } from "./readerState";
import { SpamCheckCard } from "./SpamCheckCard";
import { SummaryCard } from "./SummaryCard";
import { useAssistOptions } from "./useAssist";

/** What the assistant can do in the reader for this mail: only the own account's mail has it. */
export function useReaderAssist(own: boolean) {
  const { data: options } = useAssistOptions();
  const extract = own && options?.features.extractEvents === true;
  // Found appointments go into a calendar, so only where there is one.
  const { data: calendars = false } = useCalendarsAvailable();
  return {
    summarize: own && options?.features.summarize === true,
    spamCheck: own && options?.features.spamCheck === true,
    findEvents: extract && calendars,
    labelAgain: own && options?.features.autoLabels === true,
  };
}

/** A menu item's button with the tooltip of about what it costs. */
const estimated =
  (request: AssistEstimateRequest) =>
  (button: ReactElement): ReactElement => (
    <EstimateTip request={request} beside>
      {button}
    </EstimateTip>
  );

function summarizeRequest(key: { emailId: string } | { threadId: string }, language: string): AssistEstimateRequest {
  return { method: "Assist/summarize", request: { ...key, language } };
}

function spamRequest(emailId: string, language: string): AssistEstimateRequest {
  return { method: "Assist/spamCheck", emailId, language };
}

/** Reading a mail for appointments; its pictures as far as they load without asking. */
function eventsRequest(message: Message): AssistEstimateRequest {
  return { method: "Assist/extractEvents", emailId: message.id, includeImages: includesImages(message, false) };
}

function suggestRequest(emailId: string, language: string): AssistEstimateRequest {
  return { method: "AssistLabel/suggest", emailId, language };
}

/** "Label again" for one mail: the model judges every label, the person decides. */
function labelAgainItem(emailId: string, language: string, text: string, group?: string): MenuItem {
  return {
    group,
    label: <ItemLabel icon={Tags} text={text} />,
    onSelect: () => useUi.getState().openLabelSuggest(emailId),
    wrap: estimated(suggestRequest(emailId, language)),
  };
}

function ItemLabel({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <Icon className="size-4 shrink-0 text-muted" aria-hidden />
      {text}
    </span>
  );
}

/** "Summarize" and "Check for spam" for one mail, for its "more" menu. */
export function useMessageAssistItems(message: Message, own: boolean, fromMe: boolean): MenuItem[] {
  const { t, i18n } = useT();
  const can = useReaderAssist(own);
  const showSummary = useAssistReader((s) => s.showSummary);
  const showSpamCheck = useAssistReader((s) => s.showSpamCheck);
  if (message.flags.draft) return [];
  const group = t("assist.menuGroup");
  return [
    ...(can.summarize
      ? [
          {
            group,
            label: <ItemLabel icon={FileText} text={t("assist.summary.summarizeMail")} />,
            onSelect: () => showSummary(mailKey(message.id)),
            wrap: estimated(summarizeRequest({ emailId: message.id }, i18n.language)),
          },
        ]
      : []),
    ...(can.findEvents
      ? [
          {
            group,
            label: <ItemLabel icon={CalendarSearch} text={t("dates.find")} />,
            onSelect: () => findEventsWithAssistant(message.id),
            wrap: estimated(eventsRequest(message)),
          },
        ]
      : []),
    ...(can.spamCheck && !fromMe
      ? [
          {
            group,
            label: <ItemLabel icon={ShieldQuestion} text={t("assist.spam.check")} />,
            onSelect: () => showSpamCheck(message.id),
            wrap: estimated(spamRequest(message.id, i18n.language)),
          },
        ]
      : []),
    ...(can.labelAgain ? [labelAgainItem(message.id, i18n.language, t("labels.suggest.menu"), group)] : []),
  ];
}

interface ThreadAssistButtonProps {
  threadId: string;
  messages: Message[];
  own: boolean;
  /** The addresses of the account, to leave its own mail out of spam checks. */
  mine: Set<string>;
  align?: "start" | "end";
}

/** ✨ in the reader's toolbar: summarize the conversation, or check its newest mail for spam. */
export function ThreadAssistButton({ threadId, messages, own, mine, align }: ThreadAssistButtonProps) {
  const { t, i18n } = useT();
  const language = i18n.language;
  const can = useReaderAssist(own);
  const showSummary = useAssistReader((s) => s.showSummary);
  const showSpamCheck = useAssistReader((s) => s.showSpamCheck);
  const sent = messages.filter((message) => !message.flags.draft);
  const received = sent.filter((message) => !mine.has(message.from.email.toLowerCase()));
  const newest = received[received.length - 1];
  // Appointments are looked for in the newest mail that came, or else in the newest one at all.
  const forEvents = newest ?? sent[sent.length - 1];
  const items: MenuItem[] = [
    ...(can.summarize
      ? messages.length > 1
        ? [
            {
              label: <ItemLabel icon={Sparkles} text={t("assist.summary.summarizeThread")} />,
              onSelect: () => showSummary(threadKey(threadId)),
              wrap: estimated(summarizeRequest({ threadId }, language)),
            },
            ...(newest
              ? [
                  {
                    label: <ItemLabel icon={FileText} text={t("assist.summary.summarizeLatest")} />,
                    onSelect: () => showSummary(mailKey(newest.id)),
                    wrap: estimated(summarizeRequest({ emailId: newest.id }, language)),
                  },
                ]
              : []),
          ]
        : [
            {
              label: <ItemLabel icon={Sparkles} text={t("assist.summary.summarizeMail")} />,
              onSelect: () => showSummary(mailKey(messages[0]!.id)),
              wrap: estimated(summarizeRequest({ emailId: messages[0]!.id }, language)),
            },
          ]
      : []),
    ...(can.findEvents && forEvents
      ? [
          {
            label: <ItemLabel icon={CalendarSearch} text={t("dates.find")} />,
            onSelect: () => findEventsWithAssistant(forEvents.id),
            wrap: estimated(eventsRequest(forEvents)),
          },
        ]
      : []),
    ...(can.spamCheck && newest
      ? [
          {
            label: <ItemLabel icon={ShieldQuestion} text={t("assist.spam.check")} />,
            onSelect: () => showSpamCheck(newest.id),
            wrap: estimated(spamRequest(newest.id, language)),
          },
        ]
      : []),
    ...(can.labelAgain && forEvents
      ? [
          labelAgainItem(
            forEvents.id,
            language,
            messages.length > 1 ? t("labels.suggest.menuLatest") : t("labels.suggest.menu"),
          ),
        ]
      : []),
  ];
  if (items.length === 0) return null;
  return (
    <Menu
      align={align}
      items={items}
      trigger={(menu) => (
        <IconButton
          icon={Sparkles}
          label={t("assist.reader.button")}
          onClick={menu.toggle}
          aria-haspopup={menu["aria-haspopup"]}
          aria-expanded={menu["aria-expanded"]}
          aria-controls={menu["aria-controls"]}
        />
      )}
    />
  );
}

/** The conversation's summary, under its subject, while it is asked for. */
export function ThreadSummary({ threadId, count }: { threadId: string; count: number }) {
  const shown = useAssistReader((s) => s.summaries[threadKey(threadId)] === true);
  if (!shown) return null;
  return <SummaryCard kind="thread" id={threadId} count={count} />;
}

/** One mail's summary and spam check, above its text, while they are asked for. */
export function MessageAssistCards({ message, inJunk }: { message: Message; inJunk: boolean }) {
  const summary = useAssistReader((s) => s.summaries[mailKey(message.id)] === true);
  const spamCheck = useAssistReader((s) => s.spamChecks[message.id] === true);
  if (!summary && !spamCheck) return null;
  return (
    <>
      {summary && <SummaryCard kind="mail" id={message.id} />}
      {spamCheck && <SpamCheckCard message={message} inJunk={inJunk} />}
    </>
  );
}
