// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  CONFIG_KEY,
  DEFAULT_TEXTS,
  MESSAGE_OPEN,
  MESSAGE_VERIFIED,
  type KeyValue,
  type PushConfig,
} from "@/push/shared";
import { attach, workerEnv, type ExtendableEvent, type ServiceWorkerScope, type WindowClient } from "./serviceWorker";

const CONFIG: PushConfig = {
  login: "mini@example.org",
  accountId: "a1",
  apiUrl: "/jmap/api",
  deviceClientId: "device-1",
  showContent: true,
  texts: DEFAULT_TEXTS,
  subscriptionId: "w1",
};

function memory(entries: Record<string, unknown> = {}): KeyValue & { data: Map<string, unknown> } {
  const data = new Map(Object.entries(entries));
  return {
    data,
    get: async <T>(key: string) => data.get(key) as T | undefined,
    set: async (key, value) => void data.set(key, structuredClone(value)),
    delete: async (key) => void data.delete(key),
  };
}

type JmapCall = [string, Record<string, unknown>, string];

function subscription(endpoint: string, key: ArrayBuffer | null = new Uint8Array([4, 1, 2]).buffer) {
  const own = {
    endpoint,
    gone: false,
    options: { applicationServerKey: key },
    toJSON: () => ({ endpoint, keys: { p256dh: `p-${endpoint}`, auth: `a-${endpoint}` } }),
    unsubscribe: async () => {
      own.gone = true;
      return true;
    },
  };
  return own;
}

/** A service worker's global scope, with windows, a push manager and a server behind `fetch`. */
function fakeScope(windows: Partial<WindowClient>[] = []) {
  const listeners = new Map<string, (event: never) => void>();
  const jmap: JmapCall[] = [];
  const shown: { title: string; options?: NotificationOptions }[] = [];
  const opened: string[] = [];
  const messages: unknown[][] = windows.map(() => []);
  const focused: number[] = [];
  const state = { skipped: false, claimed: false, current: subscription("https://push.example.net/1"), made: 0 };
  const clients: WindowClient[] = windows.map((window, index) => ({
    url: "https://mail.example.org/mail/",
    focused: false,
    visibilityState: "hidden",
    ...window,
    focus: async () => {
      focused.push(index);
      return clients[index]!;
    },
    postMessage: (message: unknown) => void messages[index]!.push(message),
  }));
  const scope: ServiceWorkerScope = {
    registration: {
      scope: "https://mail.example.org/mail/",
      showNotification: async (title, options) => void shown.push({ title, options }),
      pushManager: {
        getSubscription: async () => (state.current.gone ? null : state.current),
        subscribe: async ({ applicationServerKey }) => {
          state.current = subscription(`https://push.example.net/new${++state.made}`, applicationServerKey);
          return state.current;
        },
      },
    },
    clients: {
      matchAll: async () => clients,
      openWindow: async (url) => {
        opened.push(url);
        return null;
      },
      claim: async () => {
        state.claimed = true;
      },
    },
    fetch: async (input, init) => {
      if (String(input) === "/api/session") {
        return Response.json({ csrfToken: "csrf-1", account: { login: "mini@example.org" } });
      }
      const body = JSON.parse(String(init?.body)) as { methodCalls: JmapCall[] };
      jmap.push(...body.methodCalls);
      return Response.json({
        methodResponses: body.methodCalls.map(([name, args, id]) => {
          if (name === "PushSubscription/set") {
            return [
              name,
              {
                updated: Object.fromEntries(Object.keys(args.update ?? {}).map((key) => [key, null])),
                created: args.create ? { push: { id: "w2", expires: "2026-10-04T12:00:00Z" } } : null,
              },
              id,
            ];
          }
          if (name === "Mailbox/get") return [name, { list: [{ id: "m1", role: "inbox" }] }, id];
          if (name === "Email/query") return [name, { ids: ["e1"] }, id];
          if (name === "Email/get") {
            const mail = {
              id: "e1",
              threadId: "t1",
              subject: "Lunch?",
              from: [{ name: "Nyu", email: "nyu@example.org" }],
              receivedAt: new Date().toISOString(),
            };
            return [name, { list: [mail] }, id];
          }
          return ["error", { type: "unknownMethod" }, id];
        }),
      });
    },
    skipWaiting: async () => {
      state.skipped = true;
    },
    addEventListener: (type: string, listener: (event: never) => void) => void listeners.set(type, listener),
  };

  /** Fires an event and waits for everything it handed to `waitUntil`. */
  async function fire(type: string, event: object): Promise<void> {
    const pending: Promise<unknown>[] = [];
    const extendable: ExtendableEvent = { waitUntil: (promise) => void pending.push(promise) };
    listeners.get(type)!({ ...extendable, ...event } as never);
    expect(pending).toHaveLength(1);
    await Promise.all(pending);
  }

  return { scope, fire, jmap, shown, opened, messages, focused, state, listeners };
}

function started(windows: Partial<WindowClient>[] = [], kv = memory({ [CONFIG_KEY]: CONFIG })) {
  const fake = fakeScope(windows);
  attach(fake.scope, workerEnv(fake.scope, kv));
  return { ...fake, kv };
}

const push = (payload: unknown) => ({ data: { json: () => payload } });

describe("the service worker's events", () => {
  it("takes over at once when installed", async () => {
    const { fire, state } = started();
    await fire("install", {});
    await fire("activate", {});
    expect(state).toMatchObject({ skipped: true, claimed: true });
  });

  it("sends a verification back and tells the open webmail", async () => {
    const { fire, jmap, messages } = started([{}]);
    await fire("push", push({ "@type": "PushVerification", pushSubscriptionId: "w1", verificationCode: "c0de" }));
    expect(jmap).toEqual([["PushSubscription/set", { update: { w1: { verificationCode: "c0de" } } }, "v"]]);
    expect(messages[0]).toEqual([{ type: MESSAGE_VERIFIED, subscriptionId: "w1" }]);
  });

  it("shows new mail with sender and subject, leading to the message", async () => {
    const { fire, shown } = started();
    await fire("push", push({ "@type": "StateChange", changed: { a1: { EmailDelivery: "9" } } }));
    expect(shown).toEqual([
      {
        title: "Nyu",
        options: {
          icon: "/mail/uwumail-app-icon.svg",
          body: "Lunch?",
          tag: "uwumail-mail-e1",
          data: { emailId: "e1", threadId: "t1" },
        },
      },
    ]);
  });

  it("stays quiet while a webmail window is in front", async () => {
    const { fire, shown } = started([{ focused: true, visibilityState: "visible" }]);
    await fire("push", push({ "@type": "StateChange", changed: { a1: { EmailDelivery: "9" } } }));
    expect(shown).toEqual([]);
  });

  it("ignores a push that is not JSON", async () => {
    const { fire, jmap, shown } = started();
    await fire("push", {
      data: {
        json: () => {
          throw new SyntaxError("not JSON");
        },
      },
    });
    await fire("push", { data: null });
    expect([jmap, shown]).toEqual([[], []]);
  });

  it("opens the message in the webmail window that is open, the one in front first", async () => {
    const { fire, focused, messages, opened } = started([
      { url: "https://mail.example.org/" },
      { url: "https://mail.example.org/mail/?x=1" },
      { url: "https://mail.example.org/mail/", focused: true },
    ]);
    let closed = false;
    const notification = { data: { emailId: "e1", threadId: "t1" }, close: () => void (closed = true) };
    await fire("notificationclick", { notification });
    expect(closed).toBe(true);
    // The portal's window at / is not the webmail's.
    expect(focused).toEqual([2]);
    expect(messages).toEqual([[], [], [{ type: MESSAGE_OPEN, emailId: "e1", threadId: "t1" }]]);
    expect(opened).toEqual([]);
  });

  it("hands on which shared mailbox and folder a message is in", async () => {
    const { fire, messages } = started([{ url: "https://mail.example.org/mail/" }]);
    const data = { emailId: "x1", threadId: "tx1", accountId: "a3", mailboxId: "s2" };
    await fire("notificationclick", { notification: { data, close: () => {} } });
    expect(messages[0]).toEqual([{ type: MESSAGE_OPEN, ...data }]);

    const closed = started();
    await closed.fire("notificationclick", { notification: { data, close: () => {} } });
    expect(closed.opened).toEqual(["/mail/?open=x1&thread=tx1&account=a3&mailbox=s2"]);
  });

  it("opens a new window on the message when the webmail is closed", async () => {
    const { fire, opened } = started([{ url: "https://mail.example.org/admin" }]);
    await fire("notificationclick", { notification: { data: { emailId: "e1", threadId: "t1" }, close: () => {} } });
    await fire("notificationclick", { notification: { data: null, close: () => {} } });
    expect(opened).toEqual(["/mail/?open=e1&thread=t1", "/mail/"]);
  });

  it("registers the browser's replacement subscription with the server", async () => {
    const { fire, jmap, kv } = started();
    const fresh = subscription("https://push.example.net/2");
    await fire("pushsubscriptionchange", { oldSubscription: null, newSubscription: fresh });
    expect(jmap[0]![1]).toMatchObject({
      destroy: ["w1"],
      create: { push: { url: "https://push.example.net/2", keys: { p256dh: "p-https://push.example.net/2" } } },
    });
    expect(kv.data.get(CONFIG_KEY)).toMatchObject({ subscriptionId: "w2", endpoint: "https://push.example.net/2" });
  });

  it("subscribes anew with the old key when the browser brought no replacement", async () => {
    const { fire, jmap, state } = started();
    const old = subscription("https://push.example.net/1");
    await fire("pushsubscriptionchange", { oldSubscription: old, newSubscription: null });
    expect(state.made).toBe(1);
    expect(state.current.options.applicationServerKey).toBe(old.options.applicationServerKey);
    expect(jmap[0]![1]).toMatchObject({ create: { push: { url: "https://push.example.net/new1" } } });
  });

  it("lets go of pushes nobody set up", async () => {
    const { fire, state, jmap } = started([], memory());
    await fire("push", push({ "@type": "StateChange", changed: { a1: { EmailDelivery: "9" } } }));
    expect(state.current.gone).toBe(true);
    expect(jmap).toEqual([]);
  });
});
