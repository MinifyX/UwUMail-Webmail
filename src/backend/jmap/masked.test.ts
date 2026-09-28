import { afterEach, describe, expect, it, vi } from "vitest";
import { BackendError } from "../backend";
import { MASKED, maskedCreate, maskedOptionsFrom, maskedSetError, maskedUpdate, toMaskedAddress } from "./masked";

describe("the account's capability", () => {
  it("is missing on servers without masked addresses", () => {
    expect(maskedOptionsFrom(undefined)).toBeNull();
    expect(maskedOptionsFrom({ "urn:ietf:params:jmap:mail": {} })).toBeNull();
    expect(maskedOptionsFrom({ [MASKED]: true })).toBeNull();
  });

  it("leaves the domain to older servers that announce an empty object", () => {
    expect(maskedOptionsFrom({ [MASKED]: {} })).toEqual({ domains: null, defaultDomain: null });
  });

  it("names the allowed domains and the default", () => {
    expect(
      maskedOptionsFrom({ [MASKED]: { domains: ["uwumail.example", "mask.example"], defaultDomain: "mask.example" } }),
    ).toEqual({ domains: ["uwumail.example", "mask.example"], defaultDomain: "mask.example" });
    expect(maskedOptionsFrom({ [MASKED]: { domains: ["mask.example"], defaultDomain: null } })).toEqual({
      domains: ["mask.example"],
      defaultDomain: null,
    });
  });

  it("says so when no domain is allowed", () => {
    expect(maskedOptionsFrom({ [MASKED]: { domains: [], defaultDomain: null } })).toEqual({
      domains: [],
      defaultDomain: null,
    });
  });

  it("drops a default that isn't allowed and entries that aren't names", () => {
    expect(
      maskedOptionsFrom({
        [MASKED]: { domains: ["mask.example", 3, "", "mask.example"], defaultDomain: "other.test" },
      }),
    ).toEqual({ domains: ["mask.example"], defaultDomain: null });
  });
});

describe("MaskedEmail objects", () => {
  it("fill in what the server leaves out", () => {
    expect(
      toMaskedAddress({ id: "x1", email: "maple.otter482@mask.example", createdAt: "2026-09-27T10:00:00Z" }),
    ).toEqual({
      id: "x1",
      email: "maple.otter482@mask.example",
      state: "enabled",
      forDomain: "",
      description: "",
      url: null,
      createdAt: "2026-09-27T10:00:00Z",
      lastMessageAt: null,
      createdBy: "",
    });
    expect(toMaskedAddress({ id: "x2", email: "a@mask.example", state: "pending", forDomain: null }).state).toBe(
      "pending",
    );
  });

  it("are made enabled, with a domain only when one was chosen", () => {
    expect(maskedCreate({ description: "Shop", forDomain: "https://shop.example.com", url: null })).toEqual({
      state: "enabled",
      description: "Shop",
      forDomain: "https://shop.example.com",
    });
    expect(
      maskedCreate({
        description: "",
        forDomain: "",
        url: "https://shop.example.com/me",
        emailPrefix: "shop",
        domain: "mask.example",
      }),
    ).toEqual({
      state: "enabled",
      description: "",
      forDomain: "",
      url: "https://shop.example.com/me",
      emailPrefix: "shop",
      domain: "mask.example",
    });
  });

  it("are changed only where the patch says", () => {
    expect(maskedUpdate({ state: "disabled", description: undefined })).toEqual({ state: "disabled" });
    expect(maskedUpdate({ url: null })).toEqual({ url: null });
  });

  it("come back refused with a code the settings can explain", () => {
    expect(maskedSetError({ type: "forbidden", description: "not allowed" }).code).toBe("forbidden");
    expect(maskedSetError({ type: "invalidProperties", properties: ["emailPrefix"] }).code).toBe("invalid_input");
    expect(maskedSetError({ type: "notFound" }).code).toBe("not_found");
    expect(maskedSetError({ type: "serverFail" }).code).toBe("internal");
  });
});

// The backend's methods, with the transport answering like the server.
const jmap = vi.hoisted(() => ({
  capability: { domains: ["mask.example", "uwumail.example"], defaultDomain: "mask.example" } as unknown,
  one: vi.fn(),
}));

vi.mock("./client", async (original) => {
  const actual = await original<typeof import("./client")>();
  const session = () => ({
    accountId: "a1",
    accounts: {
      a1: {
        name: "mini@uwumail.example",
        isPersonal: true,
        isReadOnly: false,
        accountCapabilities:
          jmap.capability === undefined
            ? {}
            : { [actual.MAIL]: {}, "https://www.fastmail.com/dev/maskedemail": jmap.capability },
      },
    },
    apiUrl: "/jmap/api",
    downloadUrl: "",
    uploadUrl: "",
    eventSourceUrl: "",
    capabilities: {},
    state: "s1",
  });
  return {
    ...actual,
    loadJmapSession: async () => session(),
    jmapSession: session,
    whenSessionChanges: () => {},
    watchPush: () => () => {},
    call: async () => ({
      methodResponses: [["Mailbox/get", { list: [], notFound: [], state: "1" }, "m0"]],
      sessionState: "s1",
    }),
    one: jmap.one,
  };
});

describe("JmapBackend", () => {
  afterEach(() => {
    jmap.one.mockReset();
    jmap.capability = { domains: ["mask.example", "uwumail.example"], defaultDomain: "mask.example" };
  });

  const load = async () => new (await import("./JmapBackend")).JmapBackend();

  it("offers masked addresses only where the account's capabilities say so", async () => {
    const backend = await load();
    expect(await backend.maskedOptions()).toEqual({
      domains: ["mask.example", "uwumail.example"],
      defaultDomain: "mask.example",
    });
    jmap.capability = undefined;
    expect(await backend.maskedOptions()).toBeNull();
    await expect(backend.maskedAddresses()).rejects.toMatchObject({ code: "not_supported" });
    expect(jmap.one).not.toHaveBeenCalled();
  });

  it("lists every masked address, newest first", async () => {
    jmap.one.mockResolvedValueOnce({
      list: [
        { id: "x1", email: "fern.otter804@mask.example", state: "deleted", createdAt: "2026-01-01T00:00:00Z" },
        { id: "x2", email: "maple.otter482@mask.example", state: "enabled", createdAt: "2026-09-01T00:00:00Z" },
      ],
      notFound: [],
      state: "7",
    });
    const list = await (await load()).maskedAddresses();
    expect(list.map((item) => item.id)).toEqual(["x2", "x1"]);
    expect(jmap.one).toHaveBeenCalledWith("MaskedEmail/get", { ids: null }, [
      "urn:ietf:params:jmap:core",
      "https://www.fastmail.com/dev/maskedemail",
    ]);
  });

  it("makes one on the chosen domain and hands back what the server made", async () => {
    jmap.one.mockResolvedValueOnce({
      created: {
        new: {
          id: "x9",
          email: "shop.maple.otter482@uwumail.example",
          state: "enabled",
          createdAt: "2026-09-27T10:00:00Z",
          createdBy: "JMAP",
          lastMessageAt: null,
          emailPrefix: "shop",
        },
      },
    });
    const backend = await load();
    const events: string[] = [];
    backend.subscribe((event) => events.push(event.type));
    const made = await backend.createMaskedAddress({
      description: "Shop",
      forDomain: "https://shop.example.com",
      url: null,
      emailPrefix: "shop",
      domain: "uwumail.example",
    });
    expect(jmap.one).toHaveBeenCalledWith(
      "MaskedEmail/set",
      {
        create: {
          new: {
            state: "enabled",
            description: "Shop",
            forDomain: "https://shop.example.com",
            emailPrefix: "shop",
            domain: "uwumail.example",
          },
        },
      },
      expect.any(Array),
    );
    expect(made).toMatchObject({
      id: "x9",
      email: "shop.maple.otter482@uwumail.example",
      description: "Shop",
      forDomain: "https://shop.example.com",
      createdAt: "2026-09-27T10:00:00Z",
    });
    expect(events).toContain("masked:changed");
  });

  it("passes a refused domain on as forbidden", async () => {
    jmap.one.mockResolvedValueOnce({ notCreated: { new: { type: "forbidden", description: "Not on that domain." } } });
    const refused = (await load()).createMaskedAddress({ description: "", forDomain: "", url: null, domain: "x.test" });
    await expect(refused).rejects.toBeInstanceOf(BackendError);
    await expect(refused).rejects.toMatchObject({ code: "forbidden" });
  });

  it("changes the state, a deleted one back included", async () => {
    jmap.one.mockResolvedValueOnce({ updated: { x1: null } });
    await (await load()).updateMaskedAddress("x1", { state: "enabled" });
    expect(jmap.one).toHaveBeenCalledWith(
      "MaskedEmail/set",
      { update: { x1: { state: "enabled" } } },
      expect.any(Array),
    );

    jmap.one.mockResolvedValueOnce({ notUpdated: { x1: { type: "notFound" } } });
    await expect((await load()).updateMaskedAddress("x1", { state: "disabled" })).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
