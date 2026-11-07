# How a Play Ends Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sack's yards from the NFL's shape and the situation, the slide as the scrambler's choice (40% for the league,
leaned by the sticks, the clock, the man), and every chosen ending (out of bounds, a slide, fighting for it) saying why in
the text and showing it on film.

**Architecture:** A pure module `match/dropbackEnd.ts` (no draws) beside `looseBall.ts` and `defendedPass.ts`; a pure
`stepReason` in `sideline.ts`; `gameSim.ts` draws and writes the words; the field reads new `FieldFacts` (`ex`, `ow`,
`sw`, `tc`) to stage them; `npm run dropback` judges against nflverse, as `npm run picks` does.

**Tech Stack:** TypeScript, Vitest, tsx scripts, Python/pandas for the research script.

**Spec:** `docs/superpowers/specs/2026-11-07-dropback-endings-design.md`

## Global Constraints

- Engine: no `Math.random`; draws only through the game's `Rng`; ratings only through `skill()`; makeup through
  `temperamentOf`/`poiseOf` (never `p.traits`); concussions through `concussionCount` (`injuries.ts`); size through
  `sizeZ`; habits through `this.holds`/`this.has` in `gameSim.ts`.
- `dropbackEnd.ts` and `stepReason` draw nothing and read no league.
- League shape unchanged: no `SAVE_VERSION` bump. New `FieldFacts` fields are optional; `FIELD_VERSION` 11 → 12.
- The slide's league share is held at 0.40 (the owner's call). In-bounds scrambles credit a tackler 0.932 (NFL).
- The plain fight text is `, fights for every yard` (not the spec's "fighting for the extra yard": that phrase is the
  fumble film's 'fight' reason, `field/fumble.ts`). Every other phrase exactly as spec §4.
- A judged share needs its tolerance ≥ 3.5 standard errors and an NFL sample ≥ 200, else it is reported. Never loosen a
  range to get green.
- The owner's one-push rule: commit locally; push once when every task is green locally (the PR's CI runs once).

## Review Focus

- **A sack on his own 1–3:** the loss never passes his goal line; reaching it is a safety, as today. Test in Task 2
  (`sackLoss` at yardLine 0–5) and Task 4 (every sack's loss ≤ its yardLine).
- **A scramble that ends exactly at the sticks on 3rd down:** the first down is in hand (gained ≥ toGo) and he isn't
  "short of the sticks". Test in Task 2.
- **An old save's play text** (", steps out of bounds", ", slides", no reason): parsed as stepped/slid, drawn as today.
  Test in Task 3 (`outOfBoundsIn`) and Task 5 (film).
- **A slide nobody touched** (the 7%): no tackle credited, no "(X)" in the text, no film toucher. Test in Task 4.
- **A step-out in the hurry-up with a defender closing:** the reason is the clock (the clock outranks the hit), and the
  film sends nobody. Test in Task 3 and Task 5.

---

### Task 1: The NFL's numbers

**Files:**

- Create: `scripts/research-dropback.py`
- Modify: `docs/superpowers/specs/2026-11-07-dropback-endings-design.md` §1 (only if a number differs)

- [ ] **Step 1: Write `scripts/research-dropback.py`** in the shape of `scripts/research-picks.py` (same cache dir,
      download loop, REG only, `python3 -I`). It prints, as paste-ready TS consts:
  - `SACK_LOSS_NFL`: the loss histogram (shares of 0, 1, …, 14, 15+ yards) for sacks in the pocket and out of it (FTN
    `is_qb_out_of_pocket`, 2022–25), with each n; the out-of-pocket share of sacks;
  - mean loss by down (1–4), on 3rd and 8+ / under 8, by rushers (3, 4, 5, 6+; participation `number_of_pass_rushers`),
    by the ball's spot (own 21+, 11–20, 6–10, 1–5), each with n; sacks that are safeties per 1,000;
  - the QB spread: sd of the means of QBs with 40+ sacks and the luck sd;
  - scrambles that end in bounds without a touchdown, the share crediting a tackler (solo, assist or with assist), n.
- [ ] **Step 2: Run** `python3 -I scripts/research-dropback.py`. Expected: overall mean 6.66, out-of-pocket share ≈0.228,
      tackler credited ≈0.932, down means 6.10/6.39/7.16/7.83. Where a number differs from spec §1, correct §1.
- [ ] **Step 3: Commit** ("Research: sacks' yards and scrambles' endings, nflverse and FTN 2021–25").

### Task 2: `match/dropbackEnd.ts`

**Files:**

- Create: `src/engine/match/dropbackEnd.ts`, `src/engine/match/dropbackEnd.test.ts`

**Interfaces:**

- Consumes: Task 1's `SACK_LOSS_NFL` tables.
- Produces:
  ```ts
  export interface SackFacts { down: number; toGo: number; yardLine: number; call: DefenseCall;
    qb: { pocketPresence: number; scrambling: number; has(q: QuirkId): boolean } }
  export function escapeOdds(f: SackFacts): number;
  export function sackLoss(f: SackFacts, escaped: boolean, u: number): number; // 0..yardLine, integer
  export interface SlideFacts { down: number; toGo: number; gained: number; scoreDiff: number; late: boolean;
    toGoal: number; qb: { scrambling: number; weightZ: number; temperament: number; poise: number; age: number;
    concussions: number; energy: number; hurt: number; has(q: QuirkId): boolean };
    chaser: { tackling: number; has(q: QuirkId): boolean } }
  export type SlideReason = 'firstDown' | 'clock' | 'hit';
  export function slideOdds(f: SlideFacts): number;
  export function slideReason(f: SlideFacts): SlideReason;
  export function fightsForIt(f: SlideFacts): boolean;
  export const TOUCHED: number; // a slider touched down (tackle credited)
  ```
  `toGoal` is yards to the end zone after the gain; `late` is 4th quarter, 5:00 or less; `hurt` as `SidelineCarrier.hurt`.

- [ ] **Step 1: Write the failing tests** (`dropbackEnd.test.ts`, facts built by a `sackFacts(over)` / `slideFacts(over)`
      helper around a typical man: pocket presence 12, scrambling 12, temperament 10.5, poise 10, age 27, energy 85,
      no habits):
  - `sackLoss` never exceeds `yardLine` for yardLine 0–5 over u in [0,1); `sackLoss(f, false, 0)` is 0 (no loss
    possible); integer results.
  - Mean over a u grid: 3rd and 10 > 1st and 10; `call: 'blitz'` > `'base'` > `'passD'`; escaped < in the pocket; at
    yardLine 8 < at yardLine 40; pocket presence 16 < 8; `muddyPockets` > none.
  - `escapeOdds`: typical ≈ 0.228 (±0.03); scrambling 16 > 12; `bailsEarly` > none.
  - `slideOdds`: first down in hand > short of it; leading late > tied; trailing late < tied; 3rd and 5 gained 3 <
    2nd and 5 gained 3; inside the 5 (toGoal 3) < at midfield; a thumper chasing > none; concussions 2 > 0; scrambling
    16 < 12; `gunslinger` < none; `bailsEarly` > none; all in (0, 1).
  - **Review Focus:** 3rd and 4 gained exactly 4 → first down in hand (`slideReason` 'firstDown', `fightsForIt` false).
  - `slideReason`: first down, no lead → 'firstDown'; short of it, leading late → 'clock'; short of it, not late, thumper
    chasing → 'hit'.
  - `fightsForIt`: 3rd/4th short of the sticks → true; 2nd short with temperament 5 → true, temperament 12 → false;
    first down gained → false.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/dropbackEnd.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement.**
  - `sackLoss`: inverse CDF of the pocket or out-of-pocket table at `u`, plus a shift (added before rounding, clamped
    0..yardLine): down (spec §1's mean less the overall), +0.5 on 3rd and 8+, call `passD` −0.7 / `blitz` +0.65, pocket
    presence −0.08 a point over 12, `muddyPockets` +0.6, ball at own 11–20 −0.4, own 10 or in −1.0.
  - `escapeOdds`: logistic, base fitted to 0.228, +0.12 a scrambling point over 12, `bailsEarly` +0.6.
  - `slideOdds`: logistic, `SLIDE_BASE` (fitted in Task 7 to hold 0.40), with leans: first down +0.8; leading late +0.7;
    trailing late −0.8; 3rd/4th short of the sticks −1.0; toGoal ≤ 5 −0.8; chaser tackling +0.04 a point over 12,
    `thumper` +0.3; energy under 60 +0.3; hurt +0.15 each; concussions +0.25 each (to 3); temperament +0.04 a point over
    10.5; age +0.05 a year over 28; scrambling −0.08 a point over 12; weightZ −0.2; `bailsEarly` +0.4, `seesGhosts`
    +0.3, `gunslinger` −0.4.
  - `slideReason`: the largest of three groups' contributions (first down: its term; clock: leading late; hit: the
    chaser, energy, hurt, concussions, temperament, age, habits), ties in that order.
  - `TOUCHED` starts at 0.89 (fitted in Task 7).
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: dropbackEnd, a sack's yards and the slide as odds").

### Task 3: Why he went out (`sideline.ts`)

**Files:**

- Modify: `src/engine/match/sideline.ts`, `scripts/sideline-core.ts`, `scripts/parity.ts:168-205`
- Test: `src/engine/match/sideline.test.ts`

**Interfaces:**

- Produces:
  ```ts
  export type StepReason = 'clock' | 'hit';
  export function stepReason(f: SidelineFacts): StepReason | null; // clock if f.clock==='out'; else hit if !f.free; else null
  export function outOfBoundsIn(text: string): 'pushed' | 'stepped' | null; // any of the §4 step texts → 'stepped'
  export const OUT_TEXT: { pushed: string; clock: string; hit: string; stepped: string };
  ```
- [ ] **Step 1: Write the failing tests:** `stepReason` → 'clock' for clock 'out' (also when not free: **Review
      Focus**), 'hit' for clock 'none' and not free, null when free; `outOfBoundsIn` reads `, pushed out of bounds` →
      'pushed', `, steps out of bounds`, `, steps out of bounds to stop the clock`, `, gets out of bounds before the hit` →
      'stepped', a kickoff out of bounds and a plain run → null (**Review Focus**: the old text still reads).
- [ ] **Step 2: Run** `npx vitest run src/engine/match/sideline.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** with `OUT_TEXT = { pushed: ', pushed out of bounds', clock: ', steps out of bounds to stop the
      clock', hit: ', gets out of bounds before the hit', stepped: ', steps out of bounds' }`; `sideline-core.ts` and
      `parity.ts` read pushed/stepped through `outOfBoundsIn` instead of their regexes.
- [ ] **Step 4: Run** the test file and `npx vitest run scripts/sideline-core.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** ("Sideline: the reason a man steps out").

### Task 4: The engine

**Files:**

- Modify: `src/engine/match/gameSim.ts` (`sack()` ~4123, `scramble()` ~4258, `outText` ~2721, `contact()` ~4040,
  `SimOptions`, `ContactTap`), `src/engine/field/moment.ts` (`FieldFacts`)
- Test: `src/engine/match/dropbackEnd.engine.test.ts`; re-pins in `src/engine/personnel/personnel.test.ts`,
  `src/engine/offseason/__snapshots__/offseason.test.ts.snap`

**Interfaces:**

- Consumes: Task 2 (all), Task 3 (`stepReason`, `OUT_TEXT`).
- Produces:
  ```ts
  export interface DropbackTap { kind: 'sack' | 'scramble' | 'out'; down: number; toGo: number;
    call?: DefenseCall; escaped?: boolean; loss?: number; yardLine?: number; safety?: boolean;     // sacks
    slid?: boolean; reason?: SlideReason | 'fight' | null; tackled?: boolean; firstDown?: boolean;  // in-bounds scrambles
    leadingLate?: boolean; trailingLate?: boolean;
    why?: StepReason | 'pushed' | null }                                                            // out of bounds
  SimOptions.dropbackTap?: (tap: DropbackTap) => void;
  ContactTap.slid?: true; // a slide: a contact that can't fumble
  FieldFacts.ex?: 1; ow?: 1 | 2; sw?: 1 | 2 | 3; tc?: 1;
  ```
- [ ] **Step 1: Write the failing tests** (`dropbackEnd.engine.test.ts`, a league seed `dropback-engine`, 8 games with
      `keepPlays` and `dropbackTap`):
  - a tap per sack and per in-bounds non-TD scramble; every sack's loss ≤ its yardLine (**Review Focus**); at least one
    sack of no loss;
  - every slide's text ends with one of the three §4 slide phrases; a slide with `tackled` has "(X)" and credits X a
    tackle, one without has neither (**Review Focus**);
  - every in-bounds scramble's contact tap count equals the scramble taps (slides tap with `slid`, never `fumbled`);
  - a run or catch out of bounds reads one of `OUT_TEXT`'s phrases, and its tap's `why` matches.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/dropbackEnd.engine.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `sack()`: `escaped = rng.chance(escapeOdds(f))` then `loss = sackLoss(f, escaped, rng.next())` in place of the normal
    roll (two draws for one); `ex: 1` to the pocket when escaped; the tap.
  - `scramble()`: `slide = !td && !oob && rng.chance(slideOdds(f))` (the 0.4 draw's place); when slid, `touched =
    rng.chance(TOUCHED)` right after; credit and name `tackler` when touched; text `, slides …` by `slideReason`
    (`with the first down in hand` / `to keep the clock running` / `to avoid the hit`); `, fights for every yard` after
    the tackler when `fightsForIt` and not a slide and no fumble; `sw` (1/2/3) and `tc` to the field; a slide emits a
    contact tap with `slid: true`, `fumbled: false` and the facts `contact()` builds (extract a `contactFacts(...)`
    helper both use); the tap.
  - `outText(call, why)`: `OUT_TEXT` by `stepReason` for stepped, pushed as today; `ow` (1 clock, 2 hit) to the field on
    runs, catches and scrambles; an 'out' tap.
  - `PlayResult`'s "man in coverage" comment back above `defender` (spec §10).
- [ ] **Step 4: Run** the engine test, `npx vitest run src/engine/match src/engine/personnel src/engine/offseason/offseason.test.ts`;
      re-pin the personnel result hash and the re-sign snapshot (`-u` on that one test) — the dice moved. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: a sack's yards, the slide and why he went out").

### Task 5: The film

**Files:**

- Modify: `src/engine/field/run.ts` (~285 escort, ~326 tackler), `src/engine/field/pocketField.ts` (the sack's QB
  path), `src/engine/field/pocketMoment.ts:~420` and `src/engine/field/approach.ts:~236` (pass `ow`/`sw`/`tc`/`ex` into
  the target/start), `src/engine/field/types.ts` (target gains `why?: 1 | 2; slideWhy?: 1 | 2 | 3; touched?: boolean`;
  `PocketStart.escaped?: boolean`), `src/engine/field/ballPath.ts` (`batDown`), `src/engine/field/tuning.ts`
  (`FIELD_VERSION` 12)
- Test: `src/ui/stage/endings.test.ts`, `src/ui/stage/batted.test.ts`

**Interfaces:**

- Consumes: Task 4's `FieldFacts.ex/ow/sw/tc`.

- [ ] **Step 1: Write the failing tests** (`endings.test.ts`, a league with the field on, games until each case is found):
  - a step-out with `ow` 2: a defender within 2 yards of him as he crosses the sideline;
  - a step-out with `ow` 1: no escort sent (nobody required near) (**Review Focus**: hurry-up with a man closing);
  - a slide with `sw` 3 and `tc`: the credited toucher within 2.5 yards as he goes down; a slide without `tc`: no
    defender credited;
  - an escaped sack (`ex`): the quarterback's last spot is outside the tackle box (more than 4 yards across from the
    snap) and the sack lands at today's spot;
  - **Review Focus:** an old save's entry (`, steps out of bounds`, `, slides`, no `ow`/`sw`) stages as before.
  - `batted.test.ts`: a batted throw behind the line ends at the nearer of the line and the target, never past the
    target (spec §10).
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/endings.test.ts src/ui/stage/batted.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement:** `run.ts` sends the escort when `why` is 2 or (no `why` and today's rule), never when `why` is
      1; a slide with `touched` brings the nearest chaser to him by the slide and makes him the tackler, without it no
      tackler; `pocketField.ts` on a sack with `escaped` runs the rollout path (`ROLL_OUT` side, as `awayOut`) until the
      sack's time and ends at `sackX`; `batDown` ends at the nearer of `lineX + dir` and the target's x.
- [ ] **Step 4: Run** `npx vitest run src/ui/stage src/engine/field` and fix what the reshuffled games expose (ledger
      rulings). Expected: PASS.
- [ ] **Step 5: Commit** ("Film: why he went out, the slide's toucher, an escaped sack").

### Task 6: `npm run dropback` and the film lines

**Files:**

- Create: `scripts/dropback-core.ts`, `scripts/dropback-core.test.ts`, `scripts/dropback.ts`
- Modify: `package.json` (`"dropback": "tsx scripts/dropback.ts"`), `scripts/calibrate.ts`, `scripts/check.ts`
  (rule `[/^scripts\/dropback(-core)?\.ts$/, ['sim']]`), `scripts/parity.ts` (film lines)

**Interfaces:**

- Consumes: Task 4's `DropbackTap`; `share` from `scripts/fumbles-core.ts`; Task 1's tables.
- Produces: `newDropbackTally(): DropbackTally`, `tapDropback(t, tap): void`, `judgeDropback(t): Line[]`.

- [ ] **Step 1: Write the failing tests** (`dropback-core.test.ts`): a tally of sacks with the NFL's no-loss share judges
      `sacks: no loss` in range and one at 0.25 out of it; slide shares are `info` (reported, never judged).
- [ ] **Step 2: Run** `npx vitest run scripts/dropback-core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the lines: judged (shares by `share`, tolerances 0.03 for shape shares, 0.06 for the
      escaped share and tackler credited; means within 0.5 yards once that clears 3.5 standard errors, else reported):
      `sacks: no loss`, `10+`, `15+`, `mean, down N`, `mean, in the pocket / out of it`, `escaped share`, `mean, backed up
      (own 20 in)`, `scrambles in bounds: a tackler credited`; reported: `mean by call` (NFL by rushers beside it), `slide
      share` overall and by first down / lead late / trail late / 3rd-4th short, each reason's share. `dropback.ts` plays
      `--games` AI games (default 3000, seeds `dropback-${k}`) and prints the lines; `calibrate.ts` taps and prints them
      under "How a play ends". `parity.ts`'s film worker adds scrambles and: `before the hit with a defender within 2 yd`
      (range [0.8, 1]), `stopping the clock with an escort sent` (reported), `sliding from the hit with the toucher within
      2.5 yd` (range [0.8, 1]).
- [ ] **Step 4: Run** the core test; `npm run dropback -- 3000` (✗ allowed until Task 7). Expected: PASS; every line
      prints.
- [ ] **Step 5: Commit** ("Checks: npm run dropback, how a play ends against nflverse").

### Task 7: Fit and hold the league

**Files:**

- Modify: `src/engine/match/dropbackEnd.ts` (`SLIDE_BASE`, `TOUCHED`, the escape base and the loss shifts),
  `src/engine/match/fumbleOdds.ts` (the scramble contact base), `docs/ATTRIBUTES.md`

- [ ] **Step 1: Fit** on weeks 1 and 10 of played seasons (as the sim reads them): `SLIDE_BASE` to a 0.40 slide share,
      `TOUCHED` to 0.932 credited, the escape base to 0.228, the shifts to the judged means; the scramble contact base so
      fumbles per in-bounds scramble (slides counted) land on the NFL's (`npm run fumbles -- 3000`).
- [ ] **Step 2: Run** `npm run dropback -- 3000`. Expected: 0 lines out.
- [ ] **Step 3: Hold the league:** `npm run sim -- 20` (no ✗), `npm run fumbles -- 3000`, `npm run passer -- 3000`,
      `npm run sideline -- 3000` (0 out each), `npx tsx scripts/check.ts endings parity`, `npm run audit` (commit
      `docs/ATTRIBUTES.md`).
- [ ] **Step 4: Run** the full `npx vitest run` alone; re-take what the dice move; a world fixture that breaks gets its
      fixture fixed, never its rule (ledger rulings). Expected: all PASS.
- [ ] **Step 5: Commit** ("How a play ends: fitted to nflverse 2021–25").

### Task 8: Docs, version and the one push

**Files:**

- Modify: `docs/MVP.md`, `CLAUDE.md`, `src/ui/changelog.ts`, `package.json`, the spec's status line

- [ ] **Step 1:** `docs/MVP.md`: tick "a sack's yards and strip" and "a scramble's slide" with what they do and the fitted
      numbers (0.4.10); add to "a play's time": the first-half kneel ignores timeouts and a realistic shot (the owner,
      Nov 7). CLAUDE.md: `npm run dropback [-- games]` beside `npm run picks`; `match/dropbackEnd.ts` beside
      `match/defendedPass.ts`; `stepReason` in `match/sideline.ts`'s entry. Changelog 0.4.10 (a player's view: sacks
      that cost nothing and ones that cost fifteen, a quarterback who slides with the first down in hand and one who
      fights for it, a runner who gets out before the hit or to stop the clock, and the film showing why). `package.json`
      0.4.10. Spec status: built (0.4.10).
- [ ] **Step 2: Run** `npm run typecheck`, `npx vitest run src/ui/ui.test.ts src/ui/changelog.test.ts`,
      `npm run format:check`. Expected: PASS.
- [ ] **Step 3: Commit** ("0.4.10: how a play ends"), push once, open the PR.
