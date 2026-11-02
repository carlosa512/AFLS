# The Late Free-Agency Market Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Good free agents find a club: a club that wants a player but can't fit his market price offers a one-year
deal at the room it has, and the AI keeps shopping on draft day and as camp opens.

**Architecture:** One pure helper (`fitOffer`) turns a market-priced offer into the one-year deal a club can fit;
`aiFreeAgencyDay` falls back to it at the budget gate and takes a roster-limit override; the offseason calendar calls
it twice more in the draft step. The offseason check judges how many starters fall out of football; careers reports
how records carry over.

**Tech Stack:** TypeScript, Vitest, tsx scripts (`npm run offseason`, `npm run careers`).

**Spec:** `docs/superpowers/specs/2026-10-31-late-market-design.md`

## Global Constraints

- Same branch as parity (`claude/gallant-ramanujan-rzydgt-engine`), same PR. Never force push.
- Vitest with `--maxWorkers=2`. Never loosen a range; if one can't be met, stop and tell the owner.
- A player never signs below his walk-away price (`demand(...).walkAway`): the fitted deal is still his choice.
- Asks, walk-aways, the re-sign window, tags, cap rules, in-season signings and your own free-agency screens are
  untouched. The user's club signs in a late pass only when its staff runs it (`auto`, as on free-agency days).
- New judged line: starters out of football at kickoff (unsigned or retired), share of last kickoff's starters,
  **4–7%** (nflverse 2021–24: 4.7–6.2%). Reported: record carryover at one and three seasons (NFL 0.34 and 0.18).
- `npm run format` before every commit; push after every commit.

## Review Focus

1. **Camp rosters:** in preseason `rosterLimit` reads 53, so a camp pass with rosters of 80+ would sign nobody, or with
   the override past the 90 → Task 2's test that a late pass never takes a club past `OFFSEASON_ROSTER_MAX`.
2. **Cut-down after a late signing:** a club that spends its room on draft day must still fill 53 and stay under the
   cap at cut-down. `spendable` already holds back the fill, rookie and in-season reserves → Task 3 reads the
   offseason check's "under 53 with cap room", "over cap" and cap-space lines.
3. **The free-agent pool check** (`free agents` 100–650 at kickoff) falls as more sign → Task 3 reads it; below 100 is a
   finding to report, not a range to move.
4. **A fitted deal below his walk-away** must not sign him → Task 1's test.
5. **Your club** in a late pass when you run your own front office → Task 2's test that it signs nobody for you.

---

### Task 1: A club offers what it can fit

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`fitOffer`; the budget gate in `aiFreeAgencyDay`)
- Test: `src/engine/offseason/lateMarket.test.ts` (new)

**Interfaces:**
- Produces: `export function fitOffer(offer: Offer, budget: number, min: number): Offer | null` — `null` when
  `budget < min`; otherwise `{ years: 1, apy: Math.floor(Math.min(offer.apy, budget)), bonusPct: 0,
  gtdPct: offer.gtdPct, voidYears: 0 }`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the late market: a club offers what it can fit', () => {
  const offer = { years: 4, apy: 9_000, bonusPct: 0.3, gtdPct: 0.5, voidYears: 1 };
  it('turns a deal it can’t fit into one year at the room it has', () => {
    expect(fitOffer(offer, 5_200.7, 1_100)).toEqual({ years: 1, apy: 5_200, bonusPct: 0, gtdPct: 0.5, voidYears: 0 });
  });
  it('never offers more than the market deal, nor below the minimum', () => {
    expect(fitOffer(offer, 20_000, 1_100)!.apy).toBe(9_000);
    expect(fitOffer(offer, 900, 1_100)).toBeNull();
  });
  it('signs a wanted free agent on the room left when it beats his walk-away, and not when it doesn’t', () => {
    // A league at free agency's last day; one starter-quality free agent; every AI club but one with no room and
    // the one with room under his market but over his walk-away (then, in a copy, under it).
    // aiFreeAgencyDay signs him to that club on a one-year deal in the first case and leaves him unsigned in the second.
  });
});
```

  For the third test build the case explicitly: `createLeague`, `beginOffseason`, advance to `freeAgency` with
  `faDay = FA_DAYS`; pick the best free agent by `playerOvr` at a position where one club's depth is thin; set the
  other clubs' budgets out of reach by adding dead money for this season (`team.deadMoney.push({ season, amount,
  note: 'test' })`) and the chosen club's so its `spendable` sits between his walk-away and market.

- [ ] **Step 2:** `npx vitest run src/engine/offseason/lateMarket.test.ts --maxWorkers=2` → FAIL (`fitOffer` missing).
- [ ] **Step 3: Implement.** `fitOffer` as above; in `aiFreeAgencyDay`, where `yearOne > budget` skips a club, try
  `fitOffer(offer, budget.get(team.id)!, minSalary(p.experience, league.caps[league.season]))` instead, re-check
  `gain < upgradeBar(league, team, fitted.apy)`, and carry the fitted offer on as the club's offer (a one-year deal
  passes the next-year books check by its own rule). Comment why: the NFL's late market, a prove-it deal with whoever
  has room; the walk-away check after it is unchanged.
- [ ] **Step 4:** the same run → PASS; then `npx vitest run src/engine/offseason --maxWorkers=2` (failures only in
  played-league pins, re-taken in Task 3).
- [ ] **Step 5: Commit and push:** `"Free agency: a club offers what it can fit (a one-year deal at the room it has)"`.

---

### Task 2: The market runs past day 5

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiFreeAgencyDay` option `rosterMax?: number`)
- Modify: `src/engine/offseason/index.ts:357-366` (the draft step)
- Test: `src/engine/offseason/lateMarket.test.ts`

**Interfaces:**
- Consumes: Task 1's fitted offer inside `aiFreeAgencyDay`.
- Produces: `aiFreeAgencyDay(league, rng, opts: { includeUser?: boolean; rosterMax?: number } = {})`; room is
  `(opts.rosterMax ?? rosterLimit(league)) - activeRoster(...)`.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the late market runs past day 5', () => {
  it('signs most of the starter-quality free agents left after day 5 by the time camp opens', () => {
    // A league through one season, offseason to the end of free agency (phase 'draft'): count free agents with
    // playerOvr >= 12 and age <= 31 (left). Advance the draft step; count again (after). Expect after <= 0.6 * left.
  });
  it('never takes a club past the 90', () => {
    // After the draft step: every AI club's activeRoster length <= OFFSEASON_ROSTER_MAX.
  });
  it('signs nobody for a club whose front office you run', () => {
    // With the user employed and autoUser false: the user club's roster is the same set of ids before and after
    // the draft step, draft picks aside.
  });
});
```

- [ ] **Step 2:** run the file → the first test FAILS (no late passes yet).
- [ ] **Step 3: Implement.** In the draft step, after `finishDraft(league)` and before the phase turns: a pass at the
  draft's pressure, `aiFreeAgencyDay(league, rng, { includeUser: auto })`; after `league.phase = 'preseason'`, the camp
  pass, `aiFreeAgencyDay(league, rng, { includeUser: auto, rosterMax: OFFSEASON_ROSTER_MAX })` (camp still carries
  90; `rosterLimit` reads 53 in preseason for cut-down). Comment each with the NFL's moment: veterans signing after the
  draft, and the last ones as camp opens.
- [ ] **Step 4:** run the file → PASS.
- [ ] **Step 5: Commit and push:** `"Free agency: the market runs past day 5 (draft day and as camp opens)"`.

---

### Task 3: The checks, measured

**Files:**
- Modify: `scripts/offseason.ts` (the judged out-of-football share), `scripts/careers-league.ts`, `scripts/careers.ts`
  (record carryover, reported)
- Modify: played-league pins the engine suite names

- [ ] **Step 1: The offseason line.** At each kickoff after the first, the share of the previous kickoff's starters
  (every team's depth-chart starters) now unsigned or retired: `check('starters out of football %', share, 4, 7, 1)`
  on the roster line, with a comment citing nflverse 2021–24 (4.7–6.2%).
- [ ] **Step 2: Careers.** `LeagueRun` keeps each season's win% by team (`records: number[][]`); `careers.ts` prints
  `record carryover: 1 season 0.xx, 3 seasons 0.xx (NFL 0.34 and 0.18; reported)`.
- [ ] **Step 3: Measure.** `npm run offseason -- 6` and `npm run careers` (background). Expected: out of football
  4–7%; carryover at three seasons above 0.10; the five tree lines in their bands; every other line in range,
  free agents at kickoff and cap space included (Review Focus 2–3). A line out: stop and report.
- [ ] **Step 4: Engine suite.** `npx vitest run src/engine --maxWorkers=2`; re-take only pins of played leagues, named
  in the commit; a behaviour test that fails is a finding.
- [ ] **Step 5: Notes and push.** Changelog 0.2.27's text gains "Good free agents no longer sit unsigned: clubs
  offer what they can fit, and the market runs into camp." `docs/MVP.md` follow-up on coaching trees: what changed.
  Commit and push: `"Checks: starters out of football judged; record carryover reported"`.
