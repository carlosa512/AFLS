# SNN's Weekly Edition Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One SNN mail a week in season, laid out as a front page whose tiles open into stories written in a beat
writer's voice, plus two small fixes (the Gazette's headings, the Key matchups card).

**Architecture:** A mail-side editor (`snnWeek.ts`) gathers the week's candidates from the league's public record,
ranks them in five tiers, cuts them to the edition's slots and has `snnVoice.ts` word each one through `say`
(`voice.ts`). Game angles are pure functions in `snnStory.ts`. The edition is saved on the message as filed and drawn
by a new `ui/edition.tsx`. Nothing in the sim reads any of it.

**Tech Stack:** TypeScript, React, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md`. Read it first. Its pictures and
`2026-11-11-snn-weekly-edition-prototype.html` (the agreed markup and styles, stand-alone) sit beside it.

## Global Constraints

- `src/engine/` is pure: no DOM, no React, no `Math.random`. Mail never draws from a sim stream: ties break on
  `stableHash` (`voice.ts`).
- The sim never reads mail. No file listed in `simReadsNoMail.test.ts` may import `snnWeek.ts`, `snnStory.ts`,
  `snnVoice.ts`, `refer.ts` or `storyRules.ts`.
- Public facts only: results, box-score stats, standings, public injuries and the doctor's public estimate, trades,
  weekly awards, leadership events. Never `player.ratings`, `playerOvr`, `player.potential`, a hidden trait, a mood, a
  private trade block or anything from the story store's non-public beats.
- `League` stays plain JSON. `SAVE_VERSION` (`generate.ts`) is 93 on main and goes to 94 in Task 7, with a step in
  `migrate.ts` and a case in `migrate.test.ts`. If main has moved, take the next number.
- Writing rules (spec section 3) for every story sentence: no semicolon, no colon inside a sentence, at most two
  numbers a sentence, a story's last sentence carries a name, a number or a fixture, no sign-off line, no sentence
  twice in a league year, a person's first mention is his full name. Quotes are plain, at most one a story.
- The matchup card's words: always "the stats this season", the stats never contradict the scouts, a unit performs
  "above expectations" or "below expectations". No "on talent". Units are named in full ("offensive line", "pass
  rush"), ours first.
- No NFL nicknames, "Super Bowl", "AFC" or "NFC". No bylines or journalists.
- UI follows `docs/UI.md`: names through `PlayerLink`/`TeamLink`, pictures through `PlayerAvatar`/`StaffAvatar`/
  `TeamChip`, no paragraph that describes a panel. The screen-contract tests in `src/ui/ui.test.ts` must pass. After
  any screen text changes run `npm run copy` and read the touched lines in `.check/copy.txt`.
- Before each commit: `npm run format`, `npm run typecheck`, and the tests the task names. Never `npm run check`.
  Nothing here moves play, so no sims.
- Commits follow the repo's style ("News: what changed") and end with the session's attribution lines. Push to
  `claude/loving-cerf-wkwav9` after each task. **No pull request** until the owner asks: specs 2 and 3 follow on
  this branch.
- Scratch from the brainstorm (`.superpowers/brainstorm/edition/`) is git-ignored and may be missing. Do not depend
  on it.

## Owner check-ins

The owner reviews words and layouts as they appear. Each check-in below is a **hard stop**: send what it lists, ask
its questions, and wait for his answer before the next task. Fold his changes into the task just finished, re-send
what changed, and only then move on. Keep each message short: what he is looking at, the two or three things his
call decides, nothing else.

| # | After | He gets | His call decides |
| --- | --- | --- | --- |
| 1 | Task 2 | The real Key matchups card and a Gazette table, light and dark, desktop and phone, plus every wording of the card in one list | The card's sentences. Whether "Split" reads right in the game |
| 2 | Task 5 | `.check/editions.md` for one season, game stories only, as text | Do the stories flow. Headline style. Which angles feel overused or thin |
| 3 | Task 7 | `.check/editions.md` again, complete editions with every kind of story, as text | What leads each week. Is the ranking right. The trade, run and coach-out wording |
| 4 | Task 9 | Screenshots of three real editions in the real inbox (a busy week, a thin week, your bye), closed and open, desktop and phone, light and dark | The layout in the game. Tile sizes, what a closed tile shows |
| 5 | Task 10 | A fresh season's `.check/editions.md` with rule breaks listed, and the final screenshots | Sign-off on spec 1 before the docs and the version |

Where his input matters most: check-ins 2 and 3. Wording is cheap to change there and costly after the screen is
built around it.

## Review Focus

Conditions the spec implies and a person will hit. Each has a test in the task that owns the code.

1. **A long advance** ("Sim to playoffs"): one edition, for the latest completed week, built without the pruned play
   logs of earlier weeks. No crash, no backfill. (Task 7)
2. **An old save mid-season** that already filed `press:` or `leadership-week:` mail for the current week: the
   edition does not retell it, and old messages still open. (Task 7)
3. **No club, a bye, week 1**: a GM between jobs gets no Your club slot. On a bye the slot says where you stand.
   After week 1 there are no records, so no upset fires and there may be no game of the week. (Tasks 4 and 8)
4. **A filed edition outlives its facts**: a man in a story is later traded, retired or renamed, a box score is
   pruned. The edition renders as filed and its links still open. (Tasks 7 and 9)
5. **Names**: two men with one surname in a story, a hyphen or an apostrophe in a name, a club whose city has two
   teams (New York, Los Angeles). `refer.ts` never shortens into an ambiguity. (Task 5)

---

### Task 1: The Gazette's table headings

**Files:**
- Modify: `src/styles.css` (`.gazette-table h4`, about line 5691, and the comment above `.gazette`)

- [ ] **Step 1: Change the rule.** `.gazette-table h4` takes `font-family: var(--font-display)` in place of
  `Georgia, 'Times New Roman', serif`. Keep its size, weight, rule and padding. The comment above `.gazette` loses
  "Serif heads".
- [ ] **Step 2: Verify no serif is left in the interface.**
  Run: `grep -n "Georgia\|Times New Roman" src/styles.css`
  Expected: no output.
- [ ] **Step 3: Commit** `News: the Gazette's table headings in the display font`.

### Task 2: The Key matchups card

**Files:**
- Modify: `src/engine/opposition.ts` (`UNITS`, `MatchupFocus`, `focusMatchups`, `evidence`'s labels)
- Modify: `src/ui/mail.tsx` (`MatchupsCard`, replace `RankBar` with `DuelBar`)
- Modify: `src/styles.css` (`.duel*`, `.tag-split`; remove `.rank-bar*` if nothing else uses it)
- Test: `src/engine/opposition.test.ts`, `src/ui/mail.test.tsx`

**Interfaces:**
- Produces: `MatchupFocus` gains `tag: 'us' | 'them' | 'even' | 'split'`, `ours: MatchupFact | null`,
  `theirs: MatchupFact | null` (replacing `facts`), and `lean: 'us' | 'them' | 'close' | null` (the stats). `label`
  becomes `'Edge: us' | 'Edge: them' | 'Even' | 'Split'`. `MatchupFact.label` becomes a verb phrase.

Rules (spec section 6):

| | |
| --- | --- |
| Units | Trenches: "offensive line", "pass rush". Run game: "run game", "run defense". Pass game: "passing game", "coverage" |
| Heading | Ours first: `Our {ours} vs their {theirs}` on both sides of the ball |
| `statGap` | As today: positive favours us |
| `lean` | `'us'` at `statGap >= 4`, `'them'` at `<= -4`, `'close'` between, `null` without both ranks |
| `tag` | Film `null`: `'us'`/`'them'` from `lean`, else `'even'`. Film set and `lean` the other way: `'split'`. Otherwise the film's side |
| Fact phrases | Trenches offense "allows a sack on 5.1% of dropbacks", defense "gets a sack on 10.5% of dropbacks". Run game "gains 4.6 yards a carry", "allows 3.9 yards a carry". Pass game "gains 7.1 yards an attempt", "allows 6.2 yards an attempt" |
| Rank phrases | "15th at preventing them", "29th in sacks", "9th in yards a carry", "22nd at stopping the run", "9th in yards an attempt", "22nd at defending the pass" |
| Top third, bottom third | `rank <= ceil(clubs / 3)`, `rank > floor(2 * clubs / 3)` |

Sentences, film favouring us (mirror every one for film favouring them):

| Stats | Words |
| --- | --- |
| `lean 'us'` | "Our scouts grade our {ours} ahead of their {theirs}, and the stats this season agree. We are {rank} {phrase} and their {unit} is {rank} {phrase}." |
| `lean 'them'`, their unit in the top third | "Our scouts grade our {ours} ahead of their {theirs}. Their {short} is performing above expectations this season. It {fact}, {rank} in the league, and our {short} is {rank} {phrase}." |
| `lean 'them'`, otherwise | "Our scouts grade our {ours} ahead of their {theirs}. Our {short} is performing below expectations this season at {rank} {phrase}. Their {short} is {rank} {phrase}." |
| `'close'`, our unit in the bottom third | The line above |
| `'close'`, otherwise | "Our scouts grade our {ours} ahead of their {theirs}. The stats this season have it close. We are {rank} {phrase} and their {unit} is {rank} {phrase}." |
| no ranks yet | "Our scouts grade our {ours} ahead of their {theirs}." |

A clear film gap (`clear`) says "well ahead of". Film `null`: "Our scouts see nothing between our {ours} and their
{theirs}." then, with a lean, "The stats this season lean our way." or "…their way." and the ranks. Each row is a
bank of two or three wordings chosen by `say` (`voice.ts`) with key `matchup:{season}:{week}:{opponent}` and the
heading as slot, so a report does not repeat itself week to week.

- [ ] **Step 1: Write the failing engine tests** in `opposition.test.ts`:

```ts
it('names the units in full, ours first on both sides of the ball', () => {
  const f = focusMatchups(league, opp.id);
  for (const x of f) expect(x.heading).toMatch(/^Our (offensive line|pass rush|run game|run defense|passing game|coverage) vs their /);
});
it('tags a matchup Split when the film favours us and the stats favour them by four places', () => {
  // build: film gap +0.3 for our line, our line 15th in sacks allowed, their rush 2nd in sacks made
  expect(focus.tag).toBe('split');
  expect(focus.label).toBe('Split');
  expect(focus.why).toContain('performing above expectations this season');
});
it('says our unit is below expectations when the film favours it and it ranks in the bottom third', () => {
  expect(focus.tag).toBe('us');
  expect(focus.why).toContain('Our rush is performing below expectations this season at 29th in sacks.');
});
it('never contradicts the scouts and keeps to the writing rules', () => {
  for (const why of everyWhy) {          // every case, every wording
    expect(why).not.toMatch(/say otherwise|should win|On talent|;/);
    expect(why.replace(/\d:\d/g, '')).not.toContain(':');
  }
});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/opposition.test.ts`. Expected: FAIL (`tag` undefined, old words).
- [ ] **Step 3: Implement** the rules above in `focusMatchups`. Export the sentence banks so the test and check-in 1
  can list every wording.
- [ ] **Step 4: Run** the engine tests. Expected: PASS.
- [ ] **Step 5: Write the failing screen test** in `mail.test.tsx`: the card renders one `.duel` a matchup with our
  unit's caption first, the tag pill reads "Split" with class `tag-split`, and no `.rank-bar` remains.
- [ ] **Step 6: Implement `DuelBar({ ours, theirs, lean, clubs })`** in `mail.tsx` and its styles, copying the markup
  and the `.duel*`, `.mu*` and `.tag-split` rules from the prototype page's "Key matchups" section. Ours grows left,
  theirs grows right, width `(clubs + 1 - rank) / clubs`. Fill is `var(--win)` on ours when `lean` is `'us'`,
  `var(--loss)` on theirs when `'them'`, grey otherwise.
- [ ] **Step 7: Run** `npx vitest run src/ui/mail.test.tsx src/ui/ui.test.ts` and `npm run copy`. Expected: PASS, and
  the card's lines in `.check/copy.txt` read as above.
- [ ] **Step 8: Bump the version** to the next patch in `package.json` with a `src/ui/changelog.ts` entry (title 40
  characters at most, text 200 at most) for the two fixes.
- [ ] **Step 9: Commit** `News: the Key matchups card names its units and its sources`.

**CHECK-IN 1.** Build a save in season (`npm run mail-preview`), shoot the opposition report and a Gazette column
(`npm run screens -- --mail matchup:,gazette:`, light and `--dark`, desktop and phone) and send them with the list
of every card wording. Ask: do the sentences read like a scout talking, and does "Split" read right. Wait.

### Task 3: A game's angle

**Files:**
- Create: `src/engine/snnStory.ts`
- Test: `src/engine/snnStory.test.ts`

**Interfaces:**
- Produces:

```ts
export const CUT = {
  runGames: 5, streak: 6, upsetGap: 0.4, upsetAfterWeek: 5, comeback: 10, yardage: 100, rout: 28, backupDropbacks: 10,
  day: { td: 3, scrimmage: 200, passYds: 400, passTd: 5, sacks: 3, int: 3 },
} as const;
export type GameAngle =
  | 'unbeatenFalls' | 'winlessWins' | 'upset' | 'tie' | 'streakEnds' | 'comeback' | 'yardage' | 'day' | 'qbLost'
  | 'rout' | 'overtime' | 'result';
export interface ClubRecord { w: number; l: number; t: number; streak: number }   // streak: +3 won three, -2 lost two
export interface Day { playerId: number; teamId: number; mark: keyof typeof CUT.day; value: number }
export interface GameFacts {
  gameId: number; week: number;
  winnerId: number | null; loserId: number | null;          // null on a tie
  before: { home: ClubRecord; away: ClubRecord };
  angle: GameAngle;            // the first that fits, in the order of the type above
  fits: GameAngle[];           // every one that fits, same order: the others are support
  day?: Day;                   // the best day in the game, whichever angle won
  deficit?: number;            // the most the winner trailed by at the end of a quarter
  yards?: number;              // the winner's total yards less the loser's
  qbLost?: { teamId: number; starterId: number; backupId: number };
  streak?: { teamId: number; length: number };              // the run or streak that ended
}
/** Every club's record and streak from results before `week` of the league's current season. */
export function recordsBefore(l: League, week: number): Map<number, ClubRecord>;
export function gameFacts(l: League, g: Game, before: Map<number, ClubRecord>): GameFacts;
```

Cutoffs are the spec's angle table. A day's touchdowns are `rushTd + recTd + krTd + prTd + defTd`. Scrimmage yards
are `rushYds + recYds`. The best day is the one furthest past its mark as a ratio. `qbLost`: a `GameInjury` to a
player at QB whose club had a second passer with `dropbacks >= 10`.

- [ ] **Step 1: Write the failing tests.** A helper `result(over)` builds a `GameResult` from quarters and team
  totals. One test an angle at its edge, with the spec's numbers:

```ts
it('calls an upset only after week 5 and at .400 or more', () => {
  expect(angleOf({ week: 6, winner: rec(1, 4), loser: rec(4, 1) })).toBe('upset');        // .200 against .800
  expect(angleOf({ week: 5, winner: rec(1, 3), loser: rec(4, 0) })).not.toBe('upset');    // too early
  expect(angleOf({ week: 9, winner: rec(3, 5), loser: rec(6, 2) })).not.toBe('upset');    // .375 against .750
});
it('reads a comeback at the end of any quarter', () => {
  expect(facts({ winnerQ: [0, 7, 7, 14], loserQ: [10, 7, 0, 3] }).fits).toContain('comeback');   // ten down after one
  expect(facts({ winnerQ: [7, 7, 7, 7], loserQ: [10, 10, 0, 0] }).fits).not.toContain('comeback'); // six down
});
it('orders the angles and keeps the rest as support', () => {
  const f = facts({ week: 8, loser: rec(7, 0), winnerQ: [0, 0, 7, 21], loserQ: [14, 3, 0, 0] });
  expect(f.angle).toBe('unbeatenFalls');
  expect(f.fits).toEqual(expect.arrayContaining(['unbeatenFalls', 'comeback']));
});
```

  Also: `winlessWins` at 0–5, `tie` ahead of `streakEnds`, `streakEnds` at six and not five, `yardage` at −100 and not
  −99, each `day` mark at its value and one below (3 TD, 200, 400, 5, 3 sacks, 3 INT), `qbLost` needs the injury and
  ten dropbacks, `rout` at 28 ahead after every quarter and not when trailing after one, `overtime`, and `result`
  when nothing fits. Week 1 with empty records yields no `upset`, `unbeatenFalls` or `winlessWins`.
- [ ] **Step 2: Run** `npx vitest run src/engine/snnStory.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** `recordsBefore` and `gameFacts`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `News: a game's angle, from the box score and the standings before it`.

### Task 4: Candidates from the week, ranked and cut

**Files:**
- Create: `src/engine/snnWeek.ts`
- Modify: `src/engine/types.ts` (`EditionStory`, `Edition`, `InboxMessage.edition`)
- Test: `src/engine/snnWeek.test.ts`

**Interfaces:**
- Consumes: `gameFacts`, `recordsBefore`, `CUT` (Task 3).
- Produces, in `types.ts`:

```ts
export type StoryKind =
  | 'game' | 'division' | 'trade' | 'rumor' | 'starOut' | 'leaderOut' | 'run' | 'speak' | 'room' | 'mentor';
export interface EditionScore { gameId: number; homeId: number; awayId: number; home: number; away: number; overtime?: true }
export interface EditionStory {
  key: string;            // 'game:{gameId}', 'run:{teamId}:{season}:{startWeek}', 'starOut:{playerId}:{week}' …
  kind: StoryKind; angle: string; tier: 1 | 2 | 3 | 4 | 5;
  clubId: number;         // the club the angle is about
  yours?: true;
  kicker: string; headline: string; summary: string;
  picture: { playerId?: number; coachId?: number; gameId?: number; teamIds?: number[] };
  score?: EditionScore;
  numbers: { value: string; label: string }[];      // at most three
  paragraphs: string[];                              // two to four
  quote?: { coachId?: number; playerId?: number; name: string; role: string; text: string };
  links: InboxAction[];
}
export interface Edition {
  label: string;                                     // 'Week 9', 'Wild Card' …
  scores: EditionScore[];
  lead: EditionStory;
  club?: EditionStory;
  tiles: EditionStory[];
  race?: { division: string; rows: { teamId: number; w: number; l: number; t: number; last: string; next: string }[] };
  bracket?: { results: EditionScore[]; next: { homeId: number; awayId: number }[] };
  next?: { gameId: number; homeId: number; awayId: number; home: string; away: string };   // game of the week
}
```

  and in `snnWeek.ts`:

```ts
export interface Candidate { key: string; kind: StoryKind; tier: 1 | 2 | 3 | 4 | 5; clubId: number; stakes: number;
  game?: GameFacts; run?: { teamId: number; length: number; startWeek: number; faded?: true };
  out?: { playerId: number; gameId: number }; }       // Task 6 adds the other kinds' payloads
export function gameCandidates(l: League, week: number): Candidate[];
export function runCandidates(l: League, week: number): Candidate[];
export function starOutCandidates(l: League, week: number): Candidate[];
export function rankCandidates(cs: Candidate[], editionId: string): Candidate[];
export function cutEdition(ranked: Candidate[], userTeamId: number | null):
  { lead: Candidate; club?: Candidate; tiles: Candidate[] };
```

Rules (spec section 2). Tier by angle: `unbeatenFalls`, `winlessWins` 2. `upset`, `tie`, `streakEnds`, `starOut`
3. `day`, `comeback`, `yardage`, `qbLost` 4. `rout`, `overtime`, `result`, a continuing `run` 5. `stakes` is the two
clubs' combined winning percentage, plus 0.25 for a division game. Order: tier, then stakes, then
`stableHash(editionId + key)`. A run candidate: a club that reached six straight this week (`length === 6`), or one
that started 5–0 or better and has lost two of its last three (`faded`). A star is a man with a weekly award this
season (`league.weeklyAwards`), a top-five place in the league in passing, rushing or receiving yards, sacks or
interceptions, or his club's starting quarterback. He is out for the season when the public estimate's low end
(`GameInjury.estimate[0]`) reaches the weeks left in the regular season.

The cut: the user's game is always `club` unless it ranks first, when it is `lead` with `yours` and there is no
`club`. A user on a bye gets a `club` candidate of kind `game` and angle `'bye'` (tier 5, no `game`). No user club:
no `club`. Tiles are the next three (four when the user's game leads), skipping a candidate whose `clubId` already
has a story in the edition, and a second trade unless it is tier 1.

- [ ] **Step 1: Write the failing tests**, building candidates by hand:

```ts
it('ranks by tier, then stakes, then a stable hash', () => {
  const r = rankCandidates([c('a', 5, 1.2), c('b', 3, 0.6), c('c', 3, 1.1)], 'snn:2026:w9');
  expect(r.map((x) => x.key)).toEqual(['c', 'b', 'a']);
  expect(rankCandidates([c('x', 4, 1), c('y', 4, 1)], 'snn:2026:w9'))
    .toEqual(rankCandidates([c('y', 4, 1), c('x', 4, 1)], 'snn:2026:w9'));
});
it('keeps the user’s game for Your club and one story a club', () => {
  const e = cutEdition(ranked, user);
  expect(e.club?.clubId).toBe(user);
  expect(new Set([e.lead, ...e.tiles].map((x) => x.clubId)).size).toBe(1 + e.tiles.length);
  expect(e.tiles.length).toBeLessThanOrEqual(3);
});
it('leads with the user’s game when it is the week’s biggest, and runs a fourth tile', () => { /* lead.yours, no club, 4 tiles */ });
it('gives a club on a bye its slot, and a GM between jobs none', () => { /* angle 'bye'; club undefined for null */ });
it('runs fewer tiles in a thin week', () => { /* two candidates: lead + one tile, no error */ });
```

  And on a played league (`createLeague` then `playWeek` nine times): `gameCandidates(l, 9)` has one a game of week 9,
  `runCandidates` tells a six-game streak once (week it reaches six, not week seven), and week 1 produces no tier 2
  or 3 game candidate.
- [ ] **Step 2: Run** `npx vitest run src/engine/snnWeek.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** the types and the five functions.
- [ ] **Step 4: Run** the tests and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** `News: the edition's candidates, ranked and cut to its slots`.

### Task 5: The words: names, line banks, rule checks, a reading tool

**Files:**
- Create: `src/engine/refer.ts`, `src/engine/snnVoice.ts`, `src/engine/storyRules.ts`, `scripts/editions.ts`
- Modify: `src/engine/snnWeek.ts` (`buildEdition`), `package.json` (`"editions": "tsx scripts/editions.ts"`)
- Test: `src/engine/refer.test.ts`, `src/engine/snnVoice.test.ts`, `src/engine/storyRules.test.ts`

**Interfaces:**
- Consumes: `Candidate`, `cutEdition` (Task 4), `say`, `around`, `seasonSaid`, `stableHash`, `mottoOf` (`voice.ts`).
- Produces:

```ts
// refer.ts: one per story. First call for a man gives his full name, later calls his surname, unless two men in
// the story share it. A club is "the Voyageurs" first, then its city, unless two clubs share the city.
export function referrer(l: League, cast: { playerIds: number[]; teamIds: number[] }): {
  man(playerId: number): string; club(teamId: number): string; city(teamId: number): string;
};
// snnVoice.ts
export function writeStory(l: League, c: Candidate, at: { editionId: string; said: string[] }): EditionStory;
// storyRules.ts: the writing rules a test can hold. Empty when the story keeps them all.
export function ruleBreaks(l: League, s: EditionStory): string[];
// snnWeek.ts
export function buildEdition(l: League, week: number): Edition | null;   // null when the week is not complete
```

`writeStory` pushes every sentence it uses onto `at.said`, so one edition never repeats itself and `buildEdition`
seeds it with `seasonSaid(l, 'SNN — Sports News Network', 'snn:')`.

A story has four jobs in order (what happened, why, what it means, what is next), one paragraph each, and may drop
"why" or "what it means" when it has nothing to say, never below two paragraphs. Each angle has its own bank for
each job, for its headline and for its tile summary, at least three wordings of the fallback (`reads: 0`) and more
specific lines above them. The support angles in `fits` feed "why" (a lost quarterback, turnovers, a comeback).
"What it means" is the standings consequence plus at most one callback: a record some weeks ago, an earlier
meeting this season, a weekly award in the last four weeks, a top-three or bottom-three league rank in a stat. "What
is next" names each club's next opponent. Verbs for a margin are chosen by the margin (28 and over "ran over",
"routed"; 3 and under "edged", "held off"). Numbers: at most three chips, drawn from the angle's own facts. The
quote: one bank a result and angle, each line's `when` reading a fact that is in the story, plain coach-speak,
chosen only when it fits, the head coach of `clubId`, a motto at most once a season. The spec's two worked stories
(the Reed lead, the Krewe trade) are the standard to write to.

`ruleBreaks` checks, a message each: a semicolon in a paragraph or quote, a colon inside a sentence (a time such as
17:34 is not one), more than two numbers in a sentence, a last sentence with no digit, no cast name and no club
name, fewer than two or more than four paragraphs, more than three numbers chips, a quote on a story with no
paragraphs, a first mention that is not the full name, a headline over 70 characters.

`scripts/editions.ts` (`npm run editions [-- seed] [--weeks n]`): builds a league, plays the regular season, calls
`buildEdition` after each week and writes `.check/editions.md`: a heading a week, then each story as kicker,
headline, numbers, paragraphs and quote, marked LEAD, YOUR CLUB or TILE, and at the very top every `ruleBreaks`
message with its week and headline, and a count of how often each angle led. A preview, not a check.

- [ ] **Step 1: Write the failing `refer` tests**:

```ts
it('gives the full name once, then the surname', () => {
  const r = referrer(l, { playerIds: [reed.id], teamIds: [] });
  expect([r.man(reed.id), r.man(reed.id)]).toEqual(['Jamison Reed', 'Reed']);
});
it('keeps the full name when two men in the story share a surname', () => { /* both calls return full names */ });
it('keeps a hyphen and an apostrophe whole', () => { /* "D'Andre Smith-Jones" then "Smith-Jones" */ });
it('never shortens a club to a city two clubs share', () => { /* New York, Los Angeles: club() both times */ });
```

- [ ] **Step 2: Run** `npx vitest run src/engine/refer.test.ts`. Expected: FAIL. **Implement** `refer.ts`. Expected: PASS.
- [ ] **Step 3: Write the failing `storyRules` tests**: one story that keeps every rule returns `[]`, and one test a
  rule with a story that breaks only it (a semicolon, "The margin: ten points.", three numbers in a sentence, a last
  sentence "That was the game.", one paragraph, a surname on first mention).
- [ ] **Step 4: Implement** `storyRules.ts`. Expected: PASS.
- [ ] **Step 5: Write the failing `snnVoice` tests**:

```ts
it('writes a story for every game angle that keeps the rules', () => {
  for (const c of oneCandidatePerAngle) expect(ruleBreaks(l, writeStory(l, c, at()))).toEqual([]);
});
it('quotes only the head coach of the story’s club, and never in a way the facts do not carry', () => {
  const s = writeStory(l, dayCandidate, at());
  if (s.quote) expect(s.quote.coachId).toBe(headCoachOf(l, s.clubId).id);
});
it('does not say a sentence twice across a season of editions', () => {
  for (let w = 1; w <= 18; w++) { playWeek(l); editions.push(buildEdition(l, w)!); }
  const allSentences = editions.flatMap(sentencesOfEdition);       // every paragraph and quote
  expect(dupes(allSentences)).toEqual([]);
});
```

- [ ] **Step 6: Implement** `snnVoice.ts` for kinds `game`, `run`, `starOut` and the `bye` club story, and
  `buildEdition` (scores, lead, club, tiles; `race`, `bracket` and `next` come in Tasks 7 and 8).
- [ ] **Step 7: Run** the three test files and `npm run typecheck`. Expected: PASS.
- [ ] **Step 8: Write `scripts/editions.ts`**, run `npm run editions`, and read `.check/editions.md` end to end
  yourself. Fix every rule break and every story that reads stitched before sending it on.
- [ ] **Step 9: Commit** `News: the edition's stories, their rules and a season to read`.

**CHECK-IN 2.** Send `.check/editions.md` (copy it into the scratchpad so the owner can open it). Say it is game
stories only, text only, no layout. Ask: do the stories flow, is the headline style right, and which angles feel
overused or thin. Wait, fix, re-send what changed.

### Task 6: The other kinds: division, trades, rumors, people out, and SNN's three extras

**Files:**
- Modify: `src/engine/snnWeek.ts`, `src/engine/snnVoice.ts`
- Modify: `src/engine/news.ts` (export the division change as data), `src/engine/tradeNews.ts` (export the selection
  as data), `src/engine/lockerMail.ts`, `src/engine/meetings/mail.ts` (export what they would file)
- Test: `src/engine/snnWeek.test.ts`, `src/engine/snnVoice.test.ts`, `src/engine/news.test.ts`

**Interfaces:**
- Produces:

```ts
// news.ts: the lead change `leagueNews` reports today, as facts (same rules: week 10 on, the user's division).
export function divisionLeadChange(l: League, week: number):
  { leaderId: number; formerId: number; division: number; before: TeamRecord[]; after: TeamRecord[] } | null;
// tradeNews.ts: the deals and rumors today's rules would report for the week, as facts.
export function reportableTrades(l: League, week: number):
  { key: string; star: boolean; buyerId: number; sellerId: number; exchanges: { teamId: number; receives: string }[];
    headlinePlayerId?: number; kind: string }[];
export function reportableRumors(l: League, week: number):
  { key: string; playerId: number; clubId: number; status: string }[];
// lockerMail.ts and meetings/mail.ts: what they would file in season, as facts.
export function speakFacts(l: League, have: Set<string>): { id: string; playerId: number; teamId: number; kind: SpeakEvent; said: string }[];
export function mentorFacts(l: League, have: Set<string>): { id: string; mentorId: number; discipleId: number; gameId: number }[];
// snnWeek.ts
export function newsCandidates(l: League, week: number, have: Set<string>): Candidate[];
```

Tiers: a star trade (`star`) and a head coach or GM out (`leadership.events` of kinds `gmDismissed`,
`coachDismissed`, `coachInterim` at another club, dated this week) 1. A division lead change 2. A player speaking
out and a coach losing his room (`snnRumor`) 4. Another trade, a rumor, a coach facing his mentor 5. Trade angles:
the seller's second sale this season (`league.market.history`), a buyer at .600 or better, a swap, a rental. The
existing functions keep working by calling the new exports, so `news.test.ts`'s rules still decide what is
reportable.

- [ ] **Step 1: Write the failing tests**: `divisionLeadChange` returns exactly what `leagueNews` would have filed
  (same league, same week, compared field by field) and `null` before week 10. `reportableTrades` matches
  `keyTradeNews`'s picks and excludes the user's own deals. `newsCandidates` gives a coach-out tier 1, a second sale
  the angle `'secondSale'`, and nothing for a key already in `have`. `writeStory` keeps `ruleBreaks` empty for each
  new kind, and a `speak` story's quote has a `playerId` and its last sentence still carries a fixture.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement**: the exports, `newsCandidates`, the line banks for each kind, and `buildEdition`
  gathering game, run, star-out and news candidates together. A coach or GM out is reported with the record he
  leaves and who steps in, and nothing about anyone's job beyond that.
- [ ] **Step 4: Run** `npx vitest run src/engine/snnWeek.test.ts src/engine/snnVoice.test.ts src/engine/news.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Run `npm run editions`** and read the new kinds in `.check/editions.md`.
- [ ] **Step 6: Commit** `News: trades, lead changes, people out and SNN's extras as edition stories`.

### Task 7: Filing the edition, and the mail it replaces

**Files:**
- Modify: `src/engine/snnWeek.ts` (`editionMail`), `src/engine/inbox.ts` (`deliverMail`, `mailSubject`, `MailSubject`,
  `leadershipMail`'s in-season roundup), `src/engine/news.ts` (`leagueNews`), `src/engine/lockerMail.ts`,
  `src/engine/meetings/mail.ts`, `src/engine/generate.ts` (`SAVE_VERSION`), `src/engine/migrate.ts`
- Test: `src/engine/snnWeek.test.ts`, `src/engine/news.test.ts`, `src/engine/inbox.test.ts`, `src/engine/migrate.test.ts`

**Interfaces:**
- Produces: `export function editionMail(l: League, have: Set<string>): Draft[]`. `MailSubject` gains
  `{ kind: 'edition'; season: number; week: number }`, parsed from `snn:{season}:w{week}` and `snn:{season}:p{round}`.

The message: id as above, `from: 'SNN — Sports News Network'`, `category: 'league'`, `phase` and `week` of the games
it covers, `subject` `"{label} · {lead headline} · {club headline}"` with each headline cut at a word to 48
characters, `body` the lead's summary then the club's (so search finds it), `edition`, `actions` the lead's links,
and `covered`: every story's `key` and the old id each would have filed under (`press:…`, `leadership-week:…`,
`speak:…`, `tree:meet:…`, the rumor's key). Never Needs you.

It files for the latest completed week only, when no `snn:` id for that week is in `have`. `race` is the user's
division from `divisionStandings`, each row with its last result ("W 41–10", "bye") and next opponent ("at HOU",
"BAL", "bye"), absent without a club. In the playoffs `bracket` replaces `race` and `next`.

What stops filing in `regular` and `playoffs`: `leagueNews`'s weekly headline (it still files the deadline-day
edition), the other-clubs roundup in `leadershipMail`, `speakMail`, the mentor meeting in `treeMail`, and the
meetings rumor. Each keeps filing out of season exactly as today. Anything whose old id is already in `have` or in
an edition's `covered` is not a candidate.

- [ ] **Step 1: Write the failing tests**:

```ts
it('files one edition a completed week and nothing on a second delivery', () => {
  for (let w = 0; w < 6; w++) { playWeek(l); deliverMail(l); deliverMail(l); }
  expect(ids(l, 'snn:').length).toBe(6);
  expect(ids(l, 'press:').filter(inSeason).length).toBe(0);
});
it('files only the latest week after a long advance', () => {
  for (let w = 0; w < 12; w++) playWeek(l);       // one delivery at the end, earlier play logs pruned
  deliverMail(l);
  expect(ids(l, 'snn:')).toEqual([`snn:${l.season}:w12`]);
});
it('does not retell what an old save already filed this week', () => {
  // a v93 save with press:{season}:9:trade:… in the inbox: the week-9 edition carries no story with that key
});
it('has no Your club slot for a GM between jobs, and still files', () => { /* edition.club undefined */ });
it('survives its facts: a traded or retired man, a pruned box score', () => {
  const before = JSON.stringify(edition(l, 9));
  /* trade the lead's man, retire another, prune the week's plays, play three more weeks */
  expect(JSON.stringify(edition(l, 9))).toBe(before);
});
it('is never Needs you', () => { expect(needsYou(l, message)).toBe(false); });
```

  In `migrate.test.ts`: a v93 save upgrades to 94 unchanged apart from `version`, and its `press:` mail still parses
  through `mailSubject`. In `news.test.ts`: the deadline-day edition still files on deadline day.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `editionMail` joins the block at the end of `deliverMail` beside `leagueNews`. Bump
  `SAVE_VERSION` to 94 with a step that only sets the version.
- [ ] **Step 4: Run** the four test files, then `npx vitest run src/engine/simReadsNoMail.test.ts`. Expected: PASS.
- [ ] **Step 5: Run `npm run editions`** (it now reads filed editions from the inbox) and read it through.
- [ ] **Step 6: Commit** `News: SNN files one edition a week in season`.

**CHECK-IN 3.** Send the new `.check/editions.md`: complete editions, every kind of story, still text. Ask: is the
right story leading each week, does the ranking feel right, and how do the trade, run and coach-out stories read.
Wait, fix, re-send.

### Task 8: The game of the week in the engine

**Files:**
- Create: `src/engine/season/gameOfWeek.ts`
- Modify: `src/ui/strip.tsx` (`stripGames` reads it), `src/engine/snnWeek.ts` (`Edition.next`)
- Test: `src/engine/season/gameOfWeek.test.ts`, `src/ui/ui.test.ts` (existing strip tests stay green)

**Interfaces:**
- Produces: `export function gameOfWeek(l: League, week: number, records?: Records): Game | undefined`, today's rule
  moved as it is: among the week's unplayed, non-playoff games that are not the user's, the highest sum of the two
  clubs' winning percentages, and none when no club has a record.

- [ ] **Step 1: Write the failing test**: it returns the pair `stripGames` tags today on a played league, `undefined`
  in week 1, and never the user's game.
- [ ] **Step 2: Run.** Expected: FAIL. **Implement**, and have `stripGames` call it. `buildEdition` sets `next` from
  `gameOfWeek(l, week + 1)` with each club's record as text ("7–2").
- [ ] **Step 3: Run** `npx vitest run src/engine/season/gameOfWeek.test.ts src/ui/ui.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit** `News: one game of the week for Home and the edition`.

### Task 9: The screen

**Files:**
- Create: `src/ui/edition.tsx`
- Modify: `src/ui/mail.tsx` (`MailCards` hands a message with `edition` to `EditionCards`; the deadline-day mail
  draws its trades with `StoryBlock`), `src/styles.css` (`.ed-*`), `scripts/screens.ts` (`--edition`)
- Test: `src/ui/edition.test.tsx`, `src/ui/ui.test.ts`

**Interfaces:**
- Consumes: `Edition`, `EditionStory` (Task 4).
- Produces: `EditionCards({ league, message })`, `StoryBlock({ league, story, onClose })`, `ScoreStrip`, `RaceTable`.

Copy the markup and the styles from the prototype page (classes `.ticker`, `.front`, `.tiles`, `.tile`,
`.openstory`, `.hero`, `.stats`, `.quote`, `.race`, `.gotw`), renamed under an `ed-` prefix and using the existing
tokens. Behaviour (spec section 4): every tile starts closed and shows kicker, headline, summary and "Read". Opening
one replaces it with the story block at full width (the band in the club's primary colour with the score and the
picture, the headline, the chips, the paragraphs, the quote, the links as buttons, "Close"). One story open at a
time, held in component state. At 640px and under the tiles are one column and the score strip scrolls sideways.
A paragraph's names become `PlayerLink` and `TeamLink` through `nameAt` over the story's cast. The picture is
`PlayerAvatar` with the story's game (so he wears that day's uniform), `StaffAvatar` for a coach, `TeamChip` for
clubs. A man or coach no longer in the league renders his name as text and no picture, never an error. Text on the
band uses `inkOn` (`color.ts`) for the club's colour. A score in the strip opens its box score.

- [ ] **Step 1: Write the failing tests** (render with `renderToStaticMarkup` and a filed edition):

```ts
it('opens closed, with every slot the edition has', () => {
  expect(html).toContain('ed-ticker'); expect(count(html, 'ed-tile')).toBe(1 + edition.tiles.length);
  expect(html).not.toContain('ed-story');
});
it('opens one story in place and closes it', () => { /* click Read on a tile: one ed-story, that tile gone; Close restores */ });
it('links every name and shows no rating', () => { /* PlayerLink/TeamLink buttons present; no "OVR", no star glyph */ });
it('renders an edition whose lead man has retired', () => { /* no throw, his name as text */ });
it('draws the bracket in the playoffs and no race', () => { /* ed-bracket present, ed-race absent */ });
```

  And the screen-contract tests in `ui.test.ts` extended to `edition.tsx`.
- [ ] **Step 2: Run** `npx vitest run src/ui/edition.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the components, the styles and the hand-off.
- [ ] **Step 4: Run** `npx vitest run src/ui/edition.test.tsx src/ui/ui.test.ts src/ui/mail.test.tsx`,
  `npm run typecheck`, `npm run copy`. Expected: PASS, and no line in `.check/copy.txt` from `edition.tsx` that
  describes a panel or explains a control.
- [ ] **Step 5: Add `--edition` to `scripts/screens.ts`**: for the newest three `snn:` messages it shoots the reading
  pane closed, then with the lead open, on desktop and phone. Run it light and `--dark` on a save from
  `npm run mail-preview`, and look at every picture yourself against the spec's two reference pictures.
- [ ] **Step 6: Commit** `News: the edition as a front page in the inbox`.

**CHECK-IN 4.** Send the screenshots for three editions: a busy week, a thin week and the owner's bye (pick the
weeks from the save, or build a second save to get a bye). Closed and open, desktop and phone, light and dark. Ask:
does the layout hold up in the real inbox, are the tiles the right size, does a closed tile show enough. Wait, fix,
re-shoot.

### Task 10: A season held to the rules

**Files:**
- Create: `src/engine/snnWeek.season.test.ts`
- Modify: `scripts/editions.ts` (the final report)

- [ ] **Step 1: Write the test**, after `coachWeek.season.test.ts`: play a full regular season and the playoffs with
  `deliverMail` after each step, then over every `snn:` message assert: one a completed week and playoff round, no
  two with one id, `ruleBreaks` empty for every story, no sentence twice across the season (`sentencesOf` over every
  paragraph and quote), at most one quote a story, every story's `clubId` unique within its edition, no trade or run
  `key` in two editions, and `needsYou` false for all. Then play the same seed with `editionMail` returning `[]` and
  assert every game's score is identical.
- [ ] **Step 2: Run** `npx vitest run src/engine/snnWeek.season.test.ts`. Expected: PASS. Fix the words, not the
  rules, where it fails.
- [ ] **Step 3: Run `npm run editions -- a-new-seed`** so the owner reads a season he has not seen, and read it
  through first.
- [ ] **Step 4: Commit** `News: a season of editions held to the writing rules`.

**CHECK-IN 5.** Send the fresh `.check/editions.md` (rule breaks at the top should be none) and the final
screenshots. Ask for sign-off on spec 1, or the last changes. Wait.

### Task 11: The record

**Files:**
- Modify: `docs/NEWS.md`, `CLAUDE.md`, `docs/MVP.md`, `package.json`, `src/ui/changelog.ts`

- [ ] **Step 1: `docs/NEWS.md`**: a section on the weekly edition (when it files, its slots, the tiers, the angles
  and their cutoffs with a pointer to `scripts/research-edition.py`, the writing rules, what it replaced and what
  still files alone). Correct the lines it makes untrue ("One public headline at most…", the in-season roundups).
- [ ] **Step 2: `CLAUDE.md`**: `npm run editions` under Commands as a preview, and under Architecture one entry for
  `snnWeek.ts`, `snnStory.ts`, `snnVoice.ts`, `refer.ts`, `storyRules.ts`, `season/gameOfWeek.ts` and
  `ui/edition.tsx`, plus the matchup card's rule in the `inbox.ts` entry's line on the opposition report.
- [ ] **Step 3: `docs/MVP.md`**: the "Full news and media outlets" line stays Partial and says what the edition
  added and what specs 2 and 3 will add.
- [ ] **Step 4: Version**: the next patch in `package.json` and a `changelog.ts` entry in a player's words.
- [ ] **Step 5: Run** `npm run format`, `npm run typecheck`, `npx vitest run src/ui/changelog.test.ts`. Expected: PASS.
- [ ] **Step 6: Commit** `News: the weekly edition in the docs, version bump`. Push. Do not open a pull request.
