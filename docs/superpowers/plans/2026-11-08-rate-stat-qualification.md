# Rate-stat qualification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every place that ranks a rate stat reads one set of minimums, per team game for a season and a career total
for a career, so a 2-for-2 backup never leads, and the awards lose their 200-attempt cliff.

**Architecture:** A new pure module `src/engine/qualify.ts` holds the table of rates (volume, per-team-game minimum,
career minimum) and the tests on it. The Leaders/Records boards (`stats.ts`), the Stats screen's tables, the awards and
the rookie report call it instead of their own floors. New rate boards are added to `LEADER_CATEGORIES`.

**Tech Stack:** TypeScript, Vitest, React (the Stats screen).

**Spec:** `docs/superpowers/specs/2026-11-08-rate-stat-qualification-design.md`

## Global Constraints

- Minimums, exactly: passing 14 att./team game, career 1,500; rushing 6.25 carries, career 750; receiving 1.875
  catches, career 200; field goals 1 FGA, career 100; punting 2 punts, career 250; kick returns and punt returns 1
  return each, career 75. Career also needs 64 games played.
- Team games = regular-season games with a result that his season's club played (`statTeams[season].at(-1)`, else
  `player.teamId`); a player with neither is measured against 17 (`SEASON_GAMES`).
- Zero volume never qualifies.
- A player below the minimum keeps every number on every screen; he only can't lead a board or top a sorted rate column.
- The engine draws nothing new: no `Rng`, no `Math.random`. `League` shape unchanged (no save bump).
- `MIN_GAMES` (10) for the season awards stays.
- Version 0.4.16 (`docs/VERSIONING.md`: a follow-up, last number); a changelog entry in a player's words.
- `npm run format` before each commit; local runs are typecheck and the touched tests only (CLAUDE.md).

## Review Focus

1. A rate board early in a season (week 1–2): every listed man qualifies against 1–2 team games; a club on its bye is
   one game behind and measured against its own count. Test in Task 1 (two team games) and Task 2 (a board after week 2).
2. A player traded mid-season: measured against the club he finished with, on his whole season's line. Test in Task 1.
3. A free agent with a season line and no club (cut after playing): measured against 17, never divides by zero. Test in Task 1.
4. Records across seasons: a past season always reads its own team games (17), not this season's count. Test in Task 2.
5. An award race where the best quarterback sits at 199 attempts: his score is continuous with 200 (no jump). Test in Task 4.

---

### Task 1: The rules (`qualify.ts`)

**Files:**
- Create: `src/engine/qualify.ts`
- Test: `src/engine/qualify.test.ts`

**Interfaces:**
- Consumes: `StatLine`, `Player`, `League` (`types.ts`); `StatScope` (`stats.ts`: `number | 'career'`); `SEASON_GAMES`.
- Produces:
  - `export type RateKey = 'passing' | 'rushing' | 'receiving' | 'kicking' | 'punting' | 'kickReturns' | 'puntReturns'`
  - `export interface Rate { key: RateKey; volume: (s: StatLine) => number; perGame: number; career: number; unit: string }`
  - `export const RATES: Record<RateKey, Rate>` (volumes `passAtt`, `rushAtt`, `rec`, `fgAtt`, `punts`, `krAtt`,
    `prAtt`; units `'att.'`, `'carries'`, `'catches'`, `'FGA'`, `'punts'`, `'returns'`, `'returns'`)
  - `export const CAREER_GAMES = 64`
  - `export function teamGames(league: League, player: Player, season: number): number`
  - `export function qualifies(league: League, player: Player, line: StatLine, scope: StatScope, rate: Rate): boolean`
  - `export function periodQualifies(line: StatLine, games: number, rate: Rate): boolean`
  - `export function minimumText(rate: Rate, scope: StatScope): string` — `"14 att. per team game"`,
    `"1,500 att. career"` (per-game minimums printed as given: `6.25`, `1.875`).

- [ ] **Step 1: Write the failing tests** in `qualify.test.ts`, on a fresh `createLeague({ seed: 'qualify' })` with
  results written onto its first games by hand (or played with `playWeek`), and built `StatLine`s:
  - `a 2-for-2 passer never qualifies`: `{ passAtt: 2, passCmp: 2, gp: 1 }` → false after 2 team games and after 17.
  - `early season: 28 attempts after two team games, not 27`: true at 28, false at 27.
  - `measured against his team's games, not his own`: a line with `gp: 1, passAtt: 20` on a club with 5 team games → false.
  - `a traded player is measured against the club he finished with`: `statTeams[season] = [a, b]`, club b has played 3,
    club a 4 → the minimum is 42 attempts.
  - `a free agent with no club is measured against 17`: `teamId: null`, no `statTeams` → `teamGames === 17`.
  - `career needs the total and 64 games`: 1,499 att./80 gp false; 1,500/63 false; 1,500/64 true.
  - `zero volume never qualifies`: `{}` with 0 team games → false.
  - `periodQualifies`: `{ passAtt: 14 }` over 1 game true, 13 false; over 4 games 56 true.
  - `minimumText`: `minimumText(RATES.passing, 2026) === '14 att. per team game'`,
    `minimumText(RATES.passing, 'career') === '1,500 att. career'`.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/engine/qualify.test.ts` → cannot find module `./qualify`.

- [ ] **Step 3: Implement `qualify.ts`** with the Interfaces above and the Global Constraints' values. Team games count
  `league.games` with `g.season === season && !g.playoffRound && g.result` for the club. The header comment cites the
  spec, PFR for the three NFL rows and "the game's own (the owner's call)" for the rest.

- [ ] **Step 4: Run, expect PASS** — same command, all tests green; `npm run typecheck` clean.

- [ ] **Step 5: Commit** — `git add src/engine/qualify.ts src/engine/qualify.test.ts && git commit -m "Rate stats: one table of minimums per team game and career (qualify.ts)"`

### Task 2: The boards (`stats.ts`)

**Files:**
- Modify: `src/engine/stats.ts` (`LeaderCategory`, `LEADER_CATEGORIES`, `leaders`, `seasonRecords`)
- Test: `src/engine/stats.test.ts`

**Interfaces:**
- Consumes: Task 1's `RATES`, `RateKey`, `qualifies`.
- Produces: `LeaderCategory.rate?: RateKey` replaces `qualifies`; categories keyed `rating` (kept), `cmpPct`, `ypa`,
  `ypc`, `ypr`, `fgPct`, `puntAvg`. `leaders()` and `seasonRecords()` keep their signatures.

- [ ] **Step 1: Write the failing tests** in `stats.test.ts`, on a league played to week 2 (`playWeek` twice) and one
  played to season's end:
  - `a 2-for-2 backup is on no rate board`: give a backup QB `{ passAtt: 2, passCmp: 2, passYds: 60, passTd: 1, gp: 1 }`
    in this season's stats; for every category with a `rate`, `leaders(...)` never lists him.
  - `every rate board's men qualify after week 2`: for each rate category, each row satisfies
    `qualifies(league, row.player, row.line, league.season, RATES[cat.rate!])`.
  - `the new boards exist`: `LEADER_CATEGORIES.map((c) => c.key)` contains `cmpPct`, `ypa`, `ypc`, `ypr`, `fgPct`,
    `puntAvg`, `rating`.
  - `records read each season against its own games`: after a full season, every `seasonRecords(league, cat)` row of a
    rate category qualifies for its `row.season`.
  - `ties break by player id`: two built lines with equal passer rating → the lower id first.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/engine/stats.test.ts` → missing keys / the backup listed.

- [ ] **Step 3: Implement.** `leaders(league, category, limit, scope)` filters with
  `qualifies(league, player, line, scope, RATES[category.rate])` when `category.rate` is set; sort ties by `player.id`.
  `seasonRecords` passes each row's `season` as the scope; ties by season, then id. New categories (format one
  decimal, percentages one decimal with `%`): completion % `passCmp/passAtt*100` (`passing`), yards an attempt
  `passYds/passAtt` (`passing`), yards a carry `rushYds/rushAtt` (`rushing`), yards a catch `recYds/rec` (`receiving`),
  field-goal % `fgMade/fgAtt*100` (`kicking`), punt average `puntYds/punts` (`punting`); passer rating gets
  `rate: 'passing'`. Labels: "Completion %", "Yards per attempt", "Yards per carry", "Yards per catch", "Field goal %",
  "Punt average". Fix any other caller of `LeaderCategory.qualifies` the typecheck finds.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/engine/stats.test.ts src/engine/qualify.test.ts`; typecheck.

- [ ] **Step 5: Commit** — `git commit -m "Rate boards: qualified per team game, six new boards, ties by id"`

### Task 3: The Stats screen

**Files:**
- Modify: `src/ui/screens/Stats.tsx` (`Leaders`, the Records tab, `StatCol`, `StatTable`, `PlayerStats`)
- Test: `src/ui/ui.test.ts` (or the Stats screen's own test file if one exists)

**Interfaces:**
- Consumes: `RATES`, `RateKey`, `qualifies`, `minimumText` (Task 1); `LeaderCategory.rate` (Task 2).
- Produces: `StatCol.rate?: RateKey` replaces `rate?: boolean`; `StatTable.qualifies` is removed.

- [ ] **Step 1: Write the failing tests:**
  - `a rate board shows its minimum`: render the Leaders tab for a season; the passer-rating panel contains
    `14 att. per team game`; for the career scope, `1,500 att. career`.
  - `a low-volume backup sorts below qualified passers`: with the 2-for-2 backup from Task 2, sorting the Passing table
    by rating (desc and asc) never puts him above a qualified passer; his row still shows his real rating.
  - The existing screen-contract tests stay green with the new boards.

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/ui/ui.test.ts` (and the new test's file).

- [ ] **Step 3: Implement.** Each rate column names its `RateKey` (`pct`, `ya`, `rating` → `passing`; `ypc` →
  `rushing`; `ypr` → `receiving`; `fgPct` → `kicking`; punting `avg` → `punting`; `krAvg` → `kickReturns`; `prAvg` →
  `puntReturns`). The sort pushes a row to the bottom when `qualifies(league, p, s, scope, RATES[col.rate])` is false.
  Leader and Records panels show `minimumText(RATES[cat.rate], scope)` (Records: the season form) as a muted line under
  the title. The table hint reads: "Averages and percentages rank qualified players first: " followed by the shown
  table's minimums (`minimumText` for each rate it holds).

- [ ] **Step 4: Run, expect PASS** — same tests; `npm run typecheck`.

- [ ] **Step 5: Commit** — `git commit -m "Stats screen: rate columns and boards read the shared minimums and show them"`

### Task 4: Awards

**Files:**
- Modify: `src/engine/awards.ts` (`qbBonus`, `positionScore` for K and P, `pickAwards`, `pickPeriod`)
- Test: `src/engine/awards.test.ts`

**Interfaces:**
- Consumes: `RATES`, `qualifies`, `periodQualifies` (Task 1).
- Produces: `qbBonus(s: StatLine, rated: boolean): number` =
  `((rated ? passerRating(s) : 92) - 92) * 1.2`; `positionScore(pos, s, qualified: (rate: RateKey) => boolean)`.

- [ ] **Step 1: Write the failing tests:**
  - `no cliff at 200 attempts`: on a league whose clubs have played 11 games (minimum 154 attempts), a QB with 199
    attempts and a 110 rating gets `qbTerm(...) ≈ (110 − 92) × 1.2` (today: the flat −14.4), and one with 150 attempts
    (unqualified) gets 0; `qbBonus(line, false) === 0`. `qbTerm(league, player, line, season): number` is exported
    from `awards.ts` for this test and used by `pickAwards`.
  - `a weekly honor's QB score moves with his rating`: two one-game QB lines, both 20+ attempts, ratings 120 and 70 →
    the 120 one scores higher in `pickPeriod`'s QB term (test through a small built week, or export the scoring helper).
  - `kickers and punters qualify per team game`: a kicker with 16 FGA over 17 team games scores > 0; with 12 he scores 0;
    a punter with 34 punts > 0, 30 → 0 (17 team games: 2 × 17 = 34).

- [ ] **Step 2: Run, expect FAIL** — `npx vitest run src/engine/awards.test.ts`.

- [ ] **Step 3: Implement.** Season awards: `rated = qualifies(league, player, line, season, RATES.passing)`.
  `pickPeriod`: `rated = periodQualifies(e.line, e.played, RATES.passing)`. K and P: the 15-FGA and 30-punt floors
  become `qualified('kicking')` and `qualified('punting')`, built from `qualifies(league, player, line, season, …)`.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/engine/awards.test.ts src/engine/qualify.test.ts`; typecheck.

- [ ] **Step 5: Commit** — `git commit -m "Awards: passer rating counts once he qualifies (no 200-attempt cliff, weekly honors too); K and P per team game"`

### Task 5: Rookie report, docs, version

**Files:**
- Modify: `src/engine/rookieReport.ts` (`rate`, its caller at line ~113)
- Modify: `docs/MVP.md` (the rate-stat follow-up line), `package.json` (0.4.16), `src/ui/changelog.ts`
- Test: a new `src/engine/rookieReport.test.ts`, or the existing test that covers `rookieImpactMail` if there is one

**Interfaces:**
- Consumes: `RATES`, `qualifies` (Task 1).
- Produces: `rate(l: League, p: Player, s: StatLine)`; the passer-rating and yards-a-carry branches use
  `qualifies(l, p, s, l.season, RATES.passing | RATES.rushing)` in place of 100 attempts and 40 carries. The
  per-100-snaps branches and their 200-snap floor stay.

- [ ] **Step 1: Write the failing test** `a rookie quarterback's rating compares once he qualifies`: a rookie QB line
  of 90 attempts over 6 team games (minimum 84) gets a passer-rating comparison; 80 attempts doesn't. (Under today's
  rule both get none.)

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement**, then: tick the MVP line ("**Done (0.4.16):** …" naming `qualify.ts`, the boards, the
  table, awards and the rookie report); `package.json` 0.4.16; a changelog entry titled "Leaders who played enough":
  rate leaders need their team's games' worth of attempts, new boards (completion %, yards per attempt, per carry, per
  catch, field goal %, punt average), and award voters weigh a quarterback's rating once he's played enough.

- [ ] **Step 4: Run, expect PASS** — `npx vitest run src/engine/qualify.test.ts src/engine/stats.test.ts src/engine/awards.test.ts src/ui/changelog.test.ts` plus the rookie test; `npm run typecheck`; `npm run format`.

- [ ] **Step 5: Commit** — `git commit -m "Rookie report reads the shared minimums; 0.4.16 (MVP, changelog)"`
