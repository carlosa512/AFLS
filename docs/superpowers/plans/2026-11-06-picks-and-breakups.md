# Picks and Breakups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat rolls after a throw (who intercepts it, the pick's return, who's credited with a breakup and how
often) with odds read from the throw's depth and the men on the field, batted balls at the line included, fitted to
nflverse 2021–25 and judged by a new `npm run picks` and by `npm run sim`.

**Architecture:** `match/defendedPass.ts` (new, pure) answers who picks it off, how often and by whom an incompletion is
broken up, and how far a pick runs back; the yard-band return moves from `looseBall.ts` into `match/returnBands.ts` so
both modules share it. `gameSim.ts` calls them in the pick and incompletion branches and taps every pass
(`defendedTap`); the film draws a ball batted or tipped at the line.

**Tech Stack:** TypeScript (engine, Vitest), Python + pandas (`scripts/research-picks.py`), tsx check scripts.

**Spec:** `docs/superpowers/specs/2026-11-06-picks-and-breakups-design.md`

## Global Constraints

- All randomness through the game's `Rng`; `defendedPass.ts` and `returnBands.ts` draw nothing and read no league.
- Ratings through `skill()` (`ballSkills`, `coverage`); height through `sizeZ(p).h`.
- The pick odds (`pInt`) are unchanged; the breakup rate moves from a flat 0.30 to `breakupRate(band)`.
- The turnover's shape is unchanged (`{ kind, spot, returnYds, by }`); a pick in the end zone (`spot >= 100`) is still a
  touchback; no save change, no `SAVE_VERSION` bump.
- Copy: `, batted down at the line by X`; a tipped pick `… tipped at the line, INTERCEPTED by X`.
- Checks judge a share once its tolerance clears 3.5 standard errors and the NFL's sample is 200 or more; mean returns are
  reported only. Never loosen a range.
- Constants fitted on weeks 1 and 10 of played seasons, as `npm run sim` reads them (0.4.6/0.4.7's lesson: fresh leagues
  have no backups carrying).
- The full `npx vitest run` runs alone (four parallel jobs beside it ran the container out of memory); after the last
  engine change, regenerate `docs/ATTRIBUTES.md` with the audit and re-take what the reshuffled dice move.
- Version 0.4.8.

## Review Focus

- **A pick in the end zone** (`spot >= 100`): a touchback as today, no return drawn. Test in Task 4.
- **A tipped pick behind the line**: the spot is the line of scrimmage, the return runs from there toward the passer's
  goal. Test in Task 4.
- **A group with nobody on the field** (no linebacker in dime, no safety in a goal-line look): the man comes from the next
  group, never undefined. Test in Task 3.
- **No pressure on the throw** (`pressureBy` null): a batter is still weighted by height alone. Test in Task 3.
- **An old save's incompletion text** (no "batted"): the film draws the throw as today. Test in Task 6.

---

### Task 1: The NFL measurement

**Files:**
- Create: `scripts/research-picks.py`

**Interfaces:**
- Produces: printed tables Tasks 3, 5 and 7 copy: `PICK_GROUPS_NFL` (band → CB/S/LB/DL shares, n), `PICK_RETURN_NFL`
  (band → none, 1–9, 10–19, 20+, mean, pick-six, n), `BREAKUP_NFL` (band → share, n), `BREAKUP_GROUPS_NFL` (CB/S/LB/DL,
  n), `PICK_PD_NFL` (0.84).

- [ ] **Step 1:** Write the script in the shape of `research-fumbles.py` (cache `work/nflverse`, downloads
  `play_by_play_YYYY.csv.gz` and `roster_YYYY.csv`, 2021–25 regular seasons): pass attempts with air yards, no sacks,
  spikes or two-point tries; bands by air yards (<0, 0–9, 10–19, 20+); groups by roster `position`/`depth_chart_position`
  (CB; S/SS/FS/DB; LB/ILB/MLB; DE/DT/NT/OLB/EDGE/DL).
- [ ] **Step 2: Run** `python3 -I scripts/research-picks.py`.
  Expected: picks 2,055; 20+ S 0.53; behind DL 0.35; pick-six 0.252/0.184/0.043/0.005; breakups 0.308 overall,
  0.350/0.314/0.304/0.273 by band; breakup groups CB 0.467, S 0.194, LB 0.193, DL 0.146; pick PD 0.84.
- [ ] **Step 3: Commit** ("Research: who picks it off, who breaks it up, and the pick's return, nflverse 2021–25").

### Task 2: The shared return bands

**Files:**
- Create: `src/engine/match/returnBands.ts`, `src/engine/match/returnBands.test.ts`
- Modify: `src/engine/match/looseBall.ts` (`returnYards` calls it)

**Interfaces:**
- Produces: `interface Bands { none: number; short: number; mid: number; go: number; tail: number }`;
  `bandReturn(b: Bands, toGoal: number, u: number): number` — the body of today's `returnYards` (0 below `none`, 1–9,
  10–19 uniform, the 20+ band's first `go` share to `toGoal`, the rest `20 + exponential(tail)`), capped at `toGoal`.

- [ ] **Step 1: Write the failing test** `returnBands.test.ts`: `bandReturn(b, 0, u) === 0` for every u; `bandReturn(b,
  5, 0.999) === 5`; `bandReturn(b, 100, u) === 0` for `u < b.none`; within the 20+ band below `go` it returns `toGoal`.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/returnBands.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `bandReturn`; `looseBall.returnYards(group, toGoal, u)` becomes `bandReturn(RETURNS[group],
  toGoal, u)`.
- [ ] **Step 4: Run** `npx vitest run src/engine/match/returnBands.test.ts src/engine/match/looseBall.test.ts` and
  `npm run fumbles -- 3000`. Expected: PASS; the fumbles check prints what it printed on main (the same draws).
- [ ] **Step 5: Commit** ("Engine: the return bands, shared by fumbles and picks").

### Task 3: Who gets to the ball

**Files:**
- Create: `src/engine/match/defendedPass.ts`, `src/engine/match/defendedPass.test.ts`

**Interfaces:**
- Consumes: Task 2's `Bands`, `bandReturn`.
- Produces:
  - `type Band = 'behind' | 'short' | 'mid' | 'deep'`; `depthBand(air: number): Band`.
  - `type PassGroup = 'CB' | 'S' | 'LB' | 'DL'`; `type OnField = Record<PassGroup, Player[]>`.
  - `pickCatcher(band: Band, coverMan: Player, onField: OnField, batter: Player | null, u1: number, u2: number): Player`.
  - `breakupRate(band: Band): number` (0.350, 0.314, 0.304, 0.273).
  - `breakupBy(band: Band, coverMan: Player, onField: OnField, batter: Player | null, u1: number, u2: number): Player`.
  - `batterWeights(front: Player[], pressureBy: Player | null): number[]`; `pickBatter(front, pressureBy, u): Player`.
  - `pickReturn(band: Band, toGoal: number, u: number): number`.
  - `groupOf(p: Player): PassGroup` (CB; S; LB; else DL).
  - Constants `COVER_PICKS: Record<Band, number>`, `COVER_BREAKS: Record<Band, number>` (first guesses 0.6, 0.6, 0.6,
    0.5 and 0.55 each; Task 7 fits), `PICK_GROUPS` (spec §1's table), `BREAK_GROUPS` (CB 0.467, S 0.194, LB 0.193, DL
    0.146), `PICK_RETURNS: Record<Band, Bands>` (spec §1's bands, `go` 0.6, `tail` 4 to start).

- [ ] **Step 1: Write the failing tests** in `defendedPass.test.ts`:
  - `depthBand(-1) === 'behind'`, `depthBand(0) === 'short'`, `depthBand(9) === 'short'`, `depthBand(10) === 'mid'`,
    `depthBand(20) === 'deep'`.
  - `pickCatcher(b, cover, f, null, 0, u) === cover` for every band.
  - Over u2 in 0…1 with u1 = 0.99: `'deep'` never returns a DL man; `'behind'` returns the batter for the line's share.
  - With `onField.LB = []` every u2 returns a CB, S or DL man (Review Focus); with every group empty but the cover man it
    returns the cover man.
  - Within a group, the man with ball skills 18 is returned for more u2 values than the one with 6.
  - `batterWeights(front, null)` all positive, taller first (Review Focus); `pressureBy` in `front` weighs double.
  - `breakupRate('behind') > breakupRate('deep')`; `pickReturn('deep', 0, u) === 0`; `pickReturn('short', 50, 0.999) ===
    50`.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/defendedPass.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** with each table commented with its NFL source line.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: who picks it off, who breaks it up, and the pick's return").

### Task 4: The engine

**Files:**
- Modify: `src/engine/match/gameSim.ts` (the pick branch ~L3576–3591, the incompletion branch ~L3594–3600)
- Test: new `src/engine/match/defendedPass.engine.test.ts`; re-take pinned games (`personnel.test.ts` hash, the re-sign
  and ball-path snapshots) as the dice move, each a ledger ruling

**Interfaces:**
- Consumes: Task 3's functions.
- Produces: `interface DefendedTap { band: Band; outcome: 'pick' | 'breakup' | 'none'; group?: PassGroup; batted: boolean;
  returnYds?: number; pickSix?: boolean; pd?: boolean }`; `SimOptions.defendedTap?: (tap: DefendedTap) => void`, fired
  once per pass that isn't completed: `'pick'`, `'breakup'` (an incompletion credited) or `'none'` (an incompletion
  nobody broke up). Completions aren't tapped.

- [ ] **Step 1: Write the failing tests** (40 games of league `picks-t`, taps collected):
  - every pick and every incompletion logged has a tap; every tap's `group` matches the named man's `groupOf`;
  - `defInt` totals the pick taps; `passDef` totals breakup taps plus picks with `pd`;
  - a batted tap's text has `, batted down at the line by`; a tipped pick's entry has `air` at the line of scrimmage
    (`|air − from| ≤ 1`) and its turnover spot there (Review Focus);
  - every pick in the 40 games at `spot >= 100` has `returnYds === 0` and no TOUCHDOWN on its return (a touchback,
    Review Focus).
- [ ] **Step 2: Run** `npx vitest run src/engine/match/defendedPass.engine.test.ts`. Expected: FAIL (`defendedTap` absent).
- [ ] **Step 3: Implement:** `band = depthBand(air)`; the batter `pickBatter([...def.dt, ...def.edge], this.pressureBy,
  rng.next())`; the pick: catcher by `pickCatcher`, a DL catcher means tipped (spot = `this.yardLine + 1`, the entry's
  `air` there), `returnYds = spot >= 100 ? 0 : pickReturn(band, spot, rng.next())` (`toGoal` = `spot`, the defense's yards
  to the end zone), `passDef` when `rng.chance(PICK_PD)` (0.84); the incompletion: `rng.chance(breakupRate(band))`, the man
  by `breakupBy`, the batted copy when he's DL. Draw order fixed, as today's: the roll, then the catcher's draws, then the
  return.
- [ ] **Step 4: Run** `npx vitest run src/engine/match src/engine/personnel src/engine/offseason/offseason.test.ts
  src/ui/stage/ballPath.test.ts`; re-take what the dice moved. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: picks and breakups from the throw's depth and the men at the ball").

### Task 5: The checks

**Files:**
- Create: `scripts/picks-core.ts`, `scripts/picks-core.test.ts`, `scripts/picks.ts`
- Modify: `package.json` (`"picks": "tsx scripts/picks.ts"`), `scripts/calibrate.ts`, `scripts/check.ts` (rule
  `[/^scripts\/picks(-core)?\.ts$/, ['sim']]`)

**Interfaces:**
- Consumes: Task 1's tables; Task 4's `DefendedTap`.
- Produces: `newPickTally()`, `tapDefended(t, tap)`, `judgePicks(t): Line[]`: who intercepts by band; breakups per
  incompletion by band (`'breakup'` over `'breakup'` + `'none'`); breakup groups; the pick's 20+ share and pick-six by
  band; the share of picks crediting a pass defensed; mean returns reported only.

- [ ] **Step 1: Write the failing test** `picks-core.test.ts`: a tally of 2,000 deep picks with S 0.53 judges `picks,
  deep: by safeties` in range, one with S 0.2 ✗; a mean return line is `info`.
- [ ] **Step 2: Run** `npx vitest run scripts/picks-core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** (shares through the `share`/`per100` helpers' pattern in `fumbles-core.ts`, `printLine` from
  `sideline-core.ts`); `picks.ts` plays AI games as `fumbles.ts` does; `calibrate.ts` taps the weeks it replays and prints
  "Picks and breakups".
- [ ] **Step 4: Run** the test, then `npm run picks -- 3000` (✗ allowed until Task 7). Expected: PASS; every line printed.
- [ ] **Step 5: Commit** ("Checks: npm run picks, picks and breakups against nflverse").

### Task 6: The film

**Files:**
- Modify: `src/engine/field/ballPath.ts` (a batted incompletion's flight), `src/engine/field/scripts.ts` (the batter at the
  line), `src/engine/playActors.ts` if the batter needs naming
- Test: `src/ui/stage/batted.test.ts`

**Interfaces:**
- Consumes: Task 4's copy.

- [ ] **Step 1: Write the failing tests:** an incompletion with `, batted down at the line by X` draws its flight ending
  within 1.5 yards of the line (`from`) at a peak no higher than 3, X staged within 1.5 yards of the ball's end, squared to
  the passer (his x between the ball and the passer's); the same entry without the words draws to `air` as today (Review
  Focus); a tipped pick's catcher holds the ball at the line.
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/batted.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:** `basePath` reads the batted words (a regex like `field/fumble.ts`'s) and ends the flight a
  yard past the line; the stager keys the batter to the ball's end at its arrival (reach-checked as the fumble's hitter is).
- [ ] **Step 4: Run** `npx vitest run src/ui/stage src/engine/field` and fix what the reshuffled games expose (ledger
  rulings). Expected: PASS.
- [ ] **Step 5: Commit** ("Film: a ball batted or tipped at the line").

### Task 7: Fit and hold the league

**Files:**
- Modify: `src/engine/match/defendedPass.ts` (`COVER_PICKS`, `COVER_BREAKS`, each band's `go` and `tail`),
  `docs/ATTRIBUTES.md`

- [ ] **Step 1: Fit offline** on weeks 1 and 10 of 120 played seasons (a scratch recorder like 0.4.7's, taps with the
  cover man's group and the spot): the cover shares to the group splits by band, the breakaway shares to the pick-sixes
  by band. Then `npm run picks -- 3000`. Expected: 0 lines out.
- [ ] **Step 2: Hold the league:** `npm run sim -- 20` (no ✗; picks a game and the leaders' picks), `npm run fumbles --
  3000` (0 out: the shared bands), `npx tsx scripts/check.ts endings weather`, the audit (commit `docs/ATTRIBUTES.md`).
  `quirks --effects` (Ball Hawk), `parity`, `film` and the 60-season sim are CI's.
- [ ] **Step 3: Run** the full `npx vitest run` alone; re-take what the dice move; if `morale.rng.test.ts` splits, find the
  mood consumer and hold it as its comments do. Expected: all PASS.
- [ ] **Step 4: Commit** ("Picks and breakups: fitted to nflverse 2021–25").

### Task 8: Docs and version

**Files:**
- Modify: `docs/MVP.md`, `CLAUDE.md`, `src/ui/changelog.ts`, `package.json`, the spec's status line

- [ ] **Step 1:** `docs/MVP.md`: tick "after an interception" with what it does and the fitted numbers (0.4.8); the Low
  line Partial (breakups done; return touchdowns left). CLAUDE.md: `npm run picks [-- games]` beside `npm run fumbles`;
  `match/defendedPass.ts` and `match/returnBands.ts` beside `match/looseBall.ts`. A 0.4.8 changelog entry (a player's
  view: a safety picks off the deep ball, a jumped short route goes the other way, a tall end bats it down at the line).
  `package.json` 0.4.8. The spec's status: built (0.4.8).
- [ ] **Step 2: Run** `npm run typecheck`, `npx vitest run src/ui/ui.test.ts src/ui/changelog.test.ts`,
  `npm run format:check`. Expected: PASS.
- [ ] **Step 3: Commit** ("0.4.8: picks and breakups"), push, open the PR.
