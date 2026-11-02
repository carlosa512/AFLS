# GMs Plan Next Year Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A GM borrows into next year only after counting next year's own needs, and how much he commits early reads
whether his club contends or rebuilds, so clubs stop tightening every season.

**Architecture:** Both pieces live in `restructureRoom` (`offseason/ai.ts`), the one step make-room and cap compliance
share: its next-year room subtracts `nextYearNeeds`, and its ceiling becomes `nextYearCeiling(gm, winNow)`. The offseason
check gains the share of clubs restructuring a season.

**Tech Stack:** TypeScript, Vitest, tsx scripts (`npm run offseason`, `npm run careers`).

**Spec:** `docs/superpowers/specs/2026-11-01-front-offices-design.md`, section *GMs plan next year before they borrow*.

## Global Constraints

- Same branch and PR as parity (`claude/gallant-ramanujan-rzydgt-engine`); no PR until careers and offseason are green
  and the owner agrees. Never force push. Vitest with `--maxWorkers=2`.
- Logic, not rules: nothing barred; a rebuilder still borrows a little for a keeper he needs.
- Next year's needs: planned keepers whose deals end after this league year (`inPlans`, `lastSeason(c) === season`) at
  their market price; next year's draft class (the picks the club owns for `season + 1`); the in-season cushion at next
  year's cap (`IN_SEASON_RESERVE`).
- Check: clubs restructuring anyone a season, judged 40–70% (Over the Cap: about 55%). Dead money, starters out of
  football (2.5–4.5), tags (4–10), cap space as before; careers as before.
- No range moves. A line that can't be met: stop and tell the owner. `npm run format`, commit and push each task.

## Review Focus

1. **A club over the cap whose needs leave no next-year room:** compliance must still get it under (cuts, then the
   last-resort restructure) → Task 1's test that compliance stays legal when needs fill next year.
2. **Counting a keeper twice:** a player re-signed in this window is in next year's books already; needs count only deals
   that end after this league year → Task 1's test that a player signed past next year isn't a need.
3. **Next year's picks traded away or acquired:** needs read the picks the club owns for next season, not this year's →
   Task 1's test.
4. **The user's club:** needs and the ceiling run only in AI paths (`aiResignWindow`, `aiCapCompliance`) → no screen reads
   them; Task 4's suite run.
5. **A rebuilder that must get under the cap:** the rebuild caution narrows borrowing for room, never the law → Task 2's
   test that a rebuilding club over the cap still ends legal.

---

### Task 1: Plan next year first

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`nextYearNeeds`, used in `restructureRoom`)
- Test: `src/engine/offseason/makeRoom.test.ts`

**Interfaces:**
- Produces: `export function nextYearNeeds(league: League, team: Team): number` ($K): Σ `marketApy` of the club's players
  with `lastSeason(contract) === league.season` and `inPlans`; + the rookie hits of its `season + 1` picks
  (`rookieContract(overall ?? (round - 1) * 32 + 16, season + 1, capFor(league, season + 1))`); +
  `capFor(league, season + 1) * IN_SEASON_RESERVE * (1.5 - gm.capAggression)`.
- `restructureRoom`'s next-year room: `ceiling * nextCap - nextYear.used - nextYearNeeds(league, team)`, needs computed
  once per call.

- [ ] **Step 1: Write the failing tests** (in `makeRoom.test.ts`, a `describe('GMs plan next year first')`):
  - `counts next year's planned keepers, next year's draft class and the cushion` — on the `window` league, an AI club:
    `nextYearNeeds` ≥ the market price of each of its `inPlans` players whose deal ends this league year; adding a
    `season + 1` pick to the club raises it; a player whose deal runs past next year adds nothing.
  - `makes no room it would owe next year's keepers` — `squeezed(0, 1)`, then next year's dead money set so next year's
    books plus `nextYearNeeds` sit at the ceiling: after `aiResignWindow`, no restructure transactions for the club.
  - `stays legal when next year's needs leave no room` — the same club pushed 3% of the cap over: after
    `aiCapCompliance`, `capSpace >= 0`.
- [ ] **Step 2:** `npx vitest run src/engine/offseason/makeRoom.test.ts --maxWorkers=2` → the first fails (no
  `nextYearNeeds`), the second fails (restructures > 0), the third passes.
- [ ] **Step 3: Implement** `nextYearNeeds` and use it in `restructureRoom`. Comment: next year's own keepers, draft class
  and cushion come first; borrowing without them snowballed (86 → 167 restructures for keepers in seasons 1–4).
- [ ] **Step 4:** the file → PASS; `npx vitest run src/engine/offseason --maxWorkers=2` (pins only fail; re-take the
  re-sign window pin, named in the commit).
- [ ] **Step 5:** commit and push `"Re-sign window: a GM counts next year's keepers, draft class and cushion before he borrows"`.

---

### Task 2: Contend or rebuild

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`nextYearCeiling`, `REBUILD_CAUTION`, `winNow` exported)
- Test: `src/engine/offseason/frontOffice.test.ts`, `src/engine/offseason/makeRoom.test.ts`

**Interfaces:**
- Consumes: Task 1's `restructureRoom`.
- Produces: `export const REBUILD_CAUTION = 0.1` (a starting value Task 3 sizes);
  `export const nextYearCeiling = (gm: Pick<GmTraits, 'capAggression'>, winNow: number) => NEXT_YEAR_CEILING - 0.07 * (1 - gm.capAggression) - REBUILD_CAUTION * (1 - winNow)`;
  `export const winNow` (unchanged body). `restructureRoom` passes `winNow(league, team)`.

- [ ] **Step 1: Write the failing tests:**
  - `frontOffice.test.ts`, the ceiling block: `nextYearCeiling({ capAggression: 1 }, 1)` is `NEXT_YEAR_CEILING`;
    `nextYearCeiling(gm, 0) < nextYearCeiling(gm, 1)` for the same GM.
  - `makeRoom.test.ts`: `a rebuilding club borrows less of next year than a contender` — two `squeezed(-0.6, 1)` copies,
    the club's `gm.winNow` set to 0 and to 1: next year's books after `aiResignWindow` are lower for the rebuilder.
  - `makeRoom.test.ts`: `a rebuilding club over the cap still gets under it` — `gm.winNow = 0`, 3% over: after
    `aiCapCompliance`, `capSpace >= 0`.
  - Update `never restructures next year's books past their ceiling` to read `nextYearCeiling(team.gm, winNow(l, team))`.
- [ ] **Step 2:** run both files → the ceiling and rebuilder tests fail.
- [ ] **Step 3: Implement.** Comment on `REBUILD_CAUTION`: a club playing for later keeps next year's room (unused cap
  carries over); 78% of NFL playoff teams restructure, about 45% of all clubs restructure nobody in a year (Over the Cap).
- [ ] **Step 4:** both files → PASS; `npx vitest run src/engine/offseason --maxWorkers=2`.
- [ ] **Step 5:** commit and push `"Re-sign window: contenders borrow, rebuilders keep next year's room"`.

---

### Task 3: The check, sized and measured

**Files:**
- Modify: `scripts/offseason.ts` (clubs restructuring a season)
- Modify: `src/engine/offseason/ai.ts` (`REBUILD_CAUTION` value only, if Step 2 says so)

- [ ] **Step 1: Clubs restructuring.** In the season loop, the share of the 32 clubs with a `restructure` transaction this
  league year: `check('clubs restructuring %', pct, 40, 70, 0)` on the cap line, citing Over the Cap (about 55%; 37% a
  major one).
- [ ] **Step 2: Measure.** `npm run offseason -- 6`, then `npm run careers` (one at a time: run together on four cores
  careers took over an hour). If clubs restructuring reads outside 40–70, move `REBUILD_CAUTION` by 0.05 toward the band
  and re-run; at most two moves.
- [ ] **Step 3: Read everything.** Offseason: clubs restructuring 40–70%, starters out of football 2.5–4.5% every
  season, dead money median ≤ 6 and max ≤ 30, tags 4–10, cap, rosters and the free-agent pool in range; restructures a
  season no longer climbing. Careers: tree lines, highest starter overall ≤ 13.2, record carryover (three seasons, aim
  positive). A line out: stop and report.
- [ ] **Step 4:** commit and push `"Offseason check: clubs restructuring a season, judged 40-70% (Over the Cap)"` with
  the measured lines in the message.

---

### Task 3b: Restructure to sign a free agent; the cushion counted once (owner's call after Task 3's measure)

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiFreeAgencyDay`, `nextYearNeeds`)
- Test: `src/engine/offseason/frontOffice.test.ts`, `src/engine/offseason/makeRoom.test.ts`

**Interfaces:**
- Consumes: Task 1's `restructureRoom(league, team, need)` and `nextYearNeeds`.
- Produces: in `aiFreeAgencyDay`, a club that can't fit a wanted free agent's market deal carries `room` (the year-one
  charge less its budget) when its planned starters' restructures could cover it; when he chooses that club, it calls
  `restructureRoom(league, team, room)` and signs the market deal if the room was made, else the fitted deal if valid,
  else nothing. `nextYearNeeds` drops the in-season cushion.

- [ ] **Step 1: Write the failing tests:**
  - `frontOffice.test.ts`: `restructures a planned starter to sign a free agent it can't fit` — `lateVeteran(club, 0.5)`
    with next year's room (−20% of next year's cap as dead money): after `aiFreeAgencyDay`, he's on the club on a deal
    longer than one year, and the club has a restructure transaction this league year.
  - `frontOffice.test.ts`: `makes no room for a free agent when next year's needs fill next year` — next year's books
    plus `nextYearNeeds` at the ceiling: no restructure transaction.
  - `makeRoom.test.ts`: the needs test no longer expects the cushion (needs = keepers + next year's draft class).
- [ ] **Step 2:** run → the first and the needs test fail.
- [ ] **Step 3: Implement.** Comment: the NFL's March restructures are mostly room for free agency.
- [ ] **Step 4:** both files → PASS; `npx vitest run src/engine/offseason --maxWorkers=2` (re-take the re-sign pin if it
  moves).
- [ ] **Step 5:** commit and push; then Task 3's Steps 2–4 again (measure, size `REBUILD_CAUTION`, read everything).

---

### Task 4: Finish the front-office work

**Files:**
- Modify: played-league pins; `src/ui/changelog.ts`; `docs/MVP.md`; `docs/ATTRIBUTES.md` (regenerated)

- [ ] **Step 1: Engine suite.** `npx vitest run src/engine --maxWorkers=2`; re-take only played-league pins, named in the
  commit.
- [ ] **Step 2: Notes.** The 0.2.27 changelog gains: "Front offices act like real ones: they plan next year's cap before
  they borrow, contenders spend and rebuilders save, they tag the star they'd lose, and good veterans find a club by
  camp." `docs/MVP.md`'s follow-up: what changed and what's left (owners' spending; contenders selling stars; the trade
  market's dead money).
- [ ] **Step 3:** `npm run audit` (regenerates `docs/ATTRIBUTES.md`; nothing under "Needs attention").
- [ ] **Step 4:** commit and push; then the final whole-branch review (fresh reviewer on the most capable model) for the
  front-office and plan-next-year work.
