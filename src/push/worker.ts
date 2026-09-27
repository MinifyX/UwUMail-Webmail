/**
 * What the service worker does with a push, apart from the browser around it (see src/sw), so it
 * can be tested: send a new subscription's verification code back, turn "new mail arrived" into
 * notifications by asking the server what is new in the inbox, keep the server's subscription from
 * running out, and make a new one when the browser replaces its own.
 *
 * The service worker has the session cookie like the page, so it signs in the same way: the cookie
 * and, since the server wants it with every JMAP request, the session's CSRF token, which
 * `/api/session` hands out to the cookie's owner. Once that session is gone (signed out in the
 * portal, or somebody else signed in), push is taken down here too: the server has already dropped
 * the subscription with the session.
 */

import {
  CONFIG_KEY,
  LIFETIME_MS,
  MESSAGE_VERIFIED,
  PROGRESS_KEY,
  PUSH_TYPES,
  newMailIn,
  notificationsFor,
  parsePayload,
  utcDate,
  type KeyValue,
  type NewMail,
  type NotificationSpec,
  type PushConfig,
  type PushProgress,
} from "./shared";

export { utcDate };

export interface WorkerEnv {
  kv: KeyValue;
  fetch: typeof fetch;
  showNotification: (spec: NotificationSpec) => Promise<void>;
  /** Whether the webmail is open and in front: then it shows new mail itself. */
  webmailInFront: () => Promise<boolean>;
  postToClients: (message: unknown) => Promise<void>;
  /** Ends the browser's push subscription, for good. */
  unsubscribe: () => Promise<void>;
  now: () => Date;
}

/** What the browser hands over for a push subscription, as `PushSubscription.toJSON()` has it. */
export interface SubscriptionJson {
  endpoint?: string;
  keys?: Record<string, string | undefined>;
}

/** Mail older than this is never announced, however long the browser was away. */
const LOOK_BACK_MS = 24 * 3600 * 1000;
/** Announced ids kept to avoid announcing twice. */
const MAX_REMEMBERED = 100;
/** Mail asked for at most per push. */
const MAX_NEW = 20;
/** A subscription that ends sooner than this is extended by the next push. */
const RENEW_WITHIN_MS = 3 * 24 * 3600 * 1000;

type Invocation = [string, Record<string, unknown>, string];

interface MethodResponse {
  methodResponses: Invocation[];
}

/** The session push was set up with is gone: signed out, or another login in this browser. */
class SignedOut extends Error {}

/** One round of talking to the server, with the session's CSRF token fetched once. */
class Server {
  private csrf: Promise<string> | null = null;

  constructor(
    private readonly env: WorkerEnv,
    private readonly config: PushConfig,
  ) {}

  private token(): Promise<string> {
    this.csrf ??= (async () => {
      const response = await this.env.fetch("/api/session", {
        credentials: "same-origin",
        headers: { accept: "application/json" },
      });
      if (response.status === 401) throw new SignedOut();
      if (!response.ok) throw new Error(`The server answered ${response.status}.`);
      const session = (await response.json()) as { csrfToken?: string; account?: { login?: string } } | null;
      if (!session?.csrfToken) throw new SignedOut();
      const login = session.account?.login;
      if (login && login.toLowerCase() !== this.config.login.toLowerCase()) throw new SignedOut();
      return session.csrfToken;
    })();
    return this.csrf;
  }

  async call(calls: Invocation[]): Promise<MethodResponse> {
    const response = await this.env.fetch(this.config.apiUrl, {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "x-csrf-token": await this.token(),
      },
      body: JSON.stringify({ using: ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"], methodCalls: calls }),
    });
    if (response.status === 401) throw new SignedOut();
    if (!response.ok) throw new Error(`The server answered ${response.status}.`);
    const body = (await response.json()) as MethodResponse;
    const failed = body.methodResponses.find(([name]) => name === "error");
    if (failed) throw new Error(`The server refused ${failed[2]}: ${JSON.stringify(failed[1])}`);
    return body;
  }
}

function responseOf<T>(body: MethodResponse, id: string): T {
  const found = body.methodResponses.find(([, , callId]) => callId === id);
  if (!found) throw new Error(`No answer to ${id}.`);
  return found[1] as T;
}

/** Takes push down in this browser: nothing is kept, and the push service stops delivering. */
async function forget(env: WorkerEnv): Promise<void> {
  await env.unsubscribe().catch(() => undefined);
  await env.kv.delete(CONFIG_KEY).catch(() => undefined);
  await env.kv.delete(PROGRESS_KEY).catch(() => undefined);
}

/** Runs a step against the server; a session that is gone takes push down, anything else waits for next time. */
async function withServer(env: WorkerEnv, config: PushConfig, work: (server: Server) => Promise<void>): Promise<void> {
  try {
    await work(new Server(env, config));
  } catch (error) {
    if (error instanceof SignedOut) await forget(env);
    // Otherwise the server is away: nothing is lost, the next push asks again.
  }
}

/** Handles one push. Resolves when everything it shows is shown. */
export async function handlePush(env: WorkerEnv, data: unknown): Promise<void> {
  const config = await env.kv.get<PushConfig>(CONFIG_KEY);
  if (!config) {
    // Left over from a webmail that switched push off: nobody wants these any more.
    await env.unsubscribe().catch(() => undefined);
    return;
  }
  const payload = parsePayload(data);
  await withServer(env, config, async (server) => {
    if (payload.kind === "verification") {
      await verify(env, server, payload.subscriptionId, payload.code);
      return;
    }
    if (newMailIn(payload, config.accountId)) await announceNewMail(env, server, config);
    await renewIfDue(env, server, config);
  });
}

/** Sends a verification code back to the server (RFC 8620, 7.2.2) and tells the page. */
async function verify(env: WorkerEnv, server: Server, subscriptionId: string, code: string): Promise<void> {
  const body = await server.call([
    ["PushSubscription/set", { update: { [subscriptionId]: { verificationCode: code } } }, "v"],
  ]);
  const set = responseOf<{ updated?: Record<string, unknown> | null }>(body, "v");
  if (set.updated && subscriptionId in set.updated) await env.postToClients({ type: MESSAGE_VERIFIED, subscriptionId });
}

/**
 * Extends the server's subscription when it ends within three days. The webmail does this on every
 * start; this keeps push going for someone who reads their mail elsewhere for a while.
 */
async function renewIfDue(env: WorkerEnv, server: Server, config: PushConfig): Promise<void> {
  const id = config.subscriptionId;
  if (!id || !config.expires) return;
  const now = env.now().getTime();
  if (Date.parse(config.expires) - now > RENEW_WITHIN_MS) return;
  const expires = utcDate(new Date(now + LIFETIME_MS));
  const body = await server.call([["PushSubscription/set", { update: { [id]: { expires } } }, "r"]]);
  const updated = responseOf<{ updated?: Record<string, { expires?: string } | null> | null }>(body, "r").updated;
  if (!updated || !(id in updated)) return;
  // Read again: the page may have written something in between.
  const current = await env.kv.get<PushConfig>(CONFIG_KEY);
  if (current?.subscriptionId === id) {
    await env.kv.set(CONFIG_KEY, { ...current, expires: updated[id]?.expires ?? expires } satisfies PushConfig);
  }
}

/** Asks the server what is new and unread in the inbox since last time, and shows it. */
async function announceNewMail(env: WorkerEnv, server: Server, config: PushConfig): Promise<void> {
  const now = env.now();
  const floor = utcDate(new Date(now.getTime() - LOOK_BACK_MS));
  const stored = await env.kv.get<PushProgress>(PROGRESS_KEY);
  const progress: PushProgress = stored ?? { since: utcDate(now), announced: [] };
  const since = progress.since > floor ? progress.since : floor;

  let inboxId = progress.inboxId;
  if (!inboxId) {
    const found = await server.call([
      ["Mailbox/query", { accountId: config.accountId, filter: { role: "inbox" } }, "m"],
    ]);
    inboxId = responseOf<{ ids: string[] }>(found, "m").ids[0];
    if (!inboxId) return;
  }
  const body = await server.call([
    [
      "Email/query",
      {
        accountId: config.accountId,
        filter: { inMailbox: inboxId, notKeyword: "$seen", after: since },
        sort: [{ property: "receivedAt", isAscending: false }],
        limit: MAX_NEW,
      },
      "q",
    ],
    [
      "Email/get",
      {
        accountId: config.accountId,
        "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
        properties: ["id", "threadId", "from", "subject", "receivedAt"],
      },
      "g",
    ],
  ]);
  const fresh: NewMail[] = responseOf<{ list: NewMail[] }>(body, "g")
    .list.filter((mail) => !progress.announced.includes(mail.id))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));

  const newest = fresh[0]?.receivedAt;
  const next: PushProgress = {
    since: newest && newest > progress.since ? newest : progress.since,
    announced: [...fresh.map((mail) => mail.id), ...progress.announced].slice(0, MAX_REMEMBERED),
    inboxId,
  };
  await env.kv.set(PROGRESS_KEY, next);
  if (fresh.length === 0 || (await env.webmailInFront())) return;
  for (const spec of notificationsFor(fresh, config)) await env.showNotification(spec);
}

/**
 * The browser replaced its push subscription (`pushsubscriptionchange`, e.g. after the push
 * service expired it): the server gets the new address in place of the old one, and its
 * verification comes back through `handlePush` like the first time. Without a new subscription
 * push is over in this browser; the webmail sets it up again at its next start.
 */
export async function resubscribe(env: WorkerEnv, fresh: SubscriptionJson | null): Promise<void> {
  const config = await env.kv.get<PushConfig>(CONFIG_KEY);
  if (!config) {
    await env.unsubscribe().catch(() => undefined);
    return;
  }
  const endpoint = fresh?.endpoint;
  const p256dh = fresh?.keys?.p256dh;
  const auth = fresh?.keys?.auth;
  if (!endpoint || !p256dh || !auth) return;
  await withServer(env, config, async (server) => {
    const body = await server.call([
      [
        "PushSubscription/set",
        {
          ...(config.subscriptionId ? { destroy: [config.subscriptionId] } : {}),
          create: {
            push: {
              deviceClientId: config.deviceClientId,
              url: endpoint,
              keys: { p256dh, auth },
              expires: utcDate(new Date(env.now().getTime() + LIFETIME_MS)),
              types: PUSH_TYPES,
            },
          },
        },
        "s",
      ],
    ]);
    const created = responseOf<{ created?: Record<string, { id: string; expires?: string }> | null }>(body, "s").created
      ?.push;
    if (!created) return;
    const current = (await env.kv.get<PushConfig>(CONFIG_KEY)) ?? config;
    await env.kv.set(CONFIG_KEY, {
      ...current,
      subscriptionId: created.id,
      endpoint,
      ...(created.expires ? { expires: created.expires } : {}),
    } satisfies PushConfig);
  });
}
