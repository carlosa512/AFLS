# Real Heights Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Builds come from curves fitted to real NFL rosters, bounded by real extremes for the founding league and one
step wider for every later arrival, with no pile-up at the bounds.

**Architecture:** `size.ts` gets the real table (`SIZE` with a per-position correlation `r`), founding `BOUNDS`, an
`ARRIVAL_STEP`, and a truncated-normal `rollSize` that still costs two draws. `generatePlayer` takes `founding?: true`
from `createLeague` only. `scripts/size.ts` judges the tiers and adds a 25-season long run in a child process.

**Tech Stack:** TypeScript, Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-11-02-real-heights-design.md`

## Global Constraints

- `SIZE`, `BOUNDS` and the real tail counts are copied exactly from the spec's two tables (no rounding, no
  re-fitting).
- `ARRIVAL_STEP = { h: 1, w: 10 }`.
- `rollSize` draws exactly two values from `rng` per call, for either tier.
- Only `createLeague` (its probe pass and its real pass) passes `founding: true`; every other `generatePlayer` call
  stays as it is and gets arrivals.
- `isOutlier`'s 1.3 sd line, `GEM_RATE`, `EDGE_CAP` and the edge constants (`FULL_HEIGHT`, …) are unchanged.
- No `SAVE_VERSION` bump, no migration step. `toCurve` (v55) keeps its job, against the new `SIZE` and the arrival
  bounds.
- Never loosen a check's range to get green (CLAUDE.md). A test pinned to a specific build may get a new expected
  value; a test pinned to anything else that changes is a finding to investigate.
- Version: the last number, from main at PR time. Commits end with the session's attribution lines; `npm run format`
  before each commit.

## Review Focus

1. **Draw count across tiers:** a founding and an arrival roll from the same stream state leave the stream in the
   same state. Pinned in Task 1 ("costs exactly two draws, either tier").
2. **Rounding at the bounds:** a draw near a bound rounds inside it (the half-inch widening), for every position and
   both tiers. Pinned in Task 1's 20,000-roll table test (min/max inside the bounds).
3. **No pile-up:** the share of founding rolls exactly at a bound is no more than the truncated curve's mass for that
   inch, plus noise. Pinned in Task 1 ("no bound collects a tail").
4. **DT's near-zero correlation:** weight conditioned on height with `r = 0.01` must not divide by zero or blow up;
   `sqrt(1 - r²)` stays positive for every `r` in the table. Pinned by the table test covering DT.
5. **A position move's weight clamp** (`training.ts:285`) reads `sizeLimits(to).w`, the arrival tier: a mover is
   never clamped tighter than an arrival. Pinned in Task 1's updated "position move" test.

---

### Task 1: Real curves and the truncated roll (`size.ts`)

**Files:**
- Modify: `src/engine/size.ts` (`SIZE`, `TAIL`, `HEIGHT_WEIGHT`, `sizeLimits`, `rollSize`, `toCurve`)
- Test: `src/engine/size.test.ts` (`rollSize` and `generation` blocks)

**Interfaces:**
- Produces:
  - `SIZE: Record<Position, { h: [number, number]; w: [number, number]; r: number }>`
  - `BOUNDS: Record<Position, { h: [number, number]; w: [number, number] }>` (founding)
  - `ARRIVAL_STEP = { h: 1, w: 10 }`
  - `type SizeTier = 'founding' | 'arrival'`
  - `sizeLimits(pos: Position, tier: SizeTier = 'arrival'): { h: [number, number]; w: [number, number] }`
  - `rollSize(rng: Rng, pos: Position, tier: SizeTier = 'arrival'): { heightIn: number; weightLb: number }`
  - module-local `normCdf(z: number): number`, `normInv(p: number): number`

- [ ] **Step 1: Write the failing tests** (edit the existing `rollSize` block; keep its `stats` helper)

```ts
it('costs exactly two draws, either tier', () => {
  for (const tier of ['founding', 'arrival'] as const) {
    const a = new Rng('draws'), b = new Rng('draws');
    rollSize(a, 'WR', tier); b.next(); b.next();
    expect(a.next()).toBe(b.next());
  }
});

it('matches the table at every position, inside each tier', () => {
  // 20,000 rolls a position and tier: mean within 0.2 in / 2 lb of SIZE, sd within 10% of SIZE's,
  // min/max inside sizeLimits(pos, tier); founding limits equal BOUNDS[pos];
  // arrival limits equal BOUNDS widened by ARRIVAL_STEP.
});

it('no bound collects a tail', () => {
  // founding WR and OL: share of rolls at exactly the top and bottom height bound < 1.5%
  // (the old clamp put 0.6–2.5% there; the truncated curve's mass for one end inch is well under 1%).
});
```

Update in the `generation` block: "rolls new players from the bell curve" (CB) expects `short` (≤ 69 in) between
`0.05` and `0.10`, and keeps the "some under 69, some over 74" lines. "clamps weight on a position move" sets
`ol.weightLb = 400` and still expects `sizeLimits('DT').w[1]` (389).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/engine/size.test.ts`
Expected: FAIL (`sizeLimits` takes no tier, `BOUNDS`/`ARRIVAL_STEP` missing, sd off the new table).

- [ ] **Step 3: Implement in `src/engine/size.ts`**

- `SIZE` and `BOUNDS` from the spec's table; drop `TAIL` and `HEIGHT_WEIGHT` (the table's `r` replaces it).
- `sizeLimits(pos, tier)`: `BOUNDS[pos]`, or widened by `ARRIVAL_STEP` each side for `arrival`.
- `rollSize`: two uniforms `u1 = rng.next()`, `u2 = rng.next()`. Height: truncated normal on `u1` between the
  tier's height bounds widened by 0.5 each side:
  `x = mean + sd * normInv(Φa + u1 * (Φb − Φa))`, `Φa = normCdf((lo − 0.5 − mean) / sd)`, likewise `Φb` with
  `hi + 0.5`; round, then clamp to `[lo, hi]` only as a guard against float edges. Weight: the same on `u2`, with
  mean `wMean + r * wSd * (zh)` and sd `wSd * sqrt(1 − r²)`, where `zh` is the drawn height's z before rounding.
  Clamp `u` inputs away from 0 and 1 (`Number.EPSILON`) so `normInv` stays finite.
- `normCdf`, `normInv`: an Abramowitz–Stegun `erf` and Acklam's rational inverse (accuracy ~1e-6 or better).
- `toCurve`: replace `clamp(z, -TAIL, TAIL)` with `clamp(z, -2.5, 2.5)` as a local constant there
  (`OLD_SAVE_TAIL`, with a one-line comment), and keep `lim = sizeLimits(p.position)` (arrival).

- [ ] **Step 4: Run the size tests**

Run: `npx vitest run src/engine/size.test.ts`
Expected: PASS. A spot-fit, gem or "size in words" test that fails because it leaned on a specific rolled build: give
the test player an explicit build (the test's intent, not a new expected number). Note each in the ledger.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/size.ts src/engine/size.test.ts
git commit -m "Size: curves fitted to real rosters, bounds by tier, a truncated roll with no pile-up"
```

### Task 2: Founding vs arrival (`generate.ts`)

**Files:**
- Modify: `src/engine/generate.ts` (`PlayerSpec`, `generatePlayer`'s `rollSize` call, `createLeague`'s two
  `generatePlayer` calls at ~856 and ~876)
- Test: `src/engine/size.test.ts` (`generation` block)

**Interfaces:**
- Consumes: `rollSize(rng, pos, tier)`, `sizeLimits(pos, tier)` from Task 1.
- Produces: `PlayerSpec.founding?: boolean`.

- [ ] **Step 1: Write the failing tests**

```ts
it("a new league's players sit inside the founding bounds", () => {
  const l = createLeague({ seed: 'real-heights' });
  for (const p of Object.values(l.players)) {
    const lim = sizeLimits(p.position, 'founding');
    expect(p.heightIn).toBeGreaterThanOrEqual(lim.h[0]); expect(p.heightIn).toBeLessThanOrEqual(lim.h[1]);
    expect(p.weightLb).toBeGreaterThanOrEqual(lim.w[0]); expect(p.weightLb).toBeLessThanOrEqual(lim.w[1]);
  }
});

it('a player generated after the league rolls on the arrival tier', () => {
  // generatePlayer with no `founding`, 5,000 WRs: all inside sizeLimits('WR', 'arrival'),
  // and at least one outside sizeLimits('WR', 'founding') (the extra inch is reachable).
});
```

- [ ] **Step 2: Run to verify the first fails** (`createLeague` still rolls arrivals: some player past founding)

Run: `npx vitest run src/engine/size.test.ts -t "founding|arrival tier"`
Expected: the founding test FAILS; the arrival test may already pass (arrival is the default).

- [ ] **Step 3: Implement**: `PlayerSpec.founding?: boolean`; `rollSize(rng, position, spec.founding ? 'founding' :
  'arrival')`; `founding: true` on both `createLeague` calls (probe and real pass).

- [ ] **Step 4: Run the engine tests**

Run: `mkdir -p .check && npx vitest run src/engine > .check/engine-tests.log 2>&1; tail -5 .check/engine-tests.log`
Expected: PASS. Failures that pin a build (a height, a weight, a spot fit): give the player an explicit build or a
new expected value, and ledger each. Anything else that moved is a finding: stop and investigate
(systematic-debugging) before changing it.

- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine/generate.ts src/engine/size.test.ts <any test fixed>
git commit -m "Size: the founding league rolls inside real roster bounds; arrivals one step wider"
```

### Task 3: The checks and the research note

**Files:**
- Create: `scripts/size-long.ts` (the long run, one league, prints JSON for the parent)
- Modify: `scripts/size.ts` (curve block by tier, the pile-up line, the long-run block, header)
- Create: `docs/research/player-size-rosters.md`
- Modify: `CLAUDE.md` (the `npm run size` line)

**Interfaces:**
- Consumes: `SIZE`, `BOUNDS`, `sizeLimits(pos, tier)`, `rollSize(rng, pos, tier)` from Task 1.
- Produces: `scripts/size-long.ts` prints one JSON line `{ seasons: Array<Record<Position, { n: number; atMax:
  number; atMin: number; past: number }>>, strays: number, rare: { pos, heightIn, weightLb, drafted }[] }`.

- [ ] **Step 1: Curve block by tier** in `scripts/size.ts`: run the existing 20,000-roll judgement once per tier
  against `sizeLimits(pos, tier)`, and add per position the founding share exactly at each height bound with ✗ over
  1.5%.

- [ ] **Step 2: `scripts/size-long.ts`**: `createLeague({ seed: 'size-long' })`, then 25 times
  `simToEndOfSeason`, `beginOffseason`, `while (phase !== 'regular') advanceOffseason(league, { autoUser: true })`
  (the loop in `scripts/careers-league.ts`). After each offseason, count per position over rostered players
  (`teamId !== null`, not retired): `n`, `atMax` (height ≥ founding max), `atMin` (≤ founding min), `past` (outside
  founding bounds); `strays` = anyone outside arrival bounds; `rare` = every player past founding bounds, once each.

- [ ] **Step 3: The long-run block** in `scripts/size.ts`: spawn `tsx scripts/size-long.ts` as a child process at
  the start (so it runs while the other blocks do), await its JSON at the end, and judge over the last five seasons:
  - `atMax` and `atMin` per position ≤ `2 × real × (n / realPlayers) + 1.5` (real counts and players/season from
    the spec's tables). ✗ otherwise.
  - `past` per position per season ≤ 1.5 on average. ✗ otherwise.
  - `strays === 0`. ✗ otherwise.
  - Print the rare builds (position, height in feet and inches, weight, season drafted).

- [ ] **Step 4: Run it**

Run: `npm run size > .check/size.log 2>&1; tail -60 .check/size.log`
Expected: exit 0, no ✗; the long-run lines print per position; the medians-against-as-built block still passes.
If a long-run tail is ✗, read why (a curve too fat at that position, or retirement keeping one build longer) before
touching anything; the ranges are the spec's and don't loosen.

- [ ] **Step 5: Research note and docs**: `docs/research/player-size-rosters.md` with the source (nflverse
  `rosters` release, 2020–24, status `ACT`, first row per `gsis_id`), the position mapping and the EDGE/OLB caveat,
  both tables, and how to rebuild them. `scripts/size.ts`'s header and CLAUDE.md's `npm run size` line add: "each
  tier's bounds, no pile-up at a bound, and a 25-season league's tails against real rosters".

- [ ] **Step 6: Commit**

```bash
npm run format
git add scripts/size.ts scripts/size-long.ts docs/research/player-size-rosters.md CLAUDE.md
git commit -m "Size check: tiers, no pile-up, and a 25-season long run against real roster tails"
```

### Task 4: Play holds, version, push

**Files:**
- Modify: `package.json` (last number)

- [ ] **Step 1: Steer with a small sim**

Run: `npm run sim -- 10 > .check/sim.log 2>&1; tail -40 .check/sim.log`
Expected: every row inside its range (no ✗). A row out of range: report it with the numbers before changing
anything; size edges are centred, so a miss points at an edge that leaned on the old spread.

- [ ] **Step 2: Typecheck and the UI contract**

Run: `npm run typecheck && npx vitest run src/ui/ui.test.ts`
Expected: no errors; PASS.

- [ ] **Step 3: Bump the version** (the last number from main at the time), commit, and push once the owner has
  cleared pushing `claude/real-heights`:

```bash
npm run format
git add package.json
git commit -m "<new version>"
git push -u origin claude/real-heights
```

Then the PR when the owner asks; CI runs `size`, `sim` and `quirks` on it.
