# The spatial engine, slice one: the open field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Your games' runs past the line, catches and kick returns are played by players moving on a field (20 steps a
second), and the replay shows exactly what was played; hidden behind a switch until parity, film, audit and speed pass.

**Architecture:**
- **`src/engine/field/`** is a new pure module. It takes over the staging pieces the start needs (formations,
  blocking by the call, routes, the pocket, steering) from `src/ui/stage/`. It adds:
  - **the approach:** the snap to the moment of possession, staged blind to the result;
  - **the open field:** `runField`, bodies, the carrier's read, pursuit, blocks and contests.
- **`gameSim.ts`** still rolls everything up to possession, on its own stream as today. At an eligible moment it
  builds a `FieldStart`, runs `runField` on the play's own stream, and maps the `FieldResult` back to today's
  `PlayResult`. Fumbles, injuries, penalties, downs and the clock stay the engine's.
- **The replay** rebuilds the same start from the play log, the field record and a per-game snapshot of what the sim
  read, re-runs it, and shows those frames.
- **`npm run parity`** proves both sims give the same results, matchup by matchup. A fit script sets the six knobs
  once.

**Tech Stack:** TypeScript, Vitest, `tsx` scripts (`npm run parity`, `film`, `audit`, `sim`), child processes for
parity like `npm run trades`.

**Spec:** `docs/superpowers/specs/2026-11-03-spatial-open-field-design.md` (approved; binding).

## Decisions this plan makes (owner, please confirm)

The spec leaves these open. Each is the plan's call, and you can veto any one.

1. **Two new contests for the field, and no screen changes.**
   - The new contests are `burst` `{ agility: 1 }` (acceleration, cuts) and `reads` `{ awareness: 1 }` (reaction, a
     defender's angle, a runner's lane).
   - Each one's `positions` are only the positions whose overall already weighs that attribute. So no screen's list
     of relevant attributes changes.
   - Top speed is `longSpeed` for every man. It's read off-position, the way `rushQuirks` already reads it for edge
     rushers.
2. **Agility and awareness stay small.** Today's open field reads neither, so a big effect would tilt your games. In
   parity, a +5 bump of either may move yards a touch by at most 0.3. The audit still proves each one moves play.
3. **The line state.**
   - It's `z = (raw roll − 3.86) / 2.9`: the run's whole roll (line, back, call, quirks) in standard deviations from
     the league's mean carry (`RUN_BASE`).
   - A clean hole holds longer. Each line block holds `max(0, hold × (1 + 0.5 z) + N(0, 0.25))` seconds past the line.
4. **Returns credit no tackles.** Today's box score has none for coverage units. The field picks the tackler for the
   film only.
5. **Weather and fatigue add nothing new.** Today they reach the open field only through the fumble roll and a tired
   front's `gassed`. The sim reads `tired` for `gassed` and nothing else.
6. **Missed tackles are judged against the NFL**, not today's engine. Today's engine counts at most one, on
   breakaways. The band is 0.12–0.24 a back's touch (SIS 2021: 0.18).
7. **Rows held to today's engine only.** Where `npm run sim` has no NFL range (yards after the catch, return yards),
   the row is held to today's engine, with the NFL number shown beside it.
8. **The snap's spot across the field is the engine's, and it's logged** (`field.y`). The replay re-spots the ball
   there, as officials do.
9. **The kickoff is caught at the receiving 3**, today's engine's own assumption.
10. **The developer switch shows only with `?dev` in the address.** Turning it on by default after the gate is a
    separate decision, not in this plan.

## Global Constraints

- **AI games don't change.**
  - With the switch off (every AI game), every game plays exactly as on `origin/main`: score, `playerStats` and
    plays.
  - `npm run sim -- 10` prints the same numbers as `origin/main`.
  - Building a `FieldStart` for the tap (parity) draws nothing from any game stream.
- **The field's streams.**
  - The field never draws from the game's `rng`.
  - A play's stream is `${gameSeed}:field:${index}`, where `index` is the play's index in the game's log.
    `gameSeed` is the seed the game ran on (`options.seed`, else `${league.seed}:${season}:${gameId}`).
  - The approach draws from `…:approach`, the line's holds from `…:hold`, and `runField` from the stream itself.
- **The draw order on a spatial play.**
  - Today's rolls are drawn exactly as today, through the tackler pick: the line roll, the breakaway rolls, the yards
    after the catch, the return roll, and `pickTackler` when today's result isn't a touchdown.
  - From the fumble roll on, the game's stream follows the play's final (spatial) result, in today's order: fumble,
    recovery, out of bounds, duration. The out-of-bounds and duration draws are taken and their values discarded.
- **`src/engine/field/` is pure.** No DOM, React, `Math.random` or `src/ui` import (unit-tested).
- **Ratings only through `skill(player, contest)`.** The field reads `FieldSkills` built from contests. Size goes
  through `size.ts` (`sizeEdge`), never `player.ratings`.
- **The start is blind to the outcome.**
  - `FieldMoment` holds the call, the catch spot, coverage, pressure and the line state.
  - It never holds `to`, yards, the tackler or the log's text past a `Designed shot: ` prefix.
- **The output is the same `PlayResult`.** Box scores, stat keys, play text and downs keep their shapes. No new stat
  keys.
- **Saves.** `SAVE_VERSION` goes 81 → 82, with a `migrate.ts` step. `League` stays plain JSON. Older games and
  switch-off games keep the drawn replay.
- **The switch is hidden.** `League.settings.spatialField` is off by default and shown only as a developer toggle.
- **Never loosen a range.** If the fit can't bring a parity row inside its tolerance, stop and report to the owner
  with the numbers.
- **Constants.** `STEP = 0.05` is shared by the field and the stager, one constant.
- **Version.** 0.3.4 (a patch: the match engine's MVP item is already Done). Add a changelog entry in a player's
  words.
- **Every commit.** Run `npm run format` before each commit, and never run `npm run check` (CI does).
- **Every task.** Run `npm run typecheck` and the touched tests. From Task 6 on, also run `npm run sim -- 10`, unchanged
  from `origin/main`.

## Review Focus

1. **The field's edges.** These cases end with every frame in bounds, no NaN, and the engine's own clamps:
   - a run from the 1;
   - a catch on the sideline;
   - a catch behind the line at your own 2: a tackle in the end zone is a safety, as today;
   - a punt caught at the 12.

   Tests: Task 3 (geometry) and Task 6 (the safety).
2. **A play the field can't start**, because the carrier or a side is short of men in the cast. That play keeps
   today's result, with no `field` facts, and nothing throws. Tests: Task 5 (`approach` returns null) and Task 6.
3. **A flagged spatial snap, and a lost fumble after a spatial tackle.**
   - The flagged snap replays from `ran.field`.
   - The lost fumble stages drawn from the sim's outcome (spot, tackler).

   Test: Task 7.
4. **Saves across the switch.**
   - A v81 save loads with the switch off.
   - A spatial game replays the same after a JSON round trip.
   - It still replays spatially after the switch is turned off.
   - New games after that are drawn.

   Tests: Task 6 (migrate) and Task 7 (round trip, switch off).
5. **Degenerate open fields.**
   - A carrier nobody can reach scores.
   - A cornered carrier with `stayIn` goes down in bounds.
   - The 20 s limit is never hit.
   - A live game (`startLiveGame`) with the switch on stages each play as it comes (`fieldNow()` carries the snapshot
     so far).

   Tests: Task 3 (the first three) and Task 7 (live).

---

### Task 1: The outcome-blind staging moves into the engine

**Files:**

- Move with `git mv` from `src/ui/stage/` to `src/engine/field/`:
  - modules: `speed.ts`, `formations.ts`, `cast.ts`, `runBlocks.ts`, `routes.ts`, `concepts.ts`, `pocket.ts`,
    `habits.ts`, `carrier.ts`, `steer.ts`;
  - tests: `runBlocks.test.ts`, `routes.test.ts`, `concepts.test.ts`, `pocket.test.ts`, `carrier.test.ts`.
- Create `src/engine/field/geometry.ts`:
  - `FIELD_W`, `MID`, `HASH_LO`, `HASH_HI`, `clampY`, `Seg` and `offenseSide`, moved out of `ballPath.ts`;
  - new: `laneY(snapY: number, lane: number, dir: 1 | -1): number`, which is `clampY(snapY + lane * dir * 16)`.
    `basePath` uses it.
- Create `src/engine/field/keys.ts`: `Keyframe`, `sample`, `ballTrack`, `passFlight` and `BEAT_ACROSS`, moved out of
  `scripts.ts`.
- Modify:
  - `ballPath.ts` and `scripts.ts` re-export what moved, so other UI importers don't change;
  - every importer of a moved module (`stage.ts`, `scripts.ts`, `presnap.ts`, `fouls.ts`, `finale.ts`,
    `transition.ts`, `injury.ts`… grep them) and `scripts/film.ts`;
  - `scripts/check.ts`: the `film` rule gains `^src\/engine\/field\/`.
- Test: `src/engine/field/field.test.ts`

**Interfaces:**

- Produces: the moved modules under `src/engine/field/`, with unchanged exports. Plus `laneY` and `keys.ts`.

- [ ] **Step 1: Write the failing test** `it('keeps the field engine pure: no UI, DOM or Math.random')`. It reads every
      non-test `.ts` under `src/engine/field/` and asserts:
  - at least 12 files;
  - none matches `/from '[^']*\/ui\//`, `/Math\.random/`, `/\bdocument\.|\bwindow\./` or `/from 'react'/`.
- [ ] **Step 2:** Run `npx vitest run src/engine/field/field.test.ts`. Expected: FAIL (fewer than 12 files).
- [ ] **Step 3: Implement** the move. Behaviour doesn't change: no line of logic is edited, only paths and the two
      new files.
- [ ] **Step 4:** Run:
  - `npx vitest run src/engine/field/ src/ui/stage/ src/ui/viewer.test.tsx src/ui/ui.test.ts`;
  - `npm run typecheck`;
  - `npm run film -- 50`.

  Expected: all PASS, and film's numbers identical to before the move.
- [ ] **Step 5: Commit:** `git commit -m "Field: the outcome-blind staging moves into the engine (src/engine/field)"`

### Task 2: The field's contests and skills

**Files:**

- Modify:
  - `src/engine/attributes.ts`: add `burst` and `reads`;
  - `src/engine/attributes.test.ts`;
  - `src/engine/size.ts`: `sizeEdge`'s players widen to `Pick<Player, 'position' | 'heightIn' | 'weightLb' | 'playsBig'>`
    (the body is unchanged).
- Create:
  - `src/engine/field/types.ts`: `FieldSkills`, `FieldPlayer`, `FieldStart`, `FieldResult`, `FieldKind`;
  - `src/engine/field/skills.ts`;
  - the `FIELD_HABITS` export in `src/engine/field/habits.ts`.
- Test: `src/engine/field/skills.test.ts`

**Interfaces:**

- `CONTESTS.burst = { label: 'Burst', positions: ['QB', 'RB', 'WR', 'OL', 'DT', 'EDGE', 'CB'], weights: { agility: 1 }, decides: 'acceleration and cuts in the open field' }`
- `CONTESTS.reads = { label: 'Reading the field', positions: ['QB', 'RB', 'WR', 'OL', 'DT', 'LB', 'CB', 'S'], weights: { awareness: 1 }, decides: "reacting to a cut, a defender's angle, a runner's lane" }`
- `interface FieldSkills`. Every number is rounded to 0.01, and the sim reads the rounded value:
  - size: `pos: Position; h: number; w: number; big?: 1`. These are `sizeEdge`'s build: position, height, weight,
    `playsBig`.
  - `speed` is `longSpeed`.
  - `burst` is `burst`.
  - `reads` is `reads`.
  - `pursuit` is `pursuit`.
  - `tackle` is `tackling`.
  - `shed` is `runDefense` for DT and EDGE, `runFit` for LB and S, and `tackling` for anyone else.
  - `block` is `runBlocking`.
  - `move` is `afterCatch`.
  - `ret` is `returns`.
  - `power` is `breakTackles`.
  - `habits?: QuirkId[]`: his active quirks that are in `FIELD_HABITS`, sorted.
- `function fieldSkills(p: Player, habits: (p: Player) => readonly QuirkId[]): FieldSkills`
- `const FIELD_CONTESTS: readonly ContestName[]`: the 11 contests above. The test that declares only read contests
  reads these too.
- `function fieldJobs(pos: Position): Attribute[]`: attributes that weigh at least 0.5 in a field contest read at
  `pos`. The audit uses it (Task 10).
- `FIELD_HABITS: ReadonlySet<QuirkId>`, 19 of them:
  - carriers: `jumpCutter`, `highKnee`, `contactAverse`, `yacSlasher`, `runsEastWest`, `softHands`,
    `finishesForward`;
  - the line and the front: `secondLevel`, `pancakePreacher`, `unblockable`, `gassed`, `highMotor`;
  - defenders: `armTackler`, `thumper`, `businessDecision`, `stuckOnBlocks`, `slowFlow`, `diagnoses`, `alleyCrusher`.
- `types.ts` holds the spec's interfaces, made exact:
  - **`FieldPlayer`:** `{ id: number; side: 0 | 1; role: Role; x: number; y: number; vx: number; vy: number; s: FieldSkills }`.
    `side` 0 is the carrier's team.
  - **`FieldStart`:** the spec's fields plus three more:
    - `kind: FieldKind`, which is `'run' | 'catch' | 'return'`;
    - `edge: number`: a return's special-teams coaching edge in rating points, 0 on scrimmage;
    - `tired: boolean`.

    Two spec fields are made exact:
    - `clock` is `{ outOfBounds: boolean; stayIn: boolean }`;
    - `players` is in cast order (offense, then defense), and `frames` use the same order.
  - **`FieldResult`:** the spec's, with `misses: { by: number; how: 'size' | 'move'; t: number; move?: MoveKind }[]`.
    `t` is seconds from `t0`.

- [ ] **Step 1: Write the failing tests:**
  - `it('reads every man through contests, on the 1–20 scale')`: with every rating at 13, every numeric skill is 13.
  - `it('takes the shed from the front's run defense, the second level's run fit, and tackling elsewhere')`
  - `it('rounds to hundredths, so a snapshot replays exactly')`
  - `it('leaves every position's relevant attributes as they were')`: for each of `POSITIONS`,
    `relevantAttributes(pos)` equals the same list computed with `burst` and `reads` left out of `CONTESTS`.
  - `it('finds the field's main jobs')`:
    - `fieldJobs('RB')` ⊇ `['speed', 'elusiveness']`;
    - `fieldJobs('CB')` ⊇ `['tackling', 'speed']`;
    - `fieldJobs('OL')` ⊇ `['runBlock']`;
    - no position lists `throwAccShort`.
  - Update `'declares only contests the match engine actually reads'` to read `field/*.ts` too.
- [ ] **Step 2:** Run `npx vitest run src/engine/field/skills.test.ts src/engine/attributes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Field: burst and reads contests, and the skills the open field reads"`

### Task 3: Bodies, the carrier's read and the chase

**Files:**

- Create:
  - `src/engine/field/tuning.ts`: `KNOBS` and the fixed constants below;
  - `body.ts`, `read.ts`, `chase.ts`, `run.ts` (`runField`);
  - `fixtures.ts`: `startOf(partial)`, hand-built starts for tests.
- Test: `body.test.ts`, `read.test.ts`, `run.test.ts`

**Interfaces:**

- **Starting knobs.** The Task 9 fit replaces the values; each knob keeps a comment saying what it scales:

  ```ts
  export const KNOBS = { react: 1, angle: 1, tackle: 0.72, move: 0.25, afterContact: 1.2, shed: 0.9, hold: 0.6 };
  ```

- **`bodyOf(p: FieldPlayer, tired: boolean): Body`**, with
  `Body = { x; y; vx; vy; top; accel; cut; react; downUntil }`:
  - `top`: `SPEED[role] + 0.15 × (speed − 12)`, clamped to `SPEED[role] ± 1.5`. A `gassed` man when `tired` loses 0.5.
  - `accel`: `6 + 0.25 × (burst − 12)`, clamped to 4–8 yd/s².
  - `cut`: `10 + 0.4 × (burst − 12)` yd/s² across his line.
  - `BRAKE`: 9 yd/s².
  - `react`: `KNOBS.react × (0.3 − 0.02 × (reads − 12))`, clamped to 0.12–0.5 s. `slowFlow` adds 0.2 and `diagnoses`
    takes 0.1 off.
- **`stepBody(b: Body, want: { vx: number; vy: number }, dt: number): void`**: a point mass.
  - The gain along his heading is at most `accel·dt`, across it at most `cut·dt`, and a slowdown at most `BRAKE·dt`.
  - `|v| ≤ top` always.
  - Everyone but the carrier is kept to y 0.5…`FIELD_W` − 0.5 and x −10…110.
- **`readField(…): { vx: number; vy: number }`**: the carrier's heading.
  - Re-read every `READ_EVERY = 0.25` s, or 0.15 s for a `jumpCutter`.
  - He scores 17 headings, −80°…80° from upfield in 10° steps.
  - A heading's score is the upfield yards he covers along it before any free defender can reach the path.
  - A defender's arrival is `|p − d| / top + react`. Add `BLOCK_DELAY = 0.6` s when he's engaged, or a teammate of
    the carrier stands within 1 yd of his straight line.
  - The path stops 1 yd inside the sideline.
  - Each heading gets noise of `N(0, 2.5 × (1 − 0.05 × (reads − 12)))` yards.
  - **The sideline.**
    - With `clock.outOfBounds`, he takes the nearer sideline when its score is within 2 yd of the best.
    - When cornered (best under 1 yd, a sideline within 4 yd) he goes out, unless `clock.stayIn`.
- **`chase.ts`.**
  - **Free defenders** aim at `carrier + v_carrier × τ × q`:
    - `τ` is his time to intercept;
    - `q ~ N(1, 0.25 × KNOBS.angle × (1 − 0.04 × (pursuit − 12)))`, drawn at each of his reads;
    - he reads the carrier as he was `react` seconds ago.
  - **Leverage.** A CB or S 5+ yd downfield of the carrier aims 1.5 yd inside the carrier's line, between him and the
    goal, at no more than 0.85 × top until within 6 yd.
  - **Blocks.**
    - An engaged defender moves with his blocker and can't pursue.
    - He sheds each step with probability `KNOBS.shed × e^(0.12 × (shed − block)) × dt`, never before `holdFor`.
    - Unengaged men on the carrier's team past the line take the nearest free defender ahead of the carrier, within 6
      yd of his path, and engage at 1 yd (`holdFor` 0).
  - **Effort.** A defender 10+ yd behind the ball eases to 0.85 × top, unless he's `highMotor`.
- **`runField(start: FieldStart, rng: Rng): FieldResult`**:
  - `REACH = 1.0` yd: contact resolves through `contest()` (Task 4). Here a stub always tackles, with 0 yards after
    contact.
  - A touchdown when he crosses the goal line in bounds: frames run on 0.5 s.
  - Out of bounds at the crossing: frames run on 0.4 s.
  - `MAX_FIELD = 20` s.
  - `frames` are each step from `t0`, frame 0 being the start.

- [ ] **Step 1: Write the failing tests:**
  - `it('never lets a man run faster than his top speed, or leave the field unless he carries the ball')`: 500
    seeded random starts.
  - `it('accelerates and cuts within his limits, sharper at lower speed')`: a 90° turn takes longer at 8 yd/s than at
    3.
  - `it('takes the open lane')`
  - `it('keeps off the sideline unless the clock wants him out, goes out when cornered, and stays in when told')`
  - `it('lets a blocked man go only after his hold, and a weak blocker sooner')`: no shed before `holdFor`. A +6
    shed's mean shed time is shorter.
  - `it('keeps a deep man in front of the carrier')`: a safety starting 15 yd downfield never lets him by without
    contact.
  - `it('closes sooner with a better angle')`: pursuit 18 against 6, over 200 seeds, gives a shorter mean time to
    contact.
  - `it('ends on a touchdown, out of bounds or a tackle, never at the time limit')`: 2,000 random starts, and a
    carrier nobody can reach scores.
  - `it('handles the field's edges')`: a start at x 99 (dir 1), one at y 0.6, and one at x 2 (dir −1) stay finite and
    end correctly.
  - `it('gives the same frames for the same start and seed')`
- [ ] **Step 2:** Run `npx vitest run src/engine/field/`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Field: bodies, the carrier's read, pursuit and blocks"`

### Task 4: Contests, moves and habits

**Files:**

- Create: `src/engine/field/contest.ts`
- Modify:
  - `run.ts` (the stub gives way to `contest`);
  - `chase.ts` and `read.ts` (habit hooks).
- Test: `contest.test.ts`, `habits.test.ts`

**Interfaces:**

- **`contest(c, d, help: number, angle: 'head' | 'side' | 'behind', rng: Rng)`**, which returns
  `{ out: 'tackle' | 'broken' | 'missed'; move?: MoveKind; afterContact: number }`.
  - `help` is the number of other defenders within 1.5 yd.
- **The carrier may try a move first.** He needs room (no other free defender within 2 yd) and at least 3 yd/s.
  - He tries with P `0.35 + 0.02 × (move − 12)`.
  - **How he breaks it.** It's `'size'` when `power + sizeEdge(c, 'contact', d) ≥ move`, else `'move'`.
  - **The move.** It's `pickMove` (moved in Task 1).
  - **Success.** P is `clamp(KNOBS.move + 0.025 × (skill − d.tackle), 0.05, 0.6)`. `skill` is `move`, or on a return
    `ret + edge`.
  - Success is a `'missed'`. He runs the move's shape from `carrier.ts`'s table (juke, jumpCut, spin, runThrough,
    stiffArm: lengths, times, paces) as a velocity programme.
- **The tackle.** P is `clamp(KNOBS.tackle + 0.025 × (d.tackle − c.power) − 0.03 × sizeEdge(c, 'contact', d) + ANGLE[angle] + 0.12 × help − 0.02 × max(0, v − 6), 0.3, 0.97)`.
  - `ANGLE = { head: 0.05, side: 0, behind: −0.12 }`.
- **Not tackled.**
  - It's `'broken'` (the carrier slows to 0.6 × v) when `power + sizeEdge ≥ move`, else `'missed'`.
  - The defender goes down: 1.0 s, shedding 12 yd/s each second. He can't contest again for 1.0 s.
- **Yards after contact.** `afterContact` is
  `max(0, KNOBS.afterContact × (v / 6) × { head: 0.6, side: 1, behind: 1.3 }[angle] + 0.1 × (power − d.tackle) + 0.2 × sizeEdge(c, 'contact', d))`,
  halved with `help`.
- **Habits, each a behaviour.** The test checks its direction:

  | Habit              | Who      | In the field                                                             |
  | ------------------ | -------- | ------------------------------------------------------------------------ |
  | `jumpCutter`       | carrier  | re-reads every 0.15 s; his moves are jump cuts                           |
  | `highKnee`         | carrier  | size breaks are run-throughs; tackle odds against him −0.05              |
  | `contactAverse`    | carrier  | no size moves; afterContact ×0.5; heads for the sideline when cornered   |
  | `yacSlasher`       | catch    | his first read is due at `t0` (upfield at once)                          |
  | `runsEastWest`     | catch    | headings past 40° score +1 yd (he wastes ground)                         |
  | `softHands`        | catch    | +1 yd/s at the catch when air < 10                                       |
  | `finishesForward`  | carrier  | afterContact +0.8                                                        |
  | `secondLevel`      | OL       | blocks downfield from `t0` (other linemen from `t0` + 0.5 s)             |
  | `pancakePreacher`  | OL       | his line block holds 0.3 s longer                                        |
  | `unblockable`      | DT, EDGE | shed ×1.5                                                                |
  | `gassed`           | DT, EDGE | when `tired`: shed ×0.7 (top −0.5, Task 3)                               |
  | `highMotor`        | DT, EDGE | never eases off (Task 3)                                                 |
  | `armTackler`       | defender | tackle odds −0.08                                                        |
  | `thumper`          | defender | afterContact 0 on his tackles                                            |
  | `businessDecision` | defender | tackle odds −0.15 against a carrier of 225 lb or more                    |
  | `stuckOnBlocks`    | LB       | shed ×0.5                                                                |
  | `slowFlow`         | LB       | react +0.2 s (Task 3)                                                    |
  | `diagnoses`        | LB       | react −0.1 s (Task 3)                                                    |
  | `alleyCrusher`     | CB, S    | angle spread ×0.6 when the carrier is outside the tackles                |

- [ ] **Step 1: Write the failing tests:**
  - `it('tackles more with better tackling, head-on, and with help')`
  - `it('breaks more tackles with more power and a bigger build')`
  - `it('makes more men miss with better moves, and a returner with his return skill and the coaching edge')`
  - `it('sends a man who misses on past and down')`: his speed falls by at least `12 × STEP` each step for 1 s, and he
    doesn't contest again for 1 s.
  - `it('carries the pile on further at speed, less head-on and less with help')`
  - `it('records misses in order, with their time and move')`
  - `it('plays each field habit the way its table says')`, two parts:
    - `[...FIELD_HABITS]` equals the table's 19 keys;
    - for each habit, the same 400 seeded starts with the habit on the man and off move its measure in the table's
      direction. For example: `thumper`'s yards after contact on his tackles fall; `runsEastWest`'s yards fall;
      `slowFlow`'s first step toward the carrier comes later.
- [ ] **Step 2:** Run `npx vitest run src/engine/field/`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the same command and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Field: tackles, moves, broken and missed tackles, and the habits"`

### Task 5: The start: from the snap to possession, blind

**Files:**

- Create in `src/engine/field/`:
  - `moment.ts`;
  - `prelude.ts`: the stager's pre-possession builders, extracted from `stage.ts`;
  - `timing.ts`: the run, kick and catch timing, moved out of `scripts.ts` and `stage.ts`;
  - `approach.ts`.
- Modify `src/ui/stage/stage.ts` and `scripts.ts` to import `prelude.ts` and `timing.ts`. Their behaviour is
  unchanged.
- Test: `src/engine/field/approach.test.ts`

**Interfaces:**

- **`FieldFacts`** is `PlayLogEntry.field`, the facts a replay can't read elsewhere:
  - `y: number`: the snap's spot across the field, `MID` on a kickoff;
  - `z?: number`: the run's line state (Decision 3);
  - `tired?: 1`, `out?: 1`, `stay?: 1`: `coach.tempo(s)` is `'hurry'` for `out` and `'milk'` for `stay`;
  - `edge?: number`: a return's coaching edge in rating points, which is
    `(receiving.stCoach − kicking.stCoach) × RETURN_COACH.kick` (or `.punt`) divided by the yards a point of
    `returns` is worth today (`0.6` kick, `0.5` punt).
- **`FieldMoment`.** Everything the approach may read, and nothing else:
  - `kind: FieldKind`, `kick?: 'kickoff' | 'punt'`, `index: number`;
  - `offense: number`: the team with the ball at the snap, the kicking team on a kick;
  - `quarter`, `clock`, `down`, `distance`, `yardLine`;
  - `from: number` and `air?: number`: field x;
  - `lane: number`;
  - `ball: number`: the back, the target, or the returner;
  - `cover?`, `rush?`, `beat?`;
  - `call: DefenseCall`;
  - `shot?: 1`, `bounce?: 1`;
  - `facts: FieldFacts`.
- **`momentEntry(m: FieldMoment): PlayLogEntry`**: the entry the moved stage functions read.
  - It has no `to`.
  - `who` holds only `ball`, `cover`, `rush` and `beat`.
  - `text` is `'Designed shot: '` or `''`.
- **`momentOf(e: PlayLogEntry, record: FieldRecord, index: number, homeId: number): FieldMoment | null`**: the
  replay's side.
  - It reads `asRan(e)`.
  - The call comes from `defenseCallAt`.
  - On a return, the ball carrier is the cast's `RET`.
  - It's null without `field`.
- **`prelude.ts`**: `patternFor(…)`, `pocketFor(…)` and `runReadFor(…)`. These are the blocks of `stagePlay` that
  build the pass pattern, the pocket, and the run's call, hole and blocking. Lift them unchanged; `stagePlay` calls
  them.
- **`approach(m: FieldMoment, record: FieldRecord, homeId: number, gameSeed: string): Approach | null`** returns:
  - `cast` and `dir`;
  - `t0` and `steps`;
  - `frames`: `steps × cast × 2`, from the snap to `t0`, with the last step at `t0`;
  - `ball`: `steps × 3`;
  - `release`, `arrive`, `pocket`, `pattern?`, `run?`, `call`, `blitz`;
  - `lineBlocks: [blocker, defender][]`.
  - It's null when `m.ball` or the QB on a scrimmage play isn't in the cast, or a side has fewer than 11.
- **The scripts, ported from the rule `script()` uses for the same man:**
  - **Run.**
    - The QB meets the back at the mesh (`MESH` 0.8 s, 3 yd behind the ball), then fakes away from the hole.
    - The back presses `holeAt(runReadFor(…))`. He crosses the line at `TLOS + spread` (± `TLOS_SPREAD`), plus
      `PATIENT` for `patientPresser`, with the `DWELL` beat for `dwellsInHole`. He's never above his top speed.
    - `t0` is the first step he's past the line.
    - The line's blocks come from `planRunBlocks` with `exclude` empty, and the puller is scripted as `stagePlay`
      scripts him.
  - **Catch.**
    - The QB runs his `pocketPath`.
    - The target runs `routeKeys` to the catch spot (`air`, `laneY(y, lane, dir)`) and arrives with the ball.
    - The cover man ends `separation` from him: `SEPARATION.catch`'s `N(4, 0.9)`, clamped to 2.5–6.5.
    - Decoys run their concept's assignments.
    - `t0` is the catch.
  - **Return.**
    - Kickoff: the tee, `KICK_RUN_UP` 0.9 s, a flight of `clamp(len / 17, 3.2, 4)` s, and the coverage held until the
      ball lands.
    - Punt: the snap 0.75 s, the hold 0.45 s, a flight of `clamp(len / 11, 3.4, 4.6)` s.
    - The returner is under the ball by the catch.
    - `t0` is the catch.
  - **Everyone else** is steered blind: `steer` with `tackler` and `pursuer` null, `carrier = m.ball`, and the ball
    track cut at `t0`.
- **`fieldStart(a: Approach, m: FieldMoment, skillsOf: (id: number) => FieldSkills | undefined, hold: Rng): FieldStart | null`**:
  - positions come from the last frame, and velocities from the last two;
  - `blocks`:
    - the run's `lineBlocks`, with Decision 3's hold (+0.3 s for `pancakePreacher`);
    - plus any defender within 1.2 yd of, and in front of, a man on the carrier's team other than the carrier, with
      `holdFor` 0;
  - `clock`, `tired` and `edge` come from `facts`;
  - it's null when any of the 22 has no skills.

- [ ] **Step 1: Write the failing tests.** The plays come from a seeded league's games, with moments read through
      `momentOf`.
  - `it('builds the moment from what the play knew before possession, never its result')`: two entries differing
    only in `to`, `text` (past the prefix) and `who.tackle` give deep-equal moments.
  - `it('puts the back at the hole at speed about 2.8 s after the snap')`, over 300 runs:
    - `t0` is in 2.3–3.5;
    - he's within 1.5 yd of the hole;
    - he moves at 3 yd/s or more.
  - `it('puts the target at the catch with his cover man about the separation off')`
  - `it('puts the returner under the ball, the kickoff coverage held to the ball's landing')`
  - `it('keeps every man under his legs from the snap to possession')`: every step's speed is at most
    `SPEED[role] + 1.1`.
  - `it('returns null when the carrier isn't on the field')`
  - `it('stages the same approach twice')`
- [ ] **Step 2:** Run `npx vitest run src/engine/field/approach.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Do the prelude and timing extraction first, and run the stage suite: it stays green.
      Then write `moment.ts` and `approach.ts`.
- [ ] **Step 4:** Run `npx vitest run src/engine/field/ src/ui/stage/ src/ui/viewer.test.tsx`, `npm run typecheck`
      and `npm run film -- 50`. Expected: PASS, and film unchanged.
- [ ] **Step 5: Commit:** `git commit -m "Field: the approach, the snap to possession staged blind to the result"`

### Task 6: The engine plays the open field (save v82)

**Files:**

- Modify:
  - **`src/engine/types.ts`:**
    - `PlayLogEntry.field?: FieldFacts`, and `'field'` in the `ran` Pick;
    - `FieldRecord.snap?: FieldSnapshot`;
    - `League.settings?: { spatialField?: boolean }`.
  - **`src/engine/match/gameSim.ts`:**
    - `SimOptions.field` and `fieldTap`;
    - the field record whenever `keepPlays`, `field` or `fieldTap` is on (both of the last two turn `keepPlays` on);
    - the seams in `runPlay`, `passPlay`, `kickoff` and `punt`;
    - `fieldY`, and the snapshot;
    - `PlayResult.field`, `Anim` gains `'field'`, and `ranAnim` copies it.
  - **`src/engine/generate.ts`:** `SAVE_VERSION = 82`, and new leagues get `settings: { spatialField: false }`.
  - **`src/engine/migrate.ts`:** `if (league.version < 82) { league.settings ??= { spatialField: false }; league.version = 82; }`,
    with a v81-style comment.
  - **`src/engine/league.ts`:** `playGame` and `startLiveGame` pass
    `field: !!league.settings?.spatialField && (game.homeId === league.userTeamId || game.awayId === league.userTeamId)`.
- Test:
  - `src/engine/field/engine.test.ts`;
  - `src/engine/migrate.test.ts`.

**Interfaces:**

- `SimOptions.field?: boolean`
- `SimOptions.fieldTap?: (tap: FieldTap) => void`: called at the end of each eligible play. It draws nothing.
- `interface FieldTap { moment: FieldMoment; start: FieldStart; today: TodayField; result?: FieldResult }`
- `interface TodayField { yards: number; tackler: number | null; touchdown: boolean; outOfBounds: boolean; duration: number }`.
  This is today's rolls; with the switch on, `outOfBounds` and `duration` are the discarded draws.
- **`FieldSnapshot`:** `{ seed: string; players: Record<number, FieldSkills>; later?: [index: number, id: number, s: FieldSkills][] }`.
  - Written for the 22 on every spatial play.
  - `later` holds a man whose skills changed mid-game (a knock after an injury reshuffle), from that play.
- **Eligible moments:**
  - **A run** whose raw roll (`rng.normal` before the breakaway rolls) is 1 yard or more.
  - **A completion** with air < yards to goal.
  - **A kickoff return**: not a touchback, a kick out of bounds or an onside kick.
  - **A punt return**: not a touchback, a downed punt, a fair catch, a kick-catch foul or a block.
  - Never scrambles, conversions, sacks, incompletions or picks.
- **From `FieldResult` to the play:**
  - **Yards.** `yards = Math.round(result.yards)`, then today's clamps: your own goal line, and a touchdown is the
    yards to goal.
  - **The tackler** is credited `tackles`, and `tfl` when yards < 0.
  - **Duration.** `duration = max(3, Math.round(start.t0 + result.duration))`.
  - **Out of bounds** comes from the result.
  - **Text** is today's format.
  - **`open`** keeps `bounce` and `habits`, and `broke` becomes the first miss.
  - **`field`** is the facts.
  - **Returns** credit no tackle (Decision 4). `krYds` and `prYds` come from the spatial end, and the block foul's spot
    is drawn inside the spatial return.
  - **Injuries need no new code.** The sim's tackler, credited `tackles`, takes today's collision roll through `wear`.
    The carrier takes his as today.
  - **Penalties** are today's rolls on the finished play.
- **`fieldY`:**
  - `MID` at each kickoff;
  - after a spatial play, the carrier's end y clamped to `HASH_LO…HASH_HI`;
  - otherwise unchanged;
  - logged as `field.y`.
- **The play's index** is `this.plays.length` when the play resolves. That's its entry's index, since `keepPlays` is
  on.

- [ ] **Step 1: Write the failing tests:**
  - `it('plays spatial games to valid results')`, over 4 games with `field: true`:
    - team rushing yards equal the players' sum;
    - each spatial play's `who.tackle` is a defender on the field;
    - each entry's `to − from` is its yards (field direction);
    - within a drive, the next entry's `yardLine` and down follow from this one's yards;
    - the clock never runs backwards within a quarter;
    - play counts are within ±15% of the same games with the switch off.
  - `it('changes nothing with the switch off or the tap on')`: the same game with no options and with `fieldTap`
    deep-equals in score, `playerStats` and plays.
  - `it('rolls today's dice first')`: a game's first eligible moment gives the same `today` with the switch on and
    off.
  - `it('plays the same spatial game twice')`
  - `it('moves nothing in the week's other games when yours plays spatially')`: `playWeek` with the setting on, then
    off, from the same save. Every non-user game deep-equals.
  - `it('rolls fumbles at the sim's tackle')`: over 20 spatial games, every `forcedFum` goes to the man credited with
    that play's tackle.
  - `it('logs what a replay needs')`: for each spatial play:
    - `momentOf(entry, record, index, homeId)` deep-equals the tap's moment;
    - `record.snap` holds all 22, with the skills the tap's start used.
  - `it('keeps a play the field can't start on today's result')`: stub `approach` to null for one play. It has no
    `field`, and its yards are today's.
  - `it('calls a tackle in the end zone a safety')`: a hand-set moment at the 2 with a forced loss.
  - In `migrate.test.ts`, `it('upgrades v81: the switch off, games kept')`.
- [ ] **Step 2:** Run `npx vitest run src/engine/field/engine.test.ts src/engine/migrate.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.** Follow the draw order in Global Constraints. The seam is one private method per kind:
      `fieldRun`, `fieldCatch` and `fieldReturn`. Each builds the moment, the approach and the start (field streams
      only), resolves with `runField` or keeps today's, and taps.
- [ ] **Step 4:** Run:
  - the same tests, plus `npx vitest run src/engine/`;
  - `npm run typecheck`;
  - `npm run sim -- 10`.

  Expected: PASS, with sim's numbers identical to `origin/main`.
- [ ] **Step 5: Commit:** `git commit -m "Field: the engine plays your open field when the switch is on (save v82)"`

### Task 7: The replay plays what happened

**Files:**

- Create: `src/ui/stage/field.ts`
- Modify: `src/ui/stage/stage.ts`. `stagePlay` dispatches to `stageField` when the play has `field` and
  `record.snap` holds its men.
- Test: `src/ui/stage/stage.test.ts` (`describe('the spatial replay')`)

**Interfaces:**

- **`stageField(args: Parameters<typeof stagePlay>[0]): StagedPlay | null`**. Null means drawn.
  - It runs `momentOf`, then `approach(…, snap.seed)`.
  - Then `fieldStart` with `skillsAt(snap, id, index)` (the latest `later` at or before `index`, else `players`),
    on `${seed}:field:${index}:hold`.
  - Then `runField` on `${seed}:field:${index}`.
- **Frames.** The approach's frames, then the field's (the duplicate at `t0` dropped). The ball is the approach's to
  `t0`, then rides the carrier.
- **Keys.**
  - the carrier, at the handoff or the catch;
  - the tackler, at the tackle;
  - each man who missed, at his miss, until 1 s after.
- **`move`** is the first miss (`kind`, `t`, `dur`, `by`). On runs, `run` comes from the approach.
- **Drawn instead:** lost fumbles (`loose`) stage drawn from the sim's outcome, and so does any play missing a
  snapshot entry. A flagged snap stages its `ran`.
- **The snap's spot** is `field.y` (the viewer's `snapY` is ignored for spatial plays).

- [ ] **Step 1: Write the failing tests:**
  - `it('replays a spatial play exactly as it was played')`: for every spatial play of 3 tapped games, the start
    rebuilt from the log deep-equals the tap's, and the staged frames from `t0` equal `runField(tap.start)`'s.
  - `it('replays the same after a save round trip, and after the switch is turned off')`
  - `it('joins the approach to the open field without a jump')`: in the step at `t0`, nobody moves more than
    `top × STEP + 0.05`.
  - `it('stages a flagged spatial snap from its ran, and a lost fumble drawn')`
  - `it('stages games played with the switch off, or before v82, as drawn')`
  - `it('stages a live game's spatial plays as they come')`: `startLiveGame` with the setting on. After each `next()`,
    `fieldNow().snap` holds the latest play's men, and it stages.
  - The suite's `never faster than his legs` stays green.
- [ ] **Step 2:** Run `npx vitest run src/ui/stage/stage.test.ts -t "spatial replay"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npx vitest run src/ui/stage/ src/ui/viewer.test.tsx` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Field: the replay plays the open field's own frames"`

### Task 8: The developer switch

**Files:**

- Create: `src/ui/dev.ts`
- Modify: `src/ui/screens/Home.tsx` (the settings row beside `ThemeSelect`)
- Test: `src/ui/ui.test.ts`

**Interfaces:**

- `devMode(): boolean`: `?dev` is in `location.search`. False without a `window`.
- `FieldSwitch({ league })`:
  - a checkbox labelled **"Spatial open field (in development)"**, with the hint "Your games' runs, catches and
    returns play out on the field.";
  - on change: `store.mutate((l) => { (l.settings ??= {}).spatialField = on; })`.

- [ ] **Step 1: Write the failing test** `it('shows the spatial switch only in developer mode, and it flips the league's setting')`.
- [ ] **Step 2:** Run `npx vitest run src/ui/ui.test.ts -t "spatial switch"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run `npx vitest run src/ui/ui.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit:** `git commit -m "Field: a developer switch for the spatial open field"`

### Task 9: Parity and the fit

**Files:**

- Create:
  - `scripts/field-moments.ts`: the harvest;
  - `scripts/parity.ts`;
  - `scripts/parity-fit.ts`.
- Modify:
  - **`package.json`:** `"parity": "tsx scripts/parity.ts"` and `"parity-fit": "tsx scripts/parity-fit.ts"`.
  - **`scripts/calibrate.ts`:** export `TARGETS`.
  - **`scripts/check.ts`:**
    - `CHECKS.parity = { cmd: ['npm', 'run', 'parity'], cores: 4, secs: 300, slow: true, summary: /\d+ number\(s\) outside target range/, detail: /[▲▼✗]/ }`;
    - a rule `/^src\/engine\/(?!.*\.test\.ts$)(field\/|match\/|attributes|size|quirks|generate)|^scripts\/(parity|parity-fit|field-moments)\.ts$/ → ['parity']`.
  - **`src/engine/field/tuning.ts`:** the fitted `KNOBS`.

**Interfaces:**

- **`harvest(seed: string, games: number)`** returns `{ rows: MomentRow[]; totals: Totals }`.
  - It plays a fresh league's first `games` games with `fieldTap` on (the switch off).
  - A `MomentRow` holds:
    - `kind` and `start`;
    - `today`: yards, touchdown, out of bounds, duration, and the tackler's group (DL, LB or DB);
    - the features: carrier skill (`(power + speed) / 2` on runs, `move` on catches, `ret` on returns), the free
      defenders' mean `tackle` and `pursuit`, `z`, and `edge`.
  - `Totals` are per team-game: carries, the stuffed carries' yards and TDs, attempts, and the yards and TDs of
    completions caught in the end zone.
- **`npm run parity`.**
  - It runs four child processes, each harvesting 75 games of league `parity:<n>`.
  - Each `start` runs on 3 seeds (`${n}:${i}:${k}`), and its spatial value is their mean.
  - Workers send rows back, and the parent judges.
  - The season section runs in the parent.
  - It prints ✓/✗ lines and ends with `N number(s) outside target range`, exiting 1 when N > 0.
- **`npm run parity-fit`.**
  - It harvests 120 games of league `parity:fit` and minimises
    `Σ ((spatial − today) / tolerance)²` over the league rows plus `Σ ((ratio − 1) / 0.25)²` over the slopes.
  - **The search, by coordinates:**
    - each knob is tried at ×0.7, ×0.85, ×1.15 and ×1.3, keeping any improvement, for 4 rounds;
    - then ±7% steps.
  - It prints `export const KNOBS = {…}`. It's deterministic.

**The rows.**

League rows compare the same moments; a tolerance is spatial against today's.

| Row                                                           | Tolerance           | NFL range                     |
| ------------------------------------------------------------- | ------------------- | ----------------------------- |
| yards after the catch (mean)                                  | ±0.4 yd             | nflverse by depth shown       |
| catches with 10+ / 20+ after the catch (share)                | ±2 / ±1 pts         | —                             |
| yards a carry, moments                                        | ±0.3 yd             | —                             |
| the league's yards a carry, rebuilt with every moment spatial | ±0.15               | 4.1–4.5 (`TARGETS.ypc`)       |
| runs of 10+ / 20+ (share of carries)                          | ±1.5 / ±0.6 pts     | 0.64 20+ a team-game shown    |
| rushing TDs a team-game, rebuilt                              | ±0.08               | 0.8–1.0 (`TARGETS.rushTd`)    |
| yards an attempt, rebuilt                                     | ±0.15               | 6.7–7.3 (`TARGETS.ypa`)       |
| passing TDs a team-game, rebuilt                              | ±0.1                | 1.3–1.6 (`TARGETS.passTd`)    |
| kick return yards; 20+ / 40+ shares                           | ±1.2 yd; ±4 / ±1.5  | —                             |
| punt return yards; 20+ / 40+ shares                           | ±0.8 yd; ±2 / ±1    | —                             |
| return TDs (share of returns)                                 | ±0.3 pts            | —                             |
| missed tackles a back's touch                                 | judged against NFL  | 0.12–0.24 (SIS 2021: 0.18)    |
| out of bounds: runs, catches                                  | ±3 pts each         | —                             |
| tackles by DL / LB / DB (share of scrimmage tackles)          | ±5 pts each         | —                             |
| seconds from the snap to the whistle: runs, catches, returns  | ±0.6 s each         | —                             |

Matchup, season and speed rows:

| Row                                                                                    | Range                                                    |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| bins: carrier skill (<10, 10–14, >14) × defense (same cuts) × z (<0, 0–1, >1, runs only) | each bin with 300+ moments: \|Δ mean\| ≤ max(0.6 yd, 15%) |
| slopes (joint least squares): runs on carrier skill, defense, z; catches on `move`, tackler's `tackle`; returns on `ret`, `edge` | spatial ÷ today in 0.6–1.5, same sign |
| spatial-only reads: +5 agility, +5 awareness (carriers; defenders), yards a touch      | moved ≤ 0.3 yd each (Decision 2)                         |
| season: your team on today's engine and on spatial, 8 salts each (wins; points for and against a game; yards a carry; YAC a catch; return average) | \|Δ mean\| ≤ 2.5 × the difference's SE |
| `runField` median ms a play                                                            | ≤ 5 (approach median shown)                              |

- [ ] **Step 1:** Write `field-moments.ts` and `parity.ts` with every row. Run `npm run parity`. Expected: it runs to
      the end, and some rows are ✗ (the starting knobs). This is the failing check.
- [ ] **Step 2:** Write `parity-fit.ts`. Run `npm run parity-fit`, paste the knobs into `tuning.ts`, and run
      `npm run parity`.
- [ ] **Step 3:** Iterate.
  - If a ✗ row comes from a rule, not a knob (a carrier who never cuts back, say), fix the rule with a unit test in
    Tasks 3–4's files, re-fit, and re-run.
  - If the knobs can't bring a row in, stop and report to the owner with the numbers. Never widen a tolerance.
- [ ] **Step 4:** Run `npx vitest run src/engine/field/` and `npm run typecheck`. Expected: PASS, with
      `npm run parity` at 0 outside range.
- [ ] **Step 5: Commit:** `git commit -m "Field: npm run parity, and the knobs fitted to it"`

### Task 10: Film and the audit see spatial plays

**Files:**

- Modify:
  - `scripts/film.ts` (a spatial section);
  - `scripts/audit.ts` (a field pass);
  - `docs/ATTRIBUTES.md` (rewritten by the full audit run).

**Interfaces:**

- **Film.** It plays `max(10, GAMES / 5)` games with `field: true`, stages every spatial play with `stagePlay`, and
  adds:
  - `check('men faster than their legs, spatial plays', n, [0, 0], 'none')`: a step faster than his
    `bodyOf(...).top + 0.05`;
  - `check('dead stops in the open, per 50 spatial plays', …, [0, 1], 'none')`: the existing `deadStops`;
  - `check('tacklers who run past the carrier, per 50 spatial plays', …, [0, 1], 'none')`: in the last second before
    the tackle, the tackler more than 1 yd beyond the carrier along his line of run;
  - `check('jumps at possession, spatial plays', n, [0, 0], 'none')`: Task 7's seam rule;
  - `check("a back's time to the line, spatial runs (s)", mean, [2.5, 3.1], '2.78 (NGS RBs 2022–24)')`.
- **The audit.**
  - The moments are harvested once from the base league.
  - For each overall pair, the bumped league's skills replace each start's skills (`fieldSkills` per id), and every
    start re-runs on 2 seeds.
  - It's judged on the paired z of yards a touch.
  - **Needs attention:**
    - the wrong way past |z| 2 (offense down, defense up);
    - or |z| < 2 on a `fieldJobs(pos)` pair.
  - The doc gains a "Spatial z" column.
  - If the audit's wall time passes 6 minutes on 4 cores, halve the moments.

- [ ] **Step 1:** Add the rows. Run `npm run film -- 50` and `npm run audit -- 3 RB`. Expected: they run, and any ✗
      or flag points at a real fault.
- [ ] **Step 2:** Fix what they flag with a unit test in the field's own files. Re-run `npm run parity` if a rule
      changed.
- [ ] **Step 3:** Run `npm run film` (200), `npm run audit` (full, which rewrites the doc) and `npm run typecheck`.
      Expected: 0 outside range, nothing under "Needs attention".
- [ ] **Step 4: Commit:** `git commit -m "Field: film and the attribute audit judge spatial plays"`

### Task 11: Ship 0.3.4

**Files:**

- Modify:
  - `package.json` (0.3.4);
  - `src/ui/changelog.ts`: "A field under your games", one paragraph: the developer switch, what it plays, and that
    it's off while it's tested;
  - **`CLAUDE.md`:**
    - Commands gains `npm run parity` and `parity-fit`, with when to run them: after changing `src/engine/field/`,
      `match/`, `attributes.ts`, `size.ts` or `quirks.ts`;
    - Architecture gains `field/` (the approach, the open field, the snapshot, the switch);
  - the spec's status line: "Built behind the switch (0.3.4); the gate decides when it turns on."

- [ ] **Step 1: Whole-branch review.** Dispatch a fresh reviewer on the most capable model, with the spec, this plan
      and `git diff origin/main...HEAD`. Fix what it confirms, each with a test.
- [ ] **Step 2: Final tests:**
  - `npx vitest run src/engine/field/ src/engine/match/ src/engine/migrate.test.ts src/ui/stage/ src/ui/viewer.test.tsx src/ui/ui.test.ts`;
  - `npm run typecheck`;
  - `npm run parity`;
  - `npm run film -- 50`;
  - `npm run sim -- 10` (unchanged from `origin/main`);
  - `npm run format`.

  Expected: all green.
- [ ] **Step 3: Commit and push.** Commit: `git commit -m "Field: ship 0.3.4"`, then push. Open a pull request only
      when the owner asks.
