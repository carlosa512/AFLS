# Front Offices Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The free-agent market clears by camp, a GM cuts a lesser player to sign a better one, and a GM tags the
star he'd otherwise lose, so contenders stay contenders and the league's cap crunch from year 4 goes.

**Architecture:** All three are decisions inside `offseason/ai.ts`: the camp pass of `aiFreeAgencyDay` takes a
`lastCall` flag (a free agent's floor falls to his minimum), the same pass may release one lesser player per club to
fit a better free agent, and `aiResignWindow`'s coin-flip tag becomes the GM's decision. The offseason check counts tags.

**Tech Stack:** TypeScript, Vitest, tsx scripts (`npm run offseason`, `npm run careers`).

**Spec:** `docs/superpowers/specs/2026-11-01-front-offices-design.md`

## Global Constraints

- Same branch and PR as parity (`claude/gallant-ramanujan-rzydgt-engine`); no PR until careers and offseason are green.
  Never force push; Vitest with `--maxWorkers=2`.
- Every lever is the GM's choice for a reason the club can see, scaled by his traits; never a cap on a player.
- Before camp nothing changes: the draft's (25%) and preseason's (35%) pressure stand; in season, call-ups as today.
- Upgrade cut: only the player `capCut` would pick, only if he's below the free agent at the club's outlook, only if his
  release makes the fitted deal fit; at most one per club per pass.
- Tag: a starter in the club's plans, within today's age line (`age - ageShift(position) <= 30`), its charge fits after
  `makeRoom`, one a club a year; no coin flip; more readily for a win-now GM. Sized to the NFL's 6–10 a season.
- Checks: starters out of football 2.5–4.5% every season; **tags a season judged 4–10** (new, offseason check);
  careers' tree lines and highest starter overall (13.2) judged as today; record carryover reported.
- No range moves. A line that can't be met: stop and tell the owner. `npm run format`, commit and push each task.

## Review Focus

1. **A cut that leaves a hole:** the upgrade cut must not take a position under its keep minimum or leave the club
   unable to fill 53 → `capCut` already guards `KEEP_MIN`; Task 4 reads the offseason roster lines (holes, keep-min,
   under 53 with room).
2. **A chain of cuts:** a cut player re-enters the pool and could cost another club a cut → one cut per club per pass;
   Task 2's test that a club cuts at most once in a pass.
3. **Last call for your own club's free agents:** your players' negotiations are untouched; `lastCall` reads only other
   clubs' offers to free agents (`own` is false for a free agent) → Task 1's test that a player with a club is unaffected.
4. **Tags crowding the cap:** a tag charged after `makeRoom` must leave the club under the cap → Task 3's test.
5. **League talent inflating:** clubs keeping more good players can lift starter overall past 13.2 → Task 4 reads
   careers' highest starter overall; past it is a finding, not a range to move.

---

### Task 1: The market clears by camp

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiFreeAgencyDay` option `lastCall?: boolean`)
- Modify: `src/engine/offseason/index.ts` (the camp pass passes `lastCall: true`)
- Test: `src/engine/offseason/frontOffice.test.ts` (new)

**Interfaces:**
- Produces: `aiFreeAgencyDay(league, rng, opts: { includeUser?: boolean; rosterMax?: number; lastCall?: boolean })`;
  with `lastCall`, the accept test is `best.value >= minSalary(p.experience, cap)` in place of the walk-away.

- [ ] **Step 1: Write the failing tests**

```ts
describe('the market clears by camp', () => {
  it('signs a free agent for what a club can fit on the last call, and not on an earlier pass', () => {
    // From the draft step of a league after one season: a starter-quality free agent (12+, 29 or younger), every AI
    // club's room taken away but one, whose spendable is set to 1.5x his minimum (below his preseason walk-away).
    // aiFreeAgencyDay(l, rng, { rosterMax: 90 }) leaves him unsigned; with lastCall: true he signs, one year, at
    // most the room.
  });
  it('leaves a player with a club as he was', () => {
    // A rostered player's demand(...).walkAway is the same in a lastCall pass as without it (lastCall reads only the
    // free-agent accept test).
  });
});
```

- [ ] **Step 2:** `npx vitest run src/engine/offseason/frontOffice.test.ts --maxWorkers=2` → the first FAILS (he stays
  unsigned on the last call).
- [ ] **Step 3: Implement.** The `lastCall` accept test in `aiFreeAgencyDay`; the camp pass in the draft step passes
  `lastCall: true`. Comment: an NFL veteran unsigned in August takes what's left, often near the veteran minimum.
- [ ] **Step 4:** the file → PASS; `npx vitest run src/engine/offseason --maxWorkers=2` (pins only fail).
- [ ] **Step 5:** commit and push `"Free agency: the market clears by camp (the last call takes what a club can fit)"`.

---

### Task 2: A GM upgrades by cutting

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiFreeAgencyDay`)
- Test: `src/engine/offseason/frontOffice.test.ts`

**Interfaces:**
- Consumes: Task 1's `lastCall` accept test; `fitOffer`, `capCut`, `releasePreview`, `releasePlayer`, `teamOutlook`.
- Produces: inside a pass, a club's candidate may carry `cut?: Player`; on signing, the cut is released first and the
  club joins the pass's `cutThisPass` set.

- [ ] **Step 1: Write the failing tests**

```ts
describe('a GM upgrades by cutting', () => {
  it('cuts a lesser, pricier player to sign a better free agent it couldn’t otherwise fit', () => {
    // Free agency's last day; one AI club with no spendable room and a capCut candidate rated below the best free
    // agent whose release saves more than the free agent's walk-away; every other club's room taken away.
    // After aiFreeAgencyDay: the free agent is on that club, the cut candidate is a free agent (left: 'cut').
  });
  it('never cuts a better player, and cuts at most once a pass', () => {
    // Same club, two free agents it wants: after the pass, at most one of its players was cut, and every player it
    // cut rates below the free agent he made room for.
  });
});
```

- [ ] **Step 2:** run → FAIL (no cut).
- [ ] **Step 3: Implement.** Where a club's offer can't be made to fit (`fitOffer` null, or the fitted value under the
  accept test), and the club isn't in `cutThisPass`: take `capCut(league, team)`; if he exists, his outlook at the club
  is below the free agent's (`ahead`) and the fitted offer on `budget + releasePreview(...).savings` passes the accept
  test, carry `{ offer, cut }` as the club's candidate. When that candidate wins, release the cut, add the club to
  `cutThisPass`, add the savings to its budget, and sign.
- [ ] **Step 4:** run the file → PASS.
- [ ] **Step 5:** commit and push `"Free agency: a GM upgrades by cutting a lesser, pricier player"`.

---

### Task 3: The tag keeps a star who'd walk

**Files:**
- Modify: `src/engine/offseason/ai.ts` (`aiResignWindow`'s tag; a `TAG_TIER` constant)
- Test: `src/engine/offseason/frontOffice.test.ts`

**Interfaces:**
- Consumes: `makeRoom` (re-sign window, already in `ai.ts`).
- Produces: `const TAG_TIER = 0.75` (a starting value Task 4 sizes), the bar a keeper's pay tier must clear, less
  `0.25 * winNow` (a win-now GM tags lower down his roster).

- [ ] **Step 1: Write the failing tests**

```ts
describe('the tag keeps a star who’d walk', () => {
  it('tags a keeper who tests the market when he starts, fits the age line and the tag fits', () => {
    // The re-sign window after one season; a club's best expiring starter (call 'keep', reason 'starter', within the
    // age line, pay tier above TAG_TIER) set to test the market (loyalty 0 and the rng seeded so testsMarket is true,
    // or the room forced short so he can't sign). After aiResignWindow: his contract kind is 'tag', the club is under
    // the cap, team.taggedId is his id.
  });
  it('never tags two in a year, nor one past his age line', () => {
    // Two such keepers: only one tagged. A keeper past `age - ageShift(position) <= 30`: not tagged.
  });
});
```

- [ ] **Step 2:** run → FAIL (the coin flip misses most of the time; seed the rng so it misses).
- [ ] **Step 3: Implement.** Replace `rng.chance(0.35)` with the decision: the call's reason is `'starter'`, the pay
  tier clears `TAG_TIER - 0.25 * wn`, the age line holds, no tag this year; if the tag's charge exceeds `budget()`,
  `makeRoom(league, team, value - budget(), p, made)` first; tag if it now fits.
- [ ] **Step 4:** run → PASS.
- [ ] **Step 5:** commit and push `"Re-sign window: the GM tags the star he'd otherwise lose (no coin flip)"`.

---

### Task 4: The checks, sized and measured

**Files:**
- Modify: `scripts/offseason.ts` (tags a season, judged 4–10)
- Modify: `src/engine/offseason/ai.ts` (`TAG_TIER` value only, if Step 2 says so)
- Modify: played-league pins; `src/ui/changelog.ts`, `docs/MVP.md`

- [ ] **Step 1: Tags a season.** In the offseason loop, count this league year's `tag` transactions:
  `check('tags', tags, 4, 10, 0)` on the roster line, citing the NFL's 10, 8, 6 and 9 (2021–24, Sharp Football).
- [ ] **Step 2: Measure.** `npm run offseason -- 6` and `npm run careers` (background). If tags read outside 4–10, move
  `TAG_TIER` once (0.05 a step toward the band) and re-run; at most two moves.
- [ ] **Step 3: Read everything.** Offseason: starters out of football 2.5–4.5% every season, tags 4–10, cap, dead
  money, rosters and the free-agent pool in range. Careers: tree lines, highest starter overall ≤ 13.2, carryover
  (three seasons, aim positive). A line out: stop and report.
- [ ] **Step 4: Engine suite.** `npx vitest run src/engine --maxWorkers=2`; re-take only played-league pins, named in
  the commit.
- [ ] **Step 5: Notes.** The 0.2.27 changelog gains: "Front offices act like real ones: they restructure and cut to keep
  their core, tag the star they'd lose, and good veterans find a club by camp." `docs/MVP.md`'s coaching-tree follow-up:
  what changed and what's left (owners' spending; contenders selling stars). Commit and push.
