# A Play's Time Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A play's seconds from what happened, the half's last possession as the NFL plays it (try or kneel, leaned by
the head coach), the two-point try as a real snap with today's NFL call, and returns drawn whole from the NFL's shape
(a touchdown is the return that reaches the end zone).

**Architecture:** Three pure modules beside `dropbackEnd.ts` (no draws, no league reads): `match/playTime.ts`
(`playSeconds`, `meanSeconds`, `kneelOdds`), `match/twoPoint.ts` (`twoPointOdds`, `sureTwo`, `runShare`),
`match/returns.ts` (`returnYards`). `gameSim.ts` draws and writes the words; one tap (`situationTap`) feeds
`npm run situations`, judged against nflverse as `npm run dropback` is.

**Tech Stack:** TypeScript, Vitest, tsx scripts, Python/pandas for the research script.

**Spec:** `docs/superpowers/specs/2026-11-07-a-plays-time-design.md`

## Global Constraints

- Engine: no `Math.random`; draws only through the game's `Rng`; ratings only through `skill()`; habits through
  `this.has`/`this.habits` in `gameSim.ts`.
- `playTime.ts`, `twoPoint.ts` and `returns.ts` draw nothing and read no league.
- League shape unchanged: no `SAVE_VERSION` bump. No new `PlayLogEntry` fields: the try's entry is the snap's own kind
  (`run`, `pass`, `incomplete`, `int`, `sack`, `scramble`) from the 2, its text prefixed `Two-point try: `.
- The try's text: `Two-point try: ${snap text} — GOOD.`, `Two-point try: ${snap text} — NO GOOD.`, and on a turnover
  returned `Two-point try: ${snap text} — ${short(by)} returns it for 2 points!`.
- Sacks keep today's `rng.int(4, 6)` and field goals today's `rng.int(4, 6)` (spec §2: today's mean, not measured).
- Goes for Two's spots stay today's (`twoPointSpot`: −8 from the 3rd quarter, and the 3rd quarter's −2, +1, +5); only
  its exclusion of the sure calls reads `sureTwo` in place of `goForTwo`. It goes 80% of the time there, as today.
- Kickoff returns fitted on 2025 only (the game's touchback at the 35); punts on 2021–25.
- A judged share needs its tolerance ≥ 3.5 standard errors and an NFL sample ≥ 200, else it is reported. Never loosen
  a range to get green.
- The owner's one-push rule: commit locally; push once when every task is green locally (the PR's CI runs once).
- 0.4.11.

## Review Focus

- **A try after a defense's or a returner's touchdown:** the side that scored snaps the try (it is the offense for that
  snap), whatever `this.offense` was. Test in Task 6.
- **A touchdown as the half or the game expires:** the try still happens and takes no clock; an overtime walk-off has no
  try. Test in Task 6.
- **A return can't pass the end zone:** `returnYards` never exceeds its `from`; reaching it is the touchdown, exactly
  (a kickoff caught at the 3 needs 97). Test in Task 4 and Task 7.
- **The half's draw is the drive's:** a change of possession inside 75 seconds gives the new offense its own draw; one
  half tap per drive. Test in Task 5.
- **A play's seconds:** at least 1, whole, and the clock never goes below 0 (`playTime` clamps). Test in Task 2.

---

### Task 1: The NFL's numbers

**Files:**

- Create: `scripts/research-situations.py`
- Modify: the spec's §1 (only if a number differs)

- [ ] **Step 1: Write `scripts/research-situations.py`** in the shape of `scripts/research-dropback.py` (same cache dir,
      download loop, REG only, `python3 -I`; the measurements are in this session's scratch scripts `dur.py`, `half.py`,
      `two.py`, `ret.py`, under the scratchpad's `b/`, to be folded in). It prints, as paste-ready TS consts:
  - `TIME_NFL`: the play-time anchors of spec §1 (incompletions by air bucket; catches and runs by yards, touchdowns;
    catches and runs out of bounds late by yards; punts returned, fair caught; kickoffs returned), each mean with n;
    the incompletions' p10 and p90;
  - `HALF_NFL`: the kneel share at the drive's first snap by clock bucket, by timeouts × clock, by spot, by score, each
    with n; how drives that try from the own 1–35 end (half, punt, field goal, turnover, missed field goal, touchdown);
    and a logistic fit on drives inside the own 50 (`kneel ~ clock + timeouts + [own 36–50]`), its coefficients;
  - `TWO_NFL`: the two-point share of tries by quarter group (1–3; 4th and overtime) × the score after the touchdown
    (diffs with n ≥ 30), the groups' shares elsewhere, the overall share; success by run and pass, the run share, the
    defensive two share, each with n;
  - `RETURN_NFL`: the return yards' 101 quantiles (0%, 1%, …, 100%) for kickoffs 2025 and punts 2021–25; means, the
    20+/40+/60+ shares, touchdowns per return, each with n; the returner spread (sd of means, luck sd, 30+ returns).
- [ ] **Step 2: Run** `python3 -I scripts/research-situations.py`. Expected: the spec's §1 numbers; fix §1 where any
      differs.
- [ ] **Step 3: Commit** ("Research: a play's time, the half, two-point tries and returns").

### Task 2: `match/playTime.ts`

**Files:**

- Create: `src/engine/match/playTime.ts`, `src/engine/match/playTime.test.ts`

**Interfaces:**

- Consumes: Task 1's `TIME_NFL` and `HALF_NFL` coefficients.
- Produces:
  ```ts
  export type PlayTimeKind = 'incomplete' | 'catch' | 'run' | 'scramble' | 'return' | 'punt' | 'fairCatch' | 'kickoff';
  export interface PlayTimeFacts { kind: PlayTimeKind; yards: number; air?: number; outOfBounds?: boolean }
  export function meanSeconds(f: PlayTimeFacts): number;        // the table's mean, unrounded
  export function playSeconds(f: PlayTimeFacts, u: number): number; // max(1, round(mean + SPREAD * (u - 0.5)))
  export interface HalfFacts { clock: number; yardLine: number; timeouts: number; appetite: number }
  export function kneelOdds(f: HalfFacts): number;
  ```

- [ ] **Step 1: Write the failing tests** (`playTime.test.ts`):
  - `meanSeconds` incompletions: air −3 < 5 < 15 < 30, and air 30 within 0.3 of 5.72;
  - catches and runs rise with yards (2.5 < 7 < 14.5 < 29.5 < 55); a run of 55 within 0.4 of 9.61;
  - out of bounds a touch longer: a run +1.0, a catch +0.3 at the same yards;
  - `punt` (a return of 9) within 0.3 of 10.91 and longer than `fairCatch` (6.94); `kickoff` (26) within 0.3 of 5.74;
  - `playSeconds`: whole, ≥ 1 for every kind at u 0 (**Review Focus**), and over an even grid of u its mean within 0.5
    of `meanSeconds`;
  - `kneelOdds`: 0 at yardLine ≥ 50; falls with each timeout; rises as the clock falls (60 < 30 < 15); at 15 seconds
    from his own 25 with one timeout above 0.6, at 30 seconds with three below 0.12; appetite +1 lowers it and −1 raises
    it: at 30 seconds from his own 25 with two timeouts, appetite −1 sits 0.03–0.08 above appetite 0.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/playTime.test.ts`. Expected: FAIL (no module).
- [ ] **Step 3: Implement.** `meanSeconds`: piecewise-linear interpolation over each kind's anchors (yards at the
      bucket's middle: 2.5, 7, 14.5, 29.5, 55; incompletions at air −3, 4.5, 14.5, 30), flat past the ends; catches and
      runs from the touchdown anchors plus `OOB_EXTRA = { run: 1.0, catch: 0.3 }` out of bounds; `scramble` 6.5 at 7
      yards and 0.1 a yard either way (at least 4.5); `return` a run of its yards plus 2; `punt` 10.91 at 9.5 yards and
      0.1 a yard; `kickoff` 5.74 at 26 and 0.08 a yard; `fairCatch` 6.94. `SPREAD = 5`. `kneelOdds`: 0 at yardLine ≥ 50,
      else `logistic(HALF_BASE + HALF_CLOCK * clock + HALF_TIMEOUT * timeouts + (yardLine > 35 ? HALF_SPOT : 0) −
      HALF_APPETITE * appetite)` with Task 1's coefficients and `HALF_APPETITE = 0.6`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: a play's time and the half's call (playTime.ts)").

### Task 3: `match/twoPoint.ts`

**Files:**

- Create: `src/engine/match/twoPoint.ts`, `src/engine/match/twoPoint.test.ts`
- Modify: `src/engine/match/coachHabits.ts` (`twoPointSpot` reads `sureTwo`), `src/engine/match/coach.ts` (delete
  `goForTwo`)

**Interfaces:**

- Consumes: Task 1's `TWO_NFL`.
- Produces:
  ```ts
  export interface TwoPointFacts { quarter: number; clock: number; overtime: boolean; scoreDiff: number;
    appetite: number; passLean: number; qbScrambling: number }
  export function sureTwo(f: Pick<TwoPointFacts, 'quarter' | 'clock' | 'overtime' | 'scoreDiff'>): boolean;
  export function twoPointOdds(f: TwoPointFacts): number;  // 1 when sureTwo
  export function runShare(f: TwoPointFacts): number;
  export const TRY_RUN: number;   // yards added to a run's mean on a try (fitted, Task 10; start 0)
  export const TRY_PASS: number;  // a multiplier on a pass's completion odds on a try (fitted; start 1)
  export const DEF_TWO: number;   // a turnover on a try returned for 2 (fitted; start 0.5)
  ```

- [ ] **Step 1: Write the failing tests** (`twoPoint.test.ts`):
  - `sureTwo` in the 4th or overtime at −10, −5, −2, +1, +5, and at −1 with 60 seconds or less (not overtime); not at
    −1 with 5:00, nor at +5 in the 2nd quarter;
  - `twoPointOdds` 1 where `sureTwo`; the 4th at −8 and −9 between 0.3 and 0.5; the 2nd at −5 and +5 between 0.3 and
    0.5, +12 between 0.1 and 0.25; the 2nd at +6 below 0.03; appetite +1 raises −8 late and leaves a sure call at 1;
  - `runShare` 0.28 ± 0.02 at passLean 0 and scrambling 12; lower at passLean +1; higher at scrambling 16.
  - `coachQuirks.test.ts`'s `twoPointSpot` cases still pass unchanged.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/twoPoint.test.ts src/engine/coachQuirks.test.ts`. Expected:
      FAIL (no module).
- [ ] **Step 3: Implement.** `twoPointOdds`: `sureTwo` → 1; else the NFL's share from `TWO_NFL` by quarter group and the
      score (the group's "elsewhere" share for an unlisted score), its logit plus `TWO_APPETITE = 0.4 * appetite`.
      `runShare`: `logistic(logit(0.28) − 0.8 * passLean + 0.1 * (qbScrambling − 12))`. `twoPointSpot` excludes
      `sureTwo(s)` where it excluded `goForTwo(s)`.
- [ ] **Step 4: Run** the tests and `npm run typecheck` (the `goForTwo` call in `gameSim.ts` is Task 6's: make it
      `sureTwo(...)` for now so the build stays whole). Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: the two-point call (twoPoint.ts)").

### Task 4: `match/returns.ts`

**Files:**

- Create: `src/engine/match/returns.ts`, `src/engine/match/returns.test.ts`

**Interfaces:**

- Consumes: Task 1's `RETURN_NFL` quantiles.
- Produces:
  ```ts
  export interface ReturnFacts { kind: 'kickoff' | 'punt'; from: number; returner: number; coverage: number;
    coach: number; outkicks?: boolean; highArc?: boolean }
  // returner: skill(kr, 'returns') − 12; coverage: the kicking side's mean skill(p, 'tackling') over `st`, − COVERAGE_TYPICAL (8.6);
  // coach: today's yards edge, RETURN_COACH[kind] * (receiving.stCoach − kicking.stCoach).
  export function returnYards(f: ReturnFacts, u: number): number; // whole, 0 ≤ yards ≤ f.from
  ```

- [ ] **Step 1: Write the failing tests** (`returns.test.ts`), over an even grid of 1,000 draws at a neutral man:
  - kickoff mean within 1.0 of 25.95, 40+ within 0.015 of 0.0419, 60+ within 0.006 of 0.0092; punt mean within 0.8 of
    9.45, 20+ within 0.02 of 0.082, 40+ within 0.008 of 0.019;
  - whole yards, never negative, never past `from` (**Review Focus**); a kickoff from 97 reaches 97 only at the very
    top of the grid; a punt from 30 reaches 30 more often than from 60;
  - returner +4 moves the 95th percentile more than the median; coverage +4 lowers the mean; `outkicks` adds about 3
    yards and `highArc` takes about 1.5 on punts (as today).
- [ ] **Step 2: Run** `npx vitest run src/engine/match/returns.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** The man warps the draw so the shift lands mostly in the tail:
      `lean = RETURNER * returner − COVERAGE * coverage`, `u' = 1 − (1 − u) ** Math.exp(lean)`; yards = the kind's
      quantile at `u'` (linear between the 101 points) + `coach` + (punt: `outkicks` 3, `highArc` −1.5), rounded and
      clamped to [0, from]. `RETURNER = 0.06`, `COVERAGE = 0.04` to start (fitted to the NFL's returner spread, Task 10).
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: a return's length from the NFL's shape (returns.ts)").

### Task 5: The engine: a play's time and the half

**Files:**

- Modify: `src/engine/match/gameSim.ts` (`SimOptions`, `PlayResult`, `runPlay` ~3316/3351/3371, `passPlay` ~3609/3683
  and its branches, `scramble` ~4412/4452, `resolve` ~4567, `scrimmageDown` ~2368/2376, `endPossession` ~1699,
  `endQuarter` ~1641), `src/engine/match/coach.ts` (`Situation.halfTry`, `tempo`, `offenseTimeout`, `shouldKneel`)
- Test: `src/engine/match/situations.engine.test.ts`

**Interfaces:**

- Consumes: Task 2 (all).
- Produces:
  ```ts
  export type SituationTap =
    | { kind: 'time'; play: PlayTimeKind | 'sack'; yards: number; air?: number; outOfBounds?: boolean;
        seconds: number; field: boolean }
    | { kind: 'half'; clock: number; yardLine: number; timeouts: number; appetite: number; kneeled: boolean;
        points: number; turnover: boolean; reachedHalf: boolean }
    | { kind: 'try'; quarter: number; scoreDiff: number; appetite: number; goes: boolean; run?: boolean;
        good?: boolean; defTwo?: boolean }
    | { kind: 'return'; play: 'kickoff' | 'punt'; yards: number; td: boolean; returner: number; returnerId: number;
        coverage: number };
  SimOptions.situationTap?: (tap: SituationTap) => void;
  PlayResult.fieldTimed?: true;      // the duration is the field's (`fieldTime`)
  Situation.halfTry?: boolean;       // the drive is trying for points before the half
  ```

- [ ] **Step 1: Write the failing tests** (`situations.engine.test.ts`, seed `situations-engine`, 12 AI games with
      `keepPlays` and `situationTap`):
  - every `time` tap's seconds ≥ 1; incompletion taps' mean within 0.6 of 4.73; no `time` tap with `field` true (AI
    games);
  - one `half` tap per drive with a first snap inside 75 seconds of the 2nd quarter (**Review Focus**: after a change
    of possession the new offense taps its own); no kneel tap at yardLine ≥ 50; some drives try from inside their 35;
  - a trying drive's snaps after an in-bounds gain inside 60 seconds are followed by its timeout while it has one
    (the log's `Timeout` line);
  - 4th-quarter victory formations still kneel (an `engine.test.ts` `shouldKneel` case unchanged).
- [ ] **Step 2: Run** `npx vitest run src/engine/match/situations.engine.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Runs: each `rng.int(4, 7)` becomes `playSeconds({ kind: 'run', yards: gain, outOfBounds: oob }, rng.next())` (one
    draw for one). Passes: `rng.int(5, 8)` at ~3683 becomes `const timeU = rng.next()`, and each branch's `duration`
    is `playSeconds(...)` on `timeU` (`incomplete` with `air`, `catch` with the gain and out of bounds, a pick
    `return` with its return yards); the throwaway's `rng.int(4, 6)` becomes `incomplete` at its air. Scrambles:
    `scramble` with the yards. Wherever `spatial ? this.fieldTime(...)` sets `duration`, also set `fieldTimed: true`.
  - `resolve()` taps `time` for every scrimmage result (sacks as `'sack'`, picks and lost fumbles left out), with
    `field: !!result.fieldTimed`.
  - The normal tempo's runoff `rng.int(29, 39)` reads `NORMAL_RUNOFF` (a `[29, 39]` const beside it, refit in Task 10).
  - The half: `private halfU: number | null` and `private halfDrive` (the tap's facts, the score at the decision,
    `turnover`). In `scrimmageDown` before `shouldKneel`: in the 2nd quarter (not overtime) with `clock ≤ 75`, draw
    `halfU` once a drive (`this.rng.next()`) and the tap's facts at that first snap; `kneeled = halfU < kneelOdds({
    clock, yardLine, timeouts: offTimeouts, appetite: styles[off].fourthDown })` each snap: kneel when true, else
    `halfTry` true in `situation()`. `endPossession()` and `endQuarter()` at the half emit the drive's `half` tap
    (points the offense scored since the decision; `turnover` set in `resolve`'s turnover branch; `reachedHalf` from
    `endQuarter`) and reset `halfU`/`halfDrive`.
  - `coach.ts`: `shouldKneel` loses its 2nd-quarter branch; `tempo` hurries in the 2nd quarter inside 2:00 when
    `yardLine ≥ 25 || halfTry`; `offenseTimeout`'s 2nd-quarter rule reads `(yardLine ≥ 45 || halfTry)`.
- [ ] **Step 4: Run** the test and `npx vitest run src/engine/match src/engine/engine.test.ts`. Expected: PASS (pinned
      hashes elsewhere are re-taken in Task 10).
- [ ] **Step 5: Commit** ("Engine: a play's time and the half's last possession").

### Task 6: The engine: the two-point try

**Files:**

- Modify: `src/engine/match/gameSim.ts` (`conversion()` ~1739, a new `twoPointTry(side)`, `runPlay`'s run mean
  ~3207, `passPlay`'s `pComplete` ~3636)
- Test: `src/engine/match/situations.engine.test.ts`

**Interfaces:**

- Consumes: Task 3 (all), Task 5's `SituationTap`.

- [ ] **Step 1: Write the failing tests** (in `situations.engine.test.ts`, 40 games):
  - every try taps once; `goes` true at every sure call;
  - every try's entry starts `Two-point try: ` and ends ` — GOOD.`, ` — NO GOOD.` or `returns it for 2 points!`; its
    kind is a snap's (`run`, `pass`, `incomplete`, `int`, `sack`, `scramble`) from yardLine 98;
  - a try books no stat: the scorer's passing, rushing and receiving lines are the same with the try's play removed
    (compare totals with each try's men; no `rushAtt`/`passAtt` change across it);
  - **Review Focus:** a try after a pick-six or a return touchdown is snapped by the side that scored; a touchdown at
    0:00 of the 2nd quarter still gets its try and the clock stays 0; an overtime walk-off logs no try.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/situations.engine.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `twoPointTry(side)`: `goes = rng.chance(twoPointOdds(f)) || two.goes` replaces
      `coach.goForTwo(s) || two.goes`. The snap: save `offense`, `yardLine`, `down`, `lineToGain`; set `offense = side`,
      `yardLine = 98`, `down = 1`, `lineToGain = 100`, `this.onTry = true`, and the options with every `*Tap` but
      `situationTap` stripped; reset the per-snap fields as `scrimmageDown` does (`pressureBy` … `pocketToday`);
      `defCall = coach.defenseCall(s, rng)`; `passing = !rng.chance(runShare(f))`; `passPlay`/`runPlay`; the pocket film
      block for a throw the pocket hasn't played (extract it from `scrimmageDown` into `private pocketFilm(result)`,
      both call it). On a try `runPlay` adds `TRY_RUN` to the run's mean and `passPlay` multiplies `pComplete` by
      `TRY_PASS`. Good when no turnover, not an incomplete pass, and `98 + yards ≥ 100`. A turnover: the defense scores
      2 when `rng.chance(DEF_TWO)`. `this.wear(result.stats, unhitPlay(result))` (no `credit`); `setAnim` and `log` as
      `resolve` does for the kind, from 98; the `try` tap; restore everything. Not good: nothing scores.
- [ ] **Step 4: Run** the test and `npx vitest run src/engine/match src/engine/coachQuirks.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: the two-point try as a real snap").

### Task 7: The engine: returns

**Files:**

- Modify: `src/engine/match/gameSim.ts` (`kickoff()` ~1878–1935, `punt()` ~2009 and ~2110–2140)
- Test: `src/engine/match/situations.engine.test.ts`

**Interfaces:**

- Consumes: Task 4 (all), Task 2's `playSeconds`, Task 5's `SituationTap`.

- [ ] **Step 1: Write the failing tests** (in `situations.engine.test.ts`):
  - every returned kickoff and punt taps `return`; a return touchdown's yards equal its distance to the end zone
    (**Review Focus**), and every `TOUCHDOWN` return in the log has a `td` tap;
  - returned punts take longer than fair catches (`time` taps `punt` and `fairCatch`).
- [ ] **Step 2: Run** `npx vitest run src/engine/match/situations.engine.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Kickoff: `start = 3 + returnYards({ kind: 'kickoff', from: 97, … }, rng.next())` in place
      of the normal roll and its clamp; `returnTd = start >= 100` (the separate chance gone); `kickTime` is
      `playSeconds({ kind: 'kickoff', yards: start − 3 }, rng.next())`. Punt: `ret = returnYards({ kind: 'punt', from:
      100 − receiveAt, … }, rng.next())` in place of the normal roll and the separate touchdown chance; the punt's
      `rng.int(6, 9)` becomes a `u` drawn there and `playTime(playSeconds(...))` at each exit (`punt` with the return,
      else `fairCatch`). Both tap `time` and `return`.
- [ ] **Step 4: Run** the test and `npx vitest run src/engine/match`. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: returns from the NFL's shape").

### Task 8: The film

**Files:**

- Modify: `src/engine/field/stage.ts` or `src/engine/playActors.ts` only where the try's entry needs it
- Test: `src/ui/stage/situations.test.ts`

**Interfaces:**

- Consumes: Task 6's try entries, Task 7's returns.

- [ ] **Step 1: Write the failing tests** (`situations.test.ts`, a league with the field on, games until each case is
      found):
  - a two-point try (`Two-point try: ` entry) stages from yardLine 98: the ball's first spot at the 2; a good run or
    catch ends in the end zone; `actorsIn(e)` reads its men as for the same text without the prefix;
  - a kickoff return of 40+ yards is drawn the whole way: the ball's last spot at its return spot.
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/situations.test.ts`. Expected: FAIL where the stager or `actorsIn`
      trips on the prefix; else PASS on the return (ledger it: nothing to change).
- [ ] **Step 3: Implement** the smallest change that makes the try stage (strip the `Two-point try: ` prefix where
      the play's text is parsed).
- [ ] **Step 4: Run** `npx vitest run src/ui/stage src/engine/field`. Expected: PASS.
- [ ] **Step 5: Commit** ("Film: the two-point try from the 2").

### Task 9: `npm run situations` and the parity line

**Files:**

- Create: `scripts/situations-core.ts`, `scripts/situations-core.test.ts`, `scripts/situations.ts`
- Modify: `package.json` (`"situations": "tsx scripts/situations.ts"`), `scripts/calibrate.ts`, `scripts/check.ts`
  (`[/^scripts\/situations(-core)?\.ts$/, ['sim']]`), `scripts/parity.ts`

**Interfaces:**

- Consumes: Task 5's `SituationTap`; Task 2's `meanSeconds`; `share` (`fumbles-core.ts`), `Line`/`printLine`
  (`sideline-core.ts`); Task 1's tables.
- Produces: `newSituationTally(): SituationTally`, `tapSituation(t, tap): void`, `judgeSituations(t): Line[]`.

- [ ] **Step 1: Write the failing tests** (`situations-core.test.ts`): a tally of incompletions at the NFL's mean judges
      `time: incomplete` in range and one 1.5 seconds long out of it; a tally with 4.6% early tries judges `two: share,
      quarters 1–3` in range; the coverage lines are `info` (reported).
- [ ] **Step 2: Run** `npx vitest run scripts/situations-core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the lines (means within 0.4 seconds or 1.0 yards, shares by `share` with tolerance 0.03,
      0.06 on samples under 1,000; judged only past 3.5 standard errors and NFL n ≥ 200): judged `time:` incompletions
      by air bucket, catches and runs by yard bucket (in bounds and out late), punts returned and fair caught,
      kickoffs; `half: kneel` by clock bucket and by timeouts at 21–40, `half: tried from deep` points, touchdowns,
      turnovers, reached the half; `two:` share overall, quarters 1–3, the 4th, at −8/−9 late, at ±5 early, run share,
      success run and pass; `returns:` kickoff and punt means, 20+, 40+, 60+, touchdowns per return, the returner
      spread (sd of means against luck, 30+ returns). Reported: sacks' and scrambles' time, early tries by appetite
      (above and below 0), defensive twos, returns by coverage. `situations.ts` plays `--games` AI games (default 200,
      seeds `situations-${k}`); `calibrate.ts` taps and prints under "A play's time and the situations"; `parity.ts`'s
      season worker taps `situationTap` and adds `field play time vs the table (runs and catches)`: the mean of
      `seconds − meanSeconds(facts)` over `field: true` taps, range [−1, 1].
- [ ] **Step 4: Run** the core test; `npm run situations -- 3000` (✗ allowed until Task 10). Expected: PASS; every line
      prints.
- [ ] **Step 5: Commit** ("Checks: npm run situations against nflverse").

### Task 10: Fit and hold the league

**Files:**

- Modify: `src/engine/match/twoPoint.ts` (`TRY_RUN`, `TRY_PASS`, `DEF_TWO`), `src/engine/match/returns.ts`
  (`RETURNER`, `COVERAGE`), `src/engine/match/gameSim.ts` (`NORMAL_RUNOFF`), `docs/ATTRIBUTES.md`; re-pins in
  `src/engine/personnel/personnel.test.ts`, `src/engine/offseason/__snapshots__/offseason.test.ts.snap`

- [ ] **Step 1: Fit:** `TRY_RUN`/`TRY_PASS` to runs 56.4% and passes 44.0%; `DEF_TWO` to 3.9% of tries; `RETURNER`/
      `COVERAGE` to the returner spread (about 0.6–0.8 yards a return on kickoffs, 1.2 on punts) with the means held;
      `NORMAL_RUNOFF` so plays a team-game stay 61–65 (`npm run sim -- 10`).
- [ ] **Step 2: Run** `npm run situations -- 3000`. Expected: 0 lines out.
- [ ] **Step 3: Hold the league:** `npm run sim -- 20` (no ✗), `npm run dropback -- 3000`, `npm run fumbles -- 3000`,
      `npm run passer -- 3000`, `npm run picks -- 3000`, `npm run sideline -- 3000` (0 out each),
      `npx tsx scripts/check.ts endings parity film`, `npm run quirks -- --effects`, `npm run audit` (commit
      `docs/ATTRIBUTES.md`).
- [ ] **Step 4: Run** the full `npx vitest run` alone; re-pin the personnel hash and the re-sign snapshot; a world
      fixture that breaks gets its fixture fixed, never its rule (ledger rulings). Expected: all PASS.
- [ ] **Step 5: Commit** ("A play's time and the situations: fitted to nflverse 2021–25").

### Task 11: Docs, version and the one push

**Files:**

- Modify: `docs/MVP.md`, `CLAUDE.md`, `src/ui/changelog.ts`, `package.json`, the spec's status line

- [ ] **Step 1:** `docs/MVP.md`: tick "a play's time", "the two-point try" and the "Low" line (return touchdowns), each
      with what it does and the fitted numbers (0.4.11). CLAUDE.md: `npm run situations [-- games]` beside `npm run
      dropback`; `match/playTime.ts`, `match/twoPoint.ts`, `match/returns.ts` beside `match/dropbackEnd.ts`. Changelog
      0.4.11 (a player's view: incompletions stop the clock sooner so the two-minute drill fits a snap more, a long
      catch-and-run eats ten seconds, teams with time and timeouts try before the half, the two-point try is a real
      play with its men named and when to go for it is today's NFL, a breakaway return goes the distance).
      `package.json` 0.4.11. Spec status: built (0.4.11).
- [ ] **Step 2: Run** `npm run typecheck`, `npx vitest run src/ui/ui.test.ts src/ui/changelog.test.ts`,
      `npm run format:check`. Expected: PASS.
- [ ] **Step 3: Commit** ("0.4.11: a play's time, the half, the two-point try and returns"), push once, open the PR.
