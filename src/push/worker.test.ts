// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CONFIG_KEY,
  DEFAULT_TEXTS,
  MESSAGE_VERIFIED,
  PROGRESS_KEY,
  type KeyValue,
  type NotificationSpec,
  type PushConfig,
  type PushProgress,
} from "./shared";
import { handlePush, resubscribe, utcDate, type WorkerEnv } from "./worker";

function memory(entries: Record<string, unknown> = {}): KeyValue & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(entries));
  return {
    data,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => void data.set(key, structuredClone(value)),
    delete: async (key) => void data.delete(key),
  };
}

const CONFIG: PushConfig = {
  login: "mini@example.org",
  accountId: "a1",
  apiUrl: "/jmap/api",
  deviceClientId: "device-1",
  showContent: true,
  texts: DEFAULT_TEXTS,
  subscriptionId: "w1",
};

interface Call {
  url: string;
  init?: RequestInit;
  body?: { methodCalls: [string, Record<string, unknown>, string][] };
}

interface FakeMail {
  id: string;
  subject?: string;
  name?: string;
  receivedAt: string;
  /** "a1" (the own account) unless said otherwise. */
  account?: string;
  /** The inbox of its account unless said otherwise. */
  mailbox?: string;
  seen?: boolean;
}

/** Each account's folders: the own one, and support@ that shares its inbox and a folder, not its spam. */
const MAILBOXES: Record<string, { id: string; role: string | null }[]> = {
  a1: [
    { id: "m1", role: "inbox" },
    { id: "m9", role: "junk" },
  ],
  a3: [
    { id: "s1", role: "inbox" },
    { id: "s2", role: null },
    { id: "s9", role: "junk" },
  ],
};

const SESSION_ACCOUNTS = {
  a1: { name: "mini@example.org", isPersonal: true, accountCapabilities: { "urn:ietf:params:jmap:mail": {} } },
  a3: { name: "support@example.org", isPersonal: false, accountCapabilities: { "urn:ietf:params:jmap:mail": {} } },
};

/** A server that answers the JMAP calls the service worker makes. */
function fakeServer(
  mails: FakeMail[],
  session: () => Response = () => Response.json({ csrfToken: "csrf-1", account: { login: "mini@example.org" } }),
) {
  const calls: Call[] = [];
  const inboxOf = (account: string) => MAILBOXES[account]!.find((m) => m.role === "inbox")!.id;
  const matching = (args: Record<string, unknown>) => {
    const filter = args.filter as { inMailbox?: string; inMailboxOtherThan?: string[]; after: string };
    return mails.filter((m) => {
      const account = m.account ?? "a1";
      const mailbox = m.mailbox ?? inboxOf(account);
      return (
        account === args.accountId &&
        !m.seen &&
        m.receivedAt >= filter.after &&
        (!filter.inMailbox || filter.inMailbox === mailbox) &&
        !filter.inMailboxOtherThan?.includes(mailbox)
      );
    });
  };
  const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? (JSON.parse(String(init.body)) as Call["body"]) : undefined;
    calls.push({ url, init, body });
    if (url === "/api/session") return session();
    if (url === "/jmap/session") return Response.json({ accounts: SESSION_ACCOUNTS });
    if ((init?.headers as Record<string, string>)["x-csrf-token"] !== "csrf-1") {
      return new Response(null, { status: 401 });
    }
    const responses = body!.methodCalls.map(([name, args, id]) => {
      if (name === "Mailbox/get") {
        const list = MAILBOXES[args.accountId as string];
        return list ? [name, { list }, id] : ["error", { type: "accountNotFound" }, id];
      }
      if (name === "Email/query") return [name, { ids: matching(args).map((m) => m.id) }, id];
      if (name === "Email/get") {
        const list = matching(body!.methodCalls[0]![1]).map((m) => ({
          id: m.id,
          threadId: `t${m.id}`,
          subject: m.subject,
          from: [{ name: m.name, email: "someone@example.org" }],
          mailboxIds: { [m.mailbox ?? inboxOf(m.account ?? "a1")]: true },
          receivedAt: m.receivedAt,
        }));
        return [name, { list }, id];
      }
      if (name === "PushSubscription/set") {
        const update = (args.update ?? {}) as Record<string, unknown>;
        const create = (args.create ?? {}) as Record<string, unknown>;
        return [
          name,
          {
            updated: Object.fromEntries(Object.keys(update).map((key) => [key, null])),
            created: Object.fromEntries(
              Object.keys(create).map((key) => [key, { id: "w8", expires: "2026-10-04T11:59:58Z" }]),
            ),
            destroyed: args.destroy ?? [],
          },
          id,
        ];
      }
      return ["error", { type: "unknownMethod" }, id];
    });
    return Response.json({ methodResponses: responses });
  };
  return { calls, fetch: fetch as typeof globalThis.fetch };
}

function environment(kv: KeyValue, fetch: typeof globalThis.fetch, inFront = false) {
  const shown: NotificationSpec[] = [];
  const posted: unknown[] = [];
  const browser = { subscribed: true };
  const env: WorkerEnv = {
    kv,
    fetch,
    showNotification: async (spec) => void shown.push(spec),
    webmailInFront: async () => inFront,
    postToClients: async (message) => void posted.push(message),
    unsubscribe: async () => {
      browser.subscribed = false;
    },
    now: () => new Date("2026-09-27T12:00:00Z"),
  };
  return { env, shown, posted, browser };
}

const NEW_MAIL = { "@type": "StateChange", changed: { a1: { EmailDelivery: "12" } } };
const START: PushProgress = { since: "2026-09-27T11:00:00Z", accounts: {} };
const GENERIC = { title: DEFAULT_TEXTS.newMail, options: { tag: "uwumail-new", body: DEFAULT_TEXTS.hidden, data: {} } };

describe("the service worker", () => {
  it("sends the verification code back with the session's CSRF token", async () => {
    const server = fakeServer([]);
    const { env, posted } = environment(memory({ [CONFIG_KEY]: CONFIG }), server.fetch);
    await handlePush(env, { "@type": "PushVerification", pushSubscriptionId: "w7", verificationCode: "c0de" });
    const jmap = server.calls.find((call) => call.url === "/jmap/api")!;
    expect((jmap.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-1");
    expect(jmap.body!.methodCalls[0]).toEqual([
      "PushSubscription/set",
      { update: { w7: { verificationCode: "c0de" } } },
      "v",
    ]);
    expect(posted).toEqual([{ type: MESSAGE_VERIFIED, subscriptionId: "w7" }]);
  });

  it("announces new unread mail once, newest first", async () => {
    const kv = memory({
      [CONFIG_KEY]: CONFIG,
      [PROGRESS_KEY]: START satisfies PushProgress,
    });
    const server = fakeServer([
      { id: "e1", subject: "Older", name: "Mini", receivedAt: "2026-09-27T10:00:00Z" },
      { id: "e2", subject: "Lunch?", name: "Nyu", receivedAt: "2026-09-27T11:30:00Z" },
      { id: "e3", subject: "", name: "", receivedAt: "2026-09-27T11:45:00Z" },
    ]);
    const { env, shown } = environment(kv, server.fetch);
    await handlePush(env, NEW_MAIL);
    expect(shown.map((spec) => [spec.title, spec.options.body, spec.options.tag, spec.options.data])).toEqual([
      ["someone@example.org", DEFAULT_TEXTS.noSubject, "uwumail-mail-e3", { emailId: "e3", threadId: "te3" }],
      ["Nyu", "Lunch?", "uwumail-mail-e2", { emailId: "e2", threadId: "te2" }],
    ]);
    expect(kv.data.get(PROGRESS_KEY)).toMatchObject({
      accounts: { a1: { since: "2026-09-27T11:45:00Z", announced: ["e3", "e2"], mailboxes: { inbox: "m1" } } },
    });

    // The same push again finds nothing new: a browser has to show something all the same.
    shown.length = 0;
    await handlePush(env, NEW_MAIL);
    expect(shown).toEqual([GENERIC]);
  });

  it("hides sender and subject when asked to", async () => {
    const kv = memory({
      [CONFIG_KEY]: { ...CONFIG, showContent: false },
      [PROGRESS_KEY]: START,
    });
    const server = fakeServer([{ id: "e2", subject: "Secret", name: "Nyu", receivedAt: "2026-09-27T11:30:00Z" }]);
    const { env, shown } = environment(kv, server.fetch);
    await handlePush(env, NEW_MAIL);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe(DEFAULT_TEXTS.newMail);
    expect(shown[0]!.options.body).toBe(DEFAULT_TEXTS.hidden);
    expect(JSON.stringify(shown)).not.toContain("Secret");
  });

  it("sums up many messages in one notification", async () => {
    const kv = memory({ [CONFIG_KEY]: CONFIG, [PROGRESS_KEY]: START });
    const mails = ["1", "2", "3", "4", "5"].map((n) => ({
      id: `e${n}`,
      subject: `S${n}`,
      name: `N${n}`,
      receivedAt: `2026-09-27T11:0${n}:00Z`,
    }));
    const { env, shown } = environment(kv, fakeServer(mails).fetch);
    await handlePush(env, NEW_MAIL);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe("5 new messages");
    expect(shown[0]!.options.data).toEqual({ emailId: "e5", threadId: "te5" });
  });

  it("stays quiet while the webmail is in front, and for changes that are not new mail", async () => {
    const kv = memory({ [CONFIG_KEY]: CONFIG, [PROGRESS_KEY]: START });
    const server = fakeServer([{ id: "e2", subject: "Hi", name: "Nyu", receivedAt: "2026-09-27T11:30:00Z" }]);
    const front = environment(kv, server.fetch, true);
    await handlePush(front.env, { "@type": "StateChange", changed: { a1: { Email: "13" } } });
    expect(server.calls).toEqual([]);
    await handlePush(front.env, NEW_MAIL);
    expect(front.shown).toEqual([]);
    // It was seen there, so it is not announced later either.
    const back = environment(kv, server.fetch, false);
    await handlePush(back.env, NEW_MAIL);
    expect(back.shown).toEqual([GENERIC]);
  });

  it("announces new mail of a shared mailbox, named, and leading to its folder", async () => {
    const kv = memory({
      [CONFIG_KEY]: { ...CONFIG, accounts: { a1: "mini@example.org", a3: "support@example.org" } },
      [PROGRESS_KEY]: START,
    });
    const server = fakeServer([
      { id: "e1", subject: "Hi", name: "Nyu", receivedAt: "2026-09-27T11:10:00Z" },
      { id: "x1", subject: "Refund?", name: "Kim", receivedAt: "2026-09-27T11:20:00Z", account: "a3" },
      { id: "x2", subject: "Order", name: "Lee", receivedAt: "2026-09-27T11:30:00Z", account: "a3", mailbox: "s2" },
      { id: "x3", subject: "Spam", name: "Bot", receivedAt: "2026-09-27T11:40:00Z", account: "a3", mailbox: "s9" },
    ]);
    const { env, shown } = environment(kv, server.fetch);
    await handlePush(env, { "@type": "StateChange", changed: { a3: { EmailDelivery: "4" } } });
    expect(shown.map((spec) => [spec.title, spec.options.body, spec.options.data])).toEqual([
      ["support@example.org · Lee", "Order", { emailId: "x2", threadId: "tx2", accountId: "a3", mailboxId: "s2" }],
      ["support@example.org · Kim", "Refund?", { emailId: "x1", threadId: "tx1", accountId: "a3", mailboxId: "s1" }],
    ]);
    // Spam is left out there, and the own inbox was not asked about.
    const asked = server.calls
      .flatMap((call) => call.body?.methodCalls ?? [])
      .filter(([name]) => name === "Email/query");
    expect(
      asked.map(([, args]) => [args.accountId, (args.filter as { inMailboxOtherThan?: string[] }).inMailboxOtherThan]),
    ).toEqual([["a3", ["s9"]]]);

    // Both at once: newest first, the own one without an account name.
    const both = environment(memory({ [CONFIG_KEY]: CONFIG, [PROGRESS_KEY]: START }), server.fetch);
    await handlePush(both.env, {
      "@type": "StateChange",
      changed: { a1: { EmailDelivery: "5" }, a3: { EmailDelivery: "4" } },
    });
    expect(both.shown.map((spec) => spec.title)).toEqual([
      "support@example.org · Lee",
      "support@example.org · Kim",
      "Nyu",
    ]);
  });

  it("learns the name of a mailbox shared after push was set up, and skips accounts it doesn't have", async () => {
    const kv = memory({ [CONFIG_KEY]: { ...CONFIG, accounts: { a1: "mini@example.org" } }, [PROGRESS_KEY]: START });
    const server = fakeServer([
      { id: "x1", subject: "Refund?", name: "Kim", receivedAt: "2026-09-27T11:20:00Z", account: "a3" },
    ]);
    const { env, shown } = environment(kv, server.fetch);
    await handlePush(env, { "@type": "StateChange", changed: { a3: { EmailDelivery: "4" } } });
    expect(shown[0]!.title).toBe("support@example.org · Kim");
    expect((kv.data.get(CONFIG_KEY) as PushConfig).accounts).toEqual({
      a1: "mini@example.org",
      a3: "support@example.org",
    });

    const gone = environment(kv, server.fetch);
    await handlePush(gone.env, { "@type": "StateChange", changed: { a7: { EmailDelivery: "1" } } });
    expect(gone.shown).toEqual([GENERIC]);
  });

  it("asks the server with the session's CSRF token, fetched once per push", async () => {
    const kv = memory({ [CONFIG_KEY]: CONFIG, [PROGRESS_KEY]: START });
    const server = fakeServer([{ id: "e2", subject: "Hi", name: "Nyu", receivedAt: "2026-09-27T11:30:00Z" }]);
    const { env, shown } = environment(kv, server.fetch);
    await handlePush(env, NEW_MAIL);
    expect(shown).toHaveLength(1);
    expect(server.calls.filter((call) => call.url === "/api/session")).toHaveLength(1);
    for (const call of server.calls.filter((call) => call.url === "/jmap/api")) {
      expect(call.init?.credentials).toBe("same-origin");
      expect((call.init?.headers as Record<string, string>)["x-csrf-token"]).toBe("csrf-1");
    }
  });

  it("does nothing without a configuration, and lets go of a subscription nobody wants", async () => {
    const server = fakeServer([]);
    const nothing = environment(memory(), server.fetch);
    await handlePush(nothing.env, NEW_MAIL);
    expect(server.calls).toEqual([]);
    expect(nothing.browser.subscribed).toBe(false);
  });

  it.each([
    ["signed out", () => Response.json(null)],
    ["the session is refused", () => new Response(null, { status: 401 })],
    ["somebody else signed in", () => Response.json({ csrfToken: "csrf-1", account: { login: "other@example.org" } })],
  ])("takes push down when %s", async (_, session) => {
    const kv = memory({ [CONFIG_KEY]: CONFIG, [PROGRESS_KEY]: START });
    const server = fakeServer([{ id: "e2", subject: "Hi", name: "Nyu", receivedAt: "2026-09-27T11:30:00Z" }], session);
    const { env, shown, browser } = environment(kv, server.fetch);
    await expect(handlePush(env, NEW_MAIL)).resolves.toBeUndefined();
    // Nothing of the mail, but something: the push has to show.
    expect(shown).toEqual([GENERIC]);
    expect(browser.subscribed).toBe(false);
    expect([...kv.data.keys()]).toEqual([]);
    expect(server.calls.filter((call) => call.url === "/jmap/api")).toEqual([]);
  });

  it("keeps everything when the server is only away", async () => {
    const kv = memory({ [CONFIG_KEY]: CONFIG });
    const { env, browser, shown } = environment(kv, async () => new Response(null, { status: 502 }));
    await handlePush(env, NEW_MAIL);
    expect(shown).toEqual([GENERIC]);
    expect(browser.subscribed).toBe(true);
    expect(kv.data.get(CONFIG_KEY)).toEqual(CONFIG);
    const offline = environment(kv, async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(handlePush(offline.env, NEW_MAIL)).resolves.toBeUndefined();
    expect(offline.browser.subscribed).toBe(true);
  });

  it("extends the subscription when it would end within three days", async () => {
    const soon = { ...CONFIG, expires: "2026-09-29T12:00:00Z" };
    const kv = memory({ [CONFIG_KEY]: soon, [PROGRESS_KEY]: START });
    const server = fakeServer([]);
    const { env } = environment(kv, server.fetch);
    await handlePush(env, NEW_MAIL);
    const renewal = server.calls
      .flatMap((call) => call.body?.methodCalls ?? [])
      .find(([name]) => name === "PushSubscription/set");
    expect(renewal).toEqual(["PushSubscription/set", { update: { w1: { expires: "2026-10-04T12:00:00Z" } } }, "r"]);
    expect((kv.data.get(CONFIG_KEY) as PushConfig).expires).toBe("2026-10-04T12:00:00Z");

    // With days to go, nothing is asked.
    const later = fakeServer([]);
    await handlePush(environment(kv, later.fetch).env, NEW_MAIL);
    expect(later.calls.flatMap((call) => call.body?.methodCalls ?? []).map(([name]) => name)).not.toContain(
      "PushSubscription/set",
    );
  });

  it("hands the server the browser's new subscription in place of the old one", async () => {
    const kv = memory({ [CONFIG_KEY]: { ...CONFIG, endpoint: "https://push.example.net/old" } });
    const server = fakeServer([]);
    const { env } = environment(kv, server.fetch);
    await resubscribe(env, { endpoint: "https://push.example.net/new", keys: { p256dh: "BNew", auth: "aNew" } });
    const set = server.calls
      .flatMap((call) => call.body?.methodCalls ?? [])
      .find(([name]) => name === "PushSubscription/set");
    expect(set?.[1]).toEqual({
      destroy: ["w1"],
      create: {
        push: {
          deviceClientId: "device-1",
          url: "https://push.example.net/new",
          keys: { p256dh: "BNew", auth: "aNew" },
          expires: "2026-10-04T12:00:00Z",
          types: ["EmailDelivery"],
        },
      },
    });
    expect(kv.data.get(CONFIG_KEY)).toMatchObject({
      subscriptionId: "w8",
      endpoint: "https://push.example.net/new",
      expires: "2026-10-04T11:59:58Z",
    });

    // Its verification then comes in like the first one did.
    const { env: again, posted } = environment(kv, server.fetch);
    await handlePush(again, { "@type": "PushVerification", pushSubscriptionId: "w8", verificationCode: "c1" });
    expect(posted).toEqual([{ type: MESSAGE_VERIFIED, subscriptionId: "w8" }]);
  });

  it("leaves a replaced subscription alone without keys, and drops it without a configuration", async () => {
    const server = fakeServer([]);
    const kv = memory({ [CONFIG_KEY]: CONFIG });
    await resubscribe(environment(kv, server.fetch).env, { endpoint: "https://push.example.net/new" });
    expect(server.calls).toEqual([]);
    const none = environment(memory(), server.fetch);
    await resubscribe(none.env, { endpoint: "https://push.example.net/new", keys: { p256dh: "B", auth: "a" } });
    expect(none.browser.subscribed).toBe(false);
  });

  it("writes dates the way JMAP does", () => {
    expect(utcDate(new Date("2026-09-27T12:00:00.123Z"))).toBe("2026-09-27T12:00:00Z");
  });
});
