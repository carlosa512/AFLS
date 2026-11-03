# All-22 Pass B: the run game and the open field — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Runs, catches-and-runs and returns in All-22 read like film: blocking by the call, a back who presses and
cuts, and each broken tackle the engine decided shown as one move against the man who missed.

**Architecture:**
- **The engine** writes down the run facts it already rolls, the after-catch breakaway, and the film-visible habits
  (quirks) it found in play (`PlayLogEntry.open`, save v81). Nothing new is drawn.
- **A small `habits.ts`** turns those habits into staging knobs that the blocking, the carrier and the scripts read.
- **The stager** turns them into ball-carrier path segments (moves are segments of the ball path, tagged on `Seg`),
  scripts the man who missed, the deep safety and the pile, and gives steer a blocking plan by the call (a new
  `runBlocks.ts`).
- **Everything else** keeps steering.

**Tech Stack:** TypeScript, Vitest, `tsx` scripts (`npm run film`, `npm run screens`).

**Spec:** `docs/superpowers/specs/2026-11-02-all-22-open-field-design.md`

## Global Constraints

- The engine's outcomes never change. The same game must play out identically with recording on and off (score,
  `playerStats`).
- All randomness is seeded and nothing touches engine streams. The same play stages the same way every time.
- Every play still ends where the engine says (`to`), with the engine's carrier, tackler and recoverer.
- Nobody is faster than his legs: the existing test (`SPEED[role] + 0.6 + 0.5`, plus the tackler's closing sprint
  capped at `SPRINT = 10.5`) stays green.
- Paths only: no dot-size change or marker for a man on the ground (the kneel's shrink stays the only one).
- A man who misses carries on past and goes down (0.3.1's `FALL`). No freezing.
- Rings show at the moment (`REVEAL_LEAD = 0`).
- Save: `SAVE_VERSION` 81, with a no-op `migrate.ts` step. `League` stays plain JSON.
- Version 0.3.2 (a patch: the replay viewer's MVP item is already Done). Add a changelog entry in a player's words.
- Run `npm run format` before each commit. Never run `npm run check` (CI does). Per task: `npm run typecheck` plus
  the touched tests; `npm run film -- 50` from Task 4 on.

## Review Focus

1. **Old saves and flagged snaps:**
   - a run with no `open` (games before v81) stages blocking and the press, with no moves;
   - a run a flag wiped out stages from `ran.open`.

   Tests in Task 1 (`ran` carries it) and Task 4 (no `open`, no move).
2. **The man who missed isn't on the field** (lineup data missing him, an id the cast doesn't hold): the move is
   staged with no defender script and nothing throws. Test in Task 4.
3. **A fumble on a run that also broke a tackle:** the move comes before the ball comes out (`loose.t`), and both
   stage. Test in Task 4.
4. **A move near a sideline or the goal line:** every move point stays inside the field (y 1…FIELD_W − 1, x −9…109).
   Test in Task 4 (geometry).
5. **A habit on a man who isn't in the play's cast** (a noted id the formation doesn't hold): it's ignored, nothing
   throws. Test in Task 3 (`habitsOf` over a cast without him).
6. **A QB designed run or a receiver's jet sweep with `open`:** the move is staged against the named man and the jet
   keeps its speed through the mesh (no dip under 5 yd/s between the snap and the handoff). Test in Task 4.

---

### Task 1: The engine records what it decided (`open`, save v81)

**Files:**

- Modify: `src/engine/types.ts`:
  - add `OpenField` beside `PlayLogEntry`, and `open?: OpenField` on `PlayLogEntry`;
  - add `'open'` to the `ran` Pick.
- Modify: `src/engine/match/gameSim.ts`:
  - `PlayResult.open?: OpenField`;
  - `Anim` gains `'open'`;
  - `runPlay` (around the `bounce`, `pBreak`, breakaway and `finishesForward` rolls);
  - the completion branch of `passPlay` (around `yac += rng.exponential(22)`);
  - `has()` notes `[p.id, q]` into a per-play list when it returns true for a quirk in `FILM_HABITS`; the list is
    cleared as each play starts, and the run and catch branches attach it as `open.habits`;
  - `ranAnim` copies `result.open`;
  - both `ran = {…}` builders copy it like `loose`.
- Modify: `src/engine/generate.ts`: `SAVE_VERSION = 81`.
- Modify: `src/engine/migrate.ts`: `if (league.version < 81) league.version = 81;`, with a comment in the v78 style.
- Modify: `src/engine/quirks.ts`: `export const FILM_HABITS: ReadonlySet<QuirkId>` (the 18 quirks of the spec's §3a
  table).
- Test: `src/engine/match/actors.test.ts`

**Interfaces:**

- Produces:
  - `interface OpenField { bounce?: 1; broke?: { by: number; how: 'size' | 'move' }; gone?: 1; forward?: 1; habits?: [number, QuirkId][] }`
  - `FILM_HABITS` (above): `patientPresser`, `dwellsInHole`, `jumpCutter`, `bouncesExternal`, `highKnee`,
    `contactAverse`, `yacSlasher`, `runsEastWest`, `secondLevel`, `pancakePreacher`, `pullsSoft`, `armTackler`,
    `gapShooter`, `scraper`, `thumper`, `stuckOnBlocks`, `slowFlow`, `misreadsKeys`.
  - `PlayLogEntry.open?: OpenField`, written only when at least one field is set.
- On a run:
  - `broke.by` is the best-tackling linebacker `lb`;
  - `how` is `'size'` when `contact > 0`, else `'move'`;
  - `gone` is the inner breakaway roll; `forward` is the `finishesForward` yard; `bounce` is the `bounce` roll.
- On a completion:
  - `broke` is set when the `exponential(22)` roll hits;
  - `by` is `tackler`;
  - `how` is `'size'` when `sizeEdge(receiver, 'contact', tackler) > 0`, else `'move'`.
- Touchdowns and fumbles keep their `open` too (the rolls happened).

- [ ] **Step 1: Write the failing tests** in `actors.test.ts` (`describe('who each play was about')`):
  - `it('writes the run facts the engine rolled, and only on runs and catches')`:
    - over the 20 games, at least 40 runs carry `open.broke`;
    - every `open.broke.by` is a defender on the field that play (in `unitsAt(record, i)`'s defense ids);
    - `how` is `'size'` or `'move'`;
    - no `open` on kicks, sacks, kneels or incompletions;
    - some catch carries `open.broke`.
  - `it('notes the film habits in play, once each, and only habits the man has that day')`:
    - every `[id, q]` in `open.habits` has `q` in `FILM_HABITS` and `activeQuirks(league.players[id])` includes `q`;
    - no pair repeats within a play;
    - over the 20 games at least one run notes a back's habit and one an `LB` habit.
  - `it('carries the run facts on a snap a flag wiped out')`:
    - for every entry with `ran?.kind === 'run'` and `ran.open`, `ran.open` deep-equals what the same rolls wrote
      (assert it has `broke` or `bounce` or `gone` or `forward`, and is never `{}`).
  - The existing `'plays the same game with the log kept or not'` stays as the engine-unchanged guard.
- [ ] **Step 2:** Run `npx vitest run src/engine/match/actors.test.ts`. Expected: the two new tests FAIL (`open`
      undefined).
- [ ] **Step 3: Implement.** Set `result.open` only where the rolls happen, with no reordering of `rng` calls. Build
      it as a local `const open: OpenField = {}` and attach it with `...(Object.keys(open).length ? { open } : {})`.
- [ ] **Step 4:** Run `npx vitest run src/engine/match/actors.test.ts src/engine/migrate.test.ts`, then
      `npm run typecheck`. Expected: PASS.
- [ ] **Step 5:** Run `npm run sim -- 10`. Expected: every row in range, and the same numbers as on `origin/main`
      (rolls unchanged).
- [ ] **Step 6: Commit:** `git commit -m "All-22: the engine writes down the run facts it rolls (save v81)"`

### Task 2: Blocking by the call (`runBlocks.ts`, steer)

**Files:**

- Create: `src/ui/stage/runBlocks.ts`, `src/ui/stage/habits.ts`
- Modify:
  - `src/ui/stage/steer.ts` (the `if (a.dropback || a.run)` assignment block uses the plan on a run);
  - `src/ui/stage/stage.ts` (build the plan, pass it as `runBlocks` in steer's args, and script the puller);
  - `src/ui/stage/scripts.ts` (the puller's keys).
- Test: `src/ui/stage/runBlocks.test.ts`, `src/ui/stage/stage.test.ts`

**Interfaces:**

- Produces (`runBlocks.ts`):
  - `type RunCall = 'outsideZone' | 'insideZone' | 'power'`
  - `function runCall(e: PlayLogEntry, scheme: OffSchemeId | undefined, rng: Rng): { call: RunCall; side: 1 | -1 }`
    - Text `left end` / `right end` → `outsideZone`. With `open.bounce` → `insideZone`, its hole still inside.
    - `right tackle` → `power`.
    - `up the middle` / `left guard` → `insideZone`, or `power` with 0.6 for `scheme === 'power'` and 0.25
      otherwise.
    - `wideZone` takes `insideZone` over `power` always.
    - `side` from `sign(lane)`; at 0, seeded.
  - `function holeAt(call: RunCall, side: 1 | -1, ball: Pt, dir: 1 | -1, bounce: boolean): Pt` gives the point at the
    line where the back presses: across `side × {insideZone: 1.5, power: 4, outsideZone: 7}` yards; a bounce ends at
    the outsideZone point.
  - `interface RunBlocking { call: RunCall; side: 1 | -1; hole: Pt; steps: Map<number, Pt>; on: Map<number, number>; climb: Map<number, number>; puller: { id: number; path: Pt[] } | null; free: number[] }`
    - `steps`: each lineman's first step target (zone: 1.2 yd toward `side`, 0.4 yd upfield; power: a down block's
      0.8 yd inside).
    - `on`: blocker → defender.
    - `climb`: double-teamer → linebacker, from 1.0 s after the handoff.
    - `puller`: power only. The backside guard. The path runs behind the line at depth 1.5 to the hole, then 3 yd
      through it.
    - `free`: unblocked defenders who could reach the hole first, none of them picked up.
    - Outside zone: the play-side TE (or slot) is put `on` the play-side EDGE, sealing him inside. Power: on 0.4 of
      calls (seeded), the lead back or a TE is put `on` the play-side EDGE as the kick-out, and the puller leads up
      through the hole to the nearest linebacker instead.
  - `function planRunBlocks(args: { call: RunCall; side: 1 | -1; hole: Pt; start: ReadonlyMap<number, Pt>; cast: Cast; dir: 1 | -1; exclude: ReadonlySet<number>; backAt: (t: number) => Pt; handoff: number }): RunBlocking`
    - `exclude` is the engine's tackler and `open.broke.by`: never assigned a blocker.
    - **Free-man rule:** an unblocked defender (not excluded) within reach of the hole is given the nearest spare
      offensive man (the puller, a climbing lineman, a lead back, a TE or WR) that can reach him before the back
      reaches the hole at its own `SPEED`. If none can, he's listed in `free`.
- Produces (`habits.ts`):
  - `function habitsOf(e: PlayLogEntry, onField: ReadonlySet<number>): Map<number, Set<QuirkId>>`, read from
    `e.open?.habits` (or `e.ran?.open?.habits`). Ids not on the field are dropped. Empty for older games.
  - `const has = (h: ReadonlyMap<number, ReadonlySet<QuirkId>>, id: number | undefined, q: QuirkId): boolean`
- Habits:
  - `secondLevel`: his `climb` starts 0.6 s after the handoff, not 1.0;
  - `pancakePreacher`: his `steps` target is 1.5 yd further upfield (he drives his man);
  - `pullsSoft`: the puller's path stops 1 yd short of the hole and he's put `on` the first defender there;
  - `gapShooter` (LB): never put in `on` for the first 0.6 s; his early goal is 1.5 yd into the backfield in his gap;
  - `scraper` (LB): his early goal moves laterally toward `side` 3 yd before he comes downhill;
  - `stuckOnBlocks` (LB): once within 1.6 yd of a blocker he stays engaged until the whistle;
  - `slowFlow` (LB): holds his spot until 0.4 s after the handoff;
  - `misreadsKeys` (LB): his first 0.4 s goes 1 yd away from `side`.
- Steer consumes:
  - `SteerArgs.runBlocks?: RunBlocking` and `SteerArgs.habits?: ReadonlyMap<number, ReadonlySet<QuirkId>>`;
  - on a run, `on` and `climb` replace the nearest-man picks;
  - `steps` are the goal for t < 0.5 s;
  - a man in `free` pursues as today (an angle that arrives late), never standing still.

- [ ] **Step 1: Write the failing tests** (`runBlocks.test.ts`, on hand-built casts from `lineUp` over the `stage`
      league's runs):
  - `it('reads the call off the run: ends are outside zone, tackles power, a bounce stays an inside call')`
  - `it('steps the whole line toward the play side on a zone run')`: every OL step has `(step.y − start.y) × side × dir > 0.8`.
  - `it('pulls the backside guard behind the line on power')`: every puller path point before the hole has
    `(ball.x − p.x) × dir ≥ 1`.
  - `it('never blocks the tackler or the man who misses')`: no `on` value is in `exclude`.
  - `it('gives every free man a blocker who can get there first, or lists him free')`
  - `it('shows each line and linebacker habit')`: for each of `secondLevel`, `pancakePreacher`, `pullsSoft`,
    `gapShooter`, `scraper`, `stuckOnBlocks`, `slowFlow`, `misreadsKeys`, the same run staged with the habit on the
    man and without moves his path the way the table above says (e.g. `slowFlow`: under 0.5 yd moved by 0.4 s after
    the handoff with it, over 1 yd without).
- [ ] **Step 2: Write the failing stage tests** (`stage.test.ts`, `describe('the run game')`):
  - `it('leaves no unblocked defender standing within 5 yards of the hole as the back goes through')`: within ±0.5 s
    of the back crossing the line, every defender within 5 yd of `hole` is either within 1.6 yd of a blocker, moving
    faster than 2 yd/s, or the tackler / `broke.by`.
  - `it('runs a pulling guard behind the line, never through it')`
- [ ] **Step 3:** Run `npx vitest run src/ui/stage/runBlocks.test.ts src/ui/stage/stage.test.ts -t "run game"`.
      Expected: FAIL.
- [ ] **Step 4: Implement** `runBlocks.ts` and wire it into `stage.ts` and steer. The puller is scripted in
      `script()` from `puller.path` (keys at `SPEED.OL`, freed at the hole), and its `free` time is set like other
      freed men.
- [ ] **Step 5:** Run the stage suite (`npx vitest run src/ui/stage/ src/ui/viewer.test.tsx`) and
      `npm run typecheck`. Expected: all PASS, including "never faster than his legs".
- [ ] **Step 6: Commit:** `git commit -m "All-22: blocking by the call, a pulling guard, and the free man picked up"`

### Task 3: Moves as path segments (`carrier.ts`)

**Files:**

- Create: `src/ui/stage/carrier.ts`
- Modify: `src/ui/stage/ballPath.ts` (`Seg.move?: MoveKind`, documented: "a ball carrier's move; the stager scripts
  the man who missed against it")
- Test: `src/ui/stage/carrier.test.ts`

**Interfaces:**

- Produces:
  - `type MoveKind = 'juke' | 'jumpCut' | 'spin' | 'runThrough' | 'stiffArm'`
  - `function pickMove(how: 'size' | 'move', carrier: ReadonlySet<QuirkId>, missed: ReadonlySet<QuirkId>, rng: Rng): MoveKind`.
    The habits come first:
    - a `contactAverse` back never gets `runThrough` or `stiffArm`: a `size` break becomes a `juke`;
    - a `move` break by a `jumpCutter` is a `jumpCut`;
    - a `move` break by a `highKnee` back, or against an `armTackler`, is a `runThrough`.

    Otherwise: size → runThrough 0.5 / stiffArm 0.5; move → juke 0.5, jumpCut 0.2, spin 0.3.
  - `function moveSegs(kind: MoveKind, at: Pt, heading: Pt, pace: number, side: 1 | -1): Seg[]`, the carrier's path
    through the move, starting and ending on his line of run, every segment tagged `move: kind`. Each move's shape:

    | Move          | Shape                                                         | Lasts  | His pace through it |
    | ------------- | ------------------------------------------------------------- | ------ | ------------------- |
    | juke          | 1.5 yd to `side`                                              | 0.25 s | at least 0.6 × pace |
    | jumpCut       | 2 yd to `side`, 0.5 yd on                                     | 0.35 s | at most 4 yd/s      |
    | spin          | a half loop of radius 0.6 yd                                  | 0.45 s | dips to about 3.5   |
    | runThrough    | straight through                                              | 0.3 s  | 0.6 × pace          |
    | stiffArm      | straight                                                      | 0.4 s  | 0.8 × pace          |

  - `function clampToField(p: Pt): Pt`: x −9…109, y 1…FIELD_W − 1.

- [ ] **Step 1: Write the failing tests:**
  - `it('ends every move on the carrier's line of run, inside the field, never quicker than his pace')`: for every
    kind × 8 headings × points near both sidelines and both goal lines, the last point lies within 0.3 yd of the
    line, every point is inside the field, and no segment is faster than `pace + 0.01`.
  - `it('slows the carrier through a run-through and a spin, not through a juke')`
  - `it('picks size moves for size and footwork for the rest, the same way every time')`
  - `it('lets the habits pick: a jump-cutter jump-cuts, an arm tackle is run through, a contact-averse back never
    runs through')`
- [ ] **Step 2:** Run `npx vitest run src/ui/stage/carrier.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `carrier.ts`. It's pure, with no stage imports beyond `ballPath` and `formations` types.
- [ ] **Step 4:** Run the same command. Expected: PASS. Then `npm run typecheck`.
- [ ] **Step 5: Commit:** `git commit -m "All-22: ball carriers' moves as path segments"`

### Task 4: The back's run: press, cut, the broken tackle, the breakaway, the finish

**Files:**

- Modify: `src/ui/stage/scripts.ts`:
  - `stagedPath` takes an options object: `stagedPath(e, homeId, snapY, opts?: { receiverAt?: Pt; pocket?: readonly Keyframe[]; top?: number; chaser?: number; seed?: string; carrier?: ReadonlySet<QuirkId>; missed?: ReadonlySet<QuirkId>; tackler?: ReadonlySet<QuirkId> })`.
    Update its callers in `stage.ts` and the four in `stage.test.ts`.
  - `stageCarried`'s run branch: the press to the hole, the cut, the move inserted, and `forward`.
  - `script()`: the man who missed, the deep safety on `gone`, the tackler on `forward`.
- Modify: `src/ui/stage/stage.ts`: pass `seed` and the hole (from Task 2's `holeAt`) into `stagedPath`.
- Modify: `scripts/film.ts`: a run section.
- Test: `src/ui/stage/stage.test.ts`

**Interfaces:**

- Consumes: `moveSegs`, `pickMove`, `clampToField` (Task 3); `holeAt`, `runCall` (Task 2); `intoTheHit`, `FALL`'s
  carry-on-past behaviour (0.3.1).
- Run timing: the back crosses the line (`(x − ballX) × dir > 0`) at `TLOS = 2.78 s` with a seeded spread of
  ±0.25 s.
  - The mesh stays `MESH`.
  - The press leg runs from the mesh to the hole and lasts `TLOS − MESH`, adjusted so its pace is never above the
    carrier's `top`.
  - A jet sweep's carrier keeps at least 5 yd/s from the snap through the handoff.
- **The move:**
  - With `open.broke`, the carry leg is split at a point 4–6 yd past the line (seeded) for a run, or
    `min(4, 0.3 × yac)` past the catch.
  - `moveSegs(pickMove(how, opts.carrier, opts.missed, rng), …)` is inserted there, with `side` chosen away from
    `broke.by`'s side.
  - The defender `broke.by`:
    - is scripted with `intoTheHit` to a point 1 yd off the move's start on his side, arriving at the move's start
      time;
    - on `move`: lunges on 2 yd along his approach, decelerating over 0.5 s;
    - on `size`: is driven back 1.5 yd along the carrier's heading over 0.4 s, then stops;
    - is freed 0.6 s after the move (steer chases).

    If `broke.by` isn't in `start`, the move is staged without him.
- **`gone`:** the deepest safety, unless he's the tackler or `broke.by`, is scripted to a point 1.5 yd behind the
  carrier's path at the moment the carrier passes his depth, then freed.
- **`forward`:** the last carry leg ends with a 1-yard lunge lasting 0.35 s. The tackler's hit lands at the lunge's
  start (`intoTheHit` to that point and time), then rides with him to `to`.
- **The back's and the tackler's habits** (`opts.carrier`, `opts.tackler`):
  - `patientPresser`: `TLOS` + 0.3 s;
  - `dwellsInHole`: a 0.3 s beat at no more than 3 yd/s at the hole, before the cut;
  - `jumpCutter`: the cut at the hole is `moveSegs('jumpCut', …)` (untagged: it isn't a broken tackle);
  - `bouncesExternal`: a bounce's cut goes 2 yd wider;
  - `contactAverse` (the back) or `thumper` (the tackler): no `forward` lunge even when `open.forward` is set, and with
    `contactAverse` the hit comes 1 yd short of `to`, the pair sliding into it.

- [ ] **Step 1: Write the failing tests** (`stage.test.ts`, `describe('the run game')`):
  - `it('crosses the line between 2.3 and 3.5 s on every handed-off run')`
  - `it('stages one move per broken tackle, against the man who missed, and none without one')`: count segments
    with `move` in `stagedPath` against `open.broke`; at the move's start time `broke.by` is within 1.5 yd of the
    carrier.
  - `it('drives the man back on a size break and sends him past on a move')`
  - `it('stages a run with no open (an old game) without a move')`: strip `open` and assert there's no `move` seg.
  - `it('stages a broken tackle that ends in a fumble: the move first, then the ball out')`
  - `it('keeps a jet sweep at speed through the handoff')`
  - `it('shows each back and tackler habit')`: the same run staged with each of `patientPresser`, `dwellsInHole`,
    `jumpCutter`, `bouncesExternal`, `contactAverse`, `thumper` in the opts and without them moves the beat the way
    the table above says (e.g. `patientPresser` crosses the line 0.2–0.4 s later).
  - `it('keeps the safety a step behind on a breakaway')`: on `gone` runs, the chosen safety never gets within 1 yd
    of the carrier before the whistle, unless he's the tackler.
- [ ] **Step 2:** Run `npx vitest run src/ui/stage/stage.test.ts -t "run game"`. Expected: FAIL.
- [ ] **Step 3: Implement** the options-object refactor first (the existing tests stay green), then the run beats,
      then the scripts.
- [ ] **Step 4: Add the film rows.** In `scripts/film.ts`, stage the handed-off runs of the same games, and add:
  - `check('a back's time to the line (s)', mean, [2.5, 3.1], '2.78 (NGS RBs 2022–24)')`
  - `check('yards before first contact a run', mean, [1.3, 2.6], 'about half the gain')`. First contact is the first
    step any defender is within 1.2 yd of the carrier.
  - reported lines: the move mix (juke, jumpCut, spin, runThrough, stiffArm, as shares) and broken tackles per
    handed-off run and per catch (NFL reference: about 0.18 missed tackles per RB touch, SIS 2021; the engine sets
    it, so it's not judged).
  - `check('dead stops in the open, per 50 plays', n, [0, 1], 'none')`. A dead stop is a defender going from
    5+ yd/s to under 1.2 within 0.3 s, with nobody within 2.2 yd, away from the ball, before the whistle.
- [ ] **Step 5:** Run the stage suite, `npm run typecheck` and `npm run film -- 50`. Expected: all PASS, and 0 numbers
      outside range.
- [ ] **Step 6: Commit:** `git commit -m "All-22: the back presses, cuts and makes the engine's man miss"`

### Task 5: After the catch, and returns

**Files:**

- Modify: `src/ui/stage/scripts.ts`:
  - the catch branch of `stageCarried` (the turn upfield and the move, as Task 4);
  - the kickoff and punt return legs (the lane and the long-return miss);
  - `script()` (the pile, and the returner's missed man).
- Modify: `src/ui/stage/steer.ts`: the return team's wall blocks cover men nearest the return lane.
- Test: `src/ui/stage/stage.test.ts` (`describe('special teams')`, `describe('the run game')`)

**Interfaces:**

- **The catch:** a hitch or curl turns back to the ball first. Upfield within 0.4 s after the catch.
- **The receiver's habits** (`opts.carrier` on a catch):
  - `yacSlasher`: upfield within 0.2 s;
  - `runsEastWest`: his first 0.6 s after the catch goes sideways (at least 2 yd across, under 1 yd on), then upfield.
  - The tackler's `thumper` (as Task 4).
- **The pile:** on a tackled return (not a touchdown or a fair catch), the two cover men nearest the end spot at
  `catchAt` (excluding the tackler) are scripted with `intoTheHit` to points 1.5 yd from the returner's end, at
  ±60° from the tackler's side, arriving at the whistle. A kickoff never leaves before the ball's down (`floor`).
- **The long return** (≥ 30 yd, or a touchdown): with a seeded chance of 1/3 (`new Rng(`${seed}:return`)`), a
  `juke` or `jumpCut` is inserted at 40% of the return. The cover man nearest that point at that time is scripted
  to miss, as in Task 4. Never more than one.
- **The wall:** blockers on the return team are assigned to the cover men within 6 yd of the return's lane, nearest
  first.
- **A return touchdown:** the kicker (or, if he's farther, the last cover man between the returner and the goal) is
  scripted to a point 1.5 yd behind the returner's path as he passes, then freed: the last angle, a step short.

- [ ] **Step 1: Write the failing tests:**
  - `it('ends most tackled returns in a pile: two or more cover men within 2 yards at the whistle')`: share ≥ 0.7.
  - `it('never stages a miss on a return under 30 yards, and at most one on a long one')`
  - `it('keeps the last man a step behind on a return touchdown')`: he never gets within 1 yd of the returner.
  - `it('turns a catch upfield and stages its broken tackle as a move')`
  - `it('shows the receiver's habits: a slasher turns at once, an east-west runner goes sideways first')`
- [ ] **Step 2:** Run `npx vitest run src/ui/stage/stage.test.ts -t "special teams|run game"`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4:** Run the stage suite, `npm run typecheck` and `npm run film -- 50`. Expected: PASS, and 0 outside
      range (the kickoff line-up test stays green).
- [ ] **Step 5: Commit:** `git commit -m "All-22: moves after the catch, returns into a pile, a long one's miss"`

### Task 6: Ship 0.3.2

**Files:**

- Modify: `scripts/screens.ts` (`--film` gains `move`, a run with `open.broke`, and `return`, a kickoff returned
  30+ yards).
- Modify: `package.json` (0.3.2), `src/ui/changelog.ts` (a "Runs that read like film" entry).

- [ ] **Step 1:** Record clips: `npm run screens -- --save <save> --out <scratchpad> --film move,long,return`. Check
      the frames: the cut at the hole, the move against the named man, him carrying on past, the pile.
- [ ] **Step 2:** Run the stage, viewer and UI tests (`npx vitest run src/ui/stage/ src/ui/viewer.test.tsx src/ui/ui.test.ts`),
      `npm run typecheck`, `npm run film -- 50` and `npm run format`.
- [ ] **Step 3: Commit, push and open the PR** (template: What changed / Why / `npm run check`, with the attribution
      lines). Send the owner the clips.
