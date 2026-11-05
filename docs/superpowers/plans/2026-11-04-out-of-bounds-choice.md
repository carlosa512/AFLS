# Out of Bounds as the Carrier's Choice: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat out-of-bounds roll (`pOut`) on runs, catches and scrambles with a pushed-out / stepped-out
decision read from the play, the situation and the men in it, fitted to nflverse, with the NFL's clock rule after a man
goes out.

**Architecture:** A pure module, `src/engine/match/sideline.ts`, turns a play's facts into two odds; `gameSim.ts` takes
one draw on the game's stream before the field runs and uses the call in every game (AI and yours). The field plays the
call out (`FieldFacts.oob` 1 pushed, 2 stepped). A stepped-out play carries no hit; outside the late windows the clock
pauses for the spot. A script judges the league against the NFL's buckets; `npm run sim` and `npm run parity` carry the
checks.

**Tech Stack:** TypeScript, Vitest, `tsx` scripts; Python 3 + pandas for the nflverse measurement.

**Spec:** `docs/superpowers/specs/2026-11-04-out-of-bounds-choice-design.md`

## Global Constraints

- All randomness through the seeded `Rng` on the game's stream (`this.rng`); no `Math.random`. The field keeps its own
  streams (`${seed}:field:${index}`).
- The engine reads ratings only through `skill(p, contest)`; poise only through `poiseOf(p)`; build only through
  `sizeZ(p)`. Hidden traits never shown as numbers.
- Call H stands: today's rolls decide the yards; the call decides only how the play ends.
- No save upgrade: `FieldFacts.oob` widens from `1` to `1 | 2`; old play text stays as it is.
- Play text endings, exactly: `", pushed out of bounds"` and `", steps out of bounds"`.
- Targets (spec §6): each bucket within 3 points of the NFL's or 20% of its value, whichever is wider; each kind's total
  within 1.5 points; the real spread between players within ±30% of the NFL's; the clock gap within 1.5 s of the NFL's.
- Never loosen a check's range to get green. `npm run format` before every commit.
- Comments explain why; each fitted constant cites the NFL number it is fitted to.
- Version `0.4.3` (`docs/VERSIONING.md`, the last number). Subagents: haiku for mechanical work, sonnet for judgment.

## Review Focus

- **A lone carrier in normal play stepping out** (the bug this fixes): with room ahead and nothing on the clock he stays
  in. Pinned in Task 2 (`a free carrier in normal play rarely steps out`).
- **A team protecting a lead stopping the clock for the other side:** a carrier milking it steps out less than in
  normal play, and less again than one hurrying. Pinned in Task 2 (`the clock orders stepping out`); `npm run endings` in
  Task 8.
- **Touchdowns and lost fumbles going out of bounds, or a man who stepped out fumbling:** never. Pinned in Task 4
  (`no touchdown or lost fumble is out of bounds; a man who steps out never fumbles`).
- **The spotting pause at the edges:** none inside the windows (overtime's last 5:00 included), the two-minute warning
  still fires when a runoff crosses 2:00, a runoff never goes below zero. Pinned in Task 6.
- **Old saves' film:** `oob: 1` and the old text `", out of bounds"` still play and call "out". Pinned in Task 7.

---

### Task 1: The NFL measurement, committed

**Files:**
- Create: `scripts/research-sideline.py`
- Modify: `.gitignore` (add `.cache/`)

**Interfaces:**
- Produces: `python3 -I scripts/research-sideline.py [cache dir, default .cache/nflverse]`, printing the spec's §1
  tables. The numbers it prints are the constants' sources in Tasks 2, 3 and 6.

- [ ] **Step 1: Write the script** from the session's scratchpad measurements
  (`/tmp/claude-0/-home-user-AFLS/e4877f9a-a536-598d-b37f-4ca0365c4ff5/scratchpad/nfl_oob*.py`; if they're gone, spec
  §1's first paragraph defines every filter and bucket). One script, sections in spec §1's order: catches, runs (outside
  = `run_gap` end or tackle), scrambles, per team-game, between players, how each ending is scored, the clock. It
  downloads any missing `play_by_play_{2021..2025}.csv.gz` from
  `https://github.com/nflverse/nflverse-data/releases/download/pbp/` into the cache dir (as `research-squads.py` does).

- [ ] **Step 2: Run it and compare to the spec**

Run: `python3 -I scripts/research-sideline.py`
Expected: catches all 22.4% (pushed 16.8, stepped 5.7); runs outside 11.1%, inside 0.7%; scrambles 35.9%; clock rows
38.5 / 34.5 / 33.2 s on sideline catches; every other row as in spec §1.

- [ ] **Step 3: Commit**

```bash
git add scripts/research-sideline.py .gitignore
git commit -m "Research: the NFL's out-of-bounds plays by situation (nflverse 2021-25)"
```

### Task 2: `sideline.ts`, the decision

**Files:**
- Create: `src/engine/match/sideline.ts`
- Test: `src/engine/match/sideline.test.ts`

**Interfaces:**
- Produces (exact):

```ts
export type SidelineKind = 'run' | 'catch' | 'scramble';
/** What the clock asks of him, only when going out stops it (`oobStopsClock`): out (hurrying), in (milking), none. */
export type ClockAsk = 'out' | 'in' | 'none';
export interface SidelineCarrier {
  position: Position; // his position: WR, TE, RB lean differently on catches
  speed: number;      // skill(p, 'longSpeed')
  build: number;      // sizeZ(p).w
  energy: number;     // in-game energy, 0–100
  hurt: number;       // InjuryRecords this season and last, capped at 3
  poise: number;      // poiseOf(p), 1–20
  has(q: QuirkId): boolean;
}
export interface SidelineChaser { pursuit: number; tackling: number; has(q: QuirkId): boolean }
export interface SidelineFacts {
  kind: SidelineKind;
  wide: number;          // |lane|: 0 the middle, 1 the sideline
  run: number;           // yards he ran with it: a run's or scramble's gain, a catch's yards after the catch
  free: boolean;         // he broke a tackle (open.broke) or got past the safety (open.gone)
  clock: ClockAsk;
  shortOfSticks: boolean; // 3rd or 4th down, the gain short of the line to gain
  edge: number;          // runs: the edge setter's skill(p, 'setEdge'); TYPICAL.edge otherwise
  carrier: SidelineCarrier;
  chaser: SidelineChaser;
}
export interface SidelineOdds { pushed: number; stepped: number } // stepped: if not pushed
export type SidelineCall = 'in' | 'pushed' | 'stepped';
export const TYPICAL = { speed: 12, pursuit: 12, tackling: 12, edge: 12, poise: 10, energy: 85 } as const;
export function sidelineOdds(f: SidelineFacts): SidelineOdds;
export function sidelineCall(o: SidelineOdds, u: number): SidelineCall;
/** The chance a tackle is credited when he stepped out: 1 on runs and scrambles; catches about half (NFL 50%). */
export function steppedCredit(f: SidelineFacts): number;
```

- [ ] **Step 1: Write the failing tests** in `sideline.test.ts`, with a `typical(kind, over)` fixture: `TYPICAL`
  values, `wide: 1`, `run: 4`, `free: false`, `clock: 'none'`, `shortOfSticks: false`, `position: 'WR'` (QB for
  scrambles, RB for runs), `build: 0`, `hurt: 0`, no habits.

```ts
it('a free carrier in normal play rarely steps out', () => {
  expect(sidelineOdds(typical('catch', { free: true, run: 12 })).stepped).toBeLessThan(0.02);
});
it('the sideline raises both odds over the middle', () => { /* wide 1 vs wide 0: pushed and stepped both higher */ });
it('long gains get pushed out more', () => { /* run kind, run 20 vs run 0: pushed higher */ });
it('the clock orders stepping out', () => {
  // for each kind: stepped with clock 'in' < 'none' < 'out'
});
it('short of the sticks he fights for the marker', () => { /* shortOfSticks true: stepped lower */ });
it('each habit leans its way', () => {
  // stepped up: contactAverse, hearsFootsteps, runsEastWest, bailsEarly (scramble); down: finishesForward, yacSlasher,
  // highKnee. pushed up: carrier runsEastWest, bouncesExternal (run); chaser alleyCrusher, scraper, businessDecision.
  // pushed down: chaser thumper.
});
it('ratings lean their way', () => {
  // pushed: chaser pursuit +5 up, tackling +5 down, edge +5 down (run); carrier speed +5 up.
  // stepped: build +2 down, energy 60 up, hurt 2 up; TE and RB below WR on catches.
});
it('poise sharpens the clock read', () => {
  // poise 18 vs 4: stepped further above 'none' under 'out', further below under 'in'.
});
it('a typical starter sits on the base odds', () => {
  // flipping nothing: odds equal the logistic of the kind's base terms alone (terms centred on TYPICAL)
});
it('odds stay in bounds', () => { /* extreme facts: 0.002 <= pushed <= 0.6, 0.001 <= stepped <= 0.65 */ });
it('one draw makes the call', () => {
  const o = { pushed: 0.2, stepped: 0.5 };
  expect(sidelineCall(o, 0.1)).toBe('pushed');
  expect(sidelineCall(o, 0.5)).toBe('stepped'); // 0.2 + 0.8 * 0.5 = 0.6
  expect(sidelineCall(o, 0.7)).toBe('in');
});
it('credit on a stepped-out play', () => {
  expect(steppedCredit(typical('run', {}))).toBe(1);
  expect(steppedCredit(typical('catch', { free: true }))).toBeLessThan(steppedCredit(typical('catch', {})));
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/match/sideline.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `sideline.ts`.** Both odds are `logistic(sum of terms)`, every term centred on `TYPICAL` (zero
  for a typical starter). Starting values below come from the NFL's rates; Task 8 fits them. Each constant gets a comment
  with its NFL number.

| Constant | catch | run | scramble | Reads |
|---|---|---|---|---|
| `PUSH_BASE` | −4.1 | −6.1 | −1.77 | the middle (catch 2.9%, inside run 0.6%); scrambles always run wide (14.6%) |
| `PUSH_WIDE` (× `wide`) | 3.9 | 3.8 | 0 | sideline catch 20.6%, outside run 9.2% |
| `PUSH_RUN` (per yard of `run` over 4, to 20) | 0.07 | 0.1 | 0 | runs: 4.3 / 7.5 / 26.0 / 38.0%; catches by yards after |
| `PUSH_IN` (`clock` 'in') | −0.45 | −0.45 | −0.2 | catches, last 5:00 leading: 11.4% vs 16.8% |
| `STEP_BASE` | −4.6 | −7.0 | −1.1 | stepped given not pushed: middle catch 0.9%, inside run 0.1%, scramble 24.9% |
| `STEP_WIDE` | 2.3 | 3.0 | 0 | sideline catch 8.8%, outside run 2.1% |
| `STEP_OUT` (`clock` 'out') | 0.66 | 0.3 | 0.31 | catches 5.0 → 9.2%, scrambles 20.8 → 26.1% |
| `STEP_IN` (`clock` 'in') | −0.1 | −0.8 | −0.6 | protecting a lead: catches 4.5%, runs 0.9%, scrambles 12.8% |
| `STEP_POS` (catches) | WR 0, TE −1.2, RB −0.8 | | | Kelce 1%, Kittle 2%, Ekeler 1% against WRs' 7.9% |

Shared: `STEP_ROOM_SHORT` +0.8 when `run <= 2`; `STEP_FREE` −1.5 when `free`; `STEP_STICKS` −1.4; habits +0.6
`contactAverse`, +0.5 `hearsFootsteps`, +0.4 `runsEastWest`, +0.4 `bailsEarly` (scrambles), −0.6 `finishesForward`,
−0.4 `yacSlasher`, −0.4 `highKnee`; `STEP_BUILD` −0.35 per sd of `build`; `STEP_TIRED` +0.03 per point of energy under
85; `STEP_HURT` +0.2 per injury. Pushed: `PUSH_PURSUIT` +0.05 and `PUSH_TACKLING` −0.05 per point over 12;
`PUSH_EDGE` −0.04 per point of `edge` over 12 on runs, scaled by `wide`; `PUSH_SPEED` +0.05 per point over 12; +0.3
each for chaser `alleyCrusher`, `scraper`, `businessDecision` and carrier `runsEastWest`, `bouncesExternal` (runs);
−0.3 for chaser `thumper`. The clock terms (`STEP_OUT`, `STEP_IN`) are multiplied by
`(0.5 + poise / 20) * (has('noHuddle') ? 1.3 : 1)`. Clamp pushed to [0.002, 0.6], stepped to [0.001, 0.65].
`steppedCredit`: 1 for runs and scrambles; catches `CREDIT_STEPPED_CATCH` 0.55, 0.15 when `free`.
`sidelineCall(o, u)`: `u < o.pushed` → pushed; `u < o.pushed + (1 − o.pushed) * o.stepped` → stepped; else in.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/match/sideline.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/match/sideline.ts src/engine/match/sideline.test.ts
git commit -m "Sideline: pushed out and stepped out as odds from the play, the clock and the men in it"
```

### Task 3: The judge (`npm run sideline`)

**Files:**
- Create: `scripts/sideline-core.ts`, `scripts/sideline.ts`
- Modify: `package.json` (`"sideline": "tsx scripts/sideline.ts"`)

**Interfaces:**
- Consumes: `sidelineOdds`, `TYPICAL` (Task 2) for the spread.
- Produces (`sideline-core.ts`): `newSidelineTally(): SidelineTally`;
  `tallyGame(t: SidelineTally, plays: PlayLogEntry[], homeId: number): void`;
  `spreadLines(league: League): Line[]`; `judgeSideline(t: SidelineTally): Line[]`; `SIDELINE_NFL` (the spec §1 bucket
  values, out / pushed / stepped); `Line` (`label`, `value`, `range`, `note`, `info?`: parity-core's shape, declared
  here) and `printLine(l: Line): boolean` (prints ✓/✗ as parity does, returns whether in range; the caller counts misses).

- [ ] **Step 1: Write `sideline-core.ts`.** `tallyGame` reads each logged play (`asRan` for flagged snaps): kind
  `run` / `pass` (a catch) / `scramble`, skipping touchdowns, lost fumbles, two-point tries and `down <= 0`. Out: text
  contains "out of bounds"; pushed: ", pushed out of bounds"; stepped: ", steps out of bounds" (today's ", out of bounds"
  counts as out with no split). Tempo by `coach.tempo` rebuilt from the entry (quarter, clock, score from the offense's
  side, yard line). Outside runs: text `left end` / `right end`. Side of the field for catches: `|lane| >= 0.34`. Gain
  from the text (`for N yards`, `no gain`); yards after the catch from `to − air` in the offense's direction (as
  `calibrate.ts`'s `sampleDepth`). Short of the sticks: down 3 or 4 and gain < distance. The clock gap: Q1–Q3, normal
  tempo, the next entry the same quarter and offense with `down > 0`, no "Timeout" between, neither a penalty:
  `entry.clock − next.clock`, by catch/run and in bounds/out. `judgeSideline` makes one judged `Line` per spec §1 bucket
  (range: NFL ± max(3 points, 20%)), per kind total (± 1.5), and the two clock gaps (catches 4.3 s, runs 2.5 s, ± 1.5).
  `spreadLines`: for every team's top three WRs and top TE (sideline catches), top RB (runs, `wide` 1) and starting QB
  (scrambles), the share stepped out (`(1 − pushed) × stepped`) at the fixture's typical facts; judged sd ÷ mean against
  the NFL's 0.49 (catches), 0.92 (runs), 0.39 (scrambles), ± 30%.

- [ ] **Step 2: Write `sideline.ts`:** plays `argv[2] ?? 200` AI games across leagues `sideline-a` and `sideline-b`
  (`simulateGame(league, g, { keepPlays: true, seed })`), tallies, prints the table (bucket, sim, NFL, range) with ✓/✗
  and the spread lines, sets `process.exitCode = 1` on any miss.

- [ ] **Step 3: Run it on today's engine (a baseline)**

Run: `npm run sideline -- 200`
Expected: runs and the tally agree with the session's measurement of today: catches ≈ 19.8% (sideline ≈ middle), runs ≈
9.0%, scrambles ≈ 27.6%; many ✗ (that's today's flat roll). Exit code 1.

- [ ] **Step 4: Commit**

```bash
git add scripts/sideline-core.ts scripts/sideline.ts package.json
git commit -m "Sideline check: out of bounds by bucket, the clock gap and the spread between players, against nflverse"
```

### Task 4: The engine makes the call

**Files:**
- Modify: `src/engine/match/gameSim.ts` (`runPlay` ~L2909–3035, the catch ~L3363–3505, `scramble` ~L3800–3875,
  `PlayResult`, `has`), `src/engine/field/moment.ts:30`
- Test: `src/engine/engine.test.ts` (the `game simulation` block)

**Interfaces:**
- Consumes: Task 2's API.
- Produces: `PlayResult.outOfBounds?: 'pushed' | 'stepped'`; `FieldFacts.oob?: 1 | 2` (1 pushed, 2 stepped); a private
  `sideline(kind, facts)` on the game that builds `SidelineFacts`, draws `this.rng.next()` and returns the
  `SidelineCall`.

- [ ] **Step 1: Write the failing test**

```ts
it('ends plays out of bounds as pushed or stepped out, never on a touchdown, a lost fumble or a stepped-out fumble', () => {
  let pushed = 0, stepped = 0;
  for (let i = 0; i < 40; i++)
    for (const p of simulateGame(league, league.games[i], { keepPlays: true }).plays!) {
      if (!/out of bounds/.test(p.text) || /kicks off|punt|throws it away/.test(p.text)) continue;
      expect(p.text).toMatch(/, (pushed|steps) out of bounds/);
      expect(p.text).not.toMatch(/TOUCHDOWN|FUMBLE/);
      if (/steps out of bounds/.test(p.text)) expect(p.text).not.toMatch(/Fumble/);
      /pushed/.test(p.text) ? pushed++ : stepped++;
    }
  expect(pushed).toBeGreaterThan(stepped); // NFL: three in four catches out of bounds are pushed out
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/engine/engine.test.ts -t "out of bounds"`
Expected: FAIL (text is ", out of bounds").

- [ ] **Step 3: Wire the call in all three spots.**
  - Add a non-noting habit read, `private holds(p, q)` (as `has` without `this.noted`), for the sideline facts: All-22
    lists only habits that decided something on film.
  - Facts: `clock` is `'none'` unless `this.oobStopsClock()`, then `'out'` for tempo hurry, `'in'` for milk;
    `energy` from `this.body(p).energy`; `hurt` from `p.injuries` with `season >= this.game.season − 1`, capped at 3;
    `edge` on runs from the best `skill(p, 'setEdge')` of `def.edge`.
  - **Runs:** pick the chaser (`this.pickTackler(def, yards)`) before the call in both modes when not a touchdown (it
    replaces the `shadow` pick and the later `shadow ?? pickTackler`); then the call; then the field with
    `oob: call === 'pushed' ? 1 : 2` in its facts when out. Remove `pOut`, `outEarly` and `oobRoll`.
  - **Catches:** the call after `gain` (the chaser is today's `tackler`, `run` = `gain − air`); same facts and removals.
  - **Scrambles:** the call replaces the `oob` roll (`run` = yards, `wide` 0.9, chaser `tackler0`); the slide stays
    `!td && call === 'in' && rng.chance(0.4)`.
  - **Endings:** text by call; `clockStops: call !== 'in' && this.oobStopsClock()`; `outOfBounds` set; the contact
    fumble rolled only when the call isn't `'stepped'`; on a stepped-out catch the tackle is credited only if
    `this.rng.chance(steppedCredit(f))`. Remove `outFirst`.
  - `TodayField.outOfBounds` keeps a boolean (`call !== 'in'`).

- [ ] **Step 4: Run the engine tests and the typecheck**

Run: `npx vitest run src/engine/engine.test.ts src/engine/match && npm run typecheck`
Expected: PASS. A test pinned to one game's exact plays may move (every game reshuffles); update only pins of a
specific play, never a range.

- [ ] **Step 5: Commit**

```bash
git add src/engine/match/gameSim.ts src/engine/field/moment.ts src/engine/engine.test.ts
git commit -m "Engine: out of bounds is pushed or stepped, one call from the play in every game"
```

### Task 5: Stepping out skips the hit

**Files:**
- Modify: `src/engine/match/gameSim.ts` (`credit`, `wear` ~L1022–1068, `resolve` ~L3902)
- Test: `src/engine/match/wear.test.ts`

**Interfaces:**
- Produces: `export function collisions(entries: StatBuffer['entries'], qb: Player, unhit: boolean):
  [Player, ContactEvent][]` (the second loop of `wear` with `gained`, made pure; `qb` for a hit without a sack);
  `StatBuffer` exported; `credit(buf, unhit = false)`.

- [ ] **Step 1: Write the failing test**

```ts
it('a man who steps out is credited a tackle but takes no hit', () => {
  // carrier: rushAtt + rushYds 7; defender: tackles
  expect(collisions(entries, qb, false)).toEqual([[carrier, 'carrier'], [defender, 'tackler']]);
  expect(collisions(entries, qb, true)).toEqual([[carrier, 'free']]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run src/engine/match/wear.test.ts`
Expected: FAIL (`collisions` not exported).

- [ ] **Step 3: Implement.** `wear` applies `collisions(...)`; `resolve` calls `this.credit(result.stats,
  result.outOfBounds === 'stepped')`.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/match src/engine/engine.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/match/gameSim.ts src/engine/match/wear.test.ts
git commit -m "Wear: a man who steps out of bounds is credited a tackle but takes no hit"
```

### Task 6: The clock pauses for the spot

**Files:**
- Modify: `src/engine/match/coach.ts`, `src/engine/match/gameSim.ts` (`resolve` ~L3951, both runoff sites ~L2056 and
  ~L2103)
- Test: `src/engine/engine.test.ts` (the coach block)

**Interfaces:**
- Produces: `export const SPOT_PAUSE: number` (starting value 6 s; fitted in Task 8 to the clock gaps) and
  `export function afterOutOfBounds(runoff: number): number` (`max(0, runoff − SPOT_PAUSE)`) in `coach.ts`; a private
  `spotted` flag on the game.

- [ ] **Step 1: Write the failing tests**

```ts
it('takes the spot off the runoff after a man goes out, never below zero', () => {
  expect(coach.afterOutOfBounds(30)).toBe(30 - coach.SPOT_PAUSE);
  expect(coach.afterOutOfBounds(2)).toBe(0);
});
it('stops the clock to the snap inside the windows, and pauses only for the spot outside them', () => {
  // over 40 games' logs: after an out-of-bounds play in Q2 ≤ 2:00 or Q4/OT ≤ 5:00, the next snap's clock equals this
  // snap's clock minus the play (gap ≤ 10 s); in Q1–Q3 normal tempo, the mean gap after out of bounds is below the mean
  // after a tackle in bounds; a two-minute warning still logs whenever a snap at Q2/Q4 > 2:00 is followed by ≤ 2:00.
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/engine.test.ts -t "spot"`
Expected: FAIL.

- [ ] **Step 3: Implement.** In `resolve`: `this.spotted = !!result.outOfBounds && !result.clockStops && !warning`.
  Both pre-snap runoff sites pass their runoff through `coach.afterOutOfBounds` when `this.spotted`, then clear it; any
  stop (timeout, penalty, change of possession) clears it. Comment the NFL rule and the measured gaps (spec §5).

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/engine/engine.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/match/coach.ts src/engine/match/gameSim.ts src/engine/engine.test.ts
git commit -m "Clock: out of bounds stops it until the ball is spotted, outside the late windows too"
```

### Task 7: The field plays the call, and the film check

**Files:**
- Modify: `src/engine/field/types.ts:95` (`target.stepped?: boolean`), `src/engine/field/approach.ts:236`,
  `src/engine/field/pocketMoment.ts:344`, `src/engine/field/run.ts` (escort ~L263, ~L478; the out-of-bounds end
  ~L300), `src/engine/field/types.ts:104` (doc), `src/engine/match/gameSim.ts` (crediting the field's man),
  `scripts/parity.ts`
- Test: `src/engine/field/run.test.ts`, `src/ui/stage/stage.test.ts` (or the test beside `calls.ts`)

**Interfaces:**
- Consumes: `FieldFacts.oob: 1 | 2` (Task 4).
- Produces: `FieldResult.tackler` on out of bounds is the man to credit: `escortFor`'s when pushed, else the nearest
  defender; the engine credits him by Task 4's rules.

- [ ] **Step 1: Write the failing tests**

```ts
it('a stepped-out man in the hurry-up gets no escort; in normal play the escort still closes', () => {
  // runField on a staged catch with target { out: true, stepped: true }: clock.outOfBounds true → no defender heads
  // for the exit (escort -1); false → the nearest defender at the crossing is within 3 yd.
});
it('reports a man to credit on out of bounds', () => { /* pushed: result.tackler === the escort's id; stepped: non-null */ });
it("old film's oob 1 still plays as pushed", () => { /* approach with facts.oob 1 → target.out true, no stepped */ });
it('calls every out-of-bounds ending "out"', () => {
  // ', out of bounds' (old saves), ', pushed out of bounds', ', steps out of bounds' → 'out' (ui/stage/calls.ts)
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/field/run.test.ts src/ui/stage`
Expected: the new escort and credit tests FAIL; the old-film and calls tests may already pass (keep them as pins).

- [ ] **Step 3: Implement.** `approach.ts` and `pocketMoment.ts` add `stepped: true` when `facts.oob === 2`. In
  `run.ts`, `escortFor` runs unless `spot.stepped && clock.outOfBounds`; on the out-of-bounds end, `tackler` is the
  escort when pushed, else `nearestDefender()`. In `gameSim.ts` the field's tackler is used on out of bounds (pushed:
  always; stepped: as Task 4's credit rule).

- [ ] **Step 4: Add the film check to `scripts/parity.ts`:** a `film` worker plays `FILM_GAMES = 40` games with
  `{ keepPlays: true, field: true }` and measures with `stagePlay` as the handoff's script does. Two judged lines:
  stepped out in normal tempo (no `field.out`/`field.stay`) with nobody within 5 yd in the last second, share in
  [0, 0.03]; pushed out with the nearest defender within 2 yd as he crosses, share in [0.8, 1]. If the worker takes over
  60 s, drop to 24 games.

- [ ] **Step 5: Run the tests and the field check**

Run: `npx vitest run src/engine/field src/ui/stage && npm run typecheck && npm run parity`
Expected: tests PASS; parity's film lines ✓ (other lines as Task 8 leaves them; parity is re-run there).

- [ ] **Step 6: Commit**

```bash
git add src/engine/field src/engine/match/gameSim.ts src/ui/stage scripts/parity.ts
git commit -m "Field: a man who steps out gets out before the hit; out of bounds credits the man who forced it"
```

### Task 8: Fit to the NFL, and judge it in `npm run sim`

**Files:**
- Modify: `src/engine/match/sideline.ts` (constants), `src/engine/match/coach.ts` (`SPOT_PAUSE`; the normal runoff
  only if plays per game leave range), `scripts/calibrate.ts`

**Interfaces:**
- Consumes: Task 3's `newSidelineTally`, `tallyGame`, `judgeSideline`, `spreadLines`.

- [ ] **Step 1: Fit.** Loop: `npm run sideline -- 400`, move the constant named by the worst ✗ (bases and widths first,
  then gain, clock, sticks, then habits and build for the spread, then `SPOT_PAUSE` for the clock gaps), repeat until
  every line is ✓. Update each constant's comment with the NFL number it now meets.

- [ ] **Step 2: Wire into `npm run sim`.** `sampleDepth` also calls `tallyGame` on the same replayed games;
  after the depth table, print the sideline lines (heading: "Out of bounds (weeks 1 and 10 replayed; NFL from nflverse
  2021–25)") and the spread lines for the first season's league, through `printLine`; each ✗ adds to `misses`.

- [ ] **Step 3: Run the area checks**

Run: `npm run sim -- 10` then `npm run endings`
Expected: every stat in range, including plays per team-game (NFL 61–65), injuries and the new sideline lines; endings
finds no nonsense. If plays per game run high, re-centre the normal runoff (`rng.int(28, 38)`), never `SPOT_PAUSE`, and
re-run.

- [ ] **Step 4: Commit**

```bash
git add src/engine/match/sideline.ts src/engine/match/coach.ts src/engine/match/gameSim.ts scripts/calibrate.ts
git commit -m "Sideline: fitted to nflverse; npm run sim judges out of bounds by bucket"
```

### Task 9: Docs, version and the rest of the checks

**Files:**
- Modify: `src/engine/quirks.ts` (effect lines), `docs/MVP.md`, `src/ui/changelog.ts`, `package.json` (`0.4.3`),
  `CLAUDE.md`, `docs/ATTRIBUTES.md` (rewritten by the audit)

- [ ] **Step 1: Effect lines.** Append to each `effect` (`quirks.ts`), keeping the sentence style:
  `contactAverse` "Steps out of bounds before the hit."; `hearsFootsteps` "Steps out of bounds more."; `runsEastWest`
  "Ends up out of bounds more."; `bailsEarly` "Gets out of bounds on his scrambles."; `finishesForward`, `yacSlasher`,
  `highKnee` "Fights to stay in bounds."; `bouncesExternal` "Pushed out of bounds more."; `alleyCrusher`, `scraper`
  "Runs carriers out of bounds."; `businessDecision` "Runs carriers out rather than hitting them."; `thumper` "Brings
  carriers down in bounds."; `noHuddle` "Reads the clock at the sideline."

- [ ] **Step 2: `docs/MVP.md`:** tick "Out of bounds as the player's choice" with the measured result (the bucket table
  green, the spread and the clock gap) and refresh the audit list's line numbers ("as of 0.4.3").
  `src/ui/changelog.ts`: a 0.4.3 entry (title and one short paragraph for a player: men at the sideline choose to step
  out or get pushed out, a lone man in the open stays in, the clock stops until the spot). `package.json`: `0.4.3`.
  `CLAUDE.md`: `npm run sideline` under Commands (what it judges, run it after changing `match/sideline.ts` or the
  out-of-bounds code in `match/gameSim.ts`), and `match/sideline.ts` beside `match/gameSim.ts` in Architecture.

- [ ] **Step 3: Run the checks this change calls for**

Run: `npm run typecheck && npm test && npm run audit && npm run format`
Expected: all pass; nothing under "Needs attention" in `docs/ATTRIBUTES.md`. (`quirks --effects`, `parity`, `size` and
`sim -- 60` run in CI on the pull request.)

- [ ] **Step 4: Commit and push**

```bash
git add -A
git commit -m "0.4.3: out of bounds as the carrier's choice"
git push -u origin claude/quirky-shannon-18tnms
```

Then ask the owner whether to open the pull request (stacked on #148), and read CI on it before calling it ready.
