import { describe, expect, it, vi } from "vitest";
import type { Message } from "@/backend/types";
import {
  buildDocument,
  buildPrintDocument,
  fixViewportHeightUnits,
  isRunaway,
  readableBody,
  resolveAppearance,
  ROOT_ID,
} from "./MessageBody";
import { eventsInMail } from "@/lib/dates";
import { loadRemotePictures } from "./remotePictures";

function message(patch: Partial<Message>): Message {
  return {
    id: "m1",
    threadId: "t1",
    accountId: "a1",
    folderId: "f1",
    from: { email: "news@shop.example" },
    to: [],
    cc: [],
    replyTo: [],
    subject: "News",
    date: "2026-09-14T10:00:00Z",
    flags: { seen: false, flagged: false, answered: false, draft: false },
    snippet: "",
    bodyHtml: null,
    bodyText: null,
    hasRemoteContent: false,
    attachments: [],
    ...patch,
  };
}

describe("buildDocument", () => {
  it("keeps a newsletter's leading <style> block", () => {
    const doc = buildDocument(
      message({ bodyHtml: '<style>.cta { color: #ff0000 }</style><table><tr><td class="cta">Buy</td></tr></table>' }),
      false,
      "light",
    );
    expect(doc).toContain(".cta { color: #ff0000 }");
    expect(doc).toContain(`<div id="${ROOT_ID}">`);
  });

  it("strips scripts and handlers", () => {
    const doc = buildDocument(
      message({ bodyHtml: '<p onclick="steal()">Hi</p><script>steal()</script>' }),
      false,
      "light",
    );
    expect(doc).not.toContain("steal");
  });

  it("does not force app typography onto HTML mail", () => {
    const doc = buildDocument(message({ bodyHtml: "<p>Hi</p>" }), false, "light");
    expect(doc).not.toContain("overflow-wrap:anywhere");
    expect(doc).not.toContain("font:15px");
  });

  describe("fonts", () => {
    const file = "https://mail.example.org/mail/assets/UwUSans_wght_-abc.woff2";
    const faces = `@font-face{font-family:"uwu-mail-font";src:url("${file}") format("woff2")}`;
    const fonts = { font: "uwu", senderFonts: "replace", faces, sources: file } as const;
    const build = (patch: Partial<Message>, chosen: Parameters<typeof buildDocument>[7] = fonts) =>
      buildDocument(message(patch), false, "light", new Map(), null, false, [], chosen);

    it("gives HTML mail without a font of its own ours instead of the engine's Times", () => {
      const doc = build({ bodyHtml: "<p>Hi</p>" });
      expect(doc).toContain(faces);
      expect(doc).toMatch(/body\{[^}]*font-family:var\(--uwu-font\)/);
      expect(doc).toContain('--uwu-font:"uwu-mail-font", system-ui');
    });

    it("lets the frame load exactly the font's files and nothing else from our origin", () => {
      expect(build({ bodyHtml: "<p>Hi</p>" })).toContain(`font-src ${file};`);
      expect(build({ bodyHtml: "<p>Hi</p>" }, { ...fonts, font: "system", faces: "", sources: "" })).toContain(
        "font-src 'none';",
      );
    });

    it("replaces serif fonts, or keeps them when asked", () => {
      const html = '<p style="font-family: Georgia, serif">Hi</p><p style="font-family: Arial, sans-serif">Ho</p>';
      const replaced = build({ bodyHtml: html });
      expect(replaced).toContain("font-family: var(--uwu-serif, Georgia), var(--uwu-serif, serif)");
      expect(replaced).toContain("font-family: Arial, var(--uwu-sans, sans-serif)");
      expect(replaced).toContain("--uwu-serif:var(--uwu-font)");
      const kept = build({ bodyHtml: html }, { ...fonts, senderFonts: "keep" });
      expect(kept).not.toContain("--uwu-serif:");
      expect(kept).not.toContain("--uwu-sans:");
      // ...but a mail without a font still doesn't end up in Times
      expect(kept).toMatch(/body\{[^}]*font-family:var\(--uwu-font\)/);
    });

    it("rewrites style blocks, never monospace", () => {
      const doc = build({
        bodyHtml:
          "<style>td{font-family:'Times New Roman'} pre{font-family:Consolas,monospace}</style><table><tr><td>x</td></tr></table>",
      });
      expect(doc).toContain("td{font-family:var(--uwu-serif, 'Times New Roman'), var(--uwu-font)}");
      expect(doc).toContain("pre{font-family:Consolas,monospace}");
      expect(doc).toContain("pre,code,kbd,samp,tt{font-variant-ligatures:no-contextual}");
    });

    it("sets plain text in the chosen font", () => {
      expect(build({ bodyText: "Hi :3" })).toContain("font:15px/1.6 var(--uwu-font)");
    });

    it("sanitizes the same way whatever the setting, so found dates keep their places", () => {
      const mail = message({ bodyHtml: '<p style="font-family:Georgia">Termin am 3.10.</p>' });
      expect(readableBody(mail)).toContain("var(--uwu-serif, Georgia)");
    });
  });

  // Safari follows `href` on any MathML element; the reader's link handler catches only a/area (W-45).
  it("keeps no link the reader can't catch: MathML carries none", () => {
    const html = readableBody(
      message({
        bodyHtml:
          '<p>E = <math><mi href="https://elsewhere.example/">mc</mi><mn xlink:href="https://other.example/">2</mn></math></p>',
      }),
    );
    expect(html).not.toContain("elsewhere.example");
    expect(html).not.toContain("other.example");
    expect(html).toContain("<math");
    expect(html).toContain("mc");
  });

  it("blocks remote images until allowed", () => {
    const blocked = buildDocument(message({ bodyHtml: "<p>Hi</p>" }), false, "light");
    const allowed = buildDocument(message({ bodyHtml: "<p>Hi</p>" }), true, "light");
    expect(blocked).toContain("img-src data: cid: blob:;");
    expect(allowed).toContain("https:");
  });

  it("sends allowed remote pictures through the server and allows nothing else", () => {
    const proxy = (url: string) => `/jmap/image/a1?url=${encodeURIComponent(url)}`;
    const mail = message({ bodyHtml: '<img src="https://track.example/open.gif"><img src="cid:logo">' });
    const allowed = buildDocument(mail, true, "light", new Map(), proxy);
    expect(allowed).toContain('src="/jmap/image/a1?url=https%3A%2F%2Ftrack.example%2Fopen.gif"');
    // The origin itself, not 'self': Firefox takes 'self' in a srcdoc frame for about:srcdoc. And
    // only the proxy's path on it, not the whole webmail (W-40).
    expect(allowed).toContain(`img-src data: cid: blob: ${window.location.origin}/jmap/image/a1;`);
    expect(allowed).not.toContain("'self'");
    expect(allowed).not.toMatch(/img-src[^;]* https?:[ ;]/);
    const blocked = buildDocument(mail, false, "light", new Map(), proxy);
    expect(blocked).toContain('src="https://track.example/open.gif"');
    expect(blocked).toContain("img-src data: cid: blob:;");
  });

  it("turns links in plain text into anchors", () => {
    const doc = buildDocument(message({ bodyText: "Look at https://uwumail.example/docs." }), false, "dark");
    expect(doc).toContain('<a href="https://uwumail.example/docs">https://uwumail.example/docs</a>.');
  });

  // Regression: a frame whose document says "light" inside a dark app gets an
  // opaque white canvas, which made plain text unreadable in dark mode.
  it("gives dark plain text a matching color scheme", () => {
    expect(buildDocument(message({ bodyText: "Hi" }), false, "dark")).toContain(":root{color-scheme:dark;");
  });
});

describe("remote pictures in the reader", () => {
  const proxy = (url: string) => `/jmap/image/a1?url=${encodeURIComponent(url)}`;
  const mail = message({
    bodyHtml:
      '<p>Hi</p><img src="https://cdn.example/hero.jpg" width="600" height="300"><img src="cid:logo">' +
      '<div style="background:url(https://cdn.example/bg.png)">x</div>',
  });

  // Regression: a srcdoc frame's load event waits for every picture, so one dead tracking host
  // kept the whole mail hidden until the server gave up on it.
  it("names no remote picture in the document, only placeholders of their size", () => {
    const doc = buildDocument(mail, true, "light", new Map(), proxy, true);
    expect(doc).not.toMatch(/ src="\/jmap\/image/);
    expect(doc).toContain(`data-uwu-src="${proxy("https://cdn.example/hero.jpg")}"`);
    expect(doc).toContain("width='600'%20height='300'");
    expect(doc).toContain("data-uwu-pending");
    expect(doc).toContain("@keyframes uwu-shimmer");
    // Backgrounds stay as they were, through the proxy.
    expect(doc).toContain(proxy("https://cdn.example/bg.png"));
    expect(doc).toContain(`img-src data: cid: blob: ${window.location.origin}/jmap/image/a1;`);
  });

  // W-40: once pictures may load, nothing a mail names may load from the webmail's own server.
  it("drops picture addresses on the webmail's own origin", () => {
    const own = window.location.origin;
    const local = message({
      bodyHtml:
        '<img src="/api/session"><img src="' +
        own +
        '/api/x"><img src="//host.example/a.png">' +
        '<div style="background:url(/api/y)">x</div><table background="api/z"><tr><td>t</td></tr></table>' +
        '<img src="https://cdn.example/a.png" srcset="/api/small 1x, https://cdn.example/b.png 2x">' +
        '<style>.x{background:url("/api/s")}</style><svg><image href="/api/i"></image></svg>',
    });
    for (const [withProxy, defer] of [
      [proxy, true],
      [proxy, false],
      [null, false],
    ] as const) {
      const doc = buildDocument(local, true, "light", new Map(), withProxy, defer);
      expect(doc).not.toMatch(/\/api\//);
      expect(doc).not.toContain("//host.example/a.png");
    }
    const printed = buildPrintDocument(local, true, new Map(), { from: "", to: "", cc: "", date: "" }, "", proxy);
    expect(printed).not.toMatch(/\/api\//);
  });

  // W-41: the reader's own Safe Link and date marks outlive the step that defers the pictures.
  it("keeps the Safe Link marker once pictures are allowed", () => {
    const safe = "https://eur01.safelinks.protection.outlook.com/?url=https%3A%2F%2Fshop.example%2F&data=x&reserved=0";
    const linked = message({ bodyHtml: `<a href="${safe}">shop</a><img src="https://cdn.example/a.png">` });
    const doc = buildDocument(linked, true, "light", new Map(), proxy, true);
    expect(doc).toContain("data-uwu-safelink");
  });

  it("defers nothing while remote pictures are blocked, or without being asked to", () => {
    const blocked = buildDocument(mail, false, "light", new Map(), proxy, true);
    expect(blocked).not.toContain("data-uwu-");
    expect(blocked).toContain('src="https://cdn.example/hero.jpg"');
    const direct = buildDocument(mail, true, "light", new Map(), proxy);
    expect(direct).not.toContain("data-uwu-");
    expect(direct).toContain(`src="${proxy("https://cdn.example/hero.jpg")}"`);
  });

  // security-audit W-39: the reader's own markers in a mail made the server fetch an address
  // (a read receipt) before the person allowed remote pictures.
  it("drops the reader's own markers a mail brings along", () => {
    const forged = message({
      bodyHtml:
        '<img src="data:image/gif;base64,R0lGOD" width="1" data-uwu-pending data-uwu-src="https://track.example/p" ' +
        'data-uwu-url="https://track.example/p" data-UWU-srcset="https://track.example/q 1x" data-keep="1">' +
        '<span data-uwu-date="0" class="uwu-date">Monday</span>',
    });
    for (const allow of [false, true]) {
      const html = buildDocument(forged, allow, "light", new Map(), proxy, true);
      const root = new DOMParser().parseFromString(html, "text/html").getElementById(ROOT_ID)!;
      expect(root.innerHTML).not.toMatch(/data-uwu-/i);
      expect(html).not.toContain("track.example");
      expect(root.innerHTML).toContain('data-keep="1"');
      const probe = vi.fn(async () => {});
      const stop = loadRemotePictures(root, probe, () => {});
      expect(probe).not.toHaveBeenCalled();
      stop();
    }
    expect(readableBody(forged)).not.toMatch(/data-uwu-/i);
  });

  it("prints with the real pictures", () => {
    const labels = { from: "From", to: "To", cc: "Cc", date: "Date" };
    const doc = buildPrintDocument(mail, true, new Map(), labels, "today", proxy);
    expect(doc).toContain(`src="${proxy("https://cdn.example/hero.jpg")}"`);
    expect(doc).not.toContain("data-uwu-");
  });
});

describe("found dates", () => {
  const context = { subject: "Lesung", reference: "2026-09-29T10:00:00", locale: "de-DE" };
  const marksOf = (mail: Message) =>
    eventsInMail(readableBody(mail), context).map((event, index) => ({
      from: event.from,
      to: event.to,
      index,
      label: "Termin",
    }));

  it("wraps what the finder read in the very same markup, links and pictures intact", () => {
    const mail = message({
      subject: "Lesung",
      bodyHtml:
        '<p>Am <b>Freitag</b>, 16.10. um 19:30 Uhr <a href="https://shop.example/a?d=16.10.">liest Leni</a>.</p><img src="cid:poster">',
    });
    const marks = marksOf(mail);
    expect(marks).toHaveLength(1);
    const doc = new DOMParser().parseFromString(
      buildDocument(mail, false, "light", new Map(), null, false, marks),
      "text/html",
    );
    const parts = [...doc.querySelectorAll("[data-uwu-date]")];
    expect(parts.map((part) => part.textContent).join("")).toBe("Freitag, 16.10. um 19:30 Uhr");
    expect(parts[0]!.getAttribute("role")).toBe("button");
    expect(parts[0]!.getAttribute("tabindex")).toBe("0");
    expect(doc.querySelector("a")!.getAttribute("href")).toBe("https://shop.example/a?d=16.10.");
    expect(doc.querySelector("style")!.textContent).toContain(".uwu-date");
    expect(doc.querySelector("script")).toBeNull();
  });

  it("marks plain text after its links were made", () => {
    const mail = message({
      subject: "Lesung",
      bodyHtml: null,
      bodyText: "Lesung am 16.10. um 19 Uhr, Karten: https://tickets.example/16.10.2026",
    });
    const marks = marksOf(mail);
    const doc = new DOMParser().parseFromString(
      buildDocument(mail, false, "light", new Map(), null, false, marks),
      "text/html",
    );
    expect(doc.querySelector("[data-uwu-date]")!.textContent).toBe("16.10. um 19 Uhr");
    expect(doc.querySelector("a")!.textContent).toBe("https://tickets.example/16.10.2026");
  });

  it("leaves the document as it was without marks", () => {
    const mail = message({ bodyHtml: "<p>Am 16.10. um 19 Uhr</p>" });
    expect(buildDocument(mail, false, "light", new Map(), null, false, [])).toBe(buildDocument(mail, false, "light"));
    expect(buildDocument(mail, false, "light")).not.toContain("uwu-date");
  });
});

describe("frame height", () => {
  // Regression: the frame is as tall as its content, so 100vh grew forever.
  it("turns viewport height units into fixed pixels", () => {
    expect(fixViewportHeightUnits(".hero{min-height:100vh;height:50dvh;width:100vw;margin:-2.5vmin}")).toBe(
      ".hero{min-height:900px;height:450px;width:100vw;margin:-22.5px}",
    );
    expect(buildDocument(message({ bodyHtml: '<div style="min-height:100vh">Hi</div>' }), false, "light")).toContain(
      "min-height:900px",
    );
    expect(fixViewportHeightUnits("a:-.5dvh;b:1.5svh;c:50VMAX;d:.5vh;e:10vhx")).toBe(
      "a:-4.5px;b:13.5px;c:450px;d:4.5px;e:10vhx",
    );
  });

  // Regression (security-audit WM-1): a mail of nothing but digits froze the tab for minutes,
  // because the old pattern could split a run of digits in many ways and tried all of them.
  it("stays fast on a long run of digits", () => {
    const digits = "1".repeat(200_000);
    const started = performance.now();
    expect(fixViewportHeightUnits(digits)).toBe(digits);
    expect(fixViewportHeightUnits(`${digits}vh`)).toMatch(/px$/);
    expect(fixViewportHeightUnits("1.".repeat(100_000))).toBe("1.".repeat(100_000));
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it("detects a layout that grows by the same step every frame", () => {
    const history: { time: number; delta: number }[] = [];
    let height = 1000;
    let runaway = false;
    for (let frame = 0; frame < 12 && !runaway; frame += 1) {
      runaway = isRunaway(history, height, height + 554, frame * 16);
      height += 554;
    }
    expect(runaway).toBe(true);
  });

  it("lets images that load one after another grow the mail", () => {
    const history: { time: number; delta: number }[] = [];
    const steps = [220, 180, 400, 220, 90, 300, 180, 220, 410, 160, 240, 200];
    let height = 800;
    const results = steps.map((step, index) => {
      const result = isRunaway(history, height, height + step, index * 16);
      height += step;
      return result;
    });
    expect(results.some(Boolean)).toBe(false);
  });
});

describe("resolveAppearance", () => {
  const html = message({ bodyHtml: "<p>Hi</p>" });
  const text = message({ bodyText: "Hi" });
  const native = message({
    bodyHtml: "<style>@media (prefers-color-scheme: dark) { p { color: #fff } }</style><p>Hi</p>",
  });

  it("shows everything as designed in the light app theme", () => {
    expect(resolveAppearance(html, false, "dark")).toEqual({ kind: "light", why: "app" });
  });

  it("follows the app for plain text unless light was chosen", () => {
    expect(resolveAppearance(text, true, "auto")).toEqual({ kind: "dark", why: "app" });
    expect(resolveAppearance(text, true, "light")).toEqual({ kind: "light", why: "choice" });
  });

  it("uses the mail's own dark mode before recoloring", () => {
    expect(resolveAppearance(native, true, "auto")).toEqual({ kind: "dark", why: "native" });
    expect(buildDocument(native, false, "dark")).toContain("@media (min-width: 0px)");
    expect(buildDocument(native, false, "light")).toContain("@media (max-width: -1px)");
  });

  it("measures simple HTML mail before deciding", () => {
    expect(resolveAppearance(html, true, "auto")).toEqual({ kind: "auto" });
    expect(resolveAppearance(html, true, "dark")).toEqual({ kind: "darken", why: "choice" });
  });
});

describe("embedded images", () => {
  it("show in the reader as the blob URLs of their files", () => {
    const doc = buildDocument(
      message({ bodyHtml: '<img src="cid:logo@shop" alt="Logo">' }),
      false,
      "light",
      new Map([["logo@shop", "blob:logo"]]),
    );
    expect(doc).toContain('src="blob:logo"');
  });
});

describe("buildPrintDocument", () => {
  const labels = { from: "Von", to: "An", cc: "Cc", date: "Datum" };

  it("prints the header and a sanitized body without remote content", () => {
    const doc = buildPrintDocument(
      message({
        subject: "Rechnung <2026>",
        to: [{ name: "Mini", email: "mini@uwumail.example" }],
        bodyHtml: '<p>Hallo</p><script>alert(1)</script><img src="cid:logo@shop">',
      }),
      false,
      new Map([["logo@shop", "blob:logo"]]),
      labels,
      "14. September 2026",
    );
    expect(doc).toContain("<title>Rechnung &#60;2026&#62;</title>");
    expect(doc).toContain("Mini &#60;mini@uwumail.example&#62;");
    expect(doc).toContain('src="blob:logo"');
    expect(doc).not.toContain("<script>");
    expect(doc).toContain("img-src data: blob:;");
  });

  it("does not let the mail's CSS hide or overlay the printed header (W-3)", () => {
    const doc = buildPrintDocument(
      message({
        subject: "Echt",
        to: [{ name: "Mini", email: "mini@uwumail.example" }],
        bodyHtml: "<style>table.head,h1{display:none}</style><h1>Gefälscht</h1><p>Text</p>",
      }),
      false,
      new Map(),
      labels,
      "14. September 2026",
    );
    // The style block that could reach the app's header is gone; the body sits in a contained box.
    expect(doc).not.toContain("display:none");
    expect(doc).not.toContain("<style>table.head");
    expect(doc).toContain("contain:content");
  });

  it("drops every kind of style block from the printed body, content and all", () => {
    const doc = buildPrintDocument(
      message({
        bodyHtml:
          '<STYLE media="print">h1{visibility:hidden}</STYLE><svg><style>table{opacity:0}</style></svg><p style="color:#333">Text</p>',
      }),
      false,
      new Map(),
      labels,
      "14. September 2026",
    );
    expect(doc).not.toContain("visibility:hidden");
    expect(doc).not.toContain("opacity:0");
    expect(doc).toContain('<p style="color:#333">Text</p>');
    // The page's own style block is still there.
    expect(doc.match(/<style>/g)).toHaveLength(1);
  });
});

describe("Microsoft Safe Links", () => {
  const safe = (target: string) =>
    `https://eur01.safelinks.protection.outlook.com/?url=${encodeURIComponent(target)}&amp;data=05%7C02&amp;reserved=0`;

  it("shows and links the real target in HTML mail, with the reader's marker", () => {
    const html = readableBody(
      message({
        bodyHtml: `<a href="${safe("https://shop.example/deal")}">Zum Angebot</a> <a href="${safe("https://docs.example.org/")}">${safe("https://docs.example.org/")}</a>`,
      }),
    );
    expect(html).toContain('href="https://shop.example/deal"');
    expect(html).toContain(">Zum Angebot<");
    expect(html).toContain('href="https://docs.example.org/"');
    expect(html).toContain(">https://docs.example.org/<");
    expect(html).toContain('data-uwu-safelink="eur01.safelinks.protection.outlook.com"');
    expect(html).not.toContain("safelinks.protection.outlook.com/?");
  });

  it("never unwraps into a script link", () => {
    const html = readableBody(message({ bodyHtml: `<a href="${safe("javascript:alert(1)")}">x</a>` }));
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data-uwu-safelink");
  });

  it("links the real target in plain text", () => {
    const text = `Look: ${safe("https://shop.example/a?b=1&c=2").replace(/&amp;/g, "&")} and https://plain.example/x`;
    const html = readableBody(message({ bodyText: text }));
    expect(html).toContain(
      '<a href="https://shop.example/a?b=1&amp;c=2" data-uwu-safelink="eur01.safelinks.protection.outlook.com">https://shop.example/a?b=1&amp;c=2</a>',
    );
    expect(html).toContain('<a href="https://plain.example/x">https://plain.example/x</a>');
  });
});
