import "@/test/dom";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Message } from "@/backend/types";
import { detectWebKit } from "@/lib/device";
import {
  buildDocument,
  buildPrintDocument,
  frameStrayed,
  MAIL_FRAME_SANDBOX,
  mailFrameSandbox,
  MessageBody,
} from "./MessageBody";

// WebKit (Safari on macOS and iOS) never calls the webmail's listeners in a frame without allow-scripts, so
// links in mails opened inside the frame past the link question. These pin that only WebKit gets
// allow-scripts, and what keeps the mail from running code once the frame allows scripts.

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

/** Bodies that try to get something into the head before the policy, or past it. */
const HOSTILE = [
  "<p>Hi</p>",
  '</style></head><head><meta http-equiv="Content-Security-Policy" content="script-src *"><script>steal()</script>',
  '<meta http-equiv="Content-Security-Policy" content="script-src \'unsafe-inline\'"><img src=x onerror=steal()>',
  "<!--</head>--><base href=https://elsewhere.example/><svg><script>steal()</script></svg>",
  '<noscript><p title="</noscript><img src=x onerror=steal()>"></noscript>',
  '<a href="javascript:steal()">x</a><iframe srcdoc="<script>steal()</script>"></iframe>',
];

const POLICY_FIRST =
  /^<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'none';/;

/** User agents and whether they are WebKit. */
const AGENTS: [string, number, boolean][] = [
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
    0,
    true,
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/129.0 Mobile/15E148 Safari/604.1",
    5,
    true,
  ],
  [
    "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15",
    5,
    true,
  ],
  // iPadOS asking for the desktop site, even with a Chrome token.
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Chrome/129.0", 5, true],
  // WKWebView in an app.
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)", 0, true],
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    0,
    false,
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    0,
    false,
  ],
  ["Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:131.0) Gecko/20100101 Firefox/131.0", 0, false],
  [
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    5,
    false,
  ],
];

/** No element that runs or loads code, and no attribute that would. */
function expectNothingRuns(html: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  expect(doc.querySelectorAll("script, iframe, base, object, embed, noscript")).toHaveLength(0);
  for (const element of doc.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      expect(name).not.toMatch(/^on/i);
      expect(element.getAttribute(name)).not.toMatch(/^\s*javascript:/i);
    }
  }
}

function headOf(html: string) {
  return new DOMParser().parseFromString(html, "text/html").head;
}

describe("the mail frame", () => {
  afterEach(cleanup);

  it("allows scripts for the app's listeners in WebKit only, and nothing else beyond its own origin", () => {
    for (const [agent, touchPoints, webKit] of AGENTS) {
      expect(detectWebKit(agent, touchPoints), agent).toBe(webKit);
    }
    expect(mailFrameSandbox(true).split(" ").sort()).toEqual(["allow-same-origin", "allow-scripts"]);
    expect(mailFrameSandbox(false)).toBe("allow-same-origin");
    const { container } = render(
      <MessageBody
        message={message({ bodyHtml: "<p>Hi</p>" })}
        allowRemote={false}
        appearance={{ kind: "light", why: "app" }}
      />,
    );
    expect(container.querySelector("iframe")?.getAttribute("sandbox")).toBe(MAIL_FRAME_SANDBOX);
  });

  for (const variant of ["light", "dark"] as const) {
    it(`starts every ${variant} document with a policy that runs no script`, () => {
      for (const body of HOSTILE) {
        for (const kind of ["html", "text"] as const) {
          const doc = buildDocument(message(kind === "html" ? { bodyHtml: body } : { bodyText: body }), true, variant);
          expect(doc).toMatch(POLICY_FIRST);
          const head = headOf(doc);
          const first = head.firstElementChild!;
          expect(first.getAttribute("http-equiv")).toBe("Content-Security-Policy");
          expect(first.getAttribute("content")).toMatch(/^default-src 'none'; script-src 'none';/);
          expect(first.getAttribute("content")?.match(/script-src/g)).toHaveLength(1);
          // Only the reader's own policy, charset and style: nothing from the mail reached the head.
          expect([...head.children].map((element) => element.tagName)).toEqual(["META", "META", "STYLE"]);
          expectNothingRuns(doc);
        }
      }
    });
  }

  it("starts the print document with the same kind of policy", () => {
    for (const body of HOSTILE) {
      const doc = buildPrintDocument(
        message({ bodyHtml: body, subject: "</title><script>steal()</script>" }),
        true,
        new Map(),
        { from: "Von", to: "An", cc: "Cc", date: "Datum" },
        "14. September 2026",
      );
      expect(doc).toMatch(POLICY_FIRST);
      expect(headOf(doc).firstElementChild?.getAttribute("http-equiv")).toBe("Content-Security-Policy");
      expectNothingRuns(doc);
    }
  });

  it("knows when the frame shows something else than its mail", () => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    // jsdom's fresh frame is about:blank, where every frame starts out.
    expect(frameStrayed(frame)).toBe(false);
    Object.defineProperty(frame, "contentDocument", { value: null });
    expect(frameStrayed(frame)).toBe(true);
    frame.remove();
  });
});
