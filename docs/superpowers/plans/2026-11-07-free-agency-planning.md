# Front offices that plan: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI front offices plan their cap, re-sign their best players first and on purpose, keep room for next year,
and a free-agency market that clears, so good players (above all young ones) sign real deals and the league's market
looks like the NFL's; plus one SNN story of who came off the market.

**Architecture:** A new pure read, `offseason/capPlan.ts`, gives each AI club its keepers (priced and judged worth it
or not), next year's needs, its targets on the coming market and a stance. `aiResignWindow` and `aiFreeAgencyDay`
(`offseason/ai.ts`) consume it; the market's clearing rules are small pure functions beside them. A new digest module
`offMarketMail.ts` reads the transaction log (which gains a player id). The offseason audit gains a free-agency block
whose measures live in a pure, tested `scripts/free-agency-core.ts`.

**Tech Stack:** TypeScript, Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-11-07-free-agency-planning-design.md`. Research behind the bands:
`docs/research/free-agency-market.md` (`scripts/research-free-agency.py`).

## Global Constraints

- No `Math.random`: every draw goes through a seeded `Rng`; the window's draws (`aiOffer`, `testsMarket`) stay on the
  league's stream.
- `League` stays plain JSON; the only shape change is `Transaction.playerId?: number`: `SAVE_VERSION` 89 → 90 with an
  upgrade step in `migrate.ts` that rewrites nothing.
- True vs perceived: a club reads other clubs' players through its own read (`viewCache`/`perceive`), its own through
  `teamOutlook` as today; screens and mail show the user's read only (`seenOvr` in `scouting.ts`).
- The user's club is planned, re-signed, signed for and cut for only when the AI runs it (`autoUser`, `ai` list in
  `advanceOffseasonControlled`).
- A player changes club only through `setTeam`/`signPlayer`/`releasePlayer`.
- Salaries in $K; cap math through `finance/contract.ts` and `finance/cap.ts`.
- Bands are the owner's: never moved to get a run green. Lines judged from the second offseason on.
- `npm run format` before each commit. Comments say why.

## Review Focus

1. **Your club untouched.** A funded last call or the window's room-making must never release or sign anyone on the
   user's club when it isn't run by the AI. Pinned in Task 6 and Task 4.
2. **No dead money from the funded cut.** A club with no minimum-salary man at the position (or whose only one carries
   a bonus) gets no funding from a cut. Pinned in Task 6.
3. **Reload gives the same market.** A capPlan cache must not make a JSON-reloaded league decide differently from the
   live one mid-step. Pinned in Task 3.
4. **A save from before v90 mid-window.** Transactions without `playerId` must give no off-market rows and no crash.
   Pinned in Task 7.
5. **Promised deals and Tags First still bind.** A promised player (G4) signs even when the plan says he isn't worth
   his price; a Tags First GM still tags before signing. Pinned in Task 4.

---

### Task 0: Rebase onto main after `claude/quirky-shannon-18tnms` merges

**Files:** `package.json`, `src/ui/changelog.ts` (conflicts only)

- [ ] **Step 1:** `git fetch origin main && git rebase origin/main`. On the version conflict, main keeps 0.4.11 (a play's
      time); the practice-squad fix becomes **0.4.12** (its changelog entry renamed and moved above main's).
- [ ] **Step 2:** `npx vitest run src/engine/personnel/ src/ui/changelog.test.ts` → all pass. `npm run typecheck` → clean.
- [ ] **Step 3:** `npm run format`, then `git push --force-with-lease -u origin claude/vibrant-thompson-on5rem`.

### Task 1: The audit's free-agency block (measure first: expected red before the fix)

**Files:**
- Create: `scripts/free-agency-core.ts`, `scripts/free-agency-core.test.ts`
- Modify: `scripts/offseason.ts` (capture after `beginOffseason`, judge at kickoff beside the `checks ${year} cap:` line;
  pooled young line in the run's summary)

**Interfaces:**
- Produces:
  ```ts
  export interface WindowStart {
    season: number; // the new league year
    room: number[]; // capSpace / cap per club, ascending
    ending: { id: number; teamId: number; young: boolean }[]; // good deals that just ended (age ≤ 28 → young)
    teamAt: Record<number, number | null>; // every player's club at the window's start
  }
  export function windowStart(l: League): WindowStart; // call right after beginOffseason
  export interface FaMeasures {
    ends: number; stayed: number; moved: number; none: number; // shares 0–1 of `ending`
    youngEnds: number; youngNone: number; // counts, pooled by the caller
    outside: number; clubs3: number; oneYear: number; // good outside signings, clubs with 3+, one-year share
    eliteYoungUnsigned: number; // free agents at kickoff, age ≤ 28, marketApy ≥ 5% of the cap
    roomMedian: number; roomClubs10: number; overCap: number; // reported only
  }
  export function faMeasures(start: WindowStart, l: League): FaMeasures; // call at kickoff (phase 'regular')
  export const GOOD = 0.02; export const ELITE = 0.05;
  ```
- Definitions (the research doc's): a good deal has `contract.apy / caps[contract.signedSeason] >= GOOD`; it ended when
  its last season is `season - 1`; stayed = same club with a contract at kickoff; moved = another club; none = unsigned,
  on a practice squad or retired. A good outside signing: at kickoff, a `veteran` contract with `signedSeason ===
  season`, `apy / caps[season] >= GOOD`, on a club other than `teamAt[p.id]`.

- [ ] **Step 1: Write the failing tests** in `scripts/free-agency-core.test.ts` on a `createLeague({ seed: 'fa-core',
      personnel: true })` copy, building each case by hand (`setTeam`, contracts from `buildContract`):
      `it('a good deal re-signed with his club is stayed; with another club moved; unsigned, squad or retired none')`
      (three players → `stayed`, `moved`, `none` each 1/3);
      `it('a deal under 2% of the cap the year it was signed is not counted')` (`ends` unchanged);
      `it('an outside signing counts once, by its new club; a one-year one in the one-year share')`
      (`outside === 2`, `oneYear === 0.5`, `clubs3 === 0`);
      `it('a 26-year-old free agent priced at 5%+ at kickoff is an elite young unsigned player')` (`=== 1`; at 29 → 0).
- [ ] **Step 2:** `npx vitest run scripts/free-agency-core.test.ts` → FAIL (module not found).
- [ ] **Step 3: Implement** `windowStart` and `faMeasures` (`marketApy(leagueMarket(l), p)` for the elite line).
- [ ] **Step 4:** `npx vitest run scripts/free-agency-core.test.ts` → PASS.
- [ ] **Step 5: Wire into `scripts/offseason.ts`.** Capture `windowStart(league)` after `beginOffseason`; at kickoff print
      `  checks ${year} free agency:` with `check(...)` lines, each with its usual band then its normal band, judged
      when `s >= 1` (printed but not judged in the first offseason):
      stayed % `[28, 45]`/`[20, 55]`; moved % `[30, 50]`/`[20, 60]`; no deal % `[15, 32]`/`[10, 40]`; outside signings
      `[75, 120]`/`[60, 135]`; clubs 3+ `[12, 24]`/`[8, 28]`; one-year % `[10, 30]`/`[5, 40]`; elite young unsigned
      `[0, 0]`. A reported line (no `check`): room median %, clubs 10%+, over the cap, beside "NFL Feb 2023–25: median
      2.8–12.3%, 8–18 clubs 10%+, 8–14 over". In the run's summary: no deal %, 28 or younger, pooled over judged seasons,
      `[5, 22]`/`[0, 30]`. Each band's comment names its NFL figure and the research doc.
- [ ] **Step 6: Record the baseline:** `npm run offseason -- 4`. Expected: the new lines print; several fail (that's the
      bug). Paste the free-agency lines into the research doc's "AFLS before the fix" section under the seed's name.
- [ ] **Step 7: Commit** `scripts/free-agency-core.ts scripts/free-agency-core.test.ts scripts/offseason.ts
      docs/research/free-agency-market.md` — "Checks: the free-agency market against the NFL's (measured before the fix)".

### Task 2: Transactions name their player (save v90)

**Files:**
- Modify: `src/engine/types.ts` (`Transaction.playerId?: number`), `src/engine/finance/cap.ts` (`logTransaction(league,
  kind, teamIds, text, playerId?: number)`), `src/engine/offseason/negotiation.ts` (`signPlayer` passes `player.id`),
  `src/engine/offseason/ai.ts` (`applyFranchiseTag` passes `player.id`), `src/engine/generate.ts` (`SAVE_VERSION = 90`),
  `src/engine/migrate.ts` (v90 step: version only, comment says why), `scripts/save-budget.ts` (an allowance
  `transactionPlayerIds` with the measured growth).
- Test: `src/engine/migrate.test.ts`, `src/engine/offseason/frontOffice.test.ts`

- [ ] **Step 1: Failing tests:** `it('a re-signing, a signing and a tag log the player id')` (sign a free agent, re-sign
      an expiring player, tag one: the three new transactions carry their ids; kinds `sign`, `resign`, `tag`);
      `it('v89 saves load as v90 with their transactions untouched')`.
- [ ] **Step 2:** run both → FAIL.
- [ ] **Step 3: Implement** the optional parameter and the v90 step.
- [ ] **Step 4:** run both → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Save size:** `npm run offseason -- 2` prints the save lines; set `transactionPlayerIds` to the measured
      growth (a few bytes × up to 3,000 entries) with a comment giving the measurement (the owner's call: the save gets
      the room it needs).
- [ ] **Step 6: Commit** — "Transactions name their player (save v90)".

### Task 3: The cap plan (`src/engine/offseason/capPlan.ts`)

**Files:**
- Create: `src/engine/offseason/capPlan.ts`, `src/engine/offseason/capPlan.test.ts`
- Modify: `src/engine/offseason/ai.ts` (export `depthOutlooks`, `richness`, `minGainFor`, `fitOffer` stays exported;
  no behavior change)

**Interfaces:**
- Consumes: `resignCall`, `aiOffer`, `needGain`, `upgradeBar`, `winNow`, `spendable`, `nextYearNeeds`,
  `expiringPlayers`, `offerCharge`, `teamOutlook`, `viewCache`.
- Produces:
  ```ts
  export type Stance = 'spend' | 'balance' | 'bank';
  export const STANCE_SPEND = 0.6; export const STANCE_BANK = 0.35; // winNow cut points (tuned in Task 8)
  export function stanceFor(winNow: number): Stance; // ≥ STANCE_SPEND spend, < STANCE_BANK bank, else balance
  export function stanceOf(league: League, team: Team): Stance; // stanceFor(winNow(league, team))
  export interface PlannedKeeper { player: Player; call: 'keep' | 'tag'; ahead: number; gain: number;
    offer: Offer; cost: number; worth: boolean }
  export interface Target { player: Player; gain: number; price: number } // price = marketApy
  export interface CapPlan { stance: Stance; keepers: PlannedKeeper[]; nextYear: number; targets: Target[];
    faRoom: number }
  export function capPlan(league: League, team: Team, rng: Rng): CapPlan;
  ```
- Rules: keepers are `expiringPlayers` whose `resignCall` isn't `walk`, sorted by `ahead` (desc, then id); `offer` is
  `aiOffer(..., rng, gain)` with the window's loyalty nudge (`× (0.96 + 0.08 × gm.loyalty)`, moved here from the
  window); `worth` = `gain >= upgradeBar(league, team, offer.apy)` and no target at his position with
  `target.gain / target.price > gain / offer.apy` and `target.price <= faRoom + cost`. Targets: other clubs' expiring
  players during `resign` (free agents during `freeAgency`), on the club's own read, `needGain` ≥ the club's minimum
  gain, best two by gain. `faRoom` = `spendable` − Σ worth keepers' `cost` − (stance `spend` ? 0 : max(0, `nextYear` −
  `nextRoom`)), where `nextRoom` = `nextYearCeiling(gm, winNow) × capFor(next season)` − next season's `capSheet` used.
  No cache: the window and each FA pass build it once per club (it takes the pass's rng).

- [ ] **Step 1: Failing tests** in `capPlan.test.ts` (`createLeague({ seed: 'cap-plan', personnel: true })`, rolled to
      the re-sign window with `simToEndOfSeason` + `beginOffseason` once in `beforeAll`, `structuredClone` per test):
      `it('keepers come best first by the club’s outlook')`;
      `it('stance follows winNow: 0.7 spends, 0.5 balances, 0.2 banks')` (`stanceFor`);
      `it('a keeper whose gain doesn’t clear the bar his price sets is not worth it')` (an aging backup given a 6%-of-cap
      offer → `worth === false`);
      `it('a cheaper target at his position that buys more gain makes a keeper not worth it')`;
      `it('targets are read through the club’s own scouts')` (set the club's knowledge of a target low and its true
      ratings high: `gain` follows `perceive`, not `playerOvr`).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `capPlan.ts`.
- [ ] **Step 4:** run → PASS. Also `it('a JSON-reloaded league plans the same')` (plan from a clone vs
      `JSON.parse(JSON.stringify(clone))` with equal rng seeds → equal keeper ids, worth flags, faRoom).
- [ ] **Step 5: Commit** — "Front offices: the cap plan (keepers worth their price, targets, stance)".

### Task 4: The re-sign window in priority

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiResignWindow`, a new `makeRoomFor`)
- Test: `src/engine/offseason/makeRoom.test.ts` (extend), `src/engine/offseason/capPlan.test.ts`

**Interfaces:**
- Consumes: `capPlan`.
- Produces: `export function makeRoomFor(league: League, team: Team, keepers: PlannedKeeper[]): number` — room made
  once for the worth keepers in order: `restructurePlan` for the whole shortfall, then `capCut` releases while the cut is
  worse (`playerOvr`) than the last keeper it funds; all or nothing per keeper, as `makeRoom`. Returns the room made.

- [ ] **Step 1: Failing tests:**
      `it('with room for one, the better keeper signs and the cheaper one walks')`;
      `it('a keeper not worth his price walks even with room')`;
      `it('room is made once: a declining veteran worse than the keeper is cut and the keeper signs')`;
      `it('a promised player signs even when the plan says he isn’t worth his price')` (G4 `promisedDeal`);
      `it('a Tags First GM still tags before signing')` (`habitsForce`);
      `it('the user’s club re-signs nobody and is cut from nobody unless the AI runs it')`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement:** `aiResignWindow` walks `capPlan(...).keepers` (worth ones, plus promised) instead of
      `expiringPlayers`, calls `makeRoomFor` once before the loop, keeps `testsMarket`, the tag path and the habits;
      a not-worth keeper gets `tryTag` only if `call === 'tag'` and the tag clears the bar (unchanged rule), else walks.
- [ ] **Step 4:** run → PASS; `npx vitest run src/engine/offseason/` → note snapshot diffs (the world moved) but don't
      re-take them yet (Task 8).
- [ ] **Step 5: Commit** — "Front offices: the re-sign window keeps the best first and makes the room on purpose".

### Task 5: Spending discipline and two-year deals for young players

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiFreeAgencyDay`, `fitOffer`)
- Test: `src/engine/offseason/lateMarket.test.ts` (extend)

**Interfaces:**
- Produces: `fitOffer(offer: Offer, budget: number, min: number, age?: number): Offer | null` — `years: 2` when
  `age <= 28` (else 1), still no bonus; `apy` as today.

- [ ] **Step 1: Failing tests:**
      `it('a multi-year bid that eats next year’s keepers’ room is refused')` (`committedNext + plan.nextYear + apy`
      over `nextYearCeiling(gm, winNow) × capFor(next)`);
      `it('a bank club passes on a 30-year-old marginal upgrade but signs a 25-year-old')`;
      `it('a fitted offer to a 26-year-old runs two years; to a 31-year-old one')`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement:** build each club's plan once per pass (`capPlan` with the pass's rng); replace the flat
      `committedNext` check with the plan's; the bank filter (`p.age <= 27 || gain >= 2 × upgradeBar(apy)`); pass
      `p.age` to `fitOffer`.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** — "Free agency: room kept for next year's keepers; bank clubs buy young; young players' fitted
      deals run two years".

### Task 6: A market that clears

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiFreeAgencyDay`; `fillCampRoster` uses the funded path)
- Test: `src/engine/offseason/lateMarket.test.ts` (extend)

**Interfaces:**
- Produces:
  ```ts
  /** The least he takes once the market has shown its hand: the best fitted offer if it's at least half his walk-away. */
  export function clearingFloor(walkAway: number, bestFitted: number | null, minimum: number): number;
  /** Room a club can find for a clear upgrade at `position` on the last call: its spendable, half its in-season reserve,
   * and the salary of its weakest minimum-deal man there whose release leaves no dead money. */
  export function fundedRoom(league: League, team: Team, position: Position): { room: number; cut: Player | null };
  export const CLEARING_DAY = 3; export const FUNDED_RESERVE_SHARE = 0.5; // tuned in Task 8
  ```
- Rules: in a pass where `phase === 'freeAgency' && faDay >= CLEARING_DAY`, or `draft`/`preseason`, a player with no bid
  at his floor takes the best fitted bid if `>= clearingFloor(...)`; `clearingFloor` never returns under `minimum`.
  On the last call, a club whose `spendable` can't fit him uses `fundedRoom` when `gain >= 2 × minGain`; the deal is
  one year (two if 28 or younger, Task 5); `cut` is released (`releasePlayer`) only once he has chosen that club.

- [ ] **Step 1: Failing tests:**
      `it('clearingFloor: best fitted ≥ half → that; below half → his walk-away; never under the minimum')`;
      `it('from day 3 an unbid free agent signs at the best fitted offer')`;
      `it('on the last call a young star signs with a needy club that cuts its weakest minimum man')`
      (afterwards: star signed, the cut man a free agent, the club's dead money unchanged);
      `it('no funding from a cut that would leave dead money, or from the user’s club')`;
      `it('funding draws at most half the in-season reserve')`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** `clearingFloor`, `fundedRoom` and their use in the passes.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5: Commit** — "Free agency: the market clears (sights by the offers made; the last call funded)".

### Task 7: News: off the market (`src/engine/offMarketMail.ts`)

**Files:**
- Create: `src/engine/offMarketMail.ts`, `src/engine/offMarketMail.test.ts`
- Modify: `src/engine/inbox.ts` (`MailSubject` `{ kind: 'offMarket'; season: number }`, its `mailSubject` case for id
  `offMarket:${season}`, and `deliverMail`'s `freeAgency` branch)

**Interfaces:**
- Produces: `export function offMarketMail(league: League, have: Set<string>): Draft[]` (`Draft` from `senders.ts`).
- Content (exact copy): from `'SNN league desk'`; subject
  `` `Off the market: ${n} re-signed, ${t} tagged before free agency` `` (a count of zero drops its half: "Off the
  market: 9 re-signed before free agency"); body one lead sentence ("Before free agency opened, these
  players' clubs kept them."); `sections: [{ title: 'Kept before free agency', columns: ['Player', 'Pos', 'Club',
  'Deal'], rows }]` — rows from this season's `phase === 'resign'` transactions of kind `resign` whose text has
  ` re-signed ` (an extension says `extended`) or kind `tag`, with a `playerId`, not the user's club; best first by
  `seenOvr(league, league.userTeamId, p)`; Deal `` `${years} yr, $${total}M` `` or `'Franchise tag'`; twelve rows, then a
  row note "and N more"; a closing sentence naming the three best free agents by our read whose last club was another
  club ("Still heading to market: …"); actions: up to three `{ kind: 'player' }` and `{ kind: 'fa' }`. Category
  `'news'`.

- [ ] **Step 1: Failing tests:** `it('files once when free agency opens, listing other clubs’ re-signings and tags')`;
      `it('orders by our scouts’ read, not the truth')` (a well-known player rated lower by us sorts below);
      `it('leaves out extensions and our own club')`; `it('a save from before v90 (no player ids) files nothing and
      doesn’t throw')`; `it('twelve rows, then and N more')`.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3: Implement** and wire into `deliverMail` (`league.phase === 'freeAgency'`).
- [ ] **Step 4:** run → PASS; `npx vitest run src/ui/ui.test.ts src/ui/mail.test.tsx` → PASS (screen contract).
- [ ] **Step 5:** `npm run mail-preview` then `npm run screens -- --mail offMarket` → look at the letter; fix layout only.
- [ ] **Step 6: Commit** — "News: off the market (who re-signed or was tagged before free agency)".

### Task 8: Tune, verify, document, version

**Files:** knobs in `capPlan.ts` and `ai.ts` (`STANCE_SPEND`, `STANCE_BANK`, `CLEARING_DAY`, `FUNDED_RESERVE_SHARE`
only), snapshots and fixtures, `docs/research/free-agency-market.md`, `docs/MVP.md`, `docs/PRACTICE_SQUADS.md` (if the
squad numbers moved), `CLAUDE.md` (the `npm run offseason` line names the free-agency block), `package.json`,
`src/ui/changelog.ts`.

- [ ] **Step 1:** `npm run offseason -- 6`. Tune only the four knobs until every free-agency line sits inside its normal
      band (⚠ allowed) and every existing line holds. Never touch a band. If a line can't be reached with the knobs,
      stop and report to the owner with the numbers.
- [ ] **Step 2:** `npm run offseason -- 6 --seed track-fa`, `npm run trades`, `npm run gm-habits`, `npm run careers`,
      `npm run morale`, `npm run squads -- 2` → nothing ✗/▲/▼ (⚠ is fine). Fix what's red in the engine, not the band.
- [ ] **Step 3:** Re-take only the snapshots and fixtures the moved world changes: `npx vitest run -u
      src/engine/offseason/offseason.test.ts` and any other test whose failure is a fixture of a league's state (read each
      diff; a behavior assertion that fails is a bug, not a fixture).
- [ ] **Step 4:** `npm test` → PASS; `npm run typecheck` → clean.
- [ ] **Step 5: Docs:** paste the final free-agency lines into the research doc ("AFLS after the fix"); in `docs/MVP.md`
      update the front-office follow-ups this moves ("Starters leave football more", "Tags spike", "Room made for a tag…")
      with their new numbers, closing any now inside its NFL band; `CLAUDE.md`'s `npm run offseason` entry gains "and the
      free-agency market against the NFL's (who stays, who moves, outside signings, one-year deals)".
- [ ] **Step 6: Version:** no MVP item finishes (8 is Done): patch bump to the next free number after main's, with a
      changelog entry: title "Front offices that plan", text in a player's words (clubs keep their best players first,
      rebuilders save room and spend it the next spring, no young star sits unsigned, an SNN story when free agency opens
      lists who was kept).
- [ ] **Step 7:** `npm run format`; commit — "Front offices that plan: tuned against the NFL's market"; `git push -u
      origin claude/vibrant-thompson-on5rem`. A pull request only when the owner asks; then read CI and fix what's red.
