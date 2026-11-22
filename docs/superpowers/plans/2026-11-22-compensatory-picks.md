# Compensatory Picks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teams earn compensatory picks (rounds 3–7, at most 4) for qualifying free agents they lose, net of the ones
they sign, awarded at the next new league year, and the user sees where a decision moves a pick.

**Architecture:** One engine module, `src/engine/offseason/comp.ts`, owns the rule. It reads this league year's
free-agency signings as they are logged (each outside signing now records the team he walked from and his yearly pay),
freezes each team's result when camp opens (`League.compOwed`), and awards the picks at the next new league year just
before `setDraftOrder`, which places them at the end of their rounds. Screens and letters read the same functions.

**Tech Stack:** TypeScript, Vitest, React.

**Spec:** `docs/superpowers/specs/2026-11-22-compensatory-picks-design.md`

## Global Constraints

- Engine stays pure: no `Math.random`, nothing drawn for comp picks (the tally is a pure read of what happened).
- `League` stays plain JSON. Shape changes: `DraftPick.comp?: true`, `DraftPick.compFor?: number`,
  `Transaction.from?: number`, `Transaction.apy?: number`, `League.compOwed?: CompOwed[]`,
  `Player.draft.slot?: number`. Bump `SAVE_VERSION` to 103 with a plain step in `migrate.ts` (nothing to convert).
- Salaries are in thousands. Pay share = yearly pay ÷ `capFor(league, season)`.
- Fog of war: a projection on a screen uses `demand(league, p, league.userTeamId).market`, never ratings.
- Every screen line follows `docs/UI.md` "Words on a screen"; every letter line `docs/NEWS.md` "Words in a letter"
  (American football English: team, never club; no semicolons, no colon or dash inside a sentence). Run `npm run copy`
  after screen text and keep `letterRules.test.ts` green; a new letter file goes in `LETTER_FILES`.
- The word on screens and in letters is "compensatory pick"; the draft list's short mark is "Comp".
- Tests find their scene (search the league for one) rather than pin a lucky seed.
- AI front offices do not change who they keep or sign because of comp picks.
- Version 0.4.57 (a piece of the 0.5 milestone, patch per `docs/VERSIONING.md`), changelog entry; `docs/MVP.md`'s
  Compensatory picks line to Done; `CLAUDE.md` architecture gets one line for `comp.ts`.
- Run `npm run format` before each commit. Commits end with the session's attribution lines.

## Review Focus

1. **A round longer than 32 picks**: every reader that turns `overall` into a round or a slot (rookie contracts, the
   draft history table, cap books, trade values, the draft room) still names the right round and slot when rounds 3–7
   carry comp picks. Tests in Task 2.
2. **A player who walks and comes back**: signing with his own team after the market opens is never a loss or a gain
   (no `walked` departure is written for it). Test in Task 1.
3. **A signing after camp opens or a cut veteran**: neither counts; the freeze at camp ignores later signings. Tests in
   Tasks 1–2.
4. **A team that earns more than four**: only its four best are awarded; cancelling uses the best gain first. Test in
   Task 1.
5. **A save from 0.4.56 mid-offseason**: loads, has no `compOwed`, awards nothing for that year and does not crash any
   screen line. Test in Task 2.

---

### Task 1: The rule (`comp.ts`) and the signing record

**Files:**
- Create: `src/engine/offseason/comp.ts`, `src/engine/offseason/comp.test.ts`
- Modify: `src/engine/types.ts` (`Transaction.from?`, `Transaction.apy?`), `src/engine/finance/cap.ts`
  (`logTransaction` takes optional `{ from, apy }`), `src/engine/offseason/negotiation.ts` (~405–455: the signing
  function passes `from` = the team he walked from and `apy` = `offer.apy` when it writes `noteDeparture(..., 'walked')`)

**Interfaces:**
- Produces:
  - `COMP: { floor: number; bands: { round: 3 | 4 | 5 | 6 | 7; share: number }[]; max: number; on: boolean }` —
    starting values `floor 0.008`, bands `3: 0.06, 4: 0.035, 5: 0.02, 6: 0.012, 7: 0.008`, `max 4`, `on true`
    (Task 3 tunes floor and bands).
  - `compRound(apy: number, cap: number): 3 | 4 | 5 | 6 | 7 | null`
  - `interface CompMove { playerId: number; teamId: number; round: 3|4|5|6|7; apy: number }`
  - `compMoves(league: League, season?: number): { losses: CompMove[]; gains: CompMove[] }` — this league year's
    qualifying signings (`kind 'sign'`, `from` set, phase `freeAgency` or `draft`); `teamId` is the team that lost him
    for a loss, the team that signed him for a gain.
  - `compTally(league: League, teamId: number, opts?: { extraGain?: { playerId: number; apy: number } }):
    { picks: CompMove[]; cancelled: { loss: CompMove; by: CompMove }[] }` — cancelling and the cap of `COMP.max`,
    picks best first (round, then apy). `extraGain` asks "what if I signed him" for the offer dialog.

- [ ] **Step 1: Write failing tests** in `comp.test.ts`, each on a league built with `createLeague` and transactions
  written through the real signing function where practical (else `logTransaction` with `from`/`apy`):
  - `compRound`: a share at each band's edge lands in that band; under the floor is `null`.
  - a player who walks and signs elsewhere is one loss for the old team and one gain for the new;
  - a player who walks and re-signs with his own team is neither;
  - a released veteran who signs elsewhere is neither (no `from`);
  - a signing in `preseason` is neither;
  - cancelling: gain round 4 cancels a loss round 4 before a loss round 5; a gain round 5 with losses 3 and 6 cancels
    the 6; a gain round 3 with losses 5 and 6 cancels the 5;
  - six round-6 losses and no gains give four picks;
  - `extraGain` changes the result as signing him would.
- [ ] **Step 2: Run** `npx vitest run src/engine/offseason/comp.test.ts` — fails (module missing).
- [ ] **Step 3: Implement** the types, `logTransaction` option, the negotiation hook and `comp.ts`.
- [ ] **Step 4: Run** the comp tests and `npx vitest run src/engine/offseason src/engine/finance`; `npm run typecheck`.
  Recording two optional fields draws nothing, so no golden should move; if one does, find out why before re-pinning.
- [ ] **Step 5: Commit** "Compensatory picks: the rule, read from free agency's signings".

### Task 2: Freeze, award and the draft order

**Files:**
- Modify: `src/engine/offseason/comp.ts` (freeze, award), `src/engine/offseason/index.ts` (freeze when the calendar
  moves into `preseason`; award inside `beginOffseason` just before `setDraftOrder` at ~163),
  `src/engine/offseason/draft.ts` (`setDraftOrder` places comp picks; record `slot` on the drafted player),
  `src/engine/generate.ts` (`SAVE_VERSION` 103; `rookieContract` takes the pick's round instead of
  `Math.ceil(overall / 32)`; check `rookieApy`/`rookieBonusShare` hold for overall up to 7×32+32),
  `src/engine/migrate.ts` (v103 step), `src/engine/types.ts` (`DraftPick.comp?`, `compFor?`, `League.compOwed?`,
  `CompOwed`, `Player.draft.slot?`), `src/ui/screens/Draft.tsx:549` (slot from `d.slot ?? d.pick - (d.round-1)*32`),
  `src/ui/screens/Draft.tsx:361` (sort by `overall`, falling back as now)
- Test: `src/engine/offseason/comp.test.ts`, `src/engine/migrate.test.ts`, `src/engine/offseason/draft.test.ts`

**Interfaces:**
- Consumes: `compTally`, `COMP` (Task 1).
- Produces:
  - `interface CompOwed { season: number; teamId: number; playerId: number; round: 3|4|5|6|7; apy: number }`
    (`season` = the league year of the free agency that earned it).
  - `freezeComp(league: League): void` — writes every team's `compTally(...).picks` for `league.season` into
    `league.compOwed`, once (idempotent).
  - `awardComp(league: League): DraftPick[]` — at the new league year (after `league.season++`), turns entries with
    `season === league.season - 1` into `DraftPick`s `{ season: league.season, round, originalTeamId: teamId, ownerId:
    teamId, comp: true, compFor: playerId }` with fresh ids, removes them from `compOwed`, returns them.
  - `setDraftOrder` numbering: regular picks of round r in order, then round r's comp picks ordered by `apy`
    descending (then team id), `overall` continuous across the whole draft.

- [ ] **Step 1: Failing tests**: freeze writes once and ignores later signings; award adds the picks once, for the new
  league year, then `compOwed` holds none of that year; `setDraftOrder` gives continuous `overall`, comp picks last in
  their rounds by apy; a comp 3rd's rookie contract gets a round-3 guarantee; the drafted player's `draft.slot` is his
  place in his round (33+ for a comp pick); a v102 save migrates to 103 with no `compOwed`.
- [ ] **Step 2: Run** the tests — fail.
- [ ] **Step 3: Implement.** Then grep `src/engine` and `src/ui` (not tests) for `* 32`, `/ 32`, `% 32`, `224`,
  `DRAFT_ROUNDS * 32` and fix any other reader that assumes 32 a round (known safe: `pickOverall`, `capBooks.ts:74`,
  `directorAdvice.ts:54`, `draftRoom.tsx`; `chart()` in `trade/value.ts` clamps at 257, which is fine).
- [ ] **Step 4: Run** `npx vitest run src/engine/offseason src/engine/trade src/engine/migrate.test.ts src/ui/screens`,
  `npm run typecheck`. Then `npm run offseason -- 6` and `npm run trades` once each, one at a time: both exit 0. Comp
  picks change the draft, so goldens and seeded scenes may move: re-pin a golden only with a note on why, and re-aim a
  test to find its scene rather than swap a seed.
- [ ] **Step 5: Commit** "Compensatory picks: frozen at camp, awarded at the new league year, last in their rounds".

### Task 3: Tune the bands and report them

**Files:**
- Create: `.check/probe-comp.ts` (scratch, not committed)
- Modify: `src/engine/offseason/comp.ts` (`COMP` numbers with their source comment), `scripts/offseason.ts` (one report
  line a season)

- [ ] **Step 1:** Probe: four leagues of four seasons (`createLeague` + the offseason calendar as `scripts/offseason.ts`
  plays it), counting awarded comp picks a year in total and by round.
- [ ] **Step 2:** Tune `COMP.floor` and `COMP.bands` toward the target: about 32 a year league-wide (stop when within
  ±4), each round between 4 and 10 a year. At most three probe rounds; if it won't settle, stop and report the numbers.
- [ ] **Step 3:** Add to `scripts/offseason.ts` a per-season report line (not judged):
  `  comp picks: 31 (R3 5 · R4 6 · R5 7 · R6 6 · R7 7) · teams with one 17`.
- [ ] **Step 4:** `npm run offseason -- 6` exits 0; `npx vitest run src/engine/offseason`.
- [ ] **Step 5: Commit** "Compensatory picks: bands tuned to about 32 a year".

### Task 4: What the user sees on screens

**Files:**
- Modify: `src/engine/offseason/comp.ts` (view helpers), `src/engine/offseason/raceView.ts` or a new
  `src/engine/compView.ts` (words only), `src/ui/screens/FrontOffice.tsx` (Re-sign row ~224; free-agency line ~558),
  `src/engine/contractMail.ts` (the row's note), `src/ui/negotiation.tsx` (~219, after the career outlook),
  `src/ui/screens/Draft.tsx` (pick list ~355–430: "Comp" mark), `src/engine/trade/value.ts` (`pickLabel` adds
  ` (comp)` for a comp pick)
- Test: `src/engine/compView.test.ts`, `src/ui/ui.test.ts` screen contract stays green, the touched UI tests

**Interfaces:**
- Consumes: `compRound`, `compTally`, `COMP` (Task 1).
- Produces (words only, no numbers but the round):
  - `walkLine(league: League, p: Player): string | null` — "If he signs elsewhere, likely a 4th-round compensatory
    pick next year." from `compRound(demand(league, p, league.userTeamId).market, capFor(league, league.season))`;
    `null` when he would not qualify.
  - `cancelLine(league: League, p: Player, apy: number): string | null` — "Signing him cancels the 4th-round
    compensatory pick you are on track for (J. Smith)." when `compTally` with `extraGain` cancels a loss of the user's;
    `null` otherwise (including outside free agency or for a player who did not walk from another team).
  - `tallyLine(league: League): string | null` — "Compensatory picks on track: a 4th (J. Smith), a 6th (R. Lee)."
    while free agency runs, `null` with none.
- [ ] **Step 1: Failing tests** for the three lines on found scenes (a user player who would qualify and one who
  would not; a free agent whose signing cancels a loss and one whose signing doesn't; a tally with two and with none),
  and `pickLabel` with a comp pick.
- [ ] **Step 2: Run** — fail. **Step 3: Implement** and place the lines (each a muted one-line paragraph or the row
  note; nothing shown when `null`).
- [ ] **Step 4:** `npm run typecheck`, the touched tests, `npx vitest run src/ui/ui.test.ts`, `npm run copy` and read
  the new lines in `.check/copy.txt`.
- [ ] **Step 5: Commit** "Compensatory picks on screen: letting him walk, signing one, the tally, the draft list".

### Task 5: The director's letter and SNN

**Files:**
- Create: `src/engine/compMail.ts` (add to `LETTER_FILES` in `letterRules.ts`)
- Modify: `src/engine/inbox.ts` (`deliverMail`, the `phase === 'resign'` block ~3154, model on `futuresKeptMail` ~264),
  `src/engine/snnDays.ts` (a `compCandidates` in the `day === 'draft'` branch of `dayCandidates` ~711),
  `src/engine/snnDayVoice.ts` (its words)
- Test: `src/engine/compMail.test.ts`, `src/engine/letterRules.test.ts`, the snnDays tests

**Interfaces:**
- Consumes: `awardComp`'s picks (`DraftPick.comp`, `compFor`) in the user's team's list for `league.season`.
- Produces: `compMail(league: League, have: Set<string>): InboxMessage[]` — id `comp:{season}`, from the director,
  category `contracts`, one opening sentence and one sentence a pick ("A 4th-round compensatory pick for J. Smith,
  who signed with Denver."), nothing when the user's team got none. SNN: on draft day, one candidate about the user's
  team's comp picks when it has any, and one per other team's round-3 comp pick; tiles, never the lead.
- [ ] **Step 1: Failing tests**: the letter files once at the new league year with the right picks and none without;
  `letterRules` holds its lines; the draft-day edition carries the user's comp line and a rival's 3rd, nothing for a
  rival's 5th.
- [ ] **Step 2: Run** — fail. **Step 3: Implement.**
- [ ] **Step 4:** the tests above, `npm run typecheck`, `npm run editions -- --days` once and read the draft-day lines
  in `.check/day-editions.md`.
- [ ] **Step 5: Commit** "Compensatory picks: the director's letter and SNN on draft day".

### Task 6: Docs, version, changelog

**Files:** `docs/MVP.md` (Compensatory picks → Done, one line with the files and the spec), `CLAUDE.md` (one
architecture line for `offseason/comp.ts`), `package.json` 0.4.57, `src/ui/changelog.ts` (title ≤ 40 characters, text
≤ 200, e.g. "Compensatory picks" / "Lose a good free agent and you may get a pick back next year. The Re-sign tab and
free agency show when."), `docs/superpowers/specs/2026-11-22-compensatory-picks-design.md` (any decision that changed
in the build: the freeze at camp in `compOwed`).

- [ ] **Step 1:** Edit; `npx vitest run src/ui/changelog`; `npm run format`.
- [ ] **Step 2: Commit** "0.4.57: compensatory picks".
