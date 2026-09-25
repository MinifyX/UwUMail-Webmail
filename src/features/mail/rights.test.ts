import { describe, expect, it } from "vitest";
import type { Folder, FolderRights } from "@/backend/types";
import { folderRights, mailRights } from "./rights";

const everything: FolderRights = {
  mayReadItems: true,
  mayAddItems: true,
  mayRemoveItems: true,
  maySetSeen: true,
  maySetKeywords: true,
  mayCreateChild: true,
  mayRename: true,
  mayDelete: true,
  mayAdmin: true,
};
const readOnly: FolderRights = {
  ...everything,
  mayAddItems: false,
  mayRemoveItems: false,
  maySetSeen: false,
  maySetKeywords: false,
  mayCreateChild: false,
  mayRename: false,
  mayDelete: false,
  mayAdmin: false,
};

function folder(id: string, patch: Partial<Folder> = {}): Folder {
  return {
    id,
    accountId: "a1",
    name: id,
    path: id,
    role: null,
    parentId: null,
    selectable: true,
    unread: 0,
    total: 0,
    ...patch,
  };
}

const own = folder("m1", { rights: everything });
const team = folder("a3~m7", {
  accountId: "a3",
  shared: true,
  rights: { ...readOnly, maySetSeen: true, maySetKeywords: true, mayAddItems: true, mayRemoveItems: true },
});
const invoices = folder("a3~m8", { accountId: "a3", shared: true, rights: readOnly });

describe("what can be done with mail", () => {
  it("allows everything in the account's own folders", () => {
    expect(mailRights(["m1"], [own, team])).toEqual({
      shared: false,
      markSeen: true,
      flag: true,
      remove: true,
      archive: true,
      spam: true,
    });
  });

  it("allows reading only in a folder shared to read", () => {
    expect(mailRights(["a3~m8"], [own, invoices])).toEqual({
      shared: true,
      markSeen: false,
      flag: false,
      remove: false,
      archive: false,
      spam: false,
    });
  });

  it("allows flags and moving in a folder shared to write, but never the own archive or junk", () => {
    const rights = mailRights(["a3~m7"], [team]);
    expect(rights).toMatchObject({
      shared: true,
      markSeen: true,
      flag: true,
      remove: true,
      archive: false,
      spam: false,
    });
  });

  it("takes what all of the folders allow", () => {
    expect(mailRights(["a3~m7", "a3~m8"], [team, invoices]).flag).toBe(false);
  });

  it("treats folders a server says nothing about as the account's own", () => {
    expect(mailRights(["m9"], []).archive).toBe(true);
    expect(folderRights(folder("m2")).remove).toBe(true);
    expect(folderRights(undefined).spam).toBe(true);
  });
});
