// Shapes shared by the UI and the mail engine. The Rust side serializes the
// same structures with serde (camelCase), see crates/uwumail-core/src/model.rs.

export type AccountColor = "pink" | "violet" | "sky" | "mint" | "amber" | "coral";

export const ACCOUNT_COLORS: readonly AccountColor[] = ["pink", "violet", "sky", "mint", "amber", "coral"];

export type AuthKind = "password" | "microsoft" | "google";

export type AccountStatus =
  | { state: "idle" }
  | { state: "syncing"; progress?: number }
  | { state: "offline" }
  | { state: "error"; message: string };

/** IMAP for reading plus SMTP for sending, or JMAP for both. */
export type Protocol = "imap" | "jmap";

export interface Account {
  id: string;
  name: string;
  email: string;
  displayName: string;
  color: AccountColor;
  auth: AuthKind;
  status: AccountStatus;
  protocol: Protocol;
  /** Protocols this account can switch to. */
  protocols: Protocol[];
}

/** An address a mailbox can send from. */
export interface Identity {
  /** The account id for the mailbox's own address. */
  id: string;
  accountId: string;
  email: string;
  name: string;
  /** The mailbox's own address: can be renamed, not removed. */
  primary: boolean;
  /** Comes from the mail server and is managed there. */
  fromServer: boolean;
}

/** A signature for one sender address; one can be the default for new mail and one for replies. */
export interface Signature {
  /** Empty when saving a new one. */
  id: string;
  email: string;
  name: string;
  html: string;
  forNew: boolean;
  forReplies: boolean;
}

export type FolderRole = "inbox" | "sent" | "drafts" | "archive" | "trash" | "junk";

/**
 * What the account may do in a folder (RFC 8621 `myRights`, plus `mayAdmin` for sharing). Its own
 * folders allow everything; folders somebody shares allow what they chose.
 */
export interface FolderRights {
  mayReadItems: boolean;
  mayAddItems: boolean;
  mayRemoveItems: boolean;
  maySetSeen: boolean;
  maySetKeywords: boolean;
  mayCreateChild: boolean;
  mayRename: boolean;
  mayDelete: boolean;
  /** May share it with others. */
  mayAdmin: boolean;
}

/** How much a folder or calendar is shared: read, read and write, or everything including sharing on. */
export type ShareLevel = "read" | "write" | "all";

/** Somebody on the same server, to share with (a JMAP Principal). */
export interface Person {
  /** The principal id, e.g. `p7`. */
  id: string;
  name: string;
  email: string;
}

export interface Share {
  person: Person;
  level: ShareLevel;
}

/** Somebody who shares folders with this account: their mailbox as far as they share it. */
export interface SharedAccount {
  id: string;
  /** The owner's login address. */
  email: string;
  /** The owner's name, or their address when the server doesn't say. */
  name: string;
  /** Every folder they share is read-only here. */
  readOnly: boolean;
}

export interface Folder {
  id: string;
  accountId: string;
  name: string;
  path: string;
  role: FolderRole | null;
  /** The folder this one is nested in. */
  parentId: string | null;
  /** False for containers that hold folders but no messages. */
  selectable: boolean;
  unread: number;
  total: number;
  /** What the account may do here; left out where the server doesn't say, which means everything. */
  rights?: FolderRights;
  /** Somebody else's folder, shared with the account: its `accountId` is theirs (see SharedAccount). */
  shared?: boolean;
  /** Who else sees it, by principal id; only for folders the account may share. */
  sharedWith?: Record<string, ShareLevel>;
}

export interface Address {
  name?: string;
  email: string;
}

/** Where the message list is looking. */
export type MailboxView =
  | { kind: "unified"; role: "inbox" | "unread" | "flagged" | "drafts" | "sent" }
  | { kind: "folder"; accountId: string; folderId: string };

export type ListFilter = "all" | "unread" | "flagged" | "attachments";

export interface ThreadQuery {
  view: MailboxView;
  filter: ListFilter;
  search?: string;
  conversations: boolean;
  /** Only mail from these mailboxes, e.g. the business ones; every mailbox when left out. */
  accountIds?: string[];
  cursor?: string;
  limit: number;
}

export interface ThreadSummary {
  id: string;
  accountIds: string[];
  subject: string;
  participants: Address[];
  snippet: string;
  lastDate: string;
  messageCount: number;
  unreadCount: number;
  flagged: boolean;
  hasAttachments: boolean;
  /** Somewhere in the conversation is an unsent draft. */
  hasDraft: boolean;
}

export interface ThreadPage {
  threads: ThreadSummary[];
  nextCursor?: string;
}

export interface MessageFlags {
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  draft: boolean;
}

export interface Attachment {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  inline: boolean;
  /** For images the HTML shows through `cid:`. */
  contentId?: string;
}

/** How a newsletter says to unsubscribe. */
export interface Unsubscribe {
  /**
   * The server can unsubscribe with the one POST of RFC 8058 itself: it offers that, and the mail
   * has a List-Unsubscribe-Post header. The mail or the page is then only the way back.
   */
  oneClick: boolean;
  url?: string;
  mailto?: string;
}

/** What else there is when the one-click way didn't work: a mail, the sender's page, or nothing. */
export type UnsubscribeFallback = "mail" | "page" | null;

export type UnsubscribeOutcome =
  | { kind: "done"; via: "oneClick" | "mail" }
  | { kind: "openPage"; url: string }
  /** The server tried the one click, and the sender's side didn't take it. */
  | { kind: "oneClickFailed"; reason: string; fallback: UnsubscribeFallback };

export interface Message {
  id: string;
  threadId: string;
  accountId: string;
  folderId: string;
  from: Address;
  to: Address[];
  cc: Address[];
  /** Blind copies; only known for mail sent from this account (and missing in older caches). */
  bcc?: Address[];
  replyTo: Address[];
  subject: string;
  date: string;
  flags: MessageFlags;
  snippet: string;
  /** Already sanitized by the engine. Never contains scripts. */
  bodyHtml: string | null;
  bodyText: string | null;
  hasRemoteContent: boolean;
  attachments: Attachment[];
  unsubscribe?: Unsubscribe;
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: Message[];
}

export type FlagChange = Partial<Pick<MessageFlags, "seen" | "flagged">>;

export interface OutgoingAttachment {
  filename: string;
  mimeType: string;
  size: number;
  /** Base64 content, or a local path when running in the desktop shell. */
  source: { kind: "base64"; data: string };
}

export interface OutgoingMessage {
  accountId: string;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  text: string;
  inReplyTo?: string;
  attachments: OutgoingAttachment[];
  /** The draft this was written in: saving replaces it, sending removes it. */
  draftKey?: string;
  /** One of the account's addresses; its own when left out. */
  fromEmail?: string;
}

/** A blocked sender: in this app, or on the UwUMail server of one account. */
export interface BlockedSender {
  /** An address or `@domain`; on a server also an IP address, network or host name. */
  entry: string;
  /** The account whose server keeps the entry; null for the app's own list. */
  accountId: string | null;
  serverId: string | null;
}

/** A moved message and the folder it came from, for undoing. */
export interface MovedMessage {
  id: string;
  fromFolderId: string;
}

/**
 * What sending handed back. The server holds every mail back for the person's "undo send" window
 * (or until the time they chose) and only then sends it; until `sendAt` it can be cancelled.
 */
export interface SendReceipt {
  /** The server's submission; null where nothing can be taken back (the demo without a window). */
  submissionId: string | null;
  /** When the mail goes, or went. */
  sendAt: string;
  /** Still waiting on the server. False for servers that send at once. */
  pending: boolean;
}

export interface SendOptions {
  /** A later time to send at (ISO 8601), within `maxSendDelay`. Without it the undo window applies. */
  sendAt?: string;
}

/** A mail the server still holds back: sent later, or within its undo window. */
export interface ScheduledSend {
  /** The submission, for cancelling. */
  id: string;
  emailId: string;
  sendAt: string;
  subject: string;
  to: Address[];
}

export interface DraftSaveResult {
  draftKey: string;
  savedAt: string;
}

/** A draft from the Drafts folder, ready to continue writing. */
export interface DraftContent {
  accountId: string;
  fromEmail: string | null;
  draftKey: string | null;
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  html: string;
  /** The local id of the message it answers, if that is still around. */
  inReplyTo: string | null;
  attachments: OutgoingAttachment[];
}

/**
 * The picture for an address: a person's photo (a contact's, or their own profile picture), which
 * fills the avatar; a company's brand logo (fills it too, unless it is see-through); or a website
 * icon, which sits on a plain background.
 */
export interface SenderPicture {
  url: string;
  kind: "photo" | "logo" | "icon";
}

/** How a sender picture is looked up. */
export interface SenderPictureLookup {
  /** Only what the server has itself: no request to another server (the reader switched them off). */
  local?: boolean;
  /** Ask the server again instead of taking the browser's copy, after pictures changed. */
  fresh?: boolean;
}

export interface AttachmentContent {
  url: string;
  filename: string;
  mimeType: string;
  size: number;
  /** The file type can run code when opened. */
  dangerous: boolean;
}

export interface Contact {
  name?: string;
  email: string;
  lastUsed?: string;
  timesContacted: number;
}

export type Security = "tls" | "starttls" | "none";

export interface ServerSettings {
  host: string;
  port: number;
  security: Security;
}

export interface DiscoveredSettings {
  email: string;
  providerName?: string;
  /** "microsoft" / "google" when the provider requires OAuth sign-in. */
  oauth?: Exclude<AuthKind, "password">;
  imap: ServerSettings;
  smtp: ServerSettings;
  username: string;
  source: "ispdb" | "autoconfig" | "microsoft" | "srv" | "mx" | "guess";
  /** The JMAP session URL, when the server offers JMAP. */
  jmap?: string;
}

export interface NewAccount {
  displayName: string;
  email: string;
  auth: AuthKind;
  password?: string;
  imap: ServerSettings;
  smtp: ServerSettings;
  username: string;
  color: AccountColor;
  protocol: Protocol;
  jmapUrl?: string;
  /**
   * The address to sign in with, when it is not the mailbox itself: a shared
   * mailbox is opened by someone who has access to it.
   */
  signInAs?: string;
}

/** What a mailto: link asks for. */
export interface MailtoDraft {
  to: Address[];
  cc: Address[];
  bcc: Address[];
  subject: string;
  body: string;
}

/** A calendar of the account. `color` is a CSS `#rrggbb`, or null for the app's default. */
export interface CalendarInfo {
  id: string;
  accountId: string;
  name: string;
  color: string | null;
  isDefault: boolean;
  isVisible: boolean;
  sortOrder: number;
  mayWrite: boolean;
  mayDelete: boolean;
  /** May change its name and colour and share it (own calendars, or shared with everything). */
  mayShare?: boolean;
  /** Who owns it, for a calendar somebody shares with the account; null for its own. */
  sharedBy?: { email: string; name: string } | null;
  /** Who else sees it, by principal id; only where the account may share it. */
  sharedWith?: Record<string, ShareLevel>;
  /**
   * The birthdays calendar the server makes from the contacts: read-only, never deleted, its
   * events open their contact.
   */
  isBirthdays?: boolean;
}

/** An answer to an invitation (iTIP): the participant's `participationStatus`. */
export type ParticipationStatus = "needs-action" | "accepted" | "tentative" | "declined";

/** An event somebody invited the account to, and how it answered so far. */
export interface Invitation {
  /** The stored event (the series for a repeating one), where the answer goes. */
  eventId: string;
  /** The account's participant in it. */
  participantKey: string;
  status: ParticipationStatus;
  /** Who invited, as an address (or a name) where the event says. */
  organizer: string | null;
  /** The organizer's address, for their picture; null where the event names none. */
  organizerEmail?: string | null;
}

/** What a scheduling mail says it is (its iCalendar METHOD). */
export type SchedulingMethod = "request" | "cancel" | "reply" | "other";

/** The event a scheduling mail names, as it sits in the calendar. */
interface MailSchedulingBase {
  title: string;
  /** UTC start, or the date of an all-day event. */
  start: string | null;
  allDay: boolean;
  method: SchedulingMethod;
  /**
   * The mail comes from who may say this (security-audit-0.16.0 WEBMAIL-2): the event's organizer
   * for invitations, updates and cancellations, a participant for answers; a cancellation of the
   * whole event also only once the calendar has it (W-33). An unverified one is shown as such, and
   * nothing is offered on its account.
   */
  verified: boolean;
}

/** The invitation a mail carries (its text/calendar part), as the server put it into the calendar. */
export interface MailInvitation extends Invitation, MailSchedulingBase {
  kind: "invitation";
  /** The event is cancelled, as the calendar says: a mail's word alone doesn't count (W-33). */
  cancelled: boolean;
}

/** An answer to the account's own event a mail carries, with the answer as the calendar has it. */
export interface MailReply extends MailSchedulingBase {
  kind: "reply";
  /** Who answered: their name where the event has one, else the mail's sender. */
  attendee: string;
  attendeeEmail: string;
  status: ParticipationStatus;
}

export type MailScheduling = MailInvitation | MailReply;

export type Weekday = "mo" | "tu" | "we" | "th" | "fr" | "sa" | "su";

/** The part of a recurrence rule the editor understands. */
export interface Recurrence {
  frequency: "daily" | "weekly" | "monthly" | "yearly";
  /** At least 1. */
  interval: number;
  /** Weekly only. */
  byDay: Weekday[] | null;
  /** "YYYY-MM-DD", inclusive, local. */
  until: string | null;
  count: number | null;
}

/** One event on screen: a single event, or one instance of a series. */
export interface CalendarOccurrence {
  /** Synthetic for instances of a series. */
  id: string;
  /** The stored event; the base event for a series. */
  eventId: string;
  accountId: string;
  calendarId: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  /** Local wall time in the viewer's zone, "YYYY-MM-DDTHH:mm:ss". */
  start: string;
  /** Exclusive, same format; all-day events end the next day at T00:00:00. */
  end: string;
  /** The event's own zone; null for all-day and floating events. */
  timeZone: string | null;
  /** The series rule; null when the event doesn't repeat. */
  recurrence: Recurrence | null;
  /** False when the stored rule says more than Recurrence can. */
  recurrenceEditable: boolean;
  recurrenceId: string | null;
  /** No write right, or somebody else's invitation. */
  readOnly: boolean;
  color: string | null;
  /** Somebody else's event the account was invited to, with its answer; null for its own. */
  invitation?: Invitation | null;
  /** Who takes part, the organizer first; empty for an event without participants. */
  participants?: EventParticipant[];
  /** An event of the birthdays calendar: whose date it is, and how old or how many years. */
  birthday?: OccurrenceBirthday | null;
}

/** What a birthdays calendar event is for (the server's `uwuBirthday`). */
export interface OccurrenceBirthday {
  contactId: string;
  kind: "birth" | "wedding" | "other";
  /** The label of an "other" date ("Kennenlerntag"). */
  label: string | null;
  name: string;
  /** The year it happened; null when the card doesn't say. */
  year: number | null;
  /** The age (or years) on this occurrence; null without a year or in the year itself. */
  age: number | null;
}

/** A contact's reminder of their birthday and anniversary: days before, at a time of day ("09:00"). */
export interface BirthdayReminder {
  daysBefore: number;
  time: string;
}

/** How a birthday event of another calendar fits the contacts (see Backend.scanBirthdays). */
export type BirthdayMatch = "matched" | "known" | "conflict" | "ambiguous" | "unmatched";

/** A birthday found as an event in one of the calendars, with the contacts it may belong to. */
export interface BirthdayCandidate {
  eventId: string;
  calendarId: string;
  title: string;
  /** The name read from the title. */
  name: string;
  /** "YYYY-MM-DD", or "--MM-DD" without a year. */
  birthday: string;
  /** The event can be deleted afterwards (not in a subscribed or read-only calendar). */
  mayDeleteEvent: boolean;
  match: BirthdayMatch;
  /** The contacts it may belong to, the match first. */
  contacts: { contactId: string; name: string; birthday: string | null }[];
}

export interface BirthdayScan {
  candidates: BirthdayCandidate[];
  /** There were more than the server looked at. */
  truncated: boolean;
}

/** What to do with one found birthday: into a contact, or into a new one with this name. */
export type BirthdayImportEntry =
  { eventId: string; contactId: string; overwrite?: boolean } | { eventId: string; newContactName: string };

export interface BirthdayImportResult {
  imported: { eventId: string; contactId: string; created: boolean; eventDeleted: boolean }[];
  failed: { eventId: string; reason: string }[];
}

/** Someone taking part in an event, with their answer. */
export interface EventParticipant {
  name: string;
  /** Lower case; empty where the event names no address. */
  email: string;
  status: ParticipationStatus;
  organizer: boolean;
}

/** What the event editor saves. */
export interface EventInput {
  calendarId: string;
  title: string;
  description: string;
  location: string;
  allDay: boolean;
  /** Wall time in `timeZone`; all-day: dates at T00:00:00, end exclusive. */
  start: string;
  end: string;
  /** The device's IANA zone for timed events; null for all-day ones. */
  timeZone: string | null;
  /** Left as it was when `recurrenceEditable` was false. */
  recurrence: Recurrence | null;
}

export type EventDeleteScope = "occurrence" | "series";

/** An address book of the account (JMAP Contacts, a CardDAV address book on the server). */
export interface AddressBookInfo {
  id: string;
  accountId: string;
  name: string;
  isDefault: boolean;
  sortOrder: number;
  mayDelete: boolean;
}

/** Where an email address, phone number or postal address belongs. */
export type ContactKind = "home" | "work" | "other";

/** One entry of a contact; `id` is the entry's key in the card, empty for a new one. */
export interface ContactEmail {
  id: string;
  address: string;
  kind: ContactKind;
}

export interface ContactPhone {
  id: string;
  number: string;
  kind: ContactKind | "mobile";
}

export interface ContactPostal {
  id: string;
  street: string;
  postcode: string;
  locality: string;
  region: string;
  country: string;
  kind: ContactKind;
}

/** A contact as the contacts view shows it: the parts of the card the editor knows. */
export interface ContactRecord {
  id: string;
  accountId: string;
  addressBookId: string;
  /** The name to show: the full name, else given and surname, else the organization or the email. */
  displayName: string;
  given: string;
  surname: string;
  organization: string;
  title: string;
  emails: ContactEmail[];
  phones: ContactPhone[];
  addresses: ContactPostal[];
  /** "YYYY-MM-DD", or "--MM-DD" when the year isn't known. */
  birthday: string | null;
  /** The wedding anniversary, the same way. */
  anniversary?: string | null;
  /** Reminders of the birthday and anniversary; none by default. */
  reminders?: BirthdayReminder[];
  note: string;
  /**
   * The card's picture: a `data:` URI inside the card, or an `https:` link that is only ever
   * shown through the server (Backend.contactPhotoUrl).
   */
  photo: string | null;
  /** A group rather than a person; groups are shown but not edited. */
  isGroup: boolean;
}

/** What the contact editor saves. Entries keep their `id` so what the editor doesn't show stays. */
export interface ContactInput {
  addressBookId: string;
  given: string;
  surname: string;
  organization: string;
  title: string;
  emails: ContactEmail[];
  phones: ContactPhone[];
  addresses: ContactPostal[];
  /** Left as it was when `birthdayChanged` is false. */
  birthday: string | null;
  birthdayChanged: boolean;
  /** Left as it was when `anniversaryChanged` isn't true. */
  anniversary?: string | null;
  anniversaryChanged?: boolean;
  /** Left as they were when undefined. */
  reminders?: BirthdayReminder[];
  note: string;
  /**
   * A new picture as a `data:image/jpeg` URI (cropped in the browser), or null to remove the
   * card's; left out, the card keeps its picture.
   */
  photo?: string | null;
}

/**
 * Who sees the own profile picture: nobody, people of the same server, or everyone — other mail
 * servers and apps too, through Libravatar.
 */
export type PictureVisibility = "off" | "server" | "public";

/** The own profile picture and who may see it. */
export interface ProfilePicture {
  /** Where to show it from (an object URL); null without a picture. */
  url: string | null;
  visibility: PictureVisibility;
  /** Sent along in mails as a `Face:` header; only while the picture is public. */
  sendFace: boolean;
  updated: string | null;
}

/** What the server allows for the own picture. */
export interface ProfilePictureOptions {
  /** Largest upload in bytes. */
  maxSize: number;
  /** False when the admin switched public pictures off for the server or the account's domain. */
  mayBePublic: boolean;
}

export interface ProfilePicturePatch {
  visibility?: PictureVisibility;
  sendFace?: boolean;
}

/**
 * A masked address: a random address for one website that delivers to the account (Fastmail's
 * MaskedEmail). `pending` ones wait for their first mail, `deleted` ones refuse mail for good.
 */
export type MaskedState = "pending" | "enabled" | "disabled" | "deleted";

export interface MaskedAddress {
  id: string;
  email: string;
  state: MaskedState;
  /** The site it is for, as an origin like `https://shop.example`; empty when not given. */
  forDomain: string;
  description: string;
  /** A link back to where it is used, e.g. a password manager's entry. */
  url: string | null;
  createdAt: string;
  /** When the latest mail to it arrived; null before the first. */
  lastMessageAt: string | null;
  /** Who made it, as the server says (`JMAP`, `Portal`, …). */
  createdBy: string;
}

/** What the server lets the account make masked addresses on. */
export interface MaskedOptions {
  /**
   * The domains a new one may go on; null when the server doesn't say (older servers), which
   * leaves the choice to it. Empty: nobody enabled masked addresses for the account.
   */
  domains: string[] | null;
  /** The one taken when none is named; null leaves it to the server. */
  defaultDomain: string | null;
}

/** A new masked address, made by hand and therefore `enabled` at once. */
export interface MaskedAddressInput {
  description: string;
  forDomain: string;
  url: string | null;
  /** Put in front of the random part: `a-z`, `0-9` and `_`, up to 64. */
  emailPrefix?: string;
  /** One of `MaskedOptions.domains`; the server's default when left out. */
  domain?: string;
}

export interface MaskedAddressPatch {
  /** Never back to `pending`. */
  state?: Exclude<MaskedState, "pending">;
  description?: string;
  forDomain?: string;
  url?: string | null;
}

export type BackendEvent =
  | { type: "mail:changed"; accountId: string }
  | { type: "mail:received"; accountId: string; messageIds: string[] }
  | { type: "account:status"; accountId: string; status: AccountStatus }
  /** Mail waiting to be sent changed: a new one, a cancelled one, or one that went. */
  | { type: "scheduled:changed" }
  | { type: "compose:mailto" }
  /** The account's shared settings changed, here or on another device (e.g. signatures). */
  | { type: "settings:changed"; accountId: string; state?: string }
  /** Folders shared with the account came or went, or changed between read-only and writable. */
  | { type: "accounts:changed" }
  /** Calendars or events changed, here or on another device. */
  | { type: "calendar:changed" }
  /** Address books or contacts changed, here or on another device. */
  | { type: "contacts:changed" }
  /** Masked addresses changed, here, on another device, or by arriving mail. */
  | { type: "masked:changed" }
  /** The own profile picture or its settings changed, here or elsewhere. */
  | { type: "profile:changed" };
