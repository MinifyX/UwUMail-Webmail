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
  accountId: string;
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

/** What the service worker remembers between pushes. */
export interface PushProgress {
  /** Mail received before this (UTCDate) was already seen or announced. */
  since: string;
  /** Ids announced at `since` or later, so a message is never announced twice. */
  announced: string[];
  inboxId?: string;
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

/** Whether a StateChange says new mail was delivered to this account. */
export function newMailIn(payload: PushPayload, accountId: string): boolean {
  if (payload.kind !== "state") return false;
  const types = payload.changed[accountId];
  return !!types && typeof types === "object" && "EmailDelivery" in types;
}

/** Where a click on a notification leads when the webmail is not open: the message, in the inbox. */
export function openUrl(base: string, emailId: string, threadId: string): string {
  const params = new URLSearchParams({ open: emailId, thread: threadId });
  return `${base}?${params.toString()}`;
}

/** A message the service worker announces. */
export interface NewMail {
  id: string;
  threadId: string;
  subject?: string | null;
  from?: { name?: string | null; email?: string | null }[] | null;
  receivedAt: string;
}

export interface NotificationSpec {
  title: string;
  options: NotificationOptions & { data: { emailId?: string; threadId?: string } };
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
          data: { emailId: newest.id, threadId: newest.threadId },
        },
      },
    ];
  }
  return mails.map((mail) => ({
    title: config.showContent ? sender(mail, texts) : texts.newMail,
    options: {
      tag: `uwumail-mail-${mail.id}`,
      body: config.showContent ? mail.subject?.trim() || texts.noSubject : texts.hidden,
      data: { emailId: mail.id, threadId: mail.threadId },
    },
  }));
}

function sender(mail: NewMail, texts: PushTexts): string {
  const first = mail.from?.[0];
  return first?.name?.trim() || first?.email?.trim() || texts.newMail;
}
