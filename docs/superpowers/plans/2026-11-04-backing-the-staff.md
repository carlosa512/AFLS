# Backing the Staff (L4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Head coaches and coordinators lift their rooms on Sunday by their quality and their rooms' belief in them
(MVP #11, the last item short of alpha); belief falls with bad games, louder with a Locker-Room Lawyer; you answer it
in a meeting or by relieving a coordinator mid-season, and AI clubs relieve theirs at the NFL's rate.

**Architecture:** `src/engine/belief.ts` keeps each room's belief in whoever runs its side (`Coach.belief`) and moves
it weekly after the games. `src/engine/staffEdge.ts` turns quality and belief into one centred, weekly-cached edge per
room that `buildLineup` adds to the knocks beside chemistry. `relieveCoordinator` (coaching.ts) is the one in-season
coaching move; `src/engine/relieve.ts` is the AI's call to use it. L2's meetings gain a coordinator trouble, "Stand
behind him" and "He's on notice". Part 2 adds the words and screens. **One PR** on this branch: part 1 the engine
(Tasks 1–7), part 2 the words and screens (Tasks 8–9), version 0.4.0, CI tuned once against the final state.

**Tech Stack:** TypeScript, Vitest, React (part 2), `scripts/morale.ts`, `npm run sim`.

**Spec:** `docs/superpowers/specs/2026-11-04-backing-the-staff-design.md`

## Global Constraints

- Quality `q = clamp((coachValue(c) − TYPICAL) / STAFF.span, −1, 1)`; `TYPICAL` 10.5, `STAFF.span` 3, `VACANT` 6;
  a covering head coach reads `max(VACANT, coachValue(hc) − COVER_COST)`, `COVER_COST` 3.
- Coordinator edge `STAFF.coord × clamp(STAFF.quality × q + STAFF.belief × belief, −1, 1)` for each room on his side
  (offense QB, RB, WR, OL; defense DL, LB, DB); head coach edge `STAFF.head × clamp(STAFF.quality × q +
  STAFF.belief × credibility, −1, 1)` for all seven rooms. `STAFF = { coord: 0.5, head: 0.25, quality: 0.6, belief:
  0.4, span: 3 }`. Centred per room per week, then held to ±0.75. Special teams unchanged.
- `BELIEF = { drift: 0.975, badGame: −0.06, goodGame: 0.03, loseStreak: −0.04, winStreak: 0.02, lawyer: 3, sour: 1.5,
  lands: 0.04, bristles: 0.08, kept: 0.15, broken: −0.15, warn: −0.1 }`; reads: believes ≥ 0.4, doubts ≤ −0.2, lost
  ≤ −0.5, steady between. Streaks count at three or more.
- Bad game: offense a loss scoring ≤ 13; defense a loss allowing ≥ 30; a loss by ≥ 21 both. Good game: offense a win
  scoring ≥ 28; defense a win allowing ≤ 14. Regular season and playoffs.
- Notice window 4 steps. Relieving: `preseason` and `regular` only, OC/DC only, owner's mandate blocks, severance as
  any dismissal. AI: weeks 5–14, ≥ 5 games, win share ≤ .400, side in the bottom quarter, `RELIEVE.chance` 0.15 a
  week, one a club a season, none after the owner let the head coach go that season.
- Nothing drawn except the AI's relieve draw, on `${seed}:relieve:${season}:${week}:${teamId}`. `SAVE_VERSION` 86.
- Your club only on screen, in words. Letters: no digits, no engine words ("belief", "chemistry" included).
- Never loosen a check range without the owner's call; measure against main first.
- `npm run format` before every commit; commit trailer per the session rules; push to the branch freely; open the PR
  only when the owner says go.

## Review Focus

1. An empty coordinator chair with the head coach's cover switched off, or no head coach at all: the side reads
   `VACANT` with belief 0, the edge stays finite, nothing throws (test in Task 3).
2. A coordinator moving clubs (hired away, poached, promoted) carries no belief from his old rooms (test in Task 2).
3. Old saves and stale references: `Coach.belief` unset, a `notice` whose `coord` has retired or left the league:
   reads 0, counts as gone (kept), never throws (tests in Tasks 1 and 5).
4. Relieving with nobody to step in (no head coach, no willing position coach): allowed, the side reads `VACANT`
   (test in Task 4).
5. Determinism: a game replayed with staff edges on plays the same; a week played twice from a JSON clone relieves the
   same coordinators (tests in Tasks 3 and 6).

---

## Part 1: the engine

### Task 1: types, the save and belief's store

**Files:**
- Create: `src/engine/belief.ts`, `src/engine/belief.test.ts`
- Modify: `src/engine/types.ts`, `src/engine/generate.ts` (`SAVE_VERSION`), `src/engine/migrate.ts`,
  `src/engine/migrate.test.ts`

**Interfaces:**
- Produces (types.ts):
  - `Coach.belief?: Partial<Record<CoachRoom, number>>`
  - `Team.beliefFell?: { clock: number; rooms: CoachRoom[] }` (rooms that fell past `BELIEF.warn` after a bad game in
    the last step; Task 8's staff note reads it)
  - `export type MeetingTopic = TalkCause | 'none' | 'coordinator'`, used by `Trouble.topic`,
    `MeetingSuggestion.topic`, `MeetingRecord.topic` and `choicesFor`'s `topic` param
  - `Approach` gains `'backHim'`; `Backing` gains `'notice'`
  - `Commitment.coord?: number`; `TeamMeetings.settled[].coord?: number`; `TeamMeetings.doubts?: CoachRoom[]`
  - `LeadershipEvent.kind` gains `'coachRelieved'` (the spec's `'coordRelieved'`, renamed so SNN's roundup groups it by
    its `coach` prefix)
- Produces (belief.ts):
  ```ts
  export const BELIEF = { /* Global Constraints */ };
  export type BeliefRead = 'believes' | 'steady' | 'doubts' | 'lost';
  export type SideRole = 'offCoord' | 'defCoord';
  export const SIDE_ROOMS: Record<SideRole, readonly CoachRoom[]>;
  export const sideRoleOf: (room: CoachRoom) => SideRole;
  export function beliefOf(c: Coach | null | undefined, room: CoachRoom): number;   // 0 when unset or no coach
  export function beliefRead(v: number): BeliefRead;
  export function shiftBelief(c: Coach, room: CoachRoom, by: number): void;           // clamp ±1, 4 dp
  export function startCoordinator(c: Coach): void;                                    // delete c.belief
  export function dropSide(c: Coach, role: SideRole): void;                            // delete his rooms on that side
  export function runnerOf(league: League, teamId: number, room: CoachRoom): Coach | null; // sideCoach(...)
  export const isLawyer: (p: Player) => boolean; // personalityOf(trueCharacter(p)) === 'Locker-Room Lawyer'
  ```

- [ ] **Step 1: Write the failing tests** in `belief.test.ts`:
  - `it('reads the four words at their thresholds')`: `beliefRead(0.4)` believes, `0.39` steady, `−0.2` doubts,
    `−0.49` doubts, `−0.5` lost.
  - `it('holds belief inside ±1 and reads 0 when unset or vacant')`: `shiftBelief(c, 'OL', 5)` → `beliefOf(c,'OL')`
    1; `beliefOf(undefined, 'OL')` 0; a coach with no `belief` reads 0 (Review Focus 3).
  - `it('the runner of a side is the coordinator, else the covering head coach')`: delete a club's OC (by hand, then
    `teamCoaches` re-read) → `runnerOf(l, t, 'QB')` is the head coach; set his `coverOff = ['offCoord']` → null.
  - `migrate.test.ts`: the latest version is 86.
- [ ] **Step 2:** `npx vitest run src/engine/belief.test.ts src/engine/migrate.test.ts` → FAIL (module missing).
- [ ] **Step 3:** add the types; `belief.ts` per Interfaces; `SAVE_VERSION = 86`; a no-op v86 step in `migrate.ts`
  with a comment (unset reads the middle). Fix the exhaustive `switch`es the new union members break
  (`approachLabel`, `backingLabel`, `promisePhrase`, `CAPTAIN_CLOSE`, `ANSWERS`, `WINDOW`) with placeholder text
  only where Task 5 or 8 fills it in; `npm run typecheck` clean.
- [ ] **Step 4:** re-run → PASS.
- [ ] **Step 5:** commit `Belief: a room's word on its coordinator, stored (save v86)`.

### Task 2: belief's week

**Files:**
- Modify: `src/engine/belief.ts`, `src/engine/league.ts` (`playWeek`, after `credibilityWeek`),
  `src/engine/offseason/index.ts` (`beginOffseason`), `src/engine/coaching.ts` (`signCoach`, `promoteInto`, `dismiss`)
- Test: `src/engine/belief.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces:
  ```ts
  export function sideGame(forPts: number, againstPts: number, side: 'offense' | 'defense'): 'bad' | 'good' | null;
  export function lawyerIn(league: League, teamId: number, room: CoachRoom, ctx: MoraleContext): Player | null;
  export function beliefWeek(league: League): void;     // every club, from the game it just played; sets Team.beliefFell
  export function beliefNewYear(league: League): void;  // every stored belief halved
  ```
  `lawyerIn`: the room's voices (`ctx.voices.get(\`${teamId}:${room}\`)`) that pass `isLawyer`, the heaviest by
  `weightOf`. The bad-game drop is `BELIEF.badGame × (lawyer ? BELIEF.lawyer : 1) × (lawyer sour ? BELIEF.sour : 1)`,
  sour meaning `moraleStepOf(moraleLevel(league, p)) <= 3`. Order each week: drift, then the game, then the streak
  (`computeRecords(...).streak`). A club with no game this week (bye, out of the playoffs) only drifts.

- [ ] **Step 1: Write the failing tests:**
  - `it('names bad and good games for each side')`: `sideGame(13, 20, 'offense')` bad, `(14, 20, 'offense')` null,
    `(20, 30, 'defense')` bad, `(10, 31, 'offense')` bad (a 21-point loss), `(28, 10, 'offense')` good,
    `(21, 14, 'defense')` good, `(27, 10, 'offense')` null.
  - `it('a bad game drops his side's rooms, a lawyer's room three times as far')`: one league, force one club's next
    result to a bad offensive game (set the result before calling `beliefWeek`), one offensive room with a lawyer voice
    (set his traits so `isLawyer` holds and he's a voice), one without, both at 0 and no streak running: −0.18 and
    −0.06; defense rooms unchanged by the game.
  - `it('drifts back toward the middle and halves at the new league year')`: belief −0.5, a bye week → −0.4875;
    `beliefNewYear` → `toBeCloseTo(−0.244, 3)`.
  - `it('a coordinator taking a new job starts every room at 0')` (Review Focus 2): give an OC belief, `dismiss` him
    via `releaseCoach` in the window, `hireCoach` him elsewhere → `belief` unset.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; in `playWeek` call `beliefWeek(league)` right after `credibilityWeek(league)` (same
  phases); `beliefNewYear` in `beginOffseason` after `league.season++`; `startCoordinator` in `signCoach` when
  `c.teamId !== teamId`, in `promoteInto` after the role changes, and in `dismiss`; `dropSide(hc, c.role)` where
  `signCoach` ends a head coach's cover.
- [ ] **Step 4:** `npx vitest run src/engine/belief.test.ts src/engine/meetings` → PASS.
- [ ] **Step 5:** commit `Belief: bad games wear it down, a lawyer louder; winning and time bring it back`.

### Task 3: the staff edge on game day

**Files:**
- Create: `src/engine/staffEdge.ts`, `src/engine/staffEdge.test.ts`
- Modify: `src/engine/coaching.ts` (export `VACANT`, `COVER_COST`), `src/engine/match/lineup.ts` (`buildLineup`),
  `src/engine/match/gameSim.ts` (`SimOptions`, both `buildLineup` calls), `src/engine/league.ts` and
  `src/ui/store.ts` (beside each `freshChemistry` call)

**Interfaces:**
- Consumes: `beliefOf`, `runnerOf`, `SIDE_ROOMS` (Task 1); `credibilityOf`; `coachValue`; `sideCoach`,
  `coveringHeadCoach`, `chairHolder`, `teamCoaches`; `ChemRoom`, `CHEM_ROOMS`.
- Produces:
  ```ts
  export const STAFF = { coord: 0.5, head: 0.25, quality: 0.6, belief: 0.4, span: 3 };
  export const NO_STAFF: Readonly<Record<ChemRoom, number>>;       // all 0
  export const quality: (value: number) => number;
  export function sideValue(league: League, teamId: number, role: SideRole): number; // coordinator, cover, or VACANT
  export interface StaffEdge { teamId: number; unit: ChemRoom; coord: number; head: number; edge: number }
  export function staffEdgeOf(league: League, teamId: number, unit: ChemRoom): StaffEdge | null;
  export function staffWeek(league: League): Map<string, StaffEdge>; // `${teamId}:${unit}`
  export function freshStaff(league: League): void;
  // lineup.ts
  buildLineup(league, team, out?, game?, mean?, today = 0, chem?, staff?: Partial<Record<ChemRoom, number>>)
  // gameSim.ts
  SimOptions.staff?: [home: Partial<Record<ChemRoom, number>>, away: Partial<Record<ChemRoom, number>>]
  ```
  Cache like chemistry's: a `WeakMap<League, …>` keyed on `[season, phase, week, moraleAt ?? moraleClock]`, holding
  each room's raw edge and the league's mean per room; `edge = clamp(raw − mean, −0.75, 0.75)`.

- [ ] **Step 1: Write the failing tests** in `staffEdge.test.ts` (one league after two weeks, as `chemistry.test.ts`
  builds it):
  - `it('a great coordinator his rooms believe in gives the whole part, a doubted one little')`: with `q` forced
    through a coach whose `youth` and `veterans` are both 13.5 (`coachValue` 13.5, `q` = 1): belief 1 → coord part 0.5; belief −1 → 0.1; a 10.5 coach at
    belief −1 → −0.2; a 7.5 coach at −1 → −0.5 (assert the raw parts, before centring).
  - `it('the head coach counts for all seven rooms at half the reach')`: head part within ±0.25, the same for every room
    of a club.
  - `it('is centred on the league and inside its cap')`: every room's league mean |edge| < 0.01; every edge ≤ 0.75.
  - `it('reads a vacant side as a replacement and never throws')` (Review Focus 1): remove a club's DC, cover off;
    `staffEdgeOf(l, t, 'DB').coord` equals `STAFF.coord × clamp(STAFF.quality × −1, −1, 1)` before centring and every
    edge is finite; same with no head coach.
  - `it('a side forced to each end moves its own stats the right way')`: 200 replays of `l.games[0]` with
    `{ seed: \`s:${i}\`, days: [0, 0], chemistry: [NO_CHEM, NO_CHEM], staff: [{ QB: x, RB: x, WR: x, OL: x }, {}] }`
    for x = ±0.5: home points and total yards higher at +0.5; then `staff: [{}, { DL: x, LB: x, DB: x }]`: home
    yards lower at +0.5. Split into two `it`s, timeout 240 s each (one long test starves the worker).
  - `it('plays the same game twice with staff edges on')` (Review Focus 5).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; in the knocks loop add a `staffOf(p)` beside `chemOf(p)` (same room, `ST` 0, 0 without a
  game), subtracted with the other edges; `gameSim` passes `options.staff?.[side]` to both calls; `freshStaff` beside
  each `freshChemistry` call.
- [ ] **Step 4:** run the new tests → PASS. Then the whole engine suite in the background
  (`npx vitest run src/engine > <workspace>/l4-suite.log 2>&1`): where a test already passes `chemistry: [NO_CHEM,
  NO_CHEM]` to read something else, pass `staff: [NO_STAFF, NO_STAFF]` too; re-pin a world-pinned value only when
  staff edges moved it, and list each in the commit body.
- [ ] **Step 5:** commit `Lineup: coaches lift their rooms on Sunday by their quality and their rooms' belief`.

### Task 4: relieving a coordinator mid-season

**Files:**
- Modify: `src/engine/coaching.ts` (`dismiss` options, new exports)
- Test: `src/engine/coaching.test.ts`

**Interfaces:**
- Consumes: `startCoordinator`, `dropSide` (Task 1); `ownerCoachProblem`, `promoteInto`, `promotionFor`, `refusal`,
  `setHeadCoachCover`, `budgetProblem`, `moveOverspend`.
- Produces:
  ```ts
  export type Cover = 'headCoach' | number;   // a position coach's id on that side
  export function interimCandidates(league: League, teamId: number, role: SideRole): Coach[]; // would step up, by value
  export function relieveProblem(league: League, teamId: number, coachId: number, cover?: Cover, budget?: boolean): string | null;
  export function relieveCoordinator(league: League, teamId: number, coachId: number, cover?: Cover): void;
  export function relievedReport(league: League, teamId: number, c: Coach): string;
  ```
  Every relief, yours or an AI club's, logs `leadershipEvent(l, { teamId, kind: 'coachRelieved', coachId, report:
  relievedReport(...) })` so SNN can report it (spec §3.4); the report reads
  `` `${abbrev} relieved ${title} ${name} of his duties (${w}–${l}; ${ordinal(rank)} of ${n} in points ${scored|allowed})` ``.
  `dismiss(league, c, why?, opts?: { verb?: string; headline?: boolean })`; relieving passes `verb: 'relieved'`,
  `why: 'of his duties'`, `headline: true` → log "PIT relieved offensive coordinator … of his duties". A position
  coach interim goes through `promoteInto(league, teamId, pc, 1)` (his chair empties until the window). Problems, in
  order: not `preseason`/`regular` → "Coordinators can be relieved from camp through the regular season."; not a
  coordinator of `teamId` → "Only your offensive or defensive coordinator can be relieved in season."; the owner's
  mandate; a cover id not in `interimCandidates` → "He won't step up into that chair."; then the budget for the
  interim's raise (when `budget`).

- [ ] **Step 1: Write the failing tests:**
  - `it('relieves a coordinator only in camp and the regular season')`: `relieveProblem` null in `regular`, the camp
    message in `resign` and `playoffs`; a head coach's id gives the coordinator message.
  - `it('an owner's mandate blocks it and severance is booked')`: `protectCoach` the OC → the mandate message;
    unprotected → after `relieveCoordinator`, `team.coachDead` holds his severance and he's on the market.
  - `it('the head coach covers by default and the rooms start fresh')`: give the OC's rooms belief −0.6, relieve with
    no cover arg → `runnerOf(l, t, 'OL')` is the head coach, `beliefOf(hc, 'OL')` 0, the hc's `coverOff` no longer
    holds `offCoord`.
  - `it('a position coach can step up as interim')`: relieve with `interimCandidates(...)[0].id` → he's the OC, his old
    room chair empty, `beliefOf(him, 'QB')` 0.
  - `it('with nobody to step in the side reads vacant')` (Review Focus 4): no head coach, no candidates → relieve
    succeeds, `sideValue` is `VACANT`.
  - `it('logs the change for SNN')`: one `coachRelieved` leadership event with the club and coach ids.
- [ ] **Step 2:** run `npx vitest run src/engine/coaching.test.ts -t relieve` → FAIL.
- [ ] **Step 3:** implement per Interfaces.
- [ ] **Step 4:** re-run, then `npx vitest run src/engine/coaching.test.ts src/engine/belief.test.ts` → PASS.
- [ ] **Step 5:** commit `Coaching: relieve a coordinator mid-season (head coach covers, or a position coach steps up)`.

### Task 5: answering doubt in a meeting

**Files:**
- Modify: `src/engine/meetings/suggest.ts` (`troubles`, `noteRooms`, `choicesFor`), `react.ts` (`REACT`,
  `speakerTerm`, `ANSWERS`, `holdMeeting`), `commitments.ts` (`WINDOW`, `openCommitment`, `isKept`, `settle`),
  `ai.ts` (`backingFor`), `src/engine/belief.ts`
- Test: `src/engine/meetings/suggest.test.ts`, `react.test.ts`, `commitments.test.ts`, `src/engine/belief.test.ts`

**Interfaces:**
- Consumes: Tasks 1–3 (`beliefRead`, `beliefOf`, `runnerOf`, `lawyerIn`, `isLawyer`, `quality`, `sideValue`).
- Produces:
  ```ts
  // belief.ts
  export function meetingBelief(league: League, teamId: number, record: MeetingRecord, weights: Map<number, number>): void;
  // react.ts REACT gains
  backFresh: 0.2, backLost: -0.25, backLawyer: -0.5
  // commitments.ts
  WINDOW.notice = 4;  ANSWERS.notice = 'losing'
  ```
  - **Trouble:** a room whose runner's belief reads `doubts` or `lost` and isn't in `TeamMeetings.doubts` → `{ scope:
    room, topic: 'coordinator', driver: lawyerIn(...)?.id }`. Sort the room troubles by rank: Down and `lost` 0,
    `doubts` 1, Split 2 (then the lower mood or belief). `noteRooms` records `doubts` (rooms at `doubts` or worse).
  - **Choices** (topic `coordinator`, a room scope): `'backHim'` first in `approaches`, then the existing rules;
    `'notice'` before `'words'` in `backings`; no `namedFor.notice`.
  - **Reaction:** `speakerTerm` `'backHim'`: `backFresh` when the room reads `doubts` and the runner's `q ≥ 0`, else
    `backLost`; plus `backLawyer` when `p.id === s.driver && isLawyer(p)`.
  - **Belief from any meeting:** `holdMeeting` calls `meetingBelief` after the credibility shift with each man's weight;
    for each room in scope (a team meeting: all seven, each by its own men), `shiftBelief(runner, room,
    (BELIEF.lands × landShare − BELIEF.bristles × bristleShare) × (approach === 'backHim' ? 2 : 1))`.
  - **Notice:** `openCommitment` sets `coord` to the room's runner id; `isKept` `'notice'`: the room's runner is no
    longer `coord` (or `coord` is missing from `league.coaches`), or his belief reads `steady`/`believes`; `settle`
    copies `coord` into `settled` and shifts the room's current runner by `BELIEF.kept` or `BELIEF.broken`.
  - **AI:** `backingFor` returns `'notice'` when `gm.loyalty <= 1 − AI.lean` and it's offered (Task 6 makes a kept AI
    notice real).

- [ ] **Step 1: Write the failing tests:**
  - `suggest.test.ts` `it('a room turning on its coordinator is trouble once, its lawyer driving it')`: set an OL
    runner's belief −0.3 → `troubles` holds `{ scope: 'OL', topic: 'coordinator' }` with the lawyer as driver when the
    room has one; after `noteRooms`, not again until it climbs above −0.2 and falls back.
  - `it('offers Stand behind him and He's on notice for it')`: `choicesFor(..., 'coordinator', ...)` has `'backHim'`
    first and `'notice'` in `backings`; another topic offers neither.
  - `react.test.ts` `it('standing behind him fits a fresh doubt, not a lost room, and the lawyer bristles')`: the same
    man's `reactionScore` for `backHim` is higher at `doubts` than at `lost`; the driver who is a lawyer scores lower
    than another man.
  - `belief.test.ts` `it('a meeting that lands lifts the room's belief, standing behind him twice as much')`: a record
    where all weight landed: +0.04, with `backHim` +0.08; all bristled: −0.08 / −0.16.
  - `commitments.test.ts` `it('a notice is kept when the room climbs out or the man is gone, broken when neither')`:
    belief back to −0.1 → kept and +0.15; coordinator relieved → kept; window closes at −0.3 with him there → broken
    and −0.15; a `coord` id deleted from `league.coaches` → kept, no throw (Review Focus 3).
- [ ] **Step 2:** run `npx vitest run src/engine/meetings src/engine/belief.test.ts` → FAIL.
- [ ] **Step 3:** implement per Interfaces.
- [ ] **Step 4:** re-run → PASS; `npm run typecheck`.
- [ ] **Step 5:** commit `Meetings: doubt in a coordinator is trouble; stand behind him, or put him on notice`.

### Task 6: AI clubs relieve coordinators

**Files:**
- Create: `src/engine/relieve.ts`, `src/engine/relieve.test.ts` (the spec puts this in `coaching.ts`; it's its own file
  because `coaching.ts` is past 2,000 lines and this is the AI's judgment, not a move)
- Modify: `src/engine/league.ts` (`playWeek`, after `beliefWeek`), `src/engine/meetings/commitments.ts`
  (`judgeCommitments`), `src/engine/inbox.ts` (only if the roundup needs the new kind named)

**Interfaces:**
- Consumes: `relieveCoordinator`, `relieveProblem`, `interimCandidates`, `sideValue` (Tasks 3–4); `beliefRead`,
  `SIDE_ROOMS`; `heatSoFar`, `talentRanks`; `computeRecords`; `managesTeam`.
- Produces:
  ```ts
  export const RELIEVE = { chance: 0.15, from: 5, to: 14, games: 5, share: 0.4, bottom: 0.25, winNow: 0.5, loyalty: 0.5, heat: 0.5 };
  export function onTheTable(league: League, teamId: number, role: SideRole): boolean;
  export function aiCover(league: League, teamId: number, role: SideRole): Cover; // higher of cover value and best interim; ties the head coach
  export function aiRelieveNow(league: League, teamId: number, coachId: number): boolean; // relieve + event; false when a problem stands
  export function aiRelieve(league: League): void;
  ```
  - `onTheTable`: all three of the spec's conditions (≥ `games` played and win share ≤ `share`; the side's points for or
    against this regular season in the worst `bottom` share of clubs; more than half the side's rooms at `doubts` or
    worse, or a `settled` notice this season with `kept: false` and `coord` = him), no `coachRelieved` event for the
    club this season, no `coachInterim` event this season.
  - `aiRelieve`: regular season, `league.week` (the week just played) in `from..to`, AI clubs only; per club, the OC
    then the DC, one draw each on `${seed}:relieve:${season}:${week}:${teamId}`: `chance × clamp(1 + winNow ×
    (gm.winNow − 0.5) × 2 − loyalty × (gm.loyalty − 0.5) × 2 + heat × coachHeat / 4, 0.25, 2)`, `coachHeat` from
    `heatSoFar(...).coach`. At most one a club.
  - `aiRelieveNow` is `relieveProblem(..., aiCover(...), false)` then `relieveCoordinator` (which logs the event).
  - `judgeCommitments`: an AI `notice` the draw keeps, whose `coord` still runs the room, goes through `aiRelieveNow`;
    if it returns false the notice is broken.

- [ ] **Step 1: Write the failing tests:**
  - `it('off the table unless the club is losing, the side is among the worst and the rooms have turned')`: a built
    case meets all three → true; each one undone in turn → false.
  - `it('never touches your club, and at most once a club a season')`: force every condition and `chance` 1 (through
    a test-only override param or by setting `RELIEVE.chance` and restoring it) → user's coordinator stays; an AI club
    loses one coordinator, not two.
  - `it('picks the better of the head coach's cover and an interim')`: a strong position coach beats a weak head coach
    less `COVER_COST`, and the reverse.
  - `it('relieves the same men when a week is played twice')` (Review Focus 5): `playWeek` on two JSON clones gives the
    same `coachRelieved` events.
  - `it('SNN's roundup carries it')`: `leadershipMail(l, new Set())` includes the event's report.
  - `it('an AI notice kept by its GM is kept by relieving him')`: the notice settles `kept`, and the coordinator is gone.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; `aiRelieve(league)` right after `beliefWeek(league)` in `playWeek`.
- [ ] **Step 4:** `npx vitest run src/engine/relieve.test.ts src/engine/meetings src/engine/leadership.test.ts` → PASS.
- [ ] **Step 5:** commit `AI clubs relieve a coordinator mid-season when it's come to that; SNN reports it`.

### Task 7: the checks and calibration

**Files:**
- Modify: `scripts/morale.ts` (header list, a `staffSample()` beside `chemistrySample()`, the checks), `scripts/check.ts`
  (morale rule gains `staffEdge|belief|relieve`), `CLAUDE.md` (architecture notes for the three modules and
  `relieveCoordinator`; the `npm run morale` line)

- [ ] **Step 1: Gather the NFL's list.** Recent seasons' in-season coordinator firings (2015 on): club, role, week,
  record at the time. Save it as a table at the end of the spec's §3.5 with its sources. It sets the band below:
  [half the list's lowest season, its highest season] a season league-wide.
- [ ] **Step 2: Add the checks** (spec §5.1), each through `check(label, value, [lo, hi])`:
  - `Staff edge: league mean (worst room, worst week)` in [0, 0.02].
  - `Belief: rooms in doubt at some point in a season` in [0.10, 0.25]; `Belief: rooms lost` in [0, 0.08].
  - `Belief: lawyer rooms doubt more`: share with a lawyer voice minus share without, in [0.01, 1].
  - `Notice: kept share` in [0.2, 0.8].
  - `AI relieved coordinators a season` in the Step 1 band; `…every one losing and bottom quarter` share = 1;
    `…most in one club's season` ≤ 1.
- [ ] **Step 3: Run** `npm run morale` on the branch and on main (worktree of `origin/main`, `node_modules` linked),
  and `npm run sim -- 10`. Tune `BELIEF.badGame`, `BELIEF.lawyer` and `RELIEVE.chance` (only) until the shares sit in
  their bands on the default seed and `--seed m2`, `--seed m3`. Win spread or any existing line out of range: compare
  with main on the same seeds and bring the numbers to the owner; never loosen a range without his call. Time
  `npm run sim -- 10` on both: the branch within about 5% of main (spec §5.2).
- [ ] **Step 4:** CLAUDE.md notes; `npm run format`, `npm run typecheck`. Commit `Morale check: the staff edge,
  belief and coordinators relieved (L4)`; push (no PR). Report the calibration numbers to the owner; anything near an
  edge waits on his call before Task 8.

---

## Part 2: the words and screens

### Task 8: the coach's words

**Files:**
- Modify: `src/engine/roomFacts.ts`, `src/engine/roomVoice.ts`, `src/engine/staffNotes.ts`, `src/engine/lockerReport.ts`,
  `src/engine/meetings/voice.ts`, `src/engine/meetings/facts.ts`
- Test: `src/engine/roomVoice.test.ts`, `src/engine/staffNotes.test.ts`, `src/engine/lockerReport.test.ts`,
  `src/engine/meetings/voice.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 2, 5 (`beliefRead`, `runnerOf`, `lawyerIn`, `Team.beliefFell`).
- Produces:
  ```ts
  // roomFacts.ts
  export interface BeliefFact { unit: CoachRoom; read: BeliefRead; coach: string; lawyer?: string; side: 'offense' | 'defense' }
  export function beliefFact(league: League, teamId: number, unit: CoachRoom, ctx: MoraleContext): BeliefFact | null;
  export const beliefKey = (clock: number, teamId: number, unit: CoachRoom, read: BeliefRead) => `belief:${clock}:${teamId}:${unit}:${read}`;
  export const beliefWarnKey = (clock: number, teamId: number, unit: CoachRoom) => `belief-warn:${clock}:${teamId}:${unit}`;
  // lastTold(...) gains belief: Map<CoachRoom, { read: BeliefRead; clock: number }>
  // roomVoice.ts: BELIEF_WARN (position coach), BELIEF_NOTE (head coach), BELIEF_LINE (card), BELIEF_STAFF (Coaches)
  // staffNotes.ts
  export function beliefRows(league: League, told: Set<string>): StaffRow[];
  ```
  The spec's §4 examples are the copy to start from. `beliefRows`: one warn row per room in `Team.beliefFell` at this
  step's clock, in the room's position coach's voice, naming the lawyer when there is one. The locker report tells a
  room's read when it changed since last told, as its chemistry block does. Meetings: `approachLabel('backHim')` "Stand
  behind him", `backingLabel('notice')` "He's on notice", `promisePhrase('notice')` "that things would change", the
  coordinator trouble's lead and why lines in `READ_LEAD`/`READ_WHY`, `TOLD`/`WENT`/`NEXT`/`DUE` lines for the notice.

- [ ] **Step 1: Write the failing tests:** the banks pass the existing `say` contract tests (no digits, no banned
  words, every line reachable); `beliefRows` gives one row the step a room falls and none the next; the report tells a
  room once per change; `approachLabel`/`backingLabel` return the two labels.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement. **Step 4:** `npx vitest run` on those files → PASS;
  `npm run mail-preview` and read the letters.
- [ ] **Step 5:** commit `Words: the staff warns first, then the head coach; the meeting's two new choices`.

### Task 9: the screens, screenshots, version and the PR

**Files:**
- Modify: `src/ui/screens/LockerRoom.tsx`, `src/ui/screens/Coaches.tsx`, `src/ui/meetings.test.tsx`, `src/ui/ui.test.ts`
  (if a screen contract needs it), `docs/MVP.md`, `src/ui/changelog.ts`, `package.json`

- [ ] **Step 1: Write the failing tests:** the Locker Room card shows `BELIEF_LINE` only at `believes`, `doubts` or
  `lost`, with the coordinator's name as a `PlayerLink`-style coach link; the Coaches screen shows `BELIEF_STAFF` for
  your coordinators only, and a "Relieve him" button only in `preseason`/`regular` that shows the severance and the
  cover choice (head coach, or each of `interimCandidates`) before it calls `relieveCoordinator`, or the
  `relieveProblem` text when blocked.
- [ ] **Step 2:** run → FAIL. **Step 3:** implement, following `docs/UI.md`. **Step 4:** `npx vitest run src/ui` and
  `npm run typecheck` → PASS.
- [ ] **Step 5: Screenshots** (`npm run screens`) of the card lines, the Coaches line and the relieve flow, the
  meeting letter and the staff note; send them to the owner.
- [ ] **Step 6:** `docs/MVP.md` #11 to Done (`[x]`, what it does now) and the score line to "15 Done · 0 Partial";
  version 0.4.0 in `package.json`; a changelog entry (alpha). Commit `0.4.0: coaches matter on Sunday (MVP #11,
  alpha)`; push. Open the PR only when the owner says go, then read CI and fix what's red.
