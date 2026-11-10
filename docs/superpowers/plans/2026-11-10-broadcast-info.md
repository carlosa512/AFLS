# The broadcast, with more to read — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Around the field as it is, the game viewer shows records, timeouts and the down in the scorebug, a drive
timeline in place of the slider, and two panels (the game, the players) read from the play log.

**Architecture:** One pure reader, `src/ui/gameRead.ts`, turns a play log and an index into everything the new
chrome shows, so the live game and the replay share it. Three new components (`Scorebug`, `GameTimeline`,
`GamePanels`) are used by `GameViewer.tsx` and `LiveGame.tsx`, which keep their own state. Styles go in
`src/styles.css` beside the viewer's.

**Tech Stack:** TypeScript, React, Vitest (`renderToStaticMarkup` for components), plain CSS.

**Spec:** `docs/superpowers/specs/2026-11-10-broadcast-info-design.md` (approved Nov 10; binding).

## Global Constraints

- **Screens only.** No file under `src/engine/` changes. Nothing is added to `League`, `GameResult` or
  `PlayLogEntry`. No `SAVE_VERSION` bump. No tuning number moves.
- **Exact or absent.** A number is shown only if, at a game's last play, the reader's value equals the box score
  (`GameResult.home`, `.away`, `.playerStats`). A row or category that fails the equality test is removed from the
  panel, not approximated. Possession is already out.
- **Nothing ahead of the picture.** The scorebug and panels read through the play on screen (`told ? index : index
  - 1`). Only the replay's timeline draws later drives.
- **Names through `PlayerLink`** (`short`), teams through `TeamChip`/abbreviations as the viewer does today. No
  rating, range or hidden trait on the screen.
- **`--marker` (yellow) only for** the down pill, the last result, the playhead and Play.
- **Labels are the box score's:** `First downs`, `Total yards`, `Passing`, `Rushing`, `3rd down`, `Turnovers`,
  `Injuries`.
- **One pull request.** Version `0.4.25` → `0.4.26` with one changelog entry (title ≤ 40 characters, text ≤ 200).
- **Checks:** `npm run typecheck`, the tests touched, `npm run format`. No sims, no `npm run check`.
- `id="viewer-scrub"` stays a focusable range input in the replay (`scripts/screens.ts` drives it).

## Review Focus

1. **A game kept before player ids were logged (pre-v71, no `who`).** The panels must show team numbers and leave
   out player lines they can't attribute, never crash or show zeros. Test in Task 1 (`linesAt` on entries with no
   `who`) and Task 4 (panel renders with an empty map).
2. **Overtime.** Five sections on the timeline, timeouts reset to 2, a fifth quarter column only when a point or a
   play happened in it. Tests in Task 1 (`quartersAt`, `timeoutsAt`) and Task 3 (fifth section).
3. **The first play of a game (index 0, nothing told yet).** Scorebug 0–0 with three timeouts each, empty panels
   with no "undefined", a timeline with no drive. Test in Task 4 (render at index 0, untold).
4. **Two players sharing a play name ("J.Smith").** A line must not be given to the wrong man: attribute by id from
   `who`, and by text only when `usePlayNames` has the name unique. Test in Task 1.
5. **A narrow window.** Panels become tabs, and the play log is one of them; the field keeps the full width. Test
   in Task 4 (markup carries the tab group and all three regions), plus the look at 390px in Task 5.

---

### Task 1: The reader

**Files:**
- Create: `src/ui/gameRead.ts`
- Test: `src/ui/gameRead.test.ts`

**Interfaces:**
- Consumes: `PlayLogEntry`, `GameResult`, `League`, `Team` (`engine/types`); `actorsIn` (`engine/playActors`);
  `fumbleIn` (`engine/field/fumble`); `asRan` (`engine/field/stage`); `PlayNames` (`screens/GameViewer`).
- Produces:

```ts
export const gameSeconds = (e: Pick<PlayLogEntry, 'quarter' | 'clock'>): number; // 0 at kickoff, 900 a quarter, OT after 3600
export function quartersAt(plays: readonly PlayLogEntry[], index: number): { home: number[]; away: number[] };
export function timeoutsAt(plays: readonly PlayLogEntry[], index: number, home: Team, away: Team): { home: number; away: number };
export type DriveEnd = 'td' | 'fg' | 'missed' | 'punt' | 'int' | 'fumble' | 'downs' | 'safety' | 'half' | 'end' | 'on';
export interface Drive { teamId: number; first: number; last: number; start: number; end: number; from: number; snaps: number; yards: number; how: DriveEnd; }
export function drivesOf(plays: readonly PlayLogEntry[], homeId: number): Drive[];
export interface RunningTeam { totalYds: number; passYds: number; rushYds: number; firstDowns: number; thirdDownAtt: number; thirdDownConv: number; turnovers: number; }
export function teamStatsAt(plays: readonly PlayLogEntry[], index: number, homeId: number): { home: RunningTeam; away: RunningTeam };
export interface RunningLine { passAtt?: number; passCmp?: number; passYds?: number; passTd?: number; passInt?: number; rushAtt?: number; rushYds?: number; rushTd?: number; rec?: number; recYds?: number; recTd?: number; tackles?: number; sacks?: number; }
export function linesAt(plays: readonly PlayLogEntry[], index: number, homeId: number, names: PlayNames): Map<number, RunningLine>;
export interface LogInjury { index: number; playerId?: number; teamAbbrev: string; text: string; quarter: number; clock: number; }
export function injuriesAt(plays: readonly PlayLogEntry[], index: number, names: PlayNames): LogInjury[];
export function recordBefore(league: League, teamId: number, game: Game): { w: number; l: number; t: number };
/** Which RunningTeam and RunningLine keys passed the equality test and may be shown. */
export const SHOWN_TEAM: readonly (keyof RunningTeam)[];
export const SHOWN_LINE: readonly (keyof RunningLine)[];
```

  `index` of `-1` means nothing told yet: zeros, three timeouts, no lines.

- [ ] **Step 1: Write the failing equality test.** `gameRead.test.ts`: build `createLeague({ seed })` and
  `playWeek` for seeds `'read-a'`, `'read-b'`, `'read-c'` (48 kept games). For every kept game and both sides,
  `teamStatsAt(plays, plays.length - 1, homeId)` equals the box score for each key in `SHOWN_TEAM`; for every
  player in `result.playerStats`, `linesAt(...)` equals his `StatLine` for each key in `SHOWN_LINE` (absent = 0).
  `quartersAt` at the last play equals `result.quarters` (an empty overtime quarter dropped from both).
- [ ] **Step 2: Run it, see it fail.** `npx vitest run src/ui/gameRead.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement the reader.** What the engine counts, as found by the probes:
  - passing: `pass`/`incomplete`/`int` are attempts, `pass` a completion; passing yards add completions and sacks
    (a sack's loss comes off); rushing: `run`, `scramble`, `kneel`; a gain is `(end − from)` toward the offense's
    goal, `end` being `fumbleIn(e).x` on a lost fumble, else `to`;
  - a `Two-point try: …` entry counts for nothing; a wiped snap (`kind: 'penalty'`) counts for nothing;
  - third-down tries: `down === 3` on run, scramble, pass, incomplete, int, sack, kneel, spike;
  - third-down conversions and first downs: read the next snap of the same possession (a first down with a new line
    to gain), plus touchdowns from scrimmage; an automatic first down by penalty reads the same way;
  - turnovers: `int` plus lost fumbles.
  Start with every key in `SHOWN_TEAM`/`SHOWN_LINE`; **remove a key the equality test cannot pass after a fair
  try**, and say which in the PR body. `tackles` and `sacks` are the likeliest to go.
- [ ] **Step 4: Unit tests for the rest**, each on hand-built entries in the style of `highlights.test.ts`
  (`entry({...})`):
  - `timeoutsAt`: `Timeout BUF (2 left).` leaves BUF 2; both back to 3 at the first Q3 entry; 2 each at the first
    overtime entry; `-1` gives 3 and 3.
  - `drivesOf`: a touchdown drive (`how: 'td'`, `snaps`, `yards`), a missed kick (`'missed'`), a made one (`'fg'`),
    a punt, a pick, a fumble lost, a turnover on downs, a safety, a drive the half ends (`'half'`), the game's last
    drive (`'end'`), a drive still going at the log's end in a live game (`'on'`), a drive across a quarter (one
    drive, `start < 900 < end`).
  - `linesAt` with no `who` on any entry returns an empty map; two players with the same play name get no line by
    text.
  - `injuriesAt`: `Injury: BUF RB D.Grimes (back spasms) is out for the game.` at Q4 9:08 appears only from that
    index on.
  - `recordBefore`: a week-3 game opened later counts only weeks 1 and 2.
- [ ] **Step 5: Run all of `gameRead.test.ts`** → PASS. `npm run typecheck` → clean.
- [ ] **Step 6: Commit** (`gameRead: a game read from its play log`).

### Task 2: The scorebug and the down pill

**Files:**
- Create: `src/ui/screens/Scorebug.tsx`
- Modify: `src/ui/screens/GameViewer.tsx` (the `.viewer-bug` block and `.viewer-sit`), `src/ui/screens/LiveGame.tsx`
  (the same two blocks), `src/styles.css` (after `.vb-clock`)
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Consumes: `timeoutsAt`, `recordBefore` (Task 1); `situation` (`GameViewer.tsx`).
- Produces:

```tsx
export function Scorebug(props: {
  league: League; game: Game; home: Team; away: Team;
  plays: readonly PlayLogEntry[];
  /** The play on screen. */ index: number;
  /** Its result has been shown: the score and timeouts through it, else through the one before. */ told: boolean;
  live?: boolean; final?: boolean; label: string;
}): JSX.Element;
/** `2ND & 10` and `Ball on NO 17` from an entry; null between snaps. */
export function downParts(e: PlayLogEntry, home: Team, away: Team): { down: string; spot: string } | null;
```

- [ ] **Step 1: Failing tests** in `viewer.test.tsx`: the replay's markup at index 0 contains each team's record
  (`0–0` in week 1) and `aria-label="3 timeouts left"` twice; after a `Timeout` entry is told, that side reads
  `2 timeouts left`; a snap's bar contains `class="vb-down"` with `1ST &amp; 10`; an untold scoring play still shows
  the score before it.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement `Scorebug` and `downParts`,** use them in both screens (the live dot, `Final/OT` and the
  possession dot behave as today), and add the styles: `.vb-sub`, `.vb-tos` (white pips, a used one at 25%),
  `.vb-down` (the `--marker` pill). The possession dot becomes white.
- [ ] **Step 4: Run** `npx vitest run src/ui/viewer.test.tsx src/ui/live.test.ts` → PASS; typecheck clean.
- [ ] **Step 5: Commit** (`Scorebug: records, timeouts and the down`).

### Task 3: The timeline

**Files:**
- Create: `src/ui/screens/GameTimeline.tsx`
- Modify: `GameViewer.tsx` and `LiveGame.tsx` (the `.viewer-controls` block, the top row), `src/styles.css`
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Consumes: `drivesOf`, `gameSeconds`, `Drive` (Task 1); `readableOn` (`ui/color.ts`).
- Produces:

```tsx
export function GameTimeline(props: {
  home: Team; away: Team; plays: readonly PlayLogEntry[];
  /** The play on screen, and whether its result has been shown. */ index: number; told: boolean;
  /** A replay draws the whole game and can be clicked; a live game draws only what's been shown. */
  replay: boolean;
  /** Replay only: jump to a play. */ onJump?: (index: number) => void;
  /** Previous, Play, Next (the screen's own buttons). */ transport: ReactNode;
  /** Speed and highlights. */ settings: ReactNode;
}): JSX.Element;
/** The caption for a drive: "Buffalo drive · 12 plays · 71 yds · 6:24", or its start and how it ended. */
export function driveCaption(d: Drive, team: Team, plays: readonly PlayLogEntry[], current: boolean): string;
```

  Width of the track in game seconds: 3600, plus the overtime played (to the last entry's `gameSeconds`). Drives are
  `<button class="tl-drive">` positioned by percentage; marks are `tl-mark score` (td, fg) and `tl-mark miss`
  (missed, int, fumble, downs). A team's bar colour is `readableOn('#0b1210', colors[0])`, falling back to
  `colors[1]`.

- [ ] **Step 1: Failing tests:** a live timeline at a mid-game index renders no `.tl-drive` whose first play is
  past the index and no mark past it; the same index in a replay renders every drive, later ones with class
  `later`; an overtime game renders five `.tl-q`; the replay still contains `id="viewer-scrub"` with
  `max={plays.length - 1}`; `driveCaption` for a touchdown drive ends with the scorer's play label.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.** In the replay, a pointer down or drag on the track maps x → game seconds → the nearest
  play at or before that clock (`onJump`); a click on a drive jumps to `drive.first`. The range input stays, visually
  hidden (`.sr-only`-style, still focusable), so arrow keys and `scripts/screens.ts` work as today. Move
  *Broadcast | All-22* to the row with *Box score* in the replay and to the right end of the scorebug row's top in
  the live game (a `.viewer-top` row above the viewer). Speed and highlights use a grey `seg` look
  (`.vc-level.on` no longer yellow on this screen). `Sim to final` stays in the live game's settings.
- [ ] **Step 4: Run** `npx vitest run src/ui/viewer.test.tsx` → PASS; typecheck clean.
- [ ] **Step 5: Commit** (`A game timeline in place of the slider`).

### Task 4: The panels and the stage

**Files:**
- Create: `src/ui/screens/GamePanels.tsx`
- Modify: `GameViewer.tsx`, `LiveGame.tsx`, `src/ui/viewerPrefs.ts` (two keys), `src/styles.css`
- Test: `src/ui/viewer.test.tsx`, `src/ui/viewerPrefs.test.ts`

**Interfaces:**
- Consumes: `quartersAt`, `teamStatsAt`, `linesAt`, `injuriesAt`, `SHOWN_TEAM`, `SHOWN_LINE` (Task 1);
  `weatherAt`, `gameWeatherText` as `BoxScore.tsx` and `WeatherNote` use them; `estimateText`, `injuryLabel`.
- Produces:

```tsx
export const TAB_KEY = 'afls-viewer-tab';         // 'plays' | 'game' | 'players', default 'plays'
export const WHO_KEY = 'afls-viewer-who';         // 'leaders' | 'home' | 'away', default 'leaders'
export function GamePanel(props: { league: League; game: Game; home: Team; away: Team; plays: readonly PlayLogEntry[]; shown: number; names: PlayNames; result?: GameResult }): JSX.Element;
export function PlayersPanel(props: { league: League; home: Team; away: Team; plays: readonly PlayLogEntry[]; shown: number; names: PlayNames }): JSX.Element;
export function StageTabs(props: { value: StageTab; onChange: (t: StageTab) => void }): JSX.Element;
```

  `shown` is the last play whose result is on screen (`told ? index : index - 1`). Both screens wrap everything in
  `<div class="game-stage" data-tab={tab}>`: `GamePanel`, the `.viewer`, `StageTabs`, `PlayersPanel`, then the play
  log's `<section class="panel game-log">`.

  CSS: `.game-stage` is one column by default (viewer, tabs, then the region the tab names); at
  `min-width: 1280px` it is `232px minmax(760px, 1fr) 232px` with the log across all three, the tabs hidden and all
  regions shown. On the watch and live routes `main.wrap` may be 1320px (a class the two screens put on their
  root, e.g. `:has(.game-stage)` on `main.wrap`). `.viewer` loses `max-width: 760px` inside `.game-stage` on the
  wide layout and keeps it on the narrow one.

- [ ] **Step 1: Failing tests:** at a mid-game `shown`, the Game panel's `Total yards` row equals
  `teamStatsAt(...).home.totalYds`; no stat text for a row not in `SHOWN_TEAM`; an injury logged after `shown` is
  absent and one before it is present with a `PlayerLink`; `PlayersPanel` on `leaders` shows one man a team per
  category and every name is a `PlayerLink` button; at `shown = -1` neither panel contains `undefined` or `NaN`;
  the stage markup carries the three tab buttons, both panels and the log; `viewerPrefs` reads the two new keys
  with their defaults.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement** the panels (score by quarter with a dot for quarters not reached, the weather line,
  stat rows with the split bar, `Injuries` left out when empty; the `seg` toggle *Leaders · away · home* by
  abbreviation), the tabs and the CSS.
- [ ] **Step 4: Run** `npx vitest run src/ui/viewer.test.tsx src/ui/viewerPrefs.test.ts src/ui/ui.test.ts` → PASS;
  typecheck clean.
- [ ] **Step 5: Commit** (`Game and Players panels beside the field`).

### Task 5: Ship it

**Files:**
- Modify: `package.json` (version `0.4.26`), `src/ui/changelog.ts` (one entry, top), `CLAUDE.md` (one line under
  `src/ui/` naming `gameRead.ts`)

- [ ] **Step 1: Bump and write the entry.** Title `The broadcast tells you more`; text: `Watching a game now shows
  timeouts, records, a drive timeline you can jump around, and live team stats, leaders and injuries beside the
  field.`
- [ ] **Step 2: Run** `npx vitest run src/ui/changelog.test.ts src/ui/gameRead.test.ts src/ui/viewer.test.tsx
  src/ui/ui.test.ts src/ui/live.test.ts`, `npm run typecheck`, `npm run format` → all clean.
- [ ] **Step 3: Look at it.** Load a save with a played week in the dev build and shoot the replay at 1440px, 1180px
  and 390px, Broadcast and All-22, light and dark; and a live game mid-way. Fix what is off (overlap, a clipped
  label, yellow where it shouldn't be).
- [ ] **Step 4: Commit, push, open one pull request,** and read CI on it.
