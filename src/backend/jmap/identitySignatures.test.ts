import { describe, expect, it } from "vitest";
import type { Signature } from "../types";
import {
  hasIdentitySignatures,
  identitySignature,
  identitySignaturePatch,
  signatureMigration,
  textSignatureHtml,
} from "./identitySignatures";

const own = { id: "i1", name: "Mini", email: "mini@example.com", textSignature: "", htmlSignature: "" };
const alias = { id: "i2", name: "", email: "hello@example.com", textSignature: "", htmlSignature: "" };

function settingsSignature(patch: Partial<Signature>): Signature {
  return {
    id: "s",
    email: "mini@example.com",
    name: "Long",
    html: "<p>Long</p>",
    forNew: false,
    forReplies: false,
    ...patch,
  };
}

describe("identity signatures", () => {
  it("are there when the server hands out the property, even empty", () => {
    expect(hasIdentitySignatures([own, alias])).toBe(true);
    expect(hasIdentitySignatures([{ id: "i1", name: "Mini", email: "mini@example.com" }])).toBe(false);
    expect(hasIdentitySignatures([])).toBe(false);
  });

  it("become the address's one signature, for new mail and replies", () => {
    expect(identitySignature({ ...own, htmlSignature: "<p><b>Mini</b></p>" })).toEqual({
      id: "i1",
      email: "mini@example.com",
      name: "Mini",
      html: "<p><b>Mini</b></p>",
      forNew: true,
      forReplies: true,
    });
    expect(identitySignature({ ...alias, htmlSignature: "<p>Hi</p>" })?.name).toBe("hello@example.com");
  });

  it("are none while both texts are empty", () => {
    expect(identitySignature(own)).toBeNull();
    expect(identitySignature({ ...own, htmlSignature: "  ", textSignature: null })).toBeNull();
  });

  it("take a text-only signature as escaped HTML", () => {
    const signature = identitySignature({ ...own, textSignature: "Mini <mini@example.com>\nexample.com" });
    expect(signature?.html).toBe("<p>Mini &lt;mini@example.com&gt;<br>example.com</p>");
    expect(textSignatureHtml('a & "b"')).toBe("a &amp; &quot;b&quot;");
  });

  it("are written as HTML with the same text beside it", () => {
    expect(identitySignaturePatch("<p>Nyu<br>example.com</p>")).toEqual({
      htmlSignature: "<p>Nyu<br>example.com</p>",
      textSignature: "Nyu\nexample.com",
    });
    expect(identitySignaturePatch("")).toEqual({ htmlSignature: "", textSignature: "" });
  });
});

describe("moving the settings' signatures over", () => {
  it("gives each address without one the signature it used for new mail", () => {
    const plan = signatureMigration(
      [own, alias],
      [
        settingsSignature({ id: "a", html: "<p>Short</p>", forReplies: true }),
        settingsSignature({ id: "b", html: "<p>Long</p>", forNew: true }),
        settingsSignature({ id: "c", email: "HELLO@example.com", html: "<p>Studio</p>" }),
      ],
    );
    expect(plan).toEqual({ i1: "<p>Long</p>", i2: "<p>Studio</p>" });
  });

  it("falls back to the one for replies", () => {
    const plan = signatureMigration([own], [settingsSignature({ id: "a", html: "<p>Short</p>", forReplies: true })]);
    expect(plan).toEqual({ i1: "<p>Short</p>" });
  });

  it("leaves addresses alone that have one, and skips empty ones", () => {
    const plan = signatureMigration(
      [{ ...own, htmlSignature: "<p>Mine</p>" }, alias],
      [settingsSignature({ forNew: true }), settingsSignature({ email: "hello@example.com", html: " " })],
    );
    expect(plan).toEqual({});
  });
});
