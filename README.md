<p align="center">
  <img src="public/uwumail-app-icon.svg" width="112" alt="UwUMail logo" />
</p>

<h1 align="center">UwUMail Webmail</h1>

<p align="center">
  The mailbox in the browser for my own mail server. (=^･ω･^=)<br/>
  React · JMAP · served by <a href="https://github.com/MinifyX/UwUMail-Server">UwUMail Server</a> under <code>/mail</code>
</p>

---

## Why this exists

I build UwUMail for myself: an [app](https://github.com/MinifyX/UwUMail-Client)
for my own machines and a [server](https://github.com/MinifyX/UwUMail-Server)
for my own mail. What was missing is the case where the app isn't there — a
borrowed laptop, someone else's phone, a quick look from work. That's what this
is.

- **Just for fun.** No company, no team, no schedule, no promises. I work on it
  when I have time and feel like it.
- **Written with AI.** Almost all of the code is written with Claude, because
  I'm honestly not a great programmer. Not your thing? No hard feelings.
- **Use it, fork it, do what you want with it.** The license only asks one
  thing: changed versions stay open, even when you only run them as a service.
- **No support.** Issues and pull requests are okay, but I might answer late or
  not at all.

## What it is

The webmail is the UwUMail app's own interface, cut down to what a browser can
do well, talking to the server over JMAP. It is not a separate product: it is
served by the mail server itself, under `/mail`, and an admin can switch it off
for the whole server or for single accounts.

- **One login.** Whoever is signed in to the server's portal is signed in here.
  Two-factor, passkeys, session list and lockouts all keep working, because it
  is the same session.
- **One mailbox.** The account on this server, nothing else. No adding
  accounts, no passwords kept in a browser.
- **Reads like the app.** Conversations, folder tree, search, attachments,
  spam and blocking, keyboard shortcuts, dark mode, German and English, playful
  or plain — the same Nyu, the same colours.
- **Fits a phone.** Below 700 px it turns into the app's phone layout, with
  swipes and a full-screen composer, and it can be put on the home screen.

Mail HTML is never trusted: the server hands out a cleaned version, and the
webmail shows it in a sandboxed frame that blocks scripts and remote content
until you ask for them.

## Working on it

```bash
pnpm install
cp .env.example .env.local   # point UWUMAIL_DEV_SERVER at a test server
pnpm dev                     # http://localhost:1430/mail/
pnpm dev:demo                # sample data, no server needed
pnpm build                   # typecheck, then dist/
```

`pnpm build` writes `dist/`, which the server bakes into its binary. The
server's container build clones this repository at a fixed commit, so a server
release always carries one known webmail state.

## Licence

AGPL-3.0-only. See [LICENSE](LICENSE). Parts of the interface come from the
UwUMail app, which is GPL-3.0; I wrote both, so they are under the AGPL here.
