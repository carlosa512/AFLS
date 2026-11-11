# SNN's Column and Your Club's Storylines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add one labelled opinion Column to SNN's weekly edition, make your club's public storylines stories in it, and
let coverage reach you through the head coach's letter (a note normally, a conversation only in the extreme case).

**Architecture:** One pure engine module reads form from box scores (`slump.ts`); the Column's ladder (`snnColumn.ts`)
and a new talk cause (`form` in `playerTalks.ts`) both read it, so they fire together without either reading the
other. The Column and the storylines are two more candidate kinds in the edition's editor (`snnWeek.ts`), worded in
`snnVoice.ts` and checked by `storyRules.ts`. What was claimed is remembered as keys in the edition's `covered`.

**Tech Stack:** TypeScript, React, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-11-snn-column-and-storylines-design.md`. Spec 1, which this builds on:
`docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md`.

**Execution:** Native (the owner's choice for spec 1, kept). One review of the whole branch comes at the very end,
before the pull request: none after this plan.

## Global Constraints

- Branch `claude/loving-cerf-wkwav9`. Commit "Area: what changed", push after each task. No pull request.
- **Check-ins are hard stops.** At each: send renders (the owner reads pictures, not lists) and the counts, then wait.
- **Every bar is a named constant** (`FORM` in `slump.ts`, `LADDER` in `snnColumn.ts`) and starts as a first guess.
  The owner sets them at check-in 1 from the counting tool's figures. Never tune one to make a test pass.
- **Public facts only** in anything SNN prints: records, this season's box scores, transactions, the draft, public
  story beats. No rating, mood, hidden trait or scout's read. The blame rungs may not exceed what an owner could do
  (`leadershipWeek`: after Week 11, .300 or worse through six games; never a first-year man above rung 1).
- **The sim never reads mail.** `slump.ts` and `playerTalks.ts` import nothing mail-side
  (`simReadsNoMail.test.ts`). Mail may read mail.
- **Writing rules** of spec 1 hold for every Column and brief, plus the Column's three: at most one sentence under
  eight words a paragraph, at most one number a sentence, two or three sentences in the second paragraph.
- No `Math.random`, no draws from any stream. Ties break on `stableHash`.
- `League` stays plain JSON. `SAVE_VERSION` goes to 95 once (Task 8), with an upgrade step.
- Locally: `npm run format`, `npm run typecheck`, the tests touched. Never `npm run check`. `npm run morale` once, in
  Task 8.
- Screen text follows `docs/UI.md` "Words on a screen". Names through `PlayerLink` and `TeamLink`.

## Review Focus

1. **Weeks 1 to 4, and a bye inside the span.** No club has four games: no unit claim, no slump, no crash. A span is
   a club's last four games played, whatever weeks they fell in. (Task 1)
2. **A man who has gone.** A head coach dismissed, a GM replaced or a player traded after a claim or an ask: no
   Column names a man no longer in the job, an interim is never above rung 1, an open `form` ask is dropped with the
   others when he changes club. (Tasks 2 and 8)
3. **A save from before this, mid-season.** No Column keys exist: rung 3 cannot appear without an earlier rung 2,
   nothing is corrected that was never claimed, old editions still open. (Tasks 2 and 5)
4. **A GM between jobs.** He still gets Columns about the league. No Column counts as "about your club", and there
   are no storyline tiles, notes or conversations. (Tasks 5, 6, 7)
5. **A long advance.** One edition files, with at most one Column. A correction that came due in a skipped week is
   still told in a later edition while its facts hold. (Task 5)

---

### Task 1: Form from the box scores

**Files:**
- Create: `src/engine/slump.ts`, `src/engine/slump.test.ts`

**Interfaces:**
- Produces:
  - `type Unit = 'offensive line' | 'pass rush' | 'run game' | 'run defense' | 'passing game' | 'coverage'`
    and `UNITS: readonly Unit[]`, the names the Key matchups card uses.
  - `FORM = { games: 4, quarter: 8, results: 3 }` (span length, places in a quarter of 32 clubs, results that must
    agree).
  - `unitForm(l: League, teamId: number, unit: Unit, through: number): UnitForm | null` where
    `UnitForm = { value: number; rank: number; games: number; from: number; to: number; won: number; lost: number;
    before: { value: number; games: number; won: number; lost: number } | null; league: number }`. `through` is the
    last week counted. `rank` 1 is best among all 32 clubs' own last-four spans. `before` is the same measure over
    the club's earlier games this season (null under three). `league` is the league's value over the same weeks.
    Null unless every club has `FORM.games` played games.
  - `unitOf(position: Position): Unit`.
  - `manForm(l: League, playerId: number, through: number): { unit: Unit; form: UnitForm; started: number } | null`:
    his unit's form over the last four games his club played, and how many of them he started
    (`Team.kickoff`-era box scores: a man with `snaps` in the game at his position's starting share).
  - `inSlump(l, playerId, through): boolean`: `started === FORM.games` and `form.rank > 32 - FORM.quarter`.
- Consumes: the measures in `opposition.ts` (`evidence`): sack rate allowed and made, yards a carry gained and
  allowed, yards an attempt gained and allowed. Move the per-game sums `totals` reads into a shared
  `gameUnitSums(result, home)` in `slump.ts` and have `opposition.ts` call it, so both read one definition.

- [ ] **Step 1: Write the failing tests** in `slump.test.ts`, on a league played nine weeks (`beforeAll`, seed
  `'slump'`):
  - `unitForm` is null at `through: 3` and non-null at `through: 9` for every club and unit.
  - For each unit, the 32 ranks at week 9 are a permutation of 1..32 (ties broken by team id).
  - A club with a bye in weeks 6 to 9 still has `games === 4` and `from < 6`.
  - `won + lost <= 4`, and `before.games + games` equals the club's games played.
  - Hand-built: a result with 6 sacks allowed on 30 dropbacks gives the offensive line `value` 0.2 for a one-game
    span (`FORM.games` set to 1 inside the test and restored).
  - `opposition.test.ts` still passes unchanged (the refactor moved no number).
  - `inSlump` is false for a man who started three of the four.
- [ ] **Step 2: Run** `npx vitest run src/engine/slump.test.ts`. Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `slump.ts` to the interfaces above. Lower is better for the offensive line, the run
  defense and the coverage; higher for the other three.
- [ ] **Step 4: Run** `npx vitest run src/engine/slump.test.ts src/engine/opposition.test.ts src/engine/simReadsNoMail.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** `News: a unit's form over its last four games, from the box scores`.

### Task 2: The ladder

**Files:**
- Create: `src/engine/snnColumn.ts`, `src/engine/snnColumn.test.ts`

**Interfaces:**
- Consumes: `unitForm`, `UNITS`, `FORM` (Task 1); `recordsBefore`, `recordPct` (`snnStory.ts`); `coachRecord`,
  `gmRecord` (`records.ts`); `teamCoaches` (`coaching.ts`); `league.history`.
- Produces:
  - `LADDER = { coachPct: 0.3, coachGames: 6, timeAfterWeek: 11, gmFair: 2, gmTime: 3, turnWins: 6, turnPct: 0.75,
    turnGames: 8, yoursASeason: 3, fixWins: 4 }`.
  - `type Subject = { kind: 'unit'; teamId: number; unit: Unit } | { kind: 'coach'; teamId: number; coachId: number }
    | { kind: 'gm'; teamId: number; gmId: number }`.
  - `interface Claim { key: string; subject: Subject; rung: 1 | 2 | 3; dir: 'blame' | 'credit' | 'fix';
    teamId: number; margin: number; numbers: { value: string; label: string }[];
    table: { head: string[]; rows: string[][] }; facts: Record<string, string | number>; of?: string }`.
    `key` is `column:{season}:{subjectKey}:{rung}{+|-}` and a fix's is `column:{season}:{subjectKey}:fix`, where
    `subjectKey` is `unit:{teamId}:{unit}`, `coach:{coachId}` or `gm:{gmId}`. `of` is the key a fix corrects.
  - `columnClaims(l: League, week: number, have: Set<string>): Claim[]`: every claim that holds after `week` and has
    not been made.
  - `pickColumn(claims: Claim[], opt: { taken: Set<number>; userTeamId: number | null; yoursTold: number;
    yoursLastWeek: boolean; editionId: string }): Claim | null`.
- What holds (each bar from `LADDER` and `FORM`):
  - **Unit, rung 1.** Blame: `rank > 24` and `lost >= 3`. Credit: `rank <= 8` and `won >= 3`. Table: "Weeks
    {a}–{b}" against "Since" when `before` is non-null, else the club against "League".
  - **Coach, rung 2 blame.** Head coach not interim, not in his first season in the job at this club, club at
    `coachPct` or worse through `coachGames` or more. **Credit:** last season `turnWins` wins or fewer and this
    season at `turnPct` or better through `turnGames` or more.
  - **Coach, rung 3 blame.** Rung 2's facts, `week > timeAfterWeek`, the club lost its last game, and `have` holds
    his rung-2 blame key from this season or last.
  - **GM, rung 2 blame.** His last `gmFair` completed seasons at this club were losing ones and this season is at
    `coachPct` or worse through `coachGames`. **Rung 3:** `gmTime` losing seasons, `week > timeAfterWeek`, and his
    rung-2 key in `have`. **Credit, rung 2:** the coach's turnaround, when the GM was appointed before last season
    ended. A GM in his first two seasons is never above rung 1 (and this build has no rung-1 claim about a GM: the
    "one move" claim is left for a later pass, see the note at the end).
  - **Fix.** For each rung key in `have` from this season with no fix yet: a unit blame whose unit is now `rank <=
    16` with `won >= 3`; a unit credit whose unit is now `rank > 24`; a coach or GM blame whose club has won
    `fixWins` straight; a coach credit whose club has lost `fixWins` straight.
- `pickColumn` order: a fix first, then rung (3, 2, 1), then `margin` (how far past the bar, as a share of it), then
  the club's record, then `stableHash(editionId + key)`. Skip a claim whose club is in `taken`. Skip a claim about
  the user's club when `yoursTold >= LADDER.yoursASeason` or `yoursLastWeek`.

- [ ] **Step 1: Write the failing tests** in `snnColumn.test.ts`. Hand-built leagues (records and box scores set
  directly on a `createLeague` league, as `leadership.test.ts` does):
  - a club 1–6 after week 8 under a second-year head coach gives one `coach` rung-2 blame claim; the same club under
    a first-year coach gives none; under an interim, none.
  - with that claim's key in `have`, week 12 and a loss in week 12 give a rung-3 claim; without the key, none.
  - week 10 with the key gives no rung 3 (`timeAfterWeek`).
  - no claim's key is in the `have` it was given.
  - a unit blame key in `have`, then four games with the unit at rank 5 and three wins, gives a `fix` whose `of` is
    that key; a second call with the fix key in `have` gives none.
  - a coach dismissed after his rung-2 claim: no rung 3 and no fix is written about him, and his interim successor
    gets no claim above rung 1.
  - `pickColumn` returns the rung 3 over a rung 1, a fix over both, null when every club is `taken`, and never the
    user's club when `yoursTold` is 3 or `yoursLastWeek` is true.
  - every claim's `table.rows.length` is 2 to 4 and each row has `head.length` cells.
  - a league whose `userTeamId` club has no GM job (`employed` false): claims are still returned for other clubs.
- [ ] **Step 2: Run** `npx vitest run src/engine/snnColumn.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement** `columnClaims` and `pickColumn`.
- [ ] **Step 4: Run** the same file. Expected: PASS.
- [ ] **Step 5: Commit** `News: the Column's ladder, as claims that hold`.

### Task 3: The counting tool

**Files:**
- Modify: `scripts/editions.ts`, `CLAUDE.md` (the `npm run editions` line)

**Interfaces:**
- Consumes: `columnClaims`, `pickColumn` (Task 2); `inSlump` (Task 1); `tierOf`, `weightOf` (`standing.ts`).
- Produces: `npm run editions -- --seasons n [seed]` plays `n` seasons (regular season and playoffs, then
  `beginOffseason` and `advanceOffseason` to the next kickoff, as `scripts/offseason.ts` does) and writes
  `## Counts` at the top of `.check/editions.md`: one row a season and a mean, for
  - Columns that would run (the pick each week, its key remembered), by rung and direction, and about your club;
  - fixes;
  - your club's public beats (`pub` beats in `league.stories`), by kind;
  - your men who mattered and were in a slump in any week (the conversation's first two bars);
  - once Task 8 lands, the `form` asks filed, for your club and the league.
  Without `--seasons` the tool behaves as before.

- [ ] **Step 1: Add the mode.** Count from `columnClaims` and `pickColumn` directly until Task 5 puts the Column in
  the edition, then from the editions themselves.
- [ ] **Step 2: Run** `npm run editions -- --seasons 5 counts`. Expected: it finishes and prints the counts table.
- [ ] **Step 3: Commit** `News: npm run editions counts a Column's season`.

**CHECK-IN 1.** Send the counts table as a picture or a short table (five seasons): Columns a season by rung, about
your club, fixes, public beats, slumping men who matter. Give the spec's targets beside them (8 to 10 Columns, at
most 3 about your club, about one conversation). Propose the bar changes that would meet them. Wait for the owner's
bars, set them in `FORM` and `LADDER`, and re-run.

### Task 4: The Column's words and its rules

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/snnVoice.ts`, `src/engine/storyRules.ts`
- Test: `src/engine/storyRules.test.ts`, `src/engine/snnColumn.test.ts`

**Interfaces:**
- Consumes: `Claim` (Task 2); `compose`, `pickLine`, `standingLine`, `nextLine`, `C`, `M` (`snnVoice.ts`).
- Produces:
  - `EditionKind` gains `'column'` and `'storyline'`. `EditionStory` gains
    `table?: { head: string[]; rows: string[][] }`.
  - `columnStory(l: League, claim: Claim, at: Wording): EditionStory` exported from `snnVoice.ts`: `kind: 'column'`,
    `kicker: 'Column'`, `angle` the claim's `rung` and `dir` (`'1-'`, `'2+'`, `'fix'`…), `numbers` and `table` from
    the claim, two paragraphs, no quote, `covers: [claim.key]`.
  - `ruleBreaks` for a `column`: "a Column carries an evidence table of two to four rows", "more than one sentence
    under eight words in a paragraph", "more than one number in a sentence", "the argument has two or three
    sentences".
- Line banks: one a rung and direction (seven: `1-`, `1+`, `2-` coach, `2-` GM, `2+`, `3-`, `fix`), at least four
  first-paragraph forms and four argument forms each, every argument sentence joining a cause to its effect with
  "until", "since", "when", "because" or "and". The spec's rewritten Las Vegas text is the reference for `1-`. A
  rung-3 Column says what the owner could do and stops on the record: it never says he will.

- [ ] **Step 1: Write the failing tests.** In `storyRules.test.ts`: a `column` story with no table breaks a rule;
  with the mock-up's four short sentences it breaks "more than one sentence under eight words"; the spec's rewritten
  text with a three-row table breaks none. In `snnColumn.test.ts`: for every claim of a nine-week league and every
  hand-built claim of Task 2, `ruleBreaks(l, columnStory(l, claim, at))` is empty, the headline is at most the
  headline limit, and no paragraph names a rating or a mood (the fog-of-war word list the edition tests use).
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement** the types, the rules and `columnStory`.
- [ ] **Step 4: Run** both files and `npx vitest run src/engine/snnVoice.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `News: the Column's words, held to its own rules`.

### Task 5: The Column in the edition and on the page

**Files:**
- Modify: `src/engine/snnWeek.ts`, `src/ui/edition.tsx`, `src/styles.css`
- Test: `src/engine/snnWeek.test.ts`, `src/engine/snnWeek.season.test.ts`, `src/ui/edition.test.tsx`

**Interfaces:**
- Consumes: `columnClaims`, `pickColumn`, `columnStory`.
- Produces: `Edition.tiles` may hold one story of `kind: 'column'`. `buildEdition` picks it after the cut: `taken`
  is the clubs of the lead and the tiles kept, `yoursTold` and `yoursLastWeek` come from `toldKeys` and last week's
  edition. It replaces the lowest-ranked tile that is not the reader's own-club news, or is appended when there are
  fewer than three tiles. `editionMail` adds the claim key to `covered`. `ui/edition.tsx` draws the COLUMN kicker
  (the story's own kicker) and, in an open story, `story.table` under the band as a table of class `ed-evidence`
  (second value column bold).

- [ ] **Step 1: Write the failing tests.**
  - `snnWeek.test.ts`: a week with a rung-2 claim builds an edition with exactly one `column` tile and three tiles
    in all; its club appears in no other story of the page; with no claim there is none.
  - `snnWeek.season.test.ts`: over the season, at most one Column an edition; no Column key twice; at most
    `LADDER.yoursASeason` about the user's club and never in consecutive editions; every Column passes `ruleBreaks`;
    the existing "one story a club", "no sentence twice" and "plays the same with mail filed or not" still hold.
  - `snnFiling.test.ts`: after four weeks played with no delivery, one edition files with at most one Column.
  - `edition.test.tsx`: a `column` story with a table renders `class="ed-evidence"` when open and the kicker
    "Column" when closed; a story without one renders no such table.
- [ ] **Step 2: Run** the four files. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the four files, `npx vitest run src/ui/ui.test.ts`, then `npm run copy` and read the lines
  touched in `.check/copy.txt`. Expected: PASS, and no explanatory text added.
- [ ] **Step 5: Commit** `News: the Column takes a tile, with its evidence in a table`.

**CHECK-IN 2.** `npm run editions -- --seasons 1` for the words, and renders of three real Columns from a played
save (closed tile, opened, phone, dark): a unit blame, a credit and the highest rung the season produced. Send the
pictures and the season's Column headlines as a short list. Ask whether they read as one thought and whether the
table is clear. Wait.

### Task 6: Your club's storylines

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/stories.ts`, `src/engine/benching.ts`, `src/engine/disputes.ts`,
  `src/engine/relieve.ts`, `src/engine/snnWeek.ts`, `src/engine/snnVoice.ts`
- Test: `src/engine/stories.test.ts`, `src/engine/snnWeek.test.ts`, `src/engine/snnNews.test.ts`

**Interfaces:**
- Produces:
  - `OutletId` gains `'snn'`. `SNN_OUTLET: Outlet = { id: 'snn', sees: (league, s, b) => s.teamId ===
    league.userTeamId && !!b.pub }` in `stories.ts`.
  - Public beats (`pub: true`), added where the beats are written today and nowhere else: `sat` and `leaked` (already
    public), `backIn` and `settled` (the lineup is public), `disputeEnd` and `left` only on a story that already
    holds a public beat, and your coordinator's `relieved`.
  - `storylineCandidates(l: League, week: number): Candidate[]` in `snnWeek.ts`: one candidate for each of your
    club's stories with beats the `SNN_OUTLET` has not told, `kind: 'storyline'`, `clubId` the user's club, key
    `storyline:{storyId}:{beats told + 1}`, tier 2 when the man is a quarterback losing his job, else 4. It rides in
    the own-club tile and is written as a brief.
  - `storylineStory(l, cand, at): EditionStory` in `snnVoice.ts`: one paragraph, public facts (his starts and
    season line, who starts in his place, the request "according to reports"), ending on a fact.
  - `editionMail` calls `markTold(story, SNN_OUTLET)` for each storyline it printed.

- [ ] **Step 1: Write the failing tests.**
  - `stories.test.ts`: `untold(l, s, SNN_OUTLET)` returns only public beats; a story of talks alone returns none;
    `markTold(s, SNN_OUTLET)` leaves `untold(l, s, COACH)` unchanged.
  - `snnWeek.test.ts`: a `sat` beat for your quarterback gives one tier-2 storyline candidate; after the edition is
    filed there is none; a later `backIn` gives one more; a private `asked` beat gives none; a user between jobs
    gets none.
  - `snnNews.test.ts`: each storyline brief passes `ruleBreaks` and contains none of the fog-of-war words.
  - The benching, disputes and relieve test files still pass (a flag on a beat moves nothing).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run src/engine/stories.test.ts src/engine/snnWeek.test.ts src/engine/snnNews.test.ts
  src/engine/benching.test.ts src/engine/disputes.test.ts src/engine/relieve.test.ts src/engine/coachWeek.season.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** `News: your club's public storylines are stories in the edition`.

**CHECK-IN 3.** Renders from saves built for each kind (a starter benched, a request leaked, a coordinator relieved,
and one closing). Send the pictures. Wait.

### Task 7: The coverage note

**Files:**
- Modify: `src/engine/coachWeek.ts`, `src/engine/coachWeekVoice.ts`
- Test: `src/engine/coachWeek.test.ts`, `src/engine/coachWeek.season.test.ts`

**Interfaces:**
- Consumes: `toldKeys` (the Column and story keys the last two editions covered), `unitOf` (Task 1), `manSheet`
  (`castSheet.ts`).
- Produces: one tier-5 `WeekItem` (`section: 'rooms'`, key `coverage:{season}:{playerId}`) when one of the last two
  editions printed a blame Column or story about your club's unit or one of your men: it names the most senior man
  of that unit (`weightOf`), in two sentences, the second from his character in words. At most one a letter, one a
  man a season (the key). It never files a letter alone (tier 5 already cannot).

- [ ] **Step 1: Write the failing tests.** `coachWeek.test.ts`: with a `column:…:unit:{yours}:pass rush:1-` key
  covered by last week's edition, `weekItems` holds one `coverage:` item naming a pass rusher; with the key three
  editions old, none; with the same man's key already told this season, none; two blamed units give one item.
  `coachWeek.season.test.ts`: at most one coverage note a letter and no letter made of one alone.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3: Implement**, with four line pairs in `coachWeekVoice.ts` chosen through `say`.
- [ ] **Step 4: Run** both. Expected: PASS.
- [ ] **Step 5: Commit** `Mail: the head coach notes when the coverage has been on a man`.

### Task 8: The conversation

**Files:**
- Modify: `src/engine/types.ts`, `src/engine/playerTalks.ts`, `src/engine/disputes.ts`, `src/engine/coachWeek.ts`,
  `src/engine/coachWeekVoice.ts`, `src/engine/playerVoice.ts`, `src/ui/mail.tsx` (the talk row's buttons),
  `src/engine/generate.ts`, `src/engine/migrate.ts`
- Test: `src/engine/playerTalks.test.ts`, `src/engine/coachWeek.test.ts`, `src/engine/migrate.test.ts`,
  `src/ui/mail.test.tsx`

**Interfaces:**
- Consumes: `inSlump` (Task 1); `tierOf`, `weightOf` (`standing.ts`); `Team.jobs.held`; `poiseOf`.
- Produces:
  - `TalkCause` gains `'form'`. `Talk` gains `form?: number` (the season of his last form talk).
  - `formCase(league: League, p: Player, ctx: MoraleContext): boolean` exported from `playerTalks.ts`: he holds a
    starting job and is a quarterback or `tierOf(...) === 'leader'`, `inSlump(league, p.id, lastPlayedWeek)`, and
    `p.morale.talk.form !== league.season`.
  - In `talkStep`, for a man already past the asking gates: when `talkCause` returns null or `'losing'` and
    `formCase` holds, his cause is `'form'`. It never counts against `losingReachesYou` and is never promised
    (`canPromise` false).
  - `applyReply` for `'form'`: `reassure` as today; `firm` gives `clamp(((poiseOf(p) - TRAIT_MEAN) / 3.5) * 0.5, -1,
    0.5)` as a `firm` jolt; neither `firm` nor `ignored` sets `sour` (a form talk never becomes a dispute). It sets
    `t.form = league.season`.
  - The letter row (`coachWeek.ts`, tier 1 like the other asks) with three buttons: "He's my quarterback" or "He's
    my man" (`reassure`), "Play your way out of it" (`firm`), and no third button: saying nothing is not answering.
    The row's words mention the coverage only when `toldKeys` holds a blame key about him or his unit.
  - `SAVE_VERSION = 95`; the upgrade step changes nothing.

- [ ] **Step 1: Write the failing tests.**
  - `playerTalks.test.ts`: a job-holding quarterback, down three steps, his unit in a slump, files a `form` ask at
    your club; the same man not down files none; a backup files none; a second `form` ask the same season never
    comes; `answerTalk(l, id, 'promise')` returns false; `firm` on a high-poise man lifts and on a low-poise man
    drops, and neither leaves `talk.sour`; an unanswered ask is `ignored` after `waitFor` steps with no `sour`; a
    man traded with the ask open has no talk at his new club; an AI club's man is answered at once by `aiReply`.
  - `coachWeek.test.ts`: the row carries two answers and no promise button.
  - `mail.test.tsx`: the row's buttons read as above.
  - `migrate.test.ts`: a v94 save loads as 95 with its talks untouched.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** the four files, `npx vitest run src/engine/simReadsNoMail.test.ts src/engine/disputes.test.ts
  src/engine/coachWeek.season.test.ts`, then `npm run morale`. Expected: PASS, and nothing flagged ✗. If the morale
  check flags a line, stop and bring it to check-in 4 with the line: do not change a band.
- [ ] **Step 5: Add** the `form` asks to the counting tool (Task 3's last row).
- [ ] **Step 6: Commit** `Talks: a slumping leader asks where he stands`.

**CHECK-IN 4.** Renders of the head coach's letter with the note and with the conversation row (built saves), and
`npm run editions -- --seasons 5` counts again: conversations a season for your club and the league, notes a
season, Columns by rung. Ask whether the bars hold. Wait.

### Task 9: The record

**Files:**
- Modify: `docs/NEWS.md`, `CLAUDE.md`, `docs/MVP.md`, `package.json`, `src/ui/changelog.ts`

- [ ] **Step 1: `docs/NEWS.md`**: the Column (ladder, limits, its rules, where the bars live), your club's
  storylines (which beats are public), the note and the conversation, and the rule that an article causes nothing.
- [ ] **Step 2: `CLAUDE.md`**: `slump.ts` and `snnColumn.ts` under Architecture, `form` in the `playerTalks.ts`
  entry, `SNN_OUTLET` in the `stories.ts` entry, `--seasons` on the `npm run editions` line.
- [ ] **Step 3: `docs/MVP.md`**: the news line stays Partial and says what is left (chains, calendar-day editions).
- [ ] **Step 4: Version**: the next patch and a `changelog.ts` entry in a player's words.
- [ ] **Step 5: Run** `npm run format`, `npm run typecheck`, `npx vitest run src/ui/changelog.test.ts`.
- [ ] **Step 6: Commit** `News: the Column and your club's storylines in the docs, version bump`. Push. Ask for
  sign-off on spec 2. No review and no pull request here.

## Left out on purpose

- **A GM's "one move" at rung 1** (a trade or a draft class paying off or not). The spec allows it. Judging a trade
  from public production needs its own rules and its own counts, so it waits for a later pass. The ladder's GM rungs
  2 and 3 are built.
- **SNN on the calendar's big days** (draft day, cut-down day and the like): the owner asked for it after this spec
  was approved. It is its own spec, next after this one.
