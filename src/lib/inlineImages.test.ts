import { describe, expect, it } from "vitest";
import { isInlinePicture, normalizeContentId, referencedContentIds, replaceContentIds } from "./inlineImages";

describe("embedded images", () => {
  it("finds the parts a mail's HTML shows", () => {
    const html = `<img src="cid:Logo@Shop.example"><td style="background:url(cid:bg%40shop.example)"><img src='x.png'>`;
    expect([...referencedContentIds(html)]).toEqual(["logo@shop.example", "bg@shop.example"]);
    expect(referencedContentIds(null).size).toBe(0);
  });

  it("points them at the cached files and leaves the rest", () => {
    const urls = new Map([["logo@shop.example", "http://asset.localhost/logo.png"]]);
    expect(replaceContentIds(`<img src="cid:LOGO@shop.example"><img src="cid:missing@x">`, urls)).toBe(
      `<img src="http://asset.localhost/logo.png"><img src="cid:missing@x">`,
    );
  });

  it("compares ids without brackets and case", () => {
    expect(normalizeContentId(" <Img1.ABC@uwumail> ")).toBe("img1.abc@uwumail");
  });

  it("only swaps addresses that load pictures, never link targets", () => {
    const urls = new Map([["x@shop.example", "blob:own/x"]]);
    const html = replaceContentIds(
      `<a href="cid:x@shop.example">a</a><svg><image href="cid:x@shop.example"></image></svg>` +
        `<img srcset="cid:x@shop.example 2x"><div style="background:url(cid:x@shop.example)">c</div>`,
      urls,
    );
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelector("a")!.getAttribute("href")).toBe("cid:x@shop.example");
    expect(doc.querySelector("image")!.getAttribute("href")).toBe("blob:own/x");
    expect(doc.querySelector("img")!.getAttribute("srcset")).toBe("blob:own/x 2x");
    expect(doc.querySelector("div")!.getAttribute("style")).toContain("url(blob:own/x)");
  });

  it("shows only raster pictures inline", () => {
    expect(isInlinePicture("image/PNG")).toBe(true);
    expect(isInlinePicture("image/jpeg; name=a.jpg")).toBe(true);
    expect(isInlinePicture("image/svg+xml")).toBe(false);
    expect(isInlinePicture("text/html")).toBe(false);
  });
});
