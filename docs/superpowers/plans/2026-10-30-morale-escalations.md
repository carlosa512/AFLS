# Morale part 4 (G4): being heard, hold-ins, holdouts and trade requests — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** answers to a player's talk soften the grievance they answer; a talk that ends badly can become a hold-in, a
holdout or a trade request; AI clubs keep the promises they make.

**Architecture:** three pull requests on one branch line, each green before the next starts. Part 1 is a change inside
`moraleFactors`. G4a and G4b add `src/engine/disputes.ts` (start, run and end each dispute at the end of every morale
step, after `talkStep`) and a leaf module `src/engine/disputeRead.ts` (import-type only: the dial and the small readers
the roster, training, development and lineup code need, so no import loop forms). Letters follow `talkMail.ts`.

**Tech stack:** TypeScript, Vitest, React (screens), the repo's `npm run` checks.

**Spec:** `docs/superpowers/specs/2026-10-30-morale-escalations-design.md`

## Global Constraints

- Run vitest with `--maxWorkers=2` (more runs the container out of memory).
- Never loosen a range in `npm run morale` (or any check) to get green. If a range can't be met, stop and tell the
  owner why, with the numbers. The spec names two that may move by design: promises kept (25–75%) and underpaid
  final-year starters Poor or worse (60%+). Measure them; never change them without the owner.
- Fog of war: screens read `moraleView` (and the new `disputeView`), never `p.morale`, and only for the user's players;
  a private trade request is invisible to every other club's AI and screens.
- No `Math.random`. Moods still draw nothing. Disputes draw only from their own stream:
  `new Rng(`${league.seed}:dispute:${league.season}:${p.id}`)`.
- `League` stays plain JSON. `SAVE_VERSION` 71 with an upgrade step in `migrate.ts` (G4a).
- Salaries in thousands of dollars: the camp fine is `2250`; a game check is `base / 18`.
- Never force push. `npm run format` before each commit. Commit trailer: the session's Co-Authored-By and Claude-Session
  lines. No model names in commits or PRs.
- A session runs only the unit tests it touched and the area's check at a small size; CI runs the rest. Read CI on each
  PR and fix what's red before calling it ready.
- Versions (`docs/VERSIONING.md`): Part 1 0.2.26, G4a 0.2.27, G4b 0.3.0 (finishes the Morale and holdouts MVP item).

## Review Focus

1. **A holdout traded or released while on Did Not Report.** Traded: he reports to his new club (back on the 53), the
   dispute and the old club's withheld weeks clear with the base reset. Released: unattached, no dispute left. Test in
   Task 5.
2. **An injured man.** No dispute starts while he's hurt or on IR; IR outranks Did Not Report in `rosterList`. Test in
   Task 4.
3. **Your job changes mid-dispute.** Fired, hired elsewhere or unemployed: the letter closes (`employed`) and the AI
   answers for the club from the next step. Test in Task 8.
4. **Old saves.** A v70 save mid-season with promises open and no `answered.cause` or `sour`: loads, softens only open
   promises, starts nothing from stale data. Test in Task 3.
5. **`autoUser` runs** (`npm run offseason`, `morale`, `careers`): your club's disputes are answered by the AI's rule,
   so the checks count every club alike. Test in Task 10.

---

# PR 1 — Being heard (0.2.26)

### Task 1: Answers soften the grievance they answered

**Files:**

- Modify: `src/engine/types.ts` (`Talk.answered`), `src/engine/morale.ts`, `src/engine/playerTalks.ts`
- Test: `src/engine/morale.test.ts`, `src/engine/playerTalks.test.ts`

**Interfaces:**

- Produces: `Talk.answered.cause?: TalkCause`; `export const QUIET = 8` in `morale.ts` (moved from `playerTalks.ts`,
  which imports it); `export const CAUSE_FACTOR: Record<TalkCause, 'role' | 'contract' | 'team' | 'room'>`
  (`snaps → role`, `deal → contract`, `losing → team`, `feud → room`);
  `export function heardWeight(p: Player, factor: keyof MoraleFactors, clock: number): number` (1 when nothing softens).

- [ ] **Step 0: Baseline.** On the current branch before any change: `npm run morale` and note the two numbers the
      spec says may move ("Underpaid final-year starters, Poor or worse" and "Talks: promises kept"). Keep the output in
      the scratchpad for Task 2.

- [ ] **Step 1: Write the failing tests** in `morale.test.ts`, `describe('being heard (G4 part 1)')`. Pick an underpaid
      rostered man (`moraleFactors(l, p, ctx).contract <= -1`), set `l.moraleAt = clock`:

```ts
it('an open deal promise leaves a quarter of a negative contract factor', () => {
  p.morale!.talk = { club: p.teamId!, promise: { kind: 'deal', made: clock, due: clock + 20 } };
  expect(moraleFactors(l, p, ctx).contract).toBeCloseTo(0.25 * base, 9);
});
it('scales by trust: one broken leaves 0.4375, four or more all of it', () => {
  // talk.broken = 1 → 1 − 0.75 × 0.75; talk.broken = 4 → 1
});
it('a reassurance takes a quarter off the factor it answered until the quiet ends, an eighth the second time', () => {
  // answered = { reply: 'reassure', at: clock, ask: clock, cause: 'deal' }, reassured = 1 → 0.75 × base
  // l.moraleAt = clock + QUIET → base; reassured = 2 at clock → 0.875 × base
});
it('softens only the factor answered, never a positive one, nothing without a cause', () => {
  // snaps promise: contract unchanged, role × 0.25 when negative; a happy contract (> 0) unchanged; answered without
  // cause → unchanged
});
it('reads "Waiting on his new deal" while a deal promise is open', () => {
  expect(moraleReasons(l, p, moraleFactors(l, p, ctx))).toContain('Waiting on his new deal');
});
```

      In `playerTalks.test.ts`: `it('records what an answer was about')`: `answerTalk(l, id, 'reassure')` sets
      `talk.answered.cause` to the ask's cause; an ignored letter records it too.

- [ ] **Step 2: Run them, see them fail:** `npx vitest run src/engine/morale.test.ts src/engine/playerTalks.test.ts
--maxWorkers=2`.

- [ ] **Step 3: Implement.** `applyReply` writes `cause` into `answered`. `heardWeight`:
      open promise whose kind maps to `factor`: `1 − 0.75 × max(0, 1 − 0.25 × broken)`; `answered.reply === 'reassure'`,
      its cause maps to `factor` and `clock < answered.at + QUIET`: × `(1 − 0.25 × 0.5 ** ((reassured ?? 1) − 1))`.
      `moraleFactors` multiplies each of `role`, `contract`, `team`, `room` by its weight only when it's negative, reading
      `clock = league.moraleAt ?? moraleClock(league)`. `FACTOR_WORDS` stays; `moraleReasons` swaps the down word for
      "Waiting on his new deal" (contract, deal promise open) or "Waiting on his snaps" (role, snaps promise open), and
      both join `DOWN_REASONS`. `CAUSE_OF` gets no entry for them (a man with a promise open doesn't ask).

- [ ] **Step 4: Run the tests, see them pass**, plus `src/engine/talkMail.test.ts`, `lockerReport.test.ts`,
      `morale.rng.test.ts` and `npm run typecheck`.

- [ ] **Step 5: Commit** ("Morale: an answer softens the grievance it answered").

### Task 1b: The promises reminder at the season's end

**Files:**

- Create: `src/engine/promiseMail.ts`
- Modify: `src/engine/lockerVoice.ts` (`PROMISES_SUBJECT`, `PROMISES_LEAD`: the head coach's lines, through `say`),
  `src/engine/inbox.ts` (`MailSubject` `{ kind: 'promises'; season: number }`, `mailSubject` case `'promises'`,
  `needsYou`, `deliverMail` adds `promiseMail`), `src/ui/mail.tsx` (the rows render through `MailSections`)
- Test: `src/engine/promiseMail.test.ts`

**Interfaces:**

- Produces: `export function promiseMail(league: League, have: Set<string>): Draft[]` (id `promises:${league.season}`);
  `export function promisesNeedYou(league: League, m: InboxMessage): boolean`.

- [ ] **Step 1: Failing tests** (`promiseMail.test.ts`), on a league played to `phase === 'complete'` with open promises
      set on your players:
  - `it('files one letter when the season is complete, a row per open promise to your players')`: a deal row's note is
    "A new deal by the end of the re-sign window" and carries `contract: { playerId }`; a snaps row says the games left
    and that they carry into next season; another club's promised man has no row.
  - `it('files nothing without an open promise, while unemployed, or twice')`.
  - `it('needs you while a deal on it is still open')`: true, then false once he's signed (or the promise breaks).
  - `it('reads its subject back')`: `mailSubject` of `promises:2029` is `{ kind: 'promises', season: 2029 }`.
- [ ] **Step 2: Run, fail:** `npx vitest run src/engine/promiseMail.test.ts --maxWorkers=2`.
- [ ] **Step 3: Implement** like `contractMail.ts` (sender `headCoach(league)`, category `staff`, `sections: [{ title:
'Promises to keep', rows }]`, `actions: [{ kind: 'locker' }]`). Check that a `contract` row's live buttons offer
      Negotiate for a man with two years left too; if `ContractCards` only knows expiring players, give it that one path.
- [ ] **Step 4: Run, pass**, plus `src/ui/ui.test.ts` and typecheck.
- [ ] **Step 5: Commit** ("Mail: the head coach's reminder of promises at the season's end").

### Task 2: Measure, document, ship PR 1

**Files:** `docs/MVP.md` (the Morale line), `package.json` (0.2.26), `src/ui/changelog.ts`, `CLAUDE.md` (the
`morale.ts` note: "an answer softens the grievance it answered while it holds")

- [ ] **Step 1:** `npm run morale`. Compare with Step 0. Everything else must stay ✓. If "Underpaid final-year starters"
      falls under 0.6 or "promises kept" leaves 25–75%, stop and bring the owner both runs' numbers; change nothing.
- [ ] **Step 2:** Docs, version, changelog ("Players you promise a deal or reassure now feel it until the quiet runs
      out", and "The head coach reminds you of your open promises when the season ends"); `npm run format`; commit;
      push; open the PR (template if any); read CI; fix red.

---

# PR 2 — G4a: contract disputes and promises kept (0.2.27)

### Task 3: The data, the dial, the readers, save v71

**Files:**

- Create: `src/engine/disputeRead.ts`
- Modify: `src/engine/types.ts`, `src/engine/personnel/types.ts` (`RosterList` gains `'didNotReport'`),
  `src/engine/roster.ts` (`rosterList`), `src/engine/generate.ts` (`SAVE_VERSION = 71`), `src/engine/migrate.ts`,
  `src/engine/morale.rng.test.ts`
- Test: `src/engine/disputes.test.ts` (new), `src/engine/migrate.test.ts`

**Interfaces (produces, used by every later task):**

```ts
// types.ts
export type DisputeKind = 'holdIn' | 'holdOut' | 'trade';
export type DisputeChoice = 'negotiate' | 'promise' | 'firm' | 'shop' | 'refuse';
export interface Dispute {
  kind: DisputeKind;
  cause: TalkCause;
  since: number; // morale clock it started
  out?: true; // a holdout on Reserve/Did Not Report (from camp's step)
  fined?: number; // camp fines, $K
  lost?: number; // fines plus withheld checks, $K: what giving in reads
  answered?: { choice: DisputeChoice; at: number };
  public?: number; // G4b: the clock it leaked
  refused?: true; // G4b
}
export type DisputeHow = 'signed' | 'traded' | 'promise' | 'gaveIn' | 'week1' | 'withdrawn' | 'released' | 'newYear';
// Morale gains: dispute?: Dispute; disputeEnd?: { kind: DisputeKind; since: number; how: DisputeHow; at: number };
//               rust?: { season: number; week: number }
// Talk gains:   sour?: { cause: TalkCause; at: number; run: number; after?: DisputeKind }
// Talk.promise gains: dispute?: DisputeKind
// ContractYear gains: withheld?: number   // weeks
// Player gains: lostAccrual?: number      // the season a holdout lost
```

```ts
// disputeRead.ts — imports types only
export const MOOD_ACTS = { on: true }; // disputes and the AI keeping promises; morale.rng.test.ts turns it off
export const disputeOf = (p: Player): Dispute | undefined;
export const onDidNotReport = (p: Player): boolean; // dispute.kind === 'holdOut' && dispute.out
export function notPracticing(league: League, p: Player): boolean; // a hold-in before week 1; a holdout any time
export function rustKnock(league: League, p: Player): number; // 1 his first week back, 0.5 the next, else 0
```

- [ ] **Step 1: Failing tests** (`disputes.test.ts`): `rosterList` returns `'didNotReport'` for a holdout with `out`,
      `'injuredReserve'` when he's also on IR, `'unattached'` once released; `activeRoster` leaves him out;
      `isAvailable` false. `rustKnock`: 1 / 0.5 / 0 by `league.week − rust.week`, 0 in another season, 0 with
      `MOOD_ACTS.on = false`. `migrate.test.ts`: a v70 save upgrades to 71 unchanged but for the version (old talks with
      no `answered.cause` or `sour` load and step without throwing).
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** the types, the leaf module, `rosterList` (after `teamId === null`, after IR, before
      `'active'`), the save bump and an empty upgrade step. `morale.rng.test.ts` mocks `./disputeRead` with
      `MOOD_ACTS: { on: false }` beside the `moodScale` mock, and its comment says why.
- [ ] **Step 4: Run, pass** (`disputes.test.ts`, `migrate.test.ts`, `morale.rng.test.ts`, `roster` tests), typecheck.
- [ ] **Step 5: Commit.**

### Task 4: Who escalates

**Files:**

- Create: `src/engine/disputes.ts`
- Modify: `src/engine/playerTalks.ts` (`applyReply`, `settle`), `src/engine/morale.ts` (`moraleAdvance` calls
  `disputeStep` after `talkStep`)
- Test: `src/engine/disputes.test.ts`

**Interfaces:**

- Consumes: Task 3's types and `MOOD_ACTS`; `talkCause`, `moraleFactors`, `moraleLevel`, `moraleStepOf`,
  `expectedRole`; `extensionBlocker` (`offseason/negotiation.ts`); `yearsLeft`.
- Produces: `export function disputeStep(league: League, ctx: MoraleContext, clock: number, week: number, newYear:
boolean): void` (Tasks 5, 7, 11 extend it); `export function disputeKind(league: League, p: Player, ctx:
MoraleContext): 'holdIn' | 'holdOut'`; `export const RUN_STEPS = 4`.

- [ ] **Step 1: Failing tests:**
  - `it('sours a talk answered firm or left unanswered, and a broken promise')`: `talk.sour = { cause, at, run: 0 }`;
    a later reassure or promise clears it.
  - `it('starts a hold-in after four Very poor steps since, with the cause still on top')`: drive `moraleAdvance` at
    clocks 0–3 with his level pinned ≤ −3 and an underpaid two-years-left deal: no dispute through the third, a
    `holdIn` at the fourth; a step at Poor or better resets `run` to 0.
  - `it('starts a contract dispute only in the re-sign window to camp')`: the same man run in season keeps counting and
    starts at the next league year's step 0.
  - `it('needs a deal he can be extended out of')`: three years left, or a rookie deal before his fourth season: none.
  - `it('makes a greedy veteran starter a holdout, everyone else a hold-in')`: `greed 0.6`, `expectedRole 2`, off his
    rookie deal (or in its exercised fifth-year option) → `holdOut`; any of the three missing → `holdIn`.
  - `it('starts one a club a step, the unhappiest first, and none for a hurt man')`.
  - `it('starts nothing with MOOD_ACTS off')`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** `applyReply`: `ignored`/`firm` set `sour` (cause = the ask's); `promise`/`reassure` delete
      it. `settle(…, false)` sets `sour` (cause = the promise's kind; `after = promise.dispute` when it had one). In
      `disputeStep`, for each rostered man with `sour` and no dispute: `run = level ≤ −3 ? run + 1 : 0`; eligible when
      `run ≥ RUN_STEPS`, `talkCause(...) === sour.cause`, not hurt or on IR, and (cause `deal`) week 0–7, a contract with
      `yearsLeft ≤ 2` and no `extensionBlocker`. Per club, the lowest level first, one start. Starting: `morale.dispute =
{ kind: disputeKind(...), cause, since: clock }`, delete `sour`. Causes other than `deal` wait for G4b (no start).
- [ ] **Step 4: Run, pass**, plus `playerTalks.test.ts` and `morale.test.ts`.
- [ ] **Step 5: Commit.**

### Task 5: A dispute runs and ends

**Files:** `src/engine/disputes.ts`, `src/engine/finance/contract.ts` (`capHit`), `src/engine/personnel/service.ts`
(`serviceSeasons`), `src/engine/trade/execute.ts` (the base reset at line ~70 also clears `withheld`) · Test:
`disputes.test.ts`,
`src/engine/finance/contract.test.ts`

**Interfaces:**

- Produces: `export const CAMP_FINE = 2250`; `export function giveInLimit(league: League, p: Player): number`
  (`base × (0.05 + 0.45 × (greed + 1 − patience) / 2)`, base from `yearOf(contract, season)`); `export function
endDispute(league: League, p: Player, how: DisputeHow, clock: number): void` (writes `disputeEnd`, sets `rust` when he
  missed camp, sours the talk again for `week1` and `gaveIn` with `after: kind`, adds the `gaveIn` jolt).
- Adds `'gaveIn'` to `MoraleJolt` (−2, words "Gave in on his holdout").

- [ ] **Step 1: Failing tests:**
  - `it('sends a holdout to Did Not Report at camp's step')` (clock 7, or at once if it starts at 7).
  - `it('fines a holdout still out when camp ends and costs him the accrued season')`: at clock 8, `fined = lost =
2250`, `p.lostAccrual = season`, and `serviceSeasons` doesn't count that season even with six weeks credited.
  - `it('withholds a game check each regular-season week he's out and credits his club's cap')`: after three weeks
    `yearOf(c).withheld === 3`, `capHit` falls by `3 × base / 18` (rounded), `lost` rises by the same.
  - `it('gives in at his limit, reports with rust, and sours the talk')`: a calm man reports at clock 8 (rust week 1);
    a resolve-1 star on a $20M base reports when `lost ≥ 0.5 × base` (about week 7); jolt `gaveIn`; `sour.after ===
'holdOut'`.
  - `it('ends a hold-in at week 1: he plays, with rust if camp passed him by')`.
  - `it('ends on a raise, a trade or a release')`: `signed` (fines forgiven: `lost` dropped with the record), `traded`
    (back on the 53 at his new club, the new base's `withheld` cleared), `released` (unattached).
  - `it('ends a holdout still out at the new league year')` (`newYear`, counted as giving in).
  - `it('keeps an AI club at 53 when he reports')`: `aiCutdown(league, team, ROSTER_MAX)` after his return.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement** in `disputeStep` (before starts, so a man doesn't start and run in one step): clock 7 sets
      `out`; clock 8 fines holdouts still out and ends hold-ins (`week1`); each step after a regular-season week's games
      (week 9–26 on the clock, at most 18 checks) adds a withheld week; then the give-in check. `capHit` subtracts
      `round(base × withheld / 18)`. `serviceSeasons` skips the +1 for `lostAccrual === through + 1`. A club change or
      release ends it (`traded` / `released`), read where `talkStep` already sees `talk.club !== p.teamId`; a `paid` jolt at
      this clock ends it as `signed`.
- [ ] **Step 4: Run, pass**, plus `finance/contract.test.ts`, personnel tests.
- [ ] **Step 5: Commit.**

### Task 6: What a dispute costs in practice and on game day

**Files:** `src/engine/training.ts` (`tick`), `src/engine/development.ts` (`tiltStep`), `src/engine/match/lineup.ts`
(knocks) · Test: `src/engine/moraleEffects.test.ts`

- [ ] **Step 1: Failing tests** (`describe('disputes (G4)')`): a man holding in banks no position learning at the
      program or camp (`learnBlock`); `tiltStep` reads his pull as −1 at those steps (his `dev.mood` after camp equals a
      man's at pull −1); a man with `rust` week 1 gets `+1` added to his knock in `buildLineup` that week and `+0.5` the
      next, on top of the mood edge; nothing changes with `MOOD_ACTS.on = false`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement:** `tick`'s weeks return 0 for `notPracticing`; `tiltStep` uses `−1` for `notPracticing`;
      `buildLineup` adds `rustKnock` to the knock it sets.
- [ ] **Step 4: Run, pass**, plus `training` and `release` tests.
- [ ] **Step 5: Commit.**

### Task 7: AI clubs answer disputes and keep their promises

**Files:** `src/engine/disputes.ts`, `src/engine/offseason/ai.ts` (`aiResignWindow`), `src/engine/roster.ts`
(`syncDepthChart`) · Test: `disputes.test.ts`, `src/engine/offseason/ai.test.ts` (or the nearest existing AI test)

**Interfaces:**

- Produces: `export function aiSettle(league: League, team: Team, p: Player): boolean` (signs him, true, when
  `resignCall` isn't `walk`, his `demand().walkAway` offer's `offerCharge` fits `spendable`, using the dispute stream for
  `aiOffer`); `export function promisedDeal(p: Player): boolean`.

- [ ] **Step 1: Failing tests:**
  - `it('a loyal AI GM settles a dispute it can afford, a stubborn one holds firm')`: the same GM rule as `aiReply`
    (`loyalty − stubbornness ≥ 0.2` negotiates; otherwise firm); settled → `disputeEnd.how === 'signed'`.
  - `it('keeps a deal promise in the re-sign window')`: an AI-promised expiring man is signed at his walk-away when the
    cap fits and isn't sent to test the market; `league.rngState` after the window equals a run where he wasn't
    promised (the market-test draw is still made).
  - `it('extends a promised man with two years left')`, on the dispute stream.
  - `it('breaks the promise when its own read says walk')`.
  - `it('starts a promised man for his promise's games when he's within a point')`: AI team's `syncDepthChart` puts
    him in the starting group over a starter at most 1.0 overall better; 1.5 better → no change; the user's team is
    never touched.
  - all of it inert with `MOOD_ACTS.on = false`.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.** `disputeStep` calls `aiSettle` (or records `firm`) the step an AI club's dispute starts.
      `aiResignWindow`: `testsMarket = rng.chance(...) && !promisedDeal(p)`; for a promised man, the offer is raised to
      his walk-away when that fits the budget; after the expiring loop, `aiSettle` each promised man with two years left.
      `syncDepthChart` (AI teams, `MOOD_ACTS.on`): a snaps-promised man below the starting group swaps with the last
      starter when `playerOvr` is within 1.0.
- [ ] **Step 4: Run, pass**, plus `offseason` tests.
- [ ] **Step 5: Commit.**

### Task 8: Your letters

**Files:**

- Create: `src/engine/disputeMail.ts`, `src/engine/disputeVoice.ts` (the coach's and the player's lines, through `say`)
- Modify: `src/engine/inbox.ts` (`MailSubject` `{ kind: 'dispute'; season; since; playerId }`, `mailSubject`,
  `needsYou`, `deliverMail` adds `disputeMail`), `src/engine/disputes.ts` (`answerDispute`), `src/ui/mail.tsx`
  (`DisputeCards`), `src/engine/lockerReport.ts` + `lockerVoice.ts` (a running dispute in the check-ins)
- Test: `src/engine/disputeMail.test.ts`, `src/engine/lockerReport.test.ts`, `src/ui/ui.test.ts`

**Interfaces:**

- Produces: `export function answerDispute(league: League, playerId: number, choice: DisputeChoice): boolean` (false
  unless he's yours, employed, it's open, and the choice fits: `promise` needs trust > 0; `refuse` only for a trade);
  `export function disputeCard(league: League, s: { since: number; playerId: number }): DisputeCardView` (`state:
'open' | 'answered' | 'closed'`, `kind`, `choices: DisputeChoice[]`, `said?`, `fined?`, `lost?` words);
  `export function disputeMail(league: League, have: Set<string>): Draft[]` (ids `dispute:${season}:${since}:${id}` at
  the start, `dispute-end:${season}:${since}:${id}` from `disputeEnd`).
- `promise` in a dispute: ends it (`how: 'promise'`) and opens a deal promise with `dispute: kind`, due at clock
  `season × 32 + 8` before week 1, else `clock + 2`; broken, Task 4's `sour.after` lets it restart at once (skip
  `RUN_STEPS` when `after` is set and the cause and window fit).
- `negotiate` records the answer and opens his contract talks (the UI's `onNegotiate`, disabled in the playoffs);
  `firm` records it; `shop` calls `setTradeStatus(league, id, 'listed')`.

- [ ] **Step 1: Failing tests:** one letter at the start and one at the end, from the head coach, never twice;
      `needsYou` while unanswered; buttons by kind (hold-in/holdout: negotiate, promise, firm, shop); "He won't take your
      word" with four broken promises; a promise ends the dispute and its break restarts it the next step; closed when
      you're unemployed or moved clubs (Review Focus 3), and the AI then answers for that club; ui contract tests pass.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement**, following `talkMail.ts` and `TalkCards` (nothing stored on the message).
- [ ] **Step 4: Run, pass**, typecheck.
- [ ] **Step 5: Commit.**

### Task 9: Screens

**Files:** `src/engine/disputes.ts` (`disputeView`), `src/ui/screens/LockerRoom.tsx`, `src/ui/screens/Roster.tsx`, the
player card's status line (where injuries show) · Test: `src/ui/ui.test.ts`, `disputes.test.ts`

**Interfaces:** `export function disputeView(league: League, p: Player): { kind: DisputeKind; text: string } | null`:
your players' disputes in words; for anyone's player only what's public (a holdout, a hold-in; G4b: a public request).

- [ ] **Step 1: Failing tests:** `disputeView` null for another club's private request (G4b adds the case) and for no
      dispute; Locker Room shows a Disputes section for your players; Roster lists a holdout under Did Not Report; the
      card shows "Holding out" for any club's holdout; no screen reads `p.morale` (the contract test).
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit.**

### Task 10: Checks, docs, ship PR 2

**Files:** `scripts/morale.ts`, `scripts/check.ts` (the planner's morale rule adds `disputes`, `disputeRead`,
`disputeMail`; `offseason` adds `disputes`), `docs/MVP.md`, `package.json` 0.2.27, `src/ui/changelog.ts`, `CLAUDE.md`
(a `disputes.ts` note beside `playerTalks.ts`)

- [ ] **Step 1:** `scripts/morale.ts`: your club's disputes answered by `aiSettle`'s rule (Review Focus 5); count per
      season: disputes started (range 3–12), holdouts (0.5–5), holdouts still out after week 1 (0–2 a season), and
      holdouts past their limit (0). Header comment lists them as check 8.
- [ ] **Step 2:** `npm run morale` and `npm run offseason -- 6`. Same rule as Task 2: nothing loosened; stop and report
      if a range can't be met.
- [ ] **Step 3:** Docs, version, changelog; format; commit; push; open the PR; read CI; fix red.

---

# PR 3 — G4b: trade requests (0.3.0)

### Task 11: Trade requests: start, leak, end

**Files:** `src/engine/disputes.ts`, `src/engine/trade/market.ts` (a rumor on the leak) · Test: `disputes.test.ts`

**Interfaces:** `export const LEAK_STEPS = 6`, `LEAK_LOUD = 3`; `export function wantsOut(p: Player): 'private' |
'public' | null`.

- [ ] **Step 1: Failing tests:** a soured snaps, losing or feud talk starts a `trade` dispute after `RUN_STEPS` at any
      talk step (`talksAt`); a deal cause with `sour.after` set starts one in season; private until `LEAK_STEPS` (3 for
      `controversy` z ≥ 0.5, or at once when refused and outspoken), then `public = clock` and one rumor; refused and
      still Very poor at the next camp with a contract cause in reach → a hold-in; withdrawn after four steps at Poor or
      better or when his cause is answered (`paid` jolt, a kept snaps promise); still open at the new league year and
      Very poor with a cause → stands, else withdrawn; traded → `how: 'traded'`.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit.**

### Task 12: The market reads a public request

**Files:** `src/engine/trade/plans.ts` (`tradeBlock`), `src/engine/trade/judge.ts` (the seller's floor),
`src/engine/trade/offers.ts` (`offersMoment`, `bidFor`), `src/engine/disputes.ts` (the AI's answer) · Test:
`src/engine/trade/offers.test.ts`, `src/engine/trade/trade.test.ts`, `disputes.test.ts`

**Interfaces:** `export const WANTS_OUT = 0.15` (in `judge.ts`).

- [ ] **Step 1: Failing tests:** an AI club with a public requester lists him (keenness ≥ 0.75) and its floor for him
      is `(1 − WANTS_OUT)` of what it was; a stubborn AI GM refuses a request, the rest shop it once public; your public
      requester draws calls as if listed, and bids open 10–25% under the buyer's price (deterministic from the offers
      stream); a private request moves none of this, for any club (fog of war); every AI deal still passes `judge` for
      both sides.
- [ ] **Step 2–4:** fail, implement, pass; then `npm run trades -- --seasons 1` (nothing flagged).
- [ ] **Step 5: Commit.**

### Task 13: Letters and screens for requests

**Files:** `src/engine/disputeMail.ts`, `disputeVoice.ts`, `src/ui/mail.tsx`, `disputeView` · Test:
`disputeMail.test.ts`, `ui.test.ts`

- [ ] **Step 1: Failing tests:** a request's letter offers shop, refuse, and promise (snaps or a deal, when the cause
      allows one and trust > 0); refuse records `refused`; `disputeView` shows "Wants a trade" for another club's player
      only once public; the leak and its end each file once.
- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit.**

### Task 14: Checks, docs, ship PR 3

**Files:** `scripts/morale.ts`, `scripts/check.ts` (`trades` runs for `disputes.ts`), `docs/MVP.md` (Morale and holdouts
→ done), `package.json` 0.3.0, `src/ui/changelog.ts`, `CLAUDE.md`

- [ ] **Step 1:** `scripts/morale.ts` adds: trade requests a season 4–15, public share 40–90%, of those resolved 25–75%
      traded. `npm run morale`, `npm run trades -- --seasons 1`; nothing loosened.
- [ ] **Step 2:** Docs, version, changelog; format; commit; push; open the PR; read CI; fix red.
