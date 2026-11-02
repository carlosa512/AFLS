# All-22 Pass A (the passing game and the loose ball) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** All-22 reads like film on passing plays and fumbles: real drops and pocket movement, protection that forms a
cup, sacks that land, routes run as concepts with real breaks, and a loose ball that bounces and is recovered.

**Architecture:** Staged, not simulated (spec decision 1). The engine records one new fact (where a lost fumble came
out); everything else is the stager in `src/ui/stage/`: new pure modules (`fumble.ts`, `pocket.ts`, `routes.ts`,
`concepts.ts`) feed the existing `stagedPath` / `script` / `steer` pipeline in `stage.ts`. A new check, `npm run film`,
holds the staged plays to the NFL's tracking numbers. Three phases, one pull request each: A1 fumbles, A2 the pocket,
A3 routes.

**Tech Stack:** TypeScript, Vitest, React (viewer only), the engine's seeded `Rng`, Playwright from the machine (clips).

**Spec:** `docs/superpowers/specs/2026-11-02-all-22-passing-game-design.md` (read §6 for every number below).

## Global Constraints

- The engine's outcomes never change: no new draw on any engine stream; a game plays out identically with recording on
  and off (same score, same box score). `src/engine/` has no `Math.random`.
- Every staged play ends where the engine says: the ball at `to` (`from` on an incompletion), the engine's passer,
  target, cover man, rusher, tackler and recoverer.
- The stager is pure and seeded (`new Rng(\`${seed}:<purpose>\`)`): the same play stages the same way. It never reads
  `player.ratings`, `potential` or traits (fog of war, `docs/UI.md`); it reads roles, the log entry and `FieldRecord`.
- `League` stays plain JSON; a shape change bumps `SAVE_VERSION` (to 78 in Task 1) with a `migrate.ts` step.
- Speeds: no dot faster than `SPEED[role]` in `steer.ts` (OL 6.5 … CB, S, WR 9 yd/s), none past 10.5 yd/s, acceleration
  ≤ `ACCEL` (6 yd/s²) except a plant; a ball in the air is exempt.
- A check's range is never loosened to get green. `npm run format` before every commit.
- Each phase's PR bumps the last number of `package.json`'s version with a `src/ui/changelog.ts` entry (player's words,
  `docs/VERSIONING.md`), and attaches screen recordings of its play types.
- Comments explain why; small pure functions; prose in comments and docs follows the repo's plain style.

## Review Focus

1. **A fumble on a snap a flag wiped out** (`entry.ran`): the view stages the snap as it ran, so `ran.loose` must be
   used, not the entry's. → Task 3 test `stages a wiped snap's fumble from ran.loose`.
2. **A fumble returned for a touchdown, or lost at the offense's own goal line:** the ball ends in an end zone (`to`
   −4…−1 or 101…104) with no tackler. → Task 3 test `a fumble return touchdown ends in the end zone untackled`.
3. **Deep in his own end:** a 7-step drop from the 2-yard line or a sack near the goal line never takes the quarterback
   behind the end line or out of bounds. → Task 5 test `never drops behind the end line or out of bounds`.
4. **Older games** (no `who`, before v71; no `loose`, before v78): passes, sacks and fumbles stage without throwing and
   end at the engine's spot. → Task 3 and Task 9 tests `stages a game without actors / without loose`.
5. **Throws at the sideline:** a catch near the boundary gives routes that stay inside the field (y 0.5–52.8) and a
   concept whose other routes don't run out of bounds. → Task 8 test `every route stays inside the sidelines`.

---

# Phase A1: the loose ball (PR A1)

### Task 1: The engine writes down where a lost fumble came out

**Files:**

- Modify: `src/engine/types.ts` (`PlayLogEntry`: add `loose?: number`; `ran?: Pick<…>` gains `'loose'`)
- Modify: `src/engine/match/gameSim.ts` (`type Anim` at ~144 adds `'loose'`; `ranAnim` ~1192; the turnover branch
  ~3162; the two `this.anim!.ran = {…}` copies ~3378 and ~3439)
- Modify: `src/engine/generate.ts` (`SAVE_VERSION = 78`), `src/engine/migrate.ts` (v78 step)
- Test: `src/engine/match/actors.test.ts`, `src/engine/migrate.test.ts`

**Interfaces:**

- Produces: `PlayLogEntry.loose?: number`: field x (0 = home goal line, as `from`/`to`) where the ball came out on a
  **lost** fumble (run, catch, strip-sack); absent otherwise, and on every game before v78.

- [ ] **Step 1: Write the failing tests** in `actors.test.ts`:
      `it('writes where a lost fumble came out, in field yards')`: over ~40 simulated games with `keepPlays`, every entry
      whose text matches `/FUMBLE, recovered by/` has `loose` defined, inside −10…110, with `to` at or behind it from the
      fumbling offense's view (a return runs toward that offense's goal) and at most 40 yards from it; no other entry
      has `loose`. `it('records a fumble without changing a game')`: same seed with `keepPlays` true and false
      gives the same `homeScore`, `awayScore` and box score (extend the existing on/off test if one exists).
      In `migrate.test.ts`: bump the pinned `expect(SAVE_VERSION).toBe(78)`; `it('a v77 save loads at 78 unchanged')`.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/actors.test.ts src/engine/migrate.test.ts`. Expected: FAIL
      (`loose` undefined, version 77).
- [ ] **Step 3: Implement.** In `ranAnim`, for `result.turnover?.kind === 'fumble'` set
      `anim.loose = this.fieldX(side, result.turnover.spot)`. Replace the turnover branch's own `setAnim(…)` call with
      `this.anim = this.ranAnim(result, startYardLine, airAt, who)` (it computes the same kind, from, to and air today,
      so one place writes `loose`). Copy `loose` in both `ran` objects like `air`. v78 migration step: version only,
      comment that `loose` is optional.
- [ ] **Step 4: Run** the same tests. Expected: PASS. Then `npm run sim -- 10`. Expected: same output as on main.
- [ ] **Step 5: Commit** `All-22 data: where a lost fumble came out (save v78)`.

### Task 2: The loose ball's path, shared by both views

**Files:**

- Create: `src/ui/stage/fumble.ts`, `src/ui/stage/fumble.test.ts`
- Modify: `src/ui/stage/ballPath.ts` (`buildPath`)

**Interfaces:**

- Consumes: `PlayLogEntry.loose` (Task 1).
- Produces:
  - `interface Fumble { lost: boolean; x: number }`. `x` is where it came out: `e.loose ?? e.to` when lost,
    `e.to` when kept.
  - `fumbleIn(e: PlayLogEntry): Fumble | null`: lost reads `/FUMBLE, recovered by/`, kept reads
    `/Fumble, recovered by the offense/`, else null.
  - `bounce(e: PlayLogEntry, at: { x: number; y: number }, dir: 1 | -1): Seg[]`: 2–4 hops, 2–6 yards in all, each
    hop's `peak` ≤ 0.6, total `dur` 0.8–1.3 s. Seeded `new Rng(\`bounce:${e.quarter}:${e.clock}:${e.from}:${e.to}\`)`
    so both views bounce it the same way without a seed argument.
  - `buildPath` for a run, pass or sack with a fumble: the carry to `x` (a catch: the flight, then the run to `x`),
    then `bounce`, then (lost, `to ≠ x`) a ground leg to `to`.

- [ ] **Step 1: Write the failing tests** in `fumble.test.ts`:
  - `fumbleIn` returns `{lost: true, x: loose}`, `{lost: true, x: to}` (no `loose`), `{lost: false, x: to}` and null
    for the three texts and a plain run.
  - `bounce`: hop count 2–4, total distance 2–6, peaks ≤ 0.6, same entry gives the same segments.
  - `buildPath` of a lost run fumble with `loose` 40 and `to` 28: some segment ends at x 40, and the last ends at 28.
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/fumble.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `fumble.ts` and the `buildPath` branch (keep every other kind's path byte-identical:
      `ballPath.test.ts` must stay green).
- [ ] **Step 4: Run** `npx vitest run src/ui/stage/fumble.test.ts src/ui/stage/ballPath.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `All-22: the loose ball's path, both views`.

### Task 3: Staging the fumble, and shipping A1

**Files:**

- Modify: `src/ui/stage/scripts.ts` (`stagedPath` keeps the bounce and return legs at their pace; `script`: the
  fumbler and his tackler, the recoverer), `src/ui/stage/stage.ts` (`StagedPlay.loose`), `src/ui/stage/steer.ts`
  (converge on the ball while it's loose)
- Test: `src/ui/stage/stage.test.ts`
- Ship: `package.json` (0.2.43), `src/ui/changelog.ts`, `scripts/screens.ts` (`--film`)

**Interfaces:**

- Consumes: `fumbleIn`, `bounce` (Task 2).
- Produces: `StagedPlay.loose?: { t: number; x: number; y: number; by: number | null }`, which is when and where the
  ball came out and who recovered it. `by` is `who.take` when lost; when kept, it's the offensive player nearest the
  ball where it settles, picked deterministically. `StagedPlay.carrier` is the recoverer.
- Produces: `npm run screens -- --save <file> --out <dir> --film <kinds>`. Kinds are `fumble,sack,pressure,deep,screen,int,throwaway`.
  For each kind it finds a play of that kind in the save's kept games, opens *Watch replay* in All-22 at it and
  records it (Playwright `recordVideo`), at 1440×900 and 390×844. The output is `<dir>/<kind>-desktop.webm` and
  `<dir>/<kind>-phone.webm`.

- [ ] **Step 1: Write the failing tests** in `stage.test.ts`, over the fumbles in ~150 simulated games:
  - `the ball is loose where the engine says at the hit`: at `loose.t`, the ball is within 0.3 yd of
    `(loose.x, loose.y)` and `loose.x === fumbleIn(e).x`.
  - `the recoverer has it at the end`: on the last step he's within 1 yd of the ball.
  - `the man who fumbled goes down at the hit`: after `loose.t` he never moves more than 1.5 yd from where he lost it,
    and never past it toward his own goal.
  - `a lost fumble's return ends at to, tackled unless it scores`.
  - Review Focus 1: `stages a wiped snap's fumble from ran.loose`.
  - Review Focus 2: `a fumble return touchdown ends in the end zone untackled`.
  - Review Focus 4: `stages a game without loose`. Delete `loose` from every entry, and fumbles still stage with
    the ball ending at `to`.
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/stage.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.** In `script`, for a fumble:
  - The carrier's keyframes end at the hit spot, and the tackler meets him there.
  - The recoverer runs to where the bounce settles as it settles, then rides any return leg.
  - The tackle at the end (a lost fumble's return) uses the offense, as an interception's return does today.
  - In `steer`, while the ball is loose, the nearest two from each side converge on it, keeping `RING` off the
    recoverer until he has it.
- [ ] **Step 4: Run** `npx vitest run src/ui/stage/` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Ship A1.**
  - Bump to 0.2.43 with a changelog entry about fumbles now looking like fumbles in both views.
  - Add `--film` to `scripts/screens.ts` and record the `fumble` clips from a save with kept games.
  - Run `npm run format`, commit, push, and open PR A1 with the clips attached.
  - Read its CI and fix red until "CI result" is green.

# Phase A2: the pocket, protection and sacks (PR A2)

### Task 4: `npm run film`, the measuring stick

**Files:**

- Create: `scripts/film.ts`
- Modify: `package.json` (`"film": "tsx scripts/film.ts"`), `scripts/check.ts` (a `film` entry in `CHECKS`, and a
  `RULES` line `[/^src\/ui\/stage\/(?!.*\.test\.ts$)|^src\/engine\/(match\/|playActors\.ts)|^scripts\/film\.ts$/, ['film']]`)
- Create: `src/ui/stage/pocket.ts` with only the types `Drop` and `PocketPlan` (Task 5 adds the functions)
- Modify: `src/ui/stage/stage.ts` (`StagedPlay.pocket`, below; `null` until Task 5 fills it)

**Interfaces:**

- Produces: `Drop`, `PocketPlan` (their shapes are in Task 5's Interfaces) and `StagedPlay.pocket: PocketPlan | null`.
- Produces: `film.ts`. It stages every dropback (pass, incomplete, int, sack, scramble) from `-- <games>` games
  (default 200, seeds `film-<i>` on one league `createLeague({ seed: 'film' })`) and prints one ✓/✗ line per
  measure, with the NFL value and the range from spec §6. It ends with `N number(s) outside target range` and
  exits non-zero when N > 0, like `scripts/weather.ts`.
  - This phase's measures (§6 "The quarterback"):
    - time to throw: mean, shotgun vs under center, clean vs pressured, by air-yard bucket
    - time to pressure: the first step the named rusher is within 2 yd of the QB
    - time to sack: mean, p10, p90
    - a scramble with nothing open: when he leaves the pocket
    - the share of dropbacks leaving the pocket (QB more than 4 yd across the field from the snap, or past a tackle's
      spot)
    - play action, overall and on early downs
    - set depth by drop, and air yards by drop
  - "Reported only" rows print without ✓/✗: rushers, and the pressure, sack, scramble, screen and throwaway rates.
- `CHECKS.film`: `cmd ['npm','run','film']`, `cores 1`, `secs` measured, `summary /\d+ number\(s\) outside target range/`,
  `detail /[▲▼✗]/`.

- [ ] **Step 1: Write `film.ts`** with all of this phase's measures, and wire it into `package.json` and
      `check.ts`. Write the measures straight from `StagedPlay` (`release`, `pos`, `roles`, `kind`, `pocket`) and
      the entry (`actorsIn`).
- [ ] **Step 2: Run** `npm run film -- 50`. Expected: it runs and FAILS on today's staging. The pocket measures read
      ✗, e.g. time to sack sits at one value because `SACK_HOLD` is fixed. Paste the ✗ lines into the task notes.
      They're the baseline Tasks 5–7 must turn green.
- [ ] **Step 3: Check the plan** with `node scripts/check.ts --plan --base origin/main`. Expected: the list includes
      `film`.
- [ ] **Step 4: Commit** `npm run film: All-22 against the NFL's tracking numbers (pocket)`.

### Task 5: The quarterback's drop and pocket (`pocket.ts`)

**Files:**

- Modify: `src/ui/stage/pocket.ts` (Task 4 made its types)
- Create: `src/ui/stage/pocket.test.ts`
- Modify: `src/ui/stage/formations.ts` (export `underCenter`), `src/ui/stage/scripts.ts` (`stagedPath`'s pass,
  scramble and sack branches use the plan; `script` uses the plan for the QB, play action and bootlegs),
  `src/ui/stage/stage.ts` (fill `StagedPlay.pocket`)

**Interfaces:**

- Consumes: `underCenter(e)`, `OFF_SCHEMES[id].playAction` (`schemes.ts`), `FieldScheme.offense`, `actorsIn(e).rush`.
- Produces:
  - `type Drop = 0 | 1 | 3 | 5 | 7` (0: catch and throw from the gun).
  - `interface PocketPlan { gun: boolean; drop: Drop; hitch: boolean; setDepth: number; playAction: boolean; bootleg: boolean; pressure: 'none' | 'edge' | 'inside'; throwAt: number; leaves: number | null }`.
    `setDepth` is in yards behind the ball. `throwAt` is the release in seconds. `leaves` is when he's out of the
    pocket, or null.
  - `pocketPlan(e: PlayLogEntry, ctx: { gun: boolean; scheme?: OffSchemeId; hurry: boolean; rusherRole?: Role; holdFor: number }, rng: Rng): PocketPlan`.
  - `qbKeys(plan: PocketPlan, ctx: { snap: Pt; dir: 1 | -1; rusherAt?: (t: number) => Pt; end: Pt; kind: PlayKind }): Keyframe[]`.
- The values come from spec §2's drop table and §6:
  - Drop by air yards: quick under 5, 5–12, 10–18, 16+. Use overlapping seeded picks so the mean air yards per drop
    lands within 2.5 yd of 3.2/8.3/11.5/13.3 (under center) and 4.9/9.4/12.3/15.1 (gun).
  - Set depth: 3 steps 4–6 yd, 5 steps 7–8, 7 steps 9+. Shotgun lines up 5 deep and adds the drop's steps.
  - Play action on early downs only. A base of 0.30, leaned by the scheme's `playAction`, never in a hurry-up.
    Overall 17–27%, early downs 24–35%.
  - Bootlegs on a share of play-action throws. Together with pressured rolls and scrambles, 14–24% of dropbacks leave
    the pocket.
  - Clean pocket: a step up of 1–2 yd before the throw.
  - Pressure: climb 2–3 yd against an edge rusher, slide or roll 2–3 yd away from an interior one.
  - A scramble with nothing open leaves at 3.5–5.0 s.

- [ ] **Step 1: Write the failing tests** in `pocket.test.ts` (unit, over many seeded entries):
  - `drop rises with the throw`: the mean air yards per drop is in order, and each is within 2.5 yd of the spec value.
  - `play action only on early downs and never in a hurry-up`.
  - `under pressure he moves away from the rusher`: with `rusherAt` fixed on his left, his y moves right; with it
    straight ahead, his x climbs.
  - `a pressured scramble escapes away from the rusher before breaking out`: his first move after the drop increases
    his distance from `rusherAt`, then he reaches `end`.
  - Review Focus 3: `never drops behind the end line or out of bounds`, from snaps at the 1–3 yard lines and at the
    sideline hash.

  Then in `stage.test.ts`, over all dropbacks in ~150 games:
  - `never crosses the line before a pass`
  - `in a clean pocket (not a bootleg) he steps up before the throw`
  - `under pressure his distance from the named rusher grows until the throw`
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/pocket.test.ts src/ui/stage/stage.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement `pocket.ts`** and wire it in.
  - `stagedPath`'s hold before the throw stays sized to the route, plus the drop's own time.
  - Play action adds the fake (the QB turns to the back's mesh point, about 0.4 s). The back carries the fake into
    the line, then is steered.
- [ ] **Step 4: Run** the tests, then `npm run film -- 50`. Expected: the tests PASS. The film's drop, play-action,
      out-of-pocket and time-to-throw rows read ✓; sacks may still be ✗ until Task 7.
- [ ] **Step 5: Commit** `All-22: the quarterback's drop and pocket`.

### Task 6: Protection: the cup, the beaten blocker, the back

**Files:**

- Modify: `src/ui/stage/steer.ts` (offensive line and back goals on a dropback; the rush's path past `who.beat`)
- Test: `src/ui/stage/stage.test.ts`

**Interfaces:**

- Consumes: `SteerArgs.dropback`, `blitz`, `actorsIn(e).beat`/`.rush`, `StagedPlay.pocket.setDepth`.
- Produces: no new exports. `SteerArgs` gains `beat: number | null`, `rush: number | null` and
  `maxProtect: boolean` (a designed shot: the tight end and back block).

- [ ] **Step 1: Write the failing tests** in `stage.test.ts`:
  - `the line forms a cup by the throw`: at release, both tackles are 2–3.5 yd behind the ball and outside the guards,
    and the QB is inside the tackles' y-range (a bootleg is exempt).
  - `on a sack the sacker comes past the blocker the engine named`: the sacker's path passes within 1.5 yd of
    `who.beat`, then gets closer to the QB than that blocker.
  - `the back picks up a blitzer or checks down`: on a blitz, the back ends nearer the nearest blitzer than the QB's
    spot or runs a route.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the pass sets, as spec §2 "Protection" describes:
  - Tackles kick back at an angle, 2–3 yd deep and 1 yd out; the guards and center set 1–1.5 yd.
  - Engaged rushers push the cup in over the hold.
  - The beaten blocker: an edge rusher arcs around his outside shoulder; an interior rusher drives him back 1–2 yd.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `All-22: protection forms a cup; the beaten blocker is beaten`.

### Task 7: Sacks and strip-sacks, and shipping A2

**Files:**

- Modify: `src/ui/stage/scripts.ts` (replace `SACK_HOLD` with a seeded time to sack; the sacker and the QB go down
  together), `src/ui/stage/pocket.ts` (the QB's late escape attempt on a long sack)
- Test: `src/ui/stage/stage.test.ts`; ship: `package.json` (0.2.44), `src/ui/changelog.ts`

**Interfaces:**

- Consumes: `pocketPlan`, `fumbleIn`/`bounce` (Task 2), `StagedPlay.loose` (Task 3).
- Produces: `sackTime(e: PlayLogEntry, blitz: boolean, rng: Rng): number`, exported from `pocket.ts`. It's seeded:
  mean 3.0–3.7 s, p10 ≤ 2.4, p90 ≥ 4.5 (spec §6, NFL median 2.9), and shorter on a blitz.

- [ ] **Step 1: Write the failing tests:**
  - `sackTime`'s spread over 5,000 draws matches the ranges above.
  - In `stage.test.ts`:
    - `the sacker and the quarterback go down together at the sack spot`: at the last step both are within 1.2 yd of
      `to`, and for the last 0.3 s they move together.
    - `a strip-sack's ball comes out at the hit`: uses Task 3's loose-ball assertions on sacks.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the sack.
  - On a long sack (over 3.5 s) the QB first pumps and hitches, then makes one escape step away from the sacker.
  - The sacker wraps him, and they ride to `to` together over the last 0.3–0.5 s.
- [ ] **Step 4: Run** `npx vitest run src/ui/stage/`, then `npm run film`. Expected: tests PASS, and every pocket row
      reads ✓ with `0 number(s) outside target range`.
- [ ] **Step 5: Ship A2.**
  - Bump to 0.2.44 with a changelog entry.
  - Record the `pressure`, `sack`, `deep` and `throwaway` clips.
  - Format, commit, push, and open PR A2 with the film output and clips.
  - Fix CI until it's green.

# Phase A3: routes as concepts (PR A3)

### Task 8: Routes that fit the catch (`routes.ts`)

**Files:**

- Create: `src/ui/stage/routes.ts`, `src/ui/stage/routes.test.ts`

**Interfaces:**

- Produces:
  - `type RouteId = 'screen' | 'swing' | 'flat' | 'quickOut' | 'drag' | 'hitch' | 'slant' | 'curl' | 'out' | 'stick' | 'cross' | 'comeback' | 'dig' | 'wheel' | 'corner' | 'post' | 'go' | 'seam'`.
  - `type Spot = 'X' | 'Z' | 'SLOT' | 'TE' | 'RB'` (where he lined up, from the cast's receiver order).
  - `routeFor(c: { air: number; across: number; spot: Spot }, rng: Rng): RouteId`.
    `air` is yards past the line; `across` is the catch's distance toward his inside, in yards. Bands follow spec §3's
    table, leaning on the route whose NFL mean is nearest: screen −2.8, flat −0.5, slant 6.1, curl 7.4, out 7.3,
    cross 6.9, dig 10.6, wheel 13.8, post 21.0, corner 21.3, go 23.4.
  - `routeKeys(route: RouteId, from: Pt, to: Pt, arrive: number, dir: 1 | -1, top: number): Keyframe[]`: a stem
    (leaning to set up the break), a plant (50–70% of stem speed for 0.15–0.25 s), the break at the route's angle
    (out/in 90°, slant 45° off the line, post/corner 45° upfield, curl/comeback rounding back), and arrival at `to` at
    `arrive`. If the route can't make `arrive` at `top`, the stem is shortened; never faster than `top`.

- [ ] **Step 1: Write the failing tests:**
  - `a route's family fits the catch`: a 25-yard catch is never a curl, a catch behind the line is a screen, swing or
    flat, and a slant only goes inside.
  - `the mean air yards per route over many fitted catches is within 3 yd of the NFL's` (5 for post, corner and go).
  - `routeKeys reaches the catch on time, never past top speed, slower through the plant than in the stem`.
  - Review Focus 5: `every route stays inside the sidelines`, for catches at y 1 and y 52.
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `routes.ts`.
- [ ] **Step 4: Run** it. Expected: PASS.
- [ ] **Step 5: Commit** `All-22: routes that fit the catch`.

### Task 9: Concepts, and the target and decoys running them

**Files:**

- Create: `src/ui/stage/concepts.ts`, `src/ui/stage/concepts.test.ts`
- Modify: `src/ui/stage/scripts.ts` (the target's keyframes come from `routeKeys`), `src/ui/stage/steer.ts` (replace
  `decoy()`: the other receivers and the back follow their concept routes' waypoints), `src/ui/stage/stage.ts`
  (`StagedPlay.concept`)

**Interfaces:**

- Consumes: `routeFor`, `routeKeys`, `RouteId`, `Spot` (Task 8); `FieldScheme.offense`.
- Produces:
  - `type ConceptId = 'smash' | 'flood' | 'mesh' | 'fourVerts' | 'curlFlat' | 'slantFlat' | 'stick' | 'dagger' | 'screen' | 'shot'`.
  - `interface Concept { id: ConceptId; routes: Partial<Record<Spot, RouteId>> }`.
  - `conceptFor(target: { spot: Spot; route: RouteId }, scheme: OffSchemeId | undefined, designedShot: boolean, rng: Rng): Concept`.
    The result always contains the target's route at his spot. It's leaned by spec §3's "Leaned on by" column, and
    `shot` is picked only for a designed shot.
  - `StagedPlay.concept: ConceptId | null`.

- [ ] **Step 1: Write the failing tests:**
  - `the concept always contains the target's route`.
  - `schemes lean their way`: airRaid picks mesh and fourVerts more than westCoast does; westCoast picks slantFlat
    and curlFlat more.
  - In `stage.test.ts`:
    - `the target's route ends at the catch`
    - `routes in one concept don't finish within two yards of each other`
    - Review Focus 4: `stages a game without actors`. Strip `who`, and passes still stage and end at the engine's
      spot.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement** the concept book and wire it in. The back's route: block on a blitz, or the concept's
      `RB` route.
- [ ] **Step 4: Run** `npx vitest run src/ui/stage/`. Expected: PASS.
- [ ] **Step 5: Commit** `All-22: routes run as concepts`.

### Task 10: Coverage reacts, separation, and film's route measures

**Files:**

- Modify: `src/ui/stage/steer.ts` (man defenders lag a beat at each break, then close), `src/ui/stage/scripts.ts`
  (the cover man's spot at the catch), `src/ui/stage/formations.ts` (corners' cushion), `scripts/film.ts` (add §6
  "Receivers and coverage" and the speed rows)
- Test: `src/ui/stage/stage.test.ts`

**Interfaces:**

- Consumes: `StagedPlay.concept`, the route keyframes (Task 9).
- Produces: nothing new.
- The values:
  - The cover man's distance at the catch: completion about 3.5 yd, incompletion about 2, interception under 1.
    That replaces today's `trail` of 1.5 / 0.7.
  - Corners' mean cushion at the snap: 5–7 yd.
  - Film adds separation at the target (mean 2.6–3.6), cushion, air yards and time to throw by route, and the top
    speed by role (nobody past `SPEED[role]`, none past 10.5).

- [ ] **Step 1: Write the failing tests:**
  - `separation at the target follows the play` (means over ~150 games, as above).
  - `a man defender is a beat late out of his man's break`: his speed turns 0.1–0.3 s after the receiver's.
  - `no dot faster than his role's top speed; acceleration within ACCEL outside a plant`.
  - Extend `film.ts` with the new rows. `npm run film -- 50` should show them ✗ before the change.
- [ ] **Step 2: Run** the tests. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/ui/stage/` and `npm run film`. Expected: PASS, with
      `0 number(s) outside target range`.
- [ ] **Step 5: Commit** `All-22: coverage reacts to the routes; separation as the NFL's`.

### Task 11: Screens and throwaways, and shipping A3

**Files:**

- Modify: `src/ui/stage/steer.ts` (on a screen, the line sets for 0.6–0.9 s, then two or three linemen release
  toward the screen's side; on a bubble, the other receivers stalk the nearest defensive backs),
  `src/ui/stage/scripts.ts` (a throwaway: an air-less incompletion with `/throws it away/` sails past the nearest
  receiver and out of bounds, from a rolling QB)
- Test: `src/ui/stage/stage.test.ts`; ship: `package.json` (0.2.45), `src/ui/changelog.ts`

**Interfaces:**

- Consumes: `StagedPlay.concept` (`screen`), `PocketPlan.pressure`.

- [ ] **Step 1: Write the failing tests:**
  - `on a screen, linemen release downfield toward the catch`: at least two linemen are past the line by the catch,
    on its side of the ball.
  - `a throwaway lands out of bounds past a receiver`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/ui/stage/`, `npm run typecheck` and `npm run film`. Expected: all green.
- [ ] **Step 5: Ship A3.**
  - Bump to 0.2.45 with a changelog entry.
  - Record the `screen`, `int` and `deep` clips.
  - Format, commit, push, and open PR A3 with the film output and clips.
  - Fix CI until it's green.
  - Update the spec's header to say Pass A shipped, and point to Pass B.
