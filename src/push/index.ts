/**
 * Web Push in the page: the browser's side of `registration.ts`, the switch in the settings, the
 * renewal on every start, and opening a message a notification was clicked for.
 */

import { isDemo } from "@/backend/backend";
import { CORE, MAIL, call, jmapSession, loadJmapSession } from "@/backend/jmap/client";
import { currentSession } from "@/backend/server";
import { i18n } from "@/i18n";
import { useBrand } from "@/state/brand";
import { useSettings } from "@/state/settings";
import { useUi } from "@/state/ui";
import {
  PushError,
  disablePush,
  enablePush,
  forgetPush,
  renewPush,
  type BrowserPushManager,
  type Invocation,
  type PushDeps,
} from "./registration";
import {
  CONFIG_KEY,
  MESSAGE_OPEN,
  MESSAGE_VERIFIED,
  WEBPUSH_VAPID,
  idbKeyValue,
  messageTarget,
  type MessageTarget,
  type PushConfig,
  type PushTexts,
} from "./shared";

export { PushError };

/** Where the webmail and its service worker live: `/mail/`. */
const BASE = import.meta.env.BASE_URL;
const DEVICE_KEY = "uwumail.webmail.pushDevice";

/** Whether this browser can do Web Push at all (a secure page with service workers and notifications). */
export function browserCanPush(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

function serverKey(): string | null {
  try {
    const capability = jmapSession().capabilities[WEBPUSH_VAPID] as { applicationServerKey?: unknown } | undefined;
    return typeof capability?.applicationServerKey === "string" ? capability.applicationServerKey : null;
  } catch {
    return null;
  }
}

/** Whether the server pushes to the webmail at all. */
export function serverOffersPush(): boolean {
  return !isDemo() && serverKey() !== null;
}

/** Whether push can be switched on here: the server pushes, and this browser can take it. */
export function pushAvailable(): boolean {
  return serverOffersPush() && browserCanPush();
}

/** Stable for this browser, random, and nothing that says which device it is. */
function deviceClientId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_KEY);
    if (stored) return stored;
    const created = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY, created);
    return created;
  } catch {
    // Without storage every start is a new device; the server replaces the old subscription.
    return "uwumail-webmail";
  }
}

function texts(): PushTexts {
  const tone = useBrand.getState().mascot ? useSettings.getState().tone : "neutral";
  const t = (key: string) => i18n.t(key, { ns: tone });
  // With its placeholder: the service worker counts. It is only used for more than three.
  const many = "push.notification.newMails";
  const template =
    (i18n.getResource(i18n.language, tone, many) as string | undefined) ??
    (i18n.getResource(i18n.language, "neutral", many) as string | undefined) ??
    (i18n.getResource("en", "neutral", many) as string);
  return {
    newMail: t("push.notification.newMail"),
    newMails: template,
    noSubject: t("push.notification.noSubject"),
    hidden: t("push.notification.hidden"),
  };
}

/**
 * Registers the service worker (again; the browser only fetches it anew when it changed) and waits
 * until it runs. Not `navigator.serviceWorker.ready`: that waits for a worker controlling this
 * page, which never comes for a page outside the scope, e.g. `/mail` without its slash.
 */
async function activeRegistration(): Promise<ServiceWorkerRegistration> {
  const registration = await navigator.serviceWorker.register(`${BASE}sw.js`, { scope: BASE, updateViaCache: "none" });
  if (registration.active) return registration;
  const worker = registration.installing ?? registration.waiting;
  if (!worker) throw new PushError("unsupported", "The service worker did not start.");
  await new Promise<void>((resolve, reject) => {
    const check = () => {
      if (worker.state === "activated") resolve();
      else if (worker.state === "redundant") reject(new PushError("unsupported", "The service worker did not start."));
    };
    worker.addEventListener("statechange", check);
    check();
  });
  return registration;
}

async function pushManager(register: boolean): Promise<BrowserPushManager | null> {
  const registration = register ? await activeRegistration() : await navigator.serviceWorker.getRegistration(BASE);
  return (registration?.pushManager as unknown as BrowserPushManager | undefined) ?? null;
}

async function unregister(): Promise<void> {
  await (await navigator.serviceWorker.getRegistration(BASE))?.unregister();
}

/** Waiting for the verification ends early when the service worker says it went through. */
const verificationWaiters = new Set<() => void>();

function sleepUntilVerified(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      verificationWaiters.delete(done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    verificationWaiters.add(done);
  });
}

let listening = false;

/** What the service worker tells the page: a verification went through, a notification was clicked. */
function listen(): void {
  if (listening) return;
  listening = true;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => handleWorkerMessage(event.data));
}

/** Handles a message from the service worker. */
export function handleWorkerMessage(data: unknown): void {
  if (typeof data !== "object" || data === null) return;
  const type = (data as { type?: unknown }).type;
  if (type === MESSAGE_VERIFIED) {
    for (const wake of [...verificationWaiters]) wake();
  } else if (type === MESSAGE_OPEN) {
    const target = messageTarget(data);
    if (target) void openMessage(target);
  }
}

function deps(): PushDeps {
  return {
    kv: idbKeyValue,
    jmap: async (calls: Invocation[]) => (await call(calls, [CORE])).methodResponses,
    serverKey,
    account: () => {
      const session = jmapSession();
      const accounts = Object.fromEntries(
        Object.entries(session.accounts)
          .filter(([, account]) => MAIL in account.accountCapabilities)
          .map(([id, account]) => [id, account.name]),
      );
      return {
        login: currentSession().account.login,
        accountId: session.accountId,
        apiUrl: session.apiUrl,
        accounts,
      };
    },
    pushManager,
    unregister,
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    deviceClientId,
    texts,
    now: () => new Date(),
    sleep: sleepUntilVerified,
  };
}

/** Switches notifications on: asks for permission and sets everything up. Throws a PushError. */
export async function switchPushOn(): Promise<void> {
  listen();
  await enablePush(deps(), useSettings.getState().pushShowContent);
}

export async function switchPushOff(): Promise<void> {
  await disablePush(deps());
}

/** Whether the service worker shows sender and subject; takes effect with the next mail. */
export async function setPushShowContent(showContent: boolean): Promise<void> {
  const config = await idbKeyValue.get<PushConfig>(CONFIG_KEY).catch(() => undefined);
  if (config) await idbKeyValue.set(CONFIG_KEY, { ...config, showContent, texts: texts() });
}

let started = false;

/**
 * On every start of the webmail: renews push when it is on (a server subscription lasts a week),
 * cleans up after it when it is off, and opens the message a notification was clicked for.
 */
export async function startWebPush(): Promise<void> {
  if (started || isDemo() || !browserCanPush()) return;
  started = true;
  listen();
  openFromAddress();

  const settings = useSettings.getState();
  try {
    // The server's key is in the JMAP session.
    await loadJmapSession();
    if (settings.pushNotifications) {
      const renewal = await renewPush(deps(), settings.pushShowContent);
      // No permission any more, or a server without push: the switch shows the truth.
      if (renewal === "off") useSettings.getState().update({ pushNotifications: false });
    } else if (await navigator.serviceWorker.getRegistration(BASE)) {
      // Left from before, e.g. by another login in this browser.
      await disablePush(deps());
    }
  } catch {
    // Tried again with the next start.
  }
}

/**
 * The session ended (signed out in the portal) or the webmail was switched off: the server has
 * dropped this session's subscriptions, so the browser's goes too. The switch stays as it is, and
 * the next sign-in in this browser sets push up again without asking.
 */
export async function forgetWebPush(): Promise<void> {
  if (isDemo() || !browserCanPush()) return;
  try {
    if (!(await navigator.serviceWorker.getRegistration(BASE))) return;
    await forgetPush({
      kv: idbKeyValue,
      pushManager,
      unregister,
    });
  } catch {
    // Nothing to take down.
  }
}

/** `?open=<email>&thread=<thread>[&account=…&mailbox=…]`: a notification opened the webmail for this message. */
function openFromAddress(): void {
  const params = new URLSearchParams(window.location.search);
  const target = messageTarget({
    emailId: params.get("open"),
    threadId: params.get("thread"),
    accountId: params.get("account"),
    mailboxId: params.get("mailbox"),
  });
  if (!target) return;
  for (const key of ["open", "thread", "account", "mailbox"]) params.delete(key);
  const rest = params.toString();
  window.history.replaceState(window.history.state, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  void openMessage(target);
}

/**
 * Shows the message a notification was about, the way clicking it in the list would: mail of the
 * own account in the inbox, mail of a shared account in its folder there.
 */
export async function openMessage(target: MessageTarget): Promise<void> {
  const [{ listThreadId }, { scopeId }] = await Promise.all([
    import("@/backend/jmap/JmapBackend"),
    import("@/backend/jmap/sharing"),
  ]);
  let own: string | null = null;
  try {
    own = jmapSession().accountId;
  } catch {
    // Not loaded yet: only the own inbox can be opened.
  }
  const shared = own !== null && target.accountId && target.accountId !== own ? target.accountId : null;
  const ui = useUi.getState();
  ui.closeSettings();
  if (shared && target.mailboxId) {
    ui.setView({ kind: "folder", accountId: shared, folderId: scopeId(shared, target.mailboxId, own!) });
  } else {
    ui.setView({ kind: "unified", role: "inbox" });
  }
  ui.setFilter("all");
  ui.setSearch("");
  const scope = (id: string) => (shared ? scopeId(shared, id, own!) : id);
  const conversations = useSettings.getState().conversations;
  useUi.getState().selectThread(listThreadId(scope(target.emailId), scope(target.threadId), conversations));
}
