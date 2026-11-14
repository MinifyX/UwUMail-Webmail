import { describe, expect, it } from "vitest";
import { BACKUPS, backupFilter, backupsSupported, toBackupContent, toBackupSearch, toRestoreResult } from "./backups";

describe("the backups capability", () => {
  it("is there only as an object in the own account's capabilities", () => {
    expect(backupsSupported(undefined)).toBe(false);
    expect(backupsSupported({ "urn:ietf:params:jmap:mail": {} })).toBe(false);
    expect(backupsSupported({ [BACKUPS]: true })).toBe(false);
    expect(backupsSupported({ [BACKUPS]: {} })).toBe(true);
  });
});

describe("BackupEmail", () => {
  it("is asked for with only what was filled in", () => {
    expect(backupFilter({ text: "  ", after: "" })).toEqual({});
    expect(backupFilter({ text: " eSIM ", before: "2026-11-05T00:00:00Z" })).toEqual({
      text: "eSIM",
      before: "2026-11-05T00:00:00Z",
    });
    expect(backupFilter({ text: "x".repeat(300) }).text).toHaveLength(256);
  });

  it("answers the query with the hits and how far the backups are read", () => {
    expect(
      toBackupSearch({
        list: [
          {
            id: "k17",
            subject: "Deine eSIM",
            from: [{ name: "Telekom", email: "esim@example.com" }],
            to: [{ name: null, email: "mini@example.org" }, { name: "nobody" }],
            receivedAt: "2026-11-02T09:14:00Z",
            size: 48211,
            folder: "Inbox",
            snapshots: ["2026-11-03T01:30:00Z", "2026-11-04T01:30:00Z"],
            inMailbox: false,
          },
          { id: "k18" },
        ],
        indexing: { done: 4, total: 7 },
      }),
    ).toEqual({
      list: [
        {
          id: "k17",
          subject: "Deine eSIM",
          from: [{ name: "Telekom", email: "esim@example.com" }],
          to: [{ email: "mini@example.org" }],
          receivedAt: "2026-11-02T09:14:00Z",
          size: 48211,
          folder: "Inbox",
          snapshots: ["2026-11-03T01:30:00Z", "2026-11-04T01:30:00Z"],
          inMailbox: false,
        },
        {
          id: "k18",
          subject: "",
          from: [],
          to: [],
          receivedAt: "1970-01-01T00:00:00.000Z",
          size: 0,
          folder: "",
          snapshots: [],
          inMailbox: false,
        },
      ],
      indexing: { done: 4, total: 7 },
    });
    expect(toBackupSearch({}).indexing).toEqual({ done: 0, total: 0 });
  });

  it("reads a mail as text with its attachments", () => {
    const mail = toBackupContent({
      id: "k17",
      textBody: "<b>not html</b>",
      attachments: [{ name: "esim.pdf", type: "application/pdf", size: 1200 }, {}],
    });
    expect(mail.text).toBe("<b>not html</b>");
    expect(mail.attachments).toEqual([
      { name: "esim.pdf", type: "application/pdf", size: 1200 },
      { name: "", type: "application/octet-stream", size: 0 },
    ]);
  });

  it("says what came back, what was there already, and why the rest didn't", () => {
    expect(
      toRestoreResult({
        restored: { k17: "m9" },
        alreadyThere: ["k3"],
        notRestored: { k4: { type: "overQuota" }, k5: { type: "notFound" }, k6: { type: "serverFail" } },
      }),
    ).toEqual({
      restored: { k17: "m9" },
      alreadyThere: ["k3"],
      notRestored: { k4: "overQuota", k5: "notFound", k6: "other" },
    });
    expect(toRestoreResult({})).toEqual({ restored: {}, alreadyThere: [], notRestored: {} });
  });
});
