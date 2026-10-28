# Draft Busts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A young player's true ceiling settles over his first three seasons (tilted by work ethic, how he played
against players rated like him, his snaps and his coaches), so about a third of first-rounders bust and some Day 3
picks break out, and the user sees it through the staff's read, the mail and the scout report.

**Architecture:** A new pure module, `src/engine/ceiling.ts`, rolls the shift on its own stream when a player's team
finishes its season (`league.ts`), with a fallback at the new league year. `development.ts` owns the swing table and
keeps the ceiling each year was rolled with, so stepped release stays exact. `scouting.ts` widens a young player's
ceiling range by the swing still to come and adds one report sentence; `inbox.ts` sends one message per moved read.
`npm run careers` gains bust and steal rows, and the class's starting ceiling spread is retuned to hold league talent.

**Tech Stack:** TypeScript, Vitest, the project's seeded `Rng`, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-10-27-draft-busts-design.md`

## Global Constraints

- No `Math.random`: every draw goes through `Rng`; the settle's stream is `` `${seed}:ceiling:${season}:${id}` `` and no
  other stream gains or loses a draw.
- Eligible: under 26 and `experience` 0, 1 or 2 in the season being settled. Settles once a season
  (`ceilingShifts[season]` present means done).
- `SWING` by year in the league: `[1.6, 1.1, 0.6]`. Lean parts: work ethic about ±0.8 at the trait's extremes, play
  ±0.4, snaps +0.1 starter / −0.15 barely played, coaching `0.5 × (rate − 1)`.
- Shift rounded to a tenth; ceiling capped at 20; may fall below current overall; no rating is ever lowered by it.
- `League` stays plain JSON. `SAVE_VERSION` 56 → 57 with a no-op step in `migrate.ts`.
- Fog of war: no screen reads `ceilingShifts` or `.potential`; mail and report conditions read `perceive`, never the
  true shift.
- Careers ranges: first-round bust 25–40%, Day 3 (rounds 4–7) reaching solid starter 8–20%. Never loosen a range to
  get green.
- Version 0.2.7 → 0.2.8 with a `src/ui/changelog.ts` entry; `docs/MVP.md` item 9 gains a clause; `npm run format`
  before each commit.
- Per CLAUDE.md, a session runs `npm run typecheck`, the touched tests and the area's script at a small size; CI runs
  the full checks.

## Review Focus

1. **A rookie on a playoff team with a first-round bye** must not settle at week 18 (he has no wild-card game but is
   still alive). Test in Task 4.
2. **A player cut or traded after week 18** settles exactly once, with whichever status he has when the next settle
   pass runs. Test in Task 4.
3. **A save loaded mid-season from v56** (open `DevYear` without `potential`, no `ceilingShifts`) keeps developing
   exactly as before and settles at its next season end. Test in Task 2.
4. **Draft board stars and scout-report verdicts** don't all jump for prospects once their range widens: the verdict
   reads the range without the unsettled part. Test in Task 5.
5. **Positions without a production rule (TE, EDGE, S) and players with too few snaps** get a play lean of 0, not NaN.
   Test in Task 3.

---

### Task 1: Research note

**Files:**
- Create: `docs/research/draft-outcomes.md`

- [ ] **Step 1: Write the note.** NFL first-round and Day 3 outcome rates with each source's definition, and the two
  ranges this project uses and why ("solid starter" = 30th percentile of starters at the position by 27). Sources:
  RotoWire draft pick value study (2000–2024, bust = ≤1 full season started; pick 5 bust 13%); Deephaven 2026 (OL 22%
  first-round bust, QBs about 45%); RotoBaller (picks 21–32 bust 29.2%); Windy City Gridiron draft research project
  (2011–2020, about 10% of Day 3 picks reach 40 starts in five years); Blogging the Boys (2010–2025, 23.1% of rounds
  5–7 start eight games in a season). Link each.
- [ ] **Step 2: Format and commit.** `npx prettier --write docs/research/draft-outcomes.md`, then
  `git commit -m "Research: NFL draft outcome rates"`.

### Task 2: The swing table and a year that keeps its ceiling

**Files:**
- Modify: `src/engine/types.ts` (`Player`, `DevYear` at ~255)
- Modify: `src/engine/development.ts` (`beginYear` ~205, `yearTargets` ~233)
- Modify: `src/engine/generate.ts:49` (`SAVE_VERSION`), `src/engine/migrate.ts` (~181)
- Test: `src/engine/release.test.ts`

**Interfaces:**
- Produces: `CEILING_SWING: readonly number[]` (`[1.6, 1.1, 0.6]`); `settleYear(p: Player, season: number): number | null`
  (index into `CEILING_SWING` for the season's settle, or null when ineligible: age ≥ 26 or experience > 2);
  `unsettledSpread(p: Player, season: number): number` (root-sum-square of the `CEILING_SWING` entries still to come,
  counting this season's only while `ceilingShifts?.[season]` is absent; 0 when ineligible).
  `Player.ceilingShifts?: Record<number, number>`; `DevYear.potential?: number`.

- [ ] **Step 1: Write the failing tests** in `release.test.ts`:
  - `a year rolled before its ceiling settles lands, in steps, where one jump would`: roll a 22-year-old's year with
    `beginYear` at the default split, then raise `p.potential` by 2 (and on a copy lower it by 2), release the rest
    with `developBlock`/`trueUp`, and expect ratings equal to `developPlayer` on the same stream with the original
    potential.
  - `an open year from a v56 save reads the player's ceiling`: delete `p.dev!.potential`, and the remainder lands as it
    did before this change (targets equal `yearTargets` computed with `p.potential`).
  - `unsettledSpread`: a rookie before his settle → `Math.hypot(1.6, 1.1, 0.6)`; after `ceilingShifts[season] = 0` →
    `Math.hypot(1.1, 0.6)`; experience 3 or age 26 → 0.
- [ ] **Step 2: Run** `npx vitest run src/engine/release.test.ts` and expect the new tests to fail.
- [ ] **Step 3: Implement.** `beginYear` stores `potential: p.potential` in `p.dev` when `p.age < 26`; `yearTargets`
  builds `rolled` with `d.potential ?? p.potential`. Add the two optional fields with doc comments, the exports above
  in `development.ts`, `SAVE_VERSION = 57`, and `if (league.version < 57) league.version = 57;` with a comment
  ("v57: optional `Player.ceilingShifts` and `DevYear.potential`; old open years read the player's ceiling").
- [ ] **Step 4: Run** the release tests and `npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit** "Development: a year keeps the ceiling it was rolled with (save v57)".

### Task 3: The settle

**Files:**
- Create: `src/engine/ceiling.ts`, `src/engine/ceiling.test.ts`
- Modify: `src/engine/scouting.ts` (export the production rule: `export function productionRule(pos: Position):
  Production | undefined` and `export type { Production }`, ~911)

**Interfaces:**
- Consumes: `settleYear`, `CEILING_SWING` (Task 2); `seasonRole(league, p, season)`, `productionRule`; `coachingForPlayer`
  (`coaching.ts`); `TRAIT_MEAN` (`traits.ts`).
- Produces:
  - `ceilingShift(rng: Rng, year: number, lean: number): number`: `rng.normal(lean, CEILING_SWING[year])` rounded to a
    tenth. Pure; the careers cohort uses it too.
  - `playLean(league: League, p: Player, season: number, peers: PeerTable): number`, in −0.4…0.4.
  - `type PeerTable = Map<Position, { ovr: number; measure: number }[]>`; `peerTable(league: League, season: number):
    PeerTable`: every player with `stats[season]` passing `rule.enough`, his overall at the season's start
    (`ratingHistory[season]`, else today's) and `rule.measure`.
  - `ceilingLean(league: League, p: Player, season: number, peers: PeerTable): number`: work ethic
    `0.085 × (workEthic − TRAIT_MEAN)` + `playLean` + snaps (`seasonRole` starter +0.1, rotation 0, backup or null
    −0.15; for a position with no rule, `playedShare` ≥ 0.6 → +0.1, < 0.2 → −0.15) + `0.5 × (rate − 1)`.
  - `settleCeiling(league: League, p: Player, season: number, peers: PeerTable): boolean`: no-op (false) when
    `settleYear` is null or already settled; else shift, `p.potential = min(20, round1(p.potential + shift))`, store
    `ceilingShifts[season] = round1(applied change)`, true.

`playLean`'s rule: peers at his position within ±1 of his start overall, widened by 0.5 up to ±3 until there are 8;
fewer than 8 at ±3, no rule, or `!rule.enough(s)` → 0. Gap = (his measure − peer mean) / `rule.step`, negated when
`lowIsGood`, clamped to ±2, × 0.2.

- [ ] **Step 1: Write the failing tests** in `ceiling.test.ts` (a `createLeague({ seed })` league; set `stats`,
  `traits`, `experience`, `age` on a real player):
  - `the same seed settles the same shift` and `settles once a season` (second call returns false, potential
    unchanged).
  - `skips players 26 and over and players past their third year`.
  - `the play lean reads peers, not the league`: two QBs with the same line, start overall 10 and 14 (peer table built
    from synthetic peers), lean > 0 for the 10 and < 0 for the 14.
  - `positions without a rule and short seasons lean 0 on play` (a TE; a QB under `enough`), and `Number.isFinite`.
  - `high work ethic settles above low`: mean shift over 400 seeds, workEthic 18 vs 3, differs by > 1.
  - `the ceiling can fall below his overall, and no rating moves`.
- [ ] **Step 2: Run** `npx vitest run src/engine/ceiling.test.ts` and expect FAIL (module missing).
- [ ] **Step 3: Implement** `ceiling.ts` with a header comment that says why (busts and breakouts settle in the league;
  their own stream), and the `productionRule` export.
- [ ] **Step 4: Run** the test file and `npm run typecheck` and expect PASS.
- [ ] **Step 5: Commit** "Ceilings settle in the league: the roll and its lean".

### Task 4: When a team's season ends

**Files:**
- Modify: `src/engine/ceiling.ts`, `src/engine/league.ts` (`playWeekControlled` ~186–192),
  `src/engine/offseason/index.ts` (before the development loop, ~104)
- Test: `src/engine/ceiling.test.ts`

**Interfaces:**
- Consumes: `settleCeiling`, `peerTable` (Task 3); `allSeeds`, `playoffGames`, `winnerOf` (`season/playoffs.ts`).
- Produces: `seasonOver(league: League, teamId: number | null, alive: Set<number>): boolean` and
  `settleFinished(league: League): void`: during `regular` nothing; in `playoffs` every unretired player whose team is
  out (not seeded, or lost a played playoff game) or who has no team; in `complete` (or at the new league year's
  fallback, for `league.season - 1`) everyone. Builds the peer table once per call.

- [ ] **Step 1: Write the failing tests**:
  - `week 18 settles the teams out of the playoffs, not a bye team`: sim to the end of the regular season; a rookie on
    a non-playoff team has `ceilingShifts[season]`; a rookie on a seed-1 team doesn't.
  - `the playoffs settle each loser and the final settles the rest`: after `simToEndOfSeason`, every eligible player has
    an entry, each settled once (count calls through a spy or check potentials against a replay).
  - `a player cut after week 18 settles once`.
  - `the new league year settles anyone left`: delete one shift after the final, run `beginOffseason`, and it is back
    with the same value.
- [ ] **Step 2: Run** and expect FAIL.
- [ ] **Step 3: Implement.** Call `settleFinished(league)` after `scheduleNextRound` when the regular season ends, and
  after each playoff week (after `finishSeason` too); in `beginOffseason`, settle `league.season - 1` for anyone
  eligible before `trueUp`/`beginYear` (that season's `experience`, before it ticks).
- [ ] **Step 4: Run** the tests, `npx vitest run src/engine/release.test.ts src/engine/development.test.ts`, and
  `npm run sim -- 10`; expect PASS and league stats in range.
- [ ] **Step 5: Commit** "Ceilings settle when a team's season ends".

### Task 5: The staff's read

**Files:**
- Modify: `src/engine/scouting.ts` (`PlayerView` ~116, `perceive` ~204, `scoutReportParts` ~1199)
- Test: `src/engine/scouting.test.ts`

**Interfaces:**
- Consumes: `unsettledSpread` (Task 2).
- Produces: `PlayerView.potHiRead: number` (the ceiling's top before the unsettled widening); `settleNote(league:
  League, teamId: number, p: Player, view: PlayerView): string | null`.

`perceive`: with `w = unsettledSpread(p, league.season)`, the half-width becomes `Math.hypot(u, w)` for `potLo`/`potHi`
(centre, `potMid` and `potSd`'s noise unchanged). `potHiRead` is the hi without `w`, equal to `potHi` for anyone not
settling. The report's `ceiling` tier reads `potHiRead`.

`settleNote` (a note, through `rng`-free conditions): experience 0 → "Still a projection: his first season will tell
us a lot about his ceiling." Experience 1–2 and the read moved a point or more since he came in (`perceive` on
`{ ...p, potential: p.potential − Σ ceilingShifts }` vs now) → "His ceiling read has come down since he came into the
league." / "…has gone up since he came into the league." Experience 2 otherwise → "His ceiling looks about settled."
Else null.

- [ ] **Step 1: Write the failing tests**:
  - `a rookie's ceiling range is wider than a settled player's, centred the same`.
  - `the verdict reads the range without the unsettled part`: a prospect's `scoutReportParts` verdict is the same with
    `unsettledSpread` forced to 0 (stub via the player's experience = 3 on a copy with all else equal).
  - `settleNote` wording for each case, and null for a 27-year-old.
- [ ] **Step 2: Run** `npx vitest run src/engine/scouting.test.ts` and expect FAIL.
- [ ] **Step 3: Implement** and push `settleNote` into `notes` when not null.
- [ ] **Step 4: Run** the scouting tests, `npx vitest run src/ui/ui.test.ts`, and `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** "Scouting: a young player's ceiling range carries what is still to settle".

### Task 6: The mail

**Files:**
- Modify: `src/engine/inbox.ts` (a `ceilingMail` beside `positionMovedMail` ~2454; `deliverMail` ~2835;
  `mailSubject` ~935), `src/engine/types.ts` (the `MailSubject` union), `src/ui/ui.test.ts:400` (add
  `\bceilingShifts\b` to the truth pattern)
- Test: `src/engine/inbox.test.ts`

**Interfaces:**
- Consumes: `perceive`; `ceilingShifts`.
- Produces: mail id `ceiling:${season}:${playerId}`, subject kind `{ kind: 'ceiling'; season; playerId }`.

In `playoffs`, `complete` and `resign`: for each user player with `ceilingShifts[season]`, `moved = perceive(now).potMid
− perceive({ ...p, potential: p.potential − shift }).potMid`; `|moved| ≥ 1` sends one message. Down, from `headCoach`,
`category: 'staff'`, subject `${fullName(p)} has hit a wall`, body "He's hit a wall. What you see now is about what
you'll get from him." Up, from `director`, subject `${fullName(p)} is outplaying his grades`, body "He's outplaying his
grades. We may have had his ceiling too low." Actions: the player, then the team.

- [ ] **Step 1: Write the failing tests**: one message when the read drops by a point (head coach) and one when it
  rises (director); none under a point; none for another team's player; filed once (a second `deliverMail` adds
  nothing); `mailSubject` reads the id back.
- [ ] **Step 2: Run** `npx vitest run src/engine/inbox.test.ts` and expect FAIL.
- [ ] **Step 3: Implement** (and whatever `MailSubject` consumers TypeScript flags, `needsYou` returning false).
- [ ] **Step 4: Run** inbox, `src/ui/mail.test.tsx`, `src/ui/ui.test.ts`, `npm run typecheck`; expect PASS.
- [ ] **Step 5: Commit** "Mail: the coach or director when a young player's ceiling read moves".

### Task 7: Measure, retune, ship

**Files:**
- Modify: `scripts/careers-league.ts`, `scripts/careers.ts` (cohort ceiling ~97, Part 2 report),
  `src/engine/offseason/draft.ts:58` (`growth`), `src/engine/offseason/arrivals.ts:68`, `docs/MVP.md` (item 9),
  `CLAUDE.md` (the `development.ts` line: ceilings settle in `ceiling.ts`), `package.json` (0.2.8), `src/ui/changelog.ts`

**Interfaces:**
- Consumes: `ceilingShift` (Task 3), `p.draft`, `ceilingShifts`.
- Produces: `LeagueRun.drafts: { round: number; hit: boolean }[]` (drafts held during the run whose players reached 27
  or retired before the run ended; `hit` = peak true overall by 27 ≥ that season's 30th-percentile starter at his
  position) and `LeagueRun.shifts: { year: number; shift: number; workEthic: number }[]`.

- [ ] **Step 1: Add the rows.** Careers prints `check('first-round busts %', …, 25, 40)`, `check('Day 3 solid starters
  %', …, 8, 20)`, `check('settle swing yr1 > yr2 > yr3', …)` (as 1/0), and work ethic top vs bottom third mean shift
  `> 0`. The cohort applies `ceilingShift` at 21, 22, 23 with the work-ethic lean and a starter's snaps.
- [ ] **Step 2: Run** `npm run careers -- 16` and note the misses (starter OVR by season will drift up).
- [ ] **Step 3: Retune** the class's `growth` (and the arrivals' range) until careers is clean and `npm run offseason
  -- 6` holds talent; if the bust rate misses, tune `SWING` and the lean weights in the spec's spirit, and write any
  changed numbers back into the spec.
- [ ] **Step 4: Run** `npm run typecheck`, `npx vitest run src/engine`, and `npm run format`; then update MVP item 9
  ("ceilings settle over a player's first three seasons, so first-rounders bust and Day 3 picks break out"), CLAUDE.md,
  the version and the changelog entry ("Draft busts and late bloomers").
- [ ] **Step 5: Commit and push** "Careers: bust and steal rates; class ceilings retuned (0.2.8)", then
  `git push -u origin claude/friendly-fermat-g1x4bv` and read CI.
