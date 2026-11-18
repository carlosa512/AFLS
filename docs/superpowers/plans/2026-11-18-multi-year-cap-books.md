# Multi-year Cap Books Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI GMs keep three years of cap books, and every way they commit money reads them, so cap room stops draining
by a league's fifth season.

**Architecture:** A new pure module `src/engine/offseason/capBooks.ts` computes, per AI club, the next three league
years' projected cap, committed money, needs and room. Restructures, offers (free agency, re-sign window, extensions,
disputes, camp signings) and tags read it. A probe script and new drift lines in the offseason check measure it over 10
seasons.

**Tech Stack:** TypeScript, Vitest, tsx scripts (repo conventions in `CLAUDE.md`).

**Spec:** `docs/superpowers/specs/2026-11-18-multi-year-cap-books-design.md`

## Global Constraints

- Pure engine code: no `Math.random`, no new draws on any stream; the books are computed, never stored (no
  `SAVE_VERSION` bump, no `migrate.ts` change).
- Projected cap for a future year is `capFor(league, y)`; no separate growth constant.
- Horizon `BOOKS.horizon = 3` (years `s+1`, `s+2`, `s+3`); money a deal or restructure adds past `s+3` counts on `s+3`.
- Limit for year `s+k`: `capFor(y) × (nextYearCeiling(gm, winNow) − BOOKS.fade × (k − 1))`, `BOOKS.fade` starting at
  `0.03`. Soft limit (keepers the plan judges worth it, tags, disputes the club settles): no fade.
- Hard limit: free agents, early extensions, arrival extensions, camp starter signings.
- `SPEND_FIRST.fillShare = 1` (early free agency never spends the fill money); `SPEND_FIRST.days` stays 2.
- Bands (the owner, 2026-11-18), warn / fail: kickoff room each season 4–10 `[1.5, 4]` / `[1, 5]`; FA signings a team
  and roster entering camp, seasons 8–10 vs 2–4, within 20% / 35%; next year's committed share, seasons 8–10 vs 2–4,
  within 5 / 10 points.
- Never loosen a band; your team is never decided by the books (only AI paths read them).
- One CPU-heavy job at a time. Push only after the owner confirms.

## Review Focus

- A club already past its books (an old save, a generated league's opening rosters): every decision still works, makes
  the smallest deal or none, and never loops; restructures make no steps.
- A future year with no draft picks on file: needs count a typical class, never zero.
- Speed: books are read inside free agency's loops; an offseason must not get more than 20% slower (`npm run offseason --
  6` timed before and after, and `trades`' speed lines).
- A keeper the plan judges worth it on a nearly full club: soft limit lets him re-sign; a free agent in the same spot is
  refused or shaped down.
- The existing 6-season lines (spread, pooled market seasons 2–6) keep reading the same seasons when the cap-drift
  leagues play 10.

---

### Task 1: The books

**Files:**
- Create: `src/engine/offseason/capBooks.ts`
- Test: `src/engine/offseason/capBooks.test.ts`

**Interfaces:**
- Consumes (from `ai.ts`, existing): `inPlans(league, team, p, depth?, wn?)`, `depthOutlooks(league, team)`,
  `winNow(league, team)`, `nextYearCeiling(gm, winNow)`, `inSeasonReserve(league, teamId)` (reads
  `league.caps[league.season]`: compute `y`'s reserve as `capFor(y) * IN_SEASON_RESERVE * (1.5 - gm.capAggression)`);
  `capSheet(league, teamId, season)`, `capFor`, `capHit`, `lastSeason`, `isExpired`, `leagueMarket`, `marketApy`,
  `minSalary`, `rookieContract`.
- Produces:
  ```ts
  export const BOOKS: { horizon: number; fade: number };           // { horizon: 3, fade: 0.03 }
  export interface BookYear { season: number; cap: number; committed: number; needed: number; limit: number; softLimit: number; room: number; softRoom: number }
  export interface CapBooks { teamId: number; years: BookYear[] }  // years[0] is s+1
  export function capBooks(league: League, team: Team): CapBooks;
  /** adds[i] lands on years[i]; anything at index ≥ horizon lands on the last year. */
  export function fits(books: CapBooks, adds: readonly number[], soft?: boolean): boolean;
  /** Smallest room across the horizon (soft or hard). */
  export function minRoom(books: CapBooks, soft?: boolean): number;
  /** Books after a commitment: room drops by `adds` (same folding as `fits`). Mutates and returns `books`. */
  export function commit(books: CapBooks, adds: readonly number[]): CapBooks;
  /** A deal's added cap charge in s+1, s+2, …: the prospective contract's hit less the current one's, per year, to its end. */
  export function dealAdds(league: League, player: Player, teamId: number, offer: Offer): number[];
  ```

- [ ] **Step 1: Write the failing tests** in `capBooks.test.ts` on `createLeague({ seed: 'cap-books' })` (no season
  played; pick an AI club):
  - `committed equals the cap sheet`: for each `years[i]`, `committed === capSheet(l, team.id, s+1+i).used`.
  - `limits fade a year at a time`: `years[1].limit / years[1].cap` equals `years[0].limit / years[0].cap − 0.03`
    (to 6 decimals); `years[i].softLimit / years[i].cap` is the same for every `i`.
  - `a keeper counts from the year after his deal ends`: set one starter's contract to end at `s+1` (trim `years`);
    `years[0].needed` doesn't include his market price, `years[1].needed` and `years[2].needed` do (each ≥ his
    `marketApy` scaled by `capFor(y)/capFor(s)`).
  - `every spot counted once`: with that keeper, `years[1].needed` grows by his price and loses one minimum spot (compare
    to the scene without him in plans: remove his contract → spot at the minimum instead).
  - `a year with no picks on file counts a typical class`: delete every pick for `s+3`; `years[2].needed` is greater than
    with the class's spots filled at the minimum only.
  - `the tail lands on the last year`: `fits(books, [0, 0, 0, x])` equals `fits(books, [0, 0, x])` for `x = years[2].room
    + 1` (both false) and `x = years[2].room − 1` (both true when `years[0..1].room ≥ 0`).
  - `a club past its books`: push dead money for `s+1` of 120% of `capFor(s+1)`; `minRoom(books) < 0`,
    `fits(books, [1])` false, `fits(books, [])` true.
- [ ] **Step 2: Run** `npx vitest run src/engine/offseason/capBooks.test.ts` — expected: FAIL (module missing).
- [ ] **Step 3: Implement `capBooks.ts`.** `needed(y)`: keepers = players under contract whose `lastSeason < y`, in plans
  now (one `depthOutlooks`/`winNow` read per call), each at `marketApy × capFor(y)/capFor(s)` (a tagged player at his
  market price too); picks = owned picks for `y` at their `rookieContract` hit (as `nextYearNeeds` prices them), or seven
  picks at slots 16, 48, 80, … when none are on file; spots = `max(0, 53 − contracted(y) − keepers − picks)` at
  `minSalary(1, capFor(y))`; plus `y`'s in-season reserve. `room = limit − committed − needed`, `softRoom = softLimit −
  committed − needed`.
- [ ] **Step 4: Run the tests** — expected: PASS. Then `npm run typecheck`.
- [ ] **Step 5: Commit** `offseason: a GM's cap books, three years ahead`.

### Task 2: Restructures read the books

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`nextYearNeeds`, `clubRoom`, `restructurePlan`, `ClubRoom`)
- Test: `src/engine/offseason/capBooks.test.ts` (append), existing `src/engine/offseason/makeRoom.test.ts`

**Interfaces:**
- Consumes: Task 1's `capBooks`, `fits`, `commit`.
- Produces: `ClubRoom` becomes `{ deals; books: CapBooks }` (replacing `nextRoom`); `nextYearNeeds(league, team, plans?)`
  returns `capBooks(...).years[0].needed` minus the in-season reserve (the ceiling's own room covers the cushion, as its
  comment says), so one definition serves both.

- [ ] **Step 1: Write the failing tests:**
  - `a restructure never leaves a year of the books short`: on an AI club, `restructurePlan(l, team, huge)`; replay each
    step's `restructureOptions(l, p, amount).addedPerYear` across that deal's remaining years into `commit(books, …)`;
    every `years[i].room ≥ 0` afterwards.
  - `a club past its books restructures nothing`: the over-books scene from Task 1 → `restructurePlan(...).steps` is
    empty.
- [ ] **Step 2: Run** — expected: FAIL (plan ignores years 2–3).
- [ ] **Step 3: Implement.** In `restructurePlan`, a step's amount is the most whose per-year adds (`addedPerYear` on each
  remaining year of that deal, `o.years`) `fits` the books (search down from the needed amount; `RESTRUCTURE_MIN` still
  the floor); `commit` each step. `makeRoom`'s keeper (`nextOwed`) is committed into the books on `s+1` before planning.
- [ ] **Step 4: Run** this file and `makeRoom.test.ts` — expected: PASS (a `makeRoom.test.ts` scene that moved is fixed
  by searching for its scene, not by pinning a seed).
- [ ] **Step 5: Commit** `offseason: restructures fit every year of the books`.

### Task 3: Offers fit the books

**Files:**
- Modify: `src/engine/offseason/capBooks.ts` (add `shapeToBooks`), `src/engine/offseason/ai.ts` (`aiFreeAgencyDay` around
  line 1258, `aiExtendEarly`, `aiExtendArrival`, `aiSettle`, `campStarterSignings`), `src/engine/offseason/capPlan.ts`
  (keepers' offers, line 145)
- Test: `src/engine/offseason/capBooks.test.ts` (append)

**Interfaces:**
- Consumes: Task 1's `dealAdds`, `fits`, `commit`; `prospectiveContract` (negotiation.ts).
- Produces:
  ```ts
  /** The offer as the GM can carry it: void years go first, then bonus share (to 0), then years (to 1). Null when even one year with no bonus doesn't fit. */
  export function shapeToBooks(league: League, team: Team, player: Player, offer: Offer, books: CapBooks, soft?: boolean): Offer | null;
  ```

- [ ] **Step 1: Write the failing tests:**
  - `an offer that fits is unchanged` (a cheap one-year deal on a club with room).
  - `a deal past the books gives up void years, then bonus, then years`: a club with `years[1].room` just above zero; an
    offer `{ years: 4, bonusPct: 0.4, voidYears: 1 }` at a star's market → result has `voidYears 0`; with less room,
    `bonusPct 0`; with less still, fewer years; each result `fits`.
  - `soft lets a worth keeper re-sign where a free agent can't`: on the same club, `shapeToBooks(..., soft = true)`
    returns a longer deal than `soft = false`.
  - `an early extension the books can't carry isn't made`: replace the `0.92` check in `aiExtendEarly`; on the
    over-books club `aiExtendEarly` returns false for a starter it would otherwise extend.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement** `shapeToBooks`, then call it after each `aiOffer` at the sites above: hard at free agency,
  `aiExtendEarly`, `aiExtendArrival`, `campStarterSignings`; soft at `capPlan`'s keepers (`worth` true) and `aiSettle`.
  `aiFreeAgencyDay` builds each club's books once a day and `commit`s every signing's `dealAdds` (no rebuild per offer).
  A null shape means no offer.
- [ ] **Step 4: Run** this file plus `src/engine/offseason/` tests — expected: PASS (fix moved scenes by searching).
- [ ] **Step 5: Commit** `offseason: every AI offer fits the club's books`.

### Task 4: Tags and early spending

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`tryTag`, `SPEND_FIRST`)
- Test: `src/engine/offseason/capBooks.test.ts` (append)

**Interfaces:**
- Consumes: Task 1, Task 3.

- [ ] **Step 1: Write the failing tests:**
  - `a tag counts his next year`: after `applyFranchiseTag` on a starter, `capBooks(...).years[0].needed` includes his
    market price.
  - `tryTag refuses a tag the books can't carry`: on a club whose `years[0].softRoom` is below his market price,
    `tryTag` returns false even with this year's room made.
  - `early free agency keeps the fill money`: on free agency day 1, `spendable` is lower than this year's space by the
    whole `fillReserve`.
- [ ] **Step 2: Run** — expected: FAIL.
- [ ] **Step 3: Implement:** `tryTag` checks `fits(books, [marketApy], true)` before tagging; `SPEND_FIRST.fillShare` →
  `1` (update its doc comment: the fill money is a need).
- [ ] **Step 4: Run** the offseason tests — expected: PASS.
- [ ] **Step 5: Commit** `offseason: a tag counts next year; early spending keeps the fill money`.

### Task 5: Measuring it

**Files:**
- Create: `scripts/cap-books.ts`; add `"cap-books": "tsx scripts/cap-books.ts"` to `package.json`
- Modify: `scripts/offseason-league.ts` (`CapRun`), `scripts/offseason.ts` (drift lines), `scripts/check.ts` (run
  `offseason` when `capBooks.ts` or `cap-books.ts` change; `src/engine/offseason/` already does)

**Interfaces:**
- Produces: `CapRun` gains `faSigned: number[]` (median signed players added between free agency's opening and the
  draft, by season), `campRoster: number[]` (median signed players entering camp), `committed: number[]` (median next-year
  `used / capFor(s+1)` at kickoff, %).

- [ ] **Step 1: Write `scripts/cap-books.ts`** (`npm run cap-books [-- seed seasons]`, defaults `offseason-audit-3 10`):
  per season, kickoff room (median %), FA signings a team, roster entering camp, next year committed %, restructure money
  on later years %, camp compliance dead money %. A preview, not a check.
- [ ] **Step 2: Child leagues play 10 seasons** when the main run plays 5 or more (`OFFSEASON_SEASONS = max(seasons,
  10)`); the pooled market lines and the spread line keep reading seasons 2–6 / the main run's last three (slice).
- [ ] **Step 3: Add the drift lines** over the three child leagues with `check(label, value, usualLo, usualHi, digits,
  normal)`: kickoff room each season 4–10 (pooled median) `[1.5, 4]` / `[1, 5]`; FA signings and camp roster, mean of
  seasons 8–10 ÷ mean of 2–4, `[0.8, 1.2]` / `[0.65, 1.35]`; committed share, 8–10 minus 2–4, `[−5, 5]` / `[−10, 10]`.
  Comment each band: the owner's call, 2026-11-18.
- [ ] **Step 4: Run** `npm run typecheck` and `npm run cap-books -- offseason-audit-3 6` (the script runs). Time `npm run
  offseason -- 6` against main's 6m20s on CI (local timing is the baseline you record now on main).
- [ ] **Step 5: Commit** `scripts: cap books probe; the offseason check judges 10 seasons' drift`.

### Task 6: Tune, verify, fix moved tests

**Files:** `src/engine/offseason/capBooks.ts` (`BOOKS.fade`), tests that moved, `.check/` logs (not committed)

- [ ] **Step 1: Steer:** `npm run cap-books -- offseason-audit-3 10` and `-- alt-1 10`. Read kickoff room, FA signings,
  camp roster, committed share against the bands. Adjust `BOOKS.fade` (0.02–0.05) only; at most three rounds. If the
  goals aren't met after three, stop and bring the owner the table of rounds.
- [ ] **Step 2: Judge, one at a time:** `npm run offseason -- 6` (default seed) and with `--seed alt-1`, `alt-2`,
  `alt-3`; then `npm run trades`, `npm run gm-habits`, `npm run gm-habits -- --effects --no-churn`, `npm run morale`,
  `npm run careers`. Every ✗ is fixed or brought to the owner; no band moves.
- [ ] **Step 3: Full tests:** `npx vitest run`; a moved scene is fixed by searching the world for it.
- [ ] **Step 4: Commit** `offseason: cap books tuned; moved scenes searched for`.

### Task 7: Docs, review, hand back

**Files:** `docs/MVP.md`, `CLAUDE.md`, `docs/GAME_DESIGN.md` (cap section), `src/ui/changelog.ts` (0.4.53 text)

- [ ] **Step 1: Docs:** `docs/MVP.md`: the kickoff-room item (Partial → Done if the bands hold), "Room made for a tag …
  forgets next year" closed, restructures note; `CLAUDE.md`: `offseason/` line (the books) and the `npm run offseason` /
  `npm run cap-books` entries; `GAME_DESIGN.md` cap section one paragraph; changelog 0.4.53 text mentions GMs planning
  three years ahead (≤ 200 characters, `npx vitest run src/ui/changelog.test.ts`).
- [ ] **Step 2:** `npm run format`, `npm run typecheck`, commit `docs: cap books`.
- [ ] **Step 3:** A fresh reviewer (sonnet) reads `git diff origin/main...HEAD -- src/ scripts/` against the spec; fix
  what's real, with tests.
- [ ] **Step 4:** Report to the owner with the numbers; **push only on the owner's OK**.
