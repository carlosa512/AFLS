# Fumble Recoveries and the Strip-Sack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat rolls after a fumble (who gets it, who's credited, the return) and the flat strip-sack with
odds read from the play, fitted to nflverse 2021–25, judged by `npm run fumbles` and `npm run sim`.

**Architecture:** A new pure module `match/looseBall.ts` answers who gets the ball, who's credited and how far he runs;
`sackStripOdds` joins `fumbleOdds.ts` beside `fumbleOdds`. `gameSim.ts` routes every fumble (run, catch, scramble, sack)
through one helper that rolls against them and builds today's turnover shape, and taps each sack and each recovery for
the checks.

**Tech Stack:** TypeScript (engine, Vitest), Python + pandas (`scripts/research-fumbles.py`), tsx check scripts.

**Spec:** `docs/superpowers/specs/2026-11-06-fumble-recoveries-design.md`

## Global Constraints

- All randomness through the game's `Rng`; `looseBall.ts` and `sackStripOdds` draw nothing and read no league.
- The engine reads ratings through `skill()` and size through `sizeEdge()`; a carrier's ball security against
  `PEER_SECURITY` (the quarterback's `PEER_SECURITY.QB`).
- The turnover keeps its shape (`{ kind, spot, returnYds, by }`); no save change, no `SAVE_VERSION` bump.
- Stats: `fumbles`, `fumblesLost`, `forcedFum` only when forced, `fumRec` for the defensive recoverer.
- An offensive recovery's text stays `. Fumble, recovered by the offense`; a quarterback's own sack fumble reads
  `, puts it on the ground` before the recovery.
- NFL buckets with fewer than 500 plays are reported, not judged; a bucket is judged only when its tolerance is at least
  3.5 standard errors. Never loosen a range; retune `fumbleOdds.ts`/`looseBall.ts`.
- Constants fitted on weeks 1 and 10 of played seasons, as `npm run sim` reads them.
- Version 0.4.7.

## Review Focus

- **A strip-sack in the end zone** (spot ≤ 0): the defense's recovery is a touchdown, the offense's a safety, as today.
  Test in Task 4.
- **A return reaching the goal line** is a touchdown and never runs past it; one short of it is not. Test in Task 2.
- **A position group with nobody on the field** (no linebacker in a dime look, no DB on the goal line): the recoverer
  comes from the next group, never undefined. Test in Task 2.
- **An unforced fumble** never credits a forced fumble and gives the forcer no share of the recovery. Test in Task 4.
- **An old save's strip-sack text** (no reason) still stages as today's strip. Test in Task 6.

---

### Task 1: The NFL measurement

**Files:**
- Modify: `scripts/research-fumbles.py`

**Interfaces:**
- Produces: printed tables that Tasks 2, 3 and 5 copy: `STRIP_NFL` (per-100 by bucket and by the rusher's spot, with
  n), the sack forced share, `RECOVERED_NFL` (lost share by play, forced and own, with n), `GROUP_NFL` (DB/LB/DL split by
  play), `FORCER_NFL` (by play), `RETURN_NFL` (by group: share zero or less, 1–9, 10–19, 20+, mean, touchdown share, n).

- [ ] **Step 1:** Add the depth-chart-free joins the spec's §1 used: sacks with the sacker from `sack_player_id` (else
  `half_sack_1_player_id`), his season roster `position`/`depth_chart_position` (`roster_YYYY.csv`, downloaded like the
  play-by-play), grouped edge (DE, OLB, EDGE), DB (CB, S, SS, FS, DB), off-ball LB (LB, ILB, MLB), interior (DT, NT, DL);
  the recoverer's group from `fumble_recovery_1_player_id` the same way; returns from `fumble_recovery_1_yards`
  (missing = 0), touchdowns from `return_touchdown`.
- [ ] **Step 2: Run** `python3 -I scripts/research-fumbles.py`.
  Expected: strip-sacks all 12.36 (n 6,552), edge 14.0, interior 8.0; lost share run 0.42 / forced 0.60 / own 0.26,
  catch 0.50 / 0.54 / 0.21, sack 0.51 / 0.52 / 0.38; DB returns mean 6.7, 20+ 0.12, TD 0.081.
- [ ] **Step 3: Commit** ("Research: fumble recoveries, returns and strip-sacks, nflverse 2021–25").

### Task 2: The loose ball

**Files:**
- Create: `src/engine/match/looseBall.ts`, `src/engine/match/looseBall.test.ts`

**Interfaces:**
- Consumes: `ContactKind` from `./fumbleOdds`.
- Produces:
  - `type LooseKind = ContactKind | 'sack'`; `type Group = 'DB' | 'LB' | 'DL'`.
  - `defenseRecovers(kind: LooseKind, forced: boolean): number` (spec §1's table; a scramble's own takes the sack's
    0.38).
  - `FORCER_RECOVERS: Record<LooseKind, number>` (run 0.15, catch 0.13, sack 0.11, scramble 0.07).
  - `recovererGroup(kind: LooseKind): Record<Group, number>` (spec §1's split).
  - `pickRecoverer(kind: LooseKind, forcer: Player | null, onField: Record<Group, Player[]>, u1: number, u2: number): Player`
    — the forcer when `u1 < FORCER_RECOVERS[kind]` and he forced it, else a group by `u2` over the split restricted to
    groups with men on the field, a man of it evenly (the fractional part of `u2` within the group).
  - `returnYards(group: Group, toGoal: number, u: number): number` — 0 for `u` in the group's "zero or less" share, else
    1–9, 10–19 or 20+ by the bands (uniform within the first two, `20 + exponential` in the last, its mean fitted in
    Task 7), capped at `toGoal`.

- [ ] **Step 1: Write the failing tests** in `looseBall.test.ts`:
  - `defenseRecovers('run', true)` 0.60, `('run', false)` 0.26, `('catch', false)` 0.21, `('scramble', false)` 0.38.
  - each `recovererGroup(kind)` sums to 1 (±1e-9); `recovererGroup('sack').DL` > `recovererGroup('catch').DL`.
  - `pickRecoverer` with `u1 = 0` and a forcer returns the forcer; with `forcer = null` never returns null; with
    `onField.LB = []` and `u2` inside the LB share returns a DB or DL man (Review Focus).
  - `returnYards('DB', 5, 0.999)` is 5 (capped at the goal: a touchdown); `returnYards('DB', 100, 1 - 0.12 / 2)` (the
    middle of the DB's 20+ band) is ≥ 20 and < 100;
    `returnYards('DL', 50, u) <= returnYards('DB', 50, u)` for u in 0.05…0.95 step 0.05; `returnYards(g, 50, 0.01)` is 0
    for every group.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/looseBall.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `looseBall.ts` with the spec's §1 numbers, each table commented with its NFL source line.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: the loose ball: who gets it, who's credited, how far").

### Task 3: The strip-sack's odds

**Files:**
- Modify: `src/engine/match/fumbleOdds.ts`, `src/engine/match/fumbleOdds.test.ts`

**Interfaces:**
- Produces:
  - `type RushSpot = 'edge' | 'interior'`; `rushSpot(position: Position): RushSpot` (EDGE, CB, S → edge; DT, LB → interior).
  - `interface SackFacts { down; toGo; trailingLate; leadingLate; weather; qb: { ballSecurity; energy; has(q) }; rusher: { spot: RushSpot; tackling; has(q) }; size: number }`.
  - `sackStripOdds(f: SackFacts): number`, clamped to [0.02, 0.3].
  - `forcedOdds(kind: ContactKind | 'sack')`: sack 0.92.

- [ ] **Step 1: Write the failing tests:** a typical sack (1st and 10, an edge rusher at `TYPICAL.tackling`, a QB at
  `PEER_SECURITY.QB`, energy 85, no habits, size 0, weather 1) sits on the early-down base; an interior rusher strips
  less than an edge one; up: lower QB ball security, energy 60, Pat-The-Rock, tackling 17, size 1.5, Thumper,
  Ball-Stripper, trailing late, weather 1.3; down: 3rd and 7, Arm Tackler; every case in [0.02, 0.3];
  `forcedOdds('sack')` 0.92; `rushSpot('EDGE')` edge, `rushSpot('DT')` interior.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/fumbleOdds.test.ts`. Expected: FAIL (not defined).
- [ ] **Step 3: Implement** with named terms: `STRIP_BASE` 0.138 (early downs, edge), `SPOT.interior` ln(8.0/14.0),
  `QB_SECURITY` (per point of ball security against `PEER_SECURITY.QB`), `PATS` ln 1.8, `TIRED` shared, the contact
  fumble's `TACKLING`, `SIZE`, `THUMPER`, `ARM`, `STRIPPER`, `STRIP_THIRD` ln(10.2/13.8), `STRIP_TRAILING`
  ln(15.9/13.8); 4th down and leading late zero. (Task 7 fits them.)
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: strip-sack odds from the rusher's spot, the hit, the quarterback and the down").

### Task 4: The engine routes every fumble through the loose ball

**Files:**
- Modify: `src/engine/match/gameSim.ts` (the fumble blocks in the run ~L3175, catch ~L3700, scramble ~L4145 and sack
  ~L3974–4027 paths; `fumbleRecoveredByDefense` removed)
- Test: `src/engine/match/fumble.engine.test.ts`, `src/engine/match/fumble.forced.test.ts`; new
  `src/engine/match/stripSack.test.ts`

**Interfaces:**
- Consumes: Task 2's `defenseRecovers`, `pickRecoverer`, `returnYards`; Task 3's `sackStripOdds`, `forcedOdds`, `rushSpot`.
- Produces:
  - `interface Recovery { lost: boolean; group?: Group; returnYds: number; td: boolean; forcerRecovered: boolean }`.
  - `ContactTap.recovery?: Recovery` (set when `fumbled`).
  - `interface StripTap { down; toGo; trailingLate; leadingLate; spot: RushSpot; qb: number; fumbled: boolean; forced?: boolean; recovery?: Recovery; facts: SackFacts }`;
    `SimOptions.stripTap?: (tap: StripTap) => void`.
  - `private loose(kind: LooseKind, forced: boolean, forcer: Player | null, def: Lineup, spot: number): { recoverer: Player; returnYds: number; recovery: Recovery } | null`
    — null when the offense keeps it; draws on the game's stream in a fixed order (recovery, then `u1`, `u2`, then the
    return) only as far as needed. `toGoal` for the return is `spot` (yards from the defense's goal line the way it runs).

- [ ] **Step 1: Write the failing tests:**
  - `stripSack.test.ts` (40 games, `stripTap` and `contactTap` collected): a strip tap per sack (count equals the
    logged sacks); every fumbled contact tap has `recovery`; the forcer recovering credits both `forcedFum` and `fumRec`
    to him; an unforced fumble credits no `forcedFum` and `recovery.forcerRecovered` false (Review Focus).
  - With `fumbleOdds` and `sackStripOdds` mocked to 1 (as `fumble.forced.test.ts` does): a sack inside the 3 recovered by
    the defense with spot ≤ 0 is a touchdown on the next score; one kept by the offense with spot ≤ 0 is a safety
    (Review Focus).
- [ ] **Step 2: Run** them. Expected: FAIL (`stripTap` absent, `recovery` undefined).
- [ ] **Step 3: Implement:** the strip roll (`sackStripOdds` with the sacker's `rushSpot`, `skill(qb, 'ballSecurity')`,
  `this.body(qb).energy`, `sizeEdge(sacker, 'contact', qb)`), forced by `forcedOdds('sack')`, an own fumble's text
  `GameSim.looseText('own', sacker)` before the recovery; `loose()` at all four sites in place of the flat rolls; the
  taps. The pocket's lost-strip path (`pocketFor` skipped when lost) unchanged.
- [ ] **Step 4: Run** `npx vitest run src/engine/match` and re-take what the reshuffle moves (the personnel hash, the
  re-sign snapshot, `ballPath` kinds), each re-take a ledger ruling naming the play it now draws. Expected: all PASS.
- [ ] **Step 5: Commit** ("Engine: every fumble through the loose ball; strip-sacks from their odds").

### Task 5: The checks

**Files:**
- Modify: `scripts/fumbles-core.ts`, `scripts/fumbles-core.test.ts`, `scripts/fumbles.ts`, `scripts/calibrate.ts`

**Interfaces:**
- Consumes: Task 1's tables; Task 4's `StripTap`, `ContactTap.recovery`.
- Produces: `tapStrip(t: FumbleTally, tap: StripTap)`, `judgeStrips(t): Line[]`, `judgeRecoveries(t): Line[]`
  (lost per 100 by play, the defense's share forced and own, the group split, the forcer's share, returns by group:
  mean, 20+, touchdown); `FumbleTally` grows `strips` and `recoveries`.

- [ ] **Step 1: Write the failing test** in `fumbles-core.test.ts`: a tally with 1,000 sacks at 12.4% judges
  `strip-sacks, all` in range; one at 20% judges it ✗; a recoveries tally under 500 NFL plays reports, not judges.
- [ ] **Step 2: Run** `npx vitest run scripts/fumbles-core.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement**, the NFL constants copied from Task 1's output; `fumbles.ts` and `calibrate.ts` tap and
  print them under "Fumbles on contact".
- [ ] **Step 4: Run** the test, then `npm run fumbles -- 3000` (✗ allowed until Task 7). Expected: test PASS; every new
  line printed.
- [ ] **Step 5: Commit** ("Checks: strip-sacks, recoveries and returns against nflverse").

### Task 6: The film reads a sack's own fumble

**Files:**
- Modify: `src/engine/field/fumble.ts` (if `fumbleIn` needs the sack's reason), `src/ui/stage/fumble.test.ts`

**Interfaces:**
- Consumes: Task 4's sack text (`SACKED by X for -N yards, puts it on the ground. FUMBLE, recovered by Y`).

- [ ] **Step 1: Write the failing tests:** `fumbleIn` reads `why: 'own'` from a sack's own-fumble text and `'hit'`
  (today's default) from an old save's `SACKED by X for -7 yards. FUMBLE, recovered by Y` (Review Focus); a real lost
  sack fumble from a league staged with the own text puts the recoverer at the ball at the end.
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/fumble.test.ts`. Expected: FAIL if the parse misses the reason;
  otherwise record that the parse already reads it (ledger) and keep the tests.
- [ ] **Step 3: Implement** the parse change, if any.
- [ ] **Step 4: Run** `npx vitest run src/ui/stage src/engine/field` and fix what the reshuffled games expose in the
  stager, each fix a ledger ruling. Expected: all PASS.
- [ ] **Step 5: Commit** ("Film: a sack's own fumble, and the reshuffled games").

### Task 7: Fit and hold the league

**Files:**
- Modify: `src/engine/match/fumbleOdds.ts` (strip constants), `src/engine/match/looseBall.ts` (the 20+ tail's mean),
  `docs/ATTRIBUTES.md` (audit)

- [ ] **Step 1: Fit offline** on weeks 1 and 10 of played seasons (a scratch recorder like 0.4.6's: `createLeague`,
  `playWeek` through the season, `simulateGame` with the taps at weeks 1 and 10), 120 seasons: the strip constants to
  the strip buckets and the spots; the 20+ tail's mean to each group's return mean and touchdown share. Then
  `npm run fumbles -- 3000`. Expected: 0 lines out.
- [ ] **Step 2: Hold the league:** `npm run sim -- 20` (no ✗), `npm run audit` (nothing under "Needs attention"; commit
  `docs/ATTRIBUTES.md`), `npx tsx scripts/check.ts endings`, `npm run weather` (its blizzard line sits at 0.629 of
  0.63: snow fumbles move it). Retune, never a check; the sim's totals win over the fast check's. `quirks --effects`
  (Pat-The-Rock still moves strip-sacks), `parity`, `film` and the 60-season `sim` are CI's (CLAUDE.md).
- [ ] **Step 3: Run** the full `npx vitest run` (alone: four parallel probes plus it ran the container out of memory in
  0.4.6). Expected: all PASS.
- [ ] **Step 4: Commit** ("Fumbles: recoveries and strip-sacks fitted to nflverse 2021–25").

### Task 8: Docs and version

**Files:**
- Modify: `docs/MVP.md`, `CLAUDE.md`, `src/ui/changelog.ts`, `package.json`, the spec's status line

- [ ] **Step 1:** `docs/MVP.md`: tick "Medium: fumble recoveries" with what it does and the fitted numbers (0.4.7);
  "Medium: a sack's yards and strip" to **Partial** (the strip done, the yards left). CLAUDE.md: `match/looseBall.ts`
  beside `match/fumbleOdds.ts`; `npm run fumbles` names strip-sacks and recoveries. A 0.4.7 changelog entry (a player's
  view: who falls on it, a safety picking it up and running, edge rushers stripping more). `package.json` 0.4.7. The
  spec's status: built (0.4.7).
- [ ] **Step 2: Run** `npm run typecheck`, `npx vitest run src/ui/ui.test.ts src/ui/changelog.test.ts`,
  `npm run format:check`. Expected: PASS.
- [ ] **Step 3: Commit** ("0.4.7: fumble recoveries and the strip-sack"), push, open the PR.
