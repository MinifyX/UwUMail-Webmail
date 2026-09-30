# Nyu animations

Nyu, the envelope cat, reacts to what happens in the mail: short scenes (cameos) in a corner
of the window, Nyu thinking while the AI assistant works, and small idle movements in the
empty-state pictures. Everything lives in `src/components/nyu/`, so the app can take the same
files; only the few call sites listed under "Triggers" are app-specific.

## Rules

- Short: a cameo lasts 1.3–2 s, then goes by itself. One replaces the other, nothing queues.
- Never in the way: the stage is `position: fixed`, `pointer-events: none` on itself and every
  SVG part, `aria-hidden`. It never moves the layout. Below dialogs (`z-index: 45`), above the
  content; bottom right on wide screens, above the Write button on phones.
- Light: inline SVG and CSS keyframes, no images, no animation library. The cameo drawings and
  their CSS (`Cameos.tsx`, `cameos.css`) are a lazy chunk, fetched while the browser is idle
  once Nyu may move; nothing is fetched while the setting is off.
- On-model: all scenes reuse `Nyu`, `Paw`, `Sticker` (white die-cut edge), `Letter`, `Heart`,
  `Star`, `Shadow` and the `NYU` palette from `Nyu.tsx`/`scenes.tsx`, drawn on the scenes'
  320 × 220 canvas with Nyu at 0.4 scale, 6 px outlines and an 18 px sticker edge.

## Setting

Settings → Appearance → **Nyu animations**: `on` (default) / `reduced` / `off`, shown only while
the brand shows the mascot. It is `Settings.nyuAnimations`, kept in the browser like every
setting and synced with the account as the settings-extension key `nyu.animations`
(`"on" | "reduced" | "off"`, see `lib/settingsSync.ts`), so the app should use the same key.

`level.ts` resolves it into a `NyuLevel`:

| setting | general animations resolve to reduced (setting "Off", or "System" + `prefers-reduced-motion: reduce`) | mascot hidden by the brand | level     |
| ------- | ----------------------------------------------------------------------------------------------------- | -------------------------- | --------- |
| on      | no                                                                                                    | no                         | `full`    |
| on      | yes                                                                                                   | no                         | `reduced` |
| reduced | any                                                                                                   | no                         | `reduced` |
| off     | any                                                                                                   | any                        | `off`     |
| any     | any                                                                                                   | yes                        | `off`     |

- `full`: everything moves.
- `reduced`: no movement at all. Cameos with meaning (sent, archived, trashed, deleted, birthday,
  contact, night) appear as a still picture for at most 1.4 s; decorative ones (peek, photos)
  stay away. Idle loops, blinking and the logo hop stop. `NyuThinking` is a still picture.
- `off`: no cameos; `NyuThinking` shows its `fallback` (the old dots / spinner). Empty states
  keep their still illustration.

`useApplyNyuLevel()` (called once in `App`) writes the level to `<html data-nyu="…">`; `nyu.css`
stops every animation inside `.nyu-host` for `reduced` and `off`. Use `useNyuLevel()` in
components and `currentNyuLevel()` outside React.

## Components

| File                        | What                                                                                                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `level.ts`                  | `resolveNyuLevel`, `useNyuLevel`, `currentNyuLevel`, `useApplyNyuLevel`                                                                                                         |
| `cameo.ts`                  | cameo store (zustand) and API: `playNyu(name, { key?, hat? })`, `playFirstNyu(choices)`, `finishNyu(id)`, the `CAMEOS` table (duration, shown when reduced, priority, cooldown) |
| `occasions.ts`              | pure rules: `isLateNight`, `seasonalHat`, `isBirthdayToday`, `contactFor`, `photoCount`, `openCameos(mail, contacts, now)`                                                      |
| `NyuStage.tsx`              | mount once near the root (`App`); lazy-loads `Cameos.tsx` and shows the current cameo                                                                                           |
| `Cameos.tsx` + `cameos.css` | the cameo drawings and their keyframes (lazy chunk)                                                                                                                             |
| `hats.tsx`                  | `NyuHat`: party hat, Santa hat, nightcap, in Nyu's own coordinates (pass as `front`)                                                                                            |
| `NyuThinking.tsx`           | `<NyuThinking size="md" \| "sm" fallback={…} />` for AI loading states                                                                                                          |
| `scenes.tsx`                | the empty-state scenes, now with idle movement (`nyu-zzz`, `nyu-steam`, `nyu-sweep`, `nyu-wonder`) and the nightcap on the inbox-zero scene late at night                       |

### Cameos

| Name       | Picture                                                              | Duration | Reduced | Priority | Cooldown                |
| ---------- | -------------------------------------------------------------------- | -------- | ------- | -------- | ----------------------- |
| `peek`     | Nyu pops up holding a letter, eyes read left to right (seasonal hat) | 1.3 s    | hidden  | 0        | 12 s                    |
| `photos`   | sparkly-eyed Nyu with a camera, flash, a polaroid slides out         | 1.5 s    | hidden  | 1        | 1 min                   |
| `night`    | Nyu in a nightcap sways under the moon, zzz                          | 1.8 s    | still   | 1        | 45 min                  |
| `friend`   | happy Nyu squishes, hearts float up                                  | 1.6 s    | still   | 1        | 5 min per sender        |
| `sent`     | letter winds up and flies off along a dashed trail, Nyu waves        | 1.8 s    | still   | 2        | –                       |
| `archived` | letter drops into a box, flaps close, heart stamp, Nyu hops          | 1.5 s    | still   | 2        | –                       |
| `trashed`  | bin lid opens, letter drops in, Nyu waves goodbye                    | 1.5 s    | still   | 2        | –                       |
| `deleted`  | bin lid slams with a puff, sad Nyu                                   | 1.7 s    | still   | 2        | –                       |
| `birthday` | cheering Nyu in a party hat, confetti burst                          | 2 s      | still   | 3        | once per sender and day |

A cameo is ignored while one of higher priority is still on, while its key is cooling down,
or while the tab is hidden. Each one's resting pose (no animation) is the key picture, which is
what `reduced` shows; all parts animate over the cameo's whole time (`--nyu-cameo-ms`).

## Triggers

| Situation                                | Where (webmail)                                                                                                                                          | Call                                                                                  |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Mail sent (also scheduled / during undo) | `features/compose/undoSend.ts` `announceSent`                                                                                                            | `playNyu("sent")`                                                                     |
| Archived                                 | `lib/queries.ts` `useMessageActions().archive` (list, reader, swipe, selection); `features/shell/commands.ts` ("e")                                      | `playNyu("archived")`                                                                 |
| Moved to trash / deleted for good        | `lib/queries.ts` `trashMail`                                                                                                                             | `playNyu("trashed")` / `playNyu("deleted")`                                           |
| Mail opened                              | `features/mail/nyuOnOpen.ts` `useNyuOnOpen(detail)`, called in `ThreadReader` and `MobileReader` once per loaded conversation                            | `playFirstNyu(openCameos(…))`                                                         |
| AI working                               | `features/assist/ComposeAssist.tsx` `Thinking` (compose, summary, spam check), `features/dates/EventsBar.tsx` "Check with AI" via `Button busyIndicator` | `<NyuThinking fallback={dots} />`, `<NyuThinking size="sm" fallback={<Spinner />} />` |
| Inbox zero / empty search / errors       | `EmptyState` scenes `inbox` (sleepy), `search` (magnifier sweeps, "?" wobbles), `loadError` (puzzled, "?" wobbles)                                       | CSS only                                                                              |

`openCameos` orders the scenes for an opened mail, and `playFirstNyu` plays the first that may
play: sender's birthday today (contact from the address book, 29 Feb on the 28th in other
years) → the mail was unread and the sender is a contact (the webmail has no favourites, so
"someone in the address book" is the favourite/frequent contact) → photos attached (non-inline
`image/*`, not SVG/icons) → late at night (23:00–04:59 local) → a peek, wearing a Santa hat
from 1 to 26 December and a party hat on 31 December and 1 January. The sender is the newest
message in the conversation not written by one of the own accounts; the contacts come from the
address-book query (only fetched while Nyu isn't off).

`Button` got an optional `busyIndicator` (and an exported `Spinner`), so any AI button can show
`<NyuThinking size="sm" fallback={<Spinner />} />` instead of the ring while busy.

## Porting to the app

Copy `src/components/nyu/` (including `cameos.css` and the new part of `nyu.css`), add
`nyuAnimations` to the settings with the `nyu.animations` sync key, call `useApplyNyuLevel()` and
mount `<NyuStage />` next to the toaster, then add the calls from the trigger table at the
app's equivalents (send, archive, trash/delete, open mail on desktop and mobile, AI loading
states). On phones the stage sits above the Write button (`bottom: 88px + safe area`); adjust
`.nyu-stage` in `cameos.css` if the app's bottom bar is taller. Tests to port:
`occasions.test.ts`, `cameo.test.ts`, `level.test.ts`, `Nyu.test.tsx`.
