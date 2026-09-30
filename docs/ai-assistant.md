# AI assistant in the webmail

The webmail shows the AI assistant of the UwUMail server it is served by. It
never talks to a language model itself: every request goes from the server to
the provider, with the server's limits and checks. This page is about the
webmail's side; the server's
[AI assistant guide](https://github.com/MinifyX/UwUMail-Server/blob/main/docs/llm.md)
has every provider, address rule and limit, and
[jmap-assist.md](https://github.com/MinifyX/UwUMail-Server/blob/main/docs/jmap-assist.md)
the protocol.

## What it does, and where

| Feature           | Where                                                                                                                                                     | Starts                                                                               |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Write and rewrite | Composer: write from an instruction, presets (more formal, more casual, shorter, friendlier, clearer, spelling, translate), _Adjust…_ with your own words | a click; the draft changes only when you insert or replace                           |
| Summaries         | Reader's AI menu: one mail or the whole conversation                                                                                                      | a click                                                                              |
| Spam check        | Reader's AI menu: _Check for spam_                                                                                                                        | a click; the model's verdict next to what the server knows, with _Spam_ / _Not spam_ |
| Appointments      | Reader's AI menu: _Find appointment_; _Check with AI_ in the date bar                                                                                     | a click, or on every mail you open when you switch that on                           |
| Labels            | New mail in the inbox                                                                                                                                     | in the background, only when you switch it on                                        |

The features you start with a click are there as soon as a provider is; you
don't have to switch them on. Every answer names the provider and model that
gave it. While the model works, Nyu thinks (or a spinner turns, with Nyu's
animations off).

## Setting it up

**The admin** (portal, _Server → Settings → AI assistant_):

- adds providers: the kind, the key, and _Load models_ to check it and pick a
  model for writing and a cheaper, faster one for everything else;
- chooses who may use each: everyone, the people of some domains, or some
  people, and for which features;
- sets daily limits per person in requests and tokens (days in UTC);
- switches _Show costs to the people using it_ per provider (off by default);
- decides which features exist at all, whether people may add their own
  providers, and whether those may be in the local network.

**You** (webmail, _Settings → AI assistant_):

- choose the standard model, or another one per feature;
- add your own providers with your own key, when the admin allows it;
- keep your labels, switch auto-labels on, and let the model label your newest
  inbox mail once;
- switch _Look for appointments whenever a mail opens_ on (off by default; each
  mail then counts against your daily limit);
- choose the currency (English only: euros or US dollars);
- see today's use against your limits, and the last 30 days with costs.

## Providers

OpenAI, Anthropic Claude, Google Gemini, Mistral, OpenRouter, Ollama, any
OpenAI-compatible server, and a ChatGPT subscription.

- **Claude** only with an API key: Anthropic does not allow its Pro and Max
  subscriptions in other programs.
- **Gemini's free tier** may be used by Google to improve its products; use a
  key of a project with billing for mail.
- **ChatGPT** is experimental: it signs in the way OpenAI's Codex CLI does, is
  not an API OpenAI offers to other programs, and is only offered as your own
  provider.
- **Local models.** An Ollama, LM Studio, vLLM or llama.cpp server on the LAN
  can be a server provider (the admin gives its address, e.g.
  `http://192.0.2.10:11434`), or your own when the admin allows own providers
  in the local network. The webmail can't reach `localhost` on your computer,
  and the server can't either; the UwUMail app finds an Ollama or LM Studio on
  the same computer by itself.

## Before you click: the estimate

Hovering an AI button (a long press on a touch screen) shows a line like

> ≈ 1,250 tokens · ≈ €0.02 (max €0.05) · 48,000 left today

and, from a 0.20.0 server on, a short breakdown below it: input, pictures,
answer, thinking, extra calls and fees, each only when it isn't zero, plus
"Calibrated from your last calls" when the numbers were corrected by how far
earlier estimates were off.

- **Tokens** are what the request would send plus the expected answer, over
  every model call the request makes (reading pictures, parts of a long thread,
  a retry now and then) and with the thinking of reasoning models. The
  server builds the real prompt for it (the same cutting, the same conversation,
  the same picture text) without asking the model, and counts about four
  characters to a token, so it is approximate: providers count with their own
  tokenizers.
- **Cost** shows for your own providers always, for the server's only when the
  admin switched _Show costs_ on for that provider, and only where the price is
  known. Small amounts get enough digits ("< €0.0001", "€0.0023"). **Max** is
  the worst case, every call answering as long as it may.
- **Left today** is what remains of your daily limit, in tokens or requests;
  it is left out when there is no limit or the provider is your own.
- The estimate is asked the first time you hover, and kept until the mail or
  draft changes (in the composer after you stop typing for a moment). It counts
  nothing against your limits. A server older than 0.19.0 doesn't know it, and
  the tooltip simply stays away.

## Costs

The server knows what most models cost from public price lists (LiteLLM's, and
OpenRouter's own), fetched once a day; the admin, or you for your own
providers, can set a price by hand in US dollars per million tokens. Ollama
and a ChatGPT subscription are free per request.

The currency follows the language: yen in Japanese, yuan in Chinese, euros in
all others; in English you may choose US dollars. Amounts are converted with the
European Central Bank's reference rates. Each request's cost is kept with the
usage at the price of the moment; requests before 0.19.0 have none.

## Privacy

- Only what a feature needs goes to the provider: the mail's text (HTML turned
  into text), subject, date, names and addresses; for labels only their names
  and descriptions and the start of the mail. No attachments, no pictures, no
  other mail. Quoted history is left out and the text is cut to size.
- Text found in a mail's pictures is only added for appointments, as text; the
  pictures themselves never go to a provider.
- The mail is data for the model, not orders: it gets no tools, its answers
  are checked against a fixed shape, and nothing is sent, moved or deleted by
  it. Labels are the only thing it does on its own, and only when you switched
  them on; each can be undone in one click.
- Keys are sealed on the server and never shown again, only their last four
  characters.
- What the provider does with the text is up to its terms. For mail that must
  not leave the house, use a model in your own network.
