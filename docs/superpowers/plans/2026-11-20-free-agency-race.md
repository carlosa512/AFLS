# The Free-Agency Race Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free agency becomes one race every team runs in: AI teams bid on the players you want, raise when behind,
you see the race, and a player picks a team when one offer stands out.

**Architecture:** Today's daily AI pass (`aiFreeAgencyDay`) is split, without changing its results, into a bid builder
(`offseason/bids.ts`). A new `offseason/race.ts` uses it: opening offers when free agency opens, then each day standing
offers (yours and theirs), AI raises, a "stands out" rule and the agent's warning. The race's state lives in
`League.faRace`. Screens read it through `offseason/raceView.ts`; letters come from `raceMail.ts`.

**Tech Stack:** TypeScript, React, Vitest. Engine rules from `CLAUDE.md`: pure functions, seeded `Rng` only, `League`
plain JSON.

**Spec:** `docs/superpowers/specs/2026-11-20-free-agency-race-design.md` (mockup:
`docs/superpowers/specs/2026-11-20-free-agency-race-mock.html`, variant B).

## Global Constraints

- No `Math.random`; every draw on the seeded `Rng` the pass is given.
- `League` stays plain JSON; the race's state bumps `SAVE_VERSION` from 101 to 102 with a v102 step in `migrate.ts`.
- No band in any check moves to get green (`CLAUDE.md`).
- Fog of war: no true rating, trait or personality number on a screen; other teams' deals only as coarse bars and the
  agent's rounded number for the leader.
- Words: a team, never a club; American football English; screen text per `docs/UI.md` "Words on a screen"; letters per
  `docs/NEWS.md` "Words in a letter" (a file that words a letter goes in `LETTER_FILES`).
- Free agency stays `FA_DAYS = 5`. The race runs in the `freeAgency` phase only; the late passes (draft, camp, last call)
  keep calling `aiFreeAgencyDay` unchanged.
- One CPU-heavy job at a time (no sims beside agents). Locally run only the checks the task names; CI runs the rest.
- `npm run format` before each commit. Commit messages end with the session's attribution lines.

## Review Focus

1. **A save loaded mid-free-agency** (`faRace` unset in the `freeAgency` phase): the next advance opens the race
   without judging anyone, and your offers work as today until it does. Test in Task 3.
2. **Your cap shrinks after you bid** (a release's dead money, a trade): a standing offer that no longer passes
   `offerProblem` is dropped at judging, never signed over the cap, and his result letter says so. Test in Task 4.
3. **Two of your offers win on the same day:** both sign, and the cap and the 53 hold, because offers had to fit
   together. Test in Task 4.
4. **The last day:** you are warned at day 4's end about every player you're behind on, AI teams don't raise on day 5,
   so what you saw before advancing is what decides. Test in Task 4.
5. **Lowering a standing offer:** refused ("You can raise your offer or pull it."), so leading and then lowering can't
   bid up a rival. Test in Task 4.

---

### Task 1: Measure the NFL's signing timing and record the baseline

**Files:**
- Create: `scripts/research-fa-timing.py`
- Modify: `docs/research/free-agency-market.md` (new section "When the market signs")

- [ ] **Step 1: Find a source with signing dates.** First check nflverse's Over The Cap history
  (`historical_contracts.csv.gz`, the file `scripts/research-free-agency.py` downloads) for a date column. If it has
  none, try a public free-agent tracker with signing dates (Over The Cap's or Spotrac's free agency pages) for 2021–25.
  Write down which source worked.
- [ ] **Step 2: Write `scripts/research-fa-timing.py`** in the style of `scripts/research-free-agency.py` (argparse,
  `--data`, `--download`, research input only). It prints, for veteran free agents whose new deal is at least 2% of
  the cap (`GOOD`) and at least 5% (`ELITE`): the share agreed by each day of the market (the negotiating window counts
  as day 1, then the league year's first four days), and the mean day an `ELITE` player agrees.
- [ ] **Step 3: Run it** and add the table and source to `docs/research/free-agency-market.md` under "When the market
  signs". If no source has dates, write that down in the same section; the new lines stay warn-only with no NFL band.
- [ ] **Step 4: Record the baseline on main.** Run `npm run offseason -- 6` once on this branch before any engine
  change. Copy its free-agency lines, cap-books lines and timing into
  `docs/superpowers/plans/2026-11-20-free-agency-race-baseline.md`, with the lines within 5% of their edge marked. Also
  time one league's five free-agency days (seed `offseason-audit-3`, `performance.now()` around the
  `advanceOffseason` calls in a scratch script) and write the milliseconds down: the race may cost no more than the
  opening offers and one decision pass a day.
- [ ] **Step 5: Commit** the script, the research section and the baseline note.

### Task 2: Split the daily pass into a bid builder (no behaviour change)

**Files:**
- Create: `src/engine/offseason/bids.ts`
- Modify: `src/engine/offseason/ai.ts:1179-1452` (`aiFreeAgencyDay`)
- Test: `src/engine/offseason/bids.test.ts`

**Interfaces:**
- Produces (in `bids.ts`):
  - `export type FaPassOpts = { includeUser?: boolean; rosterMax?: number; lastCall?: boolean; starsOnly?: boolean }`
  - `export interface Bid { team: Team; offer: Offer; value: number; plan?: RestructurePlan; bridging?: boolean; cut?: Player | null }`
  - `export interface BidPass` (opaque: the league, rng, opts and every per-pass cache `aiFreeAgencyDay` keeps today)
  - `export function bidPass(league: League, rng: Rng, opts?: FaPassOpts): BidPass`
  - `export function poolOf(pass: BidPass): Player[]` (the sorted pool, star filter applied)
  - `export function skips(pass: BidPass, p: Player): boolean` (today's injury skip)
  - `export function bidsFor(pass: BidPass, p: Player): { bids: Bid[]; fallback: Bid[] }`
  - `export function pickBest(pass: BidPass, p: Player, bids: Bid[], fallback: Bid[]): Bid | null` (today's rule: the
    best bid at or above his floor, else from `CLEARING_DAY` the clearing fallback; no side effects)
  - `export function signBid(pass: BidPass, p: Player, bid: Bid): void` (makes a plan's restructure room, releases a
    funded cut, signs, and every bookkeeping line after `signPlayer` today)
  - `export function raiseTo(pass: BidPass, p: Player, bid: Bid, apy: number): Bid | null` (the bid at `apy`, re-shaped
    to the books, if the team would still make it: its upgrade bar, books and budget as `bidsFor` checks them; else null)
  - `export function floorFor(pass: BidPass, p: Player, teamId: number): number` (today's `floorAt`)

- [ ] **Step 1: Write the golden test** `bids.test.ts › 'the split pass signs exactly as before'`: build
  `createLeague({ seed: 'front-office-b' })`, `simToEndOfSeason`, `beginOffseason`, advance with `{ autoUser: true }`
  until the phase is `'draft'`, then hash `JSON.stringify(l.transactions)` plus every team's `capSpace`. Run it on the
  unchanged code, paste the printed hash in as the expected literal.
- [ ] **Step 2: Run it** (`npx vitest run src/engine/offseason/bids.test.ts`). Expected: PASS on the old code.
- [ ] **Step 3: Move the loop body into `bids.ts`** behind the interfaces above. `aiFreeAgencyDay` keeps its signature
  and becomes: `bidPass`, then for each player of `poolOf` not `skips`: `bidsFor`, `pickBest`, `signBid`; it returns
  the count. Keep every comment that explains why. Keep the draw order exactly (the hash is the proof).
- [ ] **Step 4: Run the golden test and the existing free-agency tests.**
  Run: `npx vitest run src/engine/offseason/bids.test.ts src/engine/offseason/frontOffice.test.ts src/engine/offseason/gmHabitsHooks.test.ts`
  Expected: PASS, same hash.
- [ ] **Step 5: Add `raiseTo` with its test** `'raiseTo stops at what the team would pay'`: for a bid from `bidsFor`,
  `raiseTo(pass, p, bid, bid.offer.apy * 1.05)` returns a bid with that APY, and `raiseTo` at 3× his market returns
  null. Run it, then `npm run typecheck`.
- [ ] **Step 6: Commit.**

### Task 3: The race for AI teams

**Files:**
- Create: `src/engine/offseason/race.ts`
- Modify: `src/engine/types.ts` (new types, `League.faRace`), `src/engine/generate.ts:54` (`SAVE_VERSION = 102`),
  `src/engine/migrate.ts` (v102), `src/engine/offseason/index.ts` (the `resign` → `freeAgency` step, the
  `'freeAgency'` case, the step into `'draft'`)
- Test: `src/engine/offseason/race.test.ts`

**Interfaces:**
- Consumes: everything Task 2 produces.
- Produces (in `types.ts`):
  - `export interface RaceOffer { teamId: number; offer: Offer; day: number }`
  - `export interface RaceWarning { playerId: number; day: number; answered: boolean }`
  - `export interface RaceResult { playerId: number; teamId: number; day: number; offers: number; userPlace: number | null; userDropped?: true }`
  - `export interface FaRace { season: number; offers: Record<number, RaceOffer[]>; since: Record<number, number>; warnings: RaceWarning[]; warnedSinceLead: number[]; results: RaceResult[] }`
  - `League.faRace?: FaRace` (unset until the first race; offers emptied when free agency ends, results kept until
    the next race opens, so the checks can read them at the draft)
- Produces (in `race.ts`):
  - `export const RACE = { lead: 0.08, wait: 2, patienceDays: 2, raise: 0.04 }` (starting guesses, tuned in Task 8;
    one comment each: `lead` the share his best must beat the next by in his eyes, `wait` and `patienceDays` the days
    he waits at most and the extra a patient one waits, `raise` the share an AI team behind beats the leader by)
  - `export interface RankedOffer { teamId: number; offer: Offer; value: number; floor: number }`
  - `export function rankOffers(league: League, p: Player, offers: readonly RaceOffer[]): RankedOffer[]` (valid
    offers only, value ≥ floor, best first, ties by team id)
  - `export function decides(ranked: readonly RankedOffer[], o: { waited: number; patience: number; lastDay: boolean; askApy: number }): boolean`
  - `export function openRace(league: League, rng: Rng, opts: FaPassOpts): void`
  - `export function raceDay(league: League, rng: Rng, opts: FaPassOpts): number` (signings made)
  - `export function closeRace(league: League): void`

- [ ] **Step 1: Write the `decides` tests** (pure, no league): with `RACE` as given,
  - no ranked offers → false;
  - one offer, `waited: 0` → true (nobody to beat);
  - best 1.10 vs next 1.00 in value → true; 1.05 vs 1.00 → false;
  - 1.05 vs 1.00 with `waited: 2, patience: 0` → true (waited long enough); same with `patience: 1` → false;
  - 1.03 vs 1.00 but the best's APY ≥ `askApy` → true only when 1.03 ≥ 1.00 × (1 + `RACE.lead` / 2), so pin: an
    offer at his full ask needs half the usual lead;
  - `lastDay: true` with any offer → true.
- [ ] **Step 2: Run** `npx vitest run src/engine/offseason/race.test.ts`. Expected: FAIL (`decides` not defined).
- [ ] **Step 3: Add the types, `RACE`, `rankOffers` and `decides`.** Waited-long-enough is
  `waited >= RACE.wait + Math.round(patience * RACE.patienceDays)` (patience is `Personality.patience`, 0–1).
- [ ] **Step 4: Run** the same file. Expected: PASS.
- [ ] **Step 5: Write the league tests** (one shared world at the step before free agency, JSON-copied per test, the
  way `frontOffice.test.ts` builds `afterFreeAgency`; find scenes by searching the world, never by a lucky seed):
  - `'opening offers are in and nobody signs'`: after the step into free agency, `faRace.offers` has offers for at
    least ten players and no transaction of kind `'sign'` is dated day 1;
  - `'a clear leader signs, a close race waits'`: after one `raceDay`, every result has `decides` true for its ranked
    offers that day, and some player with two or more valid offers is still unsigned with his offers standing;
  - `'AI raises stop at the team's limit'`: across the five days no AI team's standing offer for a player exceeds what
    `raiseTo` accepts for it;
  - `'no raises on the last day'`: standing AI offers before day 5's pass are never higher after it;
  - `'the last day settles everyone with a valid offer'`: after day 5, no player has a standing offer and
    `faRace.offers` is empty;
  - `'a staff-run team bids like an AI team'`: with `{ autoUser: true }` the user team appears in `faRace.offers`;
  - `'a save from before the race'`: delete `faRace` on day 2; the next advance places offers and records no result
    that day.
- [ ] **Step 6: Implement `openRace`, `raceDay` and `closeRace`.**
  - `openRace`: a `bidPass`, then for each pool player `bidsFor`; store `bids` (not `fallback`) as `RaceOffer`s and
    `since[p.id] = 1`. Nothing is signed.
  - `raceDay`, for each player of `poolOf` (best first, budgets shrinking as teams sign, as today): rebuild AI bids
    with `bidsFor`; an AI team keeps the higher of today's bid and its standing offer if `raiseTo` still accepts it, and
    drops out if `bidsFor` no longer bids; unless it's the last day, each AI bid behind the leader raises once with
    `raiseTo` to `apy × (leader.value / bid.value) × (1 + step)`, `step = RACE.raise` for a win-now GM
    (`winNow(league, team) >= 0.5`) and half that otherwise, none for a gun-shy GM at his position (`gunShyAt`);
    `rankOffers`; if `decides`, sign the best with `signBid` and push a `RaceResult`; else from `CLEARING_DAY` with no
    valid offer, `pickBest`'s fallback signs as today; else store the valid offers back.
  - `raceDay` with `faRace` unset or from an older season calls `openRace` instead and returns 0.
  - `closeRace` empties `offers`, `since`, `warnings` and `warnedSinceLead`.
  - In `index.ts`: call `openRace(league, rng, { includeUser: auto })` right after `league.faDay = 1`; replace
    `aiFreeAgencyDay(league, rng, { includeUser: auto })` in `case 'freeAgency'` with `raceDay(...)`; call
    `closeRace(league)` where the phase becomes `'draft'`.
  - v102 in `migrate.ts`: nothing to change (an unset `faRace` opens at the next day); one comment saying so.
- [ ] **Step 7: Run** `npx vitest run src/engine/offseason/race.test.ts src/engine/offseason/bids.test.ts` and
  `npm run typecheck`. Expected: PASS. The golden hash in `bids.test.ts` is now expected to change (the race signs
  differently); update its literal with a one-line comment that the race moved it, after checking only free-agency
  transactions differ.
- [ ] **Step 8: Commit.** Other tests that pinned a seeded scene may now fail: leave them for Task 8 (`CLAUDE.md`: make
  the engine changes first, fix moved tests once).

### Task 4: Your offers, the warning and the stop

**Files:**
- Modify: `src/engine/offseason/race.ts`, `src/engine/offseason/index.ts` (`advanceOffseasonControlled`),
  `src/engine/trade/rules.ts` (`tradeProblem`)
- Test: `src/engine/offseason/race.test.ts` (new `describe('your offers')`)

**Interfaces:**
- Produces (in `race.ts`):
  - `export interface RaceReply { status: 'signed' | 'standing' | 'refused' | 'broken'; message: string }`
  - `export function placeUserOffer(league: League, p: Player, offer: Offer): RaceReply`
  - `export function pullUserOffer(league: League, playerId: number): void`
  - `export function letGo(league: League, playerId: number): void`
  - `export function standingFitProblem(league: League, teamId: number, o?: { add?: { player: Player; offer: Offer }; space?: number }): string | null`
  - `export function pendingWarnings(league: League): number[]` (player ids with an unanswered warning)
  - `export function raceWarningOpen(league: League, playerId: number): boolean`
  - `export function inRace(league: League, playerId: number): boolean` (another team has a standing offer)

- [ ] **Step 1: Write the failing tests** (the user team employed, not auto):
  - `'uncontested: signs on the spot'`: a free agent with no standing offer; `placeUserOffer` at his ask →
    `status: 'signed'`;
  - `'contested: your offer stands'`: a player `inRace`; at his ask → `'standing'`, and he is still unsigned;
  - `'every rival drops out: yours at day's end'`: remove the other teams' standing offers and their room; after the
    advance he has signed with you, not before it;
  - `'under his floor: refused, patience spent'`: → `'refused'`, `league.negotiations[p.id].patience` down by one,
    nothing stored;
  - `'offers must fit together'`: two standing offers whose year-one hits together pass `capSpace` → the second is
    `'refused'` with a message naming the cap room; the same check refuses a 54th player;
  - `'lowering is refused'`: a standing offer, then a lower one → `'refused'`, message `'You can raise your offer or pull it.'`;
  - `'pulling a leading offer ends talks'`: pull while first → `negotiations[p.id].status === 'broken'`; pull while
    third → not broken;
  - `'the warning'`: arrange a player you're behind on whom `decides` would sign → after the advance he is unsigned,
    `pendingWarnings` lists him, and `advanceOffseason(league)` throws `'Answer the agents first.'`; `letGo` clears it
    with no broken talks; a raise (`placeUserOffer` higher) also clears it;
  - `'warned once per lost lead'`: after a warning and a raise that still trails, the next day he signs elsewhere with
    no second warning;
  - `'the eve of the last day warns everyone you trail'`: at day 4's end every player you have an offer on and trail
    is in `pendingWarnings`, whether or not `decides` would sign him;
  - `'two wins the same day fit'` (Review Focus 3): two standing offers that fit together both win; afterwards
    `capSpace >= 0` and the active roster is within `rosterLimit`;
  - `'an offer that no longer fits is dropped'` (Review Focus 2): after placing it, add dead money to your cap so
    `offerProblem` fails; at day's end he signs elsewhere or waits, never with you, and his `RaceResult` has
    `userDropped: true`;
  - `'a trade that breaks your offers is refused'`: during free agency, a trade taking on salary past what your standing
    offers leave → `tradeProblem` returns `standingFitProblem`'s message;
  - `'spectating: no warnings'`: unemployed (`withLeagueAi`), the race runs and `pendingWarnings` is empty.
- [ ] **Step 2: Run** `npx vitest run src/engine/offseason/race.test.ts`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `placeUserOffer`: `offerProblem` first; talks broken this phase → `'broken'`; then `standingFitProblem` with the
    offer added (its own earlier offer for him replaced); below his walk-away → call `makeOffer` (it refuses and spends
    patience) and return `'refused'`; not `inRace` and no standing offer of ours → `makeOffer` signs, `'signed'`;
    lower value than our standing offer → `'refused'`; else store, and an open warning for him is answered.
  - `standingFitProblem`: the sum of `offerCharge` over our standing offers (plus `add`) against `o.space ?? capSpace`,
    and their count plus the active roster against `rosterLimit`. Messages in the same voice as `offerProblem`.
  - `pullUserOffer`: our place first or second → `negotiationFor(...)` set `status: 'broken'`,
    `brokenPhase: 'freeAgency'`; remove the offer. `letGo`: remove it, answer the warning, no penalty.
  - In `raceDay`: our standing offer joins the ranked offers when `offerProblem` passes, else it is removed and
    `userDropped` recorded. When `decides` picks another team and we have a valid offer, we trail, and the player is not
    in `warnedSinceLead`: he waits, a `RaceWarning` is pushed and he joins `warnedSinceLead`. When we lead at judging
    he leaves `warnedSinceLead`. On day `FA_DAYS - 1`, every player we trail who isn't in `warnedSinceLead` is warned
    and waits. Results record `userPlace` (our place among valid offers, or null).
  - `advanceOffseasonControlled`: in `freeAgency`, without `autoUser`, throw `'Answer the agents first.'` while
    `pendingWarnings` is not empty.
  - `tradeProblem`: in `freeAgency`, for the user's side, `standingFitProblem(league, teamId, { space: impact[i].space })`.
- [ ] **Step 4: Run** `npx vitest run src/engine/offseason/race.test.ts src/engine/trade` and `npm run typecheck`.
  Expected: PASS (trade tests that pinned a seeded scene may move: Task 8).
- [ ] **Step 5: Commit.**

### Task 5: What a screen may read, and the letters

**Files:**
- Create: `src/engine/offseason/raceView.ts`, `src/engine/raceMail.ts`
- Modify: `src/engine/inbox.ts` (`mailSubject`, `MailSubject`, `needsYou`, `deliverMail`), `src/engine/letterRules.ts`
  (`LETTER_FILES`)
- Test: `src/engine/offseason/raceView.test.ts`, `src/engine/raceMail.test.ts`

**Interfaces:**
- Produces (in `raceView.ts`):
  - `export type RaceStatus = 'waiting' | 'weighing' | 'close'`
  - `export const STATUS_WORDS: Record<RaceStatus, string> = { waiting: 'Waiting on more offers', weighing: 'Weighing offers', close: 'Close to a decision' }`
  - `export interface RaceView { teams: { teamId: number; bar: number; you: boolean }[]; place: number | null; of: number; status: RaceStatus; leader: number | null; leaderApy: number | null; yours: Offer | null; warned: boolean }`
  - `export function raceView(league: League, playerId: number): RaceView | null` (null outside the race)
  - `export function wantsLine(league: League, teamId: number, p: Player): string | null`
- Produces (in `raceMail.ts`): `export function raceMail(league: League, have: Set<string>): Draft[]`
- Mail ids: a warning is `race:{season}:{playerId}:{day}`, a result `race:{season}:{playerId}:done`.
  `mailSubject` returns `{ kind: 'race'; season; playerId; day: number | null }` (`day` null for a result).

- [ ] **Step 1: Write the view tests:**
  - bars are tenths, the leader's 1, every bar at least 0.1: values 1.0, 0.84, 0.61 → bars 1, 0.8, 0.6;
  - `leaderApy` rounds to the nearest $0.5M: 12_840 → 13_000, 12_740 → 12_500;
  - `status` is `'close'` when `decides` would sign him now, `'weighing'` with two or more valid offers,
    `'waiting'` otherwise;
  - `place` and `of` count valid offers only; `yours` is our standing offer;
  - no field carries `value`, a personality number or another team's `Offer` (a test walks the object's keys);
  - `wantsLine` is null when `characterRead` is null; otherwise the top two of money (`greed`), a winner (`winning`)
    and staying with his old team (`loyalty`, only when his old team has an offer in), worded
    `'Money first, then a winner'`; "home" leads when a team with an offer in reads `'home'` in `clubFeeling`
    (`relationships.ts`), worded `'Home first, then money'`.
- [ ] **Step 2: Write the letter tests:**
  - a warning files once per id, `needsYou` is true until `raceWarningOpen` is false, and it names the leading team and
    the rounded number;
  - a result letter files once for each player we had an offer on: signed with us, signed elsewhere, or our offer
    dropped; none for players we never bid on;
  - `letterRules.test.ts` passes with `src/engine/raceMail.ts` added to `LETTER_FILES`.
- [ ] **Step 3: Run** `npx vitest run src/engine/offseason/raceView.test.ts src/engine/raceMail.test.ts`. Expected: FAIL.
- [ ] **Step 4: Implement** the view and the letters. Letters are signed by `director(league)` and start with the news.
  A warning reads like "Marcus Hale's agent called. Kansas City is ahead of us at about $13M a year, and he is close to
  picking a team. He will wait one day for our answer." A result says who he picked, the deal when public, and what
  tipped it when one thing did. No colon, semicolon or dash inside a sentence. In `deliverMail`, add `raceMail` to the
  `freeAgency` block and to the `draft` block (the last day's results).
- [ ] **Step 5: Run** the two files plus `npx vitest run src/engine/letterRules.test.ts src/engine/inbox.test.ts`,
  then `npm run letters` and read the new lines in `.check/letters.txt`. Expected: PASS, no rule breaks.
- [ ] **Step 6: Commit.**

### Task 6: The screens

**Files:**
- Create: `src/ui/race.tsx`
- Modify: `src/ui/screens/FrontOffice.tsx` (`FreeAgents`), `src/ui/negotiation.tsx` (`NegotiationDialog`),
  `src/ui/App.tsx` (`offseasonStep`), `src/ui/mail.tsx` (a card for kind `'race'`), `src/styles.css`
- Test: `src/ui/race.test.tsx`, `src/ui/freeAgencyDoor.test.tsx`

**Interfaces:**
- Consumes: `raceView`, `STATUS_WORDS`, `wantsLine` (Task 5); `placeUserOffer`, `pullUserOffer`, `letGo`,
  `pendingWarnings`, `raceWarningOpen` (Task 4).
- Produces (in `race.tsx`): `RaceChips({ league, view, max = 3 })`, `RacePlace({ view })`,
  `RacePanel({ league, player, view })`.

- [ ] **Step 1: Write the failing UI tests:**
  - `freeAgencyDoor.test.tsx › 'the agents stop the day'`: with one pending warning, `offseasonStep(league).label` is
    `'Answer 1 agent'` and its route opens the warning letter; with two, `'Answer 2 agents'`; with none, today's
    `Next free-agency day (d/5)`;
  - `race.test.tsx`: the Free agents tab in `freeAgency` shows the columns Teams in, Your offer and Status, a chip per
    team in (the first three and `+n`), the row of a player we bid on has class `has-offer`; Market and Ask columns
    show only outside the free-agency days;
  - `race.test.tsx`: the dialog for a player in the race shows "What matters to him", one bar per team, the agent's
    line, and the primary button reads `Make offer` (or `Update offer` when ours stands); `Pull offer` shows when ours
    stands, and `Let him go` replaces it while a warning is open.
- [ ] **Step 2: Run** `npx vitest run src/ui/race.test.tsx src/ui/freeAgencyDoor.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**, following the mockup's variant B and `docs/UI.md` (names through `PlayerLink`/`TeamLink`,
  sortable headers with `SortTh`, icons through `Icon`, the type scale in `styles.css`):
  - chips in team colours, ours in `var(--marker)` with `var(--marker-ink)`; the place as a dot and words (Leading,
    "2nd of 4", None); `tr.has-offer` an inset left edge in `var(--marker)`;
  - the dialog's race panel sits between the player head and the ask; the result callout after a standing offer reads
    "Your offer is in."; the sliders stay;
  - the mail card for a warning: the player, the race panel and the two answers (Improve your offer opens the dialog,
    Let him go calls `letGo`); a result letter has no card;
  - `offseasonStep` in `freeAgency`: while employed and `pendingWarnings` is not empty, the step is the agents' stop.
- [ ] **Step 4: Run** the two files, `npx vitest run src/ui/ui.test.ts` (the screen contract) and `npm run typecheck`.
  Expected: PASS.
- [ ] **Step 5: Read the words.** `npm run copy`, then read every new line in `.check/copy.txt` against "Words on a
  screen". Shoot the tab and the dialog at phone and desktop width (`npm run screens -- --routes office/fa`) and compare
  with the mockup.
- [ ] **Step 6: Commit.**

### Task 7: The check's new lines

**Files:**
- Modify: `scripts/free-agency-core.ts`, `scripts/offseason.ts`
- Test: `scripts/free-agency-core.test.ts` (create if absent, beside `scripts/band.test.ts`)

**Interfaces:**
- Produces: `export function raceMeasures(l: League): { byDay: number[]; eliteDay: number; contested: number; n: number }`
  in `free-agency-core.ts`: from `faRace.results` of players whose deal is at least `GOOD` of the cap, the cumulative
  share signed by each day 1–5, the mean day an `ELITE` player signed, and the share signed with two or more valid
  offers.

- [ ] **Step 1: Write the test** for `raceMeasures` on a hand-built `faRace.results` (three GOOD results on days 1, 1
  and 3, one with two offers → `byDay` [0.67, 0.67, 1, 1, 1], `contested` 0.33).
- [ ] **Step 2: Run it.** Expected: FAIL.
- [ ] **Step 3: Implement** and print two lines per season in `scripts/offseason.ts` with `soft(...)` (warn-only,
  a new known issue `FA_RACE` naming this spec): "signed by day 2 %" and "contested %", their ranges from Task 1's
  research (or `0–100` with "not measured" when it found no source), plus the elite mean day, printed only.
- [ ] **Step 4: Run** the test and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 8: Tune, fix what moved, document, review

**Files:**
- Modify: `src/engine/offseason/race.ts` (`RACE`), tests that pinned a moved scene, `docs/MVP.md`,
  `docs/VERSIONING.md`, `docs/GAME_DESIGN.md` (the roadmap's "Next"), `src/ui/changelog.ts`, `package.json`
  (0.4.54 → 0.4.55), `CLAUDE.md` (one architecture line for `race.ts`, `bids.ts`, `raceView.ts`, `raceMail.ts`)

- [ ] **Step 1: Steer with a fast probe.** One league, three offseasons (`npm run offseason -- 3`), read the race lines
  and the free-agency lines against the baseline note. Move `RACE` one knob at a time.
- [ ] **Step 2: Stop rule.** Stop when every existing offseason line is inside its band and the race lines sit near
  Task 1's NFL timing, or after three rounds, whichever comes first. Record each round's numbers in the baseline note.
  If three rounds don't get the existing lines green, stop and bring the numbers to the owner; no band moves.
- [ ] **Step 3: Judge with the real check.** `npm run offseason -- 6`, then `npm run morale` (who signs where spills
  into moods and meetings; meetings a club a season failed at 6 and stood at 5.55 after 0.4.48). Expected: no ✗.
  Re-time the five free-agency days with Task 1's scratch script; more than about 1.5× the baseline goes back to the
  pass, not into the plan's tolerance.
- [ ] **Step 4: Fix the moved tests once.** `npm test`; for each failure caused by the race, make the test find its
  scene in the world instead of re-pinning a seed. Expected: PASS.
- [ ] **Step 5: Documents.** `docs/MVP.md`: a new section "0.5: The offseason comes alive" with three items (the
  free-agency race Done, compensatory picks and suspensions open). `docs/VERSIONING.md`: "After alpha, the middle number
  goes up when a milestone in `docs/MVP.md` is finished." `docs/GAME_DESIGN.md`: the "Next" list brought up to date
  (training, morale and holdouts shipped). A changelog entry (title ≤ 40 characters, one or two sentences ≤ 200) and
  the version bump.
- [ ] **Step 6: Format and type-check.** `npm run format`, `npm run typecheck`. Expected: clean.
- [ ] **Step 7: A fresh reviewer** reads the whole branch against the spec before any pull request (a sonnet subagent
  with the spec and the diff; fix what it finds, re-run the touched tests).
- [ ] **Step 8: Commit and push** to `claude/amazing-hypatia-dpa9ud`. A pull request only when the owner asks; once it
  is open, read CI and fix what is red in one push.
