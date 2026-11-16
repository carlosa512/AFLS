# Cap Room at Kickoff and the Linemen Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI clubs' spring cuts use the June 1 designation and skip cuts whose dead money eats the saving, so median
kickoff room returns to 1.0%+ in seasons 4–6; the linemen retirement-age line is printed, not judged.

**Architecture:** Two small changes in `springCuts` (`src/engine/offseason/ai.ts`): read each candidate's room with the
designation while one is left and designate the cut when it moves money to next year; and a dead-money bar
(`SPRING_CUT.deadShare`) tuned against `npm run offseason -- 6`. A script-only change in `scripts/careers.ts` for
linemen. Docs, version, checks and the moved tests last.

**Tech Stack:** TypeScript, Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-11-16-cap-room-and-linemen-design.md`

## Global Constraints

- Engine purity: no `Math.random`, no new draws (these changes draw nothing).
- `League` stays plain JSON; no new stored field (the designation count `Team.postJune1Used` already exists).
- Your team never changes: `springCuts` returns `[]` for the user's team, as today.
- At most `POST_JUNE1_LIMIT` (2) designations a team a league year; the count resets in `beginOffseason` before spring cuts.
- Never loosen a band to get green. A judged line that fails after the tuning step goes back to the owner with numbers.
- One CPU-heavy job at a time. Local runs steer, CI verifies; once a PR is open, push only after local checks pass.
- Version: `package.json` 0.4.50 (a fix), with a changelog entry in `src/ui/changelog.ts`.

## Review Focus

1. A spring cut with no prorated bonus left: the designation moves nothing, so it must not spend one (a later cut with
   real dead money would lose it).
2. A team that already used both designations: further spring cuts book all their dead money this year.
3. A cut that goes to waivers (`waiverApplies`, under four service seasons): `releasePlayer` queues it and returns
   early, and `queueWaiver` counts the designation itself (`personnel/waivers.ts`, `postJune1Used++`); the reviewer
   checks it is counted once.
4. Next year's planning (`nextYearNeeds`, restructures, the re-sign window) must see the deferred dead money: it reads
   `capSheet(league, id, season + 1)`, which already sums `team.deadMoney` by season.
5. A whole spring across all AI teams: none past two designations, none on your team.

---

### Task 1: June 1 designations and the dead-money bar in spring cuts

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`SPRING_CUT`, `springCuts`, `twoYearRoom`, near lines 1012–1063)
- Test: `src/engine/offseason/springCuts.test.ts`

**Interfaces:**
- Consumes: `releasePreview(league, player, designatePostJune1)` and `releasePlayer(league, player, designatePostJune1)`
  from `finance/cap.ts` (`ReleasePreview`: `thisYear`, `nextYear`, `savings`, `postJune1`, `canDesignate`);
  `POST_JUNE1_LIMIT`; `capHit(contract, season)`.
- Produces:
  - `SPRING_CUT = { margin: 0.5, deadShare: 0.5 }` (deadShare tuned in Task 3).
  - `twoYearRoom(league, p, designate = false): { now: number; twoYear: number }` — read with the designation when asked.
  - `designateFor(league: League, p: Player): boolean` — true when the team has a designation left and designating moves
    money to next year (`releasePreview(..., true).nextYear > 0`).
  - `cutPaysOff(league: League, p: Player): boolean` — the dead money the cut leaves this year and next (`thisYear +
    nextYear`, the same with or without the designation) is at most `SPRING_CUT.deadShare` × the cap charges it saves
    (`capHit` this season + next season).

- [ ] **Step 1: Write the failing tests** in `springCuts.test.ts`. Add a helper beside `overpay` that gives the deal a
  signing bonus: `overpayWithBonus(l, p, times, bonusYears)` builds the same five-year deal with
  `signingBonus = bonusYears * apy`. Tests:

```ts
it('designates a spring cut post-June 1 while the team has designations left', () => {
  const { l, team } = scene();
  const p = veteran(l, team);
  overpayWithBonus(l, p, 1 + SPRING_CUT.margin + 1.5, 1); // dead money well under the bar
  expect(designateFor(l, p)).toBe(true);
  expect(springCuts(l, team).map((x) => x.id)).toContain(p.id);
  expect(team.postJune1Used).toBeGreaterThanOrEqual(1);
  expect(team.deadMoney.some((d) => d.playerId === p.id && d.season === l.season + 1)).toBe(true);
});

it('never designates past the limit', () => {
  const { l, team } = scene();
  team.postJune1Used = POST_JUNE1_LIMIT;
  const p = veteran(l, team);
  overpayWithBonus(l, p, 1 + SPRING_CUT.margin + 1.5, 1);
  expect(designateFor(l, p)).toBe(false);
  springCuts(l, team);
  expect(team.deadMoney.some((d) => d.playerId === p.id && d.season === l.season + 1)).toBe(false);
});

it('spends no designation on a cut with no money to move', () => {
  const { l, team } = scene();
  const p = veteran(l, team);
  overpay(l, p, 1 + SPRING_CUT.margin + 1.5); // no signing bonus: nothing prorated
  expect(designateFor(l, p)).toBe(false);
});

it('skips a cut whose dead money runs past deadShare of what it saves', () => {
  const { l, team } = scene();
  const p = veteran(l, team);
  overpayWithBonus(l, p, 1 + SPRING_CUT.margin + 1.5, 4); // three years of a big bonus left
  expect(cutPaysOff(l, p)).toBe(false);
  expect(springCuts(l, team).map((x) => x.id)).not.toContain(p.id);
});

it('a whole spring: no AI team past two designations, yours untouched', () => {
  // A league through beginOffseason (the scene's own world, fresh): read every team's postJune1Used.
  // Every AI team ≤ POST_JUNE1_LIMIT; the user's team 0 (springCuts never runs for it).
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run src/engine/offseason/springCuts.test.ts`
Expected: FAIL (`designateFor`, `cutPaysOff`, `SPRING_CUT.deadShare` don't exist; no next-year dead money).

- [ ] **Step 3: Implement** in `ai.ts`: add `deadShare: 0.5` to `SPRING_CUT` (comment: why, and that it's tuned in
  this plan's Task 3); give `twoYearRoom` the `designate` parameter (pass it to `releasePreview`); add `designateFor` and
  `cutPaysOff` as specified; in `springCuts`, read each candidate's room with `designateFor(league, p)`, keep only those
  with `cutPaysOff`, take the most room now first (as today), and release with `releasePlayer(league, best.p,
  designateFor(league, best.p))`. Update `springCuts`' doc comment.

- [ ] **Step 4: Run the file**

Run: `npx vitest run src/engine/offseason/springCuts.test.ts && npm run typecheck`
Expected: PASS; the four existing tests still pass (their deals carry no bonus, so the bar never stops them).

- [ ] **Step 5: Commit**

```bash
git add src/engine/offseason/ai.ts src/engine/offseason/springCuts.test.ts
git commit -m "offseason: AI spring cuts use June 1 and skip cuts whose dead money eats the saving"
```

### Task 2: The linemen retirement age printed, not judged

**Files:**
- Modify: `scripts/careers.ts` (`SOFT_RETIRE` and the known-issue line after the median retirement age)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: nothing other tasks read.

- [ ] **Step 1:** Replace the soft path with a printed-only one: a group in `PRINTED_RETIRE` (OL) shows its median and
  band with no flag and no known-issue line. Its comment says why: the starter lean keeps old starting linemen playing,
  so fewer retire at 33 and up and the median of those who retire falls (starting linemen who retired at 30 or younger:
  21 after 0.4.49, 27 before, one league, eight seasons); good players leaving by age are judged by the exits lines.
- [ ] **Step 2:** `npm run typecheck && npx prettier --check scripts/careers.ts`. Expected: clean.
- [ ] **Step 3: Commit** `git commit -am "careers: linemen's median retirement age printed, not judged"`

### Task 3: Tune the bar against the real check

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`SPRING_CUT.deadShare` only)

**Interfaces:**
- Consumes: `SPRING_CUT.deadShare` (Task 1).

- [ ] **Step 1: Baseline the edge lines on this branch before tuning** (Task 1's code at 0.5): `npm run offseason -- 6`
  into a log. Read: median kickoff room per season and the four-league tail ("median space %cap over 4 leagues"),
  dead median per season, the pooled market line (good outside signings, one-year %, clubs 3+, no deal %, released %,
  starters out of football %), clubs restructuring per season, and the ✗ count.
- [ ] **Step 2: Rule.** Done when kickoff room is 1.0% or more in seasons 4–6 of this league and the tail averages 1.0%+,
  dead median stays inside 0–6%, and no judged line fails (no deal ≥ 10%, clubs 3+ ≥ 8). Otherwise move `deadShare`
  one step (0.5 → 0.35 → 0.25 if room is short; 0.5 → 0.7 if a market line fails) and run again. At most three rounds.
  If the rule isn't met after three, stop and bring the owner the table of rounds.
- [ ] **Step 3: Commit** the chosen value with a comment naming the rounds' numbers.

### Task 4: Checks, moved tests, docs and the PR

**Files:**
- Modify: `docs/MVP.md`, `CLAUDE.md` (the offseason notes and the careers line), `src/ui/changelog.ts`, `package.json`,
  `docs/superpowers/specs/2026-11-16-cap-room-and-linemen-design.md` ("What was built"),
  `docs/superpowers/specs/2026-11-16-market-and-exits-design.md` (its follow-up list), any moved test files.

- [ ] **Step 1: The checks the change moves, one at a time:** `npm run trades` (cap casualties on the phone),
  `npm run morale` (more veterans kept), `npm run careers` (cuts move who leaves football). Each must report nothing
  outside range; a failure is diagnosed before anything else changes.
- [ ] **Step 2: Moved tests:** `npx vitest run src/engine/offseason` and the files any check run names; a test that
  pinned a scene now finds it (search the world, assert the scene exists); a pinned snapshot is re-pinned only when its
  change is explained by this work.
- [ ] **Step 3: Docs:** MVP's cap-room and linemen lines (closed or Partial with numbers), CLAUDE.md (`springCuts` uses
  June 1 and the dead-money bar; careers prints linemen's median), the changelog's 0.4.50 entry (plain player-facing
  words), `package.json` 0.4.50, the spec's "What was built" with the final numbers.
- [ ] **Step 4: Fresh reviewer on the branch**, then fix Critical/Important findings with a failing test first.
- [ ] **Step 5: Push and open the PR**; read CI and fix red in one push.
