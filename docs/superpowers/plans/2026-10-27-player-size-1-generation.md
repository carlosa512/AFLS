# Player size, phase 1: generation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** New players get heights and weights from position bell curves, and size nudges their speed, agility and
strength.

**Architecture:** A new pure module `src/engine/size.ts` owns the tables, z-scores, the roll and the rating nudge.
`generate.ts` and `training.ts` stop reading `BODY` (removed from `positions.ts`) and call it. No engine (match) reads
size yet; that is phase 2.

**Tech Stack:** TypeScript, Vitest.

> **Built with one change:** the size nudge (`sizeNudge`, its tests and the potential rebase) moved to phase 2;
> see the spec's phase 2 "Size and ratings". Nudge items below were not built.

**Spec:** `docs/superpowers/specs/2026-10-27-player-size-design.md` (sections "The module" and "Phase 1").

## Global Constraints

- Engine code is pure TypeScript: no `Math.random`; all randomness through the seeded `Rng`.
- The roll costs exactly **two** `rng.next()` draws per player, the same as today's two `rng.int` calls.
- Clamp both height and weight at mean ± 2.5 sd; round to whole inches and pounds.
- Ratings stay integers on 1–20.
- `Player` keeps its shape: **no `SAVE_VERSION` bump** in this phase. Existing players keep their sizes.
- Comments explain *why*; match the surrounding style (small pure functions).
- `npm run format` before each commit.
- Branch: `claude/vibrant-pascal-ntlfhz` (this phase's PR). Later phases branch from this one.

## Review Focus

1. **Every generation path:** league creation, draft classes, free agents, Pathway/CFL arrivals all go through
   `generatePlayer`; a player made elsewhere would keep flat sizes. Task 2 greps for other `heightIn:` writers.
2. **Potential below OVR after the nudge:** a nudge can raise OVR above the potential already rolled. Potential must
   move with OVR (Task 2 test).
3. **K and P:** they have tables too and must not hit `undefined` lookups (Task 1 covers every position).
4. **Position move clamp:** a 330 lb OL moved to DT keeps a weight inside DT's ±2.5 sd (Task 2 test).
5. **Stream stability:** extra draws would shift every name and jersey after a player (Task 1 draw-count test).

---

### Task 1: `size.ts` — tables, z-scores, the roll, the nudge

**Files:**

- Create: `src/engine/size.ts`
- Test: `src/engine/size.test.ts`

**Interfaces:**

- Produces:
  - `SIZE: Record<Position, { h: [number, number]; w: [number, number] }>` — [mean, sd] in inches and pounds
  - `sizeLimits(pos: Position): { h: [number, number]; w: [number, number] }` — [lo, hi] at ±2.5 sd, rounded inward
  - `sizeZ(p: Pick<Player, 'position' | 'heightIn' | 'weightLb'>, pos?: Position): { h: number; w: number }`
  - `isOutlier(p, pos?): boolean` — `|h| > 1.3 || |w| > 1.3`
  - `rollSize(rng: Rng, pos: Position): { heightIn: number; weightLb: number }`
  - `sizeNudge(ratings: Ratings, z: number): void` — mutates speed, agility, strength

Table values (from the spec):

| Pos | h | w |
| --- | --- | --- |
| QB | 74.5, 2.0 | 223, 17 |
| RB | 70.5, 2.3 | 214, 17 |
| WR | 72.5, 2.7 | 200, 19 |
| TE | 76.5, 2.0 | 255, 16 |
| OL | 76.75, 2.2 | 313, 18 |
| DT | 75.5, 2.3 | 310, 19 |
| EDGE | 76.5, 2.0 | 277, 21 |
| LB | 74.5, 2.0 | 245, 16 |
| CB | 72.0, 2.3 | 195, 14 |
| S | 72.5, 2.3 | 210, 16 |
| K | 72.0, 1.8 | 200, 12 |
| P | 74.5, 1.8 | 212, 11 |

- [ ] **Step 1: Write the failing tests** in `src/engine/size.test.ts`:
  - `rollSize costs exactly two draws`: two `Rng('x')`; call `rollSize(a, 'CB')` and `b.next(); b.next()`; expect
    `a.next() === b.next()`.
  - `rollSize matches the table`: 20 000 rolls per position from `Rng('size')`; mean height within 0.2 in, mean weight
    within 2 lb, height sd within 10% of `SIZE[pos].h[1]`; every value inside `sizeLimits(pos)`.
  - `height and weight are correlated`: CB sample correlation of (height, weight) between 0.4 and 0.6.
  - `sizeZ of the median is zero`: a CB at 72 in, 195 lb → `{ h: 0, w: 0 }`; at 69.7 in → `h ≈ -1`.
  - `isOutlier`: CB 5'8" (68) → true; CB 72/195 → false.
  - `sizeNudge`: z = 0 leaves ratings unchanged; z = −2 → speed +1, agility +1, strength −1; z = +2 → the reverse;
    z = −0.4 → unchanged; z = +1 and z = −1 nudge by the same amount in opposite directions; ratings at 20 or 1 stay inside 1–20.
- [ ] **Step 2: Run** `npx vitest run src/engine/size.test.ts` — expect FAIL (module missing).
- [ ] **Step 3: Implement `size.ts`.**
  - `rollSize`: one Box–Muller pair from two `rng.next()` calls (guard `u === 0` the way `Rng.normal` does, without
    an extra draw when it isn't 0): `zh = r·cos θ`, `z2 = r·sin θ`, `zw = 0.5·zh + 0.866·z2`; clamp each z to ±2.5,
    scale, round, then clamp to `sizeLimits`.
  - `sizeNudge`: `x = clamp(-z / 2, -1, 1)`, `d = Math.sign(x) * Math.round(Math.abs(x))` (symmetric: full ±1 from |z| ≥ 1; plain `Math.round` would round −0.5 and +0.5 differently); speed += d, agility += d,
    strength −= d, each clamped 1–20. Light/short is negative z, so it gets the speed.
  - Doc comment on the module: what it owns, and that `sizeZ` is the only z-score in the codebase.
- [ ] **Step 4: Run** the test file — expect PASS. `npm run typecheck` — clean.
- [ ] **Step 5: Commit** — `git add src/engine/size.ts src/engine/size.test.ts` ·
      `Size: position bell curves, z-scores and the size nudge`

### Task 2: Generation and position moves use `size.ts`

**Files:**

- Modify: `src/engine/generate.ts:111-140` (`generatePlayer`)
- Modify: `src/engine/training.ts:273-274` (weight clamp on a move)
- Modify: `src/engine/positions.ts:147-160` (delete `BODY`, fix imports)
- Test: `src/engine/size.test.ts`

**Interfaces:**

- Consumes: `rollSize`, `sizeZ`, `sizeNudge`, `sizeLimits` from Task 1.

- [ ] **Step 1: Write the failing tests** (append to `size.test.ts`):
  - `generatePlayer rolls from the bell curve`: 2 000 CBs via `generatePlayer(new Rng('g' + i), {...})` with the
    spec the existing tests use (copy from `engine.test.ts`); 11–17% are 69 in or shorter (the curve gives 13.9%); none under
    `sizeLimits('CB').h[0]`.
  - `small corners come out quicker`: across those CBs, mean speed of `sizeZ` composite < −1 is higher than for > +1.
  - `potential never trails overall`: for 2 000 players of mixed positions, `p.potential >= playerOvr(p)`.
  - `a position move clamps to the new curve`: OL at 335 lb moved with `changePosition` (or the helper
    `training.test.ts` uses) to DT stays ≤ `sizeLimits('DT').w[1]`; the existing training move test still passes.
- [ ] **Step 2: Run** them — expect FAIL.
- [ ] **Step 3: Implement.**
  - In `generatePlayer`, replace the two `rng.int` calls with `rollSize(rng, position)` at the same point in the
    draw order. Then nudge with `z = (zh + zw) / 2` from `sizeZ`, recompute `ovr` with `overall(ratings, position)`,
    and shift `potential` by the change in ovr (clamped to `[ovr, 20]`), so a nudge never leaves potential below
    overall. Name both steps in one *why* comment.
  - In `training.ts`, clamp weight with `sizeLimits(to).w`.
  - Delete `BODY` and its import sites. `grep -rn "heightIn:" src/engine` must show only `generatePlayer` writing new
    players (migrations and fixtures excepted); report any other writer in the PR.
- [ ] **Step 4: Run** `npx vitest run src/engine/size.test.ts src/engine/training.test.ts src/engine/engine.test.ts`
      and `npm run typecheck` — all PASS. If a seeded expectation elsewhere breaks only because the world changed,
      update the expected value and say so in the commit message; if it breaks on a rule, stop and report.
- [ ] **Step 5: Run** `npm run sim -- 10` — every league stat stays inside its range (the nudge is symmetric, so totals
      should not move). If one leaves, stop and report the line.
- [ ] **Step 6: Commit** — `Size: new players roll from position bell curves`

### Task 3: Docs, version, PR

**Files:**

- Modify: `CLAUDE.md` (Architecture: one line for `size.ts` next to `generate.ts`)
- Modify: `package.json` (0.2.1 → 0.2.2) and `src/ui/changelog.ts` (new entry, newest first)

- [ ] **Step 1:** Add to CLAUDE.md under the engine list:
      `` `size.ts` height and weight: position bell curves (`SIZE`), the roll, z-scores (`sizeZ`, the only one) and the
      size nudge on speed, agility and strength. Spec: `docs/superpowers/specs/2026-10-27-player-size-design.md` ``
- [ ] **Step 2:** Changelog entry, a player's words: title "Real NFL builds"; "New players now come in NFL shapes:
      most corners stand around six feet, but a 5'9" one turns up now and then, usually a step quicker for it.
      Linemen, backs and receivers follow their own curves. Players already in your league keep their builds."
- [ ] **Step 3:** `npm run format`, `npm run typecheck`, `npx vitest run src/ui` (changelog test, if any). Commit
      `Size phase 1: docs and 0.2.2`; `git push -u origin claude/vibrant-pascal-ntlfhz`.
- [ ] **Step 4:** Open the PR to `main`: title "Player size, phase 1: bell-curve generation"; body lists what changed,
      the sim result, and that phases 2–4 stack on this branch.
- [ ] **Step 5:** Read CI on the PR; fix anything red before calling it ready.
