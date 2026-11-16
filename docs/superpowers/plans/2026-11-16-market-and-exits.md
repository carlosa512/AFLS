# The Free-Agency Market and the 31–32 Exits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the free-agency market lines and the 31–32 exits into their usual bands (seasons 2–6 pooled), then make them real checks.

**Architecture:** Four levers on AI front offices and retirement, built in order and each measured on its own line:
deal length by the pay signed (`aiOffer`), AI clubs re-signing their own less (`capPlan`) plus a small player-side
market test on your team (`negotiation.ts`, `contractMail.ts`, the Re-sign screen), AI spring cuts at the new league year
(`ai.ts`, `offseason/index.ts`), and last season's starters kept in football (a camp signing and a retirement lean in
`aging.ts`). Measurement first, moved tests fixed once at the end.

**Tech Stack:** TypeScript, Vitest, tsx scripts (`npm run offseason`, `npm run careers`).

**Spec:** `docs/superpowers/specs/2026-11-16-market-and-exits-design.md`

## Global Constraints

- "Good" is 2% of the cap or more everywhere the market lines judge (`GOOD` in `scripts/free-agency-core.ts`).
- Targets (usual bands, seasons 2–6 pooled over the four leagues `offseason` plays): good outside signings 75–120 a
  year; one-year share 10–30%; clubs with 3+ 8–28; good deals ending with no deal 10–40%; starters out of football at
  kickoff 2.5–4.5%; the careers 31–32 lines inside their usual bands.
- When starters out of football and no deal pull apart, starters out of football wins (no deal may sit at 10%+).
- Lines near their edge on main must stay in: win spread 3.58 (fails 3.6), margin spread 13.33 (fails 13.6), meetings a
  club a season 5.55 (fails 6), young starting QBs 27.6% (floor 22.5%).
- Your own offseason changes only by the player-side test; your staff never cuts or signs.
- No `Math.random`; each new draw on its own stream. The player-side test is a pure draw from
  `${seed}:testsMarket:${season}:${playerId}` (nothing saved, no `SAVE_VERSION` bump).
- Never loosen a band; a lever's knob gets at most three probe rounds, then a line still out goes to the owner with the
  numbers.
- One CPU-heavy job at a time; all engine changes before fixing moved tests (`CLAUDE.md`, "Lessons from tuning work").
- Letters and screen text to `docs/NEWS.md` "Words in a letter" and `docs/UI.md` "Words on a screen".

## Review Focus

- Your player who wants to test the market: the advance button doesn't wait on him, you can sign him once free agency
  opens, and a promised player never draws it (Task 3 tests).
- A spring cut never takes a young star, a player signed this league year, a man below his position's floor or anyone on
  your team (Task 4 tests).
- An AI offer never loses value to its length: at or above his ask, the offer clears his walk-away (Task 2 test).
- The retirement lean leans only for last season's starters: a backup at 31 retires as before; kickers and punters are
  read by games (Task 5 tests).
- A camp signing of an unsigned starter fits the club's cap and its 53 (Task 5 test).

---

### Task 1: Measure the market the way it will be judged

**Files:**
- Modify: `scripts/free-agency-core.ts` (a pooled summary and the released share)
- Modify: `scripts/offseason-league.ts` (child leagues return their market measures by season)
- Modify: `scripts/offseason.ts` (print the pooled lines; still soft until Task 6)
- Test: `scripts/free-agency-core.test.ts`

**Interfaces:**
- Produces: `FaMeasures.released: number` (share 0–1 of good outside signings whose previous deal still had years to
  run when he left it); `export function pooledMarket(runs: readonly FaMeasures[][], from = 1, to = 5): PooledMarket`
  where `PooledMarket = { outside: number; oneYear: number; clubs3: number; none: number; released: number }` (means
  over seasons `from..to` inclusive, 0-based, of every league); the starters-out line pooled the same way
  (`pooledOutOfFootball(runs: readonly number[][], from = 1, to = 5): number`).

- [ ] **Step 1: Write the failing tests** `pooledMarket averages seasons 2–6 of every league` (two fake leagues of six
  seasons, `outside` 10…60 and 20…70: expect `outside` 45 pooled over indices 1–5) and `released counts a good outside
  signing who left a deal with years still to run` (a player whose `WindowStart` deal had two years left counts; one
  whose deal ended doesn't).
- [ ] **Step 2: Run them**: `npx vitest run scripts/free-agency-core.test.ts`. Expected: FAIL (`pooledMarket` not defined).
- [ ] **Step 3: Implement** `pooledMarket`, `pooledOutOfFootball` and `released` (read from `WindowStart`: record each
  player's deal and its last season at the new league year). Child leagues send their per-season `FaMeasures` and
  starters-out share back with their `CapRun`.
- [ ] **Step 4: Run them**: Expected: PASS.
- [ ] **Step 5: Print the pooled block** in `offseason.ts` after the per-season checks: `market, seasons 2–6 of 4
  leagues: good outside n · one-year % · clubs 3+ · no deal % · released % (NFL 20–27%, shown) · starters out of football
  %`, each with its usual band, marked ⚠ when out (soft: Task 6 judges them).
- [ ] **Step 6: Baseline**: `npm run offseason -- 6` once on the branch before any lever. Record the pooled line in the
  ledger. Expected: good outside about 50–60, one-year 35–50%, no deal 2–8%, released near 0, starters out 5–7%.
- [ ] **Step 7: Write the probe** (scratch, not committed): one league, six offseasons, the per-season and pooled market
  lines plus starters out of football, about 8 minutes. Every later task steers with it.
- [ ] **Step 8: Commit**: `git commit -m "Offseason: the market pooled over seasons 2–6 of four leagues, and released players"`.

### Task 2: A deal's length follows the pay signed

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiOffer` ~:207, `fitOffer` ~:238 only if Step 5 says so)
- Test: `src/engine/offseason/dealLength.test.ts`

**Interfaces:**
- Consumes: `dealYears(player, share)` (`finance/market.ts`), `demand(...).askYears`.
- Produces: `aiOffer`'s `years = clamp(max(dealYears(player, apy / cap), d.askYears) + (the existing 31-and-not-win-now
  step: −1), 1, 5)`.

- [ ] **Step 1: Write the failing tests**:
  - `an AI club's offer runs the length of the pay it offers, not of his ask`: a player whose market sits under 2% of
    the cap (asks one or two years) and an offer at 2.5% of the cap: expect `years` ≥ `dealYears(p, 0.025)`.
  - `an AI club's offer at or above his ask clears his walk-away whatever its length`: for 200 players in a fresh league,
    `offerValue(aiOffer(...)) >= d.walkAway` whenever `offer.apy >= d.askApy`.
- [ ] **Step 2: Run them**: `npx vitest run src/engine/offseason/dealLength.test.ts`. Expected: the first FAILS.
- [ ] **Step 3: Implement** the length in `aiOffer` (the longer of the table at the offer's pay and his asked years).
- [ ] **Step 4: Run them**: Expected: PASS.
- [ ] **Step 5: Probe**: the one-year share of good outside signings. If it is still past 30%, attribute the one-year
  deals to `aiOffer` against `fitOffer` (the late market's prove-it deals) in the probe; if `fitOffer` holds most, its
  one-year rule reads `dealYears` at the fitted pay for a player 28 or younger on his position's clock (today
  `YOUNG_PROVE_IT_YEARS`). At most three rounds; record each in the ledger.
- [ ] **Step 6: Commit**: `git commit -m "AI offers run the length of the pay they offer"`.

### Task 3: AI clubs re-sign their own less, and your player may test the market

**Files:**
- Modify: `src/engine/offseason/capPlan.ts` (a keeper's `worth`), `src/engine/offseason/negotiation.ts` (`makeOffer`),
  `src/engine/contractMail.ts` (`contractDecision`, `openContracts`, the letter's row), `src/ui/screens/FrontOffice.tsx`
  (the Re-sign row)
- Test: `src/engine/offseason/capPlan.test.ts`, `src/engine/offseason/testsMarket.test.ts` (new),
  `src/engine/contractMail.test.ts`

**Interfaces:**
- Produces: `export const RESIGN_VALUE` (capPlan.ts: a keeper is worth his ask only when the ask is at most
  `RESIGN_VALUE` × what the club reads him worth where he's headed, the market price at his `teamOutlook`; starting value
  1.0, tuned); `export const USER_TESTS_MARKET = 0.08` and `export function wantsMarket(league: League, p: Player):
  boolean` (negotiation.ts: your own good player, his deal ending this league year, not promised (`promisedDeal`), a draw
  from `${seed}:testsMarket:${season}:${p.id}` at `USER_TESTS_MARKET × (1 − loyalty)`); `contractDecision` returns
  `'testing'` for him.

- [ ] **Step 1: Write the failing tests**:
  - `an AI club lets a keeper go when his ask runs past what it reads him worth`: a keeper asking 1.3× his worth at the
    club's read is `worth: false`; one asking 0.9× is `worth: true`.
  - `your player who wants to test the market refuses before free agency and signs in it`: find one with `wantsMarket`
    true (search seeds, assert found); `makeOffer` in `resign` at his ask is refused with the market reason; the same
    offer in `freeAgency` signs.
  - `a promised player never wants to test the market`, `the draw is the same every time it is read`.
  - `a player testing the market doesn't hold up the window`: `openContracts` excludes him; `contractDecision` is
    `'testing'`; the contracts letter's row for him says he wants to see the market.
- [ ] **Step 2: Run them**: Expected: FAIL.
- [ ] **Step 3: Implement** `RESIGN_VALUE` in `capPlan`'s worth judgment; `wantsMarket`; the refusal in `makeOffer`
  (`phase === 'resign'` and your team only), its message one plain sentence to the house rules ("He wants to see what the
  market says first."); `contractDecision`/`openContracts`; the row's word on the Re-sign screen and in the letter.
- [ ] **Step 4: Run them**, plus `npx vitest run src/engine/letterRules.test.ts`; `npm run copy` and read the new lines.
  Expected: PASS.
- [ ] **Step 5: Probe**: stayed, moved and no deal. Tune `RESIGN_VALUE` toward stayed 36–45%. At most three rounds.
- [ ] **Step 6: Morale and trades**: `npm run morale`, then `npm run trades` (more players moving). Expected: every line
  in range; a miss goes to the owner with the numbers.
- [ ] **Step 7: Commit**: `git commit -m "AI clubs re-sign their own less; your player may want to test the market"`.

### Task 4: AI clubs cut overpaid veterans in the spring

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`springCuts`, next to `capCut`), `src/engine/offseason/index.ts` (call it after
  `marketMoment(league, 'leagueYear')` ~:273)
- Test: `src/engine/offseason/springCuts.test.ts` (new)

**Interfaces:**
- Consumes: `twoYearRoom`, `teamOutlook`, `marketApy`, `isYoungStar`, `KEEP_MIN`, `releasePlayer`.
- Produces: `export const SPRING_CUT = { margin: 0.5 }` (a veteran is cut when his cap charge this year runs past
  `(1 + margin)` × his market price at the club's read of where he's headed; starting value, tuned) and `export function
  springCuts(league: League, team: Team): Player[]` (AI clubs only; returns who was released).

- [ ] **Step 1: Write the failing tests**:
  - `cuts a veteran whose charge runs well past what the club reads him worth`: build one (raise his contract's base);
    expect him released, savings now and over two years positive.
  - `never cuts a young star, a player signed this league year, a man below his position's floor, or anyone on your
    team`: one scene each, nobody released.
  - `the trade market's call-around comes first`: a cap casualty traded at `marketMoment('leagueYear')` is not released.
- [ ] **Step 2: Run them**: Expected: FAIL (`springCuts` not defined).
- [ ] **Step 3: Implement** `springCuts` (extend `capCut`'s fair-cut rules; one pass a club, best savings first, while a
  candidate qualifies) and call it for AI clubs at the new league year.
- [ ] **Step 4: Run them**: Expected: PASS.
- [ ] **Step 5: Probe**: released share of good outside signings toward 20–27%, good outside signings and no deal. Tune
  `SPRING_CUT.margin`. At most three rounds.
- [ ] **Step 6: Trades and morale**: `npm run trades` (cap casualties on the phone, dumps), then `npm run morale`.
  Expected: every line in range; a miss goes to the owner with the numbers.
- [ ] **Step 7: Commit**: `git commit -m "AI clubs cut overpaid veterans in the spring"`.

### Task 5: Last season's starters stay in football

**Files:**
- Modify: `src/engine/aging.ts` (`retireChance`, `RETIRE_BODY.starterLean`), `src/engine/offseason/index.ts` (pass who
  started ~:187), `src/engine/offseason/ai.ts` (camp: an unsigned starter signed by a club with the need, via
  `needSigning` ~:1371), the preseason step in `index.ts` (~:409)
- Test: `src/engine/aging.test.ts` (or `retire.test.ts`), `src/engine/offseason/campStarters.test.ts` (new)

**Interfaces:**
- Produces: `retireChance(p: Player, ovr: number, started = false): number` (hazard × `(1 − RETIRE_BODY.starterLean)`
  when `started`; starting value 0.4, tuned); `export function startedLastSeason(league: League, season: number):
  Set<number>` (top `STARTERS[pos]` by snaps a club and position in that season; kickers and punters by games);
  `export function campStarterSignings(league: League): Player[]` (in camp, each of last season's starters still
  unsigned is signed by the AI club with the most need at his position that fits him under the cap and the 53, at his
  walk-away or the minimum, whichever is higher; returns who signed).

- [ ] **Step 1: Write the failing tests**:
  - `a starter at 31 retires less than a backup with the same body and age`: `retireChance(p, ovr, true) <
    retireChance(p, ovr, false)`; and with `started` false the chance equals today's.
  - `startedLastSeason reads snaps, and kickers and punters by games`.
  - `an unsigned starter in camp is signed by a club with the need, inside its cap and its 53`; `nobody signs him past
    the cap or the 53` (a scene with no room: he stays unsigned).
- [ ] **Step 2: Run them**: Expected: FAIL.
- [ ] **Step 3: Implement** the lean (the new league year passes `startedLastSeason(league, the season just played)`),
  and `campStarterSignings` in the preseason step after camp's market moment.
- [ ] **Step 4: Run them**: Expected: PASS.
- [ ] **Step 5: Probe and careers**: starters out of football toward 2.5–4.5% (the market probe), then `npm run careers`
  for the 31–32 lines and that 29–30 hold. Tune `RETIRE_BODY.starterLean`. At most three rounds.
- [ ] **Step 6: Commit**: `git commit -m "Last season's starters stay in football: a camp signing and a starter's retirement lean"`.

### Task 6: Judge the lines, fix moved tests once, document, verify, ship

**Files:**
- Modify: `scripts/offseason.ts` (the pooled market lines and starters out of football judged: fail outside each line's
  normal band; the known-issue banners for the FA market and starters out of football removed if in band),
  `scripts/careers.ts` (`B_OWNS_GONE`: the 31–32 exits judged again if in band), moved tests, `docs/MVP.md` (the two
  items), `docs/research/free-agency-market.md` (the new numbers), `CLAUDE.md` (the `offseason` and `careers` lines;
  "Lessons" near-edge list refreshed), `package.json` (the middle number per `docs/VERSIONING.md` for finished MVP
  items), `src/ui/changelog.ts`

- [ ] **Step 1: Switch the lines to judged** and run `npm run offseason -- 6`: 0 outside target range.
- [ ] **Step 2: Fix moved tests once**: `npx vitest run`; each failure re-scened (search the world, assert the scene) or
  its fingerprint re-pinned where the test calls it one; no bound moved without a dated note and the owner's rule; real
  bugs fixed with a test that failed first.
- [ ] **Step 3: Docs and version**: the edits above; `npx vitest run src/ui/changelog.test.ts` PASS.
- [ ] **Step 4: Local verification, one at a time**: `npx vitest run`, `npm run typecheck`, `npm run format:check`,
  `npm run offseason -- 6`, `npm run careers`, `npm run morale`, `npm run trades`, `npm run sim -- 30`. Every one
  passes; the near-edge lines in Global Constraints read and recorded.
- [ ] **Step 5: Fresh review** of the whole branch (most capable model), fixes with tests that failed first.
- [ ] **Step 6: Commit, then ask the owner** whether to open the PR; once open, push only after local checks pass, read
  CI and fix red in one push.
