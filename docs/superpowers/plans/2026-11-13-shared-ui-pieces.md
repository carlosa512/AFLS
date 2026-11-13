# Shared screen pieces and the Locker Room: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One icon set, one "go to another screen" link, one label style and text scale, one top-of-screen bar with a
hidden screen name, and a Locker Room that fills a desktop screen, each held by a test.

**Architecture:** Four small shared pieces in `src/ui/` (`icons.tsx`, and `MoreLink` and `PageHeader` in
`components.tsx`) plus shared label rules and a new size step in `src/styles.css`. Each lands with a contract test in
`src/ui/ui.test.ts` that reads the source, the way the existing screen-contract tests do. Then the Locker Room is
rebuilt on panels with them. UI only: nothing in `src/engine/` or the save changes.

**Tech stack:** React 19, TypeScript, plain CSS (`src/styles.css`), Vitest with `renderToStaticMarkup`, Playwright
(from the machine) for screenshots through `scripts/screens.ts`.

**Spec:** `docs/superpowers/specs/2026-11-13-shared-ui-pieces-design.md`. Read it first. This plan argues from it.

## Global constraints

- No change to `src/engine/`, `League`'s shape or `SAVE_VERSION`. No new dependency in `package.json`.
- The SNN newspaper (`.ed-*`), the game viewer and broadcast styles and the stadium paint are not restyled. Swapping
  their glyph characters for `Icon` (spec, "What replaces what") is the only change there.
- Screen text follows `docs/UI.md` "Words on a screen". No new line describes a panel or explains a control. After any
  change to screen text, run `npm run copy` and read the touched lines in `.check/copy.txt`.
- Every screen touched looks no worse than before in light, dark and at phone width (390px).
- Checks are UI-only (CLAUDE.md "Commands", item 1): `npm run typecheck` and the tests you touched
  (`npx vitest run <file>`). No sims, no `npm run check`. `npm run format` before every commit.
- Commit messages follow the repo's "<Area>: <what>" style (for example "Icons: one SVG set replaces the characters")
  and end with the session's attribution lines.
- Work on branch `claude/compassionate-rubin-466wy2`. Push there after each task. No pull request unless the owner
  asks.
- **The owner approves every task before the next one starts** (the checkpoint below). The plan never runs two tasks
  without a checkpoint between them.

## The checkpoint (the end of every task)

The owner asked to review each change before the work moves on. Every task ends with these steps, in this order:

1. **Shoot "after"** with the same command and save that the task used for "before", with `--before` pointing at the
   "before" folder so the script also writes side-by-side pictures into `<out>/compare/`.
2. **Commit and push** the task (the session's stop hook requires pushed work at the end of a turn; approval gates the
   next task, not the push).
3. **Post the checkpoint message** in this shape, short, plain words:

   ```
   Task N done: <name>
   What changed: 3–6 bullets a player would notice, then one line for anything only a developer would.
   Files: the files touched, one line.
   Tests: what ran and the result (pass counts, or the failure and what was done about it).
   Look at: the side-by-side pictures (sent with SendUserFile, display "render"), desktop first, then phone, then dark.
   Your call: approve, or tell me what to change.
   ```

4. **Stop and wait.** Do not start the next task until the owner approves. If they ask for changes, make them, shoot
   again, commit, push and post a new checkpoint for the same task.

Send at most eight pictures a checkpoint. Pick the screens the task changed most. List the rest by path under
`.check/ui-review/`.

## Review focus

These are the conditions the spec implies that no task's main tests exercise, most likely to bite first. Each has its
test in the task that owns the code.

1. **Phone width.** The Locker Room's three morale columns must fall back to one column in today's order, and
   `MoreLink` must keep a 32px tap target. Covered by the checkpoint's phone shots and the CSS assertions in Tasks 2
   and 5.
2. **Dark mode.** Icons must draw in `currentColor`, never a fixed colour. Task 1 asserts no colour literal in
   `icons.tsx`.
3. **Screen readers.** A button holding only an icon must keep its `aria-label`. Task 1's contract test checks it.
4. **A Locker Room early in a league** (no captains yet, nobody unhappy, every room quiet) must still render the
   right empty lines. Task 5 renders a fresh league.
5. **Stats before anything is played**, after the pickers move up into the bar. "Stats appear once the first week is
   played." and "No awards yet." must still show, with no empty picker. Task 4 renders a fresh league.

## Files

| File | Change |
| --- | --- |
| `scripts/review-saves.ts` | New: writes the two review saves (Task 0) |
| `scripts/screens.ts` | `--routes` and `--before` options (Task 0) |
| `package.json` | `review-saves` script (Task 0), patch version (Task 6) |
| `src/ui/icons.tsx` | New: `Icon` and the sixteen drawings (Task 1) |
| `src/ui/icons.test.tsx` | New (Task 1) |
| `src/ui/components.tsx` | `MoreLink` (Task 2), `PageHeader` (Task 4), glyph swaps (Task 1) |
| `src/ui/routes.ts` | `SCREEN_NAMES` (Task 4) |
| `src/ui/App.tsx` | Hidden `h1`, `TABS` labels from `SCREEN_NAMES` (Task 4), glyph swap (Task 1) |
| `src/ui/screens/Stats.tsx`, `TeamStats.tsx` | `PageHeader`, lifted pickers, headings (Task 4) |
| `src/ui/screens/FrontOffice.tsx` | `PageHeader` (Task 4), `MoreLink` (Task 2) |
| `src/ui/screens/LockerRoom.tsx` | Rebuilt on panels (Task 5) |
| `src/ui/ui.test.ts` | One contract test a piece (Tasks 1–4) |
| `src/styles.css` | `.more-link`, `--step--2`, shared label rules, sizes on the scale, `.page-bar`, Locker Room grid |
| Glyph and link sites | The files in the spec's table (Task 1) and the sweep list (Task 2) |
| `docs/UI.md`, `CLAUDE.md`, `src/ui/changelog.ts` | Task 6 |

---

### Task 0: Review tooling and the baseline

The checkpoints need saves to load and screenshots of exact screens, before and after.

**Files:** create `scripts/review-saves.ts`; modify `scripts/screens.ts`, `package.json`.

**Interfaces:**

- Produces: `npm run review-saves -- --out <dir>` writes `<dir>/week7.json` (a new career on seed `uireview`, team 9,
  six weeks played) and `<dir>/draft.json` (the same league advanced to the draft phase).
- Produces: `npm run screens -- --save <save> --out <dir> --routes '<hash>,<hash>' [--dark] [--before <dir>] [--width <px>]`
  shoots each hash at desktop (1440×900, or `--width`'s width) and phone (390×844), full page, as `NN-<slug>.png` and
  `NN-<slug>-phone.png`, where
  the slug is the hash with `#/` dropped and `/` turned into `-` (`#/office/fa` gives `office-fa`). With `--before`,
  for every file name in both folders it also writes `<out>/compare/<name>`: before on the left, after on the right,
  each labelled.

- [ ] **Step 1: Write `scripts/review-saves.ts`.** It builds the league exactly as `startCareer` in
      `src/ui/screens/NewGame.tsx` does (`createLeague({ seed, userTeamId, inheritStaff: true, personnel: true,
      spatialField: true })`, then `deliverMail`). Don't import `NewGame.tsx`: it pulls the browser store. Then it
      plays six weeks with `playWeek` and `deliverMail` after each, writes `week7.json`, and steps the calendar the way
      `scripts/mail-preview.ts`'s `step` does (with `advanceOffseason(l, { autoUser: true })`) until
      `league.phase === 'draft'`, then writes `draft.json`. Add `"review-saves": "tsx scripts/review-saves.ts"` to
      `package.json`.
- [ ] **Step 2: Run it.** Run `npm run review-saves -- --out .check/ui-review/saves`. Expected: both files written,
      with the phase and week printed for each, in about a minute.
- [ ] **Step 3: Add `--routes`, `--before` and `--width` to `scripts/screens.ts`.** Document them in the header
      comment. `--width` replaces `DESKTOP`'s width only. `--routes`
      reuses `goTo(page, hash, 'main')` and `shootPage`. For `--before`, render the two PNGs side by side in a
      Playwright page (an HTML string with both as `data:` URIs and a caption over each), screenshot it at
      `deviceScaleFactor` 1, and cap the height at `MAX_CARD_HEIGHT`.
- [ ] **Step 4: Shoot the baseline.** Run:

      ```bash
      npm run screens -- --save .check/ui-review/saves/week7.json --out .check/ui-review/0-baseline --routes '#/,#/locker,#/inbox,#/office/coaches,#/office/trades/block,#/stats/leaders,#/stats/players,#/stats/teams,#/stats/records,#/stats/awards,#/schedule,#/game/78'
      ```

      Expected: 24 PNGs and "0 app errors". If game 78 isn't one of team 9's played games in this save, use the first
      one that is (in a played game, `homeId` or `awayId` is 9 and `result` is set). Repeat with `--dark` into
      `.check/ui-review/0-baseline-dark`.
- [ ] **Step 5: Typecheck and format.** Run `npm run typecheck && npm run format`. Expected: clean.
- [ ] **Step 6: Commit** with the message "Screens: shoot exact screens, and before and after side by side".
- [ ] **Step 7: Checkpoint.** Post the message with three baseline pictures (Home, Locker Room, Stats leaders, all
      desktop) and the commands every later checkpoint will use. Wait.

### Task 1: Icons

**Files:** create `src/ui/icons.tsx` and `src/ui/icons.test.tsx`. Modify every site in the spec's "What replaces
what" table, `src/styles.css` (the `.card-section > summary::after` and `.stepper li.done::before` rules) and
`src/ui/ui.test.ts`.

**Interfaces:**

- Produces:

  ```ts
  export const ICON_NAMES = ['close', 'back', 'chevron-left', 'chevron-right', 'chevron-down', 'chevron-up',
    'caret-up', 'caret-down', 'play', 'pause', 'rewind', 'forward', 'edit', 'check', 'trend-up', 'trend-down'] as const;
  export type IconName = (typeof ICON_NAMES)[number];
  export function Icon(props: { name: IconName; label?: string; className?: string }): JSX.Element;
  ```

  The output is an `<svg viewBox="0 0 24 24" width="1em" height="1em" class="icon …">`, with `aria-hidden="true"` and
  `focusable="false"` when there is no `label`, and `role="img"` plus `aria-label={label}` when there is one. Strokes
  use `stroke="currentColor"`, width 2, round caps and joins, `fill="none"`. `caret-up`, `caret-down`, `play`, `pause`,
  `rewind` and `forward` use `fill="currentColor"` and no stroke.

- [ ] **Step 1: Write the failing tests in `src/ui/icons.test.tsx`.**
  - `it('draws every icon on the 24 grid at the size of its text')`: for each name in `ICON_NAMES`, the markup
    contains `viewBox="0 0 24 24"`, `width="1em"` and at least one `<path`, `<polyline`, `<line`, `<rect` or `<polygon`.
  - `it('hides a decorative icon and names one that carries meaning')`: `<Icon name="close" />` contains
    `aria-hidden="true"` and no `role=`. `<Icon name="caret-up" label="Up 3" />` contains `role="img"` and
    `aria-label="Up 3"`, and no `aria-hidden`.
  - `it('draws in the colour of its text, so dark mode follows')` (review focus 2): the source of `icons.tsx` has no
    `#` followed by three to eight hex digits and no `rgb(`.
- [ ] **Step 2: Run them.** `npx vitest run src/ui/icons.test.tsx`. Expected: FAIL, "Cannot find module './icons'".
- [ ] **Step 3: Write `src/ui/icons.tsx`** with the interface above. Draw each shape simply, with 2px strokes and about
      2px of margin inside the grid. Add `.icon { display: inline-block; vertical-align: -0.125em; flex: none; }` to
      `styles.css`.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Write the failing contract test** in `ui.test.ts`, in `describe('screen contract')`:
      `it('draws icons only through Icon')`. It scans every non-test `.ts`/`.tsx` under `src/ui` (recursively, with
      `components.tsx` included, `icons.tsx` excluded) for any of `▲ ▼ ▴ ▾ ▸ ▶ ◀ ❚ ✕ ✎ ✓ ‹ › ← ↑ ↓ ↗ ↘`. It skips comment
      lines (trimmed lines starting with `//`, `*` or `/*`) and an allow-list of `[file, substring, reason]` entries.
      It starts with exactly two: `mail.tsx` `/^(.*?)\s*([▲▼])(\d+)$/` and `mail.tsx` `=== '▲'`, both "reads the
      engine's change marks". It also fails when `styles.css` has a `content:` holding one of those characters. Its
      expectation lists `file:line` for each hit.
- [ ] **Step 6: Run it.** `npx vitest run src/ui/ui.test.ts -t "draws icons only through Icon"`. Expected: FAIL,
      listing the spec table's sites plus `Roster.tsx:695` and the two CSS rules.
- [ ] **Step 7: Swap each site for `Icon`.**
  - Keep each button's existing `aria-label`. Add one where a button holds only an icon and has none: the Schedule's
    week arrows ("Previous week", "Next week"), the strip's arrows, the viewer's transport ("Back a play", "Play",
    "Pause", "Forward a play"), and the edit pencils ("Edit name").
  - Folds: render `<Icon name="chevron-down" className="fold-mark" />` where the glyph was, and turn it with CSS
    (`details:not([open]) .fold-mark { transform: rotate(-90deg) }`), as `.card-section` does today. In `Section`
    (`components.tsx`), put the icon in the `summary` in place of the `::after` rule, and delete that rule.
  - The offseason stepper: render `<Icon name="check" />` in each done step (`Home.tsx:553`) and delete the
    `content: '✓ '` rule.
  - `Draft.tsx:176`: render the caret inline in the sentence. `Draft.tsx:710` and `mail.tsx:3477`: draw `caret-up` or
    `caret-down` with the number beside it.
  - The Roster tooltip becomes "Drag to reorder, or use the arrow keys".
- [ ] **Step 8: Write the screen-reader test** (review focus 3): `it('names every button that holds only an icon')`.
      A `<button …>` whose only child is `<Icon … />` (whitespace allowed) must carry `aria-label=` in its attributes.
      Same file set as Step 5.
- [ ] **Step 9: Run** `npx vitest run src/ui/ui.test.ts src/ui/icons.test.tsx` and every test file that renders a
      changed component (`npx vitest run src/ui` is fine, about a minute). Then `npm run typecheck`. Expected: all
      pass. A test that matched a glyph in markup ("▶ Watch replay") is updated to the new markup, not loosened.
- [ ] **Step 10: Format, commit** ("Icons: one SVG set replaces the characters"), **and push.**
- [ ] **Step 11: Checkpoint.** Before: `0-baseline`. After: `--routes '#/,#/inbox,#/schedule,#/game/78,#/office/coaches'`
      into `.check/ui-review/1-icons`, with `--before .check/ui-review/0-baseline`. Also shoot `#/watch/78` (the
      viewer's transport) and `#/office/draft` from `draft.json` (the stepper and the board's carets). Wait.

### Task 2: Links to another screen

**Files:** modify `src/ui/components.tsx`, `src/styles.css`, `src/ui/ui.test.ts` and the sweep sites below.

**Interfaces:**

- Consumes: `Icon` (Task 1), `useNav` from `./nav`, `Route` from `./routes`.
- Produces: `export function MoreLink(props: { to?: Route; onClick?: () => void; children: ReactNode }): JSX.Element`,
  a `<button type="button" className="more-link">` that calls `nav.go(to)` when `to` is given, else `onClick`, with
  `<Icon name="chevron-right" />` after the children.

- [ ] **Step 1: Write the failing contract test** in `ui.test.ts`: `it('goes to another screen through MoreLink')`.
      Over every non-test `.tsx` in `src/ui` (recursively), fail on a `<button` whose `className="btn…"` doesn't hold
      `btn-primary` and whose `onClick={() => nav.go(`, `nav.openGame(` or `nav.watchGame(` is a one-expression
      arrow, in either attribute order. The failure message names `MoreLink`. In the same test, assert that
      `styles.css`'s `.more-link` rule sets `min-height` to 32px or more (review focus 1).
- [ ] **Step 2: Run it.** Expected: FAIL, listing at least `mail.tsx:503, 519, 1116, 2330, 2333`,
      `FrontOffice.tsx:605, 619`, `Home.tsx:164, 201, 247, 301, 385, 434, 614, 651`, `LiveGame.tsx:65`, `widgets.tsx:494,
      552`, plus the missing `.more-link` rule.
- [ ] **Step 3: Write `MoreLink`** in `components.tsx`, and `.more-link` in `styles.css` next to `.linklike`: no border
      or background, `font-size: var(--step--1)`, `font-weight: 700`, `color: var(--ink)`, `min-height: 32px`,
      inline-flex with a 4px gap, underline on hover (`text-decoration-color` as `.linklike` does), and the global
      focus ring.
- [ ] **Step 4: Sweep.** Replace every hit, plus the underlined "See all 7", "See all in Inbox" and
      `offers.tsx:416`'s "See their offer →" (the arrow goes, the chevron replaces it), and other handlers the rule
      fits that the regex can't see.
  - Where a link is the main thing to do in its panel, make it `btn-primary` instead, and list it in the checkpoint
    for the owner to confirm. "Prepare game-day roster" (`Home.tsx:164`) is the likely one.
  - `LiveGame.tsx:65` "Back to Home" becomes `<MoreLink to={{ view: 'home' }}>Home</MoreLink>`.
- [ ] **Step 5: Run** `npx vitest run src/ui` and `npm run typecheck`. Expected: all pass. A test asserting the old
      button markup in a letter (`mail.test.tsx`) is updated to the new markup.
- [ ] **Step 6: Copy check.** `npm run copy`, then read the changed link labels in `.check/copy.txt`.
- [ ] **Step 7: Format, commit** ("Links: one look for going to another screen"), **and push.**
- [ ] **Step 8: Checkpoint.** `--routes '#/,#/inbox,#/office/coaches'` into `2-links` against the Task 1 "after"
      folder. Also shoot one game recap letter with `--mail <prefix>`, taking the recap's id prefix from `inbox.ts`.
      Wait.

### Task 3: Labels and text sizes

**Files:** modify `src/styles.css` and `src/ui/ui.test.ts`.

**Interfaces:**

- Produces: `--step--2: 0.6875rem` in `:root`, and two shared label rules. Rule A's selector list starts with
  `.eyebrow` (`--step--1`, letter spacing 0.08em, unchanged from today). Rule B's starts with `.eyebrow-sm`
  (`--step--2`, 0.06em). Both are uppercase, weight 700 and `var(--muted)`.

- [ ] **Step 1: Write the failing contract test** in `ui.test.ts`: `it('sizes app text from the scale, and writes the
      label once')`. Strip CSS comments from `styles.css`, then match innermost rules with
      `/([^{}]+)\{([^{}]*)\}/g`. A rule is exempt when every selector in its comma list starts with one of the closed
      `EXEMPT` prefixes, a constant in the test with a comment on each line. Seed it with `.ed-`, `.vb-`, `.vc-`,
      `.tl-`, `.rail-`, `.pg-`, `.mc-`, `.mb-`, `.mp-`, `.bug-`, `.endzone`, `.chart`, `.dev-chart`, `.dev-tip`, plus
      the other classes the game viewer's files use (`GameViewer`, `LiveGame`, `GamePanels`, `GameTimeline`,
      `Scorebug`, `PregameCard`, `GameMoments`, `BroadcastField`, `TopDownField`: grep their `className`s once and add
      the CSS prefixes they own, such as `.cmp-`, `.lead-`, `.line-row`, `.game-injuries`). Fail on:
  - a non-exempt `font-size` whose value is a number with `rem`, `em` or `px`, except `16px`, `inherit` or
    `clamp(…)`;
  - a non-exempt `text-transform: uppercase` in a rule that isn't Rule A or Rule B.
- [ ] **Step 2: Run it.** Expected: FAIL, listing about 30 rules, `th`, `.tag-pill`, `.chip`, `.mail-av`,
      `.seg-sm button`, `.risk-word`, `.report-title` and `.room-card h4` among them.
- [ ] **Step 3: Add the token and the two rules.** Then move each listed rule onto the scale by the spec's mapping (up
      to 0.72rem goes to `--step--2`, 0.75–0.88rem to `--step--1`, 0.9–1.05rem to `--step-0`, 1.1–1.2rem to
      `--step-1`). An `em` size inside a larger heading (`.rookie-mark`, `.sheet-head .rookie-mark`) goes on the
      `EXEMPT` list with the comment "sized to its heading", not onto the scale.
  - Each uppercase label's selector joins Rule A or Rule B by its current size (up to 0.72rem joins B, larger joins
    A). Its own rule keeps only what isn't size, tracking, weight, case or colour.
  - Pills keep their background and colours in their own rules.
  - The seven `.x .eyebrow` overrides drop any `font-size` or `letter-spacing`.
- [ ] **Step 4: Run it, and every UI test.** `npx vitest run src/ui` and `npm run typecheck`. Expected: all pass.
- [ ] **Step 5: Format, commit** ("Type: labels and sizes from one scale"), **and push.**
- [ ] **Step 6: Checkpoint.** This task changes the most screens at once, so shoot every baseline route into
      `3-type`, light and dark, against Task 2's "after" (re-shoot any route Task 2 didn't). Call out in the message
      any screen where a size visibly changed (table headers and pills move by under 1px, chips by about 1px). Wait.

### Task 4: The screen's name, and the bar for screens with views

**Files:** modify `src/ui/routes.ts`, `src/ui/App.tsx`, `src/ui/components.tsx`, `src/ui/screens/FrontOffice.tsx`,
`src/ui/screens/Stats.tsx`, `src/ui/screens/TeamStats.tsx`, `src/styles.css` and `src/ui/ui.test.ts`.

**Interfaces:**

- Produces: `export const SCREEN_NAMES: Record<Route['view'], string>` in `routes.ts`: the top bar's labels (`Home`,
  `Roster`, `Cap`, `Locker Room`, `Inbox`, `Front office`, `Schedule`, `Standings`, `Stats`, `Playoffs`), plus
  `compare: 'Compare players'`, `game: 'Box score'`, `watch: 'Replay'`, `live: 'Live game'`. `TABS` in `App.tsx`
  takes its labels from it.
- Produces: `export function PageHeader(props: { tabs?: ReactNode; aside?: ReactNode }): JSX.Element` in
  `components.tsx`. It draws `<div className="row page-bar">{tabs}{aside && <div className="page-bar-aside">{aside}</div>}</div>`.
  `.page-bar` takes over `.office-bar`'s rules plus `justify-content: space-between`, and `.office-bar` is deleted.
- Changes: `TeamStats` becomes `({ league, season }: { league: League; season: number })`. `Awards` becomes
  `({ league, season }: { league: League; season: number | undefined })` and keeps its "No awards yet." panel.

- [ ] **Step 1: Write the failing tests.**
  - In `describe('routes')`: `it('names every screen')`. Every `view` in the `Route` union has a non-empty
    `SCREEN_NAMES` entry, and `SCREEN_NAMES.locker === 'Locker Room'`.
  - In `describe('screen contract')`: `it('starts a screen one way')`. No non-test `.tsx` in `src/ui` holds `<h1`
    except `App.tsx` (once, with `className="visually-hidden"`) and `screens/NewGame.tsx`. No file but
    `components.tsx` holds `office-bar` or `page-bar`.
  - In a new `src/ui/statsHeader.test.tsx`, rendering `Stats` with `renderToStaticMarkup` in a `NavContext` (as
    `belief.test.tsx` does) on `createLeague({ seed: 'stats-head' })` with no games played (review focus 5):
    `tab="leaders"` contains "Stats appear once the first week is played." and no `<select`. `tab="awards"` contains
    "No awards yet." and no `aria-label="Awards season"`. After one `playWeek`: `tab="leaders"` has its season picker
    inside `page-bar-aside`, and its markup has no "league leaders" heading.
- [ ] **Step 2: Run them.** Expected: FAIL (`SCREEN_NAMES` missing, the `<h1>` in `LockerRoom.tsx`, `office-bar` in two
      screens, the "league leaders" heading).
- [ ] **Step 3: `SCREEN_NAMES` and the hidden `h1`.** In `App.tsx`, inside `<main className="wrap">` and before
      `TabBoundary`, render `<h1 className="visually-hidden">{SCREEN_NAMES[route.view]}</h1>`. `TabBoundary`'s `name`
      reads `SCREEN_NAMES` too. Remove the Locker Room's `<h1>` and its `<p className="muted">The way our coaches see
      it.</p>` now. Task 5 rebuilds the rest of the screen.
- [ ] **Step 4: `PageHeader` on Front office.** The caller still renders its own tablist element, with its `ref={bar}`,
      `role`, `aria-label` and buttons unchanged, passed as `tabs`. The season and phase line is the `aside`.
- [ ] **Step 5: `PageHeader` on Stats.**
  - `Stats` holds the Awards season state (moved from `Awards`, with the same default, the newest season with awards)
    and the Team stats season state (moved from `TeamStats`, default `resultsSeason(league)`).
  - The aside, by tab: Leaders and Player stats show `ScopeSelect` (as today). Team stats shows its `Season` select
    when `teamStatSeasons(league).length > 1`. Awards shows the `Awards season` select when there are seasons.
    Records shows the text "Single season". Officials shows nothing.
  - Headings: delete Leaders' `<h2>` (`Stats.tsx:133`), Awards' `<h2>` and its row (`:336`), and Records' `<h2>`
    (`:433`). The Player stats panel's title becomes the table's label alone ("Passing"). The Team stats panel loses
    its title, keeping its action and its "Regular season." line. "Officiating crews" stays.
- [ ] **Step 6: Run** `npx vitest run src/ui` and `npm run typecheck`. Expected: all pass. A test asserting a deleted
      heading is updated.
- [ ] **Step 7: Copy check, format, commit** ("Screens: one way to start a screen"), **and push.**
- [ ] **Step 8: Checkpoint.** All six Stats tabs, `#/office/coaches`, `#/office/fa` and `#/locker` into `4-header`,
      desktop and phone, against the latest "after". Note that the Locker Room has only lost its heading so far. Wait.

### Task 5: The Locker Room

**Files:** modify `src/ui/screens/LockerRoom.tsx` and `src/styles.css`. Create `src/ui/lockerRoom.test.tsx`.

**Interfaces:**

- Consumes: `Panel` from `components.tsx`, and the hidden `h1` from Task 4.
- Produces: `export function splitRooms<C extends { trouble: boolean; follows: unknown[]; deal: unknown[]; ties: unknown[] }>(cards: C[]): { big: C[]; quiet: C[] }`
  in `LockerRoom.tsx`. A card is quiet when `!trouble` and `follows`, `deal` and `ties` are all empty. Each group keeps
  the input's order.

- [ ] **Step 1: Write the failing tests in `src/ui/lockerRoom.test.tsx`.**
  - `it('keeps a room in trouble or with something to show among the big cards')`: `splitRooms` on five hand-made
    cards (one in trouble with empty lists, one with a follower, one with a deal, one with a tie, one empty) gives
    four big cards and one quiet card, each group in input order.
  - `it('lays the screen out in panels: Morale, then The rooms with the captains first')`: render `LockerRoom` (as
    `belief.test.tsx` does) on `createLeague({ seed: 'locker-layout', personnel: true })` after two `playWeek`s. The
    markup has no `card-section`, has two `class="panel` sections whose `h2` reads "Morale" and "The rooms" in that
    order, and has `captains-row` before the first `room-card`. When the split gives quiet rooms, they sit inside a
    `room-cards-quiet` element.
  - `it('says the early lines in a new league')` (review focus 4): on a fresh `createLeague({ seed: 'locker-new' })`
    with no week played, the markup has "Captains are named when camp opens." when the team has no captains this
    season, and either the unhappy list or "Nobody is down right now.".
  - `it('drops the folds and the heading')`: no `<h1` and no "The way our coaches see it.".
- [ ] **Step 2: Run them.** `npx vitest run src/ui/lockerRoom.test.tsx`. Expected: FAIL (`splitRooms` missing,
      `card-section` present).
- [ ] **Step 3: Rebuild the screen** to the spec's "The Locker Room (option A)".
  - Morale, Disputes and The rooms become `Panel`s. Disputes stays where it is, between Morale and The rooms.
  - The rooms' `action`: the mentoring checkbox and the team `RoomAsk`.
  - In the rooms panel's body, in order: the meeting banners, then
    `<div className="captains-row">`, then `<div className="room-cards">` with the big cards, then
    `<div className="room-cards room-cards-quiet">` with the quiet ones. Leave out the quiet element when it is empty.
  - No sentence changes.
- [ ] **Step 4: CSS.**
  - `.morale-board`: one column, `minmax(0,1fr) minmax(0,1fr)` from 900px (The room, then Needs a word with Flying
    under it), and three equal columns from 1100px (The room | Needs a word | Flying with Promises).
  - Split today's single second `.morale-card` into two cards, so the three columns are three cards. On a phone they
    stack in today's order.
  - `.room-cards { align-items: start }`, and `.room-cards-quiet { grid-template-columns: repeat(auto-fill,
    minmax(min(100%, 260px), 1fr)) }`.
  - `.captains-row`: inline-flex wrap with a 6px 18px gap. Its label uses `.eyebrow`.
  - Add a CSS assertion to the Step 1 file: the 1100px rule gives `.morale-board` three columns and nothing below
    900px does (review focus 1).
- [ ] **Step 5: Run** `npx vitest run src/ui/lockerRoom.test.tsx` and the existing Locker Room tests
      (`dispute`, `belief`, `chemistry`, `meetings`, `morale`, `character`), then `npm run typecheck`. Expected: all
      pass, with no existing assertion loosened.
- [ ] **Step 6: Format, commit** ("Locker Room: panels, three columns, quiet rooms small"), **and push.**
- [ ] **Step 7: Checkpoint.** `#/locker` into `5-locker` against `0-baseline`: desktop, phone and dark. Also one run
      with `--width 1000` (the two-column morale layout). Wait.

### Task 6: Docs, version and the whole-branch review

**Files:** modify `docs/UI.md`, `CLAUDE.md`, `package.json` and `src/ui/changelog.ts`.

- [ ] **Step 1: `docs/UI.md`.**
  - Add four sections from the spec: "The top of a screen", "Labels and text sizes", "Icons", "Links to another
    screen". Each is a few rules naming the component or class to use.
  - Remove "Heading levels vary between screens." from "Not consistent yet".
- [ ] **Step 2: `CLAUDE.md`.** In the `src/ui/` paragraph, name the hidden `h1`, `PageHeader`, `Icon` and `MoreLink`
      beside `PlayerLink`/`TeamLink`.
- [ ] **Step 3: Version.** Bump `package.json`'s patch from whatever `main` has (0.4.42 gives 0.4.43). Add a
      `changelog.ts` entry, newest first, with today's date. Proposed title: "A cleaner look on every screen" (31
      characters). Proposed text: "Icons, labels and links look the same on every screen, and the Locker Room uses a
      big screen properly." (about 105 characters). The changelog test holds the limits.
- [ ] **Step 4: Run** `npx vitest run src/ui` and `npm run typecheck && npm run format:check`. Expected: pass.
- [ ] **Step 5: Commit** ("Docs: the shared screen pieces; version 0.4.43") **and push.**
- [ ] **Step 6: Whole-branch review.** Dispatch one fresh reviewer (Sonnet, per CLAUDE.md) on `git diff origin/main...HEAD`
      with the spec, asking for correctness bugs and spec gaps only. Fix what it confirms, commit and push.
- [ ] **Step 7: Final checkpoint.** A short summary of all six tasks, the review's findings and fixes, and the final
      side-by-side of Home, Locker Room and Stats against `0-baseline`. Ask the owner whether to open the pull request
      (CI then runs the checks the change calls for). Wait.
