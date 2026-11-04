# The spatial engine, slice two: the pocket (and the clock and ends in the viewer) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In your games, every dropback's line, rush and quarterback play out on the field from the snap. Today's
rolls keep the result, and the field decides who got home, who lost him and when. The viewer's clock ticks with the
film, timeouts show on the scorebug, and teams switch ends each quarter.

**Architecture:**
- **`src/engine/field/pocketField.ts` (new, pure)** holds `runPocket`. It steps the five linemen, any blocker kept in,
  every rusher and the quarterback at 20 a second. Each rep can be won by a hazard from the ratings, and today's
  outcome steers who wins and when (slice one's anchor, for the pocket).
- **`pocketMoment.ts` (new)** builds the pocket's blind entry and start from the stager's staging at the snap. It reads
  a logged dropback back into its moment, and it composes the pocket's frames into a staged play: for the replay, and
  for the open field's approach at a catch, a pick or a scramble.
- **`gameSim.ts`** still rolls every dropback as today. With the switch on, it runs the pocket on the play's own
  stream and credits the field's rusher and blocker.
- **The viewer** gets pure clock and ends helpers (`src/ui/stage/clock.ts`) and a time callback from both field
  views.

**Tech Stack:** TypeScript, Vitest, `tsx` scripts (`npm run parity`, `parity-fit`, `film`, `sim`).

**Spec:** `docs/superpowers/specs/2026-11-04-spatial-pocket-design.md` (approved; binding). Slice one's spec and plan
(`2026-11-03-spatial-open-field*`) describe the open field this builds on.

## Decisions this plan makes (owner, please confirm)

1. **Hit and blame are rolled on the play's own stream, at today's odds.** A pressure is a hit at `QB_HIT_SHARE`. A
   sack or pressure goes unblamed at `UNBLAMED_SACK` or `UNBLAMED_PRESSURE`. These are rolled before the pocket runs,
   and today's credit-stream draws are still taken in their place, as #145 did for out of bounds. The spec said "read
   before the pocket runs"; reading them early would reorder the credit stream, so this replaces that line, and Task 5
   edits the spec.
2. **Protection pairs by alignment at the snap.** Blockers and rushers are ordered across the field and paired in order
   (`laneMatch`, as kickoff lanes). For a standard front that gives `blockerFor`'s spots: the end on the tackle, the
   tackles on the guards. A spare blocker doubles the nearest inside rusher. A spare rusher is free.
3. **Who rushes:** every DT and EDGE on the field, plus the stager's blitzers (`StagedPlay.blitz`). **Who blocks:** the
   offensive linemen, plus the back on a blitz (today's pickup term), plus a tight end whose pattern job is `block`.
4. **Four pocket skills from existing contests.** `rush` is `interiorRush` for a DT and `edgeRush` for anyone else.
   `pro` is `passPro`, `poise` is `pocketPresence` and `scram` is `scrambling`. No new contest, so the audit and
   `docs/ATTRIBUTES.md` don't change.
5. **A slide is a new open-field target flag**, `target.slide`: he goes down at his spot and no tackle is credited, as
   out of bounds.
6. **No pocket on screens** (a throw with negative air), on flagged snaps (they keep today's film) or on spikes. A
   dropback with fewer than five blockers on the field keeps today's film.
7. **The upright All-22 layout (phones) keeps the offense attacking up** as it does now. The wide All-22 and the
   broadcast views turn for Q2 and Q4.
8. **Two kinds of scramble.** `scramble` is the one under pressure; `escape` is the one when nothing comes open, as
   today's engine rolls them apart. They break out on different clocks, and a blind entry can't tell them apart without
   it.
9. **Release 0.3.12** (a slice, like slice one: the last number). **`SAVE_VERSION` 86.** **`FIELD_VERSION` 7.**

## Global Constraints

- **AI games, the switch off and the tap alone keep today's game exactly:** the same draws in the same order, the same
  results. `npm run sim -- 10` stays identical to `origin/main` but for its run time.
- **Today's rolls decide the outcome** (clean, pressure, hit, sack, scramble, throwaway), the sack's yards and fumble,
  the scramble's yards, touchdown, slide and out of bounds, the throw and everything after it.
- **The field decides** the rusher who got home, the blocker who lost him (none when unblamed or free), when, and how
  the quarterback moved.
- **The pocket draws only from `${gameSeed}:field:${index}:pocket`** (and `:hit`, `:blame` for decision 1).
- **The pocket's anchor, from the spec:**
  - **Clean:** no rep is won before the ball is out.
  - **Pressure / hit:** the first rep won in time reaches him as he throws, on him for a hit and a step short for a
    hurry. If none is won by `PRESSURE_REACT` (0.9 s) before the throw, the rep with the highest win chance wins then.
  - **Sack:** at the stager's sack time (`PocketPlan.throwAt`, drawn from `sackTime`: median 2.9 s, a tenth past
    5.3 s), the first rusher whose rep is won early enough to reach him is the sacker. If none is, the rep with the
    highest win chance is won just in time. An unblamed sack comes at `max(throwAt, 3.5)`, and no blocker is charged.
  - **Scramble and escape:** he breaks out away from the pressure, then crosses the line. The break comes at a time
    drawn on the pocket's stream: `SCRAMBLE_PRESSURED` (2.4–3.2 s) for a scramble, `SCRAMBLE_OPEN` (3.2–4.4 s) for an
    escape. Both constants are exported from `pocket.ts`.
  - **Throwaway:** he rolls out and throws it away at the throw time.
- **The engine:** `src/engine/` stays pure (no DOM, React or `Math.random`), and `League` stays plain JSON.
- **Process:** never loosen a check's range to get green; `npm run format` before every commit; never run
  `npm run check` unless the owner asks; no model identifiers in commits.

## Review Focus

1. **A dropback without a full line** (injuries, odd personnel: fewer than five blockers) keeps today's film and
   result, and never throws. Test in Task 4.
2. **A sack behind his own goal line** (a safety: `yardLine − loss ≤ 0`) ends with the quarterback in the end zone, not
   clamped at the goal line. Test in Task 5.
3. **A blitz with more rushers than blockers on a clean pocket:** the free man never reaches the quarterback before the
   ball is out. Test in Task 3.
4. **The last play of a quarter or half:** the scorebug counts to 0:00 and stops there. It never runs into the next
   quarter's clock or below zero. Test in Task 9.
5. **AI games and old saves in the viewer:** the clock ticks, timeouts show and ends switch for every game. Only the
   pocket's frames need the switch. Test in Task 10.

---

### Task 1: The pocket's skills and habits

**Files:**
- Modify: `src/engine/field/types.ts` (`FieldSkills`), `src/engine/field/skills.ts` (`FIELD_CONTESTS`, `fieldSkills`),
  `src/engine/field/habits.ts` (`FIELD_HABITS`)
- Test: `src/engine/field/skills.test.ts`

**Interfaces:**
- Produces: `FieldSkills` gains `rush: number` (`interiorRush` for a DT, else `edgeRush`), `pro: number` (`passPro`),
  `poise: number` (`pocketPresence`), `scram: number` (`scrambling`), each rounded like the others (`r2`).
  `FIELD_CONTESTS` gains `edgeRush`, `interiorRush`, `passPro`, `pocketPresence` and `scrambling`. `FIELD_HABITS` gains
  `bullRush`, `anchor`, `heavyPunch`, `bendsArc`, `twoTapSet`, `losesContainment`, `muddyPockets`, `bailsEarly` and
  `blitzPickup`.

- [ ] **Step 1: Write the failing test**, `it('reads the pocket skills from their contests')`:
  - a DT's `rush` equals `skill(p, 'interiorRush')`, rounded to two decimals;
  - an EDGE's and an LB's `rush` equal `skill(p, 'edgeRush')`;
  - an OL's `pro` equals `skill(p, 'passPro')`;
  - a QB's `poise` and `scram` equal `pocketPresence` and `scrambling`;
  - an edge rusher with `bendsArc` active has it in `habits`.
- [ ] **Step 2:** Run `npx vitest run src/engine/field/skills.test.ts`. Expected: FAIL (`rush` undefined).
- [ ] **Step 3:** Add the fields, contests and habits. `fixtures.ts`'s `skillsOf` gets 12 for each of the four new
  skills, so hand-built starts keep even skills.
- [ ] **Step 4:** Run `npx vitest run src/engine/field/`. Expected: PASS. The snapshot tests still round-trip
  (`skillsAt` returns the new fields).
- [ ] **Step 5: Commit:** "Field: the pocket's skills and habits".

### Task 2: `runPocket`: matchups, reps and bodies

**Files:**
- Create: `src/engine/field/pocketField.ts`
- Modify: `src/engine/field/tuning.ts` (knobs)
- Test: `src/engine/field/pocketField.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type PocketOutcome = 'clean' | 'pressure' | 'hit' | 'sack' | 'scramble' | 'escape' | 'away';
  export interface PocketStart {
    dir: 1 | -1;             // the offense's direction
    los: number;             // field x of the line of scrimmage
    qb: number;              // the quarterback's id
    players: FieldPlayer[];  // every man the pocket moves, at the snap; side 0 the offense
    blockers: number[];      // OL, a back kept in, a tight end kept in
    rushers: number[];       // DT, EDGE and the blitzers
    outcome: PocketOutcome;
    blamed: boolean;         // false: no blocker charged
    blitz: boolean;
    setDepth: number;        // yards behind the line he sets at (the stager's PocketPlan)
    throwAt: number;         // seconds from the snap: the ball out, a sack's planned time, or the break out
    end: number;             // seconds from the snap the pocket runs to
    sackX?: number;          // a sack's spot (field x), from today's yards
  }
  export interface PocketResult {
    frames: Float32Array;    // steps × players × (x, y), the same order as start.players; frame 0 the snap
    rusher: number | null;   // who got home (pressure, hit, sack)
    beat: number | null;     // the blocker who lost him (null: unblamed or a free rusher)
    at: number | null;       // seconds from the snap he got home
    breakout: number | null; // a scramble: the step the quarterback crosses the line
  }
  export function pairUp(start: PocketStart): { pairs: [number, number][]; doubles: [number, number][]; free: number[] };
  export function runPocket(start: PocketStart, rng: Rng): PocketResult;
  ```
  - Knobs in `KNOBS` (fitted in Task 7, defaults for now): `rushWin: 0.25` (a rep's win chance a second at even
    skills), `rushSkill: 0.15` (its log-odds a point of `rush − pro`, plus `sizeEdge(..., 'contact')`), `double: 0.25`
    (the share left on a double team), `padSack: 1.5` (seconds of clock past a sack's whistle).

- [ ] **Step 1: Write the failing tests** (`pinKnobs`, hand-built starts in `fixtures.ts`: a new `pocketStartOf`
  builder with five OL, two EDGE, two DT and a QB at the snap):
  - `it('pairs by alignment: the ends on the tackles, the tackles on the guards, a spare blocker doubling inside')`:
    with five OL and four rushers, `pairUp` pairs each EDGE with the tackle on his side and each DT with a guard, and
    the center joins the inside DT's pair as a double (`doubles` has it).
  - `it('leaves a sixth rusher free when the back is out')`: two LB blitzers and no back in, so `free` holds one.
  - `it('lets a better rusher win sooner')`: on a `pressure` start, a rusher with `rush` 18 against `pro` 8 gets home
    (`at`) earlier on average over 40 seeds than one at 12 against 12.
  - `it('gives the same frames for the same start and seed')`.
  - `it('moves nobody faster than his legs, and no rusher through his blocker')`: on 30 random pocket starts, every
    step is within `bodyOf(...).top * STEP + 0.05`, and an engaged pair is never closer than 0.5 yards.
- [ ] **Step 2:** Run `npx vitest run src/engine/field/pocketField.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3:** Implement `pairUp` and the step loop of `runPocket` in `pocketField.ts`.
  - **Bodies:** reuse `bodyOf`/`stepBody`.
  - **An engaged pair** holds at `HOLD_GAP` (0.9 yd). The blocker gives ground toward the quarterback at the rusher's
    push: `bullRush` pushes harder, and `anchor` halves the push.
  - **A rep's win chance a step** is `1 − exp(−rushWin · STEP · e^(rushSkill · (rush − pro + size)))`, times `double`
    on a double team. `heavyPunch` means no win in the first 0.5 s. `bendsArc` (on the edge) and `twoTapSet` (the
    blocker) each multiply it by 1.3.
  - **A won rusher** chases the quarterback (`chaseWant`).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Commit:** "Field: the pocket's matchups, reps and bodies".

### Task 3: `runPocket`: today's outcome steers it, and the quarterback moves

**Files:**
- Modify: `src/engine/field/pocketField.ts`
- Test: `src/engine/field/pocketField.test.ts`

**Interfaces:**
- Consumes: Task 2's types and `sackTime` from `pocket.ts`.
- Produces: `runPocket` honours `outcome` (the Global Constraints' anchor). The quarterback sets at `setDepth`, steps
  up when clean, slides away from an edge rusher, and climbs when the rush goes round him. `poise` sets his reaction to
  a won rep (0.3 s at 12, 0.05 s quicker a point). `muddyPockets` drifts him 1 yard; `bailsEarly` breaks out 0.4 s
  sooner. On `scramble` or `escape`, he breaks out at `throwAt` through the widest lane (a `losesContainment` edge's
  outside counts double) and runs to the line; `breakout` is the step he crosses it.

- [ ] **Step 1: Write the failing tests**, each over 20 seeds:
  - `it('holds a clean pocket to the throw, even with a free blitzer')`: `outcome: 'clean'`, a sixth rusher free.
    No rusher is within 1 yard of the quarterback before `throwAt`, and `rusher` is null. (Review Focus 3.)
  - `it('gets a hit to him as he throws, and a hurry a step short')`: on `hit`, `rusher` is set and within 1.2 yards of
    the quarterback at `throwAt`. On `pressure`, he's between 1.2 and 3 yards.
  - `it('lands a sack at its time, the quarterback at the spot')`: on `sack`, `at` is within 0.3 s of `throwAt`, and
    the quarterback ends within 1 yard of `sackX`. With `blamed: false` and `throwAt` 2.6, `beat` is null and `at` is
    within 0.3 s of 3.5.
  - `it('breaks a scramble out away from the pressure')`: on `scramble`, `breakout` is set, the quarterback crosses
    `los`, and his lateral move at the break is away from the nearest won rusher. On `escape`, nobody is within 2 yards
    of him at the break.
  - `it('slides away from an edge rusher and steps up into a clean pocket')`.
  - `it('moves each habit the right way')`: over 40 seeds, `bendsArc` gets home sooner, `heavyPunch` later and
    `bailsEarly` breaks out sooner.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Implement the anchor and the quarterback in `runPocket`. Draw the sack time first on `rng`, and
  every rep's draws every step, kept or not, so one rep never shifts another.
- [ ] **Step 4:** Run `npx vitest run src/engine/field/`. Expected: PASS.
- [ ] **Step 5: Commit:** "Field: the pocket plays to today's outcome; the quarterback moves".

### Task 4: The pocket's moment, start and composition

**Files:**
- Create: `src/engine/field/pocketMoment.ts`
- Modify: `src/engine/field/approach.ts`, `src/engine/field/moment.ts` (`FieldFacts`)
- Test: `src/engine/field/pocketMoment.test.ts`

**Interfaces:**
- Consumes: Task 3's `runPocket`; `stagePlay` (blind); `PocketPlan` from `StagedPlay.pocket`.
- Produces:
  - `FieldFacts` gains `pk?: PocketOutcome` and `nb?: 1` (unblamed).
  - `export interface PocketMoment { index: number; offense: number; quarter: number; clock: number; down: number;
    distance: number; yardLine: number; kind: 'pass' | 'incomplete' | 'int' | 'sack' | 'scramble'; from: number;
    air?: number; to?: number; lane: number; call: DefenseCall; shot?: 1; facts: FieldFacts }`. Here `to` is a sack's
    spot.
  - `export function pocketEntry(m: PocketMoment): PlayLogEntry`: the blind dropback. No rush, beat or take; a throw's
    `to` is its `air`; a scramble's `to` is its `from`.
  - `export function pocketMomentOf(e: PlayLogEntry, record: FieldRecord, index: number): PocketMoment | null`: null
    unless `e.field?.pk`.
  - `export function pocketFrom(m: PocketMoment, record: FieldRecord, homeId: number, seed: string, skillsOf: (id:
    number) => FieldSkills | undefined): { staged: StagedPlay; start: PocketStart; result: PocketResult } | null`:
    stages the blind entry, reads the snap's positions, picks blockers and rushers (decision 3), and runs `runPocket`
    on `${seed}:field:${index}:pocket`. `throwAt` is the plan's, except for a scramble's or an escape's break, drawn
    here (Global Constraints). Null with fewer than five blockers, or on a screen.
  - `export function composePocket(staged: StagedPlay, pocket: { start: PocketStart; result: PocketResult }):
    StagedPlay`: the pocket's men take its frames from the snap step. The ball rides the quarterback until `throwAt`,
    then flies from where he is to the staged catch point, arriving at `staged.arrive`.
  - `approach(m, record, homeId, seed, pocket?)`: when given a pocket, it composes it before reading the start, so a
    catch's, a pick's or a scramble's open field starts from the pocket's frames.

- [ ] **Step 1: Write the failing tests** (on a league played with the tap, as `engine.test.ts`):
  - `it('reads a logged dropback back into the moment it was played from')`: `pocketMomentOf` equals the moment the
    engine built.
  - `it('keeps today\'s film for a dropback without a full line')`: a lineup with four OL gives `pocketFrom` null.
    (Review Focus 1.)
  - `it('hands the pocket to the open field without a jump')`: for catches, `composePocket` then `approach`, and every
    man's step at `k0` is within his legs.
  - `it('throws the ball from where the quarterback is')`: the composed ball at `throwAt` is within 0.5 yards of the
    pocket's quarterback.
- [ ] **Step 2:** Run `npx vitest run src/engine/field/pocketMoment.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `pocketMoment.ts` and the `approach` parameter.
- [ ] **Step 4:** Run `npx vitest run src/engine/field/`. Expected: PASS.
- [ ] **Step 5: Commit:** "Field: the pocket's moment, start and composition".

### Task 5: The engine plays the pocket (save v86)

**Files:**
- Modify: `src/engine/match/gameSim.ts`, `src/engine/field/run.ts` (`target.slide`), `src/engine/field/types.ts`,
  `src/engine/types.ts`, `src/engine/generate.ts` (`SAVE_VERSION` 86), `src/engine/migrate.ts`,
  `docs/superpowers/specs/2026-11-04-spatial-pocket-design.md` (decision 1's line)
- Test: `src/engine/field/pocketEngine.test.ts`, `src/engine/migrate.test.ts`, `src/engine/field/run.test.ts`

**Interfaces:**
- Consumes: Task 4's `pocketFrom`, `approach(..., pocket)`.
- Produces:
  - `SimOptions.pocketTap?: (t: PocketTap) => void` with `export interface PocketTap { moment: PocketMoment; start:
    PocketStart; today: { outcome: PocketOutcome; rusher: number | null; beat: number | null; hit: boolean; blamed:
    boolean; duration: number }; result?: PocketResult }`.
  - `FieldStart.target.slide?: boolean`.
  - In `gameSim.ts`:
    - A private `pocketFirst(outcome, blitz)` rolls hit and blame on `:hit` and `:blame` (decision 1) and runs the
      pocket once per play index, cached.
    - `sack()`, `scramble()`, the throwaway, and the throw paths (catch, incompletion, pick) call it with the switch on.
      A scramble from the pressure branch is `scramble`; the not-pressured one (nothing open) is `escape`.
    - Credits use the field's rusher, `beat`, hit and blame. Today's draws (`rushers` pick, `blockerFor`,
      `QB_HIT_SHARE`, `UNBLAMED_*`) are still taken in place.
    - A sack's duration is `round(at + padSack)`.
    - A scramble's open field (kind `run`) starts from `breakout` with `target` from today's yards, plus `out` or
      `slide`.

- [ ] **Step 1: Write the failing tests** (`pocketEngine.test.ts`, four week-1 games of `field-engine` played with
  `field: true`, the games built in an async `beforeAll` that yields between games):
  - `it('credits a sack to a rusher on the field and a pressure to the man who got home')`: every sack's `sacks` credit
    is the pocket's `rusher` and a defender; `sacksAllowed` is the pocket's `beat`, or nobody when unblamed.
  - `it('changes nothing with the switch off or the tap alone')`: as `engine.test.ts`, with `pocketTap`.
  - `it('ends a scramble at today\'s yards, with no tackle on a slide or out of bounds')`.
  - `it('takes a sack behind his own goal line as a safety, the quarterback in the end zone')`: a game started at its
    own 2, with a forced sack of 5 via `pocketTap`'s start (`sackX` < the goal line), gives a safety, and the
    quarterback's last frame is behind the goal line. (Review Focus 2.)
  - `migrate.test.ts`: `save v86`: a v85 save upgrades with games unchanged.
  - `run.test.ts`: `it('lets a sliding quarterback go down at his spot, nobody credited')`.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement. `SAVE_VERSION` goes to 86, and the v86 step is empty ("the facts and skills gain optional
  fields"). Edit the spec: §1's "Today's, as rolled" line to decision 1's wording, and §3's outcome list gains `escape`
  (decision 8).
- [ ] **Step 4:** Run `npx vitest run src/engine/field/ src/engine/match/ src/engine/migrate.test.ts`, then
  `npm run sim -- 10`. Expected: PASS, and sim identical to `origin/main` but for its run time.
- [ ] **Step 5: Commit:** "Field: the engine plays the pocket; save v86".

### Task 6: The replay plays the pocket (`FIELD_VERSION` 7)

**Files:**
- Modify: `src/engine/field/replay.ts`, `src/engine/field/stage.ts` (dispatch), `src/engine/field/tuning.ts`
  (`FIELD_VERSION` 7)
- Test: `src/engine/field/replay.test.ts`

**Interfaces:**
- Consumes: `pocketMomentOf`, `pocketFrom`, `composePocket`.
- Produces: `stageField` stages a dropback with `pk` from its pocket and, when the play has an open field too, from
  both. `StagedPlay.spatial.k0` is the snap step for a pocket-only play.

- [ ] **Step 1: Write the failing tests**:
  - `it('replays a pocket exactly as it was played')`: the composed frames from the snap equal `PocketTap.result.frames`
    for the pocket's men.
  - `it('replays a catch after a pocket with no jump at the hand-over')`.
  - `it('stages a pocket played on an older field version as drawn')`.
  - A save round trip replays the same.
- [ ] **Step 2:** Run `npx vitest run src/engine/field/replay.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Bump `FIELD_VERSION` to 7.
- [ ] **Step 4:** Run `npx vitest run src/engine/field/ src/ui/stage/ src/ui/viewer.test.tsx`. Expected: PASS.
- [ ] **Step 5: Commit:** "Field: the replay plays the pocket; FIELD_VERSION 7".

### Task 7: Parity and the fit for the pocket

**Files:**
- Modify: `scripts/field-moments.ts` (harvest `PocketTap`s), `scripts/parity-core.ts` (`resolvePocket`, rows),
  `scripts/parity.ts`, `scripts/parity-fit.ts` (the four knobs), `src/engine/field/tuning.ts` (fitted values)

**Interfaces:**
- Consumes: `PocketTap`, `runPocket`.
- Produces: these rows, each the field against today's engine on the same dropbacks:
  - sacks by group (edge, interior, linebackers, secondary), each within ±0.05 of today's share;
  - sacks and pressures allowed by spot (tackles, guards, center, backs and tight ends), each within ±0.05;
  - a rusher's share of his team's sacks against his `rush`, and a blocker's sacks allowed against his `pro`: the
    field's slope over today's in 0.6–1.5;
  - snap to sack: median in 2.6–3.2 s and 90th percentile in 4.8–5.8 s (NFL 2.9 and 5.3);
  - snap to whistle on sacks: within 0.6 s of today's;
  - the pocket's median ms a play: at most 5.

  Sacks a game, the pressure rate, scrambles and throwaways match by construction, and are reported only.

- [ ] **Step 1:** Add the harvest and the rows. Run `npm run parity`. Expected: the new rows print; some may be ✗ with
  the default knobs.
- [ ] **Step 2:** Run `npm run parity-fit` (it now steps `rushWin`, `rushSkill`, `double` and `padSack`) and paste its
  knobs into `tuning.ts`.
- [ ] **Step 3:** Run `npm run parity`. Expected: "0 number(s) outside target range". If a row stays out after the
  fit, stop and report to the owner with the numbers: never loosen a range.
- [ ] **Step 4:** Run `npx vitest run src/engine/field/` (the rule tests pin `RULE_KNOBS`). Expected: PASS.
- [ ] **Step 5: Commit:** "Parity: the pocket's rows; the fit".

### Task 8: Film sees the pocket

**Files:**
- Modify: `scripts/film.ts` (the spatial section)

**Interfaces:**
- Produces: these rows over the spatial games' pockets:
  - men faster than their legs: 0 (the existing row, now counting pocket frames);
  - engaged pairs closer than half a yard: 0;
  - a quarterback past the line before a scramble's break: 0;
  - jumps where the pocket hands over to the open field: 0.

- [ ] **Step 1:** Add the rows.
- [ ] **Step 2:** Run `npm run film`. Expected: "0 number(s) outside target range". A failure is a bug in Tasks 2–6:
  fix it there with a test, never by changing a row's range.
- [ ] **Step 3: Commit:** "Film: the pocket's rules".

### Task 9: The viewer's clock ticks

**Files:**
- Create: `src/ui/stage/clock.ts`
- Modify: `src/ui/screens/TopDownField.tsx`, `src/ui/screens/GameViewer.tsx`
- Test: `src/ui/stage/clock.test.ts`

**Interfaces:**
- Produces:
  ```ts
  /** The phase being drawn: the jog and huddle before play `index`'s snap (k from 0 to 1), or seconds since its snap. */
  export type ClockPhase = { pre: number } | { play: number };
  /** The clock the scorebug shows (seconds left in the quarter). */
  export function clockShown(plays: readonly PlayLogEntry[], index: number, phase: ClockPhase): number;
  /** Whether the clock stopped after play `index`: the next entry with a clock is within 2 s of its whistle. */
  export function clockStopped(plays: readonly PlayLogEntry[], index: number, whistle: number): boolean;
  ```
  - Both field views take `onClock?: (phase: ClockPhase) => void`, called each animation frame.
  - `GameViewer` keeps the shown second in state and re-renders only when it changes.

- [ ] **Step 1: Write the failing tests** (`clock.test.ts`, hand-built play lists):
  - `it('counts down with the film from the snap')`: a run snapped at 12:41, 5 s into the play, shows 12:36.
  - `it('holds at the whistle when the clock stopped')`: an incompletion whose next snap is at its whistle's time.
  - `it('runs through the break to the next snap when the clock ran')`: halfway through the next play's jog, it shows
    midway between the whistle and the next snap.
  - `it('stops a running clock at a timeout\'s time')`: a timeout entry at 2:10 after a run ending 2:31 holds 2:10.
  - `it('never counts below the next snap, nor below 0:00 at a quarter\'s end')`: the last play of Q2, its next entry
    in Q3. (Review Focus 4.)
- [ ] **Step 2:** Run `npx vitest run src/ui/stage/clock.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `clock.ts`. Call `onClock` from `TopDownField`'s tick (the `pre` and play branches) and the
  broadcast view's tick. Show `gameClock(Math.ceil(shown))` on the scorebug.
- [ ] **Step 4:** Run `npx vitest run src/ui/` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Viewer: the game clock ticks with the film".

### Task 10: Timeouts on the scorebug, and teams switch ends

**Files:**
- Modify: `src/ui/stage/clock.ts`, `src/ui/screens/GameViewer.tsx`, `src/ui/screens/TopDownField.tsx`
- Test: `src/ui/stage/clock.test.ts`, `src/ui/viewer.test.tsx`

**Interfaces:**
- Produces:
  ```ts
  /** Timeouts a team has left as of play `index`: read from the log's "Timeout ABC (n left)."; 3 from each half's start, 2 from overtime's. */
  export function timeoutsLeft(plays: readonly PlayLogEntry[], index: number, abbrev: string): number;
  /** Q2 and Q4 are drawn turned end to end; Q1, Q3 and overtime as now. */
  export function endsTurned(quarter: number): boolean;
  ```
  - With `endsTurned`, the wide All-22 layout's `toScreen`/`fieldTransform` and the broadcast `project` map
    (x, y) → (100 − x, FIELD_W − y) before their own mapping. The end-zone names swap. The upright layout is unchanged
    (decision 7).
  - The scorebug shows three marks a team, `timeoutsLeft` of them lit.

- [ ] **Step 1: Write the failing tests**:
  - `it('counts a team\'s timeouts down, back to three at halftime and two in overtime')`.
  - `it('turns the ends in Q2 and Q4')`: `endsTurned(1..5)` gives false, true, false, true, false.
  - `viewer.test.tsx`: a Q2 play renders with the home end zone on the other side from a Q1 play's.
  - `it('ticks the clock and turns the ends for an AI game and an old save')`: `clockShown` and `endsTurned` on a
    replayed AI game with no `field` record. (Review Focus 5.)
- [ ] **Step 2:** Run `npx vitest run src/ui/stage/clock.test.ts src/ui/viewer.test.tsx`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run `npx vitest run src/ui/` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** "Viewer: timeouts on the scorebug; teams switch ends each quarter".

### Task 11: Ship 0.3.12

**Files:**
- Modify:
  - `package.json` (0.3.12);
  - `src/ui/changelog.ts` ("The pocket on the field": one paragraph a player reads: the line and rush play out, who got
    the sack is decided on the field, the clock ticks, timeouts show, teams switch ends);
  - `CLAUDE.md` (the `field/` note gains the pocket; `npm run parity`'s line gains the pocket rows);
  - the spec's status line: "Built (0.3.12)".

- [ ] **Step 1: Whole-branch review.** A fresh reviewer on the most capable model, with the spec, this plan and
  `git diff origin/main...HEAD`. Fix what it confirms, each with a test.
- [ ] **Step 2: Final tests:**
  - `npx vitest run src/engine/field/ src/engine/match/ src/engine/migrate.test.ts src/ui/`;
  - `npm run typecheck`;
  - `npm run parity`;
  - `npm run film`;
  - `npm run sim -- 10` (identical to `origin/main` but for its run time);
  - `npm run format`.

  Expected: all green.
- [ ] **Step 3: Commit and push:** "Field: ship 0.3.12". Open a pull request only when the owner asks.
