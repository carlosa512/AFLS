# SNN's Column on a General Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SNN's Columns about a general manager are written as whole pieces built on what he did (picks, trades,
signings, quarterbacks, coaches), and run late in the season, in place of four slotted sentences that run from week 6.

**Architecture:** A durable record of each GM's notable moves is written as trades and signings happen
(`gmMoves.ts`, on `GeneralManager.moves`). A pure reader (`gmFindings.ts`) turns that record and the rest of the
public record into typed findings about one GM at one team. `snnColumn.ts` gates and times GM claims on the race and
on having a finding, and hands the findings to a new writer (`snnGmVoice.ts`) that composes a piece from whole-paragraph
shapes. What a piece used (its lead family, its shapes, its close) is remembered in the edition's `covered` keys.

**Tech Stack:** TypeScript, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-11-13-gm-column-voice-design.md`. It builds on
`docs/superpowers/specs/2026-11-11-snn-column-and-storylines-design.md` (the Column) and
`docs/superpowers/specs/2026-11-11-snn-weekly-edition-design.md` (the page, the writing rules).

**Execution:** to be confirmed by the owner with this plan. The three earlier news plans ran native, with one review
of the whole branch at the end.

## Global Constraints

- Branch `claude/vigilant-ride-d3ruij`. Commit "Area: what changed", push after each task. No pull request until the
  owner asks.
- **Check-ins are hard stops** (after Tasks 4, 6 and 7): send renders or counts, then wait for the owner.
- Head coach and unit Columns do not change: their claims, timing, words and rules stay byte for byte, and their
  existing tests pass untouched.
- An article causes nothing. The moves record is record-keeping: nothing in the sim reads it and writing it draws
  nothing from any stream.
- No piece parses a transaction's display text. A fact comes from structured data or is not told.
- Public facts only: picks, trades, contracts, box-score stats, snaps, job-holders, honors, standings. No rating, mood
  or hidden trait, nothing predicted. Never `player.ratings`, `playerOvr` or `player.potential`.
- Only his seasons at this team count (`GeneralManager.career` entries with this `teamId`), plus the current season.
- Writing rules for a GM piece (spec §3): two to four paragraphs. Two numbers a sentence at most. One sentence under
  eight words a paragraph at most. No semicolon, no colon or dash inside a sentence. American football English (a
  team, a game, a loss). Full name first, surname after. The last sentence may be a judgment and names the man or the
  team. A figure of speech only in the close.
- Every sentence is chosen by a condition on facts. A time word ("a year later", "this spring", "before either pick",
  "that year", "last season's") is chosen by a condition, never assumed.
- No GM shape or close twice in a league year. No sentence twice in a season (`seasonSaid`, as today).
- `npm run format` before each commit. Locally: `npm run typecheck` and the test files touched. No `npm run check`.
- `League` stays plain JSON. `SAVE_VERSION` 98 → 99 with a step in `migrate.ts`.
- Version `0.4.41` → `0.4.42` with a `src/ui/changelog.ts` entry (title 40 characters at most, text 200 at most).

## Review Focus

1. **An older save, mid-season, that already told a "fair to ask" Column in week 8 under the old timing.** No second
   blame piece about that GM runs that season. (Test in Task 3.)
2. **Two teams in one city** (Los Angeles, New York). A headline and a sentence name the team by nickname there, never
   the bare city. (Test in Task 5.)
3. **A GM on his second team.** Findings and moves from his first team never appear in a piece about him at his
   second. (Tests in Tasks 1 and 2.)
4. **A player in a finding who has retired or is unsigned.** He is never said to play "for" a team, and a finding
   that needs where he plays now is not found. (Test in Task 2.)
5. **A trade of picks for picks, or a first-round pick for several players.** It is no star trade unless he got
   exactly one player for a first-round pick or more. (Test in Task 2.)

## File Structure

| File | Responsibility |
| --- | --- |
| `src/engine/gmMoves.ts` (new) | The durable record: what is notable, writing a move, reading a GM's moves at a team, the backfill |
| `src/engine/gmFindings.ts` (new) | Pure reader: findings about one GM at one team, ranked |
| `src/engine/snnGmVoice.ts` (new) | The pieces: shapes, closes, choosing, composing tokens into paragraphs |
| `src/engine/snnColumn.ts` | GM claims: timing, one blame a season, the findings gate, the repeat-lead rule |
| `src/engine/snnVoice.ts` | `columnStory` hands a GM claim to `snnGmVoice.ts`; `compose` takes paragraphs; the five GM banks go |
| `src/engine/storyRules.ts` | A GM Column's own rules |
| `src/engine/trade/execute.ts`, `src/engine/offseason/negotiation.ts` | Call the record's writers |
| `src/engine/types.ts`, `generate.ts`, `migrate.ts` | `GmMove`, `GeneralManager.moves`, save 99 |
| `scripts/editionCounts.ts` | The GM counts for the owner |

---

### Task 1: The durable record of a GM's moves

**Files:**
- Create: `src/engine/gmMoves.ts`, `src/engine/gmMoves.test.ts`
- Modify: `src/engine/types.ts` (beside `YouMoment`), `src/engine/trade/execute.ts` (after `market.history` is set in
  `executeTrade`), `src/engine/offseason/negotiation.ts` (`signPlayer`, beside `logTransaction`),
  `src/engine/generate.ts` (`SAVE_VERSION`), `src/engine/migrate.ts`, `src/engine/migrate.test.ts`

**Interfaces:**
- Produces, in `types.ts`:

```ts
export interface MoveSide {
  players: number[];
  /** Each pick as it was when traded: the rounds outlive `League.draftPicks`. */
  picks: { season: number; round: number }[];
}
/** A notable move on a GM's public record (`gmMoves.ts`): record-keeping, read only by SNN. */
export type GmMove =
  | { kind: 'trade'; season: number; phase: Phase; week: number; teamId: number; otherId: number; gave: MoveSide; got: MoveSide }
  | { kind: 'sign'; season: number; phase: Phase; week: number; teamId: number; playerId: number; years: number; total: number };
// on GeneralManager:
  /** His notable trades and signings, oldest first (`gmMoves.ts`); absent until one happens. */
  moves?: GmMove[];
```

- Produces, in `gmMoves.ts`:

```ts
export const MOVES = { on: true, round: 1, signShare: 0.08, keep: 40 };
export function noteTrade(league: League, record: TradeRecord): void;
export function noteSigning(league: League, player: Player, teamId: number, years: number, total: number): void;
export function movesAt(gm: GeneralManager, teamId: number): GmMove[];
export function backfillMoves(league: League): void;
```

- `noteTrade` reads each pick's season and round from `league.draftPicks` at that moment, and files one move for each
  side's GM (`league.gms[team.gmId]`), from his side, when either side gives a pick of round `MOVES.round`. A pick id
  that does not resolve means no move is filed. Your GM's moves are kept too.
- `noteSigning` files a move when `total >= MOVES.signShare * capFor(league, league.season)`. `signPlayer` calls it
  only for a player joining from outside (`!own`) on a contract that is not a tag, with `offer.years` and
  `offer.apy * offer.years`.
- Past `MOVES.keep` a GM's oldest move is dropped. `MOVES.on = false` turns both writers off.
- `backfillMoves` files a trade move for each `market.history` record whose picks all still resolve, for the one GM
  whose `career` has that season at that team (none or two: skip). It files no signings.

- [ ] **Step 1: Write the failing tests** in `gmMoves.test.ts`:

```ts
it('keeps a trade with a first-round pick for both GMs, each from his side, with the rounds', () => {
  // executeTrade: team A gives its next first- and second-round picks, team B gives one player
  expect(movesAt(gmA, A)).toEqual([
    expect.objectContaining({ kind: 'trade', teamId: A, otherId: B, gave: { players: [], picks: [{ season, round: 1 }, { season, round: 2 }] }, got: { players: [p.id], picks: [] } }),
  ]);
  expect(movesAt(gmB, B)[0]).toMatchObject({ otherId: A, gave: { players: [p.id] }, got: { picks: [{ season, round: 1 }, { season, round: 2 }] } });
  // the rounds are still there once the picks are pruned
  l.draftPicks = [];
  expect(movesAt(gmA, A)[0].kind === 'trade' && movesAt(gmA, A)[0].gave.picks[0].round).toBe(1);
});
it('keeps no trade without a first-round pick', () => { /* a second-round pick for a player: movesAt both sides [] */ });
it('keeps a signing worth 8% of the cap or more, and not a smaller one, a re-signing or a tag', () => {
  const cap = capFor(l, l.season);
  // signPlayer with total = 0.08 * cap  -> one { kind: 'sign', playerId, years, total }
  // signPlayer with total = 0.079 * cap -> none; his own player re-signed at any price -> none; kind 'tag' -> none
});
it('reads only the moves made at the team asked about', () => {
  gm.moves = [tradeAt(3), signAt(7)];
  expect(movesAt(gm, 7)).toEqual([signAt(7)]);
});
it('drops the oldest past MOVES.keep', () => { /* 41 noteSigning calls -> 40 moves, the first gone */ });
it('plays the same with the record off', () => {
  // two leagues, same seed, playWeek through the trade deadline (week 9), MOVES.on true and false
  const strip = (x: League) => { for (const g of Object.values(x.gms)) delete g.moves; return JSON.stringify(x); };
  expect(strip(on)).toBe(strip(off));
  expect(Object.values(on.gms).some((g) => g.moves?.length)).toBe(true);
});
```

and in `migrate.test.ts`:

```ts
it('a v98 save loads at 99 with the trades its picks still describe on the GMs who made them', () => {
  // play to the deadline, copy, delete every gm.moves, version = 98, migrate
  expect(up.version).toBe(SAVE_VERSION);
  // every move filed is a trade; none is a signing; each equals what the live league recorded for that trade
});
```

  Change `expect(SAVE_VERSION).toBe(98)` to `99`.

- [ ] **Step 2: Run them and see them fail.** `npx vitest run src/engine/gmMoves.test.ts src/engine/migrate.test.ts`.
  Expected: FAIL, `gmMoves` not found.
- [ ] **Step 3: Implement** the types, `gmMoves.ts`, the two calls, `SAVE_VERSION = 99` and the v99 step
  (`backfillMoves(league); league.version = 99`).
- [ ] **Step 4: Run them and see them pass.** Also `npm run typecheck` and
  `npx vitest run src/engine/trade src/engine/offseason/negotiation.test.ts` (whichever of those exist).
- [ ] **Step 5: Commit** "GM moves: a durable record of notable trades and signings (save 99)". Push.

---

### Task 2: Findings

**Files:**
- Create: `src/engine/gmFindings.ts`, `src/engine/gmFindings.test.ts`

**Interfaces:**
- Consumes: `movesAt`, `GmMove` (Task 1); `Player.draft`, `Player.statTeams`, `Player.left`, `Team.jobs.held`,
  `League.awards`, `League.history`, coaches' `career` (`League.coaches` and `League.retiredCoaches`),
  `computeRecords`.
- Produces:

```ts
export type FindingFamily = 'qbPicks' | 'qbs' | 'firsts' | 'class' | 'lateFind' | 'starTrade' | 'contract' | 'left' | 'coaches';
export interface Honor { season: number; what: string }            // AWARD_NAMES[k], 'first-team All-League', 'second-team All-League'
export interface PickFact { playerId: number; season: number; round: number; pick: number; here: boolean; starts: boolean; snaps: number; honors: Honor[] }
interface Base { side: 'blame' | 'credit'; /** The season of its newest fact. */ latest: number }
export type Finding = Base & (
  | { family: 'qbPicks'; picks: PickFact[]; signed?: { playerId: number; season: number; years: number; before: boolean } }
  | { family: 'qbs'; passers: { season: number; playerId: number }[] }
  | { family: 'firsts'; picks: PickFact[]; starting: number; gone: number }
  | { family: 'class'; picks: PickFact[] }
  | { family: 'lateFind'; pick: PickFact }
  | { family: 'starTrade'; move: Extract<GmMove, { kind: 'trade' }>; playerId: number; here: boolean; honors: Honor[]; title: number | null; again?: Extract<GmMove, { kind: 'trade' }> }
  | { family: 'contract'; move: Extract<GmMove, { kind: 'sign' }>; here: boolean; nowTeamId: number | null; honors: Honor[] }
  | { family: 'left'; playerId: number; how: Departure['how']; season: number; nowTeamId: number; honors: Honor[] }
  | { family: 'coaches'; coachIds: number[]; hiredFirst: boolean }
);
export const FINDING_ORDER: Record<'blame' | 'credit', FindingFamily[]>;
export function gmSeasons(l: League, gmId: number, teamId: number): { season: number; w: number; l: number }[]; // finished, oldest first
export function gmFindings(l: League, gmId: number, teamId: number): Finding[]; // both sides, unranked
export function rankFindings(found: Finding[], side: 'blame' | 'credit', key: string): Finding[];
```

- `FINDING_ORDER`: blame `['qbPicks', 'left', 'starTrade', 'contract', 'firsts', 'qbs', 'coaches']`; credit
  `['starTrade', 'class', 'lateFind', 'qbs', 'contract', 'firsts', 'coaches']`. `rankFindings` keeps one side, orders
  by that list, then `latest` newest first, then `stableHash(key + family)`.
- "His seasons" `T`: the seasons of `gmSeasons` plus `l.season`. A player "starts" when he is on this team and in
  `l.teams[teamId].jobs.held`. Honors "here" were won with `teamId` in a season of `T`; "elsewhere" with another team
  in the departure's season or later.
- When each is found, and its side:

| Family | Found when | Side |
| --- | --- | --- |
| `qbPicks` | Two or more QBs with `draft.round === 1`, `draft.teamId === teamId`, `draft.season` in `T`. `signed`: a `sign` move for a QB of three years or more in `T`; `before` when its season is the first pick's season or earlier | blame |
| `qbs` | The leading passer (most `passAtt`, `statTeams[season]` includes the team) differs in three or more seasons of `T`; the current season counts once the team has played six games | credit when every finished season of those was a winning one, blame when two or more were losing ones, else not found |
| `firsts` | Two or more first-round picks made in `T` | blame when fewer than half start, credit when all start, else not found |
| `class` | Two or more picks made in `T` with an honor here | credit |
| `lateFind` | A pick of round four or later made in `T` with an honor here (the most honored, then the latest round) | credit |
| `starTrade` | A trade move where he gave a first-round pick or more and got exactly one player and no pick | credit when the player has an honor here since; blame when a full season has passed since the trade, he has no honor here, and he is gone or does not start; else not found. `title`: a season of `T`, the trade's or later, the team won it all. `again`: a later star trade |
| `contract` | A `sign` move | blame when he is on another team now and `l.season - move.season <= 2`; credit when he is here, starts and has an honor here since; else not found |
| `left` | A `Player.left` entry for this team in a season of `T`, an honor elsewhere since, and he is on another team now (the most honored) | blame |
| `coaches` | Head coaches (`career` rows, role `headCoach`, this team, seasons of `T`) | blame when three or more different ones; credit when exactly one over three or more seasons whose first such season is the GM's first here (`hiredFirst: true`); else not found |

- A finding that names a player needs `l.players[id]` to exist. `left` and a blamed `contract` need him on a team now
  (never retired, never unsigned). A finding that fails this is not found.

- [ ] **Step 1: Write the failing tests** in `gmFindings.test.ts`. One `describe` per family on a built scene
  (`createLeague`, then set `draft`, `career`, `moves`, `awards`, `left`, `jobs.held` by hand; move players with
  `setTeam`). Each asserts the finding found and the facts a paragraph will read, and one near miss. The ones that pin
  the Review Focus:

```ts
it('reads only his seasons at this team', () => {
  // the GM's career: two seasons at team 3, then two at team 7; first-round QBs drafted by team 3 in his seasons there
  expect(gmFindings(l, gm.id, 7).some((f) => f.family === 'qbPicks')).toBe(false);
  expect(gmFindings(l, gm.id, 3).some((f) => f.family === 'qbPicks')).toBe(true);
});
it('finds no "left" or blamed "contract" for a player who has retired or is unsigned', () => {
  p.retired = true; // then: setTeam(l, p, null)
  expect(gmFindings(l, gm.id, t).filter((f) => f.family === 'left' || f.family === 'contract')).toEqual([]);
});
it('a star trade is one player for a first-round pick or more', () => {
  // gave [R1], got picks only            -> not found
  // gave [R1, R2], got two players       -> not found
  // gave [R1], got one player, MVP here  -> { family: 'starTrade', side: 'credit', here: true }
  // gave [R1], got one player, no honor, a season on, not a job-holder -> side 'blame'
  // the same, traded this league year    -> not found (no full season since)
});
it('says whether the quarterback he signed came before either pick', () => {
  // sign move 2027, picks 2027 and 2028 -> signed.before true; sign move 2028 -> false
});
it('returns nothing for a GM with no finished season here', () => { expect(gmFindings(l, newGm.id, t)).toEqual([]); });
it('ranks by the fixed order, then the newest fact', () => {
  expect(rankFindings(found, 'blame', 'k').map((f) => f.family)).toEqual(['qbPicks', 'left', 'firsts']);
});
```

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/engine/gmFindings.test.ts`. Expected: FAIL, module not
  found.
- [ ] **Step 3: Implement `gmFindings.ts`.** Small pure functions, one per family, each returning a finding or null.
  It imports nothing from `snn*.ts`.
- [ ] **Step 4: Run and see them pass.** `npm run typecheck`.
- [ ] **Step 5: Commit** "GM findings: what the public record shows about a general manager's work". Push.

---

### Task 3: Timing, one blame piece a season, and the findings gate

**Files:**
- Modify: `src/engine/snnColumn.ts` (`LADDER`, `Claim`, the GM block of `columnClaims`),
  `src/engine/snnColumn.test.ts`

**Interfaces:**
- Consumes: `gmFindings`, `rankFindings`, `Finding`, `FindingFamily` (Task 2).
- Produces:

```ts
// LADDER gains (the spec's values):
  /** A GM is blamed only after this week is played, and credited only after this one. */
  gmBlameAfter: 11,
  gmCreditAfter: 13,
// Claim gains:
  /** A GM's claim: what the record shows on its side, the lead first (`gmFindings.ts`). Never empty when present. */
  findings?: Finding[];
export const gmLeadKey = (season: number, gmId: number, teamId: number, family: FindingFamily) =>
  `gmlead:${season}:${gmId}:${teamId}:${family}`;
export function columnClaims(l: League, week: number, have: Set<string>, opt?: { bare?: boolean }): Claim[];
```

- GM blame claims also need `week > LADDER.gmBlameAfter` and `ctx(t.id).race === 'out'`. GM credit claims (all three
  reasons) also need `week > LADDER.gmCreditAfter` and `ctx(t.id).race === 'in'`.
- One blame piece a GM at a team a season: no blame claim is added once `have` holds this season's `:2-` or `:3-` key
  for him. "It is time" (`:3-`) needs `lost.length >= LADDER.gmTime` and last season's `:2-` or `:3-` key in `have`.
  Otherwise the claim is "fair to ask" (`:2-`).
- The gate: a GM claim is added only with one or more findings of its side. The repeat-lead rule: a finding may not
  lead when `have` holds `gmLeadKey(s, …, family)` for `s` of this season or last and `finding.latest <= s`; it moves
  behind the others. With no finding left to lead, the claim is not added.
- `opt.bare`: GM claims are added with `findings: []` when the gate would drop them (for the counts only).
  `pickColumn` never picks a GM claim whose `findings` is empty.

- [ ] **Step 1: Write the failing tests** in `snnColumn.test.ts`, with the file's own helpers (`world`, `other`,
  `losing`, `plant`, `about`) and a new helper that plants one blame finding (two first-round QBs drafted by the team
  in his seasons) or one credit finding:

```ts
it('blames a GM only after week 11 and only once his team is out of the race', () => {
  expect(about(columnClaims(l, 8, new Set()), 'gm', t)).toEqual([]);         // losing all year, week 8
  expect(about(columnClaims(l, 12, new Set()), 'gm', t).map((c) => c.rung)).toEqual([2]);
});
it('credits a GM only after week 13 and only while his team is in the race', () => {
  expect(about(columnClaims(l, 12, new Set()), 'gm', t)).toEqual([]);
  expect(about(columnClaims(l, 14, new Set()), 'gm', t).map((c) => c.dir)).toEqual(['credit']);
});
it('runs one blame piece a GM a season, and "it is time" a season after he was asked about', () => {
  const fairNow = `column:${l.season}:gm:${gm.id}:2-`;
  const fairLast = `column:${l.season - 1}:gm:${gm.id}:2-`;
  expect(about(columnClaims(l, 14, new Set([fairNow])), 'gm', t)).toEqual([]);   // also the older save told in week 8
  expect(about(columnClaims(l3, 12, new Set()), 'gm', t).map((c) => c.rung)).toEqual([2]);       // three losing, never asked
  expect(about(columnClaims(l3, 12, new Set([fairLast])), 'gm', t).map((c) => c.rung)).toEqual([3]);
});
it('makes no claim about a GM with nothing on record, unless asked for the bare ones', () => {
  expect(about(columnClaims(bareLeague, 12, new Set()), 'gm', t)).toEqual([]);
  expect(about(columnClaims(bareLeague, 12, new Set(), { bare: true }), 'gm', t)[0].findings).toEqual([]);
});
it('does not lead twice with the same family unless it has a new fact', () => {
  const led = gmLeadKey(l.season - 1, gm.id, t, 'qbPicks');
  expect(about(columnClaims(l, 12, new Set([led])), 'gm', t)[0].findings![0].family).not.toBe('qbPicks');
  // with qbPicks his only finding and no newer pick: no claim
});
```

  Update the existing "is fair to ask about after two losing seasons under him, and time after three" test to these
  rules (its `had` key becomes last season's), and any other GM test that asserts a claim before the new weeks.

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/engine/snnColumn.test.ts`.
- [ ] **Step 3: Implement** in the GM block of `columnClaims`, `LADDER` and `pickColumn`'s filter.
- [ ] **Step 4: Run and see them pass**, with every coach and unit test in the file unchanged and passing.
- [ ] **Step 5: Commit** "SNN's Column: a GM is judged late, once a season, and only on something he did". Push.

---

### Task 4: The counts, and the first check-in

**Files:**
- Modify: `scripts/editionCounts.ts`

**Interfaces:**
- Consumes: `columnClaims(…, { bare: true })`, `Claim.findings`, `LADDER.gmBlameAfter`, `LADDER.gmCreditAfter`.
- Produces: a "General managers" section in the report `npm run editions -- --seasons n` prints and writes, per
  season and in total:
  - GM claims that qualified (by `gm 2−`, `gm 3−`, `gm 2+`) and how many of each ran.
  - Qualified in a week or more but never ran that season ("squeezed out"), with the week each first qualified.
  - How often each family was found among qualified claims, by side.
  - Qualified claims with no finding.
  - The week each GM Column ran.

- [ ] **Step 1: Add the section.** It reads the bare claims each regular-season week, as the script already reads
  claims, and the Columns the editions carried.
- [ ] **Step 2: Run it.** `npm run editions -- --seasons 6` on two seeds (each plays six seasons). The first two
  seasons of a league can hold no GM claim: say so in the report's own line.
- [ ] **Step 3: Commit** "Edition counts: general managers by rung, by family, and what the late window squeezes out".
  Push.
- [ ] **Step 4: CHECK-IN (hard stop).** Send the owner the General managers section for both seeds, with three
  questions: are `gmBlameAfter` 11 and `gmCreditAfter` 13 right, does the rotation need loosening for the late weeks,
  and should a family that almost never fires go. Change `LADDER`, `MOVES` or `FINDING_ORDER` as he answers, and
  nothing in the rotation unless he says so.

---

### Task 5: The writer, the rules, and the blame pieces

**Files:**
- Create: `src/engine/snnGmVoice.ts`, `src/engine/snnGmVoice.test.ts`
- Modify: `src/engine/snnVoice.ts` (`compose`, `columnStory`, remove `'gm2-'` and `'gm3-'` from `COLUMN` and
  `columnBank`), `src/engine/storyRules.ts`, `src/engine/storyRules.test.ts`, `src/engine/letterRules.ts`
  (`WORD_FILES` gains `src/engine/snnGmVoice.ts`), `src/engine/snnWeek.season.test.ts`

**Interfaces:**
- Consumes: `Claim.findings`, `gmLeadKey` (Task 3); `Finding`, `gmSeasons` (Task 2); `toldKeys`, `stableHash`,
  `possessive` (`refer.ts`).
- Produces, in `snnGmVoice.ts`:

```ts
export interface GmSheet {
  teamId: number; gm: string; surname: string;      // "George Sutton", "Sutton"
  rec: string;                                       // "2–6"
  past: { season: number; w: number; l: number }[]; // his finished seasons here
  season: number; rung: 2 | 3; dir: 'blame' | 'credit'; why?: string; // the claim's facts.why
  shared: boolean;                                   // two teams share this city
}
export interface Shape { id: string; family: FindingFamily; side: 'blame' | 'credit'; role: 'lead' | 'turn'; when?: (s: GmSheet, f: Finding) => boolean; text: (s: GmSheet, f: Finding) => string[]; headline?: (s: GmSheet, f: Finding) => string }
export interface Close { id: string; on: '2-' | '3-' | '+'; family?: FindingFamily; text: (s: GmSheet, f: Finding) => string }
export const SHAPES: readonly Shape[];
export const CLOSES: readonly Close[];
export const gmShapeKey = (season: number, id: string) => `gmshape:${season}:${id}`;
export interface GmPiece { headline: string; paragraphs: string[]; covers: string[] }
export function gmPiece(l: League, claim: Claim, have: Set<string>): GmPiece | null;
```

- A shape's `text` returns one or two paragraphs in the edition's tokens (`{M:id}` for a player, `{C:id}`, `{c:id}`,
  `{N:id}` for a team); the GM's name is plain text. A piece is: a lead shape for `claim.findings[0]`, then a turn
  (a turn shape for the next finding of another family, or one sentence giving the record when there is none or it
  would pass four paragraphs), then a close as its own paragraph. A turn's record sentence never recites the table.
- `gmPiece` skips a shape or close whose `gmShapeKey` is in `have`, picks among the rest by
  `stableHash(claim.key + id)`, prefers a close tied to the lead's family, and returns null when no lead shape is left.
  `covers` is `[claim.key, gmLeadKey(…lead family), gmShapeKey(…) for each shape and the close]`.
- A team is named through the tokens in a paragraph. In a headline, `shared` picks "the Knights" over "New York".
- In `snnVoice.ts`: `compose`'s `parts` gains `paragraphs?: string[]` (used as given in place of `prose(first,
  second)`). `columnStory`, for `claim.subject.kind === 'gm'`, builds from `gmPiece(l, claim, toldKeys(l))`, with the
  claim's table, numbers, picture and links as today and `covers: piece.covers`. `columnClaims` already drops a claim
  with no finding, so a null piece there throws.
- In `storyRules.ts`: a Column whose key matches `/^column:\d+:gm:(\d+):/` is held to: two to four paragraphs, the
  evidence table, one sentence under eight words a paragraph, the edition's two numbers a sentence, and a last
  sentence that holds `l.gms[id].lastName` or the team's name or city. It is not held to "one number a sentence", to
  "two or three sentences in the argument", or to "ends on a fact".

**The words.** The blame side, written by the implementer to the Global Constraints and read by the owner at the
check-in:

- Lead shapes: two or more for each of `qbPicks`, `left`, `starTrade`, `contract`, `firsts`, `qbs`, `coaches`.
- Turn shapes: one or more for each of those families (a turn is one or two sentences inside a paragraph).
- Closes: three or more for `2-`, three or more for `3-`, and a family close for `qbPicks` and `starTrade` on each.
- The reference, from the trial, is the first `qbPicks` lead, the `contract` turn and the `qbPicks` close for `2-`:

> George Sutton used the first pick of the 2027 draft on quarterback Reid Andrews. A year later he used the second
> pick on another quarterback, Victor Salami, who has not played a snap. Before either pick he had signed a third,
> Zach Griffith, to a five-year contract.
>
> The Tarpons won five games in Sutton's first two seasons combined and are 2–6 in his third. The money has gone the
> same way. Ezekiel Fowler got $43 million over two years in 2027 and plays for Green Bay now.
>
> A general manager gets one try at a quarterback before the questions start. He has had three. It is fair to ask
> whether Sutton gets another.

  Headline: "Sutton has drafted two quarterbacks and Jacksonville are 2–6". The close differs from the trial's so that
  its last sentence names the man, as the rules ask. "A year later", "who has not played a snap" and "Before either
  pick" are each chosen by a condition on the finding.

- [ ] **Step 1: Write the failing tests.** In `snnGmVoice.test.ts`:

```ts
it('writes the trial piece from its findings', () => {
  // scene: the Jacksonville facts above as a claim with findings [qbPicks (signed.before true), contract (blame)]
  const piece = gmPiece(l, claim, new Set())!;
  expect(piece.headline).toBe('Sutton has drafted two quarterbacks and Jacksonville are 2–6');
  expect(piece.paragraphs).toHaveLength(3);
  expect(piece.covers).toContain(gmLeadKey(l.season, gm.id, t, 'qbPicks'));
});
it('chooses its time words by the facts', () => {
  // picks two seasons apart -> no "A year later"; second QB has snaps -> no "has not played a snap";
  // signed.before false -> no "Before either pick"
});
it('never uses a shape or a close twice in a league year', () => {
  const first = gmPiece(l, claim, new Set())!;
  const second = gmPiece(l, claim, new Set(first.covers))!;
  expect(second.covers.filter((k) => k.startsWith('gmshape:')).some((k) => first.covers.includes(k))).toBe(false);
});
it('names a team that shares its city by its nickname in the headline', () => {
  // the same scene at a New York or Los Angeles team: the headline holds the nickname and not the bare city
});
it('has two lead shapes or more for every blame family, and three closes or more for each blame rung', () => {
  for (const family of FINDING_ORDER.blame)
    expect(SHAPES.filter((s) => s.side === 'blame' && s.role === 'lead' && s.family === family).length).toBeGreaterThanOrEqual(2);
  for (const on of ['2-', '3-'] as const) expect(CLOSES.filter((c) => c.on === on && !c.family).length).toBeGreaterThanOrEqual(3);
});
it('every blame shape, on a scene that finds its family, keeps the GM piece rules', () => {
  // for each blame lead shape: build its family's scene, columnStory(l, claim, at) with that shape forced
  expect(ruleBreaks(l, story)).toEqual([]);
});
```

  In `storyRules.test.ts`: a GM Column of three paragraphs with two numbers in a sentence and a last sentence naming
  the GM has no breaks; the same story under a coach's key breaks "one number" and "ends on no fact"; a GM Column
  whose last sentence names neither the man nor the team breaks; a GM Column with a semicolon breaks.

  In `snnWeek.season.test.ts`: the existing season already holds every story to `ruleBreaks`. Add: every Column whose
  key holds `:gm:` ran after week 11 (blame) or 13 (credit), and no `gmshape:` key is in two editions' `covered` in
  one season.

- [ ] **Step 2: Run and see them fail.**
  `npx vitest run src/engine/snnGmVoice.test.ts src/engine/storyRules.test.ts`.
- [ ] **Step 3: Implement** `snnGmVoice.ts` (the composer, then the shapes and closes), the `compose` and
  `columnStory` changes, the rules, and `WORD_FILES`. Until Task 6, a credit claim has no shapes: keep the three credit
  banks (`'gm2+'`, `'gmBuilt+'`, `'gmRun+'`) and send only blame claims to `gmPiece`.
- [ ] **Step 4: Run and see them pass.** Also `npx vitest run src/engine/letterRules.test.ts
  src/engine/snnWeek.season.test.ts src/engine/simReadsNoMail.test.ts`, `npm run typecheck`, and
  `npm run editions` (read every GM piece it lists, and the rule breaks at its top: none).
- [ ] **Step 5: Commit** "SNN's Column: a GM's hit piece is written from what he did". Push.

---

### Task 6: The second check-in (blame renders)

- [ ] **Step 1: Play leagues and keep a save at each GM blame Column.** A scratch script under `.check/` (not
  committed): `createLeague`, play five seasons as `scripts/editionCounts.ts` does with mail filed each step, and
  write a save whenever a new edition's Column key holds `:gm:` and ends `-`. Two seeds.
- [ ] **Step 2: Shoot them.** `npm run screens -- --save <save> --out <dir> --edition 1 --column` for six or more,
  covering four lead families or more and both rungs.
- [ ] **Step 3: Fact-check each render against the save** before sending it: every pick, price, year, team and time
  word. Fix what is wrong, with a test for it.
- [ ] **Step 4: CHECK-IN (hard stop).** Send the renders (pictures, not lists). Apply the owner's notes on the words
  and re-shoot what changed. Commit "SNN's Column: the owner's notes on the GM hit pieces". Push.

---

### Task 7: The credit pieces, and the third check-in

**Files:**
- Modify: `src/engine/snnGmVoice.ts`, `src/engine/snnGmVoice.test.ts`, `src/engine/snnVoice.ts` (remove `'gm2+'`,
  `'gmBuilt+'`, `'gmRun+'`, `CREDIT_MAN_STAKES`'s GM uses, and the GM branches of `columnBank`; every GM claim now goes
  to `gmPiece`)

**Interfaces:**
- Consumes: Task 5's `Shape`, `Close`, `gmPiece`. No new exports.

**The words.** Lead shapes: two or more for each of `starTrade`, `class`, `lateFind`, `qbs`, `contract`, `firsts`,
`coaches`. A turn shape for each. Three closes or more for `+`, and a family close for `starTrade` and `class`. A
credit close for a first-year coach's turnaround (`sheet.why === 'hire'`) names the coach he hired. The references,
from the trial:

> Ryan Sharp sent Washington a first-round pick and two second-round picks for quarterback Jonathan Richards before
> the 2027 season. Richards was the league's most valuable player that year, and Indianapolis won the title.
>
> Trades like that usually look expensive by the second year. Sharp made another one instead. This spring he paid the
> same team two first-round picks and a fourth-round pick for lineman Cody Locklear.
>
> That is three first-round picks for two players. The Racers are 10–5 with last season's most valuable player at
> quarterback, and nobody in Indianapolis is asking for the picks back.

> Tampa Bay took lineman Demetrius Jordan in the first round in 2026. He made the second All-League team as a rookie.
> DeMarcus Wallace went in the second round of the same draft and was the defensive rookie of the year. Michael
> Bryant, a fifth-round pick, made the first team a year later.
>
> Troy Roberts made all three picks. The Corsairs went 14–3 and 12–5 in the seasons since and are 7–2 now.
>
> Plenty of teams win for a year on a quarterback. Tampa Bay have started a different one in each of Roberts' three
> seasons and kept winning, which says the roster is doing it.

  "that year", "This spring", "the same team", "last season's" and "a year later" are each chosen by a condition.
  "14–3 and 12–5 … and are 7–2" is three numbers in a sentence: split it to keep to two.

- [ ] **Step 1: Write the failing tests** in `snnGmVoice.test.ts`: the two reference pieces from their findings (the
  headline "Sharp paid for Richards and Indianapolis got a title", three paragraphs each); "last season's most
  valuable player" only when the honor's season is `l.season - 1`, "This spring" only when the second trade's season
  is `l.season` and its phase is before the regular season; the two-leads and three-closes counts for the credit side;
  every credit shape on its family's scene has no `ruleBreaks`; and

```ts
it('no GM claim is written from the old banks', () => {
  for (const key of ['gm2-', 'gm3-', 'gm2+', 'gmBuilt+', 'gmRun+']) expect(COLUMN[key]).toBeUndefined();
});
```

  (export `COLUMN` for the test if it is not exported).

- [ ] **Step 2: Run and see them fail.** `npx vitest run src/engine/snnGmVoice.test.ts`.
- [ ] **Step 3: Implement** the credit shapes and closes, and remove the old banks.
- [ ] **Step 4: Run and see them pass.** Also `npx vitest run src/engine/snnColumn.test.ts
  src/engine/storyRules.test.ts src/engine/letterRules.test.ts src/engine/snnWeek.season.test.ts`,
  `npm run typecheck`, `npm run editions`.
- [ ] **Step 5: Commit** "SNN's Column: a GM's hype piece is written from what he did". Push.
- [ ] **Step 6: Renders and CHECK-IN (hard stop).** As Task 6, for Columns whose key holds `:gm:` and ends `+`: six
  or more, four lead families or more, each fact-checked against its save. Apply the owner's notes, re-shoot, commit,
  push.

---

### Task 8: Docs and the version

**Files:**
- Modify: `docs/NEWS.md` ("The Column": the ladder's GM column and its timing, the pieces, the two relaxed rules, the
  moves record, the new count), `CLAUDE.md` (the `snnWeek.ts` paragraph's Column sentences; a line for `gmMoves.ts`,
  `gmFindings.ts` and `snnGmVoice.ts`; `npm run editions`' description), `docs/MVP.md` (the news line: GM Columns
  written from the record), `package.json` (`0.4.42`), `src/ui/changelog.ts`

- [ ] **Step 1: Write them.** The changelog entry in a player's words, within its limits.
- [ ] **Step 2: Run** `npm run format`, `npm run typecheck`, `npx vitest run src/ui/changelog.test.ts
  src/engine/letterRules.test.ts`. Expected: PASS.
- [ ] **Step 3: Commit** "Docs: SNN's Column on a general manager; version 0.4.42". Push.
- [ ] **Step 4: Tell the owner the branch is ready for a pull request when he asks**, and that CI on it is the full
  run.
