# Appointments in mail

The reader finds dates in a mail and offers them for the calendar: a bar
above the mail ("📅 6.–9. Okt. · Pixel Days — In Kalender", several folded
into "3 Termine erkannt"), the dates underlined in the text, and the
calendar's editor opening filled in when you take one. Nothing is saved until
you press Save there.

## Where the dates come from

1. **The mail's text, by rules** (`src/lib/dates/`). A small parser of our own,
   no library and no model: German and English day-month and month-day
   dates, numeric ones (`17.10.`, `10/12/2026`, ISO), ranges within and across
   months and years (`6.–9. Okt`, `Oct 6–9`, `30. Dez. – 2. Jan. 2027`), times
   with and without an end (`19:30`, `14–16 Uhr`, `3-5pm`, a time on the next
   line), zone abbreviations (`MESZ`, `PT`), and relative words counted from
   the day the mail arrived (`morgen 14 Uhr`, `nächsten Dienstag`, `tonight at
8`). A date without a year is the next time it comes after the mail (up to
   two months back still counts as this year); a weekday that doesn't fit the
   date lowers the confidence, and a written weekday picks the year when the
   date alone can't. `10/12` follows the mail's own unambiguous slash dates,
   then its language, then the reader's locale, and is shown with the other
   reading ("Or 12 October?").
2. **The text in its pictures**, read by the server (`Email/imageText`, see
   below) and put through the same rules. Remote pictures are only read once
   they may load for this mail anyway. These hits show in the bar only
   ("from picture"), never as underlines.
3. **The AI assistant, only when asked** (`Assist/extractEvents`). "Check with
   AI" in the bar asks it for this one mail; the `assist.refineEvents` setting
   (off by default, in the assistant's settings) asks it for every mail that
   opens. Its answer refines what the rules found — times, title, place win —
   and adds what they missed; the same appointment shows once.

What is text is read from the sanitized HTML as a reader sees it: hidden
preheaders and other invisible text are left out; quoted replies (`>` lines,
`blockquote`, Gmail/Outlook/Apple reply blocks, "Am … schrieb", Outlook header
blocks), signatures, closings and legal footers are read but never offered. A
forwarded mail's quoted part is its content, so there only the header lines
go.

To keep false alarms down, these are no appointments: order, invoice,
customer, phone, version and similar numbers; prices; a document's own date
("Rechnungsdatum", "Bestellung vom", "Stand"); the mail's own date as a
newsletter prints it; dates more than two years out; recurring wording
("jeden Freitag", "every Monday"); "Black Friday" and the like. What was over
before the mail arrived is not underlined, and the bar only lists what is
still ahead.

## Taking one into the calendar

The event editor opens from the mail (it is mounted for the whole app, not only
in the calendar), with the default calendar chosen and:

- the title: a `Titel:`/`Was:` label, else the words in front of the date, a
  short heading above it, else the subject without its dates;
- start and end: all-day for dates alone (the end exclusive, like the
  calendar), one hour for a time without an end, past midnight when the end
  comes before the start; a time in another zone on this device's clock;
- the place: an `Ort:`/`Where:` label, else "im …"/"at …" in the sentence;
- the notes: the sentence it was found in, the mail's subject and sender, and
  a link back to the mail (`/mail/#mail=<thread id>`, which opens that thread
  wherever it is filed).

## Privacy

The rules run in the browser; no text leaves it for them. Picture text is
read by the mail's own server, which has the mail anyway. The AI assistant
never reads a mail unless the person clicked "Check with AI" for it or
switched on `assist.refineEvents` — and only where the server offers the
assistant (`extractEvents` in the capability's features).

## Settings

- `mail.detectEvents` (synced with the account, default on): Settings →
  Reading → "Find appointments in mail". Off, nothing is looked for.
- `assist.refineEvents` (synced, default off): the assistant's own toggle.
- Putting the bar away is per mail and per device (local storage, the newest
  500), and is forgotten when someone else signs in on the browser.

The bar also stays away without a calendar on the server, in Junk, for drafts
and for mails carrying a calendar invitation (which has its own card).

## Server contracts

- `urn:uwumail:jmap:imagetext`, `Email/imageText`:
  `{accountId, emailId, remote}` →
  `{accountId, emailId, unavailable, images: [{source, text, width, height}], skipped}`.
  `source` is `cid:<content-id>`, `blob:<blobId>` or the remote https URL.
  `unavailable` means the server has no OCR. Without the capability the
  webmail asks nothing.
- `urn:uwumail:jmap:assist`, `Assist/extractEvents`:
  `{accountId, emailId, includeImages}` → `{accountId, emailId, events: [{title,
start, end, allDay, timeZone, location, description, url, participants,
confidence, quote}]}`, times as JMAP LocalDateTime. `includeImages` is only
  true when the mail's remote pictures may load.

Both answers are checked and bounded before use
(`src/backend/jmap/eventSources.ts`): at most 50 pictures of 20 000 characters
and 20 events, every field capped, times that aren't times dropped.

## Limits

The parser reads at most 100 000 characters, with patterns that stay linear on
hostile input (long runs of digits and dots are part of the tests); at most 20
appointments per mail, the likeliest ones. Other languages than German and
English are not understood beyond numeric and ISO dates.
