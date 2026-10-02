import type { DomainSignatureChange, DomainSignatureOverview } from "@/lib/domainSignatures";
import type {
  Account,
  AddressBookInfo,
  AssistComposeRequest,
  AssistComposeResult,
  AssistEstimate,
  AssistEstimateRequest,
  AssistEventsResult,
  AssistFeatures,
  AssistLabel,
  AssistLabelInput,
  AssistLabelLogEntry,
  LabelSettings,
  LabelSuggestions,
  AssistModels,
  AssistOptions,
  AssistProvider,
  AssistProviderInput,
  AssistSettings,
  AssistSettingsPatch,
  AssistSpamCheck,
  AssistStreamHandlers,
  AssistSummarizeRequest,
  AssistSummary,
  AssistUsage,
  AttachmentContent,
  BackendEvent,
  BirthdayImportEntry,
  BirthdayImportResult,
  BirthdayScan,
  ChatgptLogin,
  ChatgptPoll,
  BlockedSender,
  CalendarInfo,
  CalendarOccurrence,
  Contact,
  ContactInput,
  ContactRecord,
  DraftContent,
  DraftSaveResult,
  EventDeleteScope,
  EventInput,
  FlagChange,
  Folder,
  Identity,
  MailScheduling,
  MaskedAddress,
  MaskedAddressInput,
  MaskedAddressPatch,
  MaskedOptions,
  MailtoDraft,
  MovedMessage,
  OutgoingMessage,
  ParticipationStatus,
  Person,
  ProfilePicture,
  ProfilePictureOptions,
  ProfilePicturePatch,
  ScheduledSend,
  SendOptions,
  SendReceipt,
  SenderPicture,
  SenderPictureLookup,
  ShareLevel,
  SharedAccount,
  Signature,
  ThreadDetail,
  ThreadPage,
  ThreadQuery,
  UnsubscribeOutcome,
  ImageSizeProbe,
  ImageTextResult,
} from "./types";
import type { ImageProxy } from "@/lib/remoteImages";
import type { SaveOutcome } from "@/lib/settingsSyncQueue";

export type BackendErrorCode =
  | "auth_failed"
  | "connection_failed"
  | "not_found"
  | "invalid_input"
  | "not_supported"
  | "internal"
  /** The session ended: the portal has to sign in again. */
  | "signed_out"
  /** An administrator switched the webmail off for this server or this account. */
  | "webmail_disabled"
  /** The mail is already on its way and can't be taken back. */
  | "too_late"
  /** The folder's owner didn't allow this (a folder shared with the account). */
  | "forbidden";

export type SignatureStore = "identity" | "settings" | null;

export class BackendError extends Error {
  readonly code: BackendErrorCode;

  constructor(code: BackendErrorCode, message: string) {
    super(message);
    this.name = "BackendError";
    this.code = code;
  }
}

/**
 * A refusal of the AI assistant, with the server's `type`: `assistUnavailable` (switched off, or
 * no provider may do it), `overQuota` (the day's limit is used up), `providerFailed` (the model
 * didn't give a usable answer; `retryAfter` seconds when it named them), `notFound`, `forbidden`,
 * `invalidArguments` or, for a refused create or update, `invalidProperties`.
 */
export class AssistError extends BackendError {
  readonly type: string;
  /** The server's own words, for administrators more than for people. */
  readonly description: string | null;
  readonly retryAfter: number | null;
  /** For `invalidProperties`: the fields it names. */
  readonly properties: string[];

  constructor(
    type: string,
    description: string | null = null,
    extra: { retryAfter?: number | null; properties?: string[] } = {},
  ) {
    super(assistErrorCode(type), description ?? type);
    this.name = "AssistError";
    this.type = type;
    this.description = description;
    this.retryAfter = extra.retryAfter ?? null;
    this.properties = extra.properties ?? [];
  }
}

function assistErrorCode(type: string): BackendErrorCode {
  switch (type) {
    case "assistUnavailable":
    case "unknownMethod":
    case "unknownCapability":
      return "not_supported";
    case "notFound":
      return "not_found";
    case "forbidden":
    case "overQuota":
      return "forbidden";
    case "invalidArguments":
    case "invalidProperties":
      return "invalid_input";
    case "providerFailed":
      return "connection_failed";
    default:
      return "internal";
  }
}

/**
 * Everything the webmail needs from the server.
 *
 * The shape comes from the UwUMail app, where a Rust engine answers it. Here a
 * JMAP client in the browser does, which is why some of it is simpler: there is
 * exactly one account, it is never set up from this side, and anything about
 * the account itself (passwords, forwarding, away messages) belongs to the
 * portal, not here.
 */
export interface Backend {
  readonly kind: "jmap" | "demo";

  /** Always exactly one: the mailbox this session belongs to. */
  listAccounts(): Promise<Account[]>;
  /** The mailbox's own address first, then the aliases the server knows. */
  listIdentities(): Promise<Identity[]>;
  /**
   * Where signatures live: on the sending addresses (`Identity` signatures, one per address), in
   * the settings extension (several per address, older servers), or nowhere.
   */
  signatureStore(): Promise<SignatureStore>;
  /** Whether the server keeps the account's settings (its settings extension) for the settings sync. */
  userSettingsAvailable(): Promise<boolean>;
  /** The account's shared settings, see lib/settingsSync. */
  loadUserSettings(): Promise<{ state: string; values: Record<string, unknown> }>;
  /** Sets keys (`null` removes); with `ifInState` only if nothing was written since. */
  saveUserSettings(patch: Record<string, unknown>, ifInState?: string): Promise<SaveOutcome>;
  listSignatures(): Promise<Signature[]>;
  /**
   * Creates the signature when its id is empty. Taking a default for an address takes it from the
   * others. With identity signatures, sets the one signature of `signature.email`.
   */
  saveSignature(signature: Signature): Promise<Signature>;
  deleteSignature(signatureId: string): Promise<void>;
  /**
   * Signatures per domain, for every domain and per address, with the domains' company signatures
   * (lib/domainSignatures); null when the server has no such thing. The addresses' effective
   * signatures still come from listSignatures.
   */
  domainSignatures(): Promise<DomainSignatureOverview | null>;
  /** Sets or removes signatures, all at once or none; returns the overview after the change. */
  saveDomainSignatures(change: DomainSignatureChange): Promise<DomainSignatureOverview>;
  syncNow(accountId?: string): Promise<void>;

  /** The own folders, then those of every person who shares folders with the account (see sharedAccounts). */
  listFolders(accountId?: string): Promise<Folder[]>;
  /** People who share folders with this account; their folders come with listFolders under their account id. */
  sharedAccounts(): Promise<SharedAccount[]>;
  /** Whether folders (and calendars) can be shared from here: the server lists its people. */
  sharingAvailable(): Promise<boolean>;
  /** The people on the server to share with, without the account itself. */
  people(): Promise<Person[]>;
  /** Shares a folder with a person at a level; `null` stops sharing it with them. */
  shareFolder(folderId: string, personId: string, level: ShareLevel | null): Promise<void>;
  /** Returns the new folder's id; `parentId` null puts it at the top level. */
  createFolder(input: { accountId?: string; name: string; parentId: string | null }): Promise<string>;
  renameFolder(folderId: string, name: string): Promise<void>;
  /** Moves the folder's mail to the trash first; refuses while it holds folders. Not for role folders. */
  deleteFolder(folderId: string): Promise<void>;
  /** Trash and junk only: deletes everything in it for good and returns how many went. */
  emptyFolder(folderId: string): Promise<number>;
  listThreads(query: ThreadQuery): Promise<ThreadPage>;
  getThread(threadId: string, conversations: boolean): Promise<ThreadDetail>;

  setFlags(messageIds: string[], change: FlagChange): Promise<void>;
  /** These return what moved and from where, for undoing. Mail already in that folder stays and isn't returned. */
  archive(messageIds: string[]): Promise<MovedMessage[]>;
  trash(messageIds: string[]): Promise<MovedMessage[]>;
  /** Deletes mail in the trash for good; mail elsewhere stays. Returns how many went. */
  deleteForever(messageIds: string[]): Promise<number>;
  moveMessages(messageIds: string[], folderId: string): Promise<MovedMessage[]>;
  /** Spam goes into the junk folder; not spam back to the inbox. */
  markSpam(messageIds: string[], spam: boolean): Promise<MovedMessage[]>;
  /** What this server keeps on the account's blocked list. */
  blockedSenders(): Promise<BlockedSender[]>;
  /**
   * Unsubscribes: with one click through the server where it can (RFC 8058), otherwise, or with
   * `oneClick: false`, with a mail where the header names an address, else the page to open.
   */
  unsubscribe(messageId: string, options?: { oneClick?: boolean }): Promise<UnsubscribeOutcome>;
  /** Inbox mail from an address, e.g. a newsletter's earlier issues. */
  inboxMessagesFrom(email: string): Promise<string[]>;
  blockSender(entry: string, accountId?: string): Promise<BlockedSender>;
  unblockSender(sender: BlockedSender): Promise<void>;
  /**
   * Hands the mail to the server, which holds it back for the "undo send" window, or until
   * `options.sendAt`. Resolves once the server has it, not once it went.
   */
  send(message: OutgoingMessage, options?: SendOptions): Promise<SendReceipt>;
  /**
   * Stops a mail the server still holds back and puts it into Drafts again, for the composer.
   * Throws `too_late` once it is on its way.
   */
  cancelSend(submissionId: string): Promise<DraftContent>;
  /** Mail the server still holds back, soonest first. */
  scheduledSends(): Promise<ScheduledSend[]>;
  /** How far ahead "send later" may go, in seconds; 0 where the server can't hold mail. */
  maxSendDelay(): Promise<number>;
  /** Saves into the Drafts folder, replacing the draft's earlier version. */
  saveDraft(draft: OutgoingMessage): Promise<DraftSaveResult>;
  deleteDraft(accountId: string, draftKey: string): Promise<void>;
  openDraft(messageId: string): Promise<DraftContent>;

  /** Whether the server keeps calendars (JMAP Calendars); without it the calendar stays hidden. */
  calendarsAvailable(): Promise<boolean>;
  calendars(): Promise<CalendarInfo[]>;
  createCalendar(input: { accountId?: string; name: string; color: string | null }): Promise<CalendarInfo>;
  updateCalendar(id: string, patch: { name?: string; color?: string | null; isVisible?: boolean }): Promise<void>;
  /** Removes the calendar with its events. */
  deleteCalendar(id: string): Promise<void>;
  setDefaultCalendar(id: string): Promise<void>;
  /** Every occurrence overlapping [from, to), wall times in `timeZone`, series expanded. */
  calendarEvents(from: string, to: string, timeZone: string): Promise<CalendarOccurrence[]>;
  /** Returns the new event's id. */
  createEvent(input: EventInput): Promise<string>;
  /**
   * Changes the whole event (the series, for a repeating one); only what differs is sent.
   * `occurrenceStart` is the start of the occurrence the edit began from: a repeating event's
   * start moves by as much as that occurrence's start was moved, instead of jumping to its date.
   */
  updateEvent(eventId: string, input: EventInput, occurrenceStart?: string): Promise<void>;
  deleteEvent(occurrenceId: string, scope: EventDeleteScope): Promise<void>;
  /** Answers an invitation (the event's `invitation`); the organizer is told. */
  respondToInvitation(eventId: string, participantKey: string, status: ParticipationStatus): Promise<void>;
  /**
   * The invitation, cancellation or answer a mail carries, with the event as it sits in the
   * calendar and whether the mail comes from who may say that; null when there is none.
   */
  mailInvitation(messageId: string): Promise<MailScheduling | null>;
  /** Shares a calendar with a person at a level; `null` stops sharing it with them. */
  shareCalendar(calendarId: string, personId: string, level: ShareLevel | null): Promise<void>;
  /** Whether birthday events of other calendars can be moved into the contacts (the birthdays extension). */
  birthdayImportAvailable(): Promise<boolean>;
  /** The birthday events of the calendars, each with the contacts it may belong to. */
  scanBirthdays(): Promise<BirthdayScan>;
  /**
   * Moves found birthdays into contacts; each event is deleted once its birthday is in the
   * contact, never when that failed. Events left out stay as they are.
   */
  importBirthdays(entries: BirthdayImportEntry[]): Promise<BirthdayImportResult>;

  /** Whether the server filters incoming mail with rules (JMAP Sieve); without an id, whether any mailbox does. */
  mailRulesAvailable(accountId?: string): Promise<boolean>;
  /**
   * The script named "UwUMail" (see lib/sieveRules), null when there is none yet, and whether it
   * filters. `otherActive` names another script that filters the mail instead (written elsewhere),
   * which saving the rules would switch off.
   */
  mailRules(accountId?: string): Promise<{ script: string | null; active: boolean; otherActive?: string | null }>;
  /** Stores the script as "UwUMail" and makes it the active one (a server runs only one). */
  saveMailRules(script: string, accountId?: string): Promise<void>;
  /** The server's complaint about a script, or null when it would take it. */
  validateMailRules(script: string, accountId?: string): Promise<string | null>;

  /** Whether the server keeps address books (JMAP Contacts); without it the contacts stay hidden. */
  contactsAvailable(): Promise<boolean>;
  addressBooks(): Promise<AddressBookInfo[]>;
  createAddressBook(name: string): Promise<AddressBookInfo>;
  renameAddressBook(id: string, name: string): Promise<void>;
  /** Removes the address book with its contacts. */
  deleteAddressBook(id: string): Promise<void>;
  setDefaultAddressBook(id: string): Promise<void>;
  /** Every contact of every address book. */
  contacts(): Promise<ContactRecord[]>;
  /** Returns the new contact's id. */
  createContact(input: ContactInput): Promise<string>;
  /** Changes what the editor shows and leaves the rest of the card as it is. */
  updateContact(id: string, input: ContactInput): Promise<void>;
  deleteContact(id: string): Promise<void>;
  /** Address suggestions for the composer: the server ranks address books and mail history, older ones only the address books. */
  searchContacts(query: string): Promise<Contact[]>;

  /**
   * Whether the server makes masked addresses for the account (Fastmail's MaskedEmail extension)
   * and on which domains; null without it, and the section stays hidden.
   */
  maskedOptions(): Promise<MaskedOptions | null>;
  /** Every masked address of the account, deleted ones included, newest first. */
  maskedAddresses(): Promise<MaskedAddress[]>;
  /** Makes one, `enabled`. Throws `forbidden` when the domain isn't allowed or the limit is reached. */
  createMaskedAddress(input: MaskedAddressInput): Promise<MaskedAddress>;
  /** Changes the state (a deleted one may come back) or what it says about itself. */
  updateMaskedAddress(id: string, patch: MaskedAddressPatch): Promise<void>;

  /** Whether the account may have a profile picture here, and what the server allows; null without. */
  profilePictureOptions(): Promise<ProfilePictureOptions | null>;
  profilePicture(): Promise<ProfilePicture>;
  /** Stores a new picture (the server crops, scales and cleans it again), or removes it with null. */
  setProfilePicture(picture: Blob | null): Promise<ProfilePicture>;
  /** Changes who sees it and whether mails carry it. Throws `forbidden` for public where it isn't allowed. */
  updateProfilePicture(patch: ProfilePicturePatch): Promise<void>;

  /**
   * What the AI assistant may do for the account (the server's `urn:uwumail:jmap:assist`); null
   * without it, and everything about it stays hidden.
   */
  assistOptions(): Promise<AssistOptions | null>;
  /** Per feature whether the assistant can do it now; null without the assistant. */
  assistFeatures(): Promise<AssistFeatures | null>;
  /** The server's providers the person may use (in the admin's order), then their own. */
  assistProviders(): Promise<AssistProvider[]>;
  /** Adds an own provider. Throws an `AssistError` (`forbidden`, `overQuota`, `invalidProperties`). */
  createAssistProvider(input: AssistProviderInput): Promise<AssistProvider>;
  updateAssistProvider(id: string, patch: AssistProviderInput): Promise<void>;
  deleteAssistProvider(id: string): Promise<void>;
  /** Asks the provider for its models; doubles as a test of the key. */
  assistModels(providerId: string): Promise<AssistModels>;
  /** Starts the device-code sign-in of a `chatgpt` provider (experimental). */
  chatgptLogin(providerId: string): Promise<ChatgptLogin>;
  /** Whether that sign-in went through; ask every `interval` seconds while `pending`. */
  chatgptPoll(providerId: string): Promise<ChatgptPoll>;
  assistSettings(): Promise<AssistSettings>;
  updateAssistSettings(patch: AssistSettingsPatch): Promise<void>;
  /**
   * Writes or rewrites a text; nothing goes into a draft. With handlers the text arrives in
   * pieces while the model writes it (where the server streams); the whole answer at the end.
   */
  assistCompose(request: AssistComposeRequest, handlers?: AssistStreamHandlers): Promise<AssistComposeResult>;
  /** Summarizes a mail or a conversation, streaming like `assistCompose`. */
  assistSummarize(request: AssistSummarizeRequest, handlers?: AssistStreamHandlers): Promise<AssistSummary>;
  /** A second opinion on a mail, with the server's own findings about it. */
  assistSpamCheck(emailId: string, language?: string): Promise<AssistSpamCheck>;
  /**
   * Appointments, deadlines and trips in a mail, for "add to calendar". With `includeImages` the
   * text in the mail's pictures is read too (where the server can).
   */
  extractEvents(emailId: string, includeImages: boolean): Promise<AssistEventsResult>;
  /**
   * About what a call would cost, without asking the model; null where the server can't tell
   * (an older one without `Assist/estimate`).
   */
  assistEstimate(request: AssistEstimateRequest, currency?: string): Promise<AssistEstimate | null>;
  /** What the person used: per day (UTC) and feature, and today per provider with its limits. */
  assistUsage(days?: number, currency?: string): Promise<AssistUsage>;
  assistLabels(): Promise<AssistLabel[]>;
  createAssistLabel(input: AssistLabelInput): Promise<AssistLabel>;
  updateAssistLabel(id: string, patch: Partial<AssistLabelInput>): Promise<void>;
  /** Also takes its keyword off every mail. */
  deleteAssistLabel(id: string): Promise<void>;
  /** Labels the model set, newest first: for these mails, or the latest. */
  assistLabelLog(emailIds: string[] | null, limit?: number): Promise<AssistLabelLogEntry[]>;
  /** Takes labels the model set off again, by log entry. */
  undoAssistLabels(logIds: string[]): Promise<void>;
  /** Asks the model now for mail that came before auto-labels were on; label ids per mail. */
  applyAssistLabels(emailIds: string[]): Promise<Record<string, string[]>>;
  /**
   * "Label again": the model judges every label for this mail and may suggest new ones. Changes
   * nothing; applying is `setFlags` with the keywords (and `createAssistLabel` for a new one).
   */
  suggestLabels(emailId: string, language?: string): Promise<LabelSuggestions>;
  /** Whether labels are set by themselves without AI (conditions, senders, detectors, classifier). */
  labelSettings(): Promise<LabelSettings>;
  updateLabelSettings(patch: Partial<LabelSettings>): Promise<void>;
  /** The newest mails of the own inbox (for labelling mail that came before auto-labels). */
  recentInboxIds(limit: number): Promise<string[]>;

  /** Downloads the attachment and hands out a blob URL for it. */
  getAttachment(attachmentId: string): Promise<AttachmentContent>;
  /** Hands the file to the browser's downloads. */
  saveAttachment(attachmentId: string): Promise<boolean>;
  /** The whole mail as an .eml file. */
  saveMessage(messageId: string): Promise<boolean>;

  /**
   * The picture for one address, as the server finds it: a contact's photo, the person's own
   * picture, or the company's logo or website icon. Null when there is none.
   */
  getSenderPicture(email: string, lookup?: SenderPictureLookup): Promise<SenderPicture | null>;
  /**
   * Where to show a contact's photo from: a `data:` one as it is, an `https:` one through the
   * server's picture proxy, never directly. Null when it can't be shown.
   */
  contactPhotoUrl(photo: string): string | null;
  /** The logo of the company behind an address, e.g. for a contact's picture; null without one. */
  companyLogo(email: string): Promise<Blob | null>;
  /** A remote image of a mail, for dark mode to recolor; null where the page has to do without. */
  fetchMailImage(url: string): Promise<Blob | null>;
  /**
   * Where a mail's remote pictures load from so their senders never see the reader: the server
   * fetches them. Null where there is no such server; the pictures then load directly.
   */
  imageProxy(): ImageProxy | null;
  /**
   * Asks the server for the sizes of remote pictures before they load, so the reader can hold
   * their place and skip dead hosts. Null where the server can't; the pictures then load directly.
   */
  imageSizes(): ImageSizeProbe | null;
  /**
   * The text in a mail's pictures (OCR by the server), e.g. for dates on a poster. Remote pictures
   * are only read when `remote` is true, which the reader passes only once they may load.
   */
  imageText(emailId: string, remote: boolean): Promise<ImageTextResult>;
  /** Main domain of a company address (`news.shop.example` → `shop.example`); null for mail providers. */
  companyDomain(email: string): Promise<string | null>;

  /** The mailto: link the webmail was opened with, handed out once. */
  takeMailto(): Promise<MailtoDraft | null>;

  subscribe(listener: (event: BackendEvent) => void): () => void;
}

let instance: Backend | null = null;

/** Sample data instead of a server: `pnpm dev:demo`, or `pnpm dev` without one configured. */
export function isDemo(): boolean {
  return import.meta.env.MODE === "demo" || import.meta.env.VITE_DEMO === "1";
}

let loading: Promise<Backend> | null = null;

/** Loads the backend once; calls that overlap (React runs effects twice in development) share it. */
export function loadBackend(): Promise<Backend> {
  loading ??= (async () => {
    if (isDemo()) {
      const { DemoBackend } = await import("./demo");
      instance = new DemoBackend();
    } else {
      const { JmapBackend } = await import("./jmap/JmapBackend");
      instance = new JmapBackend();
    }
    return instance;
  })();
  return loading;
}

export function backend(): Backend {
  if (!instance) throw new Error("Backend not loaded yet. Call loadBackend() first.");
  return instance;
}
