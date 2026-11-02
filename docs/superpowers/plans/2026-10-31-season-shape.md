# The Season's Shape (Parity Stages 3–4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the parity work: read strength as a line reads it, give the passing game the NFL's shape, re-size the
team's day against the real line, set the trees' winner bar against the NFL's, and ship 0.2.27 with every check green.

**Architecture:** Stages 1–2 are already on the branch (`teamDay`, the even deal, a new league's depth). This plan adds
measurement first (the sim check reads weekly strength and passing by depth from a replayed sample, no change to what a
save stores), then the play-calling and short-throw changes in `match/coach.ts` and `match/gameSim.ts`, then two
constants sized from measurement (`DAY_SD`, `WINNER.share`), then the wrap-up.

**Tech Stack:** TypeScript, Vitest, tsx scripts (`npm run sim`, `npm run careers`, `npm run audit`).

**Spec:** `docs/superpowers/specs/2026-10-30-parity-design.md` (Stages 3–4, Checks). The first plan,
`docs/superpowers/plans/2026-10-30-parity.md`, covered Stages 1–2; its Task 5 (wrap-up) is folded into Task 6 here.

## Global Constraints

- Branch `claude/gallant-ramanujan-rzydgt-engine`; one PR to main. Never force push; undo with `git revert`.
- Vitest always with `--maxWorkers=2`.
- Never loosen a range. The two corrected this week (margin around strength 12.3–13.3, red-zone trips 3.2–3.5) are the
  owner's calls and already in `scripts/calibrate.ts`. If a range can't be met, stop and tell the owner why.
- No cap on any player. Levers are league-wide play calling, how a throw is shaped, and constants sized from a named NFL
  figure. Attribute slopes stay as they are, except Task 4's `targeting` pull, which only moves if the measured top-end gap
  says so.
- NFL figures come from the spec's *nflverse* tables (2019–24 passing by depth; 2015–24 lines). Quote them in comments.
- Measuring runs `npm run sim -- 60` in the background (about 4–6 minutes); two variants may run side by side from a
  scratch worktree. At most three tuning runs per lever; then stop and report.
- No `Math.random`; nothing new stored on `League` (no `SAVE_VERSION` bump).
- `npm run format` before every commit. Push after every commit (the session's stop hook asks for a clean tree).

## Review Focus

1. **Goal line and own goal line:** inside the opponent's 12 the call folds deep into short, and inside the 5 every throw
   is short, so behind-the-line throws become common there; near the offense's own goal line a throw behind the line must
   never be caught in its end zone → Task 2's test that a short throw's air respects `1 − yardLine`.
2. **The hurry-up's mix shift** (`[-0.1, +0.06, +0.04]`) applied after the new mixes must never leave a negative weight
   → Task 2's test over every distance bucket in a hurry.
3. **Scheme leans stay relative:** Air Coryell still throws deep more than the league (the existing ×1.25 test in
   `schemes.test.ts`), West Coast still shortest → Task 2 runs `schemes.test.ts`.
4. **Clock and endings:** more short throws in bounds run more clock; `npm run endings` runs on CI for `match/coach.ts`
   → Task 6 reads it; any flagged ending is this PR's.
5. **A sampled game must not change the season:** the sim check replays week 1 with `keepPlays` before playing it for
   real; the replay must not alter the league → Task 1's check that the real week-1 results equal the replayed ones.

---

### Task 1: Measure as the spec reads it

**Files:**
- Modify: `scripts/calibrate.ts` (weekly strength; the passing-by-depth sample and table)

**Interfaces:**
- Produces: sim output section `Passing by depth` with judged rows `average air yards`, `short share %`,
  `10–19 share %`, `20+ share %` (ranges 7.4–8.3, 65–70, 19–23, 10.5–13) and shown rows per band (completion, yards an
  attempt, picks, yards after the catch) beside the *nflverse* figure; Parity reads each game's gap from both teams'
  `teamRatings(...).overall` taken before that week's games.

- [ ] **Step 1: Weekly strength.** Replace `simToEndOfRegularSeason(league)` in the season loop with a loop over
  `playWeek` that, before each week, records `teamRatings(league, t).overall` for every team and keys each of
  `gamesInWeek(league)`'s games to `ratings(home) − ratings(away)`. `gaps` and the shown favourite rate read that
  per-game gap; the kickoff `ratings` map stays for `winsByStrength` (quartiles, win spread).

- [ ] **Step 2: The depth sample.** Before the season plays, replay each week-1 game with
  `simulateGame(league, g, { keepPlays: true })` and tally its throws by air yards from the play log (`kind` in
  `pass | incomplete | int`, air = `(air − from)` signed by the offense's direction; bands: behind (< 0), 0–9, 10–19, 20+;
  completions `kind === 'pass'`, yards `to − from` signed). Constant: `const PASS_DEPTH_NFL` holding the spec's table
  (shares 16.6/50.9/20.9/11.6, completion 81/70/54.9/36.2, Y/A 4.7/5.8/9.6/12.2, picks 0.8/1.4/3.4/6.3, YAC
  9.1/4.2/3.7/5.6, average air 7.9). Print the judged rows (`misses++` like the others) and the shown table.

- [ ] **Step 3: Prove the replay is harmless.** Keep each replayed result; after week 1 plays for real, compare
  `homeScore`/`awayScore` of each week-1 game with its replay; a mismatch throws (`Error('depth sample changed week 1')`).

- [ ] **Step 4: Baseline.** Run: `npm run sim -- 60` (background).
  Expected: passing-by-depth rows fail (short about 50%, 10–19 about 36%, average air about 10.9); parity rows read
  with weekly strength; no throw from Step 3. Record every row in the ledger as the Task 2 baseline.

- [ ] **Step 5: Commit and push.**
  `git commit -m "Sim check: strength read weekly, as a line reads it; passing by depth against nflverse"`

---

### Task 2: The passing game's shape

**Files:**
- Modify: `src/engine/match/coach.ts:222-240` (`passDepth` mixes)
- Modify: `src/engine/match/gameSim.ts` (the air roll into an exported pure `passAir`; short completion base; yards
  after a catch behind the line)
- Test: `src/engine/schemes.test.ts` (or a new `src/engine/passing.test.ts`)

**Interfaces:**
- Produces: `export function passAir(rng: Rng, depth: PassDepth, isBack: boolean, yardLine: number, yardsToGoal: number): number`
  in `match/gameSim.ts` (the roll and both clamps that follow it today); `export const BEHIND_SHARE` (share of a
  receiver's short throws thrown behind the line).

- [ ] **Step 1: Revert the first read.** `git revert --no-edit 0a20d26` (spec: the NFL's top receiver takes 23.1% of his
  team's catches; the sim already read 24%).

- [ ] **Step 2: Write the failing tests.**

```ts
it('calls the NFL mix on an ordinary down: two in three short, one in five 10 to 19 yards', () => {
  // 4000 draws of passDepth({ ...ordinary, down: 1, distance: 10 }): short 0.64–0.72, medium 0.18–0.24
});
it('never leaves a negative weight in a hurry', () => {
  // for distances 1, 3, 5, 8, 15 in a situation tempo(s) reads as 'hurry' (late, trailing): short stays > 0.3
});
it("throws a quarter of a receiver's short passes behind the line, the rest 0 to 9", () => {
  // 4000 passAir(rng, 'short', false, 50, 50): share < 0 within BEHIND_SHARE ± 0.03; mean of the rest 3.7–4.7
});
it('never completes a pass behind its own goal line', () => {
  // passAir(rng, 'short', false, 2, 98) ≥ −1 for 2000 draws
});
```

  Run: `npx vitest run src/engine/schemes.test.ts --maxWorkers=2` → FAIL (`passAir` not exported, mix shares off).

- [ ] **Step 3: Implement.**
  - `passDepth`'s four situational mixes: medium × 0.58 and deep × 0.8, short takes the rest (≥15: `[0.568, 0.232, 0.2]`;
    7–14: `[0.679, 0.209, 0.112]`; ≤3: `[0.82, 0.116, 0.064]`; 4–6: `[0.744, 0.168, 0.088]`). Comment: the *nflverse*
    shares (67.5 / 20.9 / 11.6, 2019–24).
  - `passAir`: backs unchanged (`int(−3, 4)`); a receiver's short throw is behind the line with `BEHIND_SHARE = 0.25`
    (`−int(1, 5)`, the NFL's average −3.3), otherwise `round(clamp(normal(4.2, 2.6), 0, 9))`; medium and deep unchanged;
    then today's two clamps. `GameSim` calls it where it rolls `air` now.
  - Leave the short completion base (`0.81`) and the short yards-after-catch base (`3.2`) for Step 5.

- [ ] **Step 4: Run the tests** (`schemes.test.ts`, then `npx vitest run src/engine --maxWorkers=2` into a log) → the
  new tests PASS; failures only in played-game pins (re-taken in Task 6, not now).

- [ ] **Step 5: Measure and size the short game.** `npm run sim -- 60`. Read the depth table against *nflverse*:
  - If short completion reads above 75%, lower the short base (`0.81`) in one step to land it near 73%.
  - If yards after a catch behind the line reads below 8 (*nflverse* 9.1, blockers in front of a screen), give a catch
    behind the line its own base in the after-catch roll (`air < 0 ? SCREEN_YAC : 3.2`, `SCREEN_YAC` sized to read about
    9) with a comment naming the figure.
  - Re-run once. Every judged row in range (the four depth rows; completion 63–66.5; yards an attempt 6.7–7.3; red-zone
    trips 3.2–3.5; leaders). At most three runs; a judged row out after that → stop and report.

- [ ] **Step 6: Commit and push** (one commit per lever that stays):
  `"Engine: the NFL's pass mix (two in three short)"`, `"Engine: screens and checkdowns behind the line"`, and if moved,
  `"Engine: short completions and screen yards against nflverse"`.

---

### Task 3: Re-size the team's day against the real line

**Files:**
- Modify: `src/engine/match/lineup.ts` (`DAY_SD` value and comment)

- [ ] **Step 1: Measure both ends.** Two runs side by side on Task 2's engine: `DAY_SD = 0.35` (the branch) and
  `DAY_SD = 0` (scratch worktree). Read `margin spread around strength` (weekly strength) from each: R35 and R0.

- [ ] **Step 2: Size it.** `DAY_SD = 0.35 × √((12.8² − R0²) / (R35² − R0²))`, rounded to 0.05. If that is below 0.15
  (the line's 12.8 already met without a day), stop and ask the owner whether the day stays for its own sake.

- [ ] **Step 3: Confirm.** One run at the new value: margin around strength 12.3–13.3, the margin strength predicts
  5.5–6.5, the win spread 3.0–3.4, every other row in range.

- [ ] **Step 4: Commit and push:** `"Engine: a team's day sized against the closing line (nflverse 12.8)"`.

---

### Task 4: The receivers' top end (only if a receiving row is out after Task 3)

Skip, and say so in the PR, if #1 receptions reads 117 or more and #5 receiving yards 1,500 or less.

**Files:**
- Modify: `src/engine/match/gameSim.ts` (the target weight's `targeting` pull, `0.032`)

- [ ] **Step 1: Measure the gap.** Over 20 fresh leagues: the league's #1 catches over the mean of each team's top
  receiver's. *nflverse* 2019–24: about 1.6 (#1 about 135, team leaders about 84).
- [ ] **Step 2:** If the sim's gap is under 1.5, raise the `targeting` pull in one step sized to close it, re-measure the
  gap and run `npm run sim -- 60`. If the gap already matches, or a receiving row is still out after two runs, stop and
  report to the owner.
- [ ] **Step 3: Commit and push:** `"Engine: receivers who get open draw the ball like the NFL's best"`.

---

### Task 5: The trees' winner bar

**Files:**
- Modify: `src/engine/trees.ts:200-202` (`WINNER.share` and its comment)
- Scratch: a careers-leagues script (the session's `coachpar.mts` pattern) printing, per steady season, how many active
  head coaches with five or more seasons clear each bar from .540 to .600 in steps of .01.

- [ ] **Step 1: Measure** on the branch after Tasks 2–4, the four careers seeds, seasons 9–16 (about 10 minutes, four
  at a time).
- [ ] **Step 2: Set `WINNER.share`** to the bar whose average count is closest to 8 (the NFL's, entering 2025), two
  decimals. Check it stays below `PEDIGREE.top` (0.7) in `trees.ts`. Rewrite the comment with the NFL count and the
  sim's.
- [ ] **Step 3: Tests:** `npx vitest run src/engine/trees.test.ts --maxWorkers=2` → PASS (a test pinned to .600 is
  re-read: if it asserts the rule, update its record to clear the new bar and say why in the commit).
- [ ] **Step 4: Careers:** `npm run careers` (background) → the five tree lines inside their bands; nothing flagged ▲/▼.
  If a tree line is still out, stop and report (the sim's lasting winners are the owner's finding, per the spec).
- [ ] **Step 5: Commit and push:** `"Trees: the winner bar against the NFL's lasting winners"`.

---

### Task 6: Wrap-up

**Files:**
- Modify: played-game pins in tests, `docs/ATTRIBUTES.md` (regenerated), `CLAUDE.md` (the `npm run sim` bullet),
  `docs/MVP.md` (item 2), `package.json` (0.2.27), `src/ui/changelog.ts`

- [ ] **Step 1: Engine suite.** `npx vitest run src/engine --maxWorkers=2` into a log. Re-take only pins of played games
  (the `personnel.test.ts` result hash by hand, the offseason re-sign snapshot with `-u`); name each in the commit. A
  failing behaviour test is a finding: stop and read it.
- [ ] **Step 2: Audit.** `npm run audit` (background) → nothing under "Needs attention"; commit the regenerated doc.
- [ ] **Step 3: Notes.** `CLAUDE.md` sim bullet: it judges parity against the closing line and passing by depth against
  nflverse. `docs/MVP.md` item 2: "games as uncertain as the NFL's and a passing game shaped like it (0.2.27)".
  `package.json` 0.2.27. Changelog entry, newest first:

```ts
{
  version: '0.2.27',
  date: '2026-10-31',
  title: 'Any given Sunday',
  text:
    'Teams now have good days and bad ones, so upsets come about as often as in the real league, and a new league ' +
    'starts as even as one that has played for years. Quarterbacks throw like today’s NFL too: mostly short, with ' +
    'screens and checkdowns, fewer intermediate chain-movers, and the deep shot when it’s there.',
},
```

- [ ] **Step 4: Format, typecheck, the UI test, commit, push.**
  `npm run format && npm run typecheck && npx vitest run src/ui/ui.test.ts --maxWorkers=2`
- [ ] **Step 5: Open the PR and drive CI green.** Body: the spec link, before/after tables (main, Stage 1–2, final) for
  parity, passing by depth, red-zone trips and the leaders; the nflverse sources; the re-taken pins; the steady win
  spread; the two range corrections and the owner's OK. Every red check is this PR's.
- [ ] **Step 6: Then #115:** merge main into its branch, bump it to 0.2.28, push its local sturdier-checks commit,
  regenerate `docs/ATTRIBUTES.md` there, read its CI.
