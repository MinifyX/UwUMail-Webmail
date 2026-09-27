/**
 * Setting Web Push up, keeping it alive and taking it down, from the page.
 *
 * The browser makes a push subscription for the server's VAPID key (from the JMAP session, RFC
 * 9749); the server learns of it through `PushSubscription/set` (RFC 8620, 7.2) and proves the
 * address works by pushing a verification code, which the service worker sends back. A server
 * subscription lasts a week at most, so every start of the webmail renews it.
 *
 * Everything the outside world offers comes in as `PushDeps`, so the steps can be tested without
 * a browser.
 */

import {
  CONFIG_KEY,
  LIFETIME_MS,
  PROGRESS_KEY,
  PUSH_TYPES,
  utcDate,
  type KeyValue,
  type PushConfig,
  type PushProgress,
  type PushTexts,
} from "./shared";

export { PUSH_TYPES };

export type Invocation = [string, Record<string, unknown>, string];

/** What the browser's PushSubscription offers that is needed here. */
export interface BrowserSubscription {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null };
  toJSON(): { keys?: Record<string, string | undefined> };
  unsubscribe(): Promise<boolean>;
}

export interface BrowserPushManager {
  getSubscription(): Promise<BrowserSubscription | null>;
  subscribe(options: {
    userVisibleOnly: boolean;
    applicationServerKey: Uint8Array<ArrayBuffer>;
  }): Promise<BrowserSubscription>;
}

export interface PushDeps {
  kv: KeyValue;
  /** One JMAP request with `urn:ietf:params:jmap:core`; answers the method responses. */
  jmap: (calls: Invocation[]) => Promise<Invocation[]>;
  /** The server's applicationServerKey, base64url; null when it offers none. */
  serverKey: () => string | null;
  /** Who is signed in, and where the API is. */
  account: () => { login: string; accountId: string; apiUrl: string };
  /**
   * The service worker's push manager. With `register`, the worker is registered (again) and this
   * waits until it is active; without, it answers null when there is none.
   */
  pushManager: (register: boolean) => Promise<BrowserPushManager | null>;
  /** Takes the service worker away. */
  unregister: () => Promise<void>;
  /** "granted", "denied" or "default". */
  permission: () => NotificationPermission;
  requestPermission: () => Promise<NotificationPermission>;
  /** Stable for this browser, and nothing that names the device. */
  deviceClientId: () => string;
  texts: () => PushTexts;
  now: () => Date;
  sleep: (ms: number) => Promise<void>;
}

export type PushFailure = "unsupported" | "denied" | "unverified" | "failed";

export class PushError extends Error {
  readonly reason: PushFailure;

  constructor(reason: PushFailure, message: string) {
    super(message);
    this.reason = reason;
  }
}

/** How long to wait for the verification code to go round. */
const VERIFY_TRIES = 15;
const VERIFY_PAUSE_MS = 1000;

interface ServerSubscription {
  id: string;
  deviceClientId: string;
  verificationCode: string | null;
  expires: string | null;
}

/** base64url (with or without padding) to bytes, as `pushManager.subscribe` wants the key. */
export function decodeKey(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function sameKey(subscription: BrowserSubscription, key: Uint8Array): boolean {
  const own = subscription.options?.applicationServerKey;
  if (!own) return false;
  const bytes = new Uint8Array(own);
  return bytes.length === key.length && bytes.every((byte, index) => byte === key[index]);
}

function responseOf<T>(responses: Invocation[], id: string): T {
  const found = responses.find(([, , callId]) => callId === id);
  if (!found) throw new PushError("failed", `The server left out the answer to ${id}.`);
  if (found[0] === "error") throw new PushError("failed", `The server refused ${id}: ${JSON.stringify(found[1])}`);
  return found[1] as T;
}

async function ownSubscriptions(deps: PushDeps): Promise<ServerSubscription[]> {
  const responses = await deps.jmap([["PushSubscription/get", { ids: null }, "g"]]);
  const list = responseOf<{ list: ServerSubscription[] }>(responses, "g").list;
  return list.filter((subscription) => subscription.deviceClientId === deps.deviceClientId());
}

function expires(deps: PushDeps): string {
  return utcDate(new Date(deps.now().getTime() + LIFETIME_MS));
}

/** A browser subscription for the server's key: the one there is, or a new one. */
async function browserSubscription(deps: PushDeps, key: Uint8Array<ArrayBuffer>): Promise<BrowserSubscription> {
  const manager = await deps.pushManager(true);
  if (!manager) throw new PushError("unsupported", "The service worker did not start.");
  const current = await manager.getSubscription();
  if (current && sameKey(current, key)) return current;
  // Made for another key (the server's changed, RFC 9749 section 5): it can't be used any more.
  if (current) await current.unsubscribe();
  return manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
}

type Subscribed = Pick<PushConfig, "subscriptionId" | "endpoint" | "expires">;

async function writeConfig(deps: PushDeps, showContent: boolean, subscribed: Subscribed = {}): Promise<PushConfig> {
  const account = deps.account();
  const config: PushConfig = {
    login: account.login,
    accountId: account.accountId,
    apiUrl: account.apiUrl,
    deviceClientId: deps.deviceClientId(),
    showContent,
    texts: deps.texts(),
    ...subscribed,
  };
  await deps.kv.set(CONFIG_KEY, config);
  return config;
}

/**
 * Sets push up from scratch: permission, service worker, browser subscription, server
 * subscription and its verification. Asks for permission only when `ask` is set, i.e. when the
 * person just switched it on.
 */
export async function enablePush(deps: PushDeps, showContent: boolean, ask = true): Promise<void> {
  const serverKey = deps.serverKey();
  if (!serverKey) throw new PushError("unsupported", "The server offers no Web Push.");
  let permission = deps.permission();
  if (permission === "default" && ask) permission = await deps.requestPermission();
  if (permission !== "granted") throw new PushError("denied", "Notifications are not allowed.");

  const key = decodeKey(serverKey);
  const subscription = await browserSubscription(deps, key);
  const keys = subscription.toJSON().keys ?? {};
  if (!keys.p256dh || !keys.auth) throw new PushError("unsupported", "The browser gave no encryption keys.");

  // The service worker needs to know where to send the code before it can arrive.
  await writeConfig(deps, showContent);
  // Old mail waiting unread is not news.
  await deps.kv.set(PROGRESS_KEY, { since: utcDate(deps.now()), announced: [] } satisfies PushProgress);

  const stale = await ownSubscriptions(deps);
  const asked = expires(deps);
  const responses = await deps.jmap([
    [
      "PushSubscription/set",
      {
        ...(stale.length > 0 ? { destroy: stale.map((s) => s.id) } : {}),
        create: {
          push: {
            deviceClientId: deps.deviceClientId(),
            url: subscription.endpoint,
            keys: { p256dh: keys.p256dh, auth: keys.auth },
            expires: asked,
            types: PUSH_TYPES,
          },
        },
      },
      "s",
    ],
  ]);
  const set = responseOf<{
    created?: Record<string, { id: string; expires?: string }> | null;
    notCreated?: Record<string, unknown> | null;
  }>(responses, "s");
  const created = set.created?.push;
  if (!created?.id) {
    throw new PushError("failed", `The server did not take the subscription: ${JSON.stringify(set.notCreated)}`);
  }
  const id = created.id;
  await writeConfig(deps, showContent, {
    subscriptionId: id,
    endpoint: subscription.endpoint,
    expires: created.expires ?? asked,
  });

  for (let attempt = 0; attempt < VERIFY_TRIES; attempt++) {
    const found = (await ownSubscriptions(deps)).find((s) => s.id === id);
    if (found?.verificationCode) return;
    await deps.sleep(VERIFY_PAUSE_MS);
  }
  throw new PushError("unverified", "The browser's push service did not deliver the verification in time.");
}

/** How a renewal went: working, switched off for good (no permission, no server support), or failed for now. */
export type Renewal = "ok" | "off" | "failed";

/**
 * Keeps push alive on every start of the webmail: renews the server subscription's expiry when
 * everything is as it was, sets it up again when something is missing.
 */
export async function renewPush(deps: PushDeps, showContent: boolean): Promise<Renewal> {
  const serverKey = deps.serverKey();
  if (!serverKey || deps.permission() !== "granted") {
    await disablePush(deps);
    return "off";
  }
  const config = await deps.kv.get<PushConfig>(CONFIG_KEY);
  const account = deps.account();
  const manager = await deps.pushManager(true);
  const current = manager ? await manager.getSubscription() : null;
  const intact =
    config?.subscriptionId &&
    config.login === account.login &&
    config.accountId === account.accountId &&
    current &&
    // The browser may have replaced its subscription since (pushsubscriptionchange).
    current.endpoint === config.endpoint &&
    sameKey(current, decodeKey(serverKey));
  if (intact) {
    try {
      const found = (await ownSubscriptions(deps)).find((s) => s.id === config.subscriptionId);
      if (found?.verificationCode) {
        const asked = expires(deps);
        const responses = await deps.jmap([
          ["PushSubscription/set", { update: { [found.id]: { expires: asked } } }, "s"],
        ]);
        const set = responseOf<{ updated?: Record<string, { expires?: string } | null> | null }>(responses, "s");
        if (set.updated && found.id in set.updated) {
          // The language, the tone or the choice about content may have changed since.
          await writeConfig(deps, showContent, {
            subscriptionId: found.id,
            endpoint: current.endpoint,
            expires: set.updated[found.id]?.expires ?? asked,
          });
          return "ok";
        }
      }
    } catch {
      // The server is away: the subscription holds for days yet, the next start tries again.
      return "failed";
    }
  }
  try {
    await enablePush(deps, showContent, false);
    return "ok";
  } catch (error) {
    return error instanceof PushError && (error.reason === "denied" || error.reason === "unsupported")
      ? "off"
      : "failed";
  }
}

/** Takes push down everywhere: on the server, in the browser and in the service worker's memory. */
export async function disablePush(deps: PushDeps): Promise<void> {
  try {
    const own = await ownSubscriptions(deps);
    if (own.length > 0) await deps.jmap([["PushSubscription/set", { destroy: own.map((s) => s.id) }, "d"]]);
  } catch {
    // The server's subscriptions end on their own within a week, and with the session.
  }
  await forgetPush(deps);
}

/**
 * Takes push down in this browser only, for a session that is gone: the server dropped its
 * subscriptions with it, and there is nobody left to ask it anything.
 */
export async function forgetPush(deps: Pick<PushDeps, "kv" | "pushManager" | "unregister">): Promise<void> {
  try {
    const manager = await deps.pushManager(false);
    await (await manager?.getSubscription())?.unsubscribe();
  } catch {
    // No service worker, nothing to unsubscribe.
  }
  await deps.kv.delete(CONFIG_KEY).catch(() => undefined);
  await deps.kv.delete(PROGRESS_KEY).catch(() => undefined);
  await deps.unregister().catch(() => undefined);
}
