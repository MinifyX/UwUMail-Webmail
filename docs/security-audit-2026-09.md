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

## Addendum — 22 September 2026: undo send, signatures, settings sync and the link question

A second pass over everything that landed after this report (commits 663e173 to 084230d): holding
sent mail back for "undo send" (`src/lib/sendQueue.ts`), signatures from the server's shared
settings, the settings sync (`src/lib/settingsSync.ts`, `settingsSyncQueue.ts`,
`src/state/accountSync.ts`, `src/backend/jmap/userSettings.ts`), arrow keys forwarded from the mail
frame (`readerKeys.ts`), the link question with its hover status line, long-press sheet, redirect
and lookalike detection (`src/lib/links.ts`, `redirects.ts`, `domains.ts`, `LinkWarning.tsx`,
`LinkPreview.tsx`, `linkEvents.ts`), the full address details, the spam actions and Ctrl+A. The
fixes of W-1 to W-11 were re-checked. The server's side of the settings sync was reviewed in the
same pass; its findings are in
[UwUMail-Server/docs/security-audit-0.5.2.md](https://github.com/MinifyX/UwUMail-Server/blob/main/docs/security-audit-0.5.2.md#addendum--the-settings-sync-extension-22-september-2026)
(S-39 to S-41).

The threat model gains two attackers. **The next person at the same browser**: the webmail keeps
settings, a draft and the sync queue in local storage, which outlives a sign-out. And **the settings
that come from the server**: another device of the account (or a client with a bug) writes them, so
they are data to check, never code or markup to trust. Done with Claude, like the report above;
reproduction notes stay in the private notes file.

### Summary

| ID   | Severity      | Finding                                                                         | Status           |
| ---- | ------------- | ------------------------------------------------------------------------------- | ---------------- |
| W-12 | Medium        | What one login leaves in the browser reaches the next                           | fixed in 6b33af1 |
| W-13 | Low           | A remembered domain waves through its own redirects                             | fixed in abbba75 |
| W-14 | Low           | With "ask before links" off, lookalike hosts and hidden user names open at once | fixed in fab05db |
| W-15 | Low           | Remembering a site under an unlisted public suffix remembers the whole suffix   | fixed in a850515 |
| W-16 | Low           | The status line can cut the real domain off a long address                      | fixed in 1a8a4ae |
| W-17 | Low           | Middle click, dragging a link and SVG links go past the link question           | fixed in bc50608 |
| W-18 | Low           | The gesture that opens the link question can also answer it                     | fixed in e8aca80 |
| W-19 | Low           | The settings sync treats inherited names like `constructor` as known settings   | fixed in a478216 |
| W-20 | Low           | Markup dragged into the composer skips the paste cleaner                        | fixed in 215c95c |
| W-21 | Informational | A sender's direction marks run into the names next to theirs                    | fixed in 3480fd4 |

Nothing Critical or High. No path to running code on the app's origin was found: the app uses
`dangerouslySetInnerHTML` only for signatures that went through `cleanSignatureHtml`, the reader
frame is scriptless with its own policy, and the page policy the server sends
(`frame-ancestors 'none'`, `form-action 'none'`, `frame-src 'self' blob:`) is unchanged.

### W-12 · Medium · What one login leaves in the browser reaches the next

`src/state/settings.ts` (persisted as `uwumail.webmail`), `src/features/compose/localDraft.ts`
(`uwumail.phoneDraft`), `src/state/accountSync.ts` (`uwumail.webmail.settingsSync`)

- **Attacker & preconditions:** a second person who signs in to the webmail in the same browser
  profile after someone else — a shared family computer, a kiosk, a colleague's laptop. Signing out
  of the portal ends the session but leaves the webmail's local storage alone.
- **Impact:** the next login got the previous one's trusted senders, remembered link domains (links
  to those sites then open without a question), per-sender looks, their choices for remote images
  and link questions, and — the worst of it — the draft kept for the phone, with recipients, Bcc,
  subject and text, which the composer offers to bring back. With the settings sync, the previous
  person's choices could even be written into the new account's server settings, because the sync
  sends choices the server doesn't have yet.
- **Fix:** the webmail notes whose data it keeps (`src/state/browserOwner.ts`). When the server
  names a different login than last time, the settings go back to the defaults (the new account's
  own come back from the server), and the kept draft and the sync queue are dropped, before anything
  reads them. Test: `browserOwner.test.ts`.
- **Left open:** the data stays in the browser until the next login opens the webmail; someone with
  the browser in hand can read it from local storage. The portal's sign-out does not clear it (the
  keys belong to the webmail; clearing them on sign-out would be worth doing there too).

### Low findings

- **W-13 · A remembered domain waves through its own redirects** — `src/lib/links.ts`
  (`checkLink`, `needsConfirmation`). A link on a remembered domain opened without a question even
  when its address carried a redirect to another site (the usual open redirect), and such a link
  offered its own domain for remembering. _Fix:_ a link with a detected redirect is never
  rememberable, so it always asks while asking is on.
- **W-14 · With "ask before links" off, lookalike hosts and hidden user names open at once** —
  `src/lib/links.ts` (`needsConfirmation`). The setting promises that disguised links always ask,
  but only the text-versus-target check did; a host that only looks Latin and a user name in front
  of the host did not. _Fix:_ both always ask, like a misleading text.
- **W-15 · Remembering a site under an unlisted public suffix remembers the whole suffix** —
  `src/lib/domains.ts` (`registrableDomain`). The registrable domain is a heuristic with a short list
  of multi-label suffixes. Under a suffix not on it (`co.ke`, `com.ng`, `gov.br`, a hosting platform
  such as `a.run.app`), remembering one site remembered every site under that suffix. _Fix:_ the
  usual second levels under two-letter country domains count as suffixes, and more hosting platforms
  are listed. Still a heuristic, not the Public Suffix List (see accepted risks).
- **W-16 · The status line can cut the real domain off a long address** —
  `src/features/mail/LinkWarning.tsx` (`LinkAddress`, compact). The hover status line truncated the
  whole address at its end, so a long chain of made-up subdomains in front of the real domain showed
  only the made-up part. It matters most where the status line is the only preview (asking switched
  off, or a remembered domain). _Fix:_ the path gives way first, then the subdomains; the registrable
  domain never shrinks. Test `LinkAddress.test.tsx`, and checked in a browser against the demo.
- **W-17 · Middle click, dragging a link and SVG links go past the link question** —
  `src/features/mail/linkEvents.ts`. Only `click` on `a[href]`/`area[href]` was caught; a middle
  click (`auxclick`), a link dragged onto the tab bar and an SVG `<a xlink:href>` were not. Today the
  frame's sandbox (no popups), the page's `frame-src` and both sanitizers (neither keeps SVG links
  from the server) stand in the way, so this is defence in depth. _Fix:_ a middle click asks like a
  click, links can't be dragged out of the mail, and `xlink:href` counts as a link. Test
  `linkEvents.test.ts`.
- **W-18 · The gesture that opens the link question can also answer it** —
  `src/features/mail/LinkWarning.tsx`. The question opens centred with "Open" focused, so a held
  Enter (key repeat) or the second click of a double click placed over that spot could answer it in
  the same gesture. _Fix:_ the open buttons ignore clicks for 600 ms after the question appears and
  never react to a repeating key. Test `armedActivation.test.ts`, and checked in a browser against
  the demo.
- **W-19 · The settings sync treats inherited names like `constructor` as known settings** —
  `src/lib/settingsSync.ts` (`isSyncable`, `isChoiceKey`). The check for a known choice used `in`,
  which also finds every object's inherited members: a `constructor` key from the server passed as a
  valid setting and was written into the settings, and a `__proto__` key (JSON parsing makes it an
  ordinary key) threw and stopped the sync for good. The server's whitelist refuses both today
  (S-40), so this is defence in depth. _Fix:_ only the choices' own keys count. The desktop app
  shares this file and needs the same change.
- **W-20 · Markup dragged into the composer skips the paste cleaner** —
  `src/features/compose/Composer.tsx`, `src/features/settings/Signatures.tsx`. W-2 cleaned pasted
  markup; dropping a selection dragged out of a mail inserted its markup as it was, so a remote
  picture in it loaded from the app page (a tracking pixel). _Fix:_ dropped markup goes through the
  same cleaner (`droppedHtml.ts`); moving text within the editor is left to the browser.
  Unit-tested; a real drag from the mail frame into the editor was not performed.

### Informational

- **W-21 · A sender's direction marks run into the names next to theirs** —
  `src/components/ui/Tooltip.tsx`. The "to" line puts every recipient's display name inline; a name
  with an unclosed right-to-left override turned the names after it around. The full address
  details already show such characters visibly (`fullAddress`). _Fix:_ every name there is isolated
  (`unicode-bidi: isolate`).

### What held up

- **Undo send** holds the mail as a draft and submits exactly that draft with the envelope built
  from the composer. A session change in between makes the submission fail rather than go out under
  another login (the CSRF token and account id belong to the page's own session); a closed tab
  leaves an unsent draft, and the page asks before it closes.
- **Signatures** from the server are cleaned before they are shown or inserted
  (`cleanSignatureHtml`: the composer's cleaner, then only embedded PNG/JPEG/GIF/WebP pictures);
  names are text; picture uploads refuse SVG.
- **The settings sync** only takes keys and values that pass the same rules as the server, key by
  key; a refused key stays on the device instead of failing every later write; signatures are never
  kept locally.
- **The link question** is reached by every click, Enter on a focused link, the long-press sheet and
  the unsubscribe page. `javascript:`, `data:` and relative links never open; forms, `<meta>`,
  `<base>` and scripts are removed by both sanitizers and could not act in the sandboxed frame
  anyway; the status line and the dialog are drawn by the app outside the frame, so a mail can't
  paint over them. Remembered domains never cover lookalike, international, user-name, IP or
  plain-http links; case and a trailing dot are normalized before the comparison.
- **Keys from the mail frame** are forwarded as copies to the app's shortcuts; the frame has no
  scripts, so only the reader's own key presses get there, and Ctrl/Cmd combinations stay in the
  frame.
- **Address details** show every sender-chosen name and address through `visibleText`, so
  invisible and direction characters are shown, not obeyed.
- **Spam actions and Ctrl+A** only act on what the reader selected; deleting for good still asks
  and only removes mail that really lies in the trash.
- **Earlier findings:** W-1 to W-11 hold (Bcc shown, paste and restore cleaned, print header
  protected, no trusted-sender images in Junk, unsubscribe target named and now routed through the
  link question, dangerous-file and link heuristics, draft Bcc, PDF preview sandboxed).
- **Dependencies and CI:** `pnpm audit --prod` finds nothing; the workflows pin every action by
  commit, run with `contents: read` and have no `pull_request_target`.

### New or changed accepted risks

- **The registrable domain stays a heuristic.** W-15 closes the common gaps, but a site under a
  suffix nobody listed can still stand for its neighbours once remembered. The full Public Suffix
  List would fix it for good at the cost of a large download.
- **Local storage is readable by whoever holds the browser.** W-12 stops handing it to the next
  login; it does not encrypt or expire it.

### What was run

- `pnpm format:check`, `typecheck`, `lint`, `test` and `build` on the final tree, all green;
  `pnpm audit --prod` clean.
- The demo mode in a browser for W-16 (a long made-up chain of subdomains keeps the real domain
  visible in the status line), W-18 (an immediate click on "Open" does nothing, a later one opens)
  and W-21 (names in the header are isolated).
- No live malicious mail and no real login, as before.
