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
  | { kind: "folder"; accountId: string; folderId: string }
  /** Every mail with one label (its keyword), across the folders, without trash and junk. */
  | { kind: "label"; keyword: string };

export type ListFilter = "all" | "unread" | "flagged" | "attachments";

export interface ThreadQuery {
  view: MailboxView;
  filter: ListFilter;
  search?: string;
  /** Only mail with every one of these label keywords (the chips above the list, `label:` in the search). */
  labels?: string[];
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
  /**
   * The own keywords of its messages (lower case, without the `$` system ones), e.g. the labels
   * the AI assistant sets; left out where the backend doesn't know them.
   */
  keywords?: string[];
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
  /** Its own keywords (lower case, without the `$` system ones), e.g. AI assistant labels. */
  keywords?: string[];
}

export interface ThreadDetail {
  thread: ThreadSummary;
  messages: Message[];
}

export type FlagChange = Partial<Pick<MessageFlags, "seen" | "flagged">> & {
  /** Own keywords (e.g. AI assistant labels) to set (true) or take off (false). */
  keywords?: Record<string, boolean>;
};

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
  /** The saved draft's id in the Drafts folder, to open it again (see `openDraft`). */
  emailId?: string;
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

/** What the server found out about one remote picture of a mail, see `Backend.imageSizes`. */
export interface RemoteImageSize {
  /** The picture's address as the mail has it, not the server's proxy address. */
  url: string;
  /** Pixels; null while the picture loads fine but its size is unknown. */
  width: number | null;
  height: number | null;
  /** The picture can't be had: a dead host, an error, or not a picture. */
  failed: boolean;
}

/**
 * Asks the server for the sizes of a mail's remote pictures. `onSize` runs once per address as
 * soon as the server knows, in any order; the promise settles when every address is answered or
 * the server gave up. It rejects when the server can't be asked at all.
 */
export type ImageSizeProbe = (
  urls: string[],
  onSize: (size: RemoteImageSize) => void,
  signal: AbortSignal,
) => Promise<void>;

/** The text in a mail's pictures, read by the server (OCR). */
export interface ImageTextResult {
  emailId: string;
  /** The server can't read pictures (no OCR there); `images` is then empty. */
  unavailable: boolean;
  images: ImageText[];
  /** Pictures the server left out, e.g. too big or too many. */
  skipped: number;
}

export interface ImageText {
  /** `cid:<content-id>` for an embedded picture, `blob:<blobId>` for an attached one, else the https URL. */
  source: string;
  text: string;
  width: number;
  height: number;
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
  | { type: "profile:changed" }
  /** The AI assistant's providers, settings or labels changed, here or on another device. */
  | { type: "assist:changed" };

// ---------------------------------------------------------------------------------------------
// AI assistant (UwUMail Server's `urn:uwumail:jmap:assist`, see the server's docs/jmap-assist.md).
// Every call to a model is made by the server; the webmail only asks it and shows the answers.

/** What the assistant does, as the server names it. */
export type AssistFeature = "compose" | "summarize" | "spamCheck" | "extractEvents" | "autoLabels";

export const ASSIST_FEATURES: readonly AssistFeature[] = [
  "compose",
  "summarize",
  "spamCheck",
  "extractEvents",
  "autoLabels",
];

/**
 * Per feature, whether this person can use it right now. `autoLabels` means it *can* be switched
 * on; whether it is on is `AssistSettings.autoLabels`.
 */
export type AssistFeatures = Record<AssistFeature, boolean>;

/** What the server allows the person, from the own account's capability. */
export interface AssistOptions {
  features: AssistFeatures;
  /** People may add providers with their own keys. */
  mayAddProviders: boolean;
  /** Such a provider may point into the local network (Ollama on the LAN). */
  mayUsePrivateAddresses: boolean;
  maxProviders: number;
  maxLabels: number;
  maxInstructionChars: number;
  maxTextChars: number;
  /** The base labels the server knows; empty on servers before 0.22. */
  baseLabels: LabelBase[];
}

export type AssistProviderKind =
  "openai" | "anthropic" | "gemini" | "mistral" | "openrouter" | "ollama" | "openaiCompatible" | "chatgpt";

/** A way to reach a model: the admin's for the server, or the person's own with their key. */
export interface AssistProvider {
  id: string;
  name: string;
  kind: AssistProviderKind;
  scope: "server" | "personal";
  /** For `ollama` and `openaiCompatible`; null for server providers and fixed addresses. */
  baseUrl: string | null;
  hasKey: boolean;
  /** The last four characters of the key, like `…a1b2`. */
  keyHint: string | null;
  /** The model for writing. */
  model: string | null;
  /** The cheaper model for everything else; `model` when null. */
  fastModel: string | null;
  features: AssistFeature[];
  /** A server provider's daily limit per person. */
  quota: { requestsPerDay: number | null; tokensPerDay: number | null } | null;
  /** `chatgpt`: an unofficial way to use a ChatGPT subscription. */
  experimental: boolean;
  /** `chatgpt`: signed in; others: a key is stored or none is needed. */
  connected: boolean;
  /** Own providers: the price set by hand, USD per million tokens; null follows the known prices. */
  inputPricePerMillion?: number | null;
  outputPricePerMillion?: number | null;
  /** What the default model costs as the server knows it; null when it doesn't (or an older server). */
  price?: AssistPrice | null;
}

/** A model's price in USD per million tokens, and where it comes from. */
export interface AssistPrice {
  inputPerMillion: number;
  outputPerMillion: number;
  source: "auto" | "manual" | "free";
}

/** What something costs, in the currency asked for and in USD. */
export interface AssistCost {
  amount: number;
  /** ISO 4217, e.g. `EUR`. */
  currency: string;
  usd: number | null;
}

/** What may be set on an own provider. `apiKey` left out keeps the stored key, `""` removes it. */
export interface AssistProviderInput {
  name?: string;
  /** Only when it is made. */
  kind?: AssistProviderKind;
  baseUrl?: string | null;
  apiKey?: string;
  model?: string | null;
  fastModel?: string | null;
  /** USD per million tokens; null goes back to the known prices. */
  inputPricePerMillion?: number | null;
  outputPricePerMillion?: number | null;
}

export interface AssistModel {
  id: string;
  name: string;
}

/** The models a provider offers, and its settings (or the kind's suggestion). */
export interface AssistModels {
  models: AssistModel[];
  model: string | null;
  fastModel: string | null;
}

/** OpenAI's device-code login for a `chatgpt` provider (experimental). */
export interface ChatgptLogin {
  userCode: string;
  verificationUri: string;
  /** Seconds between two polls. */
  interval: number;
  expiresAt: string | null;
}

export interface ChatgptPoll {
  status: "pending" | "connected" | "expired" | "failed";
  description: string | null;
}

/** A provider, and a model of it; `model` null means the provider's own for that feature. */
export interface AssistChoice {
  providerId: string;
  model: string | null;
}

/** What a feature really uses. */
export interface AssistEffective {
  providerId: string;
  providerName: string;
  model: string | null;
  scope: "server" | "personal";
}

export interface AssistSettings {
  /** What every feature uses unless it has its own choice. */
  default: AssistChoice | null;
  features: Record<AssistFeature, AssistChoice | null>;
  /** Labels are put on incoming mail (opt-in). */
  autoLabels: boolean;
  /** Per feature what will really be used, or null when nothing can. */
  effective: Record<AssistFeature, AssistEffective | null>;
}

/** A change of the settings: only what is named changes, per feature too. */
export interface AssistSettingsPatch {
  default?: AssistChoice | null;
  features?: Partial<Record<AssistFeature, AssistChoice | null>>;
  autoLabels?: boolean;
}

export interface AssistTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

/** Who answered: comes with every answer of a model. */
export interface AssistAnswer {
  providerId: string;
  providerName: string;
  model: string | null;
  usage: AssistTokenUsage | null;
}

export type AssistComposeMode = "write" | "rewrite" | "adjust";

export type AssistPreset = "formal" | "casual" | "shorter" | "friendlier" | "clearer" | "proofread" | "translate";

export const ASSIST_PRESETS: readonly AssistPreset[] = [
  "formal",
  "casual",
  "shorter",
  "friendlier",
  "clearer",
  "proofread",
  "translate",
];

/** `Assist/compose`: a new text from an instruction, or the draft's text rewritten. */
export interface AssistComposeRequest {
  mode: AssistComposeMode;
  instruction?: string | null;
  preset?: AssistPreset | null;
  /** For `translate`: a language name or tag. */
  targetLanguage?: string | null;
  /** The draft as plain text; needed for `rewrite` and `adjust`. */
  text?: string | null;
  subject?: string | null;
  /** The mail being answered, as context. */
  replyToEmailId?: string | null;
  /** `write` only: also propose a subject. */
  wantSubject?: boolean;
  /** The UI language as a hint. */
  language?: string | null;
}

export interface AssistComposeResult extends AssistAnswer {
  text: string;
  /** A proposed subject, or null. */
  subject: string | null;
}

/** One mail, or a whole conversation. */
export interface AssistSummarizeRequest {
  emailId?: string | null;
  threadId?: string | null;
  language?: string | null;
}

export interface AssistSummary extends AssistAnswer {
  emailId: string | null;
  threadId: string | null;
  /** One or two sentences, then up to five lines starting with `- `. */
  summary: string;
}

/** What the text arrives in while the model writes (the stream endpoint). */
export interface AssistStreamHandlers {
  onSubject?: (subject: string) => void;
  /** The next piece of the text. */
  onDelta?: (text: string) => void;
  /** Aborting closes the request, which stops the model. */
  signal?: AbortSignal;
}

export type AssistVerdict = "legitimate" | "suspicious" | "spam" | "phishing";

/** What the server itself found about a mail, next to the model's opinion. */
export interface AssistSpamSignals {
  /** SPF, DKIM and DMARC as the server recorded them; null each when the mail came from no other server. */
  authentication: {
    spf: string | null;
    dkim: string | null;
    dmarc: string | null;
    fromDomain: string | null;
  };
  /** The spam filter's points and its limit for Junk; null when it did not look. */
  spamScore: number | null;
  spamThreshold: number | null;
  /** The rules that counted. */
  tests: string[];
  inJunk: boolean;
  sender: {
    address: string;
    earlierMessages: number;
    earlierInJunk: number;
    writtenTo: number;
    inContacts: boolean;
    /** When the first mail from it came (UTC), null when this is the first. */
    firstSeen: string | null;
  };
}

export interface AssistSpamCheck extends AssistAnswer {
  emailId: string;
  verdict: AssistVerdict;
  /** 0 to 1. */
  confidence: number;
  /**
   * What the model said when the server moved it back into the range the facts allow (see
   * `facts.allowed`); absent when the verdict is the model's own.
   */
  modelVerdict?: AssistVerdict;
  reasons: string[];
  /**
   * The same reasons with what each rests on: a quote from the mail or one of the server's
   * facts. Reasons the mail does not back are not in here (only counted in `droppedReasons`).
   */
  reasonDetails: AssistSpamReason[];
  /** How many reasons of the model were left out because nothing in the mail backs them. */
  droppedReasons: number;
  /** What the server weighed before the model said anything; null from older servers. */
  facts: AssistSpamFacts | null;
  signals: AssistSpamSignals;
}

/** A reason of the spam check and the evidence it cites. */
export interface AssistSpamReason {
  text: string;
  /** Words from the mail the reason rests on, as they stand there. */
  quote: string | null;
  /** The server fact it rests on (`F3`), when it cites one. */
  fact: string | null;
}

/** How far the facts point towards spam, from "clean" to "spam". */
export type AssistSpamBand = "clean" | "leaningClean" | "unclear" | "leaningSpam" | "spam";

/** One fact the server weighed, by a stable code (`DMARC_PASS`, `LOOKALIKE_BRAND_FROM`, …). */
export interface AssistSpamEvidence {
  code: string;
  tone: "good" | "bad";
  /** How much it moved the score; positive is towards spam. */
  weight: number;
  /** What exactly was seen (a domain, a count); technical, not translated. */
  detail: string | null;
  /** Part of the phishing checks. */
  phishing: boolean;
}

/** The server's own weighing: the facts decide the range, the model only explains within it. */
export interface AssistSpamFacts {
  score: number;
  band: AssistSpamBand;
  evidence: AssistSpamEvidence[];
  /** The verdicts the model could choose from. */
  allowed: AssistVerdict[];
  defaultVerdict: AssistVerdict;
}

/** Somebody an event names, with an address from the address book or the mail's headers. */
export interface AssistEventParticipant {
  name: string;
  email: string;
}

/**
 * An appointment, deadline or trip the model read out of a mail. `start` and `end` are JMAP
 * LocalDateTimes (`2026-10-06T09:30:00`); all-day events start at `T00:00:00` and end the day
 * after the last one. `timeZone` is null when the mail names none (use the person's).
 */
export interface AssistEvent {
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  timeZone: string | null;
  location: string | null;
  description: string | null;
  /** Only ever an `https` address that is in the mail. */
  url: string | null;
  participants: AssistEventParticipant[];
  /** 0 to 1. */
  confidence: number;
  /** The text it was read from, as it stands in the mail. */
  quote: string;
}

export interface AssistEventsResult {
  events: AssistEvent[];
  /** Who answered; null where the backend doesn't say. */
  answer?: AssistAnswer | null;
}

/** The methods whose cost `Assist/estimate` can tell before asking the model. */
export type AssistEstimateMethod =
  "Assist/compose" | "Assist/summarize" | "Assist/spamCheck" | "Assist/extractEvents" | "AssistLabel/suggest";

/** What would be asked: the same arguments the real call gets. */
export type AssistEstimateRequest =
  | { method: "Assist/compose"; request: AssistComposeRequest }
  | { method: "Assist/summarize"; request: AssistSummarizeRequest }
  | { method: "Assist/spamCheck"; emailId: string; language?: string | null }
  | { method: "Assist/extractEvents"; emailId: string; includeImages: boolean }
  | { method: "AssistLabel/suggest"; emailId: string; language?: string | null };

/**
 * One model call a request would make: the main one, and the extra ones the server really makes
 * for it (reading pictures, summarizing a long thread in chunks, a retry on an invalid answer, …).
 * `purpose` is open-ended; `weight` is how likely the call is (a retry happens only sometimes).
 */
export interface AssistEstimateCall {
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  images: number;
  weight: number;
}

/** What an estimated cost is made of, in the estimate's currency. */
export interface AssistCostParts {
  input: number;
  output: number;
  reasoning: number;
  images: number;
  /** Fees per request, over all calls. */
  requests: number;
  other: number;
}

/** An estimated cost, with the worst case and its parts where the server says (newer servers). */
export interface AssistEstimateCost extends AssistCost {
  /** Every call answering as long as it may, thinking included. */
  max: AssistCost | null;
  parts: AssistCostParts | null;
}

/**
 * About how many tokens a call would use and how much of the day's allowance is left; nothing is
 * asked of the model and nothing counts. The left values are null where there is no limit. The
 * token counts cover every call of the request; `totalTokens` includes thinking.
 */
export interface AssistEstimate {
  method: AssistEstimateMethod;
  inputTokens: number;
  outputTokens: number;
  /** Thinking of a reasoning model; 0 for others and from an older server. */
  reasoningTokens: number;
  totalTokens: number;
  /** Pictures the model would look at. */
  imageCount: number;
  /** Every model call of the request; empty from an older server. */
  calls: AssistEstimateCall[];
  /** The numbers were corrected by how far earlier estimates were off from the real calls. */
  calibrated: boolean;
  providerId: string;
  providerName: string;
  model: string | null;
  tokensLeftToday: number | null;
  requestsLeftToday: number | null;
  /** About what it costs; null where the price is unknown or hidden from the person (or an older server). */
  cost: AssistEstimateCost | null;
}

/** A built-in recognizer a label can use without any AI: it sets the label on mail of that kind. */
export type LabelDetector =
  "invoice" | "appointment" | "newsletter" | "shipping" | "account" | "personal" | "work" | "advertising";
export const LABEL_DETECTORS: readonly LabelDetector[] = [
  "invoice",
  "appointment",
  "newsletter",
  "shipping",
  "account",
  "personal",
  "work",
  "advertising",
];

/**
 * One of the eight fixed base labels every person has: its definition is the server's and can't be
 * changed, its name, colour and automatic parts can.
 */
export type LabelBase =
  "invoice" | "shipping" | "appointment" | "newsletter" | "account" | "personal" | "work" | "advertising";
/** In the server's order. */
export const LABEL_BASES: readonly LabelBase[] = [
  "invoice",
  "shipping",
  "appointment",
  "newsletter",
  "account",
  "personal",
  "work",
  "advertising",
];

/** What a label's own condition looks at; `hasAttachment` takes "true" or "false". */
export type LabelRuleField = "from" | "subject" | "text" | "hasAttachment";
export const LABEL_RULE_FIELDS: readonly LabelRuleField[] = ["from", "subject", "text", "hasAttachment"];

export interface LabelRuleCondition {
  field: LabelRuleField;
  /** An address, a domain or a part of one for `from`; words for `subject` and `text`. */
  value: string;
}

/** "has attachment" takes only "true" (has one) or "false" (has none); anything else means "true". */
export function attachmentValue(value: string): "true" | "false" {
  return value.trim() === "false" ? "false" : "true";
}

/** Conditions that put a label on arriving mail by themselves, without any AI. */
export interface LabelRules {
  match: "all" | "any";
  conditions: LabelRuleCondition[];
}

/** The person's own word for a kind of mail; set on mail as the keyword `keyword`. */
export interface AssistLabel {
  id: string;
  name: string;
  /** What belongs there: what the model reads. A base label's is its fixed definition. */
  description: string;
  keyword: string;
  /** Which base label it is; null for the person's own. */
  base: LabelBase | null;
  /** Put on automatically (detectors, senders, similar mail, classifier, model); off: only by hand. */
  auto: boolean;
  /** `#rrggbb`, or null for the default. */
  color: string | null;
  /** Own conditions for arriving mail; null without. */
  rules: LabelRules | null;
  /** A built-in recognizer that sets it; null for none. */
  detector: LabelDetector | null;
  /** A sender whose mail got it by hand twice gets it by itself. */
  learnSenders: boolean;
  /** The local classifier may set it once it learned enough from mail labelled by hand. */
  classifier: boolean;
  /** Mail with it, and how much of that is unread (server-set, like a folder's counts). */
  totalEmails: number;
  unreadEmails: number;
  /** Mail labelled or unlabelled by hand the classifier learned from. */
  examples: number;
  /** The person's own description a base label replaced when it was adopted (server-set). */
  previousDescription: string | null;
}

/** What may be set on a label; the automatic parts are left as they are when not named. */
export interface AssistLabelInput {
  name: string;
  description: string;
  color: string | null;
  rules?: LabelRules | null;
  detector?: LabelDetector | null;
  learnSenders?: boolean;
  classifier?: boolean;
  auto?: boolean;
}

/** A change to a label: what changes, and `previousDescription: null` to forget an adopted base label's earlier description, so the model no longer gets it as a hint. */
export type AssistLabelPatch = Partial<AssistLabelInput> & { previousDescription?: null };

/** How a label overlaps another: the same name, the meaning of a base label, or largely the same words. */
export type LabelOverlapKind = "name" | "meaning" | "words";

/** A label a new or changed one would overlap with (`AssistLabel/checkOverlap`). */
export interface LabelOverlap {
  id: string;
  name: string;
  base: LabelBase | null;
  kind: LabelOverlapKind;
  /** The words both share (for "words"). */
  words: string[];
}

/**
 * Who put a label on a mail: the model, the label's conditions, a learned sender, a detector, the
 * classifier, or its likeness to the person's mails with the label.
 */
export type LabelSource = "ai" | "rule" | "sender" | "detector" | "classifier" | "similar";

/** A label put on a mail by itself, and why. */
export interface AssistLabelLogEntry {
  id: string;
  emailId: string;
  labelId: string;
  name: string;
  keyword: string;
  /** "ai" from servers before labels without AI. */
  source: LabelSource;
  /** One sentence: the model's own words for "ai", otherwise English made from `code` and `params`. */
  reason: string;
  /** What the reason says, for putting it in the person's language (`rule`, `sender`, `invoice`, …); null when unknown. */
  code: string | null;
  /** The details `code` names. */
  params: Record<string, unknown>;
  createdAt: string;
  /** Taken off again, with undo or by removing the keyword. */
  undone: boolean;
  /** Who chose it, where the server says (newer servers); null for the automatic ones without AI. */
  providerName: string | null;
  model: string | null;
}

/**
 * Labels set by themselves without AI (conditions, senders, detectors, classifier): the server's
 * `AssistSettings.nonAiLabels`. The AI part is `AssistSettings.autoLabels`.
 */
export interface LabelSettings {
  nonAiLabels: boolean;
}

/** The model's judgement of one label for one mail. */
export interface LabelVerdict {
  labelId: string;
  fits: boolean;
  reason: string;
  /** The mail carries it already. */
  isSet: boolean;
}

/** A label the model would make for a mail none of the person's labels fit. */
export interface NewLabelSuggestion {
  name: string;
  description: string;
  color: string | null;
  reason: string;
}

/** "Label again": what the model thinks of every label for a mail; the mail itself stays as it is. */
export interface LabelSuggestions extends AssistAnswer {
  emailId: string;
  verdicts: LabelVerdict[];
  /** At most two, only when no label fits well. */
  newLabels: NewLabelSuggestion[];
}

export interface AssistUsageDay {
  day: string;
  providerId: string;
  providerName: string;
  feature: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  /** Thinking of a reasoning model, counted apart from the answer; missing or 0 from an older server. */
  reasoningTokens?: number;
  /** Null (or missing, from an older server) where the price was unknown or is hidden. */
  cost?: AssistCost | null;
}

export interface AssistUsageToday {
  providerId: string;
  providerName: string;
  requests: number;
  tokens: number;
  requestsPerDay: number | null;
  tokensPerDay: number | null;
  cost?: AssistCost | null;
}

export interface AssistUsage {
  days: AssistUsageDay[];
  today: AssistUsageToday[];
}
