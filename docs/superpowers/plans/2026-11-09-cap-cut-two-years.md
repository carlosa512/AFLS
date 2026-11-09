# A Cap Cut That Counts Next Year — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI clubs stop making cap cuts that leave next year worse than keeping the man, and stop cutting a man they
signed this league year while anyone else frees room; then the held-back concussion work (0.4.19 on the old branch)
is re-landed on top.

**Architecture:** One function changes: `capCut` in `src/engine/offseason/ai.ts`, the cut every cap-room path asks for
(`aiCapCompliance`, `makeRoom`, the trade market's league-year casualty). It ranks by rating lost per dollar of
two-year room instead of this year's savings, and keeps this year's signings out of the first pass. Callers keep their
fallbacks (`capCut(..., desperate) ?? capCut(..., true)`). The held-back work comes back by reverting the commit that
stripped it (`d2cfcf5`, in main's history).

**Tech Stack:** TypeScript, Vitest, the repo's check scripts.

**Spec:** `docs/superpowers/specs/2026-11-09-cap-cut-two-years-design.md`

## Global Constraints

- Engine stays pure: no `Math.random`, no new stream draws (`capCut` draws nothing).
- Cap math through `finance/` only: `releasePreview` (this year's savings, next year's dead) and `capHit`.
- Never loosen a range to get green; bands and swing lines are the owner's call.
- Nothing pushed until the full local check (`npm run check`) is green (the owner, Nov 9).
- Versions: the cap-cut fix 0.4.19, the re-landed concussion work 0.4.20, each with a changelog entry.

## Review Focus

1. **A club over the cap whose only cuts make next year worse:** it must still get legal (the desperate pass takes
   them; the cap is the law). Test in Task 1.
2. **A rookie drafted this league year** counts as signed this year: cut for cap only in the desperate pass.
   Pinned by Task 1's this-year test (a draftee's `signedSeason`).
3. **`makeRoom` for a keeper** gets no cut when only fresh or next-year-worse men are left: the keeper walks rather
   than a fresh signing being dumped. Pinned by Task 1 (non-desperate `capCut` returns null).
4. **A man whose deal ends this year** (no hit next year): his two-year room is this year's savings less any dead
   pushed to next year. Covered by the ranking test's arithmetic.
5. Checked: the user's club is never cut for (callers never pass it); unchanged.

---

### Task 1: `capCut` judges two years and spares this year's signings

**Files:** Modify `src/engine/offseason/ai.ts` (`capCut`, ~line 915). Test: new `src/engine/offseason/capCut.test.ts`.

**Interfaces — Produces:**
- `twoYearRoom(league: League, p: Player): { now: number; twoYear: number }` (`cutRoom` is taken: the room a cut frees after the fill reserve) — `now` = `releasePreview(league, p).savings`;
  `twoYear` = `now + capHit(p.contract!, league.season + 1) − releasePreview(league, p).nextYear`.
- `capCut(league, team, desperate = false): Player | null` — same signature. Candidates: today's (contract running,
  above the floor, `now > 200`). First pass: `twoYear > 0` and `contract.signedSeason !== league.season`, ranked by
  `playerOvr / twoYear`. If that pass is empty: `null`, unless `desperate`, then every candidate ranked by
  `playerOvr / now` (today's rule).

- [ ] **Step 1: Failing tests** in `capCut.test.ts` (a settled league after `beginOffseason`, one AI club, its other
  contracts made uncuttable by moving them under the floor or giving them `now <= 200` by hand):
  - `ranks a cut that makes next year worse below one that doesn't`: two men at one position, same rating and
    `now`; one with next year's dead past next year's hit → `capCut` returns the other.
  - `spares a man signed this league year while anyone else frees room`: the fresh man is the better ratio → not
    returned; the other is.
  - `desperate, it takes a fresh or next-year-worse man when nothing else is left`: only such men → `capCut(..., false)`
    is `null`, `capCut(..., true)` returns one.
  - `a club over the cap with only bad cuts still gets legal`: `aiCapCompliance` → `capSpace >= 0`.
- [ ] **Step 2:** `npx vitest run src/engine/offseason/capCut.test.ts` → the first three FAIL.
- [ ] **Step 3:** Implement `twoYearRoom` and the two-pass `capCut`; update its doc comment (why: camp cuts are post-June 1).
- [ ] **Step 4:** Run the new file and `capPlan.test.ts`, `makeRoom.test.ts`, `offseason.test.ts` → PASS (re-take the
  pinned re-sign snapshot only if the world it plays moved, and say so in the commit).
- [ ] **Step 5:** Commit.

### Task 2: Checks for the fix alone

- [ ] **Step 1:** `npm run offseason -- 6` on the default seed, `--seed alt-1`, `--seed alt-2`: no ✗; record the
  sixth season's dead median and the count of releases with dead money past twice their savings (temporary trace,
  not committed) against main's (23 over six seasons on the default seed).
- [ ] **Step 2:** `npm run trades`, `npm run careers`: no ✗.
- [ ] **Step 3:** Changelog 0.4.19 ("clubs stop cutting a man they just signed to clear cap room…"), `package.json`,
  spec status line; `npm run format`; commit.

### Task 3: Re-land the held-back concussion work

- [ ] **Step 1:** `git revert --no-commit d2cfcf5`; resolve: changelog and `package.json` to 0.4.20 (one entry: Sit him
  this week, AI clubs' call, the doctor's advice, the third-and-medium tune), `docs/ATTRIBUTES.md` from a fresh
  `npm run audit` later, the re-sign snapshot re-taken if needed.
- [ ] **Step 2:** `npx vitest run src/engine/injuries.test.ts src/engine/inbox.test.ts src/ui/mail.test.tsx
  src/engine/match/pocketChoice.test.ts src/engine/offseason/` and `npm run typecheck` → PASS.
- [ ] **Step 3:** Commit.

### Task 4: The full run, then one push

- [ ] **Step 1:** `npm run check` → every line ✓ (swing lines may warn).
- [ ] **Step 2:** Fix anything red at its cause; re-run what changed.
- [ ] **Step 3:** Push once; open the PR (template headings), with the check's ✓/✗ lines.
