# Features

Everything the webmail does, in more words than the [README](../README.md) has
room for. It is the UwUMail app's interface, served by
[UwUMail Server](https://github.com/MinifyX/UwUMail-Server) under `/mail`, and
talks to it over JMAP.

## Signing in and the account

- **One login.** Whoever is signed in to the server's portal is signed in here.
  Two-factor, passkeys, session list and lockouts all keep working, because it
  is the same session.
- **One account, and what is shared with it.** The account on this server,
  nothing else. No adding accounts, no passwords kept in a browser. Folders and
  calendars other people on the server share show up under their name, as far
  as they allow; your own can be shared from their menu. Shared mailboxes you
  are a member of show up next to your own.
- **Switched off by the admin.** An admin can turn the webmail off for the whole
  server or for single accounts.

## Reading

- **Like the app.** Conversations, folder tree, search, attachments, spam and
  blocking, keyboard shortcuts, dark mode, German, English, French, Dutch,
  Japanese and Simplified Chinese, playful or plain — the same Nyu, the same
  colours, or the name, logo and colour the server's admin chose.
- **Nyu animations.** Nyu reacts to what happens: peeks at an opened mail, waves
  a sent one goodbye, closes the box on archiving, thinks while the AI works,
  and puts on a party hat when the sender has their birthday today. Short,
  never in the way, and set
  to _on_, _reduced_ or _off_ under _Settings → Appearance_ (reduced follows
  the system's reduced motion). See [nyu-animations.md](nyu-animations.md).
- **Fonts.** The webmail is set in UwU Sans, UwUMail's own font (Atkinson
  Hyperlegible Next with Nyu, a heart and arrows added; `:3` and `<3` stay as
  you typed them). _Settings → Appearance → Font_ switches to Rubik, DM Sans or
  the system font, in this browser only. Mails get the same font: one without a
  font of its own no longer ends up in Times, serif fonts are replaced unless
  _Settings → Reading → Sender fonts_ says to keep them, and a missing Calibri
  or Aptos falls back to yours. The mail frame may load exactly that font's
  files and nothing else from the server.
- **Mail HTML is never trusted.** The server hands out a cleaned version, and the
  webmail shows it in a sandboxed frame that blocks scripts and remote content
  until you ask for them.
- **Remote pictures without the wait.** Once they may load, the text shows at
  once and every remote picture waits in its own place with a shimmer, sized by
  the server before it arrives, so nothing jumps; a thin bar counts them in.
  Pictures from dead hosts never hold the mail up: they end as a quiet box,
  tracking pixels as nothing. The server fetches them, never the browser.
- **Mail from Microsoft 365.** Links wrapped in Microsoft Safe Links show and
  open their real address, and every link check looks at that one (the stored
  mail stays as it came). Outlook's packed winmail.dat is unpacked by the
  server into ordinary attachments and invitations; an older server shows it
  as one file with a note to update. A Teams meeting link gets a join button.
- **Unsubscribing in one click.** Where the sender offers it (RFC 8058), the
  server does the one-click unsubscribe itself — through the same guards as
  remote pictures, only for links the sender's DKIM signature covers. Mail
  without it goes the old way: a mail to the list, whose address you see first,
  or the sender's own page.

## Writing

- **Held back by the server.** "Undo send" and "send later" are the server's: a
  mail waits there, not in the tab, and can be taken back until it goes.
- **Signatures per domain.** Pick a domain and write one signature for all
  your addresses there, or one for every domain; a single address can still
  have its own. Placeholders (`{name}`, `{adresse}`, `{domain}`) are filled by
  the server for each address. An admin's company template is offered to people
  without a signature of their own, and where the admin made a company footer
  mandatory the composer says the server will add it. On servers without
  signatures per domain, signatures live on the sending addresses as before.
- Recipients are suggested from the address books and the mail history.
- **Masked addresses.** Where the server makes them, the settings list the
  account's masked addresses — random ones for single websites, the same the
  portal and password managers make — to copy, describe, switch off, delete and
  bring back, and make new ones on the domains the admin allows.

## Calendar, contacts and birthdays

- **Calendar and contacts.** When the server keeps them for the account, the
  calendar and the address books sit next to the mail, the same ones a phone
  syncs over CalDAV and CardDAV.
- **Birthdays.** Birthdays and wedding anniversaries of the contacts, with or
  without the year, fill a calendar of their own with the age ("turns 30"); a
  click opens the contact, and each contact can ring on the day, a day or a week
  before. Birthdays kept as events in other calendars can be moved into the
  contacts in one go, with a choice for every unclear one, and the old events
  are deleted afterwards.
- **Pictures.** Contacts get a picture — chosen, dropped, pasted, taken with the
  phone's camera or the company's logo — cropped right in the browser into a
  small square that lives in the card. The own profile picture is set in the
  settings, for nobody, the people on the server, or everyone (Libravatar). Next
  to mail, a contact's photo or a person's own picture comes first, then a
  company's logo; the server fetches them, never the browser.

## Appointments in mail

"Prime Day deals vom 6. – 9. Okt", "am Freitag, 17.10. um 19:30 Uhr", "tomorrow
at 3pm": dates in a mail, German or English, are underlined, and a bar above the
mail offers them for the calendar, whose editor opens filled in — title, times,
place, and a note quoting the mail with a link back to it. Pictures count too,
once the server has read their text.

This is done by rules in the browser, not by an AI. The server's AI assistant
reads a mail for dates only when you ask:

- **Find appointment** in the reader's AI menu reads the mail right away, whatever
  the automatic setting says, and puts what it found into the same bar;
- **Check with AI** in the date bar refines what the rules found;
- or, switched on under _Settings → AI assistant_, every mail you open.

Details in [dates.md](dates.md).

## Labels

- **Base labels.** Every account has eight fixed labels: Invoice, Shipping,
  Appointment, Newsletter, Account & security, Personal, Work & business and
  Promotions (named in your language). Each has a sharp definition that doesn't
  overlap with the others, shown under _Settings → Labels_ and read-only there;
  the name and colour can be changed. A label you had before with the same
  meaning (e.g. "Rechnungen") became the base label instead of a second one.
  Base labels don't count toward the 30 own labels, and a deleted one can be
  restored with its definition.
- **Switched one by one.** Every label, base or own, has its own switch _Put on
  by itself_. Off, it only goes on when you put it on by hand: no condition,
  detector, learned sender, similar mail, classifier or model sets it.
- **Own labels** sit below the base labels. While you name or describe one, the
  webmail asks the server whether it overlaps a label you have (the same name,
  the meaning of a base label like "Handyrechnungen" and Invoice, or largely
  the same words) and warns you; saving still works.
- **One label, rather none than a wrong one.** Mail gets at most a main label
  and an optional second one, and none when nothing is sure enough. The log
  under _Settings → Labels_ says what set each one, including "like your mails
  with this label".
- **Learns from you.** Putting a label on or taking it off by hand (the chips,
  the label menu, _Label again_) is a keyword change on the server
  (`Email/set`), which the server learns from.

## AI assistant

Where the server's admin set up a model (or lets people bring their own), the
composer writes from a short instruction or rewrites the draft — more formal,
shorter, proofread, translated — the reader summarizes a mail or the whole
conversation and gives a second opinion on spam next to the server's own
findings, dates are found on a click, and, once switched on, the model helps
labelling incoming mail where the labels without AI aren't sure, each label
with its reason and one click to undo. Every AI
button tells on hover what it will take in tokens, what it costs and what is
left today. Setup, costs and privacy: [ai-assistant.md](ai-assistant.md).

## Phone and notifications

- **Fits a phone.** Below 700 px it turns into the app's phone layout, with
  swipes and a full-screen composer, and it can be put on the home screen.
- **Notifications with the tab closed.** Switched on in the settings, the browser
  announces new mail in the inbox, and in mailboxes shared with you, even when
  no webmail tab is open (Web Push through the server's JMAP push
  subscriptions). Only the news that something changed goes through the
  browser's push service, encrypted; sender and subject come from the server
  itself, and can be left out too.
