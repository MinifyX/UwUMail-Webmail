import { beforeEach, describe, expect, it } from "vitest";
import { loadLocalDraft, markLocalDraftSaved, saveLocalDraft } from "./localDraft";

const KEY = "uwumail.phoneDraft";

function writeDraft() {
  saveLocalDraft({
    mode: "reply",
    accountId: "a",
    to: [{ email: "friend@example.org" }],
    cc: [],
    bcc: [{ email: "secret@example.org" }],
    subject: "Private",
    html: "<p>Only for me</p><blockquote>The quoted mail</blockquote>",
    inReplyTo: "m1",
    savedToServer: false,
  });
}

beforeEach(() => localStorage.clear());

describe("the draft kept on this device", () => {
  it("keeps only the draft's id once it is in the Drafts folder", () => {
    writeDraft();
    markLocalDraftSaved("key@example.org", "e7");
    const raw = localStorage.getItem(KEY)!;
    expect(raw).not.toContain("friend@example.org");
    expect(raw).not.toContain("secret@example.org");
    expect(raw).not.toContain("Private");
    expect(raw).not.toContain("quoted mail");
    expect(loadLocalDraft()).toMatchObject({ emailId: "e7", draftKey: "key@example.org", savedToServer: true });
  });

  it("keeps the whole copy when the backend names no id", () => {
    writeDraft();
    markLocalDraftSaved("key@example.org");
    expect(loadLocalDraft()).toMatchObject({ subject: "Private", savedToServer: true, draftKey: "key@example.org" });
  });

  it("brings back nothing for an empty copy", () => {
    saveLocalDraft({ mode: "new", accountId: "a", to: [], cc: [], bcc: [], subject: "", html: "<p><br></p>" });
    expect(loadLocalDraft()).toBeNull();
  });
});
