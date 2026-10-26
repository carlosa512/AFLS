# Gazette Numbers Desk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Count EPA, success and explosive plays (team and player) as games are played, and have the Arena Gazette
write a numbers column after weeks 4, 7, 10, 13 and 16, a playoff preview and a season wrap.

**Architecture:** `src/engine/analytics.ts` (pure measures: expected points, play EPA, success, explosive);
`match/gameSim.ts` counts them at the one point every scrimmage play resolves, reading each play's stat buffer for
attribution; `src/engine/gazette.ts` builds editions from the box scores; `inbox.ts` files them; `ui/mail.tsx` renders
the tables. Trajectory stories in `news.ts` retire into a story angle.

**Tech Stack:** TypeScript, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-gazette-numbers-design.md`

## Global Constraints

- The counting never moves play: no new RNG draws, no change to any decision. Seeded games must reproduce scores and
  box scores exactly (only new fields added).
- `League` stays plain JSON. `SAVE_VERSION` + 1 (52 if #87's v51 is on main, else 51) with a no-op `migrate.ts` step.
- Public facts only: box scores and standings; no ratings, no scouting. Never Needs you.
- Commands: `npm run typecheck`; touched tests; for `match/` changes `npm run sim -- 10` (and the CI planner's area
  checks on the PR). `npm run format` before each commit.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_011v2LBUCkesLYVVQ4bbGtKB`.
- Branch: start from the latest `main` after #87 merges (`git fetch origin main && git checkout -B
  claude/bold-cori-5pa4gm origin/main`), keeping nothing from merged history.

## Review Focus

1. A penalty that wipes out a play → nothing counted for it (team `adv.plays` unchanged). (Task 2 test.)
2. A pick-six or fumble return touchdown → large negative EPA for the offense, not a positive score credit. (Task 1.)
3. A two-point try or a kneel-down → not counted as a scrimmage play (kneels and spikes are excluded from rates).
   (Task 2.)
4. A save from before the upgrade mid-season → the week-7 column computes from the games that have `adv` only and
   says nothing it can't support (ranks need every club's sample). (Task 3 test.)
5. A long sim from week 2 to week 12 → no week-4/7/10 columns filed late. (Task 3 test.)

---

### Task 1: The measures

**Files:** Create `src/engine/analytics.ts`, `src/engine/analytics.test.ts`.

**Interfaces — Produces:**
- `expectedPoints(down: number, distance: number, yardLine: number): number`
- `interface PlayState { down: number; distance: number; yardLine: number; offense: 0 | 1; score: [number, number] }`
- `playEpa(before: PlayState, after: PlayState): number` (from `before.offense`'s side; scoring read from the score
  change, possession change from `offense`)
- `isSuccess(down: number, distance: number, gained: number, touchdown: boolean): boolean`
- `isExplosive(kind: 'run' | 'pass', gained: number, complete: boolean): boolean`

- [ ] **Step 1: Failing tests.**

```ts
it('anchors expected points on first and ten', () => {
  expect(expectedPoints(1, 10, 20)).toBeCloseTo(0.4, 2);
  expect(expectedPoints(1, 10, 50)).toBeCloseTo(2.0, 2);
  expect(expectedPoints(1, 10, 99)).toBeCloseTo(6.0, 2);
  for (let y = 2; y < 99; y++) expect(expectedPoints(1, 10, y)).toBeGreaterThan(expectedPoints(1, 10, y - 1));
  expect(expectedPoints(3, 8, 50)).toBeLessThan(expectedPoints(2, 8, 50));
  expect(expectedPoints(4, 1, 50)).toBeGreaterThan(expectedPoints(4, 10, 50));
});
it('prices plays', () => {
  const at = (down, distance, yardLine, offense = 0, score = [0, 0]) => ({ down, distance, yardLine, offense, score });
  expect(playEpa(at(1, 10, 25), at(2, 4, 31))).toBeCloseTo(expectedPoints(2, 4, 31) - expectedPoints(1, 10, 25));
  expect(playEpa(at(1, 10, 80), at(1, 10, 25, 1, [7, 0]))).toBeCloseTo(7 - expectedPoints(1, 10, 80)); // TD
  expect(playEpa(at(4, 5, 70), at(1, 10, 25, 1, [3, 0]))).toBeCloseTo(3 - expectedPoints(4, 5, 70)); // FG
  expect(playEpa(at(1, 10, 60), at(1, 10, 40, 1))).toBeCloseTo(-expectedPoints(1, 10, 40) - expectedPoints(1, 10, 60)); // turnover
  expect(playEpa(at(2, 10, 30), at(1, 10, 25, 0, [0, 7]))).toBeLessThan(-6); // pick-six
  expect(playEpa(at(1, 10, 2), at(1, 10, 25, 1, [0, 2]))).toBeCloseTo(-2 - expectedPoints(1, 10, 2)); // safety
});
it('calls success and explosives the NFL way', () => {
  expect(isSuccess(1, 10, 4, false)).toBe(true);
  expect(isSuccess(1, 10, 3, false)).toBe(false);
  expect(isSuccess(2, 10, 6, false)).toBe(true);
  expect(isSuccess(3, 4, 3, false)).toBe(false);
  expect(isSuccess(3, 4, 2, true)).toBe(true);
  expect(isExplosive('run', 10, false)).toBe(true);
  expect(isExplosive('pass', 25, false)).toBe(false);
  expect(isExplosive('pass', 20, true)).toBe(true);
});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/analytics.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** per spec §1 (the anchors and down penalties as constants with a comment citing the NFL
  shape). Scoring: `points = (after.score[off] − before.score[off]) − (after.score[def] − before.score[def])`; if not
  0, EPA = points − EP(before); else same offense → EP(after) − EP(before); else −EP(after) − EP(before).
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** "Analytics: expected points, play EPA, success, explosives".

### Task 2: Counting in the engine

**Files:** Modify `src/engine/types.ts` (`STAT_KEYS` + `dropbacks`, `epa`, `successes`, `rushSnaps`;
`TeamGameStats.adv?`), `src/engine/match/gameSim.ts` (the play loop around `this.resolve(result)` ~line 1790;
`snap()` ~line 759 for `rushSnaps`), `src/engine/generate.ts`, `src/engine/migrate.ts`. Test: new
`src/engine/analyticsEngine.test.ts`.

**Interfaces — Produces:** `TeamGameStats.adv?: { plays; success; epa; explosive; dropbacks; passSuccess; passEpa;
rushes; rushSuccess; rushEpa; pressured }` (numbers); stat keys as named.

- [ ] **Step 1: Failing tests.**

```ts
it('counts every play that counted, and only those', () => {
  // play one seeded week
  for (const r of results) for (const side of [r.home, r.away]) expect(side.adv!.plays).toBe(side.plays);
});
it('counts dropbacks as attempts, sacks and QB scrambles', () => { /* per team: adv.dropbacks === passAtt + sacked + qbScrambles */ });
it('splits EPA between passers and rushers that sums to the team', () => { /* Σ over passers+designed rushers === adv.epa ± 1e-6 */ });
it('counts rush snaps only on dropbacks', () => { /* sum rushSnaps over a game ≤ dropbacks faced × 11 and > 0; a run-only probe gives 0 */ });
it('ignores a play a flag wiped out', () => { /* force a pre-snap false start via the existing penalty test helper; adv.plays unchanged */ });
```

  "Nothing about play changes" is proven once, not pinned in a test (a stored fingerprint would break on every later
  engine tuning): Step 4 compares `npm run sim -- 10` before and after.
- [ ] **Step 2: Run** the file. Expected: FAIL (`adv` undefined).
- [ ] **Step 3: Implement.** In the play loop: capture `PlayState` before (`s` + `this.offense` + `this.score`); after
  `this.resolve(result)`, if `this.teamStats[offSide].plays > beforePlays` and `result.kind` is not `kneel`/`spike`:
  gained = `result.yards`; epa = `playEpa(before, after)`; success by `isSuccess`; explosive by `isExplosive`;
  dropback = `kind` in pass/sack/scramble; add to `teamStats[offSide].adv`; credit `epa`/`successes` to the passer
  (dropback), the rusher (`run`), and the target (from `result.stats` entries with key `targets`); `dropbacks` to the
  passer; `pressured` when `result.stats` holds a `pressures` entry. In `snap()`: on `passing`, add `rushSnaps` to the
  defence's front (`EDGE`/`DT` on the field) and the rush rotation. Save bump + no-op migration.
- [ ] **Step 4: Run** the file, `npx vitest run src/engine/engine.test.ts src/engine/penalties.test.ts
  src/engine/quirks.test.ts`, `npm run typecheck`, and `npm run sim -- 10`. Expected: tests PASS; sim's existing lines
  unchanged from main's (paste both into the ledger).
- [ ] **Step 5: Commit** "Count EPA, success and explosives as games are played".

### Task 3: The editions

**Files:** Create `src/engine/gazette.ts`, `src/engine/gazette.test.ts`; modify `src/engine/types.ts`
(`InboxMessage.gazette?`).

**Interfaces — Produces:**
- `type Edition = 'w4' | 'w7' | 'w10' | 'w13' | 'w16' | 'preview' | 'wrap'`
- `editionAt(league: League): Edition | null` (w4 when every club has played 4 games and the latest week is the
  first such, and so on; preview when the regular season is complete; wrap when the final is played)
- `teamAdvanced(league, season, throughWeek?): Map<teamId, { off: Adv; def: Adv; games: number }>`
- `playerAdvanced(league, season): Map<playerId, { teamId; dropbacks; epa; successes; rushAtt; targets; rushSnaps; pressures; games }>`
- `gazetteFor(league: League): { edition; subject; body; tables: GazetteTable[] } | null`
- `interface GazetteTable { title: string; unit: string; rows: { teamId: number; playerId?: number; name: string; value: number; rank: number }[] }`
  (saved as `InboxMessage.gazette: { edition; tables }`)

- [ ] **Step 1: Failing tests** (build seasons by playing weeks of a seeded league; construct leaders by editing a
  club's `adv` totals where an angle needs it):

```ts
it('files each edition once, at its moment', () => { /* weeks 4,7,10,13,16 → w4..w16; week 5 → null; after week 18 → preview */ });
it('never files late after a long sim', () => { /* jump from week 2 to week 12: no w4/w7/w10 */ });
it('keeps players under the sample out of the tables', () => { /* a backup QB with 3 dropbacks never ranks */ });
it('always shows our club', () => { /* our row in every team table, marked */ });
it('picks the story by its conditions', () => {
  // a club leading EPA/play by a distance → subject names it; else our top-3 → names us; else a 10-place mover
});
it('changes themes between consecutive columns', () => { /* w4 and w7 share at most one theme */ });
it('reads a pre-upgrade save without inventing numbers', () => { /* strip adv from half the games: no rank unless every club has a sample */ });
```

- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** per spec §3: themes rotate by edition (w4 offense+passing; w7 defense+rushing; w10
  explosives+pass rush; w13 offense+situational; w16 passing+defense+pass rush; preview offense+defense; wrap all,
  leaders only); story rules 1–6 in order; closing line locating us; samples per spec. Numbers to two decimals for
  EPA, whole percent for rates.
- [ ] **Step 4: Run.** Expected: PASS.
- [ ] **Step 5: Commit** "Gazette editions: themes, samples and the story".

### Task 4: Filing and the card; trajectory stories retire

**Files:** Modify `src/engine/inbox.ts` (`deliverMail`: file `gazette:{season}:{edition}`; `mailSubject` `gazette`
kind), `src/engine/news.ts` (remove the trajectory branch; keep its `teamStatContext` helper only if still used),
`src/engine/news.test.ts`, `src/engine/inbox.test.ts`, `src/ui/mail.tsx` (`GazetteCards`), `src/ui/screens/Inbox.tsx`
(`KIND_TAGS.gazette = 'Numbers'`), `src/ui/mail.test.tsx`.

- [ ] **Step 1: Failing tests:** a season played through week 18 files w4, w7, w10, w13, w16 and the preview from
  "The Arena Gazette"; no `trajectory` ids; the card renders each table with `TeamLink`/`PlayerLink`, our row
  `is-user`, and the snapshot is unchanged after more games.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.** Filing works with or without a job (the league is public), never Needs you.
- [ ] **Step 4: Run** the touched tests, `src/ui/ui.test.ts`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "The Gazette's numbers column replaces its trajectory stories".

### Task 5: Calibration lines, docs, version

- [ ] **Step 1:** `scripts/calibrate.ts`: print the league's EPA/play, per dropback, per rush, success rate and
  explosive rates with `⚠` outside the spec's ranges. Run `npm run sim -- 10`; if a value sits outside, tune the
  §1 constants (never the ranges) and rerun Task 1's and Task 2's tests.
- [ ] **Step 2:** `docs/NEWS.md` (the Gazette's rules), `docs/MVP.md` (the news item's Partial line names the
  column), changelog, `package.json` last number.
- [ ] **Step 3: Run** `npm run format && npm run typecheck && npx vitest run`. Expected: all pass.
- [ ] **Step 4: Commit** "Gazette numbers desk: calibration, docs and version"; push; open the PR; read CI.
