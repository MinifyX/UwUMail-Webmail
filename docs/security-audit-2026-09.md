# Security audit — UwUMail-Webmail, September 2026

The first dedicated security pass over the webmail as its own repository. The webmail was first read
in the server's 0.5.0 review
([UwUMail-Server/docs/security-audit-0.5.0.md](https://github.com/MinifyX/UwUMail-Server/blob/main/docs/security-audit-0.5.0.md),
finding F-1 and F-3, F-5, F-8), which fixed the ways a mail could reach the composer's own origin,
the unsubscribe-by-mail confirmation and an image-map click. This pass re-checks those fixes and
reads the rest of the client for the 0.5.2 window. It is the companion to the server's
[security-audit-0.5.2.md](https://github.com/MinifyX/UwUMail-Server/blob/main/docs/security-audit-0.5.2.md);
the webmail ships built into the server image, pinned by commit in `webmail.pin`.

The threat model is the one that matters for a mail client: **the attacker is whoever sends the
reader a mail.** The body, the headers, the sender's name and the attachments are all theirs. A
second attacker is **a link the reader is enticed to open** that points at their own webmail. The
server behind it is trusted (it is UwUMail); a compromised server is out of scope here and covered
in the server audit.

Done with Claude, not an independent firm. An honest sweep, not a certificate. It leaves out
step-by-step exploits; reproduction notes live in the private `security-test-notes.local.md`
(gitignored).

## How this was verified

Each finding was re-read by an independent reviewer whose job was to **refute** it — reading the
cited files, the supporting call sites (the `?mailto=` intake, the print invocation) and, for W-6,
the Rust engine's own extension logic for comparison — applying three lenses: reading-correctness,
exploitability, and existing-mitigation. **Outcome: all 11 findings were confirmed; none was
refuted.** Corrections the pass produced, already applied below:

- **W-8 / W-9 line numbers corrected.** `src/lib/links.ts` is currently 56 lines; the logic sits at
  lines 21-22, 33-38 and 51-54 (the earlier `:67`/`:54` references were stale). The described code
  and behaviour are present and correct.
- **W-2 stays "mechanism ~75%"** — it genuinely depends on the reader copy-pasting attacker HTML
  into the composer; reply/forward _quoting_ is already sanitised via `quotableHtml`
  (`draft.ts:30`), so the gap is paste-specific, exactly as scoped.
- **W-4** is a privacy/tracking bypass only, and is partly inherent to any sender-trust list keyed
  on the unauthenticated `From`; ignoring the server's Junk verdict remains the legitimate weakness.

None of these was proven with a live malicious mail — the rules for this test allowed only
non-invasive local checks.

## Summary

| Severity      | Found | Fixed | Open |
| ------------- | ----- | ----- | ---- |
| Critical      | 0     | 0     | 0    |
| High          | 0     | 0     | 0    |
| Medium        | 1     | 1     | 0    |
| Low           | 8     | 8     | 0    |
| Informational | 2     | 2     | 0    |

11 findings, all fixed in the 0.5.2 window. Regression tests cover the print overlay (W-3), the
dangerous-file gaps (W-6, W-7) and the misleading-link bypasses (W-8, W-9); the composer, reader,
unsubscribe and preview changes are covered by the type check and the existing suite. There is no High or Critical:
the composer's origin is protected (F-1 holds), the reader frame has no scripts and its own policy,
and the app uses no `dangerouslySetInnerHTML`. The findings are a hidden-recipient path (Medium)
and a set of defence-in-depth gaps in the reader's warnings, the print/paste paths, and the
dangerous-file and misleading-link heuristics. IDs use `W-…` for this client (the desktop client's
audit uses `C-…` in its own repo; `W-` keeps the two apart).

## Findings

### W-1 · Medium · A `mailto:` link can pre-fill a hidden Bcc recipient

`src/features/compose/Composer.tsx:74`

- **CVSS 3.1:** `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:N/A:N` (Medium)
- **Attacker & preconditions:** anyone who gets the reader to open
  `https://<webmail-host>/mail/?mailto=mailto%3Aboss%40corp.example%3Fbcc%3Dattacker%40evil.example…`
  — typically a link inside a mail read in the webmail. The link's host is the reader's own webmail,
  so `LinkWarning` never fires; the navigation is from the webmail origin, so the `SameSite=Strict`
  session cookie is sent (and if signed out, `App.tsx` carries the query through the login as
  `?next=`). The reader writes a mail and presses Send.
- **Impact:** the composer renders the Cc/Bcc rows only when Cc is non-empty
  (`useState(initial.cc.length > 0)`), so a Bcc that arrived from the link is present but invisible —
  the minimized phone bar lists only To and Cc names too. A copy of whatever the reader writes (and
  any attachment they add) goes to the attacker's address while the composer shows only To and
  Subject. The server strips the `Bcc` header but still delivers to the envelope recipients the
  client built.
- **Evidence:** code read of `Composer.tsx:74`, `:527-531`, `:371` and `src/lib/mailto.ts:31`
  (`bcc: addresses(params.get("bcc"))`).
- **Fix:** render the Cc/Bcc rows when _either_ list is non-empty
  (`useState(initial.cc.length > 0 || initial.bcc.length > 0)`) and show Bcc names in the phone bar;
  consider ignoring `bcc` in `parseMailto` altogether — no legitimate `mailto` link needs a blind
  copy.
- **Regression test:** RTL — `openCompose({mode:'new', to:[…], bcc:[{email:'x@evil.example'}]})`,
  render `<Composer/>`, assert a Bcc `RecipientInput` with the chip `x` is in the document.

## Low findings

Each is a defence-in-depth gap — the reader still has the server's checks behind it, and none allows
code to run on the app origin.

- **W-2 · Pasting from the reader into the composer bypasses `quotableHtml`** _(mechanism ~75%)_ —
  `src/features/compose/Composer.tsx:551`. The contentEditable has only `onInput`; `quotableHtml`
  runs at save and send, not on paste, and the reader keeps remote `<img src="https://…">` in its
  frame DOM. Pasting a copied region into a new mail loads the remote image (tracking pixel) from
  the app page, though the reader had blocked remote content. No script; the sent copy is cleaned
  again. _Fix:_ add an `onPaste` handler that runs `text/html` through `quotableHtml` (fallback to
  escaped `text/plain`); also pass `body.current` through `quotableHtml` before re-inserting on
  re-mount.
- **W-3 · The print document lets the mail's CSS hide or overlay the app-rendered header** —
  `src/features/mail/MessageBody.tsx:144`. `buildPrintDocument` puts the sanitized body and the
  app's trusted header (subject, From/To/date) in **one** document. DOMPurify keeps `<style>`,
  `style=""` and `class`, so a mail can `display:none` the real header rows and draw its own, or lay
  an absolute overlay over them. The printed/PDF "record" then shows a forged sender/recipient/date.
  Paper/PDF integrity only; the live UI is unaffected. _Fix:_ render the body in a nested
  `<iframe sandbox srcdoc="…">` inside the print document, or print the header on its own page.
- **W-4 · The trusted-sender image gate keys only on the From address, even for quarantined mail** —
  `src/features/mail/MessageView.tsx:183`. `allowRemote = loadRemote || remoteSetting === "always"
|| trustedBy.length > 0`, where `trustedBy` matches the (attacker-controlled) From against the
  stored list. A spoofed mail from a trusted address/domain auto-loads its remote images even when
  the server filed it in Junk — the attacker learns it was opened and can show a spoofed-sender
  banner. This is the one place a server-side SPF/DKIM/DMARC verdict would change client behaviour,
  and the client never sees it. _Fix:_ do not apply the trusted-sender (or "always") bypass for mail
  in the Junk folder; better, have the server expose its verdict on the Email object and gate on it.
- **W-5 · The Unsubscribe dialog omits the mailto target on One-Click, but still sends it**
  _(regression of server F-3 / commit 2e98b2c)_ — `src/features/mail/Unsubscribe.tsx:44`. For
  `List-Unsubscribe: <https://…>, <mailto:chosen@attacker.example?subject=…>` with
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click` — the layout Gmail/Yahoo require of bulk
  senders — the dialog computes `byMail` only when `!oneClick`, so it does not name the mailto
  address, while `JmapBackend.unsubscribe` still sends the mail to an attacker-chosen address with
  an attacker-chosen one-line subject. F-3's stated guarantee is that the dialog names the target
  before anything is sent. _Fix:_ derive one plan from the headers in one place
  (`unsubscribePlan(unsubscribe)`) and use it in both the dialog and the backend; compute `byMail`
  from `message.unsubscribe.mailto` regardless of `oneClick`.
- **W-6 · Attachment names whose only dot is the first character skip the dangerous-file warning** —
  `src/lib/attachments.ts:81`. `extensionOf` uses `dot > 0`, so `.exe` yields `""`; combined with
  the BIDI/trailing-dot cleanup, a name such as `‮.exe` or `‎.html` is cleaned to `.exe`
  (extension `""`) while the browser saves it as `-.exe`/`-.html` — an executable or a local
  fake-login page reaches disk with no Nyu question and no "can run programs" tag. The engine
  (`uwumail-core`) flags the same names. _Fix:_ match the engine — `dot < 0 ? "" :
filename.slice(dot + 1)…` — and strip format controls in a `cleanDisplayName()`.
- **W-7 · The dangerous-extension list omits `svg`, `rdp`, `wsb`, `pub`, `desktop`** —
  `src/lib/attachments.ts:67`. The list warns for `html`/`htm`/… as fake-login-page vectors, but a
  saved `.svg` is the same thing (it renders with `<script>`/`<foreignObject>` from disk), and
  `.rdp` (rogue RDP), `.wsb` (Windows Sandbox that runs a command), `.pub` and `.desktop` are saved
  silently. The preview itself is safe (`<img>`); only the saved file matters. _Fix:_ add these to
  `DANGEROUS` here and in the engine, keeping `svg` classified as an image for the thumbnail.
- **W-8 · The misleading-link warning is bypassed by invisible format characters in the link text** —
  `src/lib/links.ts:33-38` (`claimedHost`, `DOMAIN`). `<a href="https://evil.example/">paypal&#8203;.com</a>` renders as
  `paypal.com` but `claimedHost()` returns null (the zero-width space is neither trimmed nor `\s`),
  so no "this link goes somewhere else" dialog. Same for U+200C/200D/2060/00AD. Defence-in-depth, so
  the impact is losing the warning. _Fix:_ strip Unicode format characters
  (`text.replace(/[\p{Cf}­]/gu, "")`) before the whitespace rule.
- **W-9 · `misleadingLink` ignores `mailto` header fields and fails open on an unparseable target** —
  `src/lib/links.ts:21-22, 51-54`. For a `mailto:` link the check compares only the address before `?`, so
  `mailto:service@bank.example?bcc=x@phish.example` (or a comma-separated second recipient) passes
  though the reply will also go to the attacker; an unparseable target yields null, which suppresses
  the warning entirely. _Fix:_ collect every recipient host — the comma-separated path plus the `to`,
  `cc`, `bcc` fields — and warn on the first that is not same-site with the claimed one; treat an
  unparseable target as misleading.

## Informational

- **W-10 · Reopening a server draft silently drops its Bcc recipients (and reply threading)** —
  `src/backend/jmap/JmapBackend.ts:809`. `MESSAGE_PROPERTIES` has no `bcc`, and `openDraft` returns
  `bcc: []` and `inReplyTo: null` unconditionally, so a draft saved with Bcc comes back without it
  and is sent without those people while the author believes they were on it; the reopened draft
  also loses `inReplyTo` so it no longer threads. A functional loss, not a leak (the opposite of
  W-1), reported because it concerns Bcc handling. _Fix:_ request `bcc` in `openDraft`'s `Email/get`
  and map it; resolve `inReplyTo` to the parent's JMAP id.
- **W-11 · The PDF preview frame has no `sandbox` (unreachable on JMAP today)** —
  `src/features/attachments/previews.tsx:243`. A link inside a PDF can, in Chrome's embedded viewer,
  navigate the whole webmail tab (a top-level navigation no CSP `frame-src` or `LinkWarning` sees) —
  phishing that looks like a redirect from the mail app; no session data leaks. It cannot be reached
  today: on JMAP the blob is fetched as `application/octet-stream` and the gate requires
  `application/pdf`, and the page CSP `connect-src 'self'` refuses `fetch(blob:)`. Reported so it is
  not turned into a live path when the (functional) preview is fixed. _Fix:_ when making the preview
  work, request `accept=application/pdf` only for the PDF path and render with pdf.js onto a canvas,
  routing link annotations through `requestOpenLink`; keep other blobs as octet-stream.

## Regression check of the earlier (0.5.0) webmail findings

| Finding                                                                              | What it protected                                        | Status                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F-1 · a draft/plain-text mail put foreign markup into the composer's own page        | No mail HTML runs on the app origin                      | **holds** — only a real draft opens, plain text is escaped, and a restored body goes through `quotableHtml`. The composer's origin is protected. (W-2 is a _different_ path — paste — and W-3 is the print document, not the live composer.) |
| F-3 · unsubscribing by mail sent whatever the header asked for, without saying where | The reader sees the target before a mail is sent         | **circumventable in the One-Click case (W-5)** — the dialog names the target for the non-One-Click path, but not when the header claims One-Click, though the backend still sends the mail.                                                  |
| F-5 · the way in checked less than the way that shows it                             | Webmail access matches server access                     | **holds** (server-side; unchanged here).                                                                                                                                                                                                     |
| F-8 · a click on an image map went around the link check                             | Every click goes through `requestOpenLink`/`LinkWarning` | **holds** — image-map clicks are caught like any other link (commit f4fe86c); W-8/W-9 are weaknesses _inside_ `LinkWarning`'s heuristic, not a way around it.                                                                                |
| No `dangerouslySetInnerHTML` anywhere; reader frame scriptless with its own policy   | XSS in the client                                        | **holds** — confirmed by re-reading; the reader frame carries `default-src 'none'` and no `allow-scripts`.                                                                                                                                   |

## New or changed accepted risks

- **CSS is not filtered in the reader.** Carried by the scriptless frame with its own policy —
  unchanged from the server's accepted risks. W-3 (print) is the one place this leaves the frame;
  the fix keeps it inside a sandboxed iframe.
- **The dangerous-file and misleading-link checks are heuristics, not guarantees** — they are a
  second look before the OS/browser's own handling, and W-6…W-9 are gaps in them, not the only line
  of defence. Worth closing, but the reader is not defenceless without them.

## Prioritised fix order

1. **W-1** (Medium) — show Bcc whenever it is set. The one finding that sends the reader's words to a
   hidden recipient.
2. **W-5** — align the Unsubscribe dialog with what the backend sends (closes the F-3 regression).
3. **W-6, W-7** — the dangerous-extension gaps; small, and they match the engine's list.
4. **W-4** — do not auto-load remote images for quarantined mail (best done once the server exposes
   its verdict).
5. **W-2, W-3, W-8, W-9** — the paste/print/link-heuristic hardening.
6. **W-10, W-11** — the informational functional/latent items, fixed when the draft-reopen and PDF
   preview are next touched.

## What was not tested, and why

- **No live malicious mail.** Per the test rules (no invasive tests), nothing was proven by
  delivering a crafted message; the findings are from reading the code paths.
- **Real browser clipboard and print behaviour** (W-2, W-3) was reasoned about, not executed —
  hence the ~75% mechanism note on W-2.
- **The webmail in a browser with a real login** — signing in means typing a password into a form,
  which this review does not do; the code and its mock (`src/dev/mockApi.ts`, loaded only when
  `MODE === "mock"`) were read, and the JMAP boundaries were exercised over the API against a real
  test instance in the server sweep.
- **Chrome's embedded PDF viewer navigation** (W-11) — the latent behaviour was not triggered
  because the gate that would reach it does not pass on JMAP today.

## What was actually run

- `eslint` (clean) on the current tree; `tsc`/`prettier` as part of the normal build.
- `gitleaks` over the full history: the only hits are the dev-mock `recoveryKey` fixtures in
  `src/dev/mockApi.ts`, which load only under `MODE === "mock"` and are not real secrets — **nothing
  to rotate**.
- The webmail was exercised against a real UwUMail test instance in the server's sweep (portal
  session → JMAP, sending and reading a message, and the boundary checks: a JMAP call without/with a
  wrong CSRF token, another account's mailboxes, another account's blob, and one's own download).
