# Cap Hoarding and Dead Money Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI front offices stop hoarding cap in the first seasons and stop booking huge dead money, and the trade market keeps NFL volume once the opening league stops being artificially roomy.

**Architecture:** The opening league is generated in the shape a settled league already has (contract lengths by tier, payrolls at 90-99% of the cap), signing bonuses are capped at a share set by the GM's cap style, and last season's full replays are trimmed at the new league year to keep the save under its ceiling. The trade market's in-season volume, which on main passes only because year one is roomy, is diagnosed and fixed at its cause.

**Tech Stack:** TypeScript engine (`src/engine/`), Vitest, `tsx` audit scripts (`scripts/offseason.ts`, `scripts/trades.ts`).

**Spec:** `docs/superpowers/specs/2026-10-20-cap-hoarding.md`

**Branch:** `claude/cap-hoarding` (worktree `.claude/worktrees/cap`). Tasks 1-4's code is already on the branch in WIP commit `761f6f2`; those tasks add the tests that pin it and amend nothing unless a test fails.

## Global Constraints

- Never loosen a band in `scripts/*.ts`; where the generation change moves a baseline, update the band's comment (observed values), not its range.
- Bump `SAVE_VERSION` only if `League`'s shape changes (no task here changes it).
- Steer with `npm run offseason -- 6` and `npm run trades`; never run `npm run check` locally; CI decides.
- No `Math.random`: all randomness through the seeded `Rng`.
- Salaries are in thousands of dollars; dollar bands are shares of that year's cap.
- `npm run format` before each commit; commit messages end with the session's attribution lines.
- The PR bumps `package.json` with `npm version patch --no-git-tag-version` (a fix, per `docs/VERSIONING.md`).

## Review Focus

- A roster whose veterans all sit at the minimum: the front-load has nothing to scale and must leave payroll as is, not divide by zero (Task 2 test).
- A fourth-year veteran (experience 4): his deal can't have started before his rookie deal ended, so it starts this season and still has 1-5 real years (Task 1 test).
- An offer with no guarantee: the bonus share must be 0, not the cap (Task 3 test).
- A save loaded mid-offseason: the trim must not touch the season being played or the new schedule (Task 4 test).
- A front-loaded veteran in the offseason: he can still be restructured (Task 2 test), the spec's "check restructure room still works".

---

### Task 1: Opening contracts look like a settled league

**Files:**
- Modify: `src/engine/generate.ts` (`initialContract`, already in `761f6f2`)
- Test: `src/engine/finance/finance.test.ts` (new `describe('opening league')`)

**Interfaces:**
- Consumes: `createLeague({ seed })`, `yearsLeft(c, season)`, `playerOvr(p)`
- Produces: nothing new; the shape of generated veteran contracts

- [ ] **Step 1: Write the tests**

```ts
describe('opening league', () => {
  const seeds = ['opening-a', 'opening-b', 'opening-c'];
  it('starts a quarter of its 14+ veterans in their last year, as a settled league does', () => {
    const last = seeds.map((seed) => {
      const league = createLeague({ seed });
      const stars = Object.values(league.players).filter(
        (p) => p.teamId !== null && p.contract?.kind !== 'rookie' && p.experience >= 4 && playerOvr(p) >= 14,
      );
      return stars.filter((p) => yearsLeft(p.contract!, league.season) === 1).length / stars.length;
    });
    const mean = last.reduce((a, b) => a + b, 0) / last.length;
    expect(mean).toBeGreaterThan(0.18);
    expect(mean).toBeLessThan(0.36);
  });

  it('gives every veteran 1-5 real years and no fourth-year veteran a deal from before his rookie one ended', () => {
    const league = createLeague({ seed: 'opening-a' });
    for (const p of Object.values(league.players)) {
      if (p.teamId === null || p.contract?.kind === 'rookie' || p.experience < 4) continue;
      const left = yearsLeft(p.contract!, league.season);
      expect(left).toBeGreaterThanOrEqual(1);
      expect(left).toBeLessThanOrEqual(5);
      if (p.experience === 4) expect(p.contract!.signedSeason).toBe(league.season);
    }
  });
});
```

- [ ] **Step 2: Run them**

Run: `npx vitest run src/engine/finance/finance.test.ts -t "opening league"`
Expected: PASS (the code is on the branch). On the base before `761f6f2` the first test fails (0 stars in their last year).

- [ ] **Step 3: Commit**

```bash
git add src/engine/finance/finance.test.ts
git commit -m "Tests: the opening league's contracts look like a settled league's"
```

### Task 2: Opening payrolls at 90-99% of the cap, front-loaded where the roster can't reach it

**Files:**
- Modify: `src/engine/generate.ts` (`fitPayroll` front-load and the `rng.float(0.9, 0.99)` target, already in `761f6f2`)
- Test: `src/engine/finance/finance.test.ts` (same `describe('opening league')`)

**Interfaces:**
- Consumes: `capSheet(league, teamId)`, `restructurePlayer(league, player)`, `teamPlayers(league, teamId)`
- Produces: nothing new

- [ ] **Step 1: Write the tests**

```ts
it('opens every team at 85-99% of the cap, the weakest roster included', () => {
  for (const seed of seeds) {
    const league = createLeague({ seed });
    for (const t of league.teams) {
      const used = capSheet(league, t.id).used / league.caps[league.season];
      expect(used).toBeGreaterThanOrEqual(0.85);
      expect(used).toBeLessThanOrEqual(0.99);
    }
  }
});

it('can still restructure a front-loaded veteran in the offseason', () => {
  const league = createLeague({ seed: 'opening-a' });
  league.phase = 'resign';
  const vet = teamPlayers(league, league.teams[0].id)
    .filter((p) => p.contract?.kind === 'veteran' && p.contract.years.length >= 2)
    .sort((a, b) => b.contract!.apy - a.contract!.apy)[0];
  expect(restructurePlayer(league, vet)).toBeGreaterThan(0);
});
```

Add a unit test of the guard: export `fitPayroll` from `generate.ts` (it is module-private today) and call it on a roster of minimum-salary veterans with a target above their payroll; expect every base unchanged.

- [ ] **Step 2: Run them**

Run: `npx vitest run src/engine/finance/finance.test.ts -t "opening league"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engine/finance/finance.test.ts src/engine/generate.ts
git commit -m "Tests: opening payrolls reach 85-99% of the cap and front-loaded deals still restructure"
```

### Task 3: Signing bonuses capped by cap style

**Files:**
- Modify: `src/engine/finance/market.ts` (`maxBonusShare`), `src/engine/offseason/ai.ts` (`aiOffer`), `src/engine/generate.ts` (`veteranContract`), all already in `761f6f2`
- Test: `src/engine/finance/finance.test.ts` (`describe('market')`)

**Interfaces:**
- Produces: `maxBonusShare(capAggression: number): number` = `0.2 + 0.15 * capAggression` in `finance/market.ts`

- [ ] **Step 1: Write the tests**

```ts
it('caps the signing bonus at 20-35% of a deal by the GM's cap style', () => {
  expect(maxBonusShare(0)).toBeCloseTo(0.2);
  expect(maxBonusShare(1)).toBeCloseTo(0.35);
  const league = createLeague({ seed: 'bonus' });
  for (const p of Object.values(league.players)) {
    const c = p.contract;
    if (!c || c.kind !== 'veteran' || p.teamId === null) continue;
    const signing = c.bonuses.filter((b) => b.source === 'signing').reduce((s, b) => s + b.amount, 0);
    expect(signing).toBeLessThanOrEqual(c.apy * c.length * maxBonusShare(league.teams[p.teamId].gm.capAggression) * 1.6 + 1);
  }
});
```

The 1.6 headroom covers `fitPayroll`'s market nudge (up to 1.5x on bonuses) on top of the share; the share itself is what the test pins. Also add, in `src/engine/offseason/offseason.test.ts`, an `aiOffer` case for a 0.9-cap-aggression team: `bonusPct <= maxBonusShare(0.9)` and, for a player whose `askGtdPct` is 0, `bonusPct === 0`.

- [ ] **Step 2: Run them**

Run: `npx vitest run src/engine/finance/finance.test.ts src/engine/offseason/offseason.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engine/finance/finance.test.ts src/engine/offseason/offseason.test.ts
git commit -m "Tests: signing bonuses stay inside 20-35% of a deal"
```

### Task 4: Last season's replays trimmed at the new league year

**Files:**
- Modify: `src/engine/offseason/index.ts` (`beginOffseason`), `src/engine/league.ts` (comment), already in `761f6f2`
- Test: `src/engine/offseason/offseason.test.ts` (`describe('offseason calendar')`)

- [ ] **Step 1: Write the test**

```ts
it("keeps last season's box scores and scoring plays and drops their full replays", () => {
  const league = createLeague({ seed: 'replays' });
  simToEndOfSeason(league);
  const mine = league.games.find((g) => g.homeId === league.userTeamId && g.result)!;
  expect(mine.result!.plays!.some((p) => !p.scoring)).toBe(true);
  beginOffseason(league);
  const last = league.games.filter((g) => g.season === league.season - 1);
  expect(last.length).toBeGreaterThan(0);
  for (const g of last) expect(g.result?.plays?.every((p) => p.scoring) ?? true).toBe(true);
  expect(mine.result!.home).toBeDefined();
  expect(league.games.some((g) => g.season === league.season && !g.result)).toBe(true);
});
```

- [ ] **Step 2: Run it**

Run: `npx vitest run src/engine/offseason/offseason.test.ts -t "replays"`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/engine/offseason/offseason.test.ts
git commit -m "Tests: a new league year trims last season's replays, keeps its box scores"
```

### Task 5: Find what holds a settled league's in-season trades under 15

The trade audit's in-season volume is 18.3 / 13.7 / 14.0 by year on main (mean 15.3, band 15-25): years two and three, a settled league, are under the band, and year one's room (up to 38% unspent) carries the mean. With Tasks 1-2 year one is settled too, and the mean falls to 14.1; PR #67 fails the same check (19.7 / 10.3 / 11.7). This task measures the cause; it changes no engine behavior.

**Files:**
- Temporary, not committed: counters in `src/engine/trade/market.ts` (`marketMoment`, `initiate`) and `src/engine/trade/deals.ts` (`dealFor`)
- Output: a findings section appended to the spec

- [ ] **Step 1: Add counters for in-season moments (`league.phase === 'regular'`)**, keyed by season of the run: calls that pass the `p` roll; buyer calls with no `targets`; seller calls with no `buyers`; `dealFor` returning null because `keepToFit` is null (salary won't fit even with retention); `dealFor` returning null from the price search; `close` returning null; deals made. Also count buyers, sellers and holds from `stanceOf` at weeks 1 and 9.

- [ ] **Step 2: Run** `npm run trades -- 9` on main (scratch worktree) and on this branch, and record each counter for years 2-3.

- [ ] **Step 3: Decide**, and write the numbers and the decision into the spec:
  - **Cap-bound** if salary-fit nulls are at least 40% of failed `dealFor` calls: Task 6a.
  - **Stance-bound** if calls with no targets or no buyers are at least 60% of the calls that passed the roll: Task 6b.
  - **Neither:** stop and report the counters to the project owner before writing a fix.

- [ ] **Step 4: Remove the counters** (`git diff src/engine/trade` must be empty) and commit the spec update.

### Task 6a (if cap-bound): AI front offices carry an in-season reserve

**Files:**
- Modify: `src/engine/offseason/ai.ts`
- Test: `src/engine/offseason/offseason.test.ts`

**Interfaces:**
- Produces: `IN_SEASON_RESERVE` (share of the cap) exported from `offseason/ai.ts`; `aiTrainingCamp` keeps `IN_SEASON_RESERVE * cap` unspent after its top-up, except where the roster needs it to reach 53

- [ ] **Step 1: Test:** after `advanceOffseason(league, { autoUser: true })` to `regular` on a generated league, the median AI team's `capSheet(...).space` is at least `IN_SEASON_RESERVE * cap`, and every AI roster still has 53.
- [ ] **Step 2: Implement** with `IN_SEASON_RESERVE = 0.03`, comment quoting the NFL figure from the spec (Week 1 room; carryover average 4.1% of the cap, median 2.3%, 2025).
- [ ] **Step 3: Steer:** `npm run trades` (3 leagues): in-season 15-25 with years 2-3 each at least 15, deadline star price 1000-3500, every other line in band; `npm run offseason -- 6`: 0 outside range.
- [ ] **Step 4: Commit.**

### Task 6b (if stance-bound): enough sellers at the deadline

**Files:**
- Modify: `src/engine/trade/plans.ts` (stance thresholds) or `src/engine/trade/market.ts` (`TRADE_VOLUME = 0.28`); Task 5's counters say which
- Test: `src/engine/trade/market.test.ts`

- [ ] **Step 1: Test:** in a settled league (the trades audit's second season), at week 9 at least one AI team in six is a seller.
- [ ] **Step 2: Implement** the smallest change the counters point to, with a comment quoting the measured before and after.
- [ ] **Step 3: Steer:** as Task 6a step 3.
- [ ] **Step 4: Commit.**

### Task 7: Audit bands and baselines

**Files:**
- Modify: `scripts/offseason.ts` (the `ISSUE_HOARDING` warning and the comments quoting observed values)

- [ ] **Step 1: Make early hoarding a judged band:** seasons 1-3's max space at kickoff is `check('max space %cap', ..., 0, 30, 1)` (seasons 4+ keep their `0-20`), and delete `ISSUE_HOARDING` and its comment. This tightens CI; it loosens nothing.
- [ ] **Step 2: Update the baseline comments** the generation change moved (early space 38-59% → the new values; dead money max; median space), quoting `npm run offseason -- 6`.
- [ ] **Step 3: Run** `npm run offseason -- 6`: 0 outside range, no hoarding line, save size under 13,500 KB in every season. `npm run sim -- 10`: 0 outside range (the generation change reaches the calibration leagues).
- [ ] **Step 4: Check dead money at every step, not just kickoff:** from the worktree root run `npx tsx /tmp/claude-0/-home-user-AFLS/6a25ac40-f6eb-5ff6-9e39-7f3bb2d33fdd/scratchpad/cap/cap-diag.ts 6` (a scratch diagnostic, not in the repo, which takes the worst team's dead money after each `advanceOffseason` step) and record the worst in the spec; it must stay at or under 30% of the cap (the spec's "no team should pass 30% even on that path"). The kickoff band (`dead max %cap`, 0-30) already judges kickoff.
- [ ] **Step 5: Commit.**

### Task 8: PR, and PR #67

- [ ] **Step 1:** `npm version patch --no-git-tag-version`, `npm run format`, `npm run typecheck`, the touched test files; commit; push; open the PR from `claude/cap-hoarding` (template `.github/pull_request_template.md`); subscribe to its activity.
- [ ] **Step 2: PR #67:** cherry-pick Task 6a's or 6b's commit onto `claude/busy-mendel-akwkqe`, run `npm run trades` there (in-season 15-25, years 2-3 each at least 15), push, and leave one comment on carlosa512/AFLS#67 naming the check, the cause from Task 5, and the ported commit. If #67 is still under 15 with the fix, its own change is the cause: diagnose it there with Task 5's counters.
- [ ] **Step 3:** Watch both PRs to green; whichever merges second merges main and bumps the patch version again.
