import { describe, expect, it } from "vitest";
import {
  groupByAccount,
  peopleFrom,
  scopeEmail,
  scopeId,
  shareLevel,
  sharedAccountsFrom,
  sharedWithFrom,
  toFolderRights,
  unscopeId,
} from "./sharing";

const OWN = "a7";

describe("ids of shared accounts", () => {
  it("leave the own account's ids alone and carry the account for others", () => {
    expect(scopeId(OWN, "m12", OWN)).toBe("m12");
    expect(scopeId("a3", "m12", OWN)).toBe("a3~m12");
  });

  it("come apart again", () => {
    expect(unscopeId("m12", OWN)).toEqual({ accountId: OWN, id: "m12" });
    expect(unscopeId("a3~m12", OWN)).toEqual({ accountId: "a3", id: "m12" });
  });

  it("group by account", () => {
    const groups = groupByAccount(["e1", "a3~e2", "e3", "a3~e4", "a9~e5"], OWN);
    expect(Object.fromEntries(groups)).toEqual({ a7: ["e1", "e3"], a3: ["e2", "e4"], a9: ["e5"] });
  });

  it("scope a shared message's own, thread and mailbox ids", () => {
    const email = { id: "e2", threadId: "t4", mailboxIds: { m12: true }, subject: "Hi" };
    expect(scopeEmail(email, "a3", OWN)).toEqual({
      id: "a3~e2",
      threadId: "a3~t4",
      mailboxIds: { "a3~m12": true },
      subject: "Hi",
    });
    expect(scopeEmail(email, OWN, OWN)).toBe(email);
  });
});

describe("rights", () => {
  it("read myRights, with sharing only where the server says so", () => {
    expect(toFolderRights({ mayReadItems: true, mayAddItems: false, mayAdmin: true })).toMatchObject({
      mayReadItems: true,
      mayAddItems: false,
      maySetSeen: false,
      mayAdmin: true,
    });
    expect(toFolderRights(undefined)).toMatchObject({ mayReadItems: true, mayRemoveItems: true, mayAdmin: false });
  });

  it("sum a share up as a level", () => {
    expect(shareLevel({ mayReadItems: true })).toBe("read");
    expect(shareLevel({ mayReadItems: true, maySetSeen: true, mayAddItems: true })).toBe("write");
    expect(shareLevel({ mayReadItems: true, mayAdmin: true })).toBe("all");
    expect(shareLevel("write")).toBe("write");
  });

  it("list who a folder is shared with, and nothing when it may not be shared", () => {
    expect(sharedWithFrom({ p3: { mayReadItems: true }, p9: "all", p4: null })).toEqual({ p3: "read", p9: "all" });
    expect(sharedWithFrom(null)).toBeUndefined();
    expect(sharedWithFrom({})).toEqual({});
  });
});

describe("people and who shares", () => {
  const principals = [
    { id: "p7", type: "individual", name: "Leni", email: "leni@example.org", accounts: { a7: {} } },
    { id: "p3", type: "individual", name: "Mini", email: "mini@example.org", accounts: { a3: {} } },
    { id: "p5", type: "individual", name: "", email: "kai@example.org", accounts: null },
  ];

  it("lists everyone to share with but the account itself, by name", () => {
    expect(peopleFrom(principals, "p7", "leni@example.org")).toEqual([
      { id: "p5", name: "kai@example.org", email: "kai@example.org" },
      { id: "p3", name: "Mini", email: "mini@example.org" },
    ]);
  });

  it("names the accounts that share folders", () => {
    const accounts = {
      a7: { name: "leni@example.org", isPersonal: true, isReadOnly: false, accountCapabilities: {} },
      a3: {
        name: "mini@example.org",
        isPersonal: false,
        isReadOnly: true,
        accountCapabilities: {
          "urn:ietf:params:jmap:mail": {},
          "urn:ietf:params:jmap:principals:owner": { accountIdForPrincipal: "a3", principalId: "p3" },
        },
      },
    };
    expect(sharedAccountsFrom(accounts, OWN, principals)).toEqual([
      { id: "a3", email: "mini@example.org", name: "Mini", readOnly: true },
    ]);
    expect(sharedAccountsFrom(accounts, OWN)).toEqual([
      { id: "a3", email: "mini@example.org", name: "mini@example.org", readOnly: true },
    ]);
  });
});
