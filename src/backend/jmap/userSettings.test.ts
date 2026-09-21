import { describe, expect, it } from "vitest";
import { SIGNATURE_MAX_BYTES, valueSize } from "@/lib/signatures";
import type { Signature } from "../types";
import { newSignatureId, patchPath, signatureKey, signaturePatch, signaturesFrom } from "./userSettings";

const signature = (id: string, email: string, forNew: boolean, forReplies: boolean): Signature => ({
  id,
  email,
  name: id,
  html: `<p>${id}</p>`,
  forNew,
  forReplies,
});

describe("settings keys", () => {
  it("writes a signature as one key per entry", () => {
    expect(signatureKey("abc_DEF-1")).toBe("signature:abc_DEF-1");
    expect(patchPath(signatureKey("abc"))).toBe("values/signature:abc");
  });

  it("escapes keys as JSON pointer segments", () => {
    expect(patchPath("linkDomains:a/b~c")).toBe("values/linkDomains:a~1b~0c");
    // `~1` in the key itself must not turn into a slash on the server.
    expect(patchPath("x~1")).toBe("values/x~01");
  });

  it("refuses ids outside the agreed alphabet", () => {
    expect(() => signatureKey("")).toThrow();
    expect(() => signatureKey("a/b")).toThrow();
    expect(() => signatureKey("a".repeat(65))).toThrow();
    expect(() => signatureKey("ä")).toThrow();
  });

  it("makes ids the server accepts", () => {
    const id = newSignatureId();
    expect(() => signatureKey(id)).not.toThrow();
    expect(newSignatureId()).not.toBe(id);
  });
});

describe("signaturesFrom", () => {
  it("reads signatures and ignores every other key", () => {
    const list = signaturesFrom({
      theme: "dark",
      "signature:b": { email: "mini@uwumail.test", name: "Kurz", html: "<p>b</p>", forNew: false, forReplies: true },
      "signature:a": { email: "mini@uwumail.test", name: "Lang", html: "<p>a</p>", forNew: true, forReplies: false },
      "trustedSenders:@example.org": true,
    });
    expect(list.map((s) => s.id)).toEqual(["b", "a"]);
    expect(list[1]).toEqual({
      id: "a",
      email: "mini@uwumail.test",
      name: "Lang",
      html: "<p>a</p>",
      forNew: true,
      forReplies: false,
    });
  });

  it("skips values of the wrong shape instead of failing", () => {
    expect(
      signaturesFrom({
        "signature:x": "nope",
        "signature:y": null,
        "signature:z": { email: 3, html: "<p></p>" },
        "signature:bad/id": { email: "a@example.org", html: "" },
      }),
    ).toEqual([]);
  });
});

describe("signaturePatch", () => {
  it("takes a default away from the address's other signatures in the same write", () => {
    const existing = [
      signature("lang", "mini@uwumail.test", true, false),
      signature("kurz", "mini@uwumail.test", false, true),
      signature("studio", "hallo@uwumail.test", true, true),
    ];
    const patch = signaturePatch(signature("neu", "MINI@uwumail.test", true, false), existing);
    expect(Object.keys(patch).sort()).toEqual(["signature:lang", "signature:neu"]);
    expect(patch["signature:lang"]).toMatchObject({ forNew: false, forReplies: false });
    expect(patch["signature:neu"]).toEqual({
      email: "MINI@uwumail.test",
      name: "neu",
      html: "<p>neu</p>",
      forNew: true,
      forReplies: false,
    });
  });

  it("cuts long names and refuses values over the server's limit", () => {
    const long = { ...signature("a", "mini@uwumail.test", false, false), name: "n".repeat(150) };
    expect((signaturePatch(long, [])["signature:a"] as { name: string }).name).toHaveLength(100);

    const huge = { ...long, html: `<img src="data:image/png;base64,${"A".repeat(SIGNATURE_MAX_BYTES)}">` };
    expect(() => signaturePatch(huge, [])).toThrow(/too big/);
  });

  it("measures values in UTF-8 bytes", () => {
    expect(valueSize("ü")).toBe(4);
  });
});
