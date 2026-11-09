# Storylines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One weekly letter from the head coach that tells your club's storylines (asks, rooms, meetings, promises)
with memory of what came before, then a benching conversation as the first storyline built on it.

**Architecture:** A small story store on the league (`stories.ts`: stories, beats, what each outlet has told) is
written by one-line hooks at the sim's events and by a step after morale for things that are read, not done. A cast
sheet (`castSheet.ts`) gives every line bank the same facts about a man, the teller and the moment. An editor
(`coachWeek.ts`) ranks what is tellable each step and files one letter, replacing the talk, meeting and staff-notes
letters. Part B adds `benching.ts`: who holds a job, a healthy starter sitting, his ask and your answers.

**Tech Stack:** TypeScript, React, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-09-storylines-design.md`. Read it first; section numbers below refer to it.

## Global Constraints

- `src/engine/` is pure: no DOM, no React, no `Math.random`. Mail never draws from a sim stream: ties break on
  `stableHash` (`voice.ts`).
- Stories are record-keeping: nothing in the sim reads `League.stories`, and writing them draws nothing.
- `League` stays plain JSON. A shape change bumps `SAVE_VERSION` (`generate.ts`, 90 today) and adds a step to
  `migrate.ts` with a case in `migrate.test.ts`. Part A goes to 91, Part B to 92. If `claude/amazing-dirac-sa4npe`
  (also 91) merges first, take the next two numbers.
- Screens never render `player.ratings`, `playerOvr` or `player.potential`; hidden traits are words, never numbers.
  The cast sheet reads a man only through `personalityRead`, `quirkNotes`, `moraleView`, `standingView`,
  `seasonNote` and his talk record.
- Every sentence is chosen by a condition on facts (`say`, most specific line wins). No sentence twice in a league
  year from one sender. No "shrugged". No NFL nicknames, "Super Bowl", "AFC" or "NFC".
- A player changes club through `setTeam`; tests too.
- UI follows `docs/UI.md`: names through `PlayerLink`, faces through `PlayerAvatar`/`StaffAvatar`; the screen
  contract tests in `src/ui/ui.test.ts` must pass.
- Before each commit: `npm run format`, `npm run typecheck`, and the tests the task names. Never `npm run check`.
  Part B also runs `npm run morale`; never move a range to get green.
- Each part bumps `package.json`'s last number and adds a `src/ui/changelog.ts` entry: title 40 characters at most,
  text two sentences and 200 characters at most.
- Commit messages follow the repo's style ("Area: what changed") and end with the session's attribution lines.
- Old saves keep the letters they have: `talk:`, `meeting:`, `meeting-result:` and `staffNotes:` ids must still
  parse (`mailSubject`), answer (`needsYou`) and render.

## Review Focus

1. **Several steps played without answering** (holding Continue, or a week with a bye): each step files at most one
   coach letter, and an ask still open is carried as a short row ("still waiting on you"), not quoted again. Test in
   Task 7.
2. **A save upgraded with old letters still open** (a `talk:` letter unanswered, a `meeting:` suggestion pending):
   the first weekly letter must not ask the same thing a second time. Test in Task 7.
3. **`deliverMail` runs after every `store.mutate`:** answering one row must not file a second letter for the step,
   change the filed letter's text or reorder its rows. Test in Task 7.
4. **A full inbox (300) evicts this season's early letters:** what was told and what was said must survive
   (`League.mailTold`), or rooms are re-told and lines repeat late in the year. Test in Task 6.
5. **Your staff sorts the depth chart** (`autoDepth` on) and auto-sort passes a job-holder: he still asks you, and
   no line may say you sat him. Test in Task 11.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/engine/stories.ts` (new) | The store: open, find, `beat`, close, told-per-outlet, the cap, the yearly prune. Imports types and `employment` only |
| `src/engine/storiesStep.ts` (new) | Beats that are read, not done: rooms, feuds, staff belief, links, men who left |
| `src/engine/castSheet.ts` (new) | `manSheet`, `coachSheet`, `momentSheet` |
| `src/engine/coachWeekVoice.ts` (new) | The head coach's banks for the weekly letter |
| `src/engine/coachWeek.ts` (new) | The editor and the letter |
| `src/engine/benching.ts` (new, Part B) | Jobs, the kickoff lineup, sitting, the job question, answers, the lineup step |
| `src/engine/benchVoice.ts` (new, Part B) | The player's and coach's benching lines |
| `src/engine/playerVoice.ts` | Ask lines rebuilt on the cast sheet, in slots |
| `src/engine/meetings/voice.ts`, `meetings/mail.ts` | Result told a week on; suggestion and result become rows |
| `src/engine/talkMail.ts`, `staffNotes.ts` | Their letters become row builders |
| `src/engine/inbox.ts` | `deliverMail` calls `coachWeekMail`; a `coachWeek` mail kind |
| `src/ui/mail.tsx`, `src/ui/meetings.tsx`, `src/styles.css` | The people-row layout and its cards |
| `src/ui/App.tsx`, `src/ui/screens/Roster.tsx` (Part B) | The Set your lineup step and banner |

---

# Part A: stories and the weekly letter (0.4.22, save 91)

### Task 1: The story store

**Files:**
- Create: `src/engine/stories.ts`, `src/engine/stories.test.ts`
- Modify: `src/engine/types.ts` (beside `InboxMessage`), `src/engine/generate.ts` (`SAVE_VERSION = 91`),
  `src/engine/migrate.ts`, `src/engine/migrate.test.ts`

**Interfaces:**
- Produces, in `types.ts`:

```ts
export type StoryKind = 'deal' | 'snaps' | 'benched' | 'losing' | 'feud' | 'room' | 'staff';
export type OutletId = 'coach';
export type BeatKind =
  | 'asked' | 'answered' | 'promised' | 'kept' | 'broken' | 'commitment' | 'dispute' | 'disputeEnd' | 'leaked'
  | 'turned' | 'eased' | 'suggested' | 'held' | 'passed' | 'recovered'
  | 'started' | 'ended' | 'warned' | 'doubt' | 'worn' | 'stood' | 'notice' | 'relieved'
  | 'sat' | 'backIn' | 'satAgain' | 'swapped' | 'settled' | 'left' | 'lifted';
export interface Beat { at: number; kind: BeatKind; pub?: true; how?: string }
export interface Story {
  id: number; kind: StoryKind; teamId: number;
  playerId?: number; unit?: CoachRoom | 'ST' | 'team'; coachId?: number; other?: number;
  opened: number; closed?: number; due?: number; feeds?: number[];
  beats: Beat[]; told?: Partial<Record<OutletId, number>>;
}
// on League:
stories?: { next: number; open: Story[]; closed: Story[] };
```

- Produces, in `stories.ts`:

```ts
export type StoryOn = Pick<Story, 'kind' | 'teamId' | 'playerId' | 'unit' | 'coachId'>;
export const STORIES = { on: true }; // tests turn it off to prove play is untouched
export const MAX_BEATS = 12;
export function openStory(league: League, on: StoryOn): Story | undefined;
export function beat(league: League, on: StoryOn, kind: BeatKind, at: number,
  extra?: { how?: string; pub?: true; due?: number | null; other?: number }): Story | null;
export function closeStory(league: League, on: StoryOn, kind: BeatKind, at: number, how?: string): Story | null;
export function untold(league: League, s: Story, outlet: Outlet): Beat[]; // beats past `told[outlet.id]` that it sees
export function markTold(s: Story, outlet: Outlet): void;
export function storyById(league: League, id: number): Story | undefined; // open or closed
export function storiesNewYear(league: League): void;
/** A reader of the store (spec section 6). The coach sees his own club's beats; a public outlet, later, only `pub` ones. */
export interface Outlet { id: OutletId; sees: (league: League, s: Story, b: Beat) => boolean }
export const COACH: Outlet; // sees every beat of a story whose teamId is your club
```

Rules the tests pin: `beat` records only when `STORIES.on`, `on.teamId === league.userTeamId` and
`employed(league)`, else returns null. It finds the open story with the same kind and subject, or opens one. The
same kind at the same clock twice is one beat. `due: null` clears the clock. Past `MAX_BEATS` the oldest beat that
is neither the first nor one of the last three goes. `closeStory` on nothing open returns null. `storiesNewYear`
drops closed stories that closed before last league year (`YEAR = 32` clock steps a year, as `morale.ts`).

- [ ] **Step 1: Write the failing tests** in `stories.test.ts`:

```ts
it('opens a story on the first beat and adds to it after', () => {
  const l = createLeague({ seed: 'stories' });
  const on = { kind: 'deal' as const, teamId: l.userTeamId, playerId: 7 };
  const s = beat(l, on, 'asked', 100)!;
  expect(beat(l, on, 'answered', 101, { how: 'reassure' })).toBe(s);
  expect(s.beats.map((b) => b.kind)).toEqual(['asked', 'answered']);
  expect(l.stories!.open).toHaveLength(1);
});
it('records nothing for another club, between jobs, or switched off', () => { /* three nulls, stories undefined */ });
it('keeps twelve beats: the first and the last three always', () => { /* 20 beats → length 12, [0].at===0, last three intact */ });
it('closes into `closed`, and the same subject opens a new story afterwards', () => { /* ids differ */ });
it('tracks what each outlet has told', () => { /* untold → 2; markTold; untold → 0; one more beat → 1 */ });
it('drops closed stories a league year old at the new year', () => { /* closed at clock 10, now 10 + 2*32 → gone */ });
```

- [ ] **Step 2: Run** `npx vitest run src/engine/stories.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Add the types and implement `stories.ts`.** Bump `SAVE_VERSION` to 91; the migrate step only sets
  the version. Add the `migrate.test.ts` case in that file's existing style (a v90 save loads as 91, `stories`
  absent).
- [ ] **Step 4: Run** the two test files and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "Stories: a store for your club's storylines (v91)".

### Task 2: Beats at the sim's events

**Files:**
- Modify: `src/engine/playerTalks.ts`, `src/engine/meetings/index.ts`, `src/engine/meetings/react.ts` (where
  `holdMeeting` builds its `MeetingRecord`), `src/engine/meetings/commitments.ts`, `src/engine/disputes.ts`,
  `src/engine/types.ts` (`MeetingRecord.word?: 'Split' | 'Down'`)
- Test: `src/engine/stories.test.ts`

**Interfaces:**
- Consumes: `beat`, `closeStory`, `StoryOn` (Task 1).
- Produces: `talkStoryOn(league: League, p: Player, cause: TalkCause): StoryOn` in `stories.ts` (a `feud` ask's
  story is the pair's: `playerId` the lower id of him and his feud partner on the club, `other` the higher; every
  other cause is `{ kind: cause, teamId, playerId: p.id }`); `MeetingRecord.word`, the room's read when it was held.

One line at each site, each passing the step's clock:

| Site | Beat |
| --- | --- |
| `talkStep`, where your club's ask is filed (`talkOf(p).ask = …`) | `asked` on `talkStoryOn` |
| `applyReply` | `answered`, `how` the reply (`ignored` too); then `promised` with `due` (a deal's `promise.due`; a snaps promise has none) |
| `settle` in `playerTalks.ts` | `closeStory` with `kept` or `broken` |
| `meetingsStep` and `requestMeeting`, where `m.pending = s` (not the GM's address) | `suggested` on `{ kind: 'room', teamId, unit: s.scope }`, `how` the topic |
| `holdMeeting` | `held`, `how` `${approach}:${backing}:${timing}`; set `record.word` from the room's read then |
| `answerMeeting(l, 'skip')` | `passed` |
| `openCommitment` | on the room: `commitment` with `due: c.closes`; for backing `talks`, also `commitment` with the same `due` on each named man's `deal` story |
| `settle` in `commitments.ts` | `kept` or `broken` on the room's story, and on each named man's |
| A dispute starting (both sites in `disputes.ts` that set `m.dispute`) | `dispute`, `how` the kind, on his `deal` or `snaps` story by `dispute.cause` |
| `endDispute` | `disputeEnd`, `how` |
| Where a trade request leaks (`LEAK_STEPS`) | `leaked` with `pub: true` |

- [ ] **Step 1: Write the failing tests:** one per row, driving the real functions (`answerTalk`, `answerMeeting`,
  the helpers `talkMail.test.ts` and `meetings/mail.test.ts` already use to stage an ask and a pending meeting):

```ts
it('an ask, your answer and a kept promise are one story', () => {
  // stage a deal ask (as talkMail.test.ts's `asking`), answerTalk(l, p.id, 'promise'), then sign him and run moraleStep
  expect(story.beats.map((b) => b.kind)).toEqual(['asked', 'answered', 'promised', 'kept']);
  expect(story.closed).toBeDefined();
});
it('a meeting held with "talks" puts the clock on the room and on each named man', () => {
  expect(room.due).toBe(c.closes);
  expect(openStory(l, { kind: 'deal', teamId, playerId: named })!.due).toBe(c.closes);
});
it('play is identical with stories off', () => {
  // two leagues, same seed; STORIES.on false for one; playWeek ×3 each; JSON of results and of every player's morale equal
});
```

- [ ] **Step 2: Run.** Expected: FAIL (no beats).
- [ ] **Step 3: Add the hooks.** `stories.ts` must not import any module that imports it.
- [ ] **Step 4: Run** `npx vitest run src/engine/stories.test.ts src/engine/talkMail.test.ts src/engine/meetings`
  and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** "Stories: asks, answers, promises, meetings and disputes noted as they happen".

### Task 3: The step after morale

**Files:**
- Create: `src/engine/storiesStep.ts`, `src/engine/storiesStep.test.ts`
- Modify: `src/engine/league.ts` (after `meetingsStep(league)` in `playWeekControlled`),
  `src/engine/offseason/index.ts` (after both `meetingsStep(league)` calls; `storiesNewYear` beside
  `habitsNewYear`)

**Interfaces:**
- Consumes: Task 1; `roomView`, `tierOf`, `weightOf` (`standing.ts`); `moraleContext`, `moraleView`,
  `moraleClock` (`morale.ts`); `beliefFact` (`roomFacts.ts`); `credibilityRead`; `teamCoaches`.
- Produces:

```ts
export const HOLD = 1; // steps a turn must still stand before it is told: the second week running
export function storiesStep(league: League): void;
/** A room's turn (or its recovery) has stood long enough to tell. */
export function tellable(league: League, s: Story, clock: number): boolean;
/** His share of his room's weight, in words: null under a fifth, 'part' under half, 'most' from half. */
export function shareWord(league: League, p: Player, ctx: MoraleContext): 'part' | 'most' | null;
```

What it does, your club only, when employed:

1. **Rooms.** A unit reading Down or Split with no open `room` story opens one (`turned`, `how` the word). The word
   changing between Down and Split adds `turned`. An open story whose unit reads neither adds `eased` once; still
   neither a step later, it closes `recovered`. Back to Down or Split adds `turned`.
2. **Feuds.** A feud tie between two men on the club with no story opens one (`started`, `how` the tie's `why`). The
   tie gone closes it `ended`.
3. **Staff.** `Team.beliefFell` at this clock adds `warned` on `{ kind: 'staff', coachId }` for that side's coach; a
   belief read of doubt or lost adds `doubt`; the head coach reading `wornThin` adds `worn` on his own story. A read
   back to steady closes `recovered`. A coach no longer on the staff closes `relieved` or `left`.
4. **Links.** For each open `deal`, `snaps`, `benched` or `losing` story: his unit's open `room` story id is in
   `feeds` exactly when `tierOf` gives him a tier, `moraleView` reads Poor or worse, his top reason maps to the
   story's cause (`CAUSE_OF` in `playerTalks.ts`; export it) and `shareWord` is not null.
5. **Departures.** An open story whose player (or `other`) is off the club closes `left`. A `losing` story closes
   `lifted` when he reads Okay or better.

- [ ] **Step 1: Write the failing tests:**

```ts
it('opens a room story when a unit turns Down and tells it only the second week running', () => {
  // stage a Down DL room (the helper staffNotes.test.ts uses to stage a Split room); storiesStep
  expect(tellable(l, room, clock)).toBe(false);
  // advance the clock one step with the room still Down; storiesStep
  expect(tellable(l, room, clock + 1)).toBe(true);
});
it('a room that flips back within a step is never tellable', () => {});
it('links a voice’s deal story to his room, and no link for a depth man', () => {
  expect(deal.feeds).toEqual([room.id]); expect(depthDeal.feeds ?? []).toEqual([]);
});
it('closes a traded man’s stories with "left" and drops the link', () => { /* setTeam(l, p, other) */ });
it('recovers a room after two calm steps, not one', () => {});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `storiesStep.ts` and add the three calls.**
- [ ] **Step 4: Run** `npx vitest run src/engine/storiesStep.test.ts src/engine/stories.test.ts` and typecheck.
  Expected: PASS (the "identical with stories off" test from Task 2 included).
- [ ] **Step 5: Commit** "Stories: rooms, feuds, the staff's standing and the links between them, read each step".

### Task 4: The cast sheet

**Files:**
- Create: `src/engine/castSheet.ts`, `src/engine/castSheet.test.ts`

**Interfaces:**
- Produces:

```ts
export interface ManSheet {
  id: number; first: string; last: string; pos: string; years: string;
  role: 'starter' | 'rotation' | 'depth'; captain: boolean;
  personality: { name: string; hedged: boolean } | null; loud: boolean; calm: boolean;
  lean: 'money' | 'winning' | 'loyal' | null;
  tier: Tier | null; sound: Sound | null;
  friends: string[]; feud: { with: string; why?: string } | null; mentor: string | null; mentee: string | null;
  habit: { label: string; clause: string } | null; lastSeason: string | null; backFromInjury: boolean;
  finalYear: boolean; rookieDeal: boolean; underpaid: boolean;
  asks: 'first' | 'second' | 'again'; lastAnswer: { reply: TalkReply | 'ignored'; when: string; cause?: TalkCause } | null;
  kept: boolean; broken: boolean; dispute: boolean;
  draftedHere: boolean; homecoming: boolean; grudgeGame: boolean;
  mood: string | null; reason: string | null;
}
export function manSheet(league: League, p: Player, ctx: MoraleContext): ManSheet | null; // null off your club
export interface CoachSheet { name: string; style: Style; motto: string; isNew: boolean; word: CredibilityRead; room?: CoachRoom }
export function coachSheet(league: League, c: Coach): CoachSheet;
export interface MomentSheet {
  record: 'winning' | 'losing' | 'even'; streak: { kind: 'won' | 'lost'; games: string } | null;
  lastGame: string | null; rival: boolean; seasonOver: boolean;
  week: 'camp' | 'deadline' | 'push' | 'bye' | 'regular' | 'playoffs' | 'offseason';
}
export function momentSheet(league: League): MomentSheet;
/** "in week 8", "at camp", "over the winter": a clock in the coach's words. */
export function whenWords(league: League, clock: number): string;
```

Sources: `personalityRead(league, league.userTeamId, p)`; `quirkNotes` (the first note, `QUIRKS[id].label` and
`.clause`); `tierOf`/`soundOf`/`isCaptain`; `p.ties` and `p.mentoredBy` by last name; `seasonNote`; `yearsLeft`;
`contractScore`'s test for underpaid (`FAIR_PAY`); `p.morale.talk` (`reassured`, `answered`, `kept`, `broken`);
`moraleView` for `mood` and `reason`; `relationships.ts` for homecoming and a grudge against this week's opponent;
`gameStory(...).swing` for `lastGame`; `lean` from the agent dials (greed, winning, loyalty: the one 0.25 clear of
the others, else null); `streak.games` and `years` as words ("three", "ten years").

- [ ] **Step 1: Write the failing tests:**

```ts
it('holds no number but the id', () => {
  const walk = (v: unknown, path: string): void => { /* recurse; expect(typeof v).not.toBe('number') unless path === 'id' */ };
  walk(manSheet(l, p, ctx), ''); walk(momentSheet(l), ''); walk(coachSheet(l, hc), '');
});
it('gives nothing for another club’s player', () => { expect(manSheet(l, other, ctx)).toBeNull(); });
it('hedges a loose personality read and names none when unknown', () => {});
it('reads history with you from his talk record', () => {
  // answered { reply: 'reassure', at: clock of week 8, cause: 'deal' }, reassured: 1
  expect(sheet.asks).toBe('second'); expect(sheet.lastAnswer).toEqual({ reply: 'reassure', when: 'in week 8', cause: 'deal' });
});
it('knows the season is over for a club with no game left', () => { expect(momentSheet(l).seasonOver).toBe(true); });
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the test file and typecheck. Expected:
  PASS.
- [ ] **Step 5: Commit** "Cast sheet: what a line may say about a man, the teller and the moment".

### Task 5: Players' words on the cast sheet

**Files:**
- Modify: `src/engine/playerVoice.ts`, `src/engine/voice.ts`, `src/engine/talkMail.ts`
- Test: `src/engine/playerVoice.test.ts` (create or extend), `src/engine/voice.test.ts` (create or extend)

**Interfaces:**
- Consumes: `ManSheet`, `MomentSheet` (Task 4).
- Produces:

```ts
// voice.ts
/** Every sentence a sender filed this league year: bodies and row notes, split on sentence ends. */
export function seasonSaid(league: League, from: string): string[];
// playerVoice.ts
export interface AskFact { man: ManSheet; moment: MomentSheet; cause: TalkCause }
export const ASK_HISTORY: readonly Line<AskFact>[]; // only when man.asks !== 'first' or kept/broken
export const ASK_CORE: readonly Line<AskFact>[];
export const ASK_COLOR: readonly Line<AskFact>[];
export const ASK_CLOSE: readonly Line<AskFact>[];
export function askWords(f: AskFact, at: { key: string; recent: readonly string[] }): string;
// talkMail.ts
export function talkRows(league: League, clock: number, said: string[]): MailSection['rows']; // a row per open ask filed at `clock`
```

`askWords` joins history, core, at most one color sentence and a close, each through `say` with `recent`, and
pushes what it used onto `recent` so the next man in the same letter can't take it. Bank sizes the test pins:
`ASK_CORE` eight lines or more per cause, at least three of them reading a sheet fact beyond the cause;
`ASK_COLOR` twenty or more, at least one for each of `lean` (three values), `tier`, `sound` (two), `habit`,
`finalYear`, `underpaid`, `captain`, `homecoming`, `feud`, `mentor`; `ASK_HISTORY` six or more covering each
`lastAnswer.reply` and `broken`. `TALK_LETTER` and `TALK_CLOSE` stay for `talkCard`'s old letters only.

- [ ] **Step 1: Write the failing tests:**

```ts
it('forty different men with one grievance write at least thirty different letters', () => {
  // sheets varied over lean, tier, sound, habit, finalYear, asks; cause 'losing'; shared recent list
  expect(new Set(letters).size).toBeGreaterThanOrEqual(30);
});
it('two men in one letter never share a sentence', () => {});
it('a second ask says what you told him last time', () => { expect(text).toMatch(/week 8/); });
it('no line holds a digit run that could be a rating, or a banned word', () => {
  // /\b(1?\d|20)\/20\b|marble|\btraits?\b|z-score|shrug|super bowl|\bAFC\b|\bNFC\b/i over every bank's text for sample facts
});
it('seasonSaid reads bodies and row notes of this league year only', () => {});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Write the banks and `askWords`; add `seasonSaid`; add `talkRows`**
  (each row: `playerId`, `cells: [name, TALK_SUBJECT[cause]]`, `note` his words in quotes, `talk: { playerId,
  clock }`). **Step 4: Run** `npx vitest run src/engine/playerVoice.test.ts src/engine/voice.test.ts
  src/engine/talkMail.test.ts` and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** "Players' asks: written from the cast sheet, in slots, no sentence twice".

### Task 6: The head coach's words, and a result a week on

**Files:**
- Create: `src/engine/coachWeekVoice.ts`, `src/engine/coachWeekVoice.test.ts`
- Modify: `src/engine/meetings/voice.ts`, `src/engine/meetings/mail.ts`, `src/engine/staffNotes.ts`,
  `src/engine/voice.ts`

**Interfaces:**
- Consumes: Tasks 1, 3, 4; `seasonSaid`.
- Produces, in `coachWeekVoice.ts` (each a `readonly Line<…>[]` read through `say`):
  `HEADLINE` (a story and its newest beat to a few words: "Stokes's deal", "Stokes signed", "The D-line"),
  `OPENING` (the week tied together; reads `MomentSheet` and whether two of the week's stories are linked),
  `BEFORE` (the callback for a man: reads `ManSheet.asks`, `lastAnswer`, `kept`, `broken`, `dispute`),
  `LINK` (a room's row when a man's story feeds it; reads `shareWord`, the story kind, his `tier`),
  `CLOCK` (halfway and due, by story kind), `CLOSING` (by story kind and closing beat),
  `STILL_WAITING` (an ask open from an earlier step), `SET_FOR` (after Go ahead, by `Timing`),
  `RESULT_MAN`, `RESULT_ROOM`.
- Produces, in `meetings/mail.ts`:

```ts
export interface ResultFact { man: ManSheet; outcome: 'lands' | 'bristles' | 'none'; named: boolean; nowDown: boolean; topic: MeetingTopic }
export function resultRows(league: League, r: MeetingRecord, said: string[]): MailSection['rows'];
export function requestRow(league: League): MailSection['rows'][number] | null; // the pending suggestion: its lead, read and ask as `note`, `meeting: { clock, scope }`
```

- Produces, in `staffNotes.ts`:

```ts
export function staffRows(league: League, told: Set<string>): {
  rooms: MailSection['rows']; staff: MailSection['rows']; covered: string[];
  coachNote?: Pick<InboxMessage, 'coachNoteKey' | 'coachNote'>;
};
```

`resultRows`: the men named are the commitment's, then up to two who landed and one who bristled by room weight (as
`resultLetter` picks today). Each gets `RESULT_MAN` on his outcome then and whether he reads Poor or worse now
(`nowDown`) with his top reason. One row for the room from `RESULT_ROOM` on `r.word` against its read now. A
commitment adds what is owed and its Negotiate row, as today. `WENT`, `restLine` and the `shrug` wording are
deleted; `TOLD` keeps its quote and gains variants so each (approach, speaker or not) has four or more.
`staffRows.rooms`: one row a room, the position coach's turn (`unitTurnFor`) with chemistry as a clause in the same
note, the head coach's row only for a room with no position coach's row; a room story must be `tellable`.
`toldKeys` also reads this season's `seasonSaid` hashes kept in `League.mailTold` under `said:{hash}` so eviction
doesn't forget them (Review Focus 4): `deliverMail` adds them where it adds `covered`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('tells a result from where each man is now', () => {
  // r.outcomes.lands = [a.id]; a reads Poor now with top reason 'Wants a new deal'
  expect(rows[0].note).toMatch(/deal/); expect(JSON.stringify(rows)).not.toMatch(/shrug/i);
});
it('says the room is steadier when it read Down then and Settled now', () => {});
it('four meetings in a season give four different "what I told them"', () => {});
it('one row a room: chemistry rides in the position coach’s note', () => { expect(rooms.filter((r) => r.cells[0] === ROOM_LABEL.WR)).toHaveLength(1); });
it('a room is not told the week it turns', () => {});
it('remembers what was said after the inbox evicts it', () => {
  // file 301 dated messages so the early one is evicted; say() with seasonSaid ∪ mailTold still skips its sentence
});
it('every headline for a season of beats is different', () => {});
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Write the banks and the three builders.** The old
  `suggestionLetter`, `resultLetter` and `staffNotesMail` stay in place until Task 7 swaps the caller.
  **Step 4: Run** `npx vitest run src/engine/coachWeekVoice.test.ts src/engine/meetings src/engine/staffNotes.test.ts`
  and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** "Head coach: his weekly lines, and a meeting's result told from the week after".

### Task 7: The editor and the letter

**Files:**
- Create: `src/engine/coachWeek.ts`, `src/engine/coachWeek.test.ts`
- Modify: `src/engine/inbox.ts` (`deliverMail`, `MailSubject`, `mailSubject`, `needsYou`), `src/engine/types.ts`
  (`MailSection`), `src/engine/meetings/mail.ts`, `src/engine/talkMail.ts`, `src/engine/staffNotes.ts`
- Rework: `src/engine/talkMail.test.ts`, `src/engine/meetings/mail.test.ts`, `src/engine/staffNotes.test.ts`

**Interfaces:**
- Consumes: `talkRows`, `resultRows`, `requestRow`, `staffRows`, the banks, `untold`/`markTold`/`COACH`, `tellable`.
- Produces:

```ts
// types.ts, on a MailSection row
coachId?: number;                                  // a position coach's face
before?: string;                                   // the coach's line on what came before, above the quote
meeting?: { clock: number; scope: MeetingScope };  // the meeting request's choices
// types.ts, on MailSection
layout?: 'people';
// coachWeek.ts
export const coachWeekId = (season: number, clock: number) => `coach:${season}:${clock}`;
export type Tier5 = 1 | 2 | 3 | 4 | 5;
export interface WeekItem { tier: Tier5; key: string; section: 'since' | 'asks' | 'rooms' | 'want' | 'staff';
  row: MailSection['rows'][number]; storyId?: number; born: number }
export const EXTRA = 4;   // rows beyond tiers 1 to 3
export const STALE = 3;   // steps a tier 4 or 5 item may wait
export function weekItems(league: League, told: Set<string>, said: string[]): WeekItem[];
export function coachWeekMail(league: League, have: Set<string>): Draft[];
export function coachWeekNeedsYou(league: League, m: InboxMessage): boolean;
// inbox.ts
| { kind: 'coachWeek'; season: number; clock: number }
```

Rules: tiers as spec section 3. An item's `key` is what `covered` records: an ask `talk:{season}:{clock}:{player}`
(the old single-letter id, so an old letter already holding that ask counts as told: Review Focus 2), a request
`meeting:{season}:{clock}:{scope}`, a result `meeting-result:{season}:{clock}:{scope}` (told only at a step after
`r.clock`), a room `unit:` key as today, a story beat `story:{id}:{beat index}`. An ask from an earlier step that is
still open and already told gets a one-line `STILL_WAITING` row keyed `waiting:{clock now}:{player}`, not his quote
again (Review Focus 1). The letter is filed once a step: if `have` holds `coachWeekId(season, clock)` return `[]`
(Review Focus 3). Sections in the order since, asks, rooms, want, staff, titled "Since last week", "Who came to see
me", "The rooms", "What I want to do", "From the staff room", each `layout: 'people'`. Subject: the `HEADLINE` of
the top item, plus "and" the second's when there are two; a subject already used this league year takes the next
item or the `CLOCK` form. Body: `OPENING`. `actions: [{ kind: 'locker' }]`. On filing, `markTold(story, COACH)`
for each story told. `reportTellsRooms` still drops the rooms section on a report's day. `needsYou`: any row's
`talk` open (`talkCard`), `meeting` open (`meetingCard`).

`deliverMail`: remove `talkMail`, `staffNotesMail`, and from `meetingMail` the suggestion and the non-address
result letters (the captain's letter and SNN rumor stay); add `...coachWeekMail(league, have)` where `talkMail` was.
Delete the three old letter builders once nothing calls them; keep `talkCard`, `talkNeedsYou`, `meetingCard` and
the id helpers.

- [ ] **Step 1: Write the failing tests** in `coachWeek.test.ts`:

```ts
it('files one letter for a step with an ask, a room and a request, and none of the old ids', () => {
  expect(l.inbox!.filter((m) => m.id.startsWith('coach:'))).toHaveLength(1);
  expect(l.inbox!.some((m) => /^(talk|meeting|meeting-result|staffNotes):/.test(m.id))).toBe(false);
});
it('files nothing in a quiet step', () => {});
it('keeps every tier 1 to 3 item and at most four more', () => {});
it('drops a room note that has waited three steps', () => {});
it('tells a meeting’s result in the next step’s letter, and always files that letter', () => {});
it('carries an unanswered ask as a short row, never his quote twice', () => {});          // Review Focus 1
it('does not ask again what an old-format letter is already asking', () => {});            // Review Focus 2
it('answering a row files nothing new and changes nothing filed', () => {                  // Review Focus 3
  const before = JSON.stringify(letter); answerTalk(l, p.id, 'reassure'); deliverMail(l);
  expect(JSON.stringify(l.inbox!.find((m) => m.id === letter.id))).toBe(before);
});
it('names the link when a voice’s deal feeds his room', () => { expect(letter.body + rowsText).toMatch(new RegExp(p.lastName)); });
it('needs you while a row is open and not after', () => {});
it('carries the depth-chart call’s coachNoteKey', () => {});
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement `coachWeek.ts`; swap `deliverMail`; add the mail kind.**
- [ ] **Step 4: Rework the three old test files** so each behavior they pin is asserted on the weekly letter's rows
  (`talkCard`'s tests stay as they are; a test of a deleted letter's subject or id is deleted). Add to
  `inbox`'s existing tests that an old `talk:` and `staffNotes:` message still parses and reads `needsYou`.
- [ ] **Step 5: Run** `npx vitest run src/engine` and typecheck. Expected: PASS.
- [ ] **Step 6: Commit** "Head coach's weekly letter: asks, rooms, his request and last week's result in one".

### Task 8: The letter on screen

**Files:**
- Modify: `src/ui/mail.tsx` (`KindCards`, `SectionCard`), `src/ui/meetings.tsx`, `src/styles.css`
- Rework: `src/ui/talk.test.tsx`; Test: `src/ui/mail.test.tsx`

**Interfaces:**
- Consumes: the row fields from Task 7; `meetingCard` (add `setFor?: string` to `MeetingCardView` when held: the
  `SET_FOR` line).
- Produces: `PeopleSection` in `mail.tsx`, used by `SectionCard` when `section.layout === 'people'`.

A people row: the face (`PlayerAvatar` at 32 for `playerId`, `StaffAvatar` at 32 for `coachId`), the name
(`PlayerLink` with position, or the coach's name and title from `cells[1]`), `cells` after the first as muted facts,
`before` muted above the quote, `note` as the quote, then the row's control: `TalkCards` for `talk`,
`MeetingChoices` for `meeting`, `NegotiateButton` for `negotiate`. `KindCards` returns null for `coachWeek` (the
sections carry everything). Held, `MeetingChoices` shows `card.setFor` then `card.said`.

- [ ] **Step 1: Write the failing tests** (render to static HTML as `mail.test.tsx` does):

```ts
it('gives every person row a face and a linked name', () => { /* one avatar element per row; player names are PlayerLink anchors */ });
it('shows a man’s answers in his row and the request’s choices in "What I want to do"', () => {});
it('after Go ahead the row says when it is set for, and no result yet', () => { expect(html).toMatch(/I'll tell you how it went/); });
it('renders no rating anywhere in the letter', () => { /* the screen-contract helper ui.test.ts uses */ });
```

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Build `PeopleSection`, the styles (`.mail-person`, stacking under
  640px) and the `setFor` line.** **Step 4: Run** `npx vitest run src/ui` and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** "Inbox: the coach's letter as people rows, each with a face and its answer".

### Task 9: The season replay, the preview, docs and 0.4.22

**Files:**
- Create: `src/engine/coachWeek.season.test.ts`
- Modify: `scripts/mail-preview.ts`, `docs/NEWS.md`, `CLAUDE.md` (the `inbox.ts` paragraph and a `stories.ts`
  entry), `docs/MVP.md` (the "Full news and media outlets" line: the story store and its outlet seam),
  `package.json`, `src/ui/changelog.ts`

- [ ] **Step 1: Write the replay test** (one season, seed `mail1`, `userTeamId: 3`, answering every ask with
  `'reassure'` and every request with its first approach, last backing and first timing after each step, as the
  brainstorm's dump did; `{ timeout: 180_000 }`):

```ts
const coach = l.inbox!.filter((m) => m.id.startsWith('coach:'));
expect(new Set(coach.map((m) => m.id)).size).toBe(coach.length);              // one a step
expect(l.inbox!.some((m) => /^(talk|meeting|meeting-result|staffNotes):/.test(m.id))).toBe(false);
expect(dupes(sentences(coach))).toEqual([]);                                   // no sentence twice (bodies and notes)
expect(dupes(coach.map((m) => m.subject))).toEqual([]);
expect(roomsToldWithin(coach, 3)).toEqual([]);                                  // no room twice inside three steps
expect(heldWithoutResult(l)).toEqual([]);                                       // every meeting's result in the next letter
```

- [ ] **Step 2: Run** `npx vitest run src/engine/coachWeek.season.test.ts`. Fix what it finds in the banks or the
  editor (never by loosening an assertion). Expected: PASS.
- [ ] **Step 3: Preview moments.** `mail-preview.ts` gains `room.json` (the first step a `coach:` letter has a
  rooms row) and `result.json` (the first with a "Since last week" result). Run it on a fresh save and
  `npm run screens -- --mail coach`; put the screenshots where the owner can open them.
- [ ] **Step 4: Docs, `"version": "0.4.22"`, changelog entry** (title "One letter from the coach").
- [ ] **Step 5: Run** `npm run format`, `npm run typecheck`, `npx vitest run src/engine/coachWeek* src/ui/changelog.test.ts`.
- [ ] **Step 6: Commit** "0.4.22: the head coach's weekly letter on a story store"; push.

---

# Part B: the benching chain (0.4.23, save 92)

### Task 10: Jobs and the kickoff lineup

**Files:**
- Create: `src/engine/benching.ts`, `src/engine/benching.test.ts`
- Modify: `src/engine/types.ts` (`Team`), `src/engine/league.ts` (`benchKickoff` before the week's games are
  played in `playWeekControlled`, and in the live-game path before `startGame`), `src/engine/offseason/index.ts`
  (`setJobs` where the season starts; clear `jobs` in `beginOffseason`)

**Interfaces:**
- Produces:

```ts
// types.ts, on Team
jobs?: {
  held: Record<number, { pos: Position; since: number; reminded?: number }>; // reminded: the cleared-and-not-starting row was told
  runs?: Record<number, number>;
  questions?: JobQuestion[];
};
kickoff?: { week: number; ids: number[] };  // who started this week, read before the games
lineupSet?: number;                          // the season you confirmed your lineup for
export interface JobQuestion {
  pos: Position; holder: number; other?: number; since: number;
  asked?: number[]; paused?: true;
  promise?: { to: number; at: number };     // "back in next week": owed his next available game
  soft?: { to: number; at: number };        // "just this week"
}
// benching.ts
export const EARN = 3;
export function setJobs(league: League): void;       // every club: the men in the chart's starting spots, hurt or not
export function benchKickoff(league: League): void;  // every club with a game this week: `starters()` per position, plus anyone starting via `playingAt`
export function holdsJob(team: Team, playerId: number): boolean;
export function couldPlay(league: League, p: Player): boolean; // isAvailable, not on IR, not sat by the doctor, not onDidNotReport
/** After the games: runs counted, jobs earned and lost. Returns the job-holders who sat this week, with who started instead. */
export function countStarts(league: League, team: Team, clock: number): { holder: Player; other?: Player }[];
```

Rules (spec sections 4 and 5): a non-holder's run at a position grows by one each game he starts and resets when he
doesn't; it does not grow while a holder at that position is out hurt, on IR or starting elsewhere via `playingAt`.
At `EARN` he holds the job and, when the position then has more holders than `STARTERS[pos]`, the holder who has
sat longest loses his. A holder who leaves the club loses his job. `other`: the non-holder who started at the
position, the one listed higher on the chart when there are two. A bye changes nothing.

- [ ] **Step 1: Write the failing tests:** jobs come from the chart at the season's start, a hurt starter keeping
  his; the fill-in for a hurt holder never earns it over six games; a new man earns it on his third straight start
  with no holder hurt; a holder who started and was hurt in the game is not in `countStarts`; a holder lined up and
  starting at another position is not sitting and his cover earns nothing; a holder sat by the doctor is not
  sitting; a bye counts nothing; a holder traded away (`setTeam`) holds nothing; `beginOffseason` clears jobs.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.** **Step 4: Run** the test file, `npx vitest run
  src/engine/league.test.ts` and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** "Benching: who holds a starting job, set on cut-down day and earned by three starts".

### Task 11: The ask, your answers and how he takes them

**Files:**
- Modify: `src/engine/benching.ts`, `src/engine/morale.ts` (`newJolts`: delete the in-season `benched` branch, keep
  the `week === 0` one; call `benchWeek` just before `talkStep`; `MoraleJolt` gains `'unsure' | 'settled'` with
  their `JOLT_WORDS`, "Doesn't know where he stands" a down reason), `src/engine/playerTalks.ts` (`TalkCause` gains
  `'benched'`; `CAUSE_OF`; `canPromise` stays false for it; an open `benched` ask is never auto-ignored),
  `src/engine/types.ts`, every `Record<TalkCause, …>` the compiler then flags
- Test: `src/engine/benching.test.ts`

**Interfaces:**
- Consumes: `countStarts`, `couldPlay`, `JobQuestion` (Task 10); `beat`, `closeStory` (Task 1).
- Produces:

```ts
export type BenchReply = 'backIn' | 'thisWeek' | 'earn' | 'his';   // to the holder
export type OtherReply = 'yours' | 'compete' | 'his';              // to the other man
export const BENCH = { sit: -1.5, backIn: 0.75, thisWeek: 0.5, earn: -0.5, his: -1.5, kept: 1.5, broken: -3,
  unsure: -0.5, settled: 0.5, chart: -1.5 };                        // starting values; tune only with npm run morale
export function benchWeek(league: League, ctx: MoraleContext, clock: number): void; // every club, in-season steps only
export function answerBench(league: League, playerId: number, reply: BenchReply | OtherReply): boolean;
export function aiBenchReply(league: League, teamId: number, holder: Player, other: Player | undefined): BenchReply;
export function questionOf(team: Team, playerId: number): JobQuestion | undefined;
```

`benchWeek`, per club: (1) settle what is owed: a `promise` is kept when its man started his next game he could
play (`kept` jolt, question closed, story `backIn`) and broken when he could play and didn't (`broken`, his talk's
`broken` count, sour); a `soft` word broken the same way at `chart` size. (2) For each sitter from `countStarts`
with no open question: open one, add the `benched` jolt at `BENCH.sit`, beat `sat` (`pub: true`, `other`). Your
club files his ask (`talk.ask = { cause: 'benched', at: clock }`); an AI club answers through `aiBenchReply` at
once. (3) Open questions at your club: paused while either man can't play (no jolt, runs frozen); otherwise the man
of the two who sat this week gets `unsure` (at most three live), and if he is the `other`, started before and has
not asked, he asks too (beat `swapped`). (4) A man reaching `EARN` settles an unanswered question by the chart: the
loser takes `BENCH.chart` and sours, story closes `settled`, `how` `chart`.

`answerBench` (either man's row): clears both men's `unsure` jolts, gives each `settled`, then by reply: `backIn`
or `yours` sets `promise` for that man with the `promised` jolt; `thisWeek` sets `soft` and a `reassured` jolt;
`earn` or `compete` adds `BENCH.earn` to the man who sat and leaves the job to `EARN`; `his` moves the job to the
other man now and adds `BENCH.his` to the one who lost it. An honest answer (`earn`, `his`) is halved when
`expectedRole` puts the loser below a starter, and scaled by temperament (`temperamentOf`: 0.5 for a calm man, 1.5
for a volatile one). It records `talk.answered`, beats `answered` (`how` the reply) and closes the story for `his`.
`aiBenchReply`: `his` when the other man is better on that club's own read (`perceive`), `backIn` from a GM whose
loyalty beats his stubbornness by 0.2 for a man of six seasons or more, else `earn`.

- [ ] **Step 1: Write the failing tests:**

```ts
it('a healthy job-holder who sits asks the same step, naming who started', () => {
  expect(p.morale!.talk!.ask).toEqual({ cause: 'benched', at: clock }); expect(questionOf(team, p.id)!.other).toBe(q.id);
});
it('a hurt man never asks; a fill-in stepping back never asks', () => {});
it('"back in next week" is kept by his next start and broken by his next healthy sit', () => {});
it('a promise waits while he is hurt', () => {});
it('unanswered, he is unsure each week he sits, and no "ignored" lands', () => {});
it('swap them back and the other man is unsure and asks', () => {});
it('one answer to either man clears both and lifts both the same', () => {
  expect(unsure(a)).toBe(0); expect(unsure(b)).toBe(0); expect(lift(a)).toBe(lift(b));
});
it('three straight starts with no word settles it by the chart', () => {});
it('an AI club answers at once and nobody there is ever unsure', () => {});
it('"his job now" costs half when the new man is plainly better, more for a volatile man', () => {});
it('with your staff sorting the chart he still asks, and the move is the staff’s', () => {  // Review Focus 5
  expect(movedBy(team)).toBe('staff');
});
```

`export function movedBy(team: Team): 'you' | 'staff'` (from `team.autoDepth`) lives in `benching.ts`; Task 13's
`BenchFact.by` reads it, and its test there pins that no line says you sat him.

- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/engine/benching.test.ts src/engine/morale src/engine/playerTalks
  src/engine/meetings` and typecheck. Expected: PASS.
- [ ] **Step 5: Run `npm run morale`.** Expected: nothing flagged ✗, the two "Benched" lines in range. Tune `BENCH`
  sizes only; if a range can't be met, stop and report.
- [ ] **Step 6: Commit** "Benching: he asks the week he sits, four answers, and not knowing where he stands".

### Task 12: When things change mid-story

**Files:**
- Modify: `src/engine/benching.ts`, `src/engine/storiesStep.ts`
- Test: `src/engine/benching.test.ts`, `src/engine/storiesStep.test.ts`

**Interfaces:**
- Consumes: Tasks 3, 10, 11. Produces: no new names; the behaviors of spec section 5.

- [ ] **Step 1: Write one failing test per row of section 5's five tables** that Tasks 10 and 11 don't already pin.
  Each asserts the state and the story's closing beat, for example:

```ts
it('one man of a question leaves: the job is the other man’s, his unsure clears with no lift, one closing beat', () => {
  setTeam(l, other, elsewhere); playWeek(l);
  expect(questionOf(team, holder.id)).toBeUndefined(); expect(unsure(holder)).toBe(0); expect(lift(holder)).toBe(0);
  expect(story.beats.at(-1)).toMatchObject({ kind: 'left' }); expect(story.closed).toBeDefined();
});
it('one of them out for the season closes the question with no hit', () => {});
it('a new man arriving by trade and starting is an ordinary benching, and he is the other', () => {});
it('the club’s season over: no new question, nobody unsure', () => {});
it('the new league year closes open questions quietly and clears jobs', () => {});
it('a left-to-right tackle move is nothing', () => {});
it('two holders sitting the same week open two questions; the third ask waits a step', () => {});
it('you leave the job: open rows close, your old club’s stories are dropped, the new club’s start empty', () => {});
```

- [ ] **Step 2: Run.** Expected: some FAIL. **Step 3: Close the gaps.** **Step 4: Run** `npx vitest run
  src/engine/benching.test.ts src/engine/storiesStep.test.ts src/engine/stories.test.ts` and typecheck. Expected:
  PASS.
- [ ] **Step 5: Commit** "Benching and stories: hurt, traded, cut, moved or out of season mid-story".

### Task 13: The lineup step, the reminder and the letters

**Files:**
- Create: `src/engine/benchVoice.ts`
- Modify: `src/engine/benching.ts`, `src/engine/coachWeek.ts`, `src/engine/coachWeekVoice.ts`,
  `src/engine/playerVoice.ts`, `src/engine/types.ts` (rows), `src/ui/mail.tsx`, `src/ui/App.tsx`
  (`offseasonStep`), `src/ui/screens/Roster.tsx`, `src/styles.css`
- Test: `src/engine/benching.test.ts`, `src/engine/coachWeek.test.ts`, `src/ui/mail.test.tsx`, `src/ui/App.test.tsx`
  (or where `offseasonStep` is tested)

**Interfaces:**
- Produces:

```ts
// types.ts, on a MailSection row
bench?: { playerId: number; clock: number };
restore?: { playerId: number };
// benching.ts
export function lineupProblem(league: League): boolean;   // preseason's last step, autoDepth off, lineupSet !== season, employed
export function confirmLineup(league: League): void;
export function clearedNotStarting(league: League): Player[]; // your job-holders who can play this week and aren't in a starting spot
export function putBack(league: League, playerId: number): void; // placeAt his own position, at the index auto-sort would give him
export function dismissReminder(league: League, playerId: number): void; // sets held[id].reminded; clearedNotStarting then skips him
export interface BenchFact { man: ManSheet; other: ManSheet | null; by: 'you' | 'staff'; backFromInjury: boolean;
  role: 'holder' | 'other'; weeksOpen: string; otherAsked: boolean; better: boolean }
export function benchFact(league: League, p: Player, ctx: MoraleContext): BenchFact | null;
export interface BenchCardView { state: 'open' | 'answered' | 'closed'; role?: 'holder' | 'other';
  options?: { value: BenchReply | OtherReply; label: string }[]; said?: string; line?: string }
export function benchCard(league: League, s: { playerId: number; clock: number }): BenchCardView;
// benchVoice.ts: BENCH_ASK (his words, on BenchFact), BENCH_BEFORE, BENCH_STILL (open weeks, the other now asking),
// BENCH_TOOK (how he took your answer), BENCH_CLOSE (by closing beat), CLEARED (the reminder), JOBS_ROW (camp)
```

Labels: holder "You're back in next week", "It was just this week", "Earn it back", `It's ${other.last}'s job now`;
other man "The job's yours", "Keep competing", `It's ${holder.last}'s job`. `weekItems` gains: tier 1 the `benched`
ask (row `bench`) and each `clearedNotStarting` man (row `restore`, note from `CLEARED`, buttons **Put him back**
and **Leave it**, which calls `dismissReminder`; either way the reminder is told once); tier 2 a closed `benched` story; tier 3 the
week after an answer (`BENCH_TOOK`) and each week a question stays open (`BENCH_STILL`); tier 5 at camp's step
`JOBS_ROW` listing the chart's starters by room and any spot where our scouts read the second man within half a
point of the first (`perceive`, words only). `offseasonStep`: when `lineupProblem`, the step is
`{ label: 'Set your lineup', run: () => {}, then: <the depth chart's route> }`, ahead of whichever step starts the
season. `Roster.tsx` shows the banner and a **Lineup set** button while `lineupProblem`.

- [ ] **Step 1: Write the failing tests:** the advance step reads "Set your lineup" only with `autoDepth` off and
  the season unconfirmed, and starts the season after `confirmLineup`; `clearedNotStarting` lists a job-holder back
  from injury listed third and nobody else; `putBack` puts him among the starters; the reminder row is told once
  after Leave it; his ask row has four buttons with the other man's name on the last; the other man's row has
  three; a ten-year captain and a second-year man get different `BENCH_ASK` text; with `by: 'staff'` no line
  matches `/you (sat|benched|moved)/i`; the open-question row a week later differs from the first and mentions the
  other man once he has asked; the closing row is filed once.
- [ ] **Step 2: Run.** Expected: FAIL. **Step 3: Implement** (`BenchCards` in `mail.tsx` beside `TalkCards`,
  answering through `answerBench`). **Step 4: Run** `npx vitest run src/engine/benching.test.ts
  src/engine/coachWeek.test.ts src/ui` and typecheck. Expected: PASS.
- [ ] **Step 5: Commit** "Benching: Set your lineup, the cleared-starter reminder and its letters".

### Task 14: The save, the replay, docs and 0.4.23

**Files:**
- Modify: `src/engine/generate.ts` (`SAVE_VERSION = 92`), `src/engine/migrate.ts`, `src/engine/migrate.test.ts`,
  `src/engine/coachWeek.season.test.ts`, `scripts/mail-preview.ts`, `docs/NEWS.md`, `CLAUDE.md` (a `benching.ts`
  entry; `morale.ts`'s benching sentence; `npm run morale`'s list of files), `docs/MVP.md`, `package.json`,
  `src/ui/changelog.ts`

- [ ] **Step 1: Write the failing migrate test:** a v91 save in week 6 loads with `jobs.held` holding each club's
  chart starters who have three games played and no questions; a v91 save in preseason loads with your club's
  `lineupSet` equal to the season; a v91 save in the offseason loads with no jobs.
- [ ] **Step 2: Implement the step. Run** `npx vitest run src/engine/migrate.test.ts`. Expected: PASS.
- [ ] **Step 3: Extend the replay test:** in the same season, after week 5 move one healthy job-holder below his
  backup and answer nothing for two weeks, then answer the other man "It's his job" (`his`):

```ts
expect(benchRows(coach).length).toBeGreaterThanOrEqual(3);                 // the ask, an open week, the close
expect(dupes(sentences(coach))).toEqual([]);
expect(openRowsForPlayersOffClub(l)).toEqual([]);
```

- [ ] **Step 4: Preview.** `mail-preview.ts` gains `bench.json` (the first step a `coach:` letter has a `bench`
  row). Run `npm run screens -- --mail coach` and put the screenshots where the owner can open them.
- [ ] **Step 5: Docs, `"version": "0.4.23"`, changelog entry** (title "Am I benched?").
- [ ] **Step 6: Run** `npm run format`, `npm run typecheck`, `npx vitest run src/engine/benching.test.ts
  src/engine/coachWeek* src/engine/migrate.test.ts src/ui`, `npm run morale`. Expected: all pass, nothing flagged.
- [ ] **Step 7: Commit** "0.4.23: the benching chain (v92)"; push. Then read CI on the pull request, if one is
  open, and fix what is red.
