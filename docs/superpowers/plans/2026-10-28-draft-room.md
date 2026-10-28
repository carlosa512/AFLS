# Draft Room Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Front Office's draft tab as a Home-style war room with a clock hero, your staff's top 5, a
slimmer big board (risk bar, staff-vs-consensus pill) and pick verdicts in draft history.

**Architecture:** Pure reads in a new `src/engine/draftGrade.ts` (verdicts, the year-three lock, risk, staff gaps),
one stored field (`draft.verdict`, save v59), and the draft tab moved to `src/ui/screens/Draft.tsx`, split into
small components on `home-grid`.

**Tech Stack:** TypeScript, React, Vitest, plain CSS (`src/styles.css`).

**Spec:** `docs/superpowers/specs/2026-10-28-draft-room-design.md`

## Global Constraints

- Fog of war: the screen never reads `player.ratings`, `playerOvr`, `player.potential` or `player.ceilingShifts`
  (enforced by `ui.test.ts`); it shows `viewOf`/`Ovr`/`RangeValue`/`PlayerLink`/`TeamChip`/`TeamPicker`/`SortTh`.
- No change to AI drafting, `boardOf`, consensus or pick order; no sim number moves.
- Verdict bars by round (tier index from `tierOf`, 0 = elite): R1 → 1, R2 → 2, R3 → 3, R4–7 → 4. Steal: tier ≤ bar − 2;
  hit: tier ≤ bar; miss: otherwise.
- Gap pill line: 12 spots (`Sleeper ▲n` at ≥ 12, `Fade ▼n` at ≤ −12, grey `▲n`/`▼n`/`=` otherwise).
- `SAVE_VERSION` 58 → 59. Version 0.2.10 → 0.2.11 with a `src/ui/changelog.ts` entry.
- Local checks only: `npm run typecheck`, `npx vitest run <touched files>`, `npm run format` before each commit.
- Copy in plain words; comments explain why.

## Review Focus

1. A pick from a draft held before the league existed (made-up `draft` line, no `scouting`): no verdict, no lock, no
   row in history (as today). Pinned in Task 1 (`lockVerdicts` skips him).
2. Loading a v58 save twice, or a lock running on a later league year: a stored verdict never changes. Pinned in
   Task 1 (lock is idempotent).
3. The draft tab with no class generated yet and no history (a brand-new league in the regular season): hero shows
   no class, nothing crashes. Pinned in Task 4 (`clockState` → `none` with an empty `draftClass`).
4. A pool smaller than five (late round 7): the top-5 strip shows what is left, gap ranks stay sane. Pinned in Task 2
   (`staffGaps` on a 3-player pool).
5. A traded-away user pick or a retired drafted player in history: verdict still shows from your read. Pinned in
   Task 1 (retired player locks).

---

### Task 1: Pick verdicts and the lock

**Files:**
- Create: `src/engine/draftGrade.ts`, `src/engine/draftGrade.test.ts`
- Modify: `src/engine/scouting.ts` (export `tierOf`), `src/engine/types.ts:207` (`draft.verdict?`),
  `src/engine/offseason/index.ts` (`beginOffseason`), `src/engine/generate.ts` (`SAVE_VERSION = 59`),
  `src/engine/migrate.ts` (v59 step)

**Interfaces:**
- Produces:
  - `export type PickVerdict = 'steal' | 'hit' | 'miss'` (in `types.ts`, re-exported from `draftGrade.ts`)
  - `export const ROUND_BAR: (round: number) => number`
  - `export function verdictFor(round: number, tier: number): PickVerdict`
  - `export interface PickMark { verdict: PickVerdict | null; locked: boolean }`
  - `export function pickMark(league: League, p: Player): PickMark | null` (null = not from a draft this league held)
  - `export function lockVerdicts(league: League): void`
  - `export const VERDICT_YEARS = 3`

- [ ] **Step 1: Write the failing tests** in `draftGrade.test.ts`:
  - `verdictFor`: `(1,1)→hit`, `(1,0)→hit`, `(1,2)→miss`, `(2,0)→steal`, `(2,2)→hit`, `(2,3)→miss`, `(3,1)→steal`,
    `(4,2)→steal`, `(7,4)→hit`, `(7,5)→miss`.
  - `pickMark`: a player without `draft` or without `scouting` → `null`; a drafted rookie with `experience 0` and no
    `ceilingShifts` → `{ verdict: null, locked: false }`; after `experience = 1` → a verdict, `locked: false`; with
    `draft.verdict = 'miss'` stored → `{ verdict: 'miss', locked: true }`.
  - `lockVerdicts`: on `createLeague({ seed: 'dg' })`, give three players `draft` lines (seasons `season − 3`,
    `season − 2`, `season − 3` with `retired = true`) and `scouting`; after the call the two at `season − 3` have a
    verdict, the `season − 2` one doesn't; set one stored verdict to a different value, call again, it is unchanged;
    a player with a `draft` line but no `scouting` gets none.
  - Migration: a copy of that league at `version = 58` through `migrate` gets verdicts on the old picks and
    `version === 59`.

- [ ] **Step 2: Run** `npx vitest run src/engine/draftGrade.test.ts`. Expected: FAIL (module missing).

- [ ] **Step 3: Implement.**
  - `scouting.ts`: `export function tierOf` (no other change).
  - `draftGrade.ts`: `pickMark` judges `tierOf(league, p.position, perceive(league, league.userTeamId, p).potMid)`.
    "Too early" is `experience === 0 && !Object.keys(p.ceilingShifts ?? {}).length` (his rookie season isn't in).
    `lockVerdicts` writes `p.draft.verdict` for `p.draft && p.scouting && !p.draft.verdict &&
    league.season - p.draft.season >= VERDICT_YEARS`, retired included.
  - `beginOffseason`: call `lockVerdicts(league)` after the player loop (the year's development is in, so the read
    is the new year's).
  - `migrate.ts`: `// v59: optional draft.verdict, locked from today's read for picks past year three.` then
    `if (league.version < 59) { lockVerdicts(league); league.version = 59; }`.

- [ ] **Step 4: Run** `npx vitest run src/engine/draftGrade.test.ts src/engine/ceiling.test.ts` and
  `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `Draft: pick verdicts judged by your scouts, locked after year three (save v59)`.

### Task 2: Risk and staff gaps

**Files:**
- Modify: `src/engine/draftGrade.ts`, `src/engine/draftGrade.test.ts`

**Interfaces:**
- Consumes: `perceive`, `POSITION_PREMIUM`, `consensus boardValue` from `offseason/draft.ts`.
- Produces:
  - `export type RiskWord = 'safe' | 'boom-or-bust' | null`
  - `export interface Risk { lo: number; mid: number; hi: number; word: RiskWord }` (1–20 scale: `ovr`, `potMid`,
    `potHi`)
  - `export function riskOf(view: PlayerView): Risk`
  - `export const staffBoardValue = (league: League, p: Player) => number` (moved from `myBoardValue` in
    `FrontOffice.tsx`: `0.6 * ovr + 0.4 * potMid + POSITION_PREMIUM`, user's view)
  - `export interface Gap { ours: number; consensus: number; diff: number; tag: 'sleeper' | 'fade' | null }`
  - `export function staffGaps(league: League, pool: Player[]): Map<number, Gap>` (ranks within `pool`;
    `diff = consensus − ours`, positive = staff likes him more; tag at `|diff| >= 12`)
  - `export const GAP_LINE = 12`

- [ ] **Step 1: Measure** the class's spread before fixing thresholds: in a scratch script (scratchpad, not
  committed) print the 20th and 80th percentiles of `potMid − ovr` and `potSd` over `availableProspects` of three
  seeded leagues. Set `SAFE_UPSIDE`, `SAFE_SD`, `BOOM_UPSIDE`, `BOOM_SD` as named constants from them (safe: both under
  the 20th; boom-or-bust: either over the 80th, tuned so about a fifth gets each word).

- [ ] **Step 2: Write the failing tests:**
  - `riskOf`: hand-built views give `safe` (`ovr 12, potMid 12.5, potHi 13, potSd low`), `boom-or-bust`
    (`ovr 8, potMid 14, potHi 17`), `null` in between; `lo ≤ mid ≤ hi`.
  - On a generated class (`createLeague({ seed: 'risk' })`, user's views of `availableProspects`): the share tagged
    `safe` and the share tagged `boom-or-bust` each fall in 0.12–0.30.
  - `staffGaps` on a 3-player pool: ranks are 1–3 on both sides, diffs sum to 0, no tag; a constructed 40-player pool
    where one prospect is our #1 and consensus #20 → `{ diff: 19, tag: 'sleeper' }`.

- [ ] **Step 3: Implement** `riskOf`, `staffBoardValue`, `staffGaps` (sort the pool once by each value; ties by id).

- [ ] **Step 4: Run** `npx vitest run src/engine/draftGrade.test.ts` and `npm run typecheck`. Expected: PASS.

- [ ] **Step 5: Commit** `Draft: risk read and staff-vs-consensus gaps`.

### Task 3: Move the draft tab to its own screen

**Files:**
- Create: `src/ui/screens/Draft.tsx`
- Modify: `src/ui/screens/FrontOffice.tsx` (remove `Draft`, `YourPicks`, `DraftHistory`, `BoardDrillCell`,
  `BoardMakeup`, `BoardHabits`, `BOARD_*`, `isTimed`, `myBoardValue`; import `Draft`), `src/ui/ui.test.ts:405-418`

**Interfaces:**
- Produces: `export function Draft({ league }: { league: League })` in `Draft.tsx`; `PositionFilter` exported from
  `FrontOffice.tsx` (or moved to `components.tsx` if `FrontOffice` still uses it; keep one copy).

- [ ] **Step 1: Move** the code unchanged except imports; board uses `staffBoardValue` from `draftGrade.ts`.
- [ ] **Step 2: Update** the origins test: `Draft.tsx` replaces `FrontOffice.tsx` in the `OriginTag` list and the
  `label="School"` check (keep `FrontOffice.tsx` in the list only if it still renders `OriginTag`).
- [ ] **Step 3: Run** `npm run typecheck` and `npx vitest run src/ui/ui.test.ts`. Expected: PASS.
- [ ] **Step 4: Commit** `Draft tab moves to its own screen file (no change on screen)`.

### Task 4: Clock hero and staff's top 5

**Files:**
- Modify: `src/ui/screens/Draft.tsx`, `src/engine/draftGrade.ts`, `src/engine/draftGrade.test.ts`,
  `src/styles.css` (after `.board-sort`)

**Interfaces:**
- Consumes: `nextPick`, `draftOrder`, `availableProspects`, `reachOrSteal`; `riskOf`, `staffGaps`, `staffBoardValue`.
- Produces: `export function clockState(league: League): ClockState` in `draftGrade.ts`
  (`ClockState = { kind: 'none' } | { kind: 'preview'; prospects: number; firstPick?: DraftPick } | { kind: 'live';
  pick: DraftPick; userUp: boolean; myNext?: DraftPick } | { kind: 'done' }`); in `Draft.tsx`: `DraftClock`, `StaffTop5`, `RiskBar({ risk })`, `GapPill({ gap })` (used again in
  Task 5).

- [ ] **Step 1: Write the failing test** in `src/engine/draftGrade.test.ts` (`ui.test.ts` has no render helper, so
  the hero's state is a pure function): `clockState(league)` returns `{ kind: 'none' }` for a new league in the regular
  season with an empty `draftClass`; `{ kind: 'preview', prospects: n }` once a class exists outside the draft phase;
  `{ kind: 'live', userUp: true }` in the draft phase with the user's pick next; `{ kind: 'done' }` when every pick
  is in.
- [ ] **Step 2: Run** `npx vitest run src/engine/draftGrade.test.ts`. Expected: FAIL (`clockState` missing).
- [ ] **Step 3: Implement** `clockState`, then per spec "Layout" 1–2: `home-grid` wrapper; `DraftClock` (`.draft-clock`, `.is-up`
  gold border via the existing accent token, large `TeamChip`, "Round r · Pick n", ticker of the last three picks,
  `facts` row, actions as today); pre-draft variant with *Prospects*, *Your first pick*, *Scouting visits left*;
  `StaffTop5` as `.prospect-cards` (CSS grid, `repeat(auto-fill, minmax(180px, 1fr))`), each card with
  `PlayerLink avatar={28}`, position, `Ovr`, `RiskBar`, `GapPill`, Draft button when up. `RiskBar`: a track on the 1–20
  scale with a solid fill `lo→mid` and a faded fill `mid→hi`, the word under it when set, `title` giving the range in
  words; `aria-label` "Now 11, could reach 15".
- [ ] **Step 4: Run** `npm run typecheck` and `npx vitest run src/engine/draftGrade.test.ts src/ui/ui.test.ts`.
  Expected: PASS.
- [ ] **Step 5: Commit** `Draft room: on-the-clock hero and your staff's top 5`.

### Task 5: The slimmer big board

**Files:**
- Modify: `src/ui/screens/Draft.tsx`, `src/styles.css`

- [ ] **Step 1: Implement** spec "Layout" 3: columns Player (rank in sticky cell), Pos, School, Drill, Your grade,
  Risk (`RiskBar`, sort key `ceiling` on `potMid`), Consensus (`GapPill`, sort key `gap` on `diff`), Known, Notes
  (`BoardMakeup` then `BoardHabits`, one pill each), actions. Drop Age and Stars (and the `age`/`stars` sort keys).
  Rewrite "How to read the board" for Risk, Consensus pills and Notes in two or three sentences.
- [ ] **Step 2: Run** `npm run typecheck` and `npx vitest run src/ui/ui.test.ts`. Expected: PASS.
- [ ] **Step 3: Commit** `Draft room: big board with risk bars and consensus pills`.

### Task 6: Verdicts in history and your picks

**Files:**
- Modify: `src/ui/screens/Draft.tsx`, `src/styles.css`

**Interfaces:**
- Consumes: `pickMark`, `PickVerdict`.
- Produces: `VerdictPill({ mark })`.

- [ ] **Step 1: Implement:** `VerdictPill` (`tag-pill` + `tag-good` steal, plain hit, `tag-bad` miss; provisional
  adds `.is-early` (faded, dashed) and `title="Early read: locks after his third season"`; too early is a grey
  "Too early"). Draft history gets a sortable Verdict column (`useSort`/`SortTh`, order steal, hit, miss, too early)
  after Player; reach/steal pill stays. `YourPicks` adds a line per past draft year with locked marks
  ("2027: 1 steal, 2 hits, 3 misses", counts of zero left out). Layout: `YourPicks` `span-4`, `DraftHistory` `span-8`.
- [ ] **Step 2: Run** `npm run typecheck` and `npx vitest run src/ui/ui.test.ts src/engine/draftGrade.test.ts`.
  Expected: PASS.
- [ ] **Step 3: Commit** `Draft room: hit, miss and steal marks on past picks`.

### Task 7: Version, screenshots, push

**Files:**
- Modify: `package.json` (0.2.11), `src/ui/changelog.ts` (new first entry, dated 2026-10-28, "The draft room")

- [ ] **Step 1:** Bump, write the changelog entry (a player's words: the war room, risk, sleepers and fades, how your
  picks turned out), `npm run format`, `npm run typecheck`.
- [ ] **Step 2: Screenshots** with the pre-installed Playwright against `npm run dev`: a league before the draft, on
  the clock (sim to the user's pick), and three seasons on with marks in history; desktop and phone width (390px).
  Save to the scratchpad and send to the owner.
- [ ] **Step 3: Commit and push** to `claude/quirky-fermi-nuozfp`. Open the PR only after the owner approves the
  screenshots.
