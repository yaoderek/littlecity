# Languages — Design

Approved: pending (Derek). A project (about 20 files, six languages).

## Intent

Little City went viral on 2026-11-24 and about a third of its players since then don't use an English browser. PostHog (people with a pageview since 2026-11-24 00:00 UTC, by `$browser_language`): English 821, Chinese 230 (199 zh-CN, 22 zh-TW), Spanish 66, French 59, Portuguese 55, Japanese 54, Korean 46, then Turkish 37, German 32, Russian 29 and a long tail. Japanese (19%) and French (22%) players reach 2 minutes less often than English ones (28%); Chinese players reach it as often (29%). Every word on screen should be in the player's own language, chosen without them doing anything, so the words never get in the way of playing.

## Goals

- Six languages besides English: Simplified Chinese (`zh-Hans`), Spanish (`es`), French (`fr`), Portuguese (`pt`), Japanese (`ja`), Korean (`ko`).
  - Portuguese is Brazilian (pt-BR 51 people, pt-PT 3). Spanish is neutral, readable in Spain and Latin America (es-ES 39, Latin American codes about 24): `tú`, no `vosotros`, no regional words where a common one exists. French is France's. (My call, from PostHog.)
- **Everything the player reads in the game**: the reasons a piece can't go somewhere (from the game core, see How it works), menu, tray and piece names, welcome / start card, tips and toasts, town stats (labels and silly tallies), mischief, fly mode, My towns (including "5 minutes ago" style times), the guide (group titles, building names, `when` and `how` sentences), the loading line in index.html ("Drawing your town…"), buttons' `aria-label`s and `title` tooltips, and `document.title`.
- **Chosen automatically** from `navigator.languages` (first entry whose language part matches one we have; any `zh*` goes to Simplified, as zh-TW players read it and 22 people don't justify a seventh file yet). Anything else gets English.
- **A Language item in the menu** that lists the seven languages, each in its own name (English, 简体中文, Español, Français, Português, 日本語, 한국어). The choice is kept in `localStorage` and wins over the browser from then on. Changing it reloads nothing the player made: the town stays (see Constraints).
- **Never half-translated by accident**: a unit test fails if any English line is missing from any language file, if a language file has a line English no longer has, or if a line's `{placeholders}` differ from the English one.
- **Measurable**: every analytics event carries `lang` (the language in use), so a week later we can compare 2-minute stays by language with the numbers above.

## Non-goals

- Search engine pages in other languages (tools/seo.mjs, /about/, /guide/ pages, the `<meta>` description and share-card text in index.html stay English). A later project if the in-game change pays off.
- Traditional Chinese, Turkish, German, Russian and the rest (Derek picked the six). The design must make adding one a matter of adding one file.
- Right-to-left languages.
- Live machine translation, a translation server, or any per-visit cost.
- Translating player-named towns. Names the player typed stay as typed.

## Anti-goals (a failure even if it works)

- **Losing or breaking a town.** Save compatibility is a hard constraint: no saved data may contain translated text that the game later reads back as meaning. In particular "Town 3" numbering (src/app/towns.ts `nextName`) must keep working: new default names use the player's language ("街 3", "Ville 3"…), and numbering must count both the English `Town N` names already saved and the localised pattern.
- **Wrong or stiff words.** Labels like "Sound: on" or "3 days ago" built by gluing English words together; Japanese and Korean need different word order. Every translatable unit is a whole sentence or label with named placeholders, never fragments.
- **Broken layout.** French and Portuguese run longer; on a 375 px wide phone, every button, card and the tray must still fit without clipping or overlap in all seven languages.
- **Slower start.** The page start must not wait for anything new: English stays in the main bundle; other languages are each one small file loaded alongside the game, never blocking the first frame (an extra round trip while the loading drawing is up is fine; a visible flash of English then a swap is not).
- **Tests becoming flaky or English-bound.** Unit tests and e2e run in English unless a test asks for a language.

## Constraints

- Plain TypeScript and the repo's `el()` DOM helper; no framework, no new runtime dependency (no i18next: ~370 lines, a lookup does it). `Intl.PluralRules` for counts, `toLocaleString` / `toLocaleDateString` with the chosen language for numbers and dates.
- System fonts already show CJK; no fonts to add.
- Other chats edit src/ui at the same time: keep the change to each call site to wrapping the existing English string, so merges stay small.
- Nothing goes live without Derek trying it on a local preview (including on his phone) and saying yes.

## Approaches

- **A. Translate once with AI, ship the files with the game (picked).** Free to run, instant, reviewable, testable; new English lines need a translation pass (the test makes that impossible to forget).
- B. Live machine translation per visit (Google Translate API or similar): costs per player, slower start, needs a server, short game labels translate badly. Rejected.
- C. Leave it to the browser's own page translation: already available in Chrome, mangles a live game UI (rewrites DOM text the game updates), absent in X's in-app browser where two thirds of phone visitors are. Rejected.

Derek's picks (2026-11-25): six languages (1a), automatic plus a menu item (2a), the guide translated too (3a), quality checked by translating back to English (4a).

## How it works

- `src/i18n/` (new): `t(english, vars?)` looks the English string up in the active language's table and fills `{name}` placeholders; plural lines are written `t({ one: '{n} minute ago', other: '{n} minutes ago' }, { n })` and pick the form with `Intl.PluralRules`. English is the key, so call sites read as before and an untranslated line falls back to English in production (the test stops that from shipping).
- `src/i18n/<lang>.json`: one flat object per language, English line → translation, generated and checked by a tool, then committed. Readable diffs; a person who speaks the language can fix a line by hand.
- `tools/translate.mjs` (new): extracts every `t(...)` English line from src (and the guide entries and index.html loading line), finds lines missing from each language file, and writes the translations. The translations themselves are done by Claude in a session (no API key in the repo); the tool's job is extraction, the missing-line list and the checks. Each translation is checked by translating it back to English and comparing meaning; lines that drift are redone.
- **Refusal reasons** (about 48 `no(...)` calls in src/world/world.ts, plus src/world/land.ts, src/world/save.ts, and the English added to a reason in src/app/towns.ts): today English fragments with internal piece names glued in. They become a whole line plus named details, e.g. `no('A {piece} needs firm ground or the top of a solid block', { piece: 'dock' })`; the screen turns the line into words with `t()` and names the piece by its tray name in the player's language. Analytics `piece_refused` keeps sending the English line filled in, exactly as today, so the existing data stays comparable. Saved-file errors shown to the player get the same treatment. (My call: the only way that is neither glued English nor fragile pattern-matching.)
- Text decided at module load (e.g. `SILLY`, `GROUPS`, guide entries, the menu's "no room" lines) is looked up at the moment it is shown, not at import, so a language change takes effect without a reload.
- Language change from the menu: re-render the HUD (menu, tray, stats, any open sheet). If that is costly to do in place, a page reload is acceptable only because the town is autosaved first and reopens exactly as it was; the builder decides which, and says.
- `<html lang>` is set to the active language, for screen readers and for the browser not to offer its own translation.
- Translation voice: the game's English voice is short, plain, a little dry, written for a child holding the tray (src/guide/entries.ts header). Keep that: short everyday words, no formal register (Japanese plain/polite です・ます for sentences, short nouns for buttons; French "tu" is not needed since lines rarely address the player — where they do, use "tu"), piece names consistent across every line that mentions them (one glossary per language, kept at the top of its file's checks).

## Keeping it translated (other chats)

Other chats keep adding text. My calls:
- A unit test fails on bare English passed as `text`, `aria-label` or `title` to `el()`/`iconButton()` in src/ui (strings not wrapped in `t()`), so new text can't slip in untranslated. A short allow-list covers deliberate exceptions (the language names, "Little City").
- The chat that adds or rewords a line translates it in the same change: `npm run translate` lists the missing lines per language; that chat writes them (it is Claude too) and back-checks them. The rule goes in docs/swarm/CONTRACTS.md, which every agent here reads.
- In production a line that is somehow missing shows in English rather than blank or a key.

## Left to the builder

- Exact module layout, the JSON vs TS choice for the tables, and how the extractor finds strings.
- In-place re-render vs autosave-and-reload on language change (see above).
- How lines are batched for translation and the back-translation check.
- Shortening a translation (not the English) where it doesn't fit a phone, keeping meaning.
