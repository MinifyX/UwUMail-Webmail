/**
 * Web Push for the webmail: what the page and the service worker share.
 *
 * The server pushes a JMAP `StateChange` (RFC 8620, section 7.2) to the browser's push service
 * when mail arrives, and nothing else: no sender, no subject. The service worker (src/sw) then
 * asks the server itself, with the session cookie, what is new in the inbox and shows it. So this
 * module may not import anything of the app: it is bundled into the service worker on its own.
 */

/** The server's VAPID key for push subscriptions (RFC 9749), as `applicationServerKey`. */
export const WEBPUSH_VAPID = "urn:ietf:params:jmap:webpush-vapid";

/** The only type the webmail asks to be pushed: new mail, since every push has to show something. */
export const PUSH_TYPES = ["EmailDelivery"];
/** A week, which is what the server allows at most. */
export const LIFETIME_MS = 7 * 24 * 3600 * 1000;

/** Messages between the service worker and the page. */
export const MESSAGE_OPEN = "uwumail-push-open";
export const MESSAGE_VERIFIED = "uwumail-push-verified";

/** Texts of the notifications, in the language and tone of the webmail when push was set up. */
export interface PushTexts {
  /** Title when the content is hidden, and for a sender without a name. */
  newMail: string;
  /** Title for several at once; `{{count}}` is replaced. */
  newMails: string;
  noSubject: string;
  /** Body when the content is hidden. */
  hidden: string;
}

export const DEFAULT_TEXTS: PushTexts = {
  newMail: "New mail",
  newMails: "{{count}} new messages",
  noSubject: "(no subject)",
  hidden: "Open the webmail to read it.",
};

/** What the page leaves for the service worker in IndexedDB. */
export interface PushConfig {
  /** The login it was set up for; another login in this browser starts over. */
  login: string;
  /** The own mail account; its new mail is looked for in the inbox. */
  accountId: string;
  /**
   * Every account of the session with mail, by id, with its name (for a shared mailbox its
   * address): the own one and those others share folders from, whose new mail comes too.
   */
  accounts?: Record<string, string>;
  apiUrl: string;
  /** This browser's `deviceClientId`, for a subscription the service worker makes anew. */
  deviceClientId: string;
  /** Show sender and subject, or only that something came. */
  showContent: boolean;
  texts: PushTexts;
  /** The subscription on the server, once created. */
  subscriptionId?: string;
  /** The browser subscription's address it was made for; another one needs a new subscription. */
  endpoint?: string;
  /** When the server drops it (UTCDate), as it last said. */
  expires?: string;
}

/** What the service worker remembers about one account between pushes. */
export interface AccountProgress {
  /** Mail received before this (UTCDate) was already seen or announced. */
  since: string;
  /** Ids announced at `since` or later, so a message is never announced twice. */
  announced: string[];
  /** The account's folders as far as they matter: its inbox, and those whose mail is no news. */
  mailboxes?: { inbox: string | null; skip: string[] };
}

/** What the service worker remembers between pushes. */
export interface PushProgress {
  /** Where an account seen for the first time starts: when push was switched on. */
  since: string;
  accounts: Record<string, AccountProgress>;
}

/** A UTCDate as JMAP writes it: no fractions of a second. */
export function utcDate(date: Date): string {
  return date.toISOString().replace(/\.\d+Z$/, "Z");
}

export const CONFIG_KEY = "config";
export const PROGRESS_KEY = "progress";

/** A tiny key-value store; IndexedDB in the browser, a Map in tests. */
export interface KeyValue {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
}

const DB_NAME = "uwumail-push";
const STORE = "kv";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB is not available"));
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = work(transaction.objectStore(STORE));
        transaction.oncomplete = () => {
          db.close();
          resolve(request.result as T);
        };
        transaction.onerror = () => {
          db.close();
          reject(transaction.error ?? new Error("IndexedDB failed"));
        };
      }),
  );
}

/** The key-value store both sides use: IndexedDB, which a service worker can reach (localStorage it can't). */
export const idbKeyValue: KeyValue = {
  get: <T>(key: string) => run<T | undefined>("readonly", (store) => store.get(key)),
  set: (key, value) => run<void>("readwrite", (store) => store.put(value, key)),
  delete: (key) => run<void>("readwrite", (store) => store.delete(key)),
};

export type PushPayload =
  | { kind: "verification"; subscriptionId: string; code: string }
  | { kind: "state"; changed: Record<string, Record<string, string>> }
  | { kind: "unknown" };

/** Reads what the server pushed: a PushVerification or a StateChange. */
export function parsePayload(data: unknown): PushPayload {
  if (typeof data !== "object" || data === null) return { kind: "unknown" };
  const object = data as Record<string, unknown>;
  if (
    object["@type"] === "PushVerification" &&
    typeof object.pushSubscriptionId === "string" &&
    typeof object.verificationCode === "string"
  ) {
    return { kind: "verification", subscriptionId: object.pushSubscriptionId, code: object.verificationCode };
  }
  if (object["@type"] === "StateChange" && typeof object.changed === "object" && object.changed !== null) {
    return { kind: "state", changed: object.changed as Record<string, Record<string, string>> };
  }
  return { kind: "unknown" };
}

/** The accounts a StateChange says new mail was delivered to: the own one, or one shared with it. */
export function deliveredTo(payload: PushPayload): string[] {
  if (payload.kind !== "state") return [];
  return Object.entries(payload.changed)
    .filter(([, types]) => !!types && typeof types === "object" && "EmailDelivery" in types)
    .map(([accountId]) => accountId);
}

/** Which message a notification is about, and where it is: in the own inbox, or a shared folder. */
export interface MessageTarget {
  emailId: string;
  threadId: string;
  /** Left out for the own account, whose mail opens in the inbox. */
  accountId?: string;
  /** The shared folder the message is in. */
  mailboxId?: string;
}

/** Where a click on a notification leads when the webmail is not open: the message. */
export function openUrl(base: string, target: MessageTarget): string {
  const params = new URLSearchParams({ open: target.emailId, thread: target.threadId });
  if (target.accountId) params.set("account", target.accountId);
  if (target.mailboxId) params.set("mailbox", target.mailboxId);
  return `${base}?${params.toString()}`;
}

/** Reads a MessageTarget back from a notification's data or a message, or null. */
export function messageTarget(data: unknown): MessageTarget | null {
  if (typeof data !== "object" || data === null) return null;
  const { emailId, threadId, accountId, mailboxId } = data as Record<string, unknown>;
  if (typeof emailId !== "string" || typeof threadId !== "string") return null;
  return {
    emailId,
    threadId,
    ...(typeof accountId === "string" ? { accountId } : {}),
    ...(typeof mailboxId === "string" ? { mailboxId } : {}),
  };
}

/** A message the service worker announces. */
export interface NewMail {
  id: string;
  threadId: string;
  subject?: string | null;
  from?: { name?: string | null; email?: string | null }[] | null;
  mailboxIds?: Record<string, boolean> | null;
  receivedAt: string;
  /** For mail of a shared account: its id, its name, and the folder to open. */
  shared?: { accountId: string; name: string; mailboxId?: string };
}

export interface NotificationSpec {
  title: string;
  options: NotificationOptions & { data: Partial<MessageTarget> };
}

/** How many single notifications at most; more new mail than that becomes one summary. */
export const MAX_SINGLE = 3;

/** The notifications for new messages, newest first. Content only when the person allows it. */
export function notificationsFor(
  mails: NewMail[],
  config: Pick<PushConfig, "showContent" | "texts">,
): NotificationSpec[] {
  const { texts } = config;
  if (mails.length > MAX_SINGLE) {
    const newest = mails[0]!;
    return [
      {
        title: texts.newMails.replace("{{count}}", String(mails.length)),
        options: {
          tag: "uwumail-summary",
          body: config.showContent ? mails.map((mail) => sender(mail, texts)).join(", ") : texts.hidden,
          data: target(newest),
        },
      },
    ];
  }
  return mails.map((mail) => ({
    title: inAccount(mail, config.showContent ? sender(mail, texts) : texts.newMail),
    options: {
      tag: `uwumail-mail-${mail.shared?.accountId ?? ""}${mail.id}`,
      body: config.showContent ? mail.subject?.trim() || texts.noSubject : texts.hidden,
      data: target(mail),
    },
  }));
}

/**
 * For a push that said new mail came but where nothing new could be found (read elsewhere in the
 * meantime, the server away): a browser has to show something for every push, and says something
 * vaguer and stranger itself otherwise.
 */
export function genericNotification(config: Pick<PushConfig, "texts">): NotificationSpec {
  return { title: config.texts.newMail, options: { tag: "uwumail-new", body: config.texts.hidden, data: {} } };
}

function target(mail: NewMail): MessageTarget {
  return {
    emailId: mail.id,
    threadId: mail.threadId,
    ...(mail.shared ? { accountId: mail.shared.accountId } : {}),
    ...(mail.shared?.mailboxId ? { mailboxId: mail.shared.mailboxId } : {}),
  };
}

/** Mail of a shared mailbox says which one: "support@example.org · Nyu". */
function inAccount(mail: NewMail, title: string): string {
  return mail.shared ? `${mail.shared.name} · ${title}` : title;
}

function sender(mail: NewMail, texts: PushTexts): string {
  const first = mail.from?.[0];
  return first?.name?.trim() || first?.email?.trim() || texts.newMail;
}
