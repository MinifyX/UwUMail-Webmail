import { Icon, IconButton, ICONS, Menu } from "@uwusuite/design";
import type { LucideIcon } from "lucide-react";
import type { AssistEstimateRequest, Message } from "@/backend/types";
import type { MenuEntry, MenuItem } from "@uwusuite/design";
import { useT } from "@/i18n";
import { useUi } from "@/state/ui";
import { useCalendarsAvailable } from "../calendar/useCalendarData";
import { findEventsWithAssistant, includesImages } from "../dates/useMailEvents";
import { EstimateLabel } from "./Estimate";
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
function labelAgainItem(emailId: string, language: string, text: string): MenuItem {
  return {
    label: (
      <EstimateLabel request={suggestRequest(emailId, language)}>
        <ItemLabel icon={ICONS.labels} text={text} />
      </EstimateLabel>
    ),
    onSelect: () => useUi.getState().openLabelSuggest(emailId),
  };
}

function ItemLabel({ icon: Glyph, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="flex items-center gap-2.5">
      <Icon icon={Glyph} className="shrink-0 text-muted" />
      {text}
    </span>
  );
}

/** "Summarize" and "Check for spam" for one mail, for its "more" menu. */
/** Under their own heading, after the mail's other items. */
export function useMessageAssistItems(message: Message, own: boolean, fromMe: boolean): MenuEntry[] {
  const { t, i18n } = useT();
  const can = useReaderAssist(own);
  const showSummary = useAssistReader((s) => s.showSummary);
  const showSpamCheck = useAssistReader((s) => s.showSpamCheck);
  if (message.flags.draft) return [];
  const items: MenuItem[] = [
    ...(can.summarize
      ? [
          {
            label: (
              <EstimateLabel request={summarizeRequest({ emailId: message.id }, i18n.language)}>
                <ItemLabel icon={ICONS.summary} text={t("assist.summary.summarizeMail")} />
              </EstimateLabel>
            ),
            onSelect: () => showSummary(mailKey(message.id)),
          },
        ]
      : []),
    ...(can.findEvents
      ? [
          {
            label: (
              <EstimateLabel request={eventsRequest(message)}>
                <ItemLabel icon={ICONS.findEvent} text={t("dates.find")} />
              </EstimateLabel>
            ),
            onSelect: () => findEventsWithAssistant(message.id),
          },
        ]
      : []),
    ...(can.spamCheck && !fromMe
      ? [
          {
            label: (
              <EstimateLabel request={spamRequest(message.id, i18n.language)}>
                <ItemLabel icon={ICONS.spamCheck} text={t("assist.spam.check")} />
              </EstimateLabel>
            ),
            onSelect: () => showSpamCheck(message.id),
          },
        ]
      : []),
    ...(can.labelAgain ? [labelAgainItem(message.id, i18n.language, t("labels.suggest.menu"))] : []),
  ];
  return items.length > 0 ? [{ heading: t("assist.menuGroup") }, ...items] : [];
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
              label: (
                <EstimateLabel request={summarizeRequest({ threadId }, language)}>
                  <ItemLabel icon={ICONS.ai} text={t("assist.summary.summarizeThread")} />
                </EstimateLabel>
              ),
              onSelect: () => showSummary(threadKey(threadId)),
            },
            ...(newest
              ? [
                  {
                    label: (
                      <EstimateLabel request={summarizeRequest({ emailId: newest.id }, language)}>
                        <ItemLabel icon={ICONS.summary} text={t("assist.summary.summarizeLatest")} />
                      </EstimateLabel>
                    ),
                    onSelect: () => showSummary(mailKey(newest.id)),
                  },
                ]
              : []),
          ]
        : [
            {
              label: (
                <EstimateLabel request={summarizeRequest({ emailId: messages[0]!.id }, language)}>
                  <ItemLabel icon={ICONS.ai} text={t("assist.summary.summarizeMail")} />
                </EstimateLabel>
              ),
              onSelect: () => showSummary(mailKey(messages[0]!.id)),
            },
          ]
      : []),
    ...(can.findEvents && forEvents
      ? [
          {
            label: (
              <EstimateLabel request={eventsRequest(forEvents)}>
                <ItemLabel icon={ICONS.findEvent} text={t("dates.find")} />
              </EstimateLabel>
            ),
            onSelect: () => findEventsWithAssistant(forEvents.id),
          },
        ]
      : []),
    ...(can.spamCheck && newest
      ? [
          {
            label: (
              <EstimateLabel request={spamRequest(newest.id, language)}>
                <ItemLabel icon={ICONS.spamCheck} text={t("assist.spam.check")} />
              </EstimateLabel>
            ),
            onSelect: () => showSpamCheck(newest.id),
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
          icon={ICONS.ai}
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
