/**
 * The service worker's event handlers, given its global scope, so they can be tested with a fake
 * one (sw.ts hands in the real one). Only Web Push lives here: it caches nothing and never answers
 * a request in the page's stead.
 *
 * The DOM's type library has no service worker types and can't be mixed with the WebWorker one,
 * so the few parts used here are described below.
 */

import { MESSAGE_OPEN, openUrl, type KeyValue } from "@/push/shared";
import { handlePush, resubscribe, type SubscriptionJson, type WorkerEnv } from "@/push/worker";

export interface ExtendableEvent {
  waitUntil(promise: Promise<unknown>): void;
}

export interface PushEvent extends ExtendableEvent {
  data: { json(): unknown } | null;
}

export interface NotificationEvent extends ExtendableEvent {
  notification: { data: unknown; close(): void };
}

interface WorkerSubscription {
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON(): SubscriptionJson;
  unsubscribe(): Promise<boolean>;
}

export interface PushSubscriptionChangeEvent extends ExtendableEvent {
  oldSubscription: WorkerSubscription | null;
  newSubscription: WorkerSubscription | null;
}

export interface WindowClient {
  url: string;
  focused: boolean;
  visibilityState: DocumentVisibilityState;
  focus(): Promise<WindowClient>;
  postMessage(message: unknown): void;
}

export interface ServiceWorkerScope {
  registration: {
    scope: string;
    showNotification(title: string, options?: NotificationOptions): Promise<void>;
    pushManager: {
      getSubscription(): Promise<WorkerSubscription | null>;
      subscribe(options: { userVisibleOnly: boolean; applicationServerKey: ArrayBuffer }): Promise<WorkerSubscription>;
    };
  };
  clients: {
    matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<WindowClient[]>;
    openWindow(url: string): Promise<WindowClient | null>;
    claim(): Promise<void>;
  };
  fetch: typeof fetch;
  skipWaiting(): Promise<void>;
  addEventListener(type: "install" | "activate", listener: (event: ExtendableEvent) => void): void;
  addEventListener(type: "push", listener: (event: PushEvent) => void): void;
  addEventListener(type: "pushsubscriptionchange", listener: (event: PushSubscriptionChangeEvent) => void): void;
  addEventListener(type: "notificationclick", listener: (event: NotificationEvent) => void): void;
}

/** `/mail/`, where the webmail lives: the service worker's scope. */
function basePath(scope: ServiceWorkerScope): string {
  return new URL(scope.registration.scope).pathname;
}

/** The webmail's windows, the one in front first. */
async function webmailWindows(scope: ServiceWorkerScope): Promise<WindowClient[]> {
  const base = basePath(scope);
  const windows = await scope.clients.matchAll({ type: "window", includeUncontrolled: true });
  return windows
    .filter((client) => {
      const path = new URL(client.url).pathname;
      return path.startsWith(base) || `${path}/` === base;
    })
    .sort((a, b) => Number(b.focused) - Number(a.focused));
}

/** What the push handling needs, from the service worker's scope. */
export function workerEnv(scope: ServiceWorkerScope, kv: KeyValue): WorkerEnv {
  return {
    kv,
    fetch: (input, init) => scope.fetch(input, init),
    showNotification: (spec) =>
      scope.registration.showNotification(spec.title, {
        icon: `${basePath(scope)}uwumail-app-icon.svg`,
        ...spec.options,
      }),
    webmailInFront: async () =>
      (await webmailWindows(scope)).some((client) => client.focused && client.visibilityState === "visible"),
    postToClients: async (message) => {
      for (const client of await webmailWindows(scope)) client.postMessage(message);
    },
    unsubscribe: async () => {
      await (await scope.registration.pushManager.getSubscription())?.unsubscribe();
    },
    now: () => new Date(),
  };
}

/** The browser's new subscription after a `pushsubscriptionchange`, made here when it brought none. */
async function replacement(
  scope: ServiceWorkerScope,
  event: PushSubscriptionChangeEvent,
): Promise<SubscriptionJson | null> {
  if (event.newSubscription) return event.newSubscription.toJSON();
  const key = event.oldSubscription?.options.applicationServerKey;
  if (!key) return null;
  try {
    const fresh = await scope.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
    return fresh.toJSON();
  } catch {
    return null;
  }
}

/** Opens the message a notification was for: in a webmail window that is open, or in a new one. */
async function openFromNotification(scope: ServiceWorkerScope, data: unknown): Promise<void> {
  const { emailId, threadId } = (data ?? {}) as { emailId?: unknown; threadId?: unknown };
  const message = typeof emailId === "string" && typeof threadId === "string" ? { emailId, threadId } : null;
  const [open] = await webmailWindows(scope);
  if (open) {
    await open.focus();
    if (message) open.postMessage({ type: MESSAGE_OPEN, ...message });
    return;
  }
  const base = basePath(scope);
  await scope.clients.openWindow(message ? openUrl(base, message.emailId, message.threadId) : base);
}

export function attach(scope: ServiceWorkerScope, env: WorkerEnv): void {
  // A new version takes over at once: there is no cache that could be out of step with the page.
  scope.addEventListener("install", (event) => event.waitUntil(scope.skipWaiting()));
  scope.addEventListener("activate", (event) => event.waitUntil(scope.clients.claim()));

  scope.addEventListener("push", (event) => {
    let data: unknown = null;
    try {
      data = event.data?.json() ?? null;
    } catch {
      // Not JSON: nothing the server sent.
    }
    event.waitUntil(handlePush(env, data));
  });

  scope.addEventListener("pushsubscriptionchange", (event) => {
    event.waitUntil(replacement(scope, event).then((fresh) => resubscribe(env, fresh)));
  });

  scope.addEventListener("notificationclick", (event) => {
    event.notification.close();
    event.waitUntil(openFromNotification(scope, event.notification.data));
  });
}
