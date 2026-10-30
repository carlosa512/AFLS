# Coaches with Character Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coaches get four hidden traits (ambition, loyalty, adaptability, discipline). They choose whether to take
the step up, a fired head coach can step down to coordinator, and pedigree draws owners to a winner's men. Together
these move every coaching-tree number off the floor of its NFL band, toward the middle.

**Architecture:** A new pure module `coachTraits.ts` owns the traits: rolls, drift, the agency decisions (each a pure
roll on its own stream), the leans every hook reads, and the character box's words. `coaching.ts` reads them at the
hooks: hiring, re-signing, dismissal, camp, scheme, game-day calls. `trees.ts` gains `pedigreeDemand` and the
strongest-pull rule in `treeLean`. Built in order (traits, agency, pedigree) and calibrated once on 8 worlds.

**Tech Stack:** TypeScript, React, Vitest; scripts run with `tsx`.

**Spec:** `docs/superpowers/specs/2026-10-30-coach-character-design.md` (the problem it fixes: the MVP entry
"Follow-up: coaching trees run at the floor of their NFL bands", commit `f2eb90b`)

## Global Constraints

- Engine pure: no DOM, no `Math.random`. Every new draw is on its own stream, exactly:
  - traits: `${seed}:coachTraits:${id}`
  - wanting the step up: `${seed}:wants:${season}:${id}:${chairRole}`
  - stepping down: `${seed}:stepDown:${season}:${id}:${when}`
  - the defensive bend: `${seed}:adapt:${dcId}:${hcId}`
- **The hiring search keeps exactly one `rng.normal(0, 0.6)` per candidate**, the unwilling included.
- **Hiring scores are lower-is-better.** A pull is negative and a penalty positive.
- **Traits:** 1–20, `TRAIT_MEAN` 10.5. Every lean reads `traitLean(v) = clamp((v − 10.5) / 7, −1, 1)` (±1 at 2 sd).
- **A missing `traits` (or a missing field) reads as 10.5:** typical behavior, never NaN.
- **Words only:** no screen or letter shows a trait as a number. UI copy may not contain "trait", "marble" or
  "z-score" (`ui/ui.test.ts` screen contract).
- **Same rules for you and AI clubs:** refusals, re-sign asks, forecasts.
- **Saves:** `SAVE_VERSION` 69 → 70 (`generate.ts`), with an upgrade step in `migrate.ts`. `League` stays plain JSON.
- No band or check range changes. Salaries in $K.
- Each task runs only the tests it touches: `npx vitest run <files>`. The full suite runs in CI.
- **Aims: not the floor.** A number passes only if:
  - every world sits inside the pass zone (10% of the band's width spare at each edge), **and**
  - the 8-world mean sits in the band's **middle half**.

  Tune toward the aim (the NFL figure where one exists, else the band's midpoint):

| Number (where)                                | Band     | Pass zone (every world) | Middle half (8-world mean) | Aim            |
| --------------------------------------------- | -------- | ----------------------- | -------------------------- | -------------- |
| live trees, steady (careers)                  | 2–5      | 2.3–4.7                 | 2.75–4.25                  | 3.5            |
| head coaches in a live tree (careers)         | 0.15–0.4 | 0.175–0.375             | 0.21–0.34                  | 0.27           |
| hires from a tree (careers)                   | 0.1–0.35 | 0.125–0.325             | 0.16–0.29                  | 0.20 (NFL ~⅕)  |
| biggest tree, steady (careers)                | 3–6      | 3.3–5.7                 | 3.75–5.25                  | 4.5            |
| trees born per league (careers)               | 1–4      | 1.3–3.7                 | 1.75–3.25                  | 2.5            |
| most hires from one tree, offseason (careers) | 0–0.4    | ≤ 0.36                  | n/a                        | n/a            |
| founding trees alive, fewest (careers)        | ≥ 1      | ≥ 1                     | n/a                        | n/a            |
| new head coaches / season (offseason)         | 4.5–9.5  | in band                 | no further from NFL than main | 7.0 (NFL)  |
| new OCs / DCs per season (offseason)          | 8.5–16 / 8–15 | in band            | no further from NFL than main | 12.5 / 11  |
| retreads % of HC hires (offseason)            | 10–50    | in band                 | no further from NFL than main | 32 (NFL)   |
| coordinators % of HC hires (offseason)        | 35–85    | in band                 | no further from NFL than main | 54 (NFL)   |

## Review Focus

1. **A coach with no `traits`** (a fixture, or a save mid-upgrade): every reader acts as for a typical coach.
   Tests: Task 4.
2. **No willing candidate for a chair:** the search falls through to the existing journeyman hire, never an unwilling
   man and never an empty chair. Tests: Task 8.
3. **A fired head coach who never coordinated** waits; **an interim** steps down to the side he was acting for
   (`actingAs`). Tests: Task 9.
4. **Your own move and an AI club see the same answer in one offseason** (the same roll), and a save reloaded
   mid-offseason gives the same answers. Tests: Task 8.
5. **A retired coach's card or a founding legend's card** shows the box, read by his last chair. Tests: Tasks 4 and 11.

---

### Task 1: Setup and the 8-world baseline

**Files:** none committed but the cherry-pick. Scratch files go in the session scratchpad (`$SCRATCH` below).

- [ ] **Step 1:** `git cherry-pick f2eb90b` (the MVP entry). Expected: `docs/MVP.md` gains "Follow-up: coaching trees
      run at the floor of their NFL bands".
- [ ] **Step 2: Write `$SCRATCH/worlds.ts`.** It forks `scripts/careers-league.ts` once per seed, with
      `env: { CAREERS_SEED, CAREERS_SEASONS: '16' }` (it answers by `process.send`), 4 at a time. Seeds:
      `careers-audit`, `careers-audit-2` … `careers-audit-8`. Per world, compute the careers numbers the way
      `scripts/careers.ts:445–462` does:
  - live trees and biggest tree: mean of each array's second half
  - head coaches in a tree: mean of `inTreeShare`
  - hires from a tree: Σ`fromTree` / Σ`total`
  - most hires from one tree: the max of `mostFromOne` / `total` over offseasons with `total` ≥ 5
  - trees born: `born`
  - founding trees alive: `foundingAlive`
  - head-coach changes per year: mean of `hires[].total`

  Print one row per world, then the 8-world mean, each marked against the Global Constraints table.
- [ ] **Step 3: Write `$SCRATCH/yoy.patch`** against `scripts/careers-league.ts`. It adds `winShares: number[][]`
      (each team's regular-season win share, per season, from `league.history`) to `LeagueRun`. `worlds.ts`
      prints the correlation of win share in season n with season n+1 over every (team, n) pair. Apply it with
      `git apply $SCRATCH/yoy.patch`. **Never commit it:** commit only named files, never `git add -A`.
- [ ] **Step 4:** `npx tsx $SCRATCH/worlds.ts > $SCRATCH/baseline-worlds.txt`. Expected: 8 rows plus a mean. The
      live-tree mean should be near 2.2, on the floor, as the MVP entry says.
- [ ] **Step 5:** `npm run offseason -- 6 > $SCRATCH/baseline-offseason.txt` and
      `npm run trades > $SCRATCH/baseline-trades.txt`. Record the carousel's means (new HC/OC/DC per season,
      retreads %, coordinators %) and the coaching ledger.

### Task 2: The gate (temporary logging, never committed)

**Files:** temporary edits to `src/engine/coaching.ts` (`fillChairs`) and `src/engine/trees.ts` (export
`winnerAsOf`), reverted at the end.

- [ ] **Step 1: Log every pedigree man who missed out.** In `fillChairs`, for `headCoach`, `offCoord` and `defCoord`
      chairs, take every candidate in `candidates` with a `linksOf` link `as === 'headCoach'` to a mentor where
      `winnerAsOf(league, mentorId, league.season)` holds. Count him:
  - **budget-filtered:** in `candidates` but not in `pool`
  - **outscored:** in `pool` but not the pick
  - **hired:** he was the pick
- [ ] **Step 2:** Run `worlds.ts`, summing the three counts per world.
- [ ] **Step 3: Gate.**
  - If pedigree men are rarely skipped (hired ≥ half of them), **stop and report** to the owner before building.
  - If more than a third of the skipped ones were budget-filtered, **flag the price** for Task 15.
- [ ] **Step 4:** `git checkout src/engine/coaching.ts src/engine/trees.ts`. Expected: `git status` clean but for
      the scratch patch.

### Task 3: Research note

**Files:** Create `docs/research/coaching-carousel.md`

- [ ] **Step 1: Gather figures** (WebSearch, then fetch the pages), in the layout of `docs/research/coaching-trees.md`:
      sources inline, hand counts marked **(est.)**:
  - what fired NFL head coaches did next, from 2015 to 2025: coordinator within two seasons, another head-coach job,
    out of coaching
  - how often coordinators turn down or withdraw from head-coach interviews
  - examples of career coordinators (lifers)
  - examples of head coaches back as coordinators
- [ ] **Step 2: End with "What AFLS takes from this"**: a target share of step-downs among fired head coaches, and a
      rough count of refusals a cycle. Task 13 tunes to these.
- [ ] **Step 3:** `npm run format`, then commit: `git add docs/research/coaching-carousel.md && git commit -m
      "Research: the coaching carousel (step-downs, refusals)"`

### Task 4: Coach traits (types, rolls, former players, drift, saves)

**Files:**

- Create: `src/engine/coachTraits.ts`, `src/engine/coachTraits.test.ts`
- Modify: `src/engine/types.ts` (`Coach`), `src/engine/coaching.ts` (`newCoach` :1150, `exPlayerCoach` :1369,
  `developCoaches`), `src/engine/trees.ts` (`seedFoundingTrees`' legends :380), `src/engine/generate.ts`
  (`SAVE_VERSION`), `src/engine/migrate.ts`

**Interfaces (produces):**

- `types.ts`: `export interface CoachTraits { ambition: number; loyalty: number; adaptability: number; discipline:
number }` and `Coach.traits?: CoachTraits`
- `coachTraits.ts`:
  - `traitOf(c: Coach, k: keyof CoachTraits): number` (10.5 when missing)
  - `traitLean(v: number): number` (`clamp((v − 10.5) / 7, −1, 1)`)
  - `rollCoachTraits(seed: string, c: Pick<Coach, 'id' | 'age'>): CoachTraits`
  - `traitsFromPlayer(seed: string, c: Pick<Coach, 'id'>, p: Player): CoachTraits`
  - `coolAmbition(c: Coach): void`

- [ ] **Step 1: Write the failing tests** in `coachTraits.test.ts`:

```ts
it('rolls the same traits from the seed and id, on the 1–20 scale', () => {
  const a = rollCoachTraits('s', { id: 7, age: 40 });
  expect(rollCoachTraits('s', { id: 7, age: 40 })).toEqual(a);
  for (const v of Object.values(a)) expect(v >= 1 && v <= 20 && Number.isInteger(v)).toBe(true);
});
it('leans young coaches ambitious', () => {
  const mean = (age: number) =>
    avg(range(400).map((id) => rollCoachTraits('s', { id, age }).ambition));
  expect(mean(30) - mean(60)).toBeGreaterThan(2); // +0.15 a year under 45
});
it('reads a missing trait as typical', () => {
  expect(traitOf({ ...coach() , traits: undefined }, 'loyalty')).toBe(10.5);
  expect(traitLean(10.5)).toBe(0);
  expect(traitLean(1)).toBe(-1);
});
it('carries a former player’s character in', () => {
  // winning 0.95 → high ambition, loyalty 0.05 → low loyalty
  const t = traitsFromPlayer('s', { id: 1 }, playerWith({ winning: 0.95, loyalty: 0.05 }));
  expect(t.ambition).toBeGreaterThan(13);
  expect(t.loyalty).toBeLessThan(8);
});
it('cools ambition a point a year from 56', () => {
  const c = { ...coach(), age: 56, traits: { ...typical(), ambition: 12 } };
  coolAmbition(c);
  expect(c.traits!.ambition).toBe(11);
  c.age = 55;
  coolAmbition(c);
  expect(c.traits!.ambition).toBe(11);
});
it('gives every coach in a new league traits, legends included', () => {
  const l = createLeague({ seed: 'traits' });
  for (const c of [...Object.values(l.coaches), ...Object.values(l.retiredCoaches)]) expect(c.traits).toBeDefined();
});
it('upgrades a v69 save to what a new league from its seed has', () => {
  const l = createLeague({ seed: 'traits-mig' });
  const want = Object.fromEntries(Object.values(l.coaches).map((c) => [c.id, c.traits]));
  for (const c of Object.values(l.coaches)) delete c.traits;
  l.version = 69;
  const up = migrateLeague(l)!;
  expect(Object.fromEntries(Object.values(up.coaches).map((c) => [c.id, c.traits]))).toEqual(want);
});
```

(`avg`, `range`, `coach()`, `typical()`, `playerWith()` are small local helpers in the test file.)

- [ ] **Step 2:** `npx vitest run src/engine/coachTraits.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.**
  - **Rolls:** `rollCoachTraits` draws each trait as `round(clamp(10.5 + 3.5 × normal, 1, 20))` on
    `${seed}:coachTraits:${id}`. Ambition adds `0.15 × max(0, 45 − age)` before the clamp.
  - **Former players:** `traitsFromPlayer` maps each trait from the player, plus `normal(0, 2)` on the same stream:
    - ambition: `10.5 + 7 × (winning − 0.5)`
    - loyalty: `10.5 + 7 × (loyalty − 0.5)`
    - discipline: the mean of `p.traits.sportsmanship` and `temperamentOf(p)`
    - adaptability: `p.traits.versatility`
  - **Where they're called:** `newCoach` calls `rollCoachTraits` after `generateCoachQuirks`. `exPlayerCoach`
    overwrites the result with `traitsFromPlayer`. The legends in `seedFoundingTrees` get `rollCoachTraits`.
  - **Drift:** `developCoaches` calls `coolAmbition(c)` after `c.age++` (−1 from 56, floor 1).
  - **Saves:** `SAVE_VERSION = 70`. The `migrate.ts` v70 step gives every coach, in `coaches` and `retiredCoaches`,
    without `traits`: `traitsFromPlayer` if `playerId` is set and the player exists, else `rollCoachTraits`.
- [ ] **Step 4:** `npx vitest run src/engine/coachTraits.test.ts src/engine/trees.test.ts src/engine/coaching.test.ts`.
      Expected: PASS.
- [ ] **Step 5:** `npm run typecheck && npm run format`, then commit: `git add src/engine/coachTraits.ts
src/engine/coachTraits.test.ts src/engine/types.ts src/engine/coaching.ts src/engine/trees.ts src/engine/generate.ts
src/engine/migrate.ts && git commit -m "Coach traits: ambition, loyalty, adaptability, discipline"`

### Task 5: Loyalty (old boss's call, re-signing)

**Files:** Modify `src/engine/trees.ts` (`treeLean`), `src/engine/coaching.ts` (new `coachAskTo`; `signCoach` :859;
`aiCoachMoves`' `decide` :1590; `cleanHouse` :1717; `coachResignForecast` :1454; `moveOverspend` :692),
`src/ui/mail.tsx` (:2183, :2188). Test: `src/engine/coaching.test.ts`, `src/engine/trees.test.ts`

**Interfaces:**

- Consumes: `traitOf`, `traitLean` (Task 4)
- Produces: `coachAskTo(league: League, c: Coach, years: number, teamId: number): number` and
  `LOYAL = { pull: 0.5, keep: 0.15, ask: 0.05 }` in `coachTraits.ts`

- [ ] **Step 1: Write the failing tests:**

```ts
it('pulls a loyal man to his old boss harder than a disloyal one', () => {
  // as in "keeps a new head coach’s own man…", with mine.traits.loyalty 18 vs 3
  expect(treeLean(l, hc, loyal, 'offCoord')).toBeLessThan(treeLean(l, hc, disloyal, 'offCoord'));
  expect(treeLean(l, hc, typicalMan, 'offCoord')).toBeCloseTo(-TREE_PULL);
});
it('asks a loyal man less to stay, and the same to anyone else', () => {
  const c = staffCoach(l, teamId, { loyalty: 18 });
  expect(coachAskTo(l, c, 2, teamId)).toBe(Math.round(coachAsk(l, c, 2) * 0.95));
  expect(coachAskTo(l, c, 2, otherTeam)).toBe(coachAsk(l, c, 2));
});
it('pays what it checked when it re-signs him', () => {
  // signCoach on his own club stores coachAskTo, not coachAsk
});
```

- [ ] **Step 2:** `npx vitest run src/engine/coaching.test.ts src/engine/trees.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The old boss's call:** in `treeLean`, the tie becomes `−TREE_PULL × (1 + LOYAL.pull × traitLean(loyalty))`.
  - **The ask to stay:** `coachAskTo` = `coachAsk × (1 − LOYAL.ask × traitLean(loyalty))` when `c.teamId === teamId`,
    else `coachAsk`, rounded. It replaces `coachAsk` in `signCoach` (read before `c.teamId` is set), in `decide`'s and
    `cleanHouse`'s budget checks, in `coachResignForecast`, in `moveOverspend`'s generic path, and in `mail.tsx`'s
    two contract asks.
  - **Re-signing:** in `decide`, `rng.chance(KEEP[c.role])` becomes
    `rng.chance(clamp(KEEP[c.role] + LOYAL.keep × traitLean(loyalty), 0, 0.98))`. That's still one draw.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** `npm run typecheck && npm run format`, then commit the named files: "Coach loyalty: the old boss's
      call and re-signing".

### Task 6: Adaptability (the bent plan)

**Files:** Modify `src/engine/coaching.ts` (`callerStyle` :396, `teamScheme` :411, `visionFit` :492),
`src/ui/screens/Coaches.tsx` (`SchemeRow` :857). Test: `src/engine/coaching.test.ts`

**Interfaces:**

- Consumes: `traitOf` (Task 4)
- Produces: `adaptShare(c: Coach): number` in `coachTraits.ts` (`0.8 × (adaptability − 1) / 19`), plus in
  `coaching.ts`:
  - `bentPassLean(oc: Coach, v: Vision): number`
  - `bentDefense(seed: string, dc: Coach, hcId: number, v: Vision): CoachScheme | undefined`
  - `planUnder(league: League, c: Coach): Coach`: him as he runs it on his staff now (bent style and scheme), or
    himself when there's no head coach

- [ ] **Step 1: Write the failing tests:**

```ts
it('bends an adaptable OC’s pass lean toward the head coach, not a stubborn one’s', () => {
  const v = { pass: 0.8, defense: {}, pressure: 0 } as Vision;
  expect(bentPassLean(oc({ adaptability: 20, passLean: -0.4 }), v)).toBeCloseTo(-0.4 + 0.8 * 1.2);
  expect(bentPassLean(oc({ adaptability: 1, passLean: -0.4 }), v)).toBeCloseTo(-0.4);
});
it('has an adaptable DC run the head coach’s front about as often as his share says', () => {
  const share = avgOver(400 hc ids, (id) => bentDefense('s', dc20, id, v)?.front === v.defense.front);
  expect(share).toBeGreaterThan(0.7);
});
it('scores fit on the bent plan, so an adaptable coordinator fits better', () => {
  expect(visionFit(l, hc, adaptable)).toBeGreaterThan(visionFit(l, hc, stubborn)!);
});
it('calls the game on the bent lean', () => {
  expect(callerStyle(l, teamId).passLean).toBeCloseTo(bentPassLean(oc, headCoachVision(l, hc)));
});
```

- [ ] **Step 2:** `npx vitest run src/engine/coaching.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Offense:** `bentPassLean` = `lean + adaptShare × (v.pass − lean)`.
  - **Defense:** `bentDefense` takes `v.defense`'s front and coverage when
    `new Rng(\`${seed}:adapt:${dc.id}:${hcId}\`).next() < adaptShare(dc)`, else `dc.scheme`.
  - **Readers:**
    - `callerStyle` reads `bentPassLean` for a seated OC under a head coach.
    - `teamScheme` reads `bentDefense` for a seated DC under a head coach.
    - `visionFit` compares the bent plan (it already has `v`).
    - A covering head coach is unchanged.
  - **The card:** `SchemeRow` shows `planUnder(league, c)`. When his own plan differs, the tip adds "His own:
    \<label\>".
- [ ] **Step 4:** `npx vitest run src/engine/coaching.test.ts src/ui/ui.test.ts`. Expected: PASS.
- [ ] **Step 5:** `npm run typecheck && npm run format`, then commit: "Coach adaptability: coordinators bend to their
      head coach".

### Task 7: Discipline (flags and the room)

**Files:** Modify `src/engine/coaching.ts` (new `cultureCalls`), `src/engine/match/gameSim.ts` (constructor :587,
`preSnapPenalty` :1946, `personalFouls` :3063), `src/engine/morale.ts` (`MoraleContext`, `moraleContext`,
`roomScore` :166). Test: `src/engine/coaching.test.ts`, `src/engine/morale.test.ts`

**Interfaces:**

- Consumes: `traitOf`, `traitLean` (Task 4)
- Produces:
  - `DISCIPLINE = { flags: 0.08, room: 0.5 }` in `coachTraits.ts`
  - `cultureCalls(league: League, teamId: number): number`: the head coach's foul multiplier,
    `1 − DISCIPLINE.flags × traitLean(discipline)`, or 1 with no head coach
  - `MoraleContext.culture: Map<number, number>`: each team's room nudge,
    `−DISCIPLINE.room × traitLean(discipline)`

- [ ] **Step 1: Write the failing tests:**

```ts
it('gives a disciplinarian fewer flags and a player’s coach more, a typical coach none', () => {
  expect(cultureCalls(l, strict)).toBeCloseTo(0.92); // discipline ≥ 17.5
  expect(cultureCalls(l, loose)).toBeCloseTo(1.08); // ≤ 3.5
  expect(cultureCalls(l, typical)).toBe(1);
});
it('lifts the room under a player’s coach, inside the room clamp', () => {
  const f = moraleFactors(l, playerOnLooseTeam);
  expect(f.room - roomWithoutCoach).toBeCloseTo(0.5);
});
it('keeps the league’s mood centred over a league of coaches', () => {
  const ctx = moraleContext(createLeague({ seed: 'culture' }));
  expect(Math.abs(avg([...ctx.culture.values()]))).toBeLessThan(0.1);
});
```

- [ ] **Step 2:** `npx vitest run src/engine/coaching.test.ts src/engine/morale.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Game day:** the `GameSim` constructor sets `this.culture = [cultureCalls(league, game.homeId),
cultureCalls(league, game.awayId)]`, indexed like `this.styles`. `pFalseStart` gets `× this.culture[off]` and
    `pOffside` gets `× this.culture[this.def]`. Each personal-foul chance in `personalFouls` gets the fouling side's
    multiplier.
  - **Not touched:** kick-play fouls. The player-level `discipline()` keeps its name; the coach's is "culture".
  - **Morale:** `moraleContext` fills `culture` once per pass. `roomScore` adds `ctx.culture.get(p.teamId) ?? 0`
    inside its ±1.5 clamp.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** `npm run typecheck && npm run format`, then commit: "Coach discipline: flags and the locker room".

### Task 8: Agency, wanting the step up

**Files:** Modify `src/engine/coachTraits.ts`, `src/engine/coaching.ts` (`fillChairs` :1789–1870, `promoteProblem`
:1030, `poachProblem` :1055). Test: `src/engine/coachTraits.test.ts`, `src/engine/coaching.test.ts`

**Interfaces:**

- Consumes: `traitOf` (Task 4)
- Produces:
  - `STEP_UP = { headCoach: { lifer: 5, climber: 15 }, coordinator: { lifer: 3, climber: 13 }, cool: 0.05 }`
  - `wantsStepUp(seed: string, season: number, c: Coach, chair: CoachRole): boolean`

- [ ] **Step 1: Write the failing tests:**

```ts
it('never takes a lifer up, always a climber, and the same answer all offseason', () => {
  expect(wantsStepUp('s', 2030, dc({ ambition: 5 }), 'headCoach')).toBe(false);
  expect(wantsStepUp('s', 2030, dc({ ambition: 15 }), 'headCoach')).toBe(true);
  const c = dc({ ambition: 10 });
  expect(wantsStepUp('s', 2030, c, 'headCoach')).toBe(wantsStepUp('s', 2030, c, 'headCoach'));
});
it('says yes about (ambition − 5) / 10 of the time, less after 55', () => {
  // share over 1,000 ids at ambition 10, age 45 ≈ 0.5 (±0.05); at age 65 ≈ 0.0
});
it('hires the best willing man and logs the top choice who said no', () => {
  // a team whose best-scored riser is a lifer: the pick is someone else, and
  // league.transactions gains "NYX’s top choice, defensive coordinator Ray Holt, turned down head-coach talks."
});
it('hires a journeyman when nobody willing is left', () => {
  // every candidate unwilling → a new coach is signed; the chair is filled
});
it('turns down your promotion or poach with the reason, the same answer AI clubs get', () => {
  expect(promoteProblem(l, user, lifer)).toBe('He’s happy as defensive coordinator: he won’t take head-coach talks.');
  expect(poachProblem(l, user, otherLifer)).toBe('He’s happy as defensive coordinator: he won’t take head-coach talks.');
});
it('gives the same answers after a save round-trip mid-offseason', () => {
  // JSON.parse(JSON.stringify(l)) → same wantsStepUp for every coordinator
});
```

- [ ] **Step 2:** `npx vitest run src/engine/coachTraits.test.ts src/engine/coaching.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The decision:** `wantsStepUp` uses the `headCoach` row for a head-coach chair, else the `coordinator` row.
    Lifer or less is no; climber or more is yes. Otherwise it's yes when
    `new Rng(\`${seed}:wants:${season}:${id}:${chair}\`).next() < (ambition − lifer) / 10 − cool × max(0, age − 55)`.
  - **The search:** `fillChairs` scores every candidate as now. The pick is the best whose `x.as === x.c ||
wantsStepUp(...)`. If the best overall is unwilling and the chair is head coach or coordinator, it calls
    `logCoach(..., true)` with `${abbrev}’s top choice, ${titleLower(c)} ${coachName(c)}, turned down ${job} talks.`,
    where `job` is `head-coach` or `coordinator`.
  - **Your moves:** `promoteProblem` and `poachProblem` return `He’s happy as ${titleLower(c)}: he won’t take ${job}
talks.` right after the owner-mandate check.
  - **Interims are untouched:** `installInterimHeadCoach` doesn't ask.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** `npm run typecheck && npm run format`, then commit: "Coach agency: wanting the step up".

### Task 9: Agency, stepping down

**Files:** Modify `src/engine/coachTraits.ts`, `src/engine/coaching.ts` (`dismiss` :929, `ensureCoached` :1868, new
`stepDown`). Test: `src/engine/coachTraits.test.ts`, `src/engine/coaching.test.ts`

**Interfaces:**

- Consumes: `traitOf` (Task 4); `rollStyle`, `rollScheme` (existing)
- Produces:
  - `STEP_DOWN = { base: 0.3, perYear: 0.04, fired: 0.2, perAmbition: 0.05, interim: 0.4, camp: 0.2, min: 0.05, max: 0.9 }`
  - `headStints(c: Coach): number`: runs of consecutive head-coach seasons with one club
  - `stepsDown(seed: string, season: number, c: Coach, when: 'dismissed' | 'interim' | 'camp'): boolean`
  - `stepDown(league: League, c: Coach): boolean` in `coaching.ts`: false when he has no side

- [ ] **Step 1: Write the failing tests:**

```ts
it('steps down more often when old, fired before or unambitious; an interim most of all', () => {
  // shares over 1,000 ids: age 62 > age 45; headStints 2 > 1; ambition 4 > 16; 'interim' > 'dismissed'
});
it('moves him to his side’s coordinator chair with his scheme, and logs it', () => {
  const c = firedHc({ career: [...asDefCoord(2028, 2029), ...asHc(2030, 2032)] });
  expect(stepDown(l, c)).toBe(true);
  expect(c.role).toBe('defCoord');
  expect(c.scheme?.front).toBeDefined();
  // league.transactions gains "Former NYX head coach Ray Holt will look for coordinator jobs."
});
it('keeps a man who never coordinated waiting, and sends an interim back to his acting side', () => {
  expect(stepDown(l, neverCoordinated)).toBe(false);
  // interim with actingAs 'offCoord', no coordinator rows → offCoord
});
it('drops ambition by 3 at his second firing, once', () => {
  // dismiss a head coach whose career shows a second stint: ambition −3; dismiss again in a later stint: no change
});
it('lets a stepped-down coach climb back as a riser', () => {
  // he appears in risers(league, team, { role: 'headCoach' }, false) next offseason when he wants the step up
});
```

- [ ] **Step 2:** `npx vitest run src/engine/coachTraits.test.ts src/engine/coaching.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The chance:** `stepsDown` rolls on `${seed}:stepDown:${season}:${id}:${when}` against
    `clamp(base + perYear × max(0, age − 50) + (headStints > 1 ? fired : 0) − perAmbition × (ambition − 10)
+ (when === 'interim' ? interim : 0) + (when === 'camp' ? camp : 0), min, max)`.
  - **The move:** `stepDown` finds his side: `actingAs` if set, else his last `offCoord`/`defCoord` career row, else
    none (return false). It sets `role`, deletes `room`, fills a missing style or scheme for the new role as
    `asPromoted` does (its seeded `rollStyle` and `rollScheme`), and logs
    `Former ${abbrev} head coach ${coachName(c)} will look for coordinator jobs.` (headline).
  - **On dismissal:** `dismiss` reads `role` and `interim` before clearing them. For a head coach: if
    `headStints(c) === 2`, ambition −3 (floor 1). Then if `stepsDown(..., interim ? 'interim' : 'dismissed')`,
    `stepDown`.
  - **At camp:** `ensureCoached`, before `CAMP_DRIFT`, gives every market head coach the `'camp'` decision.
- [ ] **Step 4:** Run the same tests. Expected: PASS.
- [ ] **Step 5:** `npm run typecheck && npm run format`, then commit: "Coach agency: a fired head coach can step
      down".

### Task 10: Pedigree demand and the strongest pull

**Files:** Modify `src/engine/trees.ts` (`Index.winners` :40, `winningSeasons` :195, `treeLean` :428),
`src/engine/coaching.ts` (`fillChairs` score :1837–1851). Test: `src/engine/trees.test.ts`, `src/engine/coaching.test.ts`

**Interfaces:**

- Consumes: `traitOf`, `LOYAL` (Tasks 4–5)
- Produces:
  - `PEDIGREE = { floor: 0.4, top: 0.7, halfLife: 3 }`
  - `PEDIGREE_PULL: Partial<Record<CoachRole, number>> = { headCoach: 0.5, offCoord: 0.3, defCoord: 0.3 }`
  - `pedigreeDemand(league: League, c: Coach): number` (0–1)
  - `treeLean(league, hc, c, role, riserPull = 0): number`

- [ ] **Step 1: Write the failing tests** (`trees.test.ts`, "pedigree"):

```ts
it('is 0 under three seasons on a winner’s staff', () => expect(pedigreeDemand(l, twoSeasons)).toBe(0));
it('is more than 0 from the season his mentor becomes a winner, with no tree', () => {
  // mentor .600 over 4 seasons → 0; after his 5th → > 0; hasTree(mentor) false throughout
});
it('is stronger under a stronger winner, and fades with seasons since he left', () => {
  expect(pedigreeDemand(l, under700)).toBeGreaterThan(pedigreeDemand(l, under560));
  // the same man 3 seasons later ≈ half
});
it('takes the best mentor, not the sum', () => {
  expect(pedigreeDemand(l, twoMentors)).toBe(Math.max(pedigreeDemand(l, onlyA), pedigreeDemand(l, onlyB)));
});
it('fades pre-league service to 0, so founding men keep their old leans', () => {
  expect(pedigreeDemand(l, foundingMan)).toBe(0);
});
it('is pure', () => {
  const before = JSON.stringify(l);
  expect(pedigreeDemand(l, c)).toBe(pedigreeDemand(l, c));
  expect(JSON.stringify(l)).toBe(before);
});
it('pulls by the strongest of tie, standing, pedigree and riser, with penalties on top', () => {
  // hot tree (−0.15) + pedigree 1 (−0.5) → −0.5, not −0.65
  // withering tree (+0.4) + pedigree 1 → +0.4 − 0.5
  // crowd still adds TREE_CROWD per tree hire this offseason
  // riserPull −0.6 with pedigree 1 → −0.6
});
it('gives position coaches no pedigree pull, and changes nothing when nobody has pedigree', () => {
  expect(treeLean(l, null, pedigreePositionCoach, 'positionCoach')).toBe(0);
  // existing carousel tests unchanged
});
```

- [ ] **Step 2:** `npx vitest run src/engine/trees.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **The cache:** `Index.winners` entries gain `share: Map<number, number>` (win share through each head-coach
    season, filled in the same pass as `winning`).
  - **Demand:** `pedigreeDemand` = max over `headCoach` links of `strength × 0.5 ** (max(0, season − 1 − last) /
halfLife)`, counted only when `winnerAsOf` holds. Strength is
    `floor + (1 − floor) × clamp((share − 0.55) / (top − 0.55), 0, 1)`, or `floor` for an `'always'` root.
  - **The pull:** `treeLean` follows the spec's formula (§3):
    `min(tie, min(0, standing), −PEDIGREE_PULL[role] × demand, riserPull) + max(0, standing) + crowd`.
  - **The riser's pull:** `fillChairs` computes `hot = −HOT × (winShare − 0.5)` for a riser, keeps `max(0, hot)` in
    its score and passes `min(0, hot)` as `riserPull`.
- [ ] **Step 4:** `npx vitest run src/engine/trees.test.ts src/engine/coaching.test.ts`. Expected: PASS.
- [ ] **Step 5:** `npm run typecheck && npm run format`, then commit: "Pedigree as demand: the strongest pull wins".

### Task 11: The character box

**Files:** Modify `src/engine/coachTraits.ts`, `src/ui/screens/Coaches.tsx` (`CoachCard` :658, after `CoachTags`),
`docs/UI.md` (Fog of war, Show). Test: `src/engine/coachTraits.test.ts`

**Interfaces:**

- Consumes: `traitOf` (Task 4)
- Produces: `coachCharacter(c: Coach): { name: string; lines: string[] }`

- [ ] **Step 1: Write the failing tests:**

```ts
it('names the most distinctive trait that acts in his chair', () => {
  expect(coachCharacter(dc({ ambition: 18, loyalty: 12 })).name).toBe('Climber');
  expect(coachCharacter(hc({ discipline: 3 })).name).toBe('Player’s Coach');
  expect(coachCharacter(dc({ discipline: 3 })).name).toBe('Steady Hand'); // discipline acts for head coaches only
  expect(coachCharacter(pc({ adaptability: 20 })).name).toBe('Steady Hand'); // adaptability: coordinators only
});
it('adds the next trait’s line when it also stands out', () => {
  expect(coachCharacter(dc({ ambition: 18, adaptability: 17 })).lines).toEqual([
    'He wants his own team, and soon.',
    'Runs whatever his head coach asks.',
  ]);
});
it('never names a head coach a Lifer, but says what low ambition means', () => {
  const ch = coachCharacter(hc({ ambition: 3 }));
  expect(ch.name).not.toBe('Lifer');
  expect(ch.lines).toContain('If he lost this job, he’d run a side of the ball again rather than wait.');
});
it('reads a retired coach by his last chair', () => {
  // a coach in league.retiredCoaches with role 'defCoord' and adaptability 3 → 'True Believer'
});
```

- [ ] **Step 2:** `npx vitest run src/engine/coachTraits.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - **Which traits act:** a head coach gets ambition, loyalty and discipline. A coordinator gets ambition, loyalty
    and adaptability. Anyone else gets ambition and loyalty.
  - **What stands out:** high is 15 or more, low is 6 or less. Order by distance from 10.5, ties by ambition,
    loyalty, adaptability, discipline.
  - **The name** comes from the first that can name him (a head coach's low ambition can't), else `Steady Hand`.
  - **The lines** are the first two standouts' lines, else `Nothing extreme: a pro’s pro.`
  - **Copy,** verbatim from spec §4, curly apostrophes:

    | Trait        | High                                                                                   | Low                                                                       |
    | ------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
    | Ambition     | Climber · He wants his own team, and soon.                                             | Lifer · Happy where he is; he doesn’t chase the next job.                 |
    | Loyalty      | Loyal Lieutenant · Answers when his old boss calls, and stays when he’s wanted.        | Hired Gun · Goes where the job is best; don’t count on a hometown discount. |
    | Adaptability | Chameleon · Runs whatever his head coach asks.                                         | True Believer · Runs his own system wherever he goes.                     |
    | Discipline   | Disciplinarian · Runs a tight ship: few flags, a quieter room.                         | Player’s Coach · His players love him; so do the officials’ flags.        |

    A head coach's low-ambition line: `If he lost this job, he’d run a side of the ball again rather than wait.`
  - **The box:** `CoachCard` renders `<div className="report"><span className="eyebrow">Around the
league</span><p><b>{name}.</b> {lines.join(' ')}</p></div>` after `<CoachTags c={c} />`.
  - **Docs:** `docs/UI.md`'s Show list gains "`coachCharacter` (a coach's reputation, public), in words".
- [ ] **Step 4:** `npx vitest run src/engine/coachTraits.test.ts src/ui/ui.test.ts`. Expected: PASS (the screen
      contract allows no "trait" in copy).
- [ ] **Step 5:** `npm run typecheck && npm run format`, then commit: "Coach card: the character box".

### Task 12: Report agency in the offseason check

**Files:** Modify `scripts/offseason.ts` (the carousel line :413 and `carouselRun` :632)

- [ ] **Step 1: Add three informational numbers** to each season's carousel line and to the run's summary. They are
      not `check()`s, so they never fail a run:
  - **refusals:** this season's `league.transactions` texts containing "turned down"
  - **step-downs:** texts containing "will look for coordinator jobs"
  - **former head coaches coordinating:** coaches on a staff as `offCoord`/`defCoord` with a `headCoach` career row
- [ ] **Step 2:** `npm run offseason -- 2`. Expected: the new numbers print, and no ✗ that main doesn't have.
- [ ] **Step 3:** `npm run typecheck && npm run format`, then commit: "Offseason check: report refusals and
      step-downs".

### Task 13: Calibrate on 8 worlds (aim off the floor)

**Files:** constants only: `STEP_UP`, `STEP_DOWN` (`coachTraits.ts`), `PEDIGREE`, `PEDIGREE_PULL` (`trees.ts`).
`$SCRATCH/yoy.patch` stays applied.

- [ ] **Step 1: Agency first.** Run `npm run offseason -- 6` and compare the step-down share and refusals per cycle to
      `docs/research/coaching-carousel.md`'s targets. Move `STEP_DOWN.base` and the `STEP_UP` thresholds until
      they're near the research. The carousel means must also be no further from their NFL figures than main's.
- [ ] **Step 2: Then pedigree.** Sweep `PEDIGREE_PULL.headCoach` (try 0.3, 0.5, 0.8, 1.2) with `worlds.ts`. Keep the
      value whose 8-world means sit closest to the **aims** with every world in its pass zone. Then set the
      coordinator weight (start at 60% of the head coach's) and the half-life (2–4).
- [ ] **Step 3: Pass rule** (Global Constraints): every world in every pass zone, and each careers mean in its
      band's middle half. If a number can't reach its middle half, **stop and report why** to the owner. Don't
      settle at the floor.
- [ ] **Step 4:** Commit the constants: "Calibrate coach agency and pedigree on 8 worlds".

### Task 14: Guardrails and the tree-birth gate

- [ ] **Step 1:** `npm run offseason -- 6`: the coaching ledger at ×1.00, and nothing flagged that main didn't flag.
- [ ] **Step 2:** `npm run morale`, `npm run sim -- 10`, `npm run crews`: nothing flagged. Flags per game sit within
      main's run-to-run spread.
- [ ] **Step 3:** `npm run trades`: compare with `$SCRATCH/baseline-trades.txt`, and nothing flagged.
- [ ] **Step 4:** `worlds.ts`: head-coach changes about 7 a year, and the YoY win-share correlation about 0.335.
- [ ] **Step 5: Tree-birth gate.** Compare the spread of trees born across the 8 worlds with Task 1's.
  - **Narrower:** done.
  - **Not narrower:** **stop** and bring the owner a step-two proposal (a simpler birth rule) before any code.

### Task 15: Price (only if Task 2 flagged it)

- [ ] **Step 1:** If Task 2 flagged the price, **stop and bring the owner a concrete proposal**: one ask for the
      budget check and the salary, AI clubs and you alike, with the league's average ask unchanged. Build it only on
      their OK, then rerun Tasks 13–14. Otherwise skip this task.

### Task 16: Ship

**Files:** `package.json` (version), `src/ui/changelog.ts`, `docs/MVP.md`

- [ ] **Step 1:** Bump `package.json` to `0.2.25` (a follow-up, not an MVP item: PATCH).
- [ ] **Step 2:** Add the 0.2.25 entry at the top of `CHANGELOG` (`src/ui/changelog.ts`), in a player's words. Title:
      "Coaches with character". Text: coaches have ambition, loyalty, adaptability and discipline; some chase head-coach
      jobs and some won't; fired head coaches can go back to coordinating; winning staffs' assistants are in demand;
      each coach's card says what he's like.
- [ ] **Step 3:** Tick the MVP.md follow-up and add one line naming this PR's 8-world means against their bands.
- [ ] **Step 4:** `git apply -R $SCRATCH/yoy.patch`. `git status` must show only this task's files. Then
      `npm run typecheck && npm run format` and commit: "0.2.25: coaches with character".
- [ ] **Step 5:** `git push -u origin claude/dreamy-ptolemy-ewoozy`, then open the PR. The body carries the 8-world
      before/after table (the mean and every world against the pass zone and middle half), the carousel against the
      NFL figures, and the guardrails. CI runs every check (the `package.json` change).
- [ ] **Step 6:** Read CI once, batch any fixes locally, and push again.
