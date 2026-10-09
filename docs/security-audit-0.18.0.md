# Security audit — UwUMail-Webmail 0.18.0

A sixth pass, over the branch `release/0.18.0` before it is released (`git diff origin/main...HEAD`,
the merged branches `feat/0.18-dates`, `feat/0.18-llm` and `feat/0.18-bday`): dates found in mail
and marked in the reader (`src/lib/dates`, `src/features/dates`, the marking in
`MessageBody.tsx`), the text of a mail's pictures (`Email/imageText`), remote pictures that wait as
placeholders of their size (`remotePictures.ts`, `imageSizes.ts`, the size probe), the AI assistant
(`src/features/assist`, `src/backend/jmap/assist.ts`: writing, summaries, spam checks, labels,
appointments, the provider settings and the answer stream), birthdays (`BirthdayImport.tsx`,
`DateFields.tsx`, `src/backend/jmap/birthdays.ts`, reminders on contacts) and the new synced
settings. It continues the `W-` numbers of
[security-audit-2026-09.md](security-audit-2026-09.md) (the 0.12.0 addendum ended at W-38). Done
with Claude, like the passes before it; the server's side of the new extensions
(`urn:uwumail:jmap:assist`, `imagetext`, `birthdays`, the size probe) was read where the webmail
depends on it, not run.

The threat model gains two inputs. **The reader's own markup inside the mail's frame**: dates are
wrapped in spans and pictures carry markers the app reads from outside through the same-origin
document, so a mail that writes the same markers speaks to the app. **What a model writes**: it
reads the mail, so a summary, a verdict, a draft, a label or an appointment is text a sender can
steer. Both must stay text and must not act by themselves.

## Summary

| ID   | Severity      | Finding                                                                        | Status           |
| ---- | ------------- | ------------------------------------------------------------------------------ | ---------------- |
| W-39 | Medium        | A mail's own picture markers make the server fetch before pictures may load    | fixed in 1806f4b |
| W-40 | Low           | A held Enter on a date adds it to the calendar and saves it                    | fixed in d7fd36b |
| W-41 | Informational | A mail's CSS can restyle the date marks                                        | listed           |
| W-42 | Informational | What the assistant writes follows the mail it read                             | listed           |
| W-43 | Low           | The answer stream and the assistant's appointments have no bound in the client | fixed in aa21985 |
| W-44 | Informational | The ChatGPT sign-in address is opened as the server names it                   | fixed in 9be3b25 |
| W-45 | Low           | Mail in a shared mailbox goes to the person's assistant for appointments       | fixed in 3cf3f62 |
| W-46 | Informational | The composer's "replace" puts the editor's HTML back without sanitizing again  | listed           |
| W-47 | Informational | The date finder runs on the page's main thread                                 | listed           |

Nothing Critical or High. No path to running code on the app's origin was found: the reader frame
still has no scripts (`sandbox="allow-same-origin"`, no `allow-scripts`) and its own policy
(`default-src 'none'`), the marking and the picture markers are added with DOM methods to markup the
sanitizer already cleaned, and nothing new uses `innerHTML` on the page or
`dangerouslySetInnerHTML`. Everything a model writes is React text; nothing turns Markdown into HTML.
W-39 is the one place where a mail reached past the reader's consent: not to the reader's address
(the frame's policy held), but to the server's fetcher.

Update (0.24.0): since 0.22.3 (fdb80a5) the reader and print frames add `allow-scripts` in WebKit
(Safari, every iOS browser), which otherwise never calls the webmail's listeners in the frame; other
browsers keep `sandbox="allow-same-origin"` alone. The frame's own policy now also names
`script-src 'none'`.

## Findings

### W-39 · Medium · A mail's own picture markers make the server fetch before pictures may load

`src/features/mail/MessageBody.tsx` (`sanitize`, `setUp`), `remotePictures.ts`
(`loadRemotePictures`). CVSS `AV:N/AC:L/PR:N/UI:R/S:U/C:L/I:N/A:N` (4.3).

Remote pictures wait as placeholders; the real address sits in `data-uwu-src`, the address to ask
the server about in `data-uwu-url`, and `data-uwu-pending` marks a picture that waits.
`deferRemotePictures` removes such markers from the mail before it sets its own, but it only runs
when remote pictures are allowed. The sanitizer keeps `data-*` attributes, and `loadRemotePictures`
ran on every opened mail. So a mail that brought the markers itself had its address handed to the
size probe (`imageSizes`) with remote pictures blocked, also in Junk, and the server fetched it: a
read receipt before the person said yes. The frame's policy kept the browser from loading it; the
probe isn't bound by that policy. The same markers could also have fed the date click (`markMail`
already dropped `data-uwu-date`).

_Fix:_ the reader's sanitizer drops every `data-uwu-*` attribute of the mail (a DOMPurify hook on a
dedicated instance), so no later step sees a marker the app didn't set, and remote pictures are only
loaded and probed where they may load at all. Test `MessageBody.test.ts` ("drops the reader's own
markers a mail brings along"), with pictures blocked and allowed.

### W-40 · Low · A held Enter on a date adds it to the calendar and saves it

`src/features/dates/EventsBar.tsx` (`DatePopover`), `MessageBody.tsx` (`watchDates`). CVSS
`AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:L/A:N` (3.1).

Enter on a date in the mail opens its popover with "Add to calendar" focused. The key's repeats
reached that button, which opened the editor with its title focused, and a further repeat submitted
the form: one held key put an event with the mail's title and notes into the calendar. The gesture
W-18 and W-29 closed for the link and unsubscribe questions. _Fix:_ the popover's button uses
`armedActivation` (no click in its first 600 ms, no repeating key), and the frame ignores repeated
keys on a date. Test `dates.test.tsx` ("doesn't take the gesture that opened it as the answer").

### W-43 · Low · The answer stream and the assistant's appointments have no bound in the client

`src/backend/jmap/assist.ts` (`readAssistStream`, `toEvents`). CVSS
`AV:N/AC:H/PR:N/UI:R/S:U/C:N/I:N/A:L` (3.1).

The server limits what a model may answer, and the webmail read the stream for as long as it came
and took every appointment the model named, with titles, places and notes of any length. The words
come from the mail the model read. _Fix:_ a stream is broken off after 4 MiB; at most 20
appointments are taken per mail, their title, place, notes and quote clipped by characters (never
half an emoji). Tests `assist.test.ts` ("breaks off a stream that never ends", "bounds how many
events and how much text a model's answer brings").

### W-45 · Low · Mail in a shared mailbox goes to the person's assistant for appointments

`src/features/dates/useMailEvents.ts`, `MessageView.tsx`. CVSS
`AV:N/AC:H/PR:L/UI:R/S:U/C:L/I:N/A:N` (2.6).

Summaries and spam checks are offered only for the person's own mail (`useReaderAssist(own)`);
reading appointments with the assistant was offered for every mail, and with
`assist.refineEvents` on it asked by itself for each opened mail — also in a mailbox a colleague
shared, whose mail then went to the provider the person chose, possibly with their own key.
Whatever the server does with such a request, the client should not make the offer. _Fix:_ the
appointment assistant follows the same rule; the rules-based finder and the pictures' text (read on
the server) stay. Test `dates.test.tsx` ("never asks the assistant about mail someone shared").

## Informational

- **W-41 · A mail's CSS can restyle the date marks** — `MessageBody.tsx` (`DATE_STYLE`). The
  marks are spans with the class `uwu-date` inside the mail's document, so the mail's own `<style>`
  reaches them: it can hide a mark or stretch one over the whole mail, so that any click opens the
  date's popover. The popover only shows what the finder read from this very mail, and adding it
  takes an armed click (W-40) and a save in the editor. _Fix, when wanted:_ a class name chosen per
  document, or the marks' look set inline with `!important`.
- **W-42 · What the assistant writes follows the mail it read** — summaries, spam verdicts, drafts,
  labels and appointments. A sender can write instructions for the model into the mail. Everything
  is shown as text with the provider and model named, nothing is sent, moved or saved by the
  model's word alone, labels set by the assistant are marked and can be undone, and a draft is only
  put into the composer on a click. What remains is persuasion: a verdict of "legitimate" makes
  "Not spam" the primary button in Junk, a summary can leave out the part that matters. Accepted
  for 0.18; the card says "You decide. The model only gives a second opinion." next to the
  server's own signals.
- **W-44 · The ChatGPT sign-in address is opened as the server names it** —
  `toChatgptLogin`. The address comes from the provider through the server and was opened with
  `window.open` whatever it was. The server is trusted here, so this was hardening only. _Fix:_ only
  an `https:` address with a host is taken. Test `assist.test.ts`.
- **W-46 · The composer's "replace" puts the editor's HTML back without sanitizing again** —
  `Composer.tsx` (`applyAssist`), `draftText.ts`. Replacing the own text parses the editor's
  current HTML, keeps the signature and quote as they are and assigns the result to the editor. The
  model's text itself is escaped (`escapeHtml`, `textToHtml`), and the rest was already in the live
  editor (a quote through `quotableHtml`, a paste through the W-2 path); the signature switch does
  the same round trip. _Fix, when wanted:_ pass the kept part through `quotableHtml` in both places.
- **W-47 · The date finder runs on the page's main thread** — `src/lib/dates`. It reads at most
  100 000 characters and 256 levels of markup, and its patterns are bounded (`\s{0,3}`, windows of
  at most 24 characters before a hit). Crafted mails of repeated dates, month names or ISO times at
  that size took up to about 0.5–0.8 s in the test environment, growing roughly linearly. _Fix,
  when wanted:_ run the finder in a worker or in idle time.

## What held up

- **The reader frame.** `sandbox="allow-same-origin"` without scripts, the frame's own policy
  (`default-src 'none'`, pictures only from `data:`, `cid:`, `blob:` and — once allowed — the
  webmail's own origin through the proxy), unchanged (Update (0.24.0): `allow-scripts` in WebKit
  since 0.22.3, see above). Marking happens after sanitizing, on a
  `DOMParser` document where nothing loads or runs, with `createElement`/`setAttribute`; the index
  in `data-uwu-date` is a number the app wrote, the label a translated string. The app listens
  from outside and only reads the mark's index and position; a mail's handlers never run. The
  placeholders are `data:image/svg+xml` of two numbers the parser checked (at most 20 000 each);
  the progress bar is numbers.
- **Remote pictures and consent.** With pictures blocked nothing remote is named in the document,
  asked about or proxied (W-39 closed the one gap). Allowed, every address goes through the proxy,
  the probe asks at most 200 addresses and gives up after 20 s, and a picture that fails stays a
  box of its size. `<picture>` sources, backgrounds and SVG `<image>` go through the proxy as
  before. The pictures' text (`Email/imageText`) reads remote pictures only when they may load and
  never in Junk.
- **Appointments into the calendar.** Title, place and notes are plain text in the editor's
  fields; the link back is built from the page's own origin and path with an encoded thread id, and
  `#mail=` takes only an id without spaces or control characters, up to 512 characters. The
  model's `url` is taken only as `https:`. Calendar text shows links only through the link question
  (WEBMAIL-3). Participants the model names are not put into the event, so nothing is sent to them.
- **The assistant's settings.** An API key is typed into a password field, sent once with
  `AssistProvider/set` and never read back (the server returns `hasKey` and a short hint); it isn't
  kept in local storage, a URL or a log, and an empty field keeps the stored key. The stream is
  posted to a path on the page's own origin with the session cookie and the CSRF header, is called
  off with an `AbortController` when the card closes or asks again, and its parser handles CR, LF
  and CRLF split across chunks.
- **Labels.** Colours are taken only as `#rrggbb` and reach the page as React style values;
  undo names the log entry the server returned.
- **Birthdays.** The import deletes events only as the server allows (`mayDeleteEvent`), says how
  many before the confirming click, sends the event ids the scan returned and reloads everything
  afterwards. Reminder values from a card are taken only as 0–28 days and a valid `HH:MM`.
- **Settings and storage.** `assist.refineEvents` and `mail.detectEvents` sync as booleans only;
  hidden appointment bars (`uwumail.webmail.datesDismissed`, the last 500 mail ids) are cleared
  when another login claims the browser (W-12's rule). The birthday hint's flag is one boolean.

## Regression check of the earlier findings

W-4 holds for the new paths: nothing remote loads, is probed or read for text in Junk without the
click. W-12 covers the new local key. W-17, W-23 and WEBMAIL-3 hold for the appointment notes, which
are calendar text. W-18 and W-29's arming now also covers the date popover (W-40). W-22's rule for
quoted mail is untouched; the new picture code works in the reader frame only. The other findings
are untouched by this branch; their tests pass.

## New or changed accepted risks

- **A model reads the mail.** With the assistant switched on, a mail's text (and with
  `includeImages` its pictures' text) goes to the provider the person or the admin chose, when the
  person asks — or for every opened own mail with `assist.refineEvents`. That is the feature; the
  settings say which provider answers.

## What was run

- `pnpm format:check`, `typecheck`, `lint`, `test` (89 files, 958 tests, 30 skipped for the live
  server), `pnpm build` and `pnpm audit --prod` (no known vulnerabilities) on the final tree.
- Each fix's test was checked to fail without the fix (W-39, W-45) or written against the reported
  gesture (W-40).
- The date finder against crafted mails of 100 000 characters (runs of digits, dots, slashes,
  dashes, weekday and month names, times, ISO dates, many text nodes) for W-47.
- Code reading of the server's `Assist/extractEvents` entry point for W-45.

## What could not be tested, and why

- **A held Enter in a real browser** (W-40) — driven with synthetic key and click events, as for
  W-29.
- **A real server, provider and forged mail** — as before; the size probe and the stream were run
  against local fakes only.
