/**
 * What the service worker does with a push, apart from the browser around it (see src/sw), so it
 * can be tested: send a new subscription's verification code back, turn "new mail arrived" into
 * notifications by asking the server what is new (in the own inbox, and in the folders others share
 * with the account), keep the server's subscription from running out, and make a new one when the
 * browser replaces its own.
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
  deliveredTo,
  genericNotification,
  notificationsFor,
  parsePayload,
  utcDate,
  type KeyValue,
  type NewMail,
  type AccountProgress,
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
    readonly env: WorkerEnv,
    private readonly config: PushConfig,
  ) {}

  /** The JMAP session document, for the accounts there are now. */
  async session(): Promise<{
    accounts?: Record<string, { name?: string; accountCapabilities?: Record<string, unknown> }>;
  }> {
    const response = await this.env.fetch("/jmap/session", {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (response.status === 401) throw new SignedOut();
    if (!response.ok) throw new Error(`The server answered ${response.status}.`);
    return (await response.json()) as Awaited<ReturnType<Server["session"]>>;
  }

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
    const accounts = deliveredTo(payload);
    if (accounts.length > 0) await announceNewMail(env, server, config, accounts);
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

/** Folders whose new mail is no news: nobody wants to hear about spam, or their own sent mail. */
const QUIET_ROLES = ["junk", "trash", "sent", "drafts"];

/** The accounts' names, from the session, for a shared account that came after push was set up. */
async function accountNames(server: Server, config: PushConfig): Promise<Record<string, string>> {
  const session = await server.session();
  const names: Record<string, string> = {};
  for (const [id, account] of Object.entries(session.accounts ?? {})) {
    if (account.accountCapabilities && "urn:ietf:params:jmap:mail" in account.accountCapabilities) {
      names[id] = account.name ?? id;
    }
  }
  const current = (await server.env.kv.get<PushConfig>(CONFIG_KEY)) ?? config;
  await server.env.kv.set(CONFIG_KEY, { ...current, accounts: names } satisfies PushConfig);
  return names;
}

/**
 * What is new and unread in one account since last time: in the own inbox, or, in an account
 * someone shares folders with this one from (a shared mailbox like support@), in every folder it
 * may read but spam, trash, sent and drafts. The server only sends EmailDelivery for those to
 * people who may read the folder the mail came into.
 */
async function newIn(
  server: Server,
  config: PushConfig,
  accountId: string,
  name: string,
  known: AccountProgress,
  floor: string,
): Promise<{ fresh: NewMail[]; progress: AccountProgress }> {
  const own = accountId === config.accountId;
  let mailboxes = known.mailboxes;
  if (!mailboxes) {
    const found = await server.call([["Mailbox/get", { accountId, ids: null, properties: ["id", "role"] }, "m"]]);
    const list = responseOf<{ list: { id: string; role?: string | null }[] }>(found, "m").list;
    mailboxes = {
      inbox: list.find((mailbox) => mailbox.role === "inbox")?.id ?? null,
      skip: list.filter((mailbox) => QUIET_ROLES.includes(mailbox.role ?? "")).map((mailbox) => mailbox.id),
    };
  }
  if (own && !mailboxes.inbox) return { fresh: [], progress: { ...known, mailboxes } };
  const since = known.since > floor ? known.since : floor;
  const where = own
    ? { inMailbox: mailboxes.inbox }
    : mailboxes.skip.length > 0
      ? { inMailboxOtherThan: mailboxes.skip }
      : {};
  const body = await server.call([
    [
      "Email/query",
      {
        accountId,
        filter: { ...where, notKeyword: "$seen", after: since },
        sort: [{ property: "receivedAt", isAscending: false }],
        limit: MAX_NEW,
      },
      "q",
    ],
    [
      "Email/get",
      {
        accountId,
        "#ids": { resultOf: "q", name: "Email/query", path: "/ids" },
        properties: ["id", "threadId", "from", "subject", "mailboxIds", "receivedAt"],
      },
      "g",
    ],
  ]);
  const skip = mailboxes.skip;
  const fresh = responseOf<{ list: NewMail[] }>(body, "g")
    .list.filter((mail) => !known.announced.includes(mail.id))
    .sort((a, b) => b.receivedAt.localeCompare(a.receivedAt))
    .map((mail): NewMail => {
      if (own) return mail;
      const folders = Object.keys(mail.mailboxIds ?? {});
      const mailboxId = folders.find((id) => id === mailboxes.inbox) ?? folders.find((id) => !skip.includes(id));
      return { ...mail, shared: { accountId, name, ...(mailboxId ? { mailboxId } : {}) } };
    });
  const newest = fresh.reduce((latest, mail) => (mail.receivedAt > latest ? mail.receivedAt : latest), known.since);
  return {
    fresh,
    progress: {
      since: newest,
      announced: [...fresh.map((mail) => mail.id), ...known.announced].slice(0, MAX_REMEMBERED),
      mailboxes,
    },
  };
}

/**
 * Asks the server what is new and unread in the accounts a push named, and shows it. When nothing
 * can be found (read elsewhere in the meantime, the server away), a plain "New mail" is shown all
 * the same: a browser has to show something for every push, and would say something stranger.
 */
async function announceNewMail(env: WorkerEnv, server: Server, config: PushConfig, accounts: string[]): Promise<void> {
  const now = env.now();
  const floor = utcDate(new Date(now.getTime() - LOOK_BACK_MS));
  const stored = await env.kv.get<PushProgress>(PROGRESS_KEY);
  const progress: PushProgress =
    stored && typeof stored.accounts === "object"
      ? { since: stored.since, accounts: { ...stored.accounts } }
      : { since: utcDate(now), accounts: {} };

  const fresh: NewMail[] = [];
  let failure: unknown = null;
  let names = config.accounts ?? {};
  for (const accountId of accounts) {
    const own = accountId === config.accountId;
    try {
      if (!own && !(accountId in names)) names = await accountNames(server, config);
      // Not an account of this session (any more): nothing of it to show.
      if (!own && !(accountId in names)) continue;
      const known = progress.accounts[accountId] ?? { since: progress.since, announced: [] };
      const found = await newIn(server, config, accountId, names[accountId] ?? accountId, known, floor);
      fresh.push(...found.fresh);
      progress.accounts[accountId] = found.progress;
    } catch (error) {
      if (error instanceof SignedOut) {
        failure = error;
        break;
      }
      // An account that failed looks its folders up again next time.
      const known = progress.accounts[accountId];
      if (known) progress.accounts[accountId] = { since: known.since, announced: known.announced };
    }
  }
  fresh.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  if (!failure) await env.kv.set(PROGRESS_KEY, progress);

  if (!(await env.webmailInFront())) {
    const specs = fresh.length > 0 ? notificationsFor(fresh, config) : [genericNotification(config)];
    for (const spec of specs) await env.showNotification(spec);
  }
  if (failure) throw failure;
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
