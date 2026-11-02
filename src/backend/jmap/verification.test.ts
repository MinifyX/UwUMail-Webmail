import { afterEach, describe, expect, it, vi } from "vitest";
import type { Invocation } from "./client";
import {
  VERIFICATION,
  activeCodes,
  codeCalls,
  toVerificationCode,
  verificationSupported,
  type JmapCodeEmail,
} from "./verification";

const NOW = Date.parse("2048-03-01T10:00:00Z");
const LATER = "2048-03-01T10:05:00Z";

function email(verification: unknown, overrides: Partial<JmapCodeEmail> = {}): JmapCodeEmail {
  return {
    id: "e93",
    threadId: "t7",
    from: [{ name: "Shop Beispiel", email: "noreply@shop.example" }],
    subject: "Dein Anmeldecode",
    verification,
    ...overrides,
  };
}

const otp = {
  kind: "otp",
  origin: "login.shop.example",
  code: "482913",
  purpose: "login",
  expiresAt: LATER,
  source: "header",
  autofill: true,
};

describe("Email.verification", () => {
  it("reads a signed code", () => {
    expect(toVerificationCode(email(otp))).toEqual({
      id: "e93",
      emailId: "e93",
      threadId: "t7",
      kind: "otp",
      code: "482913",
      origin: "login.shop.example",
      sender: "Shop Beispiel",
      subject: "Dein Anmeldecode",
      purpose: "login",
      source: "header",
      autofill: true,
      expiresAt: "2048-03-01T10:05:00.000Z",
    });
  });

  it("reads a sign-in link and falls back to the address without a name", () => {
    const code = toVerificationCode(
      email(
        {
          kind: "link",
          origin: "forum.example.net",
          code: null,
          url: "https://forum.example.net/l/1",
          purpose: "signup",
          expiresAt: LATER,
          source: "heuristic",
          autofill: false,
        },
        { from: [{ name: null, email: "hallo@forum.example.net" }] },
      ),
    );
    expect(code).toMatchObject({
      kind: "link",
      url: "https://forum.example.net/l/1",
      sender: "hallo@forum.example.net",
    });
    expect(code).not.toHaveProperty("code");
  });

  it("falls to the careful side for what it doesn't know", () => {
    const code = toVerificationCode(email({ ...otp, purpose: "bake-cake", source: "rumour", autofill: "yes" }));
    expect(code).toMatchObject({ purpose: "other", source: "heuristic", autofill: false });
  });

  it("leaves out what can't be shown", () => {
    expect(toVerificationCode(email(null))).toBeNull();
    expect(toVerificationCode(email(undefined))).toBeNull();
    expect(toVerificationCode(email("482913"))).toBeNull();
    expect(toVerificationCode(email({ ...otp, kind: "sms" }))).toBeNull();
    expect(toVerificationCode(email({ ...otp, code: null }))).toBeNull();
    expect(toVerificationCode(email({ ...otp, origin: "" }))).toBeNull();
    expect(toVerificationCode(email({ ...otp, expiresAt: "bald" }))).toBeNull();
    expect(toVerificationCode(email({ ...otp, kind: "link", code: null }))).toBeNull();
  });

  it("keeps the query's order and drops expired codes and missing mails", () => {
    const list = [
      email(otp, { id: "e88" }),
      email({ ...otp, expiresAt: "2048-03-01T09:59:00Z" }, { id: "e80" }),
      email(otp, { id: "e93" }),
    ];
    expect(activeCodes(["e93", "e88", "e80", "gone"], list, NOW).map((code) => code.id)).toEqual(["e93", "e88"]);
  });
});

describe("the capability", () => {
  const session = (session: unknown, account: unknown) => ({
    accountId: "a1",
    capabilities: session ? { [VERIFICATION]: {} } : {},
    accounts: {
      a1: {
        name: "a",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: account ? { [VERIFICATION]: {} } : {},
      },
    },
  });

  it("needs it in the session and in the own account", () => {
    expect(verificationSupported(session(true, true))).toBe(true);
    expect(verificationSupported(session(false, true))).toBe(false);
    expect(verificationSupported(session(true, false))).toBe(false);
  });

  it("asks for the valid codes and their mails in one request", () => {
    const [query, get] = codeCalls("a1");
    expect(query).toEqual(["VerificationCode/query", { accountId: "a1", filter: { expired: false }, limit: 50 }, "q"]);
    expect(get![0]).toBe("Email/get");
    expect(get![1]).toMatchObject({
      "#ids": { resultOf: "q", name: "VerificationCode/query", path: "/ids" },
      properties: expect.arrayContaining(["verification", "from", "subject"]),
    });
  });
});

// --- The backend's requests -------------------------------------------------------------------

const jmap = vi.hoisted(() => ({
  supported: true,
  calls: [] as { methods: Invocation[]; using: string[] }[],
}));

vi.mock("./client", async (original) => {
  const actual = await original<typeof import("./client")>();
  const VERIFY = "urn:uwumail:jmap:verification";
  const session = () => ({
    accountId: "a1",
    accounts: {
      a1: {
        name: "mini@uwumail.example",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities: jmap.supported ? { [VERIFY]: {} } : {},
      },
    },
    apiUrl: "/jmap/api",
    downloadUrl: "",
    uploadUrl: "",
    eventSourceUrl: "",
    capabilities: jmap.supported ? { [VERIFY]: {} } : {},
    state: "s1",
  });
  const later = new Date(Date.now() + 300_000).toISOString();
  const verification = {
    kind: "otp",
    origin: "login.shop.example",
    code: "482913",
    purpose: "login",
    expiresAt: later,
    source: "header",
    autofill: false,
  };
  const mail = {
    id: "e93",
    threadId: "t7",
    mailboxIds: {},
    keywords: {},
    from: [{ name: "Shop Beispiel", email: "noreply@shop.example" }],
    subject: "Dein Anmeldecode",
    receivedAt: "2048-03-01T09:59:00Z",
    verification,
  };
  return {
    ...actual,
    loadJmapSession: async () => session(),
    jmapSession: session,
    supports: (capability: string) => capability in session().capabilities,
    whenSessionChanges: () => {},
    watchPush: () => () => {},
    call: async (methods: Invocation[], using: string[]) => {
      jmap.calls.push({ methods, using });
      const name = methods[0]![0];
      if (name === "Mailbox/get") return { methodResponses: [["Mailbox/get", { list: [] }, "m0"]], sessionState: "s1" };
      if (name === "VerificationCode/query")
        return {
          methodResponses: [
            ["VerificationCode/query", { ids: ["e93"], position: 0, canCalculateChanges: false }, "q"],
            ["Email/get", { list: [mail], notFound: [] }, "e"],
          ],
          sessionState: "s1",
        };
      return {
        methodResponses: [
          ["Thread/get", { list: [{ id: "t7", emailIds: ["e93"] }] }, "t"],
          ["Email/get", { list: [mail], notFound: [] }, "e"],
        ],
        sessionState: "s1",
      };
    },
  };
});

describe("the backend", () => {
  const load = async () => new (await import("./JmapBackend")).JmapBackend();

  afterEach(() => {
    jmap.supported = true;
    jmap.calls = [];
  });

  it("loads the valid codes with the capability in `using`", async () => {
    const codes = await (await load()).verificationCodes();
    expect(codes).toEqual([
      expect.objectContaining({
        emailId: "e93",
        threadId: "t7",
        code: "482913",
        sender: "Shop Beispiel",
        autofill: false,
      }),
    ]);
    const request = jmap.calls.find((entry) => entry.methods[0]![0] === "VerificationCode/query")!;
    expect(request.using).toContain(VERIFICATION);
  });

  it("asks nothing and hides the bar without the capability", async () => {
    jmap.supported = false;
    expect(await (await load()).verificationCodes()).toBeNull();
    expect(jmap.calls.some((entry) => entry.methods[0]![0] === "VerificationCode/query")).toBe(false);
  });

  it("hands the reader the mail's own code", async () => {
    const detail = await (await load()).getThread("t7", true);
    expect(detail.messages[0]!.verification).toMatchObject({ code: "482913", origin: "login.shop.example" });
    const request = jmap.calls.find((entry) => entry.methods[0]![0] === "Thread/get")!;
    expect(request.using).toContain(VERIFICATION);
    expect(request.methods[1]![1].properties).toContain("verification");
  });

  it("doesn't ask for the property without the capability", async () => {
    jmap.supported = false;
    await (await load()).getThread("t7", true);
    const request = jmap.calls.find((entry) => entry.methods[0]![0] === "Thread/get")!;
    expect(request.using).not.toContain(VERIFICATION);
    expect(request.methods[1]![1].properties).not.toContain("verification");
  });
});
