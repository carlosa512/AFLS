# Locker room, part 2 (L2): team meetings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Head coaches hold meetings (you approve the approach, what's behind it and the timing), GMs can address the
team in a crisis, commitments are kept or broken, and every head coach carries a credibility the league can read: his
arc, in letters, SNN's weekly roundup, his card and a small push on the hot seat.

**Architecture:** A new engine folder `src/engine/meetings/` owns it all: credibility, suggestions, reactions,
commitments, the GM address and AI decisions, each a small module behind `meetings/index.ts`. Moods change only through
the existing jolt machinery (`addJolt`). The calendar calls one weekly and one offseason hook. Letters and screens
come in PR 2, after their renders are approved; SNN, the coach card and the hot seat in PR 3.

**Tech Stack:** TypeScript, Vitest, React (server-rendered in tests), `tsx` scripts, Playwright via `npm run screens`.

**Spec:** `docs/superpowers/specs/2026-11-02-team-meetings-design.md` (and L1's
`docs/superpowers/specs/2026-11-01-locker-room-voices-design.md` §6 for the writing rules).

## Global Constraints

- No `Math.random`. Each meeting draws only from its own stream:
  `new Rng(\`${league.seed}:meeting:${season}:${clock}:${teamId}:${scope}\`)`, where `scope` is a unit or `team`
  or `gm`. Mail never draws.
- `League` stays plain JSON. `SAVE_VERSION` goes from 75 to 76, with a `migrate.ts` step. Old saves get empty meeting
  logs and every head coach at credibility 0.
- Moods move only through `addJolt` (a new kind, `meeting`) and the existing `kept`/`broken` jolts. No mood spreads from
  player to player (that's L3).
- Constants (pinned by this plan; tune only the reaction weights and the credibility steps in Task 9, never a check's
  range):
  - Cooldowns: a room every 4 weeks; the team (trouble) every 6; one suggestion a week at most; the GM address once a season.
  - Outcome: lands when score ≥ 0.5, bristles when score ≤ −0.5, else a shrug.
  - Jolt base 2 (on the mood level); timing ×1.5 after the game, ×1 Monday, ×0.6 Wednesday; a moment ×0.7; "the
    standard" ×0.5; the GM address ×2. A broken commitment's dip is 1.5× the lift the man got.
  - Commitment windows: snaps 3 weeks, talks 4 weeks or the deadline, a feud 4 weeks, a move until the deadline, "no one's job is safe" 3 weeks.
  - Credibility in −1…1: "the room believes him" ≥ 0.4; "they've heard it before" ≤ −0.2; "his word has worn thin" ≤ −0.5.
    Drifts ×0.97 a week toward 0. A new head coach starts at 0 with two "new voice" meetings (+0.2 each).
  - Hot seat: the coach's existing heat × (1 + 0.25 × wornness), wornness = clamp(−credibility, 0, 1). Zero record heat stays zero.
- Every line follows L1 §6.2 (a judgment with its fact, the man before the room, count like a coach, no digits, claim
  only what the engine does) and is picked by `say()`.
- Screens show your club only. Another club's credibility is public only as words (its card line, SNN); its meetings
  and reactions are private.
- **No letter or screen code before its render is approved by the owner** (Task 10).
- Before each commit: `npm run format`, `npm run typecheck`, the touched tests. From Task 4 on, `npm run morale -- --seasons 2` when moods can move.

## Review Focus

1. **A named man leaves during a commitment's window** (traded, cut, retired): the commitment is void for him: neither
   kept nor broken, and the rest of it is judged on whoever is left. (Task 5 test.)
2. **The head coach is fired while a suggestion or commitment is open:** the suggestion lapses. Open commitments stay
   the club's (judged as usual), and the new coach starts at 0 with his new-voice boost. (Task 5 and Task 2 tests.)
3. **A named man is hurt during a snaps window:** the window extends by the weeks he can't play, so an injury is never
   a broken promise. (Task 5 test.)
4. **The season ends or the deadline passes with commitments open:** deadline commitments close at the deadline; all
   others are judged at the season's end. Nothing leaks into the next league year. (Task 5 test.)
5. **Your GM takes a job at another club:** your old club's pending suggestion lapses and the new club starts with
   none of it. (Task 7 test.)

---

## PR 1: the engine

### Task 1: Data and the save

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/generate.ts` (`SAVE_VERSION` 76), `src/engine/migrate.ts`
- Test: `src/engine/migrate.test.ts`

**Interfaces:**
- Produces, in `types.ts`:
  ```ts
  export type MeetingScope = CoachRoom | 'team';
  export type Approach = 'leader' | 'straight' | 'callout' | 'losing' | 'standard' | 'ownIt' | 'raiseBar' | 'freshStart';
  export type Backing = 'snaps' | 'talks' | 'feud' | 'move' | 'jobs' | 'words';
  export type Timing = 'afterGame' | 'monday' | 'wednesday';
  export type MeetingKind = 'moment' | 'trouble' | 'gm';
  export type Moment = 'camp' | 'newCoach' | 'deadline' | 'push' | 'final' | 'end';
  export type Outcome = 'lands' | 'shrug' | 'bristles';
  export interface Commitment { backing: Exclude<Backing, 'words'>; scope: MeetingScope; opened: number; closes: number; named: number[]; boughtIn: number[]; by: 'coach' | 'gm' }
  export interface MeetingRecord { clock: number; scope: MeetingScope; kind: MeetingKind; approach: Approach; backing: Backing; timing: Timing; outcomes: Record<number, Outcome>; speaker?: number }
  export interface MeetingSuggestion { clock: number; scope: MeetingScope; kind: MeetingKind; moment?: Moment; topic: TalkCause | 'none'; approaches: Approach[]; backings: Backing[]; timings: Timing[]; named: number[]; driver?: number; leader?: number }
  export interface TeamMeetings { log: MeetingRecord[]; open: Commitment[]; pending?: MeetingSuggestion; gmAddressSeason?: number; byCoach?: boolean }
  ```
  `Team.meetings?: TeamMeetings`; `Coach.credibility?: number`, `Coach.newVoice?: number`; `MoraleJolt` gains
  `'meeting'`; `League.lockerBeats?: { season: number; week: number; teamId: number; kind: 'lost' | 'won' | 'struggling' | 'address' }[]`.
  `log` keeps this season's records only (cleared at the new league year).

- [ ] **Step 1: Write the failing test** (`migrate.test.ts`): a save at version 75 migrates to 76 with every team's
  `meetings` equal to `{ log: [], open: [] }` and every head coach's `credibility` at 0. `createLeague` gives the same,
  and `JSON.parse(JSON.stringify(league))` deep-equals the league.
- [ ] **Step 2: Run it:** `npx vitest run src/engine/migrate.test.ts -t meetings` → FAIL.
- [ ] **Step 3: Implement** the types, the defaults in `generate.ts` and a `version < 76` step in `migrate.ts`.
- [ ] **Step 4: Run it** → PASS. Then `npm run typecheck`.
- [ ] **Step 5: Commit** "Meetings: data and save version 76".

### Task 2: Credibility

**Files:**
- Create: `src/engine/meetings/credibility.ts`
- Modify: `src/engine/league.ts` (weekly tick after `moraleWeek`), `src/engine/coaching.ts` (a new head coach starts fresh)
- Test: `src/engine/meetings/credibility.test.ts`

**Interfaces:**
- Produces:
  - `type CredibilityRead = 'believes' | 'steady' | 'heardBefore' | 'wornThin'`
  - `credibilityOf(c: Coach): number` (0 when unset); `credibilityRead(c: Coach): CredibilityRead`
  - `shiftCredibility(c: Coach, by: number): void` (clamped −1…1)
  - `CRED = { meetingLands: 0.12, meetingBristles: -0.15, kept: 0.15, broken: -0.25, winStreak: 0.03, loseStreak: -0.04, drift: 0.97 }`
  - `credibilityWeek(league: League): void`: every head coach drifts ×0.97, then ±streak step when his club's
    streak is 3 or more (`computeRecords(...).streak`).
  - `startHeadCoach(c: Coach): void`: credibility 0, `newVoice` 2. Called wherever a head coach is installed in
    `coaching.ts`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('reads in words at the spec thresholds', () => {
    for (const [v, r] of [[0.4, 'believes'], [0, 'steady'], [-0.2, 'heardBefore'], [-0.5, 'wornThin']] as const) {
      const c = { credibility: v } as Coach; expect(credibilityRead(c)).toBe(r);
    }
  });
  it('drifts toward the middle and moves with a streak', () => { /* a coach at 0.5, no streak: 0.485 after a week; a 3-game losing streak: lower than without */ });
  it('a new head coach starts at 0 with two new-voice meetings', () => { const c = { credibility: -0.8 } as Coach; startHeadCoach(c); expect(c.credibility).toBe(0); expect(c.newVoice).toBe(2); });
  it('clamps to −1…1', () => { const c = {} as Coach; shiftCredibility(c, -5); expect(credibilityOf(c)).toBe(-1); });
  ```
  Also (Review Focus 2): firing a head coach through `coaching.ts` and hiring another leaves the new one at 0 with
  `newVoice` 2.
- [ ] **Step 2: Run** `npx vitest run src/engine/meetings/credibility.test.ts` → FAIL.
- [ ] **Step 3: Implement**, and call `credibilityWeek` from `playWeek` right after `moraleWeek`.
- [ ] **Step 4: Run** → PASS; `npx vitest run src/engine/coaching.test.ts`.
- [ ] **Step 5: Commit** "Meetings: a head coach's credibility".

### Task 3: Suggestions and the choices offered

**Files:**
- Create: `src/engine/meetings/suggest.ts`
- Test: `src/engine/meetings/suggest.test.ts`

**Interfaces:**
- Consumes: L1's `roomView`/`unitRead`/`roomReasons`, `causeOf` (`roomVoice.ts`), `soundOf`, `tierOf`, `weightOf`, `unitOf`
  (`standing.ts`), `playoffRace`, `computeRecords`, `TRADE_DEADLINE_WEEK`, `moraleClock`, `talksOpen`.
- Produces:
  - `COOLDOWN = { room: 4, team: 6, week: 1 }`
  - `dueMoment(league: League, teamId: number): Moment | null`, per spec §1.1.
  - `troubleScope(league: League, teamId: number, ctx: MoraleContext): { scope: MeetingScope; topic: TalkCause | 'none'; driver?: number } | null`:
    a room reading Split or Down (its top grievance via `causeOf`), three losses in a row (the team, topic `losing`),
    a feud started or a leader or voice benched or traded this week. The worst room first.
  - `suggestMeeting(league: League, teamId: number, ctx: MoraleContext): MeetingSuggestion | null`: moments first, then
    trouble, respecting `COOLDOWN` against `team.meetings.log`, building the offered `approaches`, `backings` and
    `timings` per spec §1.2 (`timings` is empty for a moment).

- [ ] **Step 1: Write the failing tests** (a fresh league per test, rooms set as in L1's tests by setting levels):
  - `dueMoment`: camp in the preseason; `final` in the championship week; `deadline` only when `playoffRace(...).spot` or the club sold at the deadline.
  - A Split receivers room offers `straight` always; `leader` only when a leader or voice in that room reads Good or better; `callout` only when a voice who stirs drives it and reads Poor or worse.
  - `backings` holds `talks` only when an eligible, upset man wants a deal (`roomReasons`), `snaps` only when a man who wants snaps isn't starting, `feud` only with a feud in the room, `move` only before the deadline while losing, and always `words`.
  - Cooldown: a room met with three weeks ago gets no suggestion; four weeks ago gets one; never two suggestions in one week.
- [ ] **Step 2: Run** → FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Commit** "Meetings: when a coach suggests one, and the choices".

### Task 4: Reactions

**Files:**
- Create: `src/engine/meetings/react.ts`
- Modify: `src/engine/morale.ts` (`'meeting'` jolt wording in `JOLT_WORDS`: lands "The coach got through to him", bristles "Didn't like the meeting")
- Test: `src/engine/meetings/react.test.ts`

**Interfaces:**
- Consumes: Task 1 types, Task 2 `credibilityOf`, `addJolt`, `traitOf`/`traitLean` (`coachTraits.ts`, discipline),
  `temperamentOf`, `characterZ`, `promisesScore`, Rng.
- Produces:
  - `REACT = { fit: 0.6, noGrievance: 0.2, backingMatch: 0.8, backingOther: 0.15, credibility: 0.4, newVoice: 0.2, heard: -0.25, benched: -0.2, broken: -0.3, ripple: 0.15, luck: 0.35, lands: 0.5, bristles: -0.5 }`
  - `JOLT = { base: 2, afterGame: 1.5, monday: 1, wednesday: 0.6, moment: 0.7, standard: 0.5, gm: 2 }`
  - `reactionScore(league, teamId, p: Player, s: MeetingSuggestion, choice: MeetingChoice, ctx): number` (no luck, no ripple; for tests and AI)
  - `type MeetingChoice = { approach: Approach; backing: Backing; timing: Timing }`
  - `holdMeeting(league: League, teamId: number, choice: MeetingChoice): MeetingRecord`: reads `team.meetings.pending`,
    scores each man (fit, the speaker against his makeup, a call-out, backing, credibility and new voice, "heard it
    before", his own history), adds luck from the meeting's stream, then the ripple in a second pass (leaders and voices
    first, by weight), turns each score into an outcome, adds the `meeting` jolt of
    `±JOLT.base × timing × kind`, records the meeting in `log`, opens the commitment (Task 5's `openCommitment`),
    shifts credibility by the room's net result (`CRED.meetingLands` per lands share, `CRED.meetingBristles` per
    bristles share), spends a new voice, and clears `pending`.
  - The speaker term, by approach:
    - `straight`: `0.1 + 0.15 × temperZ⁺ − 0.35 × discipline⁺ × temperZ⁻`;
    - `leader`: `0.35 × the leader's mood lean`, `+0.15` for his friends;
    - `callout`: the target gets `+0.5` if Driven (work ethic z ≥ 1 and winning ≥ 0.5) else `−0.6 − 0.3 × controversyZ⁺`;
      the target's friends get `−0.3`, the rest `+0.1`;
    - `losing`: fit on the `losing` cause;
    - `standard`: a flat `+0.1`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  it('a topic that matches his grievance scores higher than one that misses', …);
  it('a blunt coach and a short fuse score lower than a calm man', …); // discipline 18 vs temperament 4 and 16
  it('a happy leader speaking helps; an unhappy one hurts', …);
  it('the same approach to the same room again this season scores lower', …);
  it('a commitment that matches his grievance lifts him far more than words', …);
  it('holding a meeting adds a meeting jolt, logs it, clears pending, and is reproducible', () => {
    // two copies of a league, same suggestion and choice → identical outcomes; jolt size 2 × 1 × 1 on Monday for a trouble meeting
  });
  it('right after the game moves more than Wednesday', …); // |jolt| ratio 1.5 / 0.6
  ```
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; `npx vitest run src/engine/morale.test.ts`.
- [ ] **Step 5: Commit** "Meetings: how each man reacts".

### Task 5: Commitments

**Files:**
- Create: `src/engine/meetings/commitments.ts`
- Modify: `src/engine/morale.ts` (judge commitments at the end of each `moraleAdvance`)
- Test: `src/engine/meetings/commitments.test.ts`

**Interfaces:**
- Produces:
  - `WINDOW = { snaps: 3, talks: 4, feud: 4, move: Infinity, jobs: 3 }` (`talks` and `move` close at the deadline if sooner)
  - `openCommitment(league, teamId, record: MeetingRecord, s: MeetingSuggestion): Commitment | null` (`words` opens none)
  - `isKept(league, c: Commitment): boolean | null`: `null` while undecided. Kept means:
    - `snaps`: each named man's `actualRole` reached rotation or starter;
    - `talks`: a negotiation exists for each named man (`league.negotiations[id]?.teamId === teamId`);
    - `feud`: one of the two is off the room;
    - `move`: a starter added since `opened` (a trade or signing transaction for the club whose player now starts);
    - `jobs`: the depth chart's starters changed since `opened`.
  - `judgeCommitments(league: League): void`: closes those kept or past `closes`. Kept: a `kept` jolt (+1) for each
    man in `boughtIn`, `CRED.kept` to the head coach (when `by` is `coach`), `talk.kept += 1` for the named men.
    Broken: a `broken` jolt of −1.5 × the lift he got for each man in `boughtIn`, `CRED.broken`, `talk.broken += 1` for the named.
  - The rules for the Review Focus cases:
    - a named man off the club is dropped from `named` and `boughtIn` (void for him);
    - a hurt named man pushes `closes` back one week for each week out;
    - at the deadline, `talks` and `move` close;
    - at the new league year, everything still open is judged, then `open` is emptied.
  - AI clubs: at `closes`, an AI club's open commitment is kept by a draw on its stream with
    `P = clamp(0.55 + 0.3 × (gm.loyalty − gm.stubbornness), 0.2, 0.9)`.

- [ ] **Step 1: Write the failing tests:**
  - Kept: after a `snaps` commitment, moving the named man into the starting lineup and taking a step gives each man who bought in a `kept` jolt, raises the coach's credibility, and raises `talk.kept`.
  - Broken: the window closes untouched; each man who bought in gets a dip larger than his meeting lift; credibility falls.
  - Review Focus 1: the named man is traded mid-window; the commitment judges only the rest, and nobody is penalized for him.
  - Review Focus 3: the named man is hurt two weeks; `closes` moves two weeks later.
  - Review Focus 4: a `talks` commitment open at the deadline closes then; one open at the new league year is judged and `open` is emptied.
  - Review Focus 2: the head coach is fired mid-window; the commitment is still judged, and credibility goes to nobody (no coach).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement.** **Step 4: Run** → PASS; the morale suites.
- [ ] **Step 5: Commit** "Meetings: commitments kept or broken".

### Task 6: The GM address

**Files:**
- Create: `src/engine/meetings/address.ts`
- Test: `src/engine/meetings/address.test.ts`

**Interfaces:**
- Produces:
  - `gmAddressOpen(league, teamId): boolean`:
    - unlocked by a losing streak of 4 or more, by 3 or more rooms reading Down or Split, or within a week of firing
      the head coach or trading a captain or a star (a player with an honour in the last three seasons, `honouredSince`);
    - closed when `gmAddressSeason === league.season`.
  - `addressSuggestion(league, teamId, ctx): MeetingSuggestion` (`kind: 'gm'`, `scope: 'team'`; approaches `ownIt`,
    `raiseBar`, and `freshStart` only after a firing or a big trade; backings `jobs`, `move` before the deadline, `words`;
    timing `monday`).
  - `holdGmAddress(league, teamId, choice): MeetingRecord`: Task 4's `holdMeeting` with the GM's terms:
    - trust replaces credibility (`0.5 × promisesScore(p) / 3`);
    - `ownIt` gets +0.3 with loyalty ≥ 0.6 or experience ≥ 6;
    - `raiseBar` gets +0.3 for Driven and −0.3 for Volatile;
    - jolts ×2;
    - sets `gmAddressSeason`;
    - if the head coach reads `wornThin` and the address flops (bristles over lands), `CRED.meetingBristles` to him.

- [ ] **Step 1: Failing tests:**
  - It opens on a 4-game losing streak and not on 3.
  - It opens once a season.
  - `freshStart` is offered only right after a firing.
  - Players with kept promises score higher than ones with broken promises.
  - Jolts are twice a Monday coach meeting's.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** "Meetings: the GM address".

### Task 7: AI clubs, delegation and the calendar

**Files:**
- Create: `src/engine/meetings/ai.ts`, `src/engine/meetings/index.ts` (public API)
- Modify: `src/engine/league.ts`, `src/engine/offseason/index.ts` (call `meetingsStep` after the morale step)
- Test: `src/engine/meetings/ai.test.ts`

**Interfaces:**
- Produces:
  - `aiChoice(league, teamId, s: MeetingSuggestion, rng: Rng): MeetingChoice | null`:
    - a disciplinarian (discipline ≥ 14) favours `straight`, or `callout` when a stirrer drives it;
    - a player's coach (≤ 7) favours `leader` when offered, else `losing` or `standard`;
    - otherwise the approach with the highest mean `reactionScore`, with a 20% draw for the next best;
    - backing by the GM: `move` if `winNow ≥ 0.6`, `snaps`/`talks` if `loyalty ≥ 0.6`, else `words`;
    - timing `monday`;
    - skips a moment 30% of the time.
  - `meetingsStep(league: League): void`, run after each morale step:
    - for each club, `suggestMeeting` and its GM address check;
    - an AI club, or yours with `byCoach`, holds at once via `aiChoice`;
    - yours otherwise stores `pending` (an existing `pending` lapses at the next step);
    - then `judgeCommitments`.
  - `setMeetingsByCoach(league, on: boolean)`, `answerMeeting(league, choice | 'skip')` (user actions),
    `requestMeeting(league, scope)` (your request from a room; respects the cooldowns).
- Review Focus 5: when `league.userTeamId` changes (a new GM job), the old club's `pending` is cleared in the
  job-change path (`gm.ts`/`leadership.ts`, wherever `userTeamId` is set).

- [ ] **Step 1: Failing tests:**
  - An AI club with a Split room holds a meeting and logs it.
  - Yours stores a `pending` that lapses at the next step.
  - `byCoach` holds yours.
  - `requestMeeting` respects the cooldown.
  - A disciplinarian picks `straight` and a player's coach `leader` when offered.
  - Review Focus 5: a GM moving clubs leaves the old club with no `pending`.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** "Meetings: AI clubs, your coach's hand and the calendar".

### Task 8: The hot seat

**Files:**
- Modify: `src/engine/ownerBag.ts` (`heatSplit`)
- Test: `src/engine/ownerBag.test.ts`

**Interfaces:**
- Produces: `credibilityHeat(coachHeat: number, credibility: number): number` =
  `coachHeat × (1 + 0.25 × clamp(−credibility, 0, 1))`, applied to the coach's share in `heatSplit` (so in-season
  and offseason reviews both read it).

- [ ] **Step 1: Failing tests:**
  - A coach with zero record heat stays at zero however worn thin he is.
  - A worn-thin losing coach (credibility −1) gets ×1.25.
  - A believed one (+0.6) is unchanged.
- [ ] **Step 2–4:** FAIL → implement → PASS.
- [ ] **Step 5: Commit** "Hot seat: a worn-thin word adds a little to a losing coach's heat".

### Task 9: The league check and calibration

**Files:**
- Modify: `scripts/morale.ts`, `CLAUDE.md` (architecture and the `npm run morale` line), `package.json` and `src/ui/changelog.ts` (the version bump at the end of PR 1)

- [ ] **Step 1: Add the checks** (spec §6.2) with `check(label, value, range)`:
  | Label | Range |
  | --- | --- |
  | `Meetings per club per season` | `[3, 6]` |
  | `Reactions: lands` | `[0.35, 0.6]` |
  | `Reactions: bristles` | `[0.1, 0.3]` |
  | `Head coaches worn thin at season's end` | `[0.05, 0.2]` |
  | `Worn-thin coaches who recover within a season` | `[0.01, 1]` |

  The existing lines (no drift, band shares and the rest) stay.
- [ ] **Step 2: Run** `npm run morale` and calibrate only the `REACT` weights and `CRED` steps until every line is ✓. Never a range.
- [ ] **Step 3: Run** `npm run sim -- 30`, `npm run offseason -- 6`, `npm run careers`, `npm run trades`, `npm run audit`.
  Compare against main (a `git worktree` of `origin/main`). Investigate anything that tips; never loosen.
- [ ] **Step 4: Commit and push; open PR 1;** read CI and fix what's red.

---

## PR 2: the letters and screens

### Task 10: Renders for the owner (gate)

**Files:**
- Create (scratchpad only, not the repo): static HTML mockups styled with the app's `src/styles.css` classes, shot with Playwright.

- [ ] **Step 1:** Mock up, with real text written to L1 §6.2 and this spec §5:
  - the suggestion letter (read, approach cards with the coach's takes, backing chips, timing chips, Hold / Not now);
  - the result letter (three-part thread with a Negotiate button);
  - the staff-notes additions (a commitment coming due, a candid credibility line);
  - the locker report paragraph;
  - the captain's letter after a GM address;
  - the Locker Room pieces (a room card's "Ask the coach to meet with them", an open commitment line, the "Address the team" button with its dialog);
  - SNN's Locker rooms section;
  - the coach card line.
- [ ] **Step 2:** Send the screenshots to the owner. **Stop. Build nothing in this PR until the owner approves;**
  fold every change he asks for back into the mockups and resend.

### Task 11: The words

**Files:**
- Create: `src/engine/meetings/voice.ts` (banks), `src/engine/meetings/facts.ts` (what a line may read: our club only, words and flags)
- Test: `src/engine/meetings/voice.test.ts`

**Interfaces:**
- Produces: banks for the approved letters, each `Line<Fact>[]`, varied by the coach's style (discipline ≥ 14
  terse, ≤ 7 warm):
  - `READ` (his read of the room);
  - `TAKE` (his one-line take per approach and backing);
  - `TOLD` (the quoted line);
  - `WENT` (how it went: who, and why);
  - `NEXT` (where that leaves us);
  - `DUE` (a commitment coming due);
  - `CANDID` (credibility shifts);
  - `YEAR` (the season's meetings);
  - `CAPTAIN` (after a GM address).
- [ ] **Steps:** tests first, as in L1's `roomVoice.test.ts`:
  - every case has a line;
  - no banned words, no digits;
  - specific beats generic;
  - a reaction always names its reason;
  - `NEXT` never claims a meeting fixed a contract.

  Then implement, run, and commit.

### Task 12: Delivery

**Files:**
- Modify: `src/engine/inbox.ts` (the suggestion and result letters), `src/engine/staffNotes.ts`, `src/engine/lockerReport.ts`
- Test: `src/engine/meetings/mail.test.ts`

- [ ] **Steps:** tests first:
  - a `pending` files one suggestion letter;
  - answering files one result letter with the commitment's window;
  - a commitment's last week adds a `DUE` row to the staff notes;
  - a credibility read change adds a `CANDID` row once;
  - the season's-end report carries the `YEAR` paragraph;
  - a GM address files the captain's letter.

  Then implement, run, and commit.

### Task 13: The screens

**Files:**
- Modify: `src/ui/mail.tsx` (choice cards; Hold calls `answerMeeting`), `src/ui/screens/LockerRoom.tsx`
- Test: `src/ui/meetings.test.tsx`

- [ ] **Steps:** tests first:
  - the suggestion letter renders only the offered choices, and Hold is disabled until each beat is picked;
  - a room card shows "Ask the coach to meet with them" only off cooldown, and its open commitment;
  - "Address the team" shows only when `gmAddressOpen`;
  - the Captains section shows the head coach's credibility in words (`credibilityRead`; nothing when `steady`);
  - the screen contract (`ui.test.ts`) passes.

  Then implement against the approved renders, re-shoot with `npm run screens`, send to the owner, and commit. Open
  PR 2 and read CI.

---

## PR 3: the world

### Task 14: SNN, the coach card and the beats

**Files:**
- Modify: `src/engine/meetings/credibility.ts` (append `league.lockerBeats` on a read crossing `wornThin` (`lost`), back above `heardBefore` (`won`), a new coach's first two meetings bristling (`struggling`), and a GM address (`address`)), `src/engine/inbox.ts` (`leadershipMail`'s weekly roundup gains a "Locker rooms" section), the coach card in `src/ui/screens/Coaches.tsx` (one line from `credibilityRead`)
- Test: `src/engine/meetings/world.test.ts`, `src/ui/coachCard.test.tsx` (or the existing coach card test)

- [ ] **Steps:** tests first:
  - a crossing appends one beat;
  - the roundup's Locker rooms section has a sentence per club with a beat that week and is absent with none;
  - it never names another club's bristling men;
  - the coach card shows the line for any club's head coach.

  Then implement, run, and commit.

### Task 15: The full checks and the release

- [ ] Run `npm run offseason -- 6` and `npm run careers` against main's numbers: head-coach changes per year, the carousel and the coaching-tree lines hold. Investigate anything that tips; never loosen.
- [ ] Bump the version (patch per PR unless an MVP item finishes), write the changelog entry, update `docs/MVP.md` if the owner tracks the arc there, and open PR 3. Read CI.
