# A League That Ages Like the NFL's: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 20-season leagues whose starters' ages, by position, and whose starters' next seasons match the NFL's, with
young players reaching their level sooner, real swings in the prime, cliffs, retirement that follows the body, and a
starting league that is already settled.

**Architecture:** Three pull requests on `claude/lucid-wright-fu4ls5` (or a branch per PR off it, merged in order).
PR 1 measures (the NFL research, a pure measuring module, the careers check reading 20-season leagues, new lines shown
as known issues). PR 2 changes development, cliffs, retirement and the AI's expectation together, tuned until the new
lines are judged and green. PR 3 builds the founding league to look like the settled one.

**Tech Stack:** TypeScript (engine, scripts via `tsx`), Vitest, Python 3 standard library (research script).

**Spec:** `docs/superpowers/specs/2026-11-14-league-age-design.md` (approved 2026-11-14). Read it first: the tables,
goals and anti-goals there are the acceptance criteria.

## Global Constraints

- All randomness through the seeded `Rng`; a player's year stays on `${seed}:dev:${season}:${id}`; no `Math.random`.
- New draws in a player's year go **after** every existing draw in `rollYear`, so earlier draws keep their order.
- `League` stays plain JSON; any stored-shape change bumps `SAVE_VERSION` (99 today) with a step in `migrate.ts`.
- Hidden traits, cliffs and swings never appear as numbers on a screen.
- Bands are the owner's: never loosen a range to go green. If the age lines can't reach their bands with every existing
  check green, stop and bring the owner how close it got.
- Approved fail bands (`normal`): starter mean age ±0.75 years (K, P ±1.5); 24-or-younger and 31-or-older shares ±8
  points (QB, K, P ±10); all positions ±0.4 years and ±4 points; next season, ages 21–32, still starting ±7 points, gone
  ±6; talent bump at most 0.15 over settled. Warn bands (`usual`) are 60% of each width (the builder's call in the spec).
- Ages are whole years on both sides (AFLS keeps whole years; the NFL's are floored).
- Starters are counted with `STARTERS` (`positions.ts`) on both sides.
- Every commit: `npm run format`, `npm run typecheck`, and the touched tests (`npx vitest run <file>`). Never run
  `npm run check` unless the owner asks; CI runs the plan on each PR. Fix every red check on a PR before calling it
  ready.
- Commit messages end with the session's attribution lines; no model names in commits, code or docs.

## Review Focus

1. **A save loaded mid-season** has development years partly landed (`Player.dev`). Re-rolled under new rules they
   would jump ratings toward new targets. Expected: a year rolled before the update finishes under the rules it was
   rolled with (Task 4).
2. **A young healthy star** must not fall off a cliff. Expected: zero chance under `CLIFF.from` without a severe injury
   that season (Task 5).
3. **A year released in steps after a cliff** must land where one jump would. Expected: the severe-injury input is
   worked out the same way at the roll and at every re-roll (Task 5).
4. **A player with no rating history** (a migrated save, a CFL or Pathway arrival, a founding player) must still get a
   retirement chance. Expected: his best overall falls back to today's, no NaN (Task 6).
5. **The AI's aging table cached across a test that turns cliffs off** must not serve stale values. Expected:
   `expectedAging` memo keyed on whether cliffs are on (Task 7).

---

## PR 1: Measure

### Task 1: The NFL research

**Files:**

- Create: `scripts/research-aging.py`
- Create: `docs/research/league-age.md`

- [ ] **Step 1: Write `scripts/research-aging.py`** from the session's probe (the
      `research-squads.py` pattern: `--data` defaulting to `work/nfl-aging`, `--download`, standard library only). It
      downloads `players.csv` and `snap_counts_{2013..2025}.csv` from
      `https://github.com/nflverse/nflverse-data/releases/download`, maps nflverse positions to AFLS's (`T G C OT OG OL`
      → OL, `DT NT` → DT, `DE OLB` → EDGE, `LB ILB MLB` → LB, `CB DB` → CB, `S FS SS SAF` → S), takes a team-season's top
      `STARTERS` players per position by offense snaps (offense), defense snaps (defense) or special-teams snaps (K, P),
      floors the age on September 1 to whole years, and prints: (a) starters by position 2016–25: mean, share ≤24,
      share ≥31; (b) next season for starters 2013–24 by age band (21–24, 25–26, 27–28, 29, 30, 31, 32, 33, 34, 35–36,
      37+) for all, long prime (TE OL DT), short prime (RB WR CB EDGE LB S), QB and K/P: still starting, playing not
      starting, gone (no snaps); (c) the median age a starter left for good (no snaps in either of the next two seasons,
      2013–23) by position.

- [ ] **Step 2: Run it** — `python3 -I scripts/research-aging.py --download` — and check its output matches these
      (2016–25, whole years):

  | Pos  | mean  | ≤24  | 31+  |     | Pos | mean  | ≤24  | 31+  |
  | ---- | ----- | ---- | ---- | --- | --- | ----- | ---- | ---- |
  | QB   | 28.02 | 32.5 | 28.8 |     | LB  | 26.30 | 28.8 | 8.8  |
  | RB   | 25.15 | 44.7 | 4.1  |     | CB  | 25.66 | 41.1 | 6.0  |
  | WR   | 25.54 | 41.6 | 6.2  |     | S   | 26.20 | 32.3 | 9.3  |
  | TE   | 26.57 | 30.9 | 11.9 |     | K   | 28.97 | 18.8 | 32.6 |
  | OL   | 26.75 | 26.7 | 12.5 |     | P   | 28.09 | 22.9 | 25.1 |
  | DT   | 26.67 | 27.1 | 11.1 |     | ALL | 26.48 | 32.2 | 11.8 |
  | EDGE | 26.48 | 32.0 | 11.6 |     |     |       |      |      |

  Next season (still starting / gone, %): all 68.7/4.2, 64.8/5.8, 63.0/7.6, 60.7/11.1, 54.0/16.3, 52.3/15.1, 59.9/17.8
  for 21–24 … 32; long prime 70.3/4.1, 64.8/5.4, 64.8/7.2, 61.8/12.0, 54.4/17.5, 44.9/18.4, 53.6/27.4; short prime
  66.3/3.9, 62.6/5.9, 59.0/7.4, 55.4/11.9, 47.3/17.7, 48.1/15.2, 55.2/16.2. Exit medians: QB 37.5, RB 27.0, WR 28.0, TE
  31.3, OL 30.3, DT 29.1, EDGE 30.0, LB 29.2, CB 30.0, S 29.9, K 32.6, P 30.1.

- [ ] **Step 3: Write `docs/research/league-age.md`**: sources, definitions (as Step 1), the three tables, and the
      session's AFLS figures from the spec for comparison. `work/` stays out of git (`.gitignore` already has `work/`).

- [ ] **Step 4: Commit** — `git add scripts/research-aging.py docs/research/league-age.md` — "Research: NFL starters'
      ages and next seasons (nflverse)".

### Task 2: The measuring module

**Files:**

- Create: `scripts/league-age-core.ts`
- Test: `scripts/league-age-core.test.ts`

**Interfaces — Produces:**

```ts
export type AgeGroup = 'all' | 'long' | 'short';
export type AgeBand = '21-24' | '25-26' | '27-28' | '29' | '30' | '31' | '32';
export interface Fate { n: number; keep: number; play: number; gone: number }
export type Starters = Map<number, { pos: Position; age: number }>;
export const NFL_STARTER_AGE: Record<Position | 'ALL', { mean: number; young: number; old: number }>; // Task 1 table
export const NFL_NEXT: Record<AgeGroup, Record<AgeBand, { keep: number; gone: number }>>; // Task 1, percentages
export const NFL_EXIT_AGE: Record<Position, number>; // Task 1 medians
export const AGE_WIDTH = { mean: 0.75, meanKP: 1.5, share: 8, shareWide: 10, allMean: 0.4, allShare: 4, keep: 7, gone: 6, bump: 0.15 };
export const WARN = 0.6; // usual band = WARN × width
export function bandFor(target: number, width: number): { usual: [number, number]; normal: [number, number] };
export function ageGroupOf(pos: Position): 'long' | 'short' | null; // TE OL DT long; RB WR CB EDGE LB S short; else null
export function ageBandOf(age: number): AgeBand | null; // null under 21 or over 32
export function seasonStarters(league: League, season: number): Starters;
export function playedIn(league: League, season: number): Set<number>;
export function nextSeason(starters: Starters, next: Starters, nextPlayed: Set<number>): Record<AgeGroup, Partial<Record<AgeBand, Fate>>>;
export function exitAges(seasons: Starters[], played: Set<number>[]): Partial<Record<Position, number[]>>;
```

`seasonStarters`: for each team, each position, the top `STARTERS[pos]` of the players whose `teamId` is that team and
not retired at the season's end, ranked by `stats[season].snaps` (K and P by `stats[season].gp`), counting only n > 0;
age is `p.age`. `playedIn`: ids with snaps > 0 (K, P: gp > 0) that season. `nextSeason`: keep = in `next`; play = not
in `next` but in `nextPlayed`; gone = neither; `all` counts every position, `long`/`short` by `ageGroupOf`.
`exitAges`: a starter in season i with no snaps in i+1 and i+2 adds his age, for i up to `length − 3`.

- [ ] **Step 1: Write the failing tests** in `scripts/league-age-core.test.ts` (build a league with
      `createLeague({ seed: 'league-age-core' })`, `structuredClone` per test, set `stats[season]` by hand):
  - `seasonStarters picks each team's top N by snaps`: give three WRs on team 0 snaps 900, 800, 700 and a fourth 950 on
    team 1 → team 0's three are starters with their ages; a 0-snap player never is.
  - `kickers and punters start by games played`: two Ks on a team with gp 17 and 3 → the 17.
  - `nextSeason sorts a starter into keep, play or gone by age band`: three starters aged 29 (one starts next season,
    one only played, one absent) → `all['29']` is `{ n: 3, keep: 1, play: 1, gone: 1 }`; an OL lands in `long`, a WR in
    `short`, a QB in neither; a 33-year-old is counted nowhere.
  - `exitAges counts a starter with no snaps for two seasons`.
  - `bandFor(26.48, 0.75)` → normal `[25.73, 27.23]`, usual `[26.03, 26.93]`.
  - `NFL_STARTER_AGE.ALL` is `{ mean: 26.48, young: 32.2, old: 11.8 }`.

- [ ] **Step 2: Run** `npx vitest run scripts/league-age-core.test.ts` — expected FAIL (module missing).
- [ ] **Step 3: Implement `scripts/league-age-core.ts`** to the interfaces above, constants copied from Task 1.
- [ ] **Step 4: Run** the test file — expected PASS. `npm run typecheck` passes.
- [ ] **Step 5: Commit** — "Careers: measure starters' ages the NFL's way".

### Task 3: The careers check reads 20-season leagues

**Files:**

- Modify: `scripts/careers-league.ts` (`LeagueRun`, `runLeague`, default `CAREERS_SEASONS`)
- Modify: `scripts/careers.ts` (default seasons, a known-issue helper, the new block; the `mean starter age` line goes)

**Interfaces — Consumes:** Task 2's module. **Produces:** on `LeagueRun`:

```ts
age: {
  starters: { pos: Position; age: number }[];                       // every steady season's starters, pooled
  fates: Record<AgeGroup, Partial<Record<AgeBand, Fate>>>;          // steady seasons → their next season
  exits: Partial<Record<Position, number[]>>;
  gap: { first: Record<number, number>; settled: Record<number, number> }; // overall below his position's mean starter, by age 21–36
}
```

- [ ] **Step 1: Collect in `runLeague`.** After each `simToEndOfSeason`, keep `seasonStarters` and `playedIn` for the
      season; once the run ends, fill `age` from the seasons from `steadyFrom` on (fates need the season after, so the last
      steady season's fates are dropped). `gap.first` is read at the first kickoff, `gap.settled` averaged over the steady
      kickoffs (all rostered non-K/P players, overall less his position's mean starter overall: the session's probe
      `age-probe.ts` did this).
- [ ] **Step 2: Default 20 seasons** in `careers.ts` (`process.argv[2] ?? 20`) and `careers-league.ts`
      (`CAREERS_SEASONS ?? 20`); the file comment says 20 and seasons 11–20.
- [ ] **Step 3: Print the block** in Part 2, pooled over the four `SEEDS`: per position and ALL, the mean, ≤24 and 31+
      against `NFL_STARTER_AGE` with `bandFor`; per group and band, still starting and gone against `NFL_NEXT`; exit
      medians beside `NFL_EXIT_AGE` (informational); `gap.first` and `gap.settled` by age (informational). In this PR every
      judged line goes through a `soft()` like `scripts/offseason.ts`'s: a miss shows ⚠ and is listed under "⚠ known issue:
      leagues grow older than the NFL's", never counted in `misses`. Delete the `mean starter age:` line. Keep `RETIRE`.
- [ ] **Step 4: Run** `npm run careers` (about 8 minutes on 4 cores). Expected: exit 0; the new lines print with ⚠ near
      the session's figures (all 27.7–27.8, ≤24 about 20%, 31+ about 21%). If an existing line fails at 20 seasons that
      passes at 16 on main (`npm run careers -- 16`), stop: report it to the owner with both numbers.
- [ ] **Step 5: Commit, push, open PR 1** ("Careers: starters' ages against the NFL's, 20-season leagues"), the PR
      template's headings filled. Read CI; fix any red. No version bump (no change to play).

---

## PR 2: Development, cliffs and retirement

### Task 4: A year finishes under the rules it was rolled with

**Files:**

- Modify: `src/engine/development.ts` (`rollYear`, `beginYear`, `yearTargets`)
- Modify: `src/engine/types.ts` (`DevYear.rules?: 2`)
- Modify: `src/engine/generate.ts` (`SAVE_VERSION` 99 → 100), `src/engine/migrate.ts` (a v100 step that changes nothing:
  a year without `rules` is a v1 year)
- Test: `src/engine/development.test.ts`

**Interfaces — Produces:** `export const DEV_RULES` and a frozen `DEV_RULES_V1` in `development.ts`, each
`{ pace: [number, number]; primeSwing: number; growthEnds: number; mentalGrowth: number; cliffs: boolean }`.
`DEV_RULES_V1` holds today's values (`[0.15, 0.5]`, `0.4`, `26`, `0.06`, `false`). `DevContext.rules?: 1 | 2`;
`rollYear` reads `ctx.rules === 1 ? DEV_RULES_V1 : DEV_RULES` for every constant above. Every `26` in
`development.ts` that means "growth ends" reads `growthEnds` (`growthShare`'s physical share, `rollYear`'s growth
branch and its mental gains, `beginYear`'s stored `rate` and `potential`; `settleYear`'s 26 is the ceiling's and stays).
`MENTAL_LAG` in `aging.ts` is not a rule: the outlook and screens read `declineOnset`, so it stays 3. `beginYear` stores
`rules: 2`; `yearTargets` passes `d.rules ?? 1`.

- [ ] **Step 1: Write the failing test** `an open year rolled under the old rules lands under them`: build a league,
      play into the season so players carry `dev`; delete every `dev.rules`; set `DEV_RULES.primeSwing = 3` for the test
      (restore after); release the rest of the year; expect each player's ratings to equal a copy released with
      `DEV_RULES` untouched.
- [ ] **Step 2: Run** `npx vitest run src/engine/development.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** as in Interfaces, with `DEV_RULES` equal to `DEV_RULES_V1` for now (no change to play).
- [ ] **Step 4: Run** the test file and `src/engine/migrate.test.ts` if present — PASS.
- [ ] **Step 5: Commit** — "Development: a year finishes under the rules it was rolled with".

### Task 5: Cliffs

**Files:**

- Create: `src/engine/cliffs.ts`
- Modify: `src/engine/development.ts` (`DevContext.hurt?: boolean`; the cliff in `rollYear`; `yearTargets` passes
  `hurt`), `src/engine/offseason/index.ts` (`beginYear` gets `hurt: severeInjuryIn(p, last)`)
- Test: `src/engine/cliffs.test.ts`, `src/engine/development.test.ts`

**Interfaces — Produces:**

```ts
export const CLIFF = { from: 28, lead: 1, base: 0.03, perYear: 0.03, hurt: 3, fragile: 0.08, size: [2, 4] as [number, number] }; // starting values; Task 9 tunes
export const CLIFFS = { on: true, always: false }; // `always` for tests only
export function severeInjuryIn(p: Pick<Player, 'injuries'>, season: number): boolean; // 'severe' or 'career-threatening' that season
export function cliffChance(age: number, pos: Position, traits: Pick<Traits, 'durability'>, hurt: boolean): number;
```

`cliffChance`: 0 when `!CLIFFS.on`; 1 when `CLIFFS.always`; under `CLIFF.from`, `hurt ? CLIFF.base * CLIFF.hurt : 0`;
from `declineOnset(pos, 'technical', traits) − CLIFF.lead` on, `base + perYear × years past it`, times `hurt` when hurt
and `(1 + fragile × (TRAIT_MEAN − durability))`, capped at 0.5; between the two, `base` (and the hurt multiplier).
In `rollYear`, when `rules.cliffs`, after the per-attribute loop: `if (rng.chance(cliffChance(...)))` take
`rng.float(...CLIFF.size)` overall points off the physical and technical targets, spread by their OVR weights and
`FAMILY_LOSS` as `delta` is spread. `yearTargets` passes `hurt: severeInjuryIn(p, d.season - 1)`.

- [ ] **Step 1: Write the failing tests** in `cliffs.test.ts`: `no cliff for a healthy player under CLIFF.from` (ages
      21–27, every position, hurt false → 0); `a severe injury can bring one early` (age 25, hurt → > 0);
      `the chance rises with age past the turn` (OL 29…36 non-decreasing, and 35 > 30); `a fragile body falls sooner`
      (durability 1 > durability 20 at 31); `severeInjuryIn reads the season's record` (a severe `InjuryRecord` in 2030 →
      true for 2030, false for 2031; a moderate one → false). In `development.test.ts`:
      `a cliff year released in steps lands where one jump would` (with `CLIFFS.always`, a 31-year-old OL: `beginYear`
      then every release step → ratings equal `developPlayer` on the same stream and inputs).
- [ ] **Step 2: Run** both test files — expected FAIL.
- [ ] **Step 3: Implement** to the interfaces; set `DEV_RULES.cliffs = true`.
- [ ] **Step 4: Run** both test files and `npx vitest run src/engine` — PASS (tests that pin exact development
      outcomes may move; update a number only where the cliff draw explains it, and say so in the test).
- [ ] **Step 5: Commit** — "Development: some veterans fall off a cliff".

### Task 6: Retirement follows the body

**Files:**

- Modify: `src/engine/aging.ts` (`bestOvr`, `retireChance`, `RETIRE_BODY`)
- Test: `src/engine/development.test.ts` ("retirement and the one aging table")

**Interfaces — Produces:**

```ts
export const RETIRE_BODY = { from: -1, perYear: 0.04, fall: 0.12, slack: 1, cap: 0.95 }; // starting values; Task 9 tunes
export function bestOvr(p: Pick<Player, 'ratingHistory' | 'position' | 'ratings'>): number; // max of today's overall and each snapshot's at his position
```

`retireChance` for a player under contract: `over = age − (peakEnd + bodyShift)`; `over ≥ 8` → 1; otherwise
`clamp(perYear × max(0, over − from) + fall × max(0, bestOvr − ovr − slack), 0, cap)`; the old "ovr < 8 and over ≥ 2 →
at least 0.5" stays. Unsigned players keep today's rule.

- [ ] **Step 1: Rewrite the test** `retires players by position and body clock` to: a 26-year-old at his best → 0;
      every position: non-decreasing from 28 to 40 at his best; at 31, an OL 3 points under his best > one at his best;
      `at('K', 37) < at('RB', 33)`; `at('QB', 36) < at('WR', 36)`; durable < fragile at 33; RB at 36 → 1. Add
      `bestOvr falls back to today's ratings with no history` and `bestOvr reads a mover at his current position`.
- [ ] **Step 2: Run** `npx vitest run src/engine/development.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** to the interfaces.
- [ ] **Step 4: Run** the file — PASS.
- [ ] **Step 5: Commit** — "Retirement: follows the body, not a fixed age".

### Task 7: Front offices price the cliff

**Files:**

- Modify: `src/engine/development.ts` (`expectedAging`)
- Test: `src/engine/development.test.ts`

`expectedAging(pos, age)` subtracts `cliffChance(age, pos, { durability: TRAIT_MEAN }, false) × mean(CLIFF.size)`,
reads the current `DEV_RULES` (mental growth and lag), and keys its memo on `CLIFFS.on` (clear or key both ways).

- [ ] **Step 1: Write the failing test** `the AI expects the average cliff`: for each position and ages 30–36,
      `expectedAging` with `CLIFFS.on` is below it with `CLIFFS.on = false`; under 28 the two are equal; toggling twice
      returns the first values (no stale memo).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — "Outlook: front offices see the average cliff coming".

### Task 8: Careers Part 1 reads survivors at late ages

**Files:**

- Modify: `scripts/careers.ts` (`cohort`, the curve lines)

In `cohort()`, after each age's development: `recordRatings(p, 2000 + age)`, then roll
`retireChance({ ...p, teamId: 0 }, playerOvr(p))` on `new Rng(\`careers:retire:${pos}:${i}:${age}\`)`; keep
`alive: boolean[][]` beside `ovr`. A `survivors(c, age)` curve averages players alive at that age. The lines that read 32
and older (`below peak at 32/33/35/37/38`, by position as today) read `survivors`; peak age and every earlier age read
everyone as today. No range changes.

- [ ] **Step 1: Implement** and print `(survivors: n at age)` on each changed line.
- [ ] **Step 2: Run** `npm run careers` — Part 1 prints; note which lines move (Part 2 judged in Task 9).
- [ ] **Step 3: Commit** — "Careers: late-age curves read the players a league keeps, as the research did".

### Task 9: Tune until the age lines are judged and green

**Files:**

- Modify: `src/engine/development.ts` (`DEV_RULES`), `src/engine/cliffs.ts` (`CLIFF`), `src/engine/aging.ts`
  (`RETIRE_BODY`), `src/engine/offseason/draft.ts` (`RAW`, `HYPE_ROOM`, the class strength `14.1`)
- Modify: `scripts/careers.ts` (the block's `soft` lines become `check` lines with `bandFor`'s `normal`; `RETIRE` and
  its judged line go, the exit medians stay informational)

- [ ] **Step 1: Judge the lines.** Switch the Task 3 block to `check(label, value, ...band.usual, digits, band.normal)`.
- [ ] **Step 2: Tune, in this order, one `npm run careers` per change** (about 8 minutes each; the session's
      `age-probe2.ts` in the scratchpad reads one league in about 6 for direction): (a) timing: lower `RAW`, widen
      `DEV_RULES.pace`, trim `mentalGrowth`, so 21–25-year-olds sit nearer a starter (the `gap.settled` line) and the ≤24
      shares rise; raise the class strength `14.1` only to hold the starter OVR band (12.65–13.3) and the bust lines
      (first-round busts 25–45%, Day 3 solid starters 8–20%); (b) `primeSwing` until "still starting" for 21–28 sits in
      band; (c) `CLIFF` until long-prime "gone" at 29–32 sits in band; (d) `RETIRE_BODY` until "gone" for all and short
      prime sits in band and the 31+ shares follow. Each constant's comment says what it was fitted to and the result, as
      the file's existing comments do.
- [ ] **Step 3: Done when** `npm run careers` exits 0 with every age line and every existing line inside its range. If a
      lever runs out (a band can't be met without another line leaving its range), stop: bring the owner the closest run's
      lines.
- [ ] **Step 4: Run the area checks once each, small where they allow:** `npm run sim -- 10`, `npm run offseason -- 6`,
      `npm run trades`, `npm run training`, `npm run morale`. A miss caused by the change is fixed here; a known-issue
      line that moves (free agency, starters leaving football) is noted for the next project, not tuned.
- [ ] **Step 5: Commit** — "Development: young players arrive sooner, primes swing, starters age like the NFL's".

### Task 10: Docs, version, PR 2

**Files:** `docs/MVP.md`, `docs/GAME_DESIGN.md` ("How players develop and age", "Retirement"), `package.json`,
`src/ui/changelog.ts`, `docs/research/league-age.md` (AFLS's new figures)

- [ ] **Step 1:** MVP.md: the "Leagues grow older" item → `[x]` with the version and the new figures (all, QB, OL;
      ≤24 and 31+); note what moved in the free-agency and starters-leaving lines for project B.
- [ ] **Step 2:** GAME_DESIGN.md: growth timing, the prime's swing, cliffs (rare before 28, likelier after a severe
      injury and with a fragile body), retirement by the body, the AI pricing the average cliff.
- [ ] **Step 3:** `package.json` PATCH bump; a `changelog.ts` entry (title ≤40 characters, one or two sentences ≤200,
      a player's words), e.g. "Careers that end like real ones".
- [ ] **Step 4:** `npm run format`, `npm run typecheck`, `npx vitest run src/ui/changelog.test.ts` (or the test that
      holds the changelog's limits) — PASS. Commit, push, open PR 2. Read CI; fix any red.

---

## PR 3: A starting league that's already settled

### Task 11: Founding players follow the settled age curve

**Files:**

- Modify: `src/engine/generate.ts` (`FOUNDING_LEAN`, the founding roster loop, founding potentials)
- Modify: `scripts/careers.ts` (the talent bump line)
- Test: `src/engine/generate.test.ts` (or the file that tests `createLeague`)

**Interfaces — Produces:** `export const FOUNDING_LEAN: Record<number, number>` (ages 22–36: overall points added to a
founding player's quality so the first-kickoff gap by age matches the settled one: `gap.settled − gap.first` from Task
9's final careers run, pooled) and `export const FOUNDING_GROWTH: Record<number, number>` (ages 22 to
`DEV_RULES.growthEnds − 1`: the settled league's mean growth still ahead of a player that age, from the same run).
`generatePlayer`, for `spec.founding` and those ages, makes the same two potential draws it makes today, scaled so their
mean is `FOUNDING_GROWTH[age]`; everyone else's potential is unchanged.

- [ ] **Step 1: Write the failing test** `founding players' ages don't change the draws`: two leagues on one seed, one
      with `FOUNDING_LEAN` zeroed → same player ids, ages, names and positions. And
      `a founding league's young are rated as a settled league's are`: mean overall less position starter mean at 22–23
      within 0.5 of `gap.settled`'s values, pinned from Task 9's run.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.** In both founding passes (the probe and the real one), draw `age` with `slotAge` before
      building the spec (same draw order: the quality expression draws nothing). In the real pass, after `evenDeal`,
      `quality = clamp(rolls[position][slot] + (isStarter ? teamTalent : 0) + FOUNDING_LEAN[age], 4, 19.5)`.
- [ ] **Step 4: Judge goal 3** in `careers.ts`: `talent bump: highest season − settled (seasons 11–20 mean)`, `check`
      with usual `[−Infinity, 0.09]`, normal `[−Infinity, 0.15]`.
- [ ] **Step 5: Run** the test, `npm run careers`, `npm run offseason -- 6`, `npm run size`, `npm run sim -- 10` (the
      opening win spread and "new leagues as even as lived-in ones"). Green, or stop and report.
- [ ] **Step 6:** MVP.md (the talent slide closed), GAME_DESIGN.md's founding-league paragraph, PATCH bump, changelog
      entry, format, typecheck. Commit, push, open PR 3. Read CI; fix any red.
