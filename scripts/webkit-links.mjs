// Clicks a link in a mail of the browser demo in real WebKit and Chromium and checks that the
// webmail's link question opens while the mail's frame stays on the mail. WebKit (Safari on macOS and iOS)
// never calls the webmail's listeners in a frame without `allow-scripts`, which jsdom can't show.
//
// From the repo root (builds the demo first):
//   scripts/webkit-links.sh
// Runs in the Playwright image; no Playwright in the repo's dependencies.

import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { chromium, webkit } from "playwright";

const root = process.argv[2] ?? "dist";
const types = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
  ".png": "image/png",
};
const server = createServer((request, response) => {
  // The webmail lives under /mail/ (vite.config.ts `base`).
  const pathname = new URL(request.url, "http://localhost").pathname.replace(/^\/mail(?=\/)/, "");
  const path = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  let file = join(root, path);
  if (!existsSync(file) || statSync(file).isDirectory()) file = join(root, "index.html");
  response.setHeader("content-type", types[extname(file)] ?? "application/octet-stream");
  createReadStream(file).pipe(response);
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const base = `http://127.0.0.1:${server.address().port}/mail/`;

const SUBJECT = "Link-Check: Wohin führen diese Links?";
/** Links of the demo's link lab mail and what the link question must name for each. */
const CASES = [
  { link: "Zum Shop", expect: /pixelparts\.example/ },
  // A Microsoft Safe Link asks about the address it wraps and says it was taken off.
  { link: "Lenis Clip", expect: /wanders\.example[\s\S]*Safe-Link|Safe-Link[\s\S]*wanders\.example/ },
];
let failed = false;

for (const browserType of [webkit, chromium]) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ locale: "de-DE", viewport: { width: 1400, height: 900 } });
  // Nothing leaves the machine: the demo's remote pictures and the link target are not fetched.
  await page.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) => route.abort());
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    await page.goto(base);
    await page.getByRole("button", { name: SUBJECT }).first().click({ timeout: 15000 });
    const frameElement = page.locator(`iframe[title="${SUBJECT}"]`);
    for (const { link, expect } of CASES) {
      await frameElement.contentFrame().getByText(link).click({ timeout: 15000 });
      const dialog = page.locator("dialog[open]").filter({ hasText: expect });
      await dialog.waitFor({ timeout: 5000 }).catch(() => {
        throw new Error(`no link question for "${link}"`);
      });
      const frameUrl = await frameElement.evaluate((element) => element.contentDocument?.URL ?? "(other origin)");
      if (frameUrl !== "about:srcdoc") throw new Error(`the mail frame left its mail for ${frameUrl}`);
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "hidden", timeout: 5000 });
    }
    // Whatever else would navigate the frame (here: the frame's own Navigation API) is stopped.
    const navigation = await frameElement.evaluate((element) =>
      element.contentWindow.navigation.navigate("https://elsewhere.example/").committed.then(
        () => "committed",
        (error) => error.name,
      ),
    );
    if (navigation !== "AbortError") throw new Error(`a navigation of the frame was ${navigation}`);
    await frameElement.contentFrame().getByText(CASES[0].link).waitFor({ timeout: 5000 });
    console.log(`${browserType.name()}: ok, the link question opened and the frame stayed on the mail`);
  } catch (error) {
    failed = true;
    await page.screenshot({ path: `webkit-links-${browserType.name()}.png` }).catch(() => {});
    console.log(`${browserType.name()}: FAILED: ${error.message.split("\n")[0]}`, errors);
  }
  await browser.close();
}
server.close();
process.exit(failed ? 1 : 0);
