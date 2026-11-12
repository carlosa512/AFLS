# SNN on the Calendar's Big Days Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SNN files five special editions a year on the weekly edition's front page (the new league year, free
agency, draft day, cut-down day, kickoff), from the public record, in place of its three offseason digests.

**Architecture:** One mail-side editor (`snnDays.ts`) decides which moment the league is at, gathers that day's
candidates from the transaction log, the draft record, leadership events and the schedule, ranks and cuts them, and
has `snnDayVoice.ts` word them. A pure reader (`publicStanding.ts`) says who is a star from last season's public
record. The page (`ui/edition.tsx`) gains one list box. What an edition printed lives in its `covered` keys, which is
also how the old digests step aside.

**Tech Stack:** TypeScript, React, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-12-snn-big-days-design.md`. It builds on
`docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md` (the page, the writing rules).

**Execution:** Native, as for specs 1 and 2. One review of the whole branch comes at the very end, before the pull
request: none after this plan.

## Global Constraints

- Branch `claude/loving-cerf-wkwav9`. Commit "Area: what changed", push after each task. No pull request.
- **Check-ins are hard stops.** At each: send renders (the owner reads pictures, not lists) and the counts, then wait.
- **Every bar is a named constant** (`DAY` in `snnDays.ts`, `STANDING` in `publicStanding.ts`) and starts as a first
  guess. The owner sets them at check-in 1. Never tune one to make a test pass.
- **Public record only** in anything SNN prints: picks and the consensus rank (`Player.draft`), contracts,
  `League.transactions`, `LeadershipEvent.report`, depth charts (`Team.jobs.held`), last season's stat lines
  (`Player.stats[season]`) and awards (`League.awards`). No rating, mood, hidden trait or scout's read (`perceive`,
  `seenOvr` and `bestKnown` are not imported by the new modules).
- **The sim never reads mail.** `snnDays.ts`, `snnDayVoice.ts` and `publicStanding.ts` are imported by nothing
  outside mail, scripts and screens (`simReadsNoMail.test.ts`). No `Math.random`, no draws; ties break on `stableHash`.
- **One SNN mail a step at most**, never Needs you, ids `snn:{season}:d:{day}` with `day` one of `year`, `market`,
  `draft`, `cuts`, `kickoff`. Subject: `{label} · {lead headline}`, 60 characters at most (`SUBJECT` in `snnWeek.ts`).
- **Writing rules**: every story passes `ruleBreaks` (`storyRules.ts`) and the house rules (`letterRules.ts`;
  `snnDayVoice.ts` joins `LETTER_FILES`). No sentence twice in a league year (`seasonSaid(l, SNN, 'snn:')`).
- **No prediction, no ranking of clubs, no Column** in a special edition.
- `League` stays plain JSON. `SAVE_VERSION` goes 95 → 96 once (Task 3), with a no-op upgrade step.
- Locally: `npm run format`, `npm run typecheck`, the tests touched. Never `npm run check`.
- Screen text follows `docs/UI.md` "Words on a screen". Names through `PlayerLink` and `TeamLink`.

## Review Focus

1. **A league's first offseason, or a first-year save**: no last season, so no awards, no stat lines and no head
   coach "before". Every edition builds or is skipped; none throws. (Tasks 1, 5, 7)
2. **A save from before this version**: releases and picks logged without `playerId`, and the three digests already
   on file mid-window. Candidates skip an entry with no player; the `year` edition does not file when one of its
   digests is on file for that season. (Tasks 1, 5)
3. **The reader's club did nothing that day** (no picks, no signings, no cuts), or the reader has no club: the Your
   club slot is dropped, never an empty table or a "0 picks" story. (Tasks 3, 6, 7)
4. **A quiet day** with no candidate above tier 4: the edition files with what it has when there is a lead, and
   files nothing when there is none. A page of one story is allowed; a blank one is not. (Task 3)
5. **A moment already passed** (a simmed offseason, a long advance): only the moment the league is at files; nothing
   is back-filed, and a story told in one edition is never told in a later one. (Tasks 3, 7)

---

### Task 1: The public record the editions read

**Files:**
- Create: `src/engine/publicStanding.ts`, `src/engine/publicStanding.test.ts`
- Modify: `src/engine/finance/cap.ts:241` (the release log), `src/engine/offseason/draft.ts:286` (the pick log),
  `src/engine/types.ts` (the comment on `Transaction.playerId`)

**Interfaces:**
- Produces:
  - `type Standing = 'star' | 'starter' | 'depth'`
  - `const STANDING = { topN: 5, snaps: 500, highRounds: 2, highYears: 3 }`
  - `standingReader(l: League, season = l.season - 1): (p: Player) => Standing` (builds the season's top-`topN`
    sets once; use it in loops)
  - `publicStanding(l: League, p: Player, season?: number): Standing`
  - `draftedHigh(l: League, p: Player): boolean` (rounds 1–`highRounds` of the last `highYears` drafts)
  - release and draft entries in `League.transactions` carry `playerId`

- [ ] **Step 1: Write the failing tests** in `publicStanding.test.ts`

```ts
it('reads a star from last season’s public record', () => {
  const l = createLeague({ seed: 'standing' });
  const last = l.season - 1;
  const [a, b, c] = activeRoster(l, 0);
  // An All-League place, a top-five place in a major stat, and neither.
  l.awards.push({ season: last, winners: {}, allLeague: [[{ playerId: a.id, teamId: 0 } as never], []] });
  b.stats[last] = { gp: 17, snaps: 900, recYds: 99999 };
  c.stats[last] = { gp: 12, snaps: 600 };
  const read = standingReader(l, last);
  expect(read(a)).toBe('star');
  expect(read(b)).toBe('star');
  expect(read(c)).toBe('starter');
  c.stats[last] = { gp: 12, snaps: STANDING.snaps - 1 };
  expect(standingReader(l, last)(c)).toBe('depth');
});
it('a league with no last season calls nobody a star and throws nothing', () => {
  const l = createLeague({ seed: 'standing-0' });
  l.awards = [];
  for (const p of Object.values(l.players)) p.stats = {};
  expect(Object.values(l.players).every((p) => publicStanding(l, p) === 'depth')).toBe(true);
});
it('knows a high pick of the last three drafts', () => {
  const l = createLeague({ seed: 'standing-d' });
  const p = activeRoster(l, 0)[0];
  p.draft = { season: l.season - 2, round: 2, pick: 40, teamId: 0 };
  expect(draftedHigh(l, p)).toBe(true);
  p.draft = { season: l.season - 4, round: 1, pick: 3, teamId: 0 };
  expect(draftedHigh(l, p)).toBe(false);
});
it('logs the player on a release and on a pick', () => {
  const l = createLeague({ seed: 'standing-t' });
  const p = activeRoster(l, 1)[0];
  releasePlayer(l, p); // finance/cap.ts
  expect(l.transactions.at(-1)).toMatchObject({ kind: 'release', playerId: p.id });
});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/publicStanding.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement `publicStanding.ts`.** A star: a season award winner or either All-League team for
  `season`, a top-`topN` place among all players in `passYds`, `rushYds`, `recYds`, `sacks` or `defInt` for
  `season`, or his club's passer (most `passAtt`) when the club's record that season was a winning one
  (`league.history` records). A starter: `stats[season].snaps >= STANDING.snaps` (scrimmage snaps tell a starter from a backup who dressed; last season's box scores may be pruned, the stat line is not). Read the stat line through
  `statLine` (`stats.ts`). Imports: `types`, `stats`, `awards` types only.
- [ ] **Step 4: Pass `player.id`** as `logTransaction`'s last argument at the release (`cap.ts:241`) and the pick
  (`draft.ts:286`), and widen the comment on `Transaction.playerId` to name them.
- [ ] **Step 5: Run** the test file, `npm run typecheck`, `npx vitest run src/engine/finance src/engine/offseason`.
  Expected: PASS.
- [ ] **Step 6: Commit** `News: public standing from last season's record, and the player on release and pick entries`.

### Task 2: The counting tool, then check-in 1

**Files:**
- Create: `scripts/dayCounts.ts`
- Modify: `scripts/editions.ts` (the `--offseasons n [seed]` option), `CLAUDE.md` (the `npm run editions` line)

**Interfaces:**
- Consumes: `standingReader`, `draftedHigh` (Task 1)
- Produces: `runDayCounts(seed: string, offseasons: number): void`, writing `.check/day-counts.md`

- [ ] **Step 1: Write `runDayCounts`.** It builds a league, plays seasons with `playWeek` and steps each offseason
  with `beginOffseason` and `advanceOffseason(l, { autoUser: true })` one step at a time. At each step it reads what
  the editions would read and counts, per offseason, at several settings of each bar:
  - `year`: head coaches and GMs replaced; tags; stars tagged, re-signed, released, reaching the market; clubs
    keeping or losing 3, 4 or 5 starters in the window.
  - `market`: stars changing clubs; signings at or over the 5th, 10th and 20th largest total; clubs signing or
    losing 2, 3 or 4 starters; reportable trades (`reportableTrades`).
  - `draft`: trades up into the top 5, 10 and 15; first-round quarterbacks; falls of 10, 15 and 20 places below the
    consensus in rounds 1–2; gaps of 10, 15 and 20 above it in round 1; clubs with three or more picks in the first
    two rounds, or none.
  - `cuts`: stars released; starters released at 300, 500 and 700 snaps last season; high picks released
    (`draftedHigh`); undrafted rookies on a 53; camp trades.
  - `kickoff`: new head coaches; clubs whose `Team.jobs.held` quarterback is not last season's passer; rookie
    quarterbacks holding the job.
  It also prints how many candidates each edition would have at the first-guess bars, and how often fewer than three.
- [ ] **Step 2: Wire `--offseasons`** in `scripts/editions.ts` beside `--seasons`.
- [ ] **Step 3: Run** `npm run editions -- --offseasons 6`. Expected: `.check/day-counts.md` with one table per
  edition, six rows each, no exception.
- [ ] **Step 4: Commit** `Scripts: count what each big-day edition would have to tell`.
- [ ] **Step 5: CHECK-IN 1 (hard stop).** Send the owner the tables as a rendered page and the first-guess bars
  with what each yields. Wait. Record the bars he sets in the ledger and use them in Task 3 onward.

### Task 3: The editor's core and Draft day

**Files:**
- Create: `src/engine/snnDays.ts`, `src/engine/snnDayVoice.ts`, `src/engine/snnDays.test.ts`
- Modify: `src/engine/types.ts` (`Edition`, `EditionKind`), `src/engine/inbox.ts` (`deliverMail`, `mailSubject`),
  `src/engine/generate.ts` (`SAVE_VERSION = 96`), `src/engine/migrate.ts` (a no-op v96 step),
  `src/engine/letterRules.ts` (`LETTER_FILES`), `src/engine/simReadsNoMail.test.ts`, `src/engine/migrate.test.ts`

**Interfaces:**
- Consumes: `standingReader` (Task 1); `rankCandidates`' ordering rule, `SNN`, `SUBJECT`, `short` (`snnWeek.ts`);
  `seasonSaid`, `toldKeys`, `stableHash` (`voice.ts`); `ruleBreaks` (`storyRules.ts`)
- Produces:
  - `type Day = 'year' | 'market' | 'draft' | 'cuts' | 'kickoff'`
  - `Edition.day?: Day`; `Edition.lists?: EditionList[]` with
    `interface EditionList { title: string; head: string[]; rows: { playerId?: number; teamId?: number; cells: string[] }[] }`
  - `EditionKind` gains `'day'`
  - `interface DayCandidate { key: string; day: Day; angle: string; tier: 1 | 2 | 3 | 4 | 5; clubId: number; teams: number[]; stakes: number; covers?: string[]; playerId?: number; coachId?: number; gmId?: number; otherId?: number; pick?: number; rank?: number; n?: number; got?: string[]; deal?: { years: number; total: number }; text?: string }`
  - `const DAY` (the bars, as the owner set them at check-in 1)
  - `const DAY_LABEL: Record<Day, string>` = `The new league year`, `Free agency`, `Draft day`, `Cut-down day`,
    `Kickoff`
  - `dayNow(l: League): Day[]` (the moments the league is at: `freeAgency` → `['year']`; `draft` → `['market']`;
    `preseason` → `['draft']`, or `['cuts']` once `l.personnel?.clock?.cutdown`; `regular` week 1 with no game
    played → `['kickoff']`, with `'cuts'` first when no `cuts` edition is on file for the season; else `[]`)
  - `dayId(l: League, day: Day): string`
  - `dayCandidates(l: League, day: Day, have: Set<string>): DayCandidate[]` (Task 3 fills `draft`; others return `[]`)
  - `rankDay(cs: DayCandidate[], editionId: string): DayCandidate[]`; `cutDay(ranked: DayCandidate[], userTeamId: number | null): { lead: DayCandidate; tiles: DayCandidate[] } | null`
  - `dayLists(l: League, days: Day[]): EditionList[]`
  - `buildDay(l: League, days: Day[]): Edition | null`; `dayMail(l: League): Draft[]`
  - in `snnDayVoice.ts`: `writeDayStory(l: League, c: DayCandidate, at: { editionId: string; said: string[] }): EditionStory`
    and `yourDayStory(l: League, day: Day, at: { editionId: string; said: string[] }): EditionStory | null`

- [ ] **Step 1: Write the failing tests** in `snnDays.test.ts`. The scene: `createLeague`, set `l.phase =
  'preseason'`, and give eight rookies `draft` records for `l.season` by hand (so no draft is played).

```ts
const pick = (p: Player, pick: number, rank: number, teamId: number, deal?: { from: number; got: string[] }) => {
  p.draft = { season: l.season, round: pick <= 32 ? 1 : 2, pick, teamId, rank, ...(deal ? { via: deal.from, deal } : {}) };
};
it('is at Draft day when camp opens, and files it once', () => {
  expect(dayNow(l)).toEqual(['draft']);
  const [m] = dayMail(l);
  expect(m.id).toBe(`snn:${l.season}:d:draft`);
  expect(m.edition!.day).toBe('draft');
  expect(m.edition!.scores).toEqual([]);
  expect(m.subject.startsWith('Draft day · ')).toBe(true);
  expect(m.subject.length).toBeLessThanOrEqual(60);
  l.inbox = [{ ...m, read: false } as InboxMessage];
  expect(dayMail(l)).toEqual([]);
});
it('leads with the first pick and tells a trade up, the wait and a pick ahead of the board', () => {
  const cs = dayCandidates(l, 'draft', new Set());
  expect(cs.find((c) => c.angle === 'first')).toMatchObject({ tier: 1, pick: 1 });
  expect(cs.find((c) => c.angle === 'up')).toMatchObject({ tier: 2, pick: 4, got: ['No. 9', '2028 round 1'] });
  expect(cs.find((c) => c.angle === 'wait')).toMatchObject({ tier: 3, pick: 40, rank: 12 });
  expect(cs.find((c) => c.angle === 'ahead')).toMatchObject({ tier: 3, pick: 20, rank: 55 });
  expect(buildDay(l, ['draft'])!.lead.cast[0]).toBe(first.id);
});
it('runs one story a club, three tiles at most, and never the reader’s club as a tile', () => {
  const e = buildDay(l, ['draft'])!;
  const clubs = [e.lead, ...e.tiles].map((s) => s.clubId);
  expect(new Set(clubs).size).toBe(clubs.length);
  expect(e.tiles.length).toBeLessThanOrEqual(3);
  expect(e.tiles.some((s) => s.clubId === l.userTeamId)).toBe(false);
});
it('gives the reader’s club its class, and no slot when it made no pick or he has no club', () => {
  expect(buildDay(l, ['draft'])!.club!.table!.head).toEqual(['Pick', 'Player', 'Consensus']);
  for (const p of mine) delete p.draft;
  expect(buildDay(l, ['draft'])!.club).toBeUndefined();
});
it('lists round one’s first ten', () => {
  const [list] = buildDay(l, ['draft'])!.lists!;
  expect(list.title).toBe('Round one');
  expect(list.rows.length).toBeLessThanOrEqual(10);
  expect(list.rows[0]).toMatchObject({ playerId: first.id, teamId: first.draft!.teamId });
});
it('keeps every story to the writing rules and stops on a fact', () => {
  const e = buildDay(l, ['draft'])!;
  for (const s of [e.lead, ...(e.club ? [e.club] : []), ...e.tiles]) expect(ruleBreaks(l, s), s.headline).toEqual([]);
});
it('files nothing when the day has no lead', () => {
  for (const p of Object.values(l.players)) if (p.draft?.season === l.season) delete p.draft;
  expect(dayMail(l)).toEqual([]);
});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/snnDays.test.ts`. Expected: FAIL (module not found).
- [ ] **Step 3: Add the types** (`Edition.day`, `Edition.lists`, `EditionList`, `'day'` in `EditionKind`), bump
  `SAVE_VERSION` to 96 with a no-op step in `migrate.ts`, and update `migrate.test.ts` to read `SAVE_VERSION`.
- [ ] **Step 4: Implement `snnDays.ts`.** `rankDay` orders as `rankCandidates` does (tier, stakes, a stable hash of
  the edition id and the key). `cutDay`: the lead is the top candidate not about the reader's club; tiles are the
  next three, one a club, an angle twice at most, never the reader's club. `stakes` for a pick is `1 / pick`; for a
  club it is last season's winning percentage. Draft day's candidates, from every player with
  `draft.season === l.season`: `first` (pick 1, tier 1); `up` (a `draft.deal` on a pick at or inside `DAY.upInside`,
  tier 2); `qb` (a quarterback in round 1, tier 2); `wait` (the largest `pick - rank` in rounds 1–2 when at or over
  `DAY.wait`, tier 3); `ahead` (the largest `rank - pick` in round 1 when at or over `DAY.ahead`, tier 3); `haul`
  and `none` (a club with `DAY.haulPicks` or more picks in rounds 1–2, or with no pick in them, tier 4).
  `buildDay` writes the lead, the reader's story and the tiles around `seasonSaid(l, SNN, 'snn:')`. `dayMail`
  mirrors `editionMail`: one `Draft` with `edition`, `covered` (each story's key and `covers`), the paragraphs as
  `body`, `phase: l.phase`, `week: 0`, no actions; nothing when `toldKeys(l)` has the id.
- [ ] **Step 5: Implement `snnDayVoice.ts`** for Draft day's angles and the reader's class. Each story: `kind:
  'day'`, a kicker (`Draft day`, `Trade up`, `The wait`, `Ahead of the board`, `Your club`), a headline of 70
  characters at most, a summary of one or two sentences, up to three number chips (`Pick`, `Consensus`), two
  paragraphs. The second paragraph ends on the club's next pick (`No. 33`) or, when it has none, its first game
  (`gamesInWeek`). Two wordings per sentence at least, chosen with `say` around `at.said`. Add the file to
  `LETTER_FILES`.
- [ ] **Step 6: Wire `inbox.ts`**: `...dayMail(league)` beside `...editionMail(league)` in `deliverMail`;
  `mailSubject` keeps returning `{ kind: 'edition', season, week: m.week }` for the new id. Add the three new
  modules to `simReadsNoMail.test.ts`'s list.
- [ ] **Step 7: Run** `npx vitest run src/engine/snnDays.test.ts src/engine/letterRules.test.ts
  src/engine/simReadsNoMail.test.ts src/engine/migrate.test.ts`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 8: Commit** `News: SNN's Draft day edition`.

### Task 4: The page, then check-in 2

**Files:**
- Modify: `src/ui/edition.tsx`, `src/styles.css`, `src/ui/edition.test.tsx`, `scripts/screens.ts`

**Interfaces:**
- Consumes: `Edition.day`, `Edition.lists`, `EditionList` (Task 3)
- Produces: `DayList({ league, list }: { league: League; list: EditionList })` in `edition.tsx`

- [ ] **Step 1: Write the failing test** in `edition.test.tsx`: render `EditionCards` for a Draft day edition built
  by `buildDay` and assert: no element with class `ed-strip`; one `table.ed-list` whose caption is `Round one`; each
  row's player is an `<a>` (through `PlayerLink`); the page has no `Race` heading; the text matches no
  `/\b(OVR|overall|potential)\b/i`.
- [ ] **Step 2: Run** `npx vitest run src/ui/edition.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.** `EditionCards` draws `ScoreStrip` only when `scores.length > 0`, and `DayList` for each
  of `edition.lists` where the race sits (two lists stack). `DayList` reuses the `.ed-evidence` table's look under a
  new class `.ed-list`; a row's first cell is a `PlayerLink` or `TeamLink` when the row names one.
- [ ] **Step 4: `scripts/screens.ts --edition`** picks up day editions (ids starting `snn:`), newest first, as it
  does weekly ones.
- [ ] **Step 5: Run** the test, `npm run typecheck`, `npx vitest run src/ui/ui.test.ts`, `npm run copy`. Expected:
  PASS, and no new line in `.check/copy.txt` that explains the panel.
- [ ] **Step 6: Commit** `News: the big-day edition's list box on the page`.
- [ ] **Step 7: CHECK-IN 2 (hard stop).** Play a league to camp, shoot the real Draft day edition closed and with
  the lead and one tile open (desktop and phone), and send them. Wait for the owner's notes on words and layout.

### Task 5: The new league year, with the three digests folded in

**Files:**
- Modify: `src/engine/snnDays.ts`, `src/engine/snnDayVoice.ts`, `src/engine/snnDays.test.ts`,
  `src/engine/inbox.ts` (`carouselMail`, `leadershipMail`, the `offMarketMail` call), `src/engine/offMarketMail.ts`

**Interfaces:**
- Consumes: `headCoachChanges` (`inbox.ts`, exported), `League.leadership` events, `reportableTrades`
  (`tradeNews.ts`), `standingReader`
- Produces: `dayCandidates(l, 'year', have)`; `dayLists` for `year` (`Changes at the top`, head `['Club', 'Out',
  'In']`); `dayOnFile(l: League, day: Day, have: Set<string>): boolean` (the edition is on file or would file now)

- [ ] **Step 1: Write the failing tests.** Scene: `l.phase = 'freeAgency'; l.faDay = 1`, with by hand: one club's
  head coach replaced (a `coachDismissed` and a `coachPermanent` event in phase `resign`), one GM replaced, a star
  tagged and a starter re-signed (transactions of kind `tag` and `resign` in phase `resign` with `playerId`), and a
  star free agent whose last club let him walk.

```ts
it('tells a change at the top with who left and who came in', () => {
  const c = dayCandidates(l, 'year', new Set()).find((x) => x.angle === 'coach')!;
  expect(c).toMatchObject({ tier: 1, clubId: club, coachId: hired.id });
  const s = writeDayStory(l, c, at());
  expect(s.paragraphs.join(' ')).toMatch(new RegExp(`${fired.lastName}.*${hired.lastName}`));
});
it('tells a star tagged at tier 1, a star kept at tier 2 and a star reaching the market at tier 2', () => { /* by angle: 'tag', 'kept', 'market' */ });
it('covers the three digests and they do not file beside it', () => {
  const [m] = dayMail(l);
  expect(m.covered).toEqual(expect.arrayContaining([`league:${l.season}:carousel`, `offMarket:${l.season}`]));
  deliverMail(l);
  const ids = l.inbox!.map((x) => x.id);
  expect(ids).toContain(`snn:${l.season}:d:year`);
  expect(ids.some((id) => id.startsWith('league:') && id.endsWith(':carousel'))).toBe(false);
  expect(ids.some((id) => id.startsWith('offMarket:') || id.startsWith('leadership-phase:'))).toBe(false);
});
it('does not file when one of its digests is already on file for the season (a save from before)', () => {
  l.inbox = [{ id: `offMarket:${l.season}`, season: l.season } as InboxMessage];
  expect(dayMail(l)).toEqual([]);
});
it('keeps the owner’s private letter about the reader’s own job', () => { /* a gmDismissed at the reader's club still files from 'The owner' */ });
it('carries an untold change into the next edition', () => { /* a coachPermanent dated phase 'draft' is a candidate of 'market' when no edition covered it */ });
it('builds in a league with no last season', () => { /* awards = [], stats = {}: dayMail(l) does not throw */ });
```

- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement the candidates.** `coach` and `gm` (tier 1, one per club with a replacement since the
  season's end; `covers` the leadership ids the digest would have used; `text` holds the event's public `report`);
  `tag` (a star, tier 1), `released` (a star released in the window, tier 1), `kept` (a star re-signed, tier 2),
  `market` (a star unsigned whose last club was his at season's end, tier 2), `window` (a club keeping or losing
  `DAY.windowStarters` or more starters, tier 3), a reportable trade of the window (tier 3), `pressure` and
  `interim` (tier 4, from `warning` and interim events). Leadership events not yet covered stay candidates for every
  later day's edition (tier 4 once a step old).
- [ ] **Step 4: Step the digests aside.** `carouselMail`, the SNN-desk branches of `leadershipMail` (offseason
  phases only; the owner's private letters and every in-season path are untouched) and `offMarketMail` return `[]`
  when `dayOnFile(league, 'year', have)`. The `year` edition's `covered` holds their ids.
- [ ] **Step 5: Word them** in `snnDayVoice.ts` (kickers `New in charge`, `Tagged`, `Staying`, `On the market`,
  `Released`), and the reader's window (`Your club`: counts of tagged, re-signed and reaching the market, and the
  biggest name by `standingReader`, then by contract total).
- [ ] **Step 6: Run** `npx vitest run src/engine/snnDays.test.ts src/engine/leadership.test.ts
  src/engine/inbox.test.ts src/engine/offMarketMail.test.ts`, `npm run typecheck`. Update any test that expected a
  digest in the offseason to expect the edition. Expected: PASS.
- [ ] **Step 7: Commit** `News: SNN's new-league-year edition takes in the three offseason digests`.

### Task 6: Free agency

**Files:**
- Modify: `src/engine/snnDays.ts`, `src/engine/snnDayVoice.ts`, `src/engine/snnDays.test.ts`

**Interfaces:**
- Consumes: transactions of kind `sign` and `trade` in phase `freeAgency` with `playerId`; `Player.contract`
  (`length`, `apy`); `Player.left`; `standingReader`; `reportableTrades`
- Produces: `dayCandidates(l, 'market', have)`; `dayLists` for `market` (`The biggest contracts`, head `['Player',
  'From', 'To', 'Deal']`, ten rows by contract total)

- [ ] **Step 1: Write the failing tests.** Scene: `l.phase = 'draft'`, with `sign` entries in phase `freeAgency`.

```ts
it('leads with a star who changed clubs, and tells the richest deal when it is another player’s', () => {
  const cs = dayCandidates(l, 'market', new Set());
  expect(cs.find((c) => c.angle === 'moved')).toMatchObject({ tier: 1, playerId: star.id, otherId: oldClub });
  expect(cs.find((c) => c.angle === 'richest')).toMatchObject({ tier: 2, deal: { years: 4, total: 96000 } });
});
it('says a deal in years and total dollars, two numbers a sentence at most', () => {
  const s = writeDayStory(l, cs.find((c) => c.angle === 'richest')!, at());
  expect(s.paragraphs.join(' ')).toMatch(/four years and \$96 million/);
  expect(ruleBreaks(l, s)).toEqual([]);
});
it('lists the ten biggest contracts, largest first', () => { /* rows sorted by total; a row names old and new club */ });
it('tells the reader’s club its signings and who left, and drops the slot when neither happened', () => {});
it('does not retell a star the new-league-year edition already told', () => { /* have holds its key: no candidate */ });
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** `moved` (a star signed by a club other than his last, tier 1); `richest` (the largest
  total when not the `moved` story, tier 2); a reportable trade (tier 2); `haul` and `lost` (a club signing or
  losing `DAY.marketStarters` or more starters, tier 3); `unsigned` (the best free agent left by `standingReader`
  then last contract, tier 4); `home` (a signing by a club in his `left`, tier 4). A player's key is
  `player:{id}:{season}` across the year's editions, so one move is told once.
- [ ] **Step 4: Word them** (kickers `Free agency`, `The richest deal`, `Trade`, `Still unsigned`, `Your club`).
- [ ] **Step 5: Run** the test file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 6: Commit** `News: SNN's free agency edition`.

### Task 7: Cut-down day and Kickoff, the played offseason, then check-in 3

**Files:**
- Create: `src/engine/snnDays.season.test.ts`
- Modify: `src/engine/snnDays.ts`, `src/engine/snnDayVoice.ts`, `src/engine/snnDays.test.ts`,
  `scripts/editions.ts` (the season preview writes the five editions too)

**Interfaces:**
- Consumes: `release` and `trade` entries in phase `preseason`; `Team.jobs.held`; `headCoachChanges`;
  `gameOfWeek`; `League.history` (the champion); `gamesInWeek`
- Produces: `dayCandidates` for `cuts` and `kickoff`; `dayLists` for `cuts` (`Notable cuts`, head `['Player',
  'Club', 'Games last season']`, the games from `stats[season].gp`) and `kickoff` (`Opening week`, head `['Game', 'Kickoff']`); `Edition.next` on
  Kickoff

- [ ] **Step 1: Write the failing unit tests.**

```ts
it('is at Cut-down day once the cuts are in, with practice squads on', () => {
  l.phase = 'preseason';
  l.personnel = { ...l.personnel!, enabled: true, clock: { season: l.season, cutdown: true } };
  expect(dayNow(l)).toEqual(['cuts']);
});
it('files one mail for Cut-down day and Kickoff when they land together', () => {
  l.phase = 'regular'; l.week = 1; // no cuts edition on file, no game played
  expect(dayNow(l)).toEqual(['cuts', 'kickoff']);
  const [m] = dayMail(l);
  expect(m.id).toBe(`snn:${l.season}:d:kickoff`);
  expect(m.edition!.label).toBe('Kickoff');
  expect(m.edition!.lists!.map((x) => x.title)).toEqual(['Opening week', 'Notable cuts']);
  expect(m.covered).toContain(`snn:${l.season}:d:cuts`);
});
it('files Kickoff alone after Cut-down day had its own edition', () => {});
it('files nothing once a week 1 game is played', () => {});
it('tells a star released at tier 1, a starter at tier 2 and a high pick at tier 3, each with a player', () => {});
it('skips a release logged without a player (an old save)', () => {});
it('tells the champion’s opener, a new head coach’s first game and a new starting quarterback', () => {});
it('makes no prediction: no story says will, should, favorite or expect', () => {
  for (const s of stories(buildDay(l, ['kickoff'])!)) expect(s.paragraphs.join(' ')).not.toMatch(/\b(will|should|favou?rites?|expect(ed|s)?)\b/i);
});
it('a simmed offseason files Kickoff alone, and it names the new head coaches', () => {
  simOffseason(l); deliverMail(l);
  const snn = l.inbox!.filter((m) => m.id.startsWith(`snn:${l.season}:d:`));
  expect(snn.map((m) => m.id)).toEqual([`snn:${l.season}:d:kickoff`]);
});
```

- [ ] **Step 2: Write `snnDays.season.test.ts`.** Two leagues from one seed, played through a season with
  `playWeek`, then stepped from the title game to week 1 as the app does (`beginOffseason`, `advanceOffseason(l, {
  autoUser: true })` one step at a time); `deliverMail` after every step in one league and never in the other.

```ts
it('files the five editions once each, in order, one SNN mail a step', () => {
  expect(days()).toEqual(['year', 'market', 'draft', 'cuts', 'kickoff'].filter((d) => seen.has(d)));
  expect(Math.max(...snnPerStep)).toBeLessThanOrEqual(1);
});
it('keeps every story to the writing rules, and says no sentence twice', () => {
  expect(editions().flatMap((m) => stories(m.edition!).flatMap((s) => ruleBreaks(l, s)))).toEqual([]);
  expect(dupes(editions().flatMap((m) => stories(m.edition!).flatMap((s) => s.paragraphs.flatMap(sentencesOf))))).toEqual([]);
});
it('tells nothing twice across the offseason', () => { /* no story key in two editions' covered */ });
it('files none of the three digests beside an edition', () => {});
it('moves nothing: the offseason plays the same with the mail filed or never filed', () => {
  expect(rosters(l)).toEqual(rosters(quiet));
});
```

- [ ] **Step 3: Run** both test files. Expected: FAIL.
- [ ] **Step 4: Implement `cuts`**: `released` by standing (a star tier 1, a starter tier 2,
  `draftedHigh` tier 3), a reportable camp trade (tier 2), `holdout` (a public dispute still open,
  `DISPUTE_PUBLIC`, tier 2), `undrafted` (a rookie with no `draft` on a 53, tier 4, one a page), `moved` (a starter
  whose position changed in camp, a `position` transaction, tier 4).
- [ ] **Step 5: Implement `kickoff`**: `champion` (last season's champion's week 1 game, tier 2), `rookieQb` (a
  rookie quarterback in `jobs.held`, tier 2), `newCoach` (each `headCoachChanges` club's week 1 game, tier 3),
  `newQb` (a club whose `jobs.held` quarterback is not last season's passer, tier 3), `changed` (the club with the
  most new names in `jobs.held` against last season's starters, tier 4), `mentor` (the existing week 1 mentor
  meeting, tier 4). `Edition.next` from `gameOfWeek`. A change of coach already told this year is told here only as
  his first game. Merged with `cuts`, both sets rank together and the page carries both lists.
- [ ] **Step 6: Word them** (kickers `Cut-down day`, `Released`, `Made the 53`, `Kickoff`, `New in charge`, `A new
  quarterback`, `Your club`). Kickoff's second paragraphs end on the game: the opponent and the kickoff window.
- [ ] **Step 7: The preview.** `npm run editions` writes the five editions before the season's weekly ones in
  `.check/editions.md`, with their rule breaks counted at the top.
- [ ] **Step 8: Run** `npx vitest run src/engine/snnDays.test.ts src/engine/snnDays.season.test.ts
  src/engine/snnWeek.season.test.ts`, `npm run typecheck`, `npm run editions`. Expected: PASS, 0 rule breaks.
- [ ] **Step 9: Commit** `News: SNN's cut-down day and kickoff editions, and a played offseason held to the rules`.
- [ ] **Step 10: CHECK-IN 3 (hard stop).** From one played offseason, shoot all five editions closed (desktop and
  phone) and send them with the count of stories each ran. Wait for the owner's notes.

### Task 8: The record

**Files:**
- Modify: `docs/NEWS.md`, `CLAUDE.md`, `docs/MVP.md`, `package.json`, `src/ui/changelog.ts`

- [ ] **Step 1: `docs/NEWS.md`**: a "SNN on the big days" section (the five editions and when each files, the list
  box, public standing, the bars and where they live, what stopped filing and what still files alone, the simmed
  offseason), and the "What still files alone" paragraph of the weekly edition brought up to date.
- [ ] **Step 2: `CLAUDE.md`**: `snnDays.ts`, `snnDayVoice.ts` and `publicStanding.ts` in the `snnWeek.ts` entry;
  `--offseasons` on the `npm run editions` line; `playerId` on release and pick entries in the `inbox.ts` entry's
  neighbours where the transaction log is described.
- [ ] **Step 3: `docs/MVP.md`**: the news item says the big days are in and that chains are what is left.
- [ ] **Step 4: Version**: the next patch (`0.4.39`) and a `changelog.ts` entry in a player's words, title 40
  characters at most.
- [ ] **Step 5: Run** `npm run format`, `npm run typecheck`, `npx vitest run src/ui/changelog.test.ts`.
- [ ] **Step 6: Commit** `News: the big-day editions in the docs, version bump`. Push. Ask for sign-off on this
  spec. No review and no pull request here.

## Left out on purpose

- **An end-of-season edition, a Column in a special edition, a page per draft round or free agency day, and
  predictions** (the spec's "Not in this pass").
- **A second reader of the old digests' private ranking.** "Off the market" ordered players by your scouts' read;
  nothing replaces that order in SNN. The director's free agency letters keep your scouts' view.
