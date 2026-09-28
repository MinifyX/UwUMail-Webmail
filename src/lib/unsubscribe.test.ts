import { describe, expect, it, vi } from "vitest";
import { JmapMethodError } from "@/backend/jmap/client";
import type { Unsubscribe } from "@/backend/types";
import { oneClickResultOf, runUnsubscribe, unsubscribeMail, type OneClickResult } from "./unsubscribe";

describe("unsubscribeMail", () => {
  it("takes the address and a subject list managers can match on", () => {
    expect(unsubscribeMail("mailto:leave@list.example")).toEqual({
      address: "leave@list.example",
      subject: "unsubscribe",
    });
    expect(unsubscribeMail("mailto:leave@list.example?subject=unsubscribe%20a1b2")).toEqual({
      address: "leave@list.example",
      subject: "unsubscribe a1b2",
    });
  });

  it("never carries text somebody else wrote", () => {
    const target = unsubscribeMail("mailto:leave@list.example?subject=bye&body=I%20quit%2C%20and%20here%20is%20why");
    expect(target).toEqual({ address: "leave@list.example", subject: "bye" });
    expect(JSON.stringify(target)).not.toContain("quit");
  });

  it("keeps a subject to one line and a sensible length", () => {
    expect(unsubscribeMail("mailto:leave@list.example?subject=one%0D%0Atwo")?.subject).toBe("one two");
    expect(unsubscribeMail(`mailto:leave@list.example?subject=${"x".repeat(500)}`)?.subject).toHaveLength(200);
    expect(unsubscribeMail("mailto:leave@list.example?subject=%20%20")?.subject).toBe("unsubscribe");
  });

  it("refuses anything that is not one plain address", () => {
    // A second recipient smuggled into the header.
    expect(unsubscribeMail("mailto:leave@list.example,boss@work.example")).toBeNull();
    // A line break, which would become a header of its own further down the line.
    expect(unsubscribeMail("mailto:leave@list.example%0D%0Abcc:boss@work.example")).toBeNull();
    expect(unsubscribeMail("mailto:Name%20%3Cleave@list.example%3E")).toBeNull();
    expect(unsubscribeMail("mailto:not-an-address")).toBeNull();
    expect(unsubscribeMail("mailto:")).toBeNull();
  });

  it("refuses a scheme that is not mailto", () => {
    expect(unsubscribeMail("https://list.example/leave")).toBeNull();
    expect(unsubscribeMail("javascript:alert(1)")).toBeNull();
    expect(unsubscribeMail("not a url at all")).toBeNull();
  });
});

describe("runUnsubscribe", () => {
  const both: Unsubscribe = {
    oneClick: true,
    url: "https://list.example/leave",
    mailto: "mailto:leave@list.example?subject=bye",
  };
  const steps = (result: OneClickResult) => ({
    oneClick: vi.fn(async () => result),
    sendMail: vi.fn(async () => {}),
  });

  it("lets the server do the one click and nothing else when it works", async () => {
    const done = steps({ kind: "done" });
    expect(await runUnsubscribe(both, done)).toEqual({ kind: "done", via: "oneClick" });
    expect(done.sendMail).not.toHaveBeenCalled();
  });

  it("goes the old way when the mail can't be unsubscribed with one click", async () => {
    const cannot = steps({ kind: "cannot" });
    expect(await runUnsubscribe(both, cannot)).toEqual({ kind: "done", via: "mail" });
    expect(cannot.sendMail).toHaveBeenCalledWith({ address: "leave@list.example", subject: "bye" });

    const pageOnly = steps({ kind: "cannot" });
    expect(await runUnsubscribe({ oneClick: true, url: "https://list.example/leave" }, pageOnly)).toEqual({
      kind: "openPage",
      url: "https://list.example/leave",
    });
  });

  it("says when the one click failed, names the other way, and takes it only when asked again", async () => {
    const failed = steps({ kind: "failed", reason: "list.example answered 503" });
    expect(await runUnsubscribe(both, failed)).toEqual({
      kind: "oneClickFailed",
      reason: "list.example answered 503",
      fallback: "mail",
    });
    expect(failed.sendMail).not.toHaveBeenCalled();
    expect(
      await runUnsubscribe(
        { oneClick: true, url: "https://list.example/leave" },
        steps({ kind: "failed", reason: "" }),
      ),
    ).toMatchObject({ fallback: "page" });

    const again = steps({ kind: "failed", reason: "" });
    expect(await runUnsubscribe(both, again, false)).toEqual({ kind: "done", via: "mail" });
    expect(again.oneClick).not.toHaveBeenCalled();
  });

  it("never asks the server where it doesn't do the one click", async () => {
    const plain = steps({ kind: "done" });
    expect(await runUnsubscribe({ ...both, oneClick: false }, plain)).toEqual({ kind: "done", via: "mail" });
    expect(plain.oneClick).not.toHaveBeenCalled();
  });

  it("opens the page when the mail address makes no sense, and refuses when nothing is left", async () => {
    const odd = { oneClick: false, url: "https://list.example/leave", mailto: "mailto:a@b.example,c@d.example" };
    expect(await runUnsubscribe(odd, steps({ kind: "done" }))).toEqual({ kind: "openPage", url: odd.url });
    await expect(
      runUnsubscribe({ oneClick: false, mailto: "mailto:not-an-address" }, steps({ kind: "done" })),
    ).rejects.toMatchObject({ code: "invalid_input" });
    await expect(runUnsubscribe({ oneClick: false }, steps({ kind: "done" }))).rejects.toMatchObject({
      code: "not_supported",
    });
  });

  it("reads the server's refusals", () => {
    expect(oneClickResultOf(new JmapMethodError("internal", "x", "cannotUnsubscribe"))).toEqual({ kind: "cannot" });
    expect(
      oneClickResultOf(new JmapMethodError("internal", "x", "unsubscribeFailed", " The answer was 500. ")),
    ).toEqual({ kind: "failed", reason: "The answer was 500." });
    expect(() => oneClickResultOf(new JmapMethodError("internal", "x", "notFound"))).toThrow("That mail is gone.");
    const other = new JmapMethodError("internal", "x", "serverFail");
    expect(() => oneClickResultOf(other)).toThrow(other);
  });
});
