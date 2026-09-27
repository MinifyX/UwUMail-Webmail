// @vitest-environment node
import { describe, expect, it } from "vitest";
import {
  PUSH_TYPES,
  PushError,
  decodeKey,
  disablePush,
  enablePush,
  forgetPush,
  renewPush,
  type BrowserPushManager,
  type BrowserSubscription,
  type Invocation,
  type PushDeps,
} from "./registration";
import { CONFIG_KEY, DEFAULT_TEXTS, PROGRESS_KEY, type KeyValue, type PushConfig } from "./shared";

const SERVER_KEY = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"; // gitleaks:allow (public test key)
const OTHER_KEY = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"; // gitleaks:allow (public test key)

interface ServerSubscription {
  id: string;
  deviceClientId: string;
  verificationCode: string | null;
  expires: string;
  url: string;
}

/** The browser and the server as far as push needs them. */
function world(
  options: {
    permission?: NotificationPermission;
    answer?: NotificationPermission;
    /** Whether the service worker sends the code back, and after how many looks at the server. */
    verifies?: boolean;
    verifiedAfter?: number;
  } = {},
) {
  const kv = new Map<string, unknown>();
  const store: KeyValue = {
    get: async <T>(key: string) => kv.get(key) as T | undefined,
    set: async (key, value) => void kv.set(key, value),
    delete: async (key) => void kv.delete(key),
  };
  const state = {
    permission: options.permission ?? ("default" as NotificationPermission),
    asked: 0,
    registered: false,
    subscription: null as (BrowserSubscription & { key: string; gone: boolean }) | null,
    server: [] as ServerSubscription[],
    requests: [] as Invocation[][],
    serverKey: SERVER_KEY as string | null,
    next: 1,
    slept: 0,
    serverAway: false,
  };
  const subscribe = (key: string) => {
    const subscription = {
      endpoint: `https://push.example.net/send/${state.next++}`,
      key,
      gone: false,
      options: { applicationServerKey: decodeKey(key).buffer },
      toJSON: () => ({ keys: { p256dh: "BCVx", auth: "BTBZ" } }),
      unsubscribe: async () => {
        subscription.gone = true;
        state.subscription = null;
        return true;
      },
    };
    state.subscription = subscription;
    return subscription;
  };
  const manager: BrowserPushManager = {
    getSubscription: async () => state.subscription,
    subscribe: async ({ applicationServerKey }) => {
      const key = btoa(String.fromCharCode(...applicationServerKey))
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
      return subscribe(key);
    },
  };
  let looks = 0;
  const jmap = async (calls: Invocation[]): Promise<Invocation[]> => {
    if (state.serverAway) throw new Error("The mail server can't be reached.");
    state.requests.push(calls);
    return calls.map(([name, args, id]): Invocation => {
      if (name === "PushSubscription/get") {
        // The service worker's answer to the verification push lands after a while.
        if (state.server.length > 0 && ++looks > (options.verifiedAfter ?? 0) && options.verifies !== false) {
          for (const subscription of state.server) subscription.verificationCode ??= "code";
        }
        return [name, { list: state.server, notFound: [] }, id];
      }
      const destroyed = (args.destroy as string[] | undefined) ?? [];
      state.server = state.server.filter((s) => !destroyed.includes(s.id));
      const created: Record<string, { id: string; expires: string }> = {};
      for (const [key, value] of Object.entries((args.create ?? {}) as Record<string, Record<string, unknown>>)) {
        const id = `w${state.next++}`;
        state.server.push({
          id,
          deviceClientId: value.deviceClientId as string,
          url: value.url as string,
          expires: value.expires as string,
          verificationCode: null,
        });
        created[key] = { id, expires: "2026-10-04T11:59:59Z" };
      }
      const updated: Record<string, null> = {};
      for (const [key, value] of Object.entries((args.update ?? {}) as Record<string, Record<string, string>>)) {
        const found = state.server.find((s) => s.id === key);
        if (found) {
          found.expires = value.expires ?? found.expires;
          updated[key] = null;
        }
      }
      return [name, { created, updated, destroyed }, id];
    });
  };
  const deps: PushDeps = {
    kv: store,
    jmap,
    serverKey: () => state.serverKey,
    account: () => ({
      login: "mini@example.org",
      accountId: "a1",
      apiUrl: "/jmap/api",
      accounts: { a1: "mini@example.org", a3: "support@example.org" },
    }),
    pushManager: async (register) => {
      if (register) state.registered = true;
      return state.registered ? manager : null;
    },
    unregister: async () => {
      state.registered = false;
    },
    permission: () => state.permission,
    requestPermission: async () => {
      state.asked++;
      state.permission = options.answer ?? "granted";
      return state.permission;
    },
    deviceClientId: () => "device-1",
    texts: () => DEFAULT_TEXTS,
    now: () => new Date("2026-09-27T12:00:00Z"),
    sleep: async () => {
      state.slept++;
    },
  };
  return { deps, state, kv, subscribe };
}

describe("setting Web Push up", () => {
  it("asks for permission, subscribes for the server's key and registers with the server", async () => {
    const { deps, state, kv } = world();
    await enablePush(deps, true);
    expect(state.asked).toBe(1);
    expect(state.subscription?.key).toBe(SERVER_KEY);
    expect(state.server).toHaveLength(1);
    const created = state.requests.flat().find(([name]) => name === "PushSubscription/set")![1];
    expect(created.create).toEqual({
      push: {
        deviceClientId: "device-1",
        url: state.subscription!.endpoint,
        keys: { p256dh: "BCVx", auth: "BTBZ" },
        expires: "2026-10-04T12:00:00Z",
        types: PUSH_TYPES,
      },
    });
    expect(kv.get(CONFIG_KEY)).toEqual({
      login: "mini@example.org",
      accountId: "a1",
      accounts: { a1: "mini@example.org", a3: "support@example.org" },
      apiUrl: "/jmap/api",
      deviceClientId: "device-1",
      showContent: true,
      texts: DEFAULT_TEXTS,
      subscriptionId: state.server[0]!.id,
      endpoint: state.subscription!.endpoint,
      // What the server chose, not what was asked for.
      expires: "2026-10-04T11:59:59Z",
    } satisfies PushConfig);
    // Mail that was already waiting is not news.
    expect(kv.get(PROGRESS_KEY)).toEqual({ since: "2026-09-27T12:00:00Z", accounts: {} });
  });

  it("stops when notifications are not allowed", async () => {
    const { deps, state } = world({ answer: "denied" });
    await expect(enablePush(deps, true)).rejects.toMatchObject({ reason: "denied" });
    expect(state.server).toEqual([]);
    const blocked = world({ permission: "denied" });
    await expect(enablePush(blocked.deps, true)).rejects.toBeInstanceOf(PushError);
    expect(blocked.state.asked).toBe(0);
  });

  it("waits for the service worker to send the verification code back", async () => {
    const { deps, state } = world({ verifiedAfter: 3 });
    await enablePush(deps, true);
    expect(state.slept).toBe(3);
    expect(state.server[0]!.verificationCode).toBe("code");
  });

  it("gives up when the verification never comes back", async () => {
    const { deps, state } = world({ verifies: false });
    await expect(enablePush(deps, true)).rejects.toMatchObject({ reason: "unverified" });
    expect(state.slept).toBe(15);
  });

  it("writes the service worker's configuration before the server can push the code", async () => {
    const { deps, kv } = world();
    const jmap = deps.jmap;
    let configured: unknown;
    deps.jmap = async (calls) => {
      if (calls.some(([name, args]) => name === "PushSubscription/set" && args.create)) configured = kv.get(CONFIG_KEY);
      return jmap(calls);
    };
    await enablePush(deps, true);
    expect(configured).toMatchObject({ apiUrl: "/jmap/api", accountId: "a1" });
  });

  it("needs a server that offers push", async () => {
    const { deps, state } = world();
    state.serverKey = null;
    await expect(enablePush(deps, true)).rejects.toMatchObject({ reason: "unsupported" });
  });

  it("replaces a browser subscription made for another key and its own old ones on the server", async () => {
    const { deps, state, subscribe } = world({ permission: "granted" });
    state.registered = true;
    const old = subscribe(OTHER_KEY);
    state.server.push({ id: "w99", deviceClientId: "device-1", verificationCode: "x", expires: "", url: old.endpoint });
    state.server.push({ id: "w98", deviceClientId: "phone", verificationCode: "x", expires: "", url: "" });
    await enablePush(deps, false);
    expect(old.gone).toBe(true);
    expect(state.subscription?.key).toBe(SERVER_KEY);
    // The phone's subscription is not this browser's to touch.
    expect(state.server.map((s) => s.deviceClientId).sort()).toEqual(["device-1", "phone"]);
    expect(state.server.find((s) => s.id === "w99")).toBeUndefined();
  });
});

describe("keeping Web Push alive", () => {
  it("renews the expiry when everything is still there", async () => {
    const { deps, state, kv } = world();
    await enablePush(deps, true);
    const id = state.server[0]!.id;
    state.server[0]!.expires = "old";
    state.requests = [];
    deps.now = () => new Date("2026-09-30T12:00:00Z");
    expect(await renewPush(deps, false)).toBe("ok");
    expect(state.server.map((s) => [s.id, s.expires])).toEqual([[id, "2026-10-07T12:00:00Z"]]);
    expect(state.requests.flat().filter(([name]) => name === "PushSubscription/set")).toHaveLength(1);
    expect((kv.get(CONFIG_KEY) as PushConfig).showContent).toBe(false);
  });

  it("keeps what there is when the server can't be reached", async () => {
    const { deps, state, kv } = world();
    await enablePush(deps, true);
    const config = kv.get(CONFIG_KEY);
    state.serverAway = true;
    expect(await renewPush(deps, true)).toBe("failed");
    expect(kv.get(CONFIG_KEY)).toEqual(config);
    expect(state.subscription).not.toBeNull();
  });

  it("makes a new server subscription when the browser replaced its own", async () => {
    const { deps, state, subscribe } = world();
    await enablePush(deps, true);
    const first = state.server[0]!.id;
    subscribe(SERVER_KEY);
    expect(await renewPush(deps, true)).toBe("ok");
    expect(state.server).toHaveLength(1);
    expect(state.server[0]!.id).not.toBe(first);
    expect(state.server[0]!.url).toBe(state.subscription!.endpoint);
  });

  it("starts over for another login in this browser", async () => {
    const { deps, state } = world();
    await enablePush(deps, true);
    const first = state.server[0]!.id;
    deps.account = () => ({ login: "nyu@example.org", accountId: "a2", apiUrl: "/jmap/api" });
    expect(await renewPush(deps, true)).toBe("ok");
    expect(state.server.map((s) => s.id)).not.toContain(first);
  });

  it("sets it up again when the server forgot it", async () => {
    const { deps, state } = world();
    await enablePush(deps, true);
    state.server = [];
    expect(await renewPush(deps, true)).toBe("ok");
    expect(state.server).toHaveLength(1);
    expect(state.asked).toBe(1);
  });

  it("switches off when the permission was taken back", async () => {
    const { deps, state, kv } = world();
    await enablePush(deps, true);
    state.permission = "denied";
    expect(await renewPush(deps, true)).toBe("off");
    expect(state.server).toEqual([]);
    expect(state.subscription).toBeNull();
    expect(kv.has(CONFIG_KEY)).toBe(false);
  });

  it("lets go in this browser alone when the session is gone", async () => {
    const { deps, state, kv } = world();
    await enablePush(deps, true);
    state.requests = [];
    await forgetPush(deps);
    expect(state.requests).toEqual([]);
    expect(state.subscription).toBeNull();
    expect(state.registered).toBe(false);
    expect([...kv.keys()]).toEqual([]);
  });

  it("takes everything down when switched off", async () => {
    const { deps, state, kv } = world();
    await enablePush(deps, true);
    await disablePush(deps);
    expect(state.server).toEqual([]);
    expect(state.subscription).toBeNull();
    expect(state.registered).toBe(false);
    expect([...kv.keys()]).toEqual([]);
  });
});
