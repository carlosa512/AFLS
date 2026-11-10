# The broadcast, part two: the field and the big moments — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams switch ends each quarter in both views; the broadcast field is painted and stands in a stadium with
the game's weather; and a score, a turnover, a flag, an injury, a big gain, the quarter, the half and the final
each get a graphic.

**Architecture:** Three pure helpers carry the decisions: `ui/stage/ends.ts` (where the stadium has a spot this
quarter), `ui/moments.ts` (what moment a play makes) and the readers part one built (`ui/gameRead.ts`). The
broadcast field moves to its own file and draws through a new paint module; All-22 keeps its paint and maps its men
through the same ends helper. One overlay component draws every moment over either view.

**Tech Stack:** TypeScript, React, Vitest (`renderToStaticMarkup`), plain CSS, SVG.

**Spec:** `docs/superpowers/specs/2026-11-10-broadcast-field-and-moments-design.md` (approved Nov 10; binding).
Part one's spec (`2026-11-10-broadcast-info-design.md`) describes the screen this builds on.

## Global Constraints

- **Screens only.** No file under `src/engine/` changes. Nothing is added to `League`, `GameResult`, `PlayLogEntry`
  or `FieldRecord`. No `SAVE_VERSION` bump. No tuning number moves.
- **Nothing ahead of the picture.** A moment appears only when its play's result has been shown (`told`), and its
  numbers count through that play.
- **The stadium stays put.** Paint is drawn the same in every quarter. Nothing is mirrored by an SVG transform (it
  would mirror text): positions go through `stadiumSpot`.
- **Yellow (`--marker`) only for** the down pill, the last result, the playhead, Play, and a flag's `FLAG` block.
  The SNN mark is white.
- **Names** on a player's line through `PlayerLink`. No rating, range or hidden trait on the screen. No player
  name drawn on the field.
- **Everything that moves stops under `prefers-reduced-motion`.** No `Math.random`: a fixed pattern or the game's
  seeded `Rng`.
- **Words** follow `docs/UI.md` "Words on a screen". Run `npm run copy` after adding them.
- **Checks:** `npm run typecheck`, the tests touched, `npm run format`. No sims, no `npm run check`.
- **No pull request** until the owner asks. Commits go to `claude/modest-keller-viipnh`. Version `0.4.27` →
  `0.4.28`, one changelog entry (title ≤ 40 characters, text ≤ 200).
- **Owner's gate:** this plan is not approval to build. Implementation starts only when the owner says so.

## Review Focus

1. **A change of possession on the first play of a new quarter, in All-22 upright.** The field turns for the ball
   and the ends switch at once. The offense must still attack up the screen, toward the other painted end zone.
   Test in Task 3.
2. **A man coming on, the trainers and a celebrating sideline after the switch.** They must still come from their
   own bench on screen (home near, away far). Test in Task 3.
3. **Overtime and a game with no third quarter shown** (a highlight level that skips to the fourth). The ends are
   read from the play's own quarter, never counted from what was shown. Test in Task 1 and Task 4.
4. **A halftime reached by *Sim to final*, by scrubbing past it, or with the highlight level skipping the last play
   of the half.** No card may trap the screen: the live wait happens only when play reaches the half by playing.
   Test in Task 10.
5. **A game kept before the field record (no `who`, no `jerseys`).** Banners still show from the log's words; the
   player's line is left out rather than shown without a number or a name. Test in Task 8.

---

### Task 1: Which end is which

**Files:**
- Create: `src/ui/stage/ends.ts`
- Test: `src/ui/stage/ends.test.ts`

**Interfaces:**
- Produces:

```ts
export function endsSwitched(quarter: number): boolean;                       // quarter % 2 === 0
export function stadiumSpot(x: number, y: number, quarter: number): { x: number; y: number }; // half-turn about (50, FIELD_W / 2) when switched
```

- [ ] **Step 1: Failing tests:** quarters 1 and 3 are not switched, 2 and 4 are, overtime 5 is not and 6 is;
  `stadiumSpot(50, FIELD_W / 2, 2)` is itself; applying it twice in a switched quarter returns the spot;
  `stadiumSpot(100, 10, 2)` is `{ x: 0, y: FIELD_W - 10 }`; in quarter 1 it returns its input.
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/ends.test.ts` → FAIL (module missing).
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS. **Step 5: Commit** (`Ends: which way a team attacks each quarter`).

### Task 2: The home club's two end zones

**Files:**
- Modify: `src/ui/screens/FieldPaint.tsx`, `src/ui/screens/TopDownField.tsx` (pass `neutral`)
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Produces: `FieldPaint({ home, away, neutral }: { home: Team; away: Team; neutral?: boolean })`; and exported for
  Task 5: `GREENS`, `POSTS`, `TEAM_AREA`, and

```ts
/** What each end zone reads and its colours: [the one at x < 0, the one at x > 100]. */
export function endZones(home: Team, away: Team, neutral?: boolean): [EndZone, EndZone];
export interface EndZone { text: string; fill: string; stroke: string }
```

  At a home game: `[home nickname, home city]`, both in the home colours. Neutral: `[home nickname, away nickname]`
  in each side's colours (today's paint).

- [ ] **Step 1: Failing tests:** `endZones` for a home game and a neutral one; the All-22 markup of a home game
  contains the home city and nickname in upper case and not the away nickname.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/ui/viewer.test.tsx` → PASS.
- [ ] **Step 5: Commit** (`Both end zones are the home club's`).

### Task 3: All-22 switches ends

**Files:**
- Modify: `src/ui/screens/TopDownField.tsx` (`View`, `toScreen`, `fieldTransform`, the cut), `src/ui/stage/transition.ts`
  (`benchY`), `src/ui/stage/injury.ts`, `src/ui/stage/finale.ts`
- Test: `src/ui/viewer.test.tsx`, `src/ui/stage/transition.test.ts`

**Interfaces:**
- Consumes: `endsSwitched` (Task 1).
- Produces: `View.swap: boolean` (from the entry's quarter); `export const benchY = (home: boolean, swapped: boolean)`
  in `transition.ts` (the home bench is at `-BENCH` in the log's coordinates until the ends switch, then at
  `FIELD_W + BENCH`), used by the three stage modules, each taking `swapped` where it takes the sides today.

  The mapping, which keeps every screen position right with one rule (men are placed in stadium coordinates, and
  the view's turn is worked out there):
  - wide: `toScreen` returns `[100 - x, FIELD_W - y]` unswapped and `[x, y]` swapped; `fieldTransform` is unchanged;
  - upright: `toScreen` is unchanged; `fieldTransform` uses `phi + π` and `100 - cx` when swapped.

- [ ] **Step 1: Failing tests:** rendering one play twice, as quarter 1 and as quarter 2: in the wide layout every
  dot's `(x, y)` is the half-turn of its quarter-1 position about the field's centre and the paint's markup is
  identical; in the upright layout the dots are identical and the field group's transform differs by a half-turn;
  `benchY(true, false) === -BENCH` and `benchY(true, true) === FIELD_W + BENCH`; a change of possession entry in
  quarter 2 (Review Focus 1) puts the offense's dots below its target end zone on screen in both layouts; a man
  coming on for the home side in quarter 2 starts on the near sideline on screen (Review Focus 2).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** The first play of a quarter whose ends differ from the last
  play shown starts behind the existing dip to dark (`DIP`), as a turn of the field does.
- [ ] **Step 4: Run** `npx vitest run src/ui/viewer.test.tsx src/ui/stage` → PASS, the stage snapshots unchanged for
  quarter-1 plays.
- [ ] **Step 5: Commit** (`All-22 switches ends each quarter`).

### Task 4: The broadcast field in its own file, switching ends

**Files:**
- Create: `src/ui/screens/BroadcastField.tsx` (today's `Field`, `project`, `restingSpot`, `downLines` moved as they are)
- Modify: `src/ui/screens/GameViewer.tsx` (imports; re-export what `LiveGame.tsx`, `TopDownField.tsx` and tests import
  from it today), `src/ui/screens/LiveGame.tsx`
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Produces: `export function project(x: number, y: number, h?: number, quarter?: number)` (maps `stadiumSpot` first);
  `BroadcastField` props gain `quarter` read from `entry`; `FieldMemory` gains `swapped: boolean`.

- [ ] **Step 1: Move only.** Run `npx vitest run src/ui/viewer.test.tsx src/ui/ui.test.ts` → PASS with no test
  changed. Commit (`Broadcast field moves to its own file`).
- [ ] **Step 2: Failing tests:** `project(100, 10, 0, 2)` equals `project(0, FIELD_W - 10, 0, 1)`; a quarter-2
  entry draws its line of scrimmage at the half-turned spot; a play shown as quarter 4 straight after one shown as
  quarter 2 (Review Focus 3) reads its own quarter.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** When `endsSwitched` differs from `memory.swapped`, the
  re-spot is a teleport (no sweep) and the lines fade across, as a far new series does today.
- [ ] **Step 5: Run** → PASS. Commit (`Broadcast switches ends each quarter`).

### Task 5: The painted field

**Files:**
- Create: `src/ui/screens/BroadcastPaint.tsx`
- Modify: `src/ui/screens/BroadcastField.tsx` (draws it in place of today's shapes; the view box grows to take the
  near bench)
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Consumes: `GREENS`, `surfaceFor`, `POSTS`, `TEAM_AREA`, `endZones` (Task 2); `project` (Task 4).
- Produces:

```tsx
export function FieldGround(props: { home: Team; away: Team; neutral?: boolean; snow?: boolean }): JSX.Element; // under the ball
export function FieldPosts(): JSX.Element;                                                                   // over it
/** Screen vectors for one yard along x and along y at a spot: what lays a glyph flat on the grass. */
export function groundFrame(x: number, y: number): { dx: [number, number]; dy: [number, number] };
```

  As in the mockup: the surface in stripes of `GREENS[surface].every` yards; each end zone's letters placed one by
  one along the zone with `groundFrame`, feet toward the field of play; yard numbers and the midfield mark laid
  flat; hash marks and sideline ticks; goalposts drawn with `project(x, y, h)`; the two team areas with a row of
  dots, home near (`class="bench home"`) and away far (`class="bench away"`).

- [ ] **Step 1: Failing tests:** the broadcast markup of a home game contains every letter of the home city and
  nickname as its own `<text>` and neither team's abbreviation as end-zone text; two goalposts (`class="posts"`);
  `class="bench home"` and `class="bench away"`; grass and turf stadiums give different stripe counts; the ground's
  markup is identical for a quarter-1 and a quarter-2 play.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (`A painted broadcast field`).

### Task 6: The stadium and the weather

**Files:**
- Modify: `src/ui/screens/BroadcastPaint.tsx`, `src/ui/screens/BroadcastField.tsx`, `GameViewer.tsx`, `LiveGame.tsx`
  (pass the weather), `src/styles.css`
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Consumes: `Weather`, `weatherAt`, `gameWeather` (`engine/weather.ts`, read only).
- Produces:

```tsx
export type Sky = 'night' | 'day' | 'overcast' | 'roof';
export function skyOf(w: Weather): Sky;                       // roof for dome and closed; overcast for any precip outdoors; else night or day
export function Stadium(props: { home: Team; away: Team; neutral?: boolean; weather: Weather }): JSX.Element; // behind the field
export function WeatherFall(props: { weather: Weather }): JSX.Element | null;                               // over everything
```

  `BroadcastField` gains `weather: Weather` (the screens pass `weatherAt(game.result?.weather ?? gameWeather(league,
  game), entry.quarter)`). The crowd is about 800 dots in a fixed pattern (a seeded `Rng` on the game id), home
  colours, both clubs' at a neutral site. Lights (`class="lights"`) at night. Rain is `class="rain"` streaks, snow
  `class="snow"` flakes, `mixed` both, twice as many when `heavy`; none under a roof. Two flags whose lean grows
  with `windMph` and is zero under a roof.

- [ ] **Step 1: Failing tests:** `skyOf` for a dome, a closed roof, night, day, rain outdoors; the markup for night
  has `lights` and no `rain`; for rain has `rain` and no `snow`; for `mixed` both; for a dome neither, and no lights even when the kickoff is a night one; rain that starts in the third quarter (`onset:
  3`) is absent at a quarter-2 play and present at a quarter-3 play; `styles.css` stops `.rain` and `.snow` under
  `prefers-reduced-motion`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (`A stadium, a crowd and the game's weather`).

### Task 7: The drive on the grass

**Files:**
- Modify: `src/ui/screens/BroadcastField.tsx`, `GameViewer.tsx`, `LiveGame.tsx`
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Consumes: `drivesOf` (part one).
- Produces: `BroadcastField` gains `drive?: { from: number; teamId: number }`: the drive on the field through the
  play on screen (the last drive of `drivesOf(plays.slice(0, shown + 1), home.id, true)` when its `how` is `'on'`),
  with `from` in field coordinates.

- [ ] **Step 1: Failing tests:** a snap in mid-drive draws `class="drive-band"` from the drive's start to the line
  of scrimmage and the label `Drive began`; a kickoff, and the first snap of a drive, draw none; a snap at the
  opponent's 15 draws `class="red-zone"` and one at its 25 does not; no `<text>` on the field holds a player's
  play name (`names.re` finds none in the field's markup).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (the band in the offense's colour at low opacity, under the
  lines; both shapes through `project` with the quarter). **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** (`The drive and the red zone on the grass`).

### Task 8: What moment a play makes

**Files:**
- Create: `src/ui/moments.ts`
- Test: `src/ui/moments.test.ts`

**Interfaces:**
- Consumes: `drivesOf`, `linesAt`, `PlayNames` (part one); `flagCall`, `injuryCall` (`ui/stage/calls.ts`);
  `handoverFor` (`TopDownField.tsx`); `fumbleIn`; `actorsIn`; `highlightLevel` is **not** used (the rule below is
  its own).
- Produces:

```ts
export type Tone = 'score' | 'turnover' | 'flag' | 'injury';
export type Moment =
  | { kind: 'banner'; tone: Tone; teamId: number | null; head: string; line: string; side?: string }
  | { kind: 'player'; playerId: number; teamId: number; number?: number; line: string }
  | { kind: 'quarter'; head: string }
  | { kind: 'half' }
  | { kind: 'final' };
/** The moments the play at `index` makes once its result has been shown, in the order they appear. */
export function momentsFor(plays: readonly PlayLogEntry[], index: number, home: Team, away: Team, names: PlayNames, record?: FieldRecord): Moment[];
/** How long the screen holds on them at 1×, in milliseconds (0: the view's usual hold). */
export function momentHold(moments: readonly Moment[], speed: number): number;
export const BIG_GAIN = 20;      // yards from scrimmage that earn a player's line
export const LINE_BEAT = 1200;   // a player's line holds this much longer than a big play's hold, at 1×
export const BANNER_FLOOR = 800; // no banner shorter than this, at any speed
```

  Rules, from the spec's table: the headline words exactly as the table has them; a score or takeaway banner's
  `teamId` is the side it went to; a flag's is `null`. A banner's `side` for a score is the drive
  (`14 plays · 91 yds · 8:04`). A player's line: a `run`, `pass` or `scramble` that gained `BIG_GAIN` or more and
  made no banner, for `who.ball`, with `linesAt` through `index`; left out when the play has no `who.ball` (Review Focus 5). `quarter` after the last play of quarters 1 and 3
  (`End of the first quarter`, `End of the third quarter`); `half` after the last play of quarter 2; `final` after
  the last play of a finished game's log. `momentHold`: a banner 2600, a player's line 2600 + `LINE_BEAT`, a
  quarter card 2000, each divided by speed with banners floored at `BANNER_FLOOR`. `momentsFor` takes no speed: at speed 4 and above
  `momentHold` returns 0 for a player's line and a quarter card, and the overlay does not draw a moment whose hold
  is 0.

- [ ] **Step 1: Failing tests,** hand-built entries in the style of `gameRead.test.ts`: one test per row of the
  banner table (headline, line, side, team); a wiped-out snap makes only the flag; a touchdown on a 40-yard catch
  makes the banner and no player's line; a 25-yard run makes a player's line and a 19-yard one makes nothing; the
  line's numbers include that play; an entry with no `who` makes no player's line; the last entries of quarters 1,
  2, 3 and of the game make `quarter`, `half`, `quarter`, `final`; `momentHold` for a banner at 1×, 4× and 8×
  (2600, 800, 800) and for a player's line at 1× (3800) and 4× (0).
- [ ] **Step 2: Failing test on real games** (three worlds, as `gameRead.test.ts` builds them): every play whose
  score changed for a side through a touchdown, field goal or safety makes exactly one `score` banner for that
  side; every `int` and lost fumble makes one `turnover` banner; every log line `flagCall` reads makes one `flag`
  banner.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement.** **Step 5: Run** `npx vitest run src/ui/moments.test.ts` → PASS.
- [ ] **Step 6: Commit** (`moments: what a play gives the screen to show`).

### Task 9: Banners and the player's line, in both views

**Files:**
- Create: `src/ui/screens/GameMoments.tsx`
- Modify: `GameViewer.tsx`, `LiveGame.tsx` (a `.viewer-scene` wrapper round the field in either view, the hold),
  `TopDownField.tsx` (its three strips take the banner's markup), `Scorebug.tsx` (the SNN tab), `BroadcastPaint.tsx`
  (bench and crowd classes), `src/styles.css`
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Consumes: `Moment`, `momentsFor`, `momentHold` (Task 8); `laneColor`; `PlayerLink`.
- Produces:

```tsx
export function MomentBanner(props: { tone: Tone; team: Team | null; head: string; line: string; side?: string }): JSX.Element;
export function GameMoments(props: { league: League; home: Team; away: Team; moments: readonly Moment[]; speed: number }): JSX.Element | null;
```

  The screens compute `moments = told ? momentsFor(...) : []` for the play on screen and hold
  `Math.max(theViewsHold, momentHold(moments, speed))` before the next play. `GameMoments` draws the first banner
  or the player's line (never both); the whole line is in the markup at once (no staged reveal). While a `score` or
  `turnover` banner is up, the scene has `data-cheer="home"` or `"away"`: that side's bench dots hop, and the crowd
  brightens for `home`. `Scorebug` gains a first cell, `<span class="vb-net">SNN</span>` (white).
  All-22's `td-call` and `td-banner` strips render `MomentBanner` with their own text and timing.

- [ ] **Step 1: Failing tests:** the replay's markup at a told touchdown play has a `moment-banner score` with
  `Touchdown` and the scoring side's abbreviation, and `data-cheer`; the same play untold has no banner; a told
  25-yard gain has `moment-player` with a `linklike` button for the man and his whole line in one node; a flag play
  in All-22 renders its call inside `moment-banner flag`; the scorebug has `vb-net`; `styles.css` uses `--marker`
  for `.moment-banner.flag .mb-who` and for no other moment rule, and stops the hop and the glow under
  `prefers-reduced-motion`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/ui/viewer.test.tsx
  src/ui/ui.test.ts` → PASS.
- [ ] **Step 5: Commit** (`Banners for the big moments, in both views`).

### Task 10: The quarter, the half and the final

**Files:**
- Modify: `src/ui/screens/GameMoments.tsx`, `GameViewer.tsx`, `LiveGame.tsx`, `src/styles.css`
- Test: `src/ui/viewer.test.tsx`

**Interfaces:**
- Consumes: `quartersAt`, `teamStatsAt`, `linesAt` (part one); the Players panel's leader wording (export
  `leadersOf(lines, league, home, away, playerTeams)` and the category `line` formatter from `GamePanels.tsx`).
- Produces: `GameMoments` gains `card` props:

```tsx
{ onContinue?: () => void; onSim?: () => void; onBoxScore?: () => void; onReplay?: () => void; verdict?: 'W' | 'L' | 'T' }
```

  The half and final cards show the score, four rows (Total yards, First downs, 3rd down, Turnovers; a row not in
  `SHOWN_TEAM` is left out) and the leading passer, rusher and receiver so far. Live: reaching the half **by
  playing** pauses the game (`live.update({ playing: false })`) with the card up until *Continue* (which resumes)
  or *Sim to final*; it does not pause when the half is passed by *Sim to final* or a highlight skip (Review Focus
  4). Replay: the card holds 5000 ms at 1× and the replay carries on; stepping or scrubbing shows the play without
  the card. The final card carries the live game's result buttons and verdict, and `LiveGame`'s `.live-final` panel
  is removed; in a replay it has *Box score* only. In All-22 the final card waits for the finale to finish.

- [ ] **Step 1: Failing tests:** the half card at the last play of quarter 2 shows the score and the four rows with
  `teamStatsAt`'s numbers through that play and three leaders as `PlayerLink`s; given `onContinue` it has *Continue*
  and *Sim to final*, without it neither; the final card with a verdict shows it once and the live screen's markup
  has no `live-final`; the quarter card reads `End of the first quarter`; a card never appears for an untold play.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** `npx vitest run src/ui/viewer.test.tsx
  src/ui/live.test.ts` → PASS.
- [ ] **Step 5: Commit** (`Cards at the quarter, the half and the final`).

### Task 11: Finish

**Files:**
- Modify: `package.json` (`0.4.28`), `src/ui/changelog.ts`, `CLAUDE.md` (the viewer paragraph under `src/ui/`),
  part one's spec (one line: its Out of scope items now built)

- [ ] **Step 1:** Version and changelog. Title `A stadium, and the big moments`; text: `Game day has a painted
  field, a crowd and the weather you're playing in. Scores, turnovers, flags and injuries get a banner, teams switch
  ends each quarter, and a live game stops at the half.`
- [ ] **Step 2:** `npm run copy`, read the new lines in `.check/copy.txt` against `docs/UI.md`; `npx vitest run
  src/ui`; `npm run typecheck`; `npm run format` → all clean.
- [ ] **Step 3: Look at it** in a browser: Broadcast and All-22, a phone and a wide window, both themes; the cut at
  each quarter and a play straight after it; a night game, a rain game, a snow game and a dome (pick games from a
  save by their weather); reduced motion on; a live game through the half (the wait, *Continue*) to the final card;
  8× speed; a replay scrubbed across the half. Fix what is off.
- [ ] **Step 4: Commit and push** to the branch. No pull request.
