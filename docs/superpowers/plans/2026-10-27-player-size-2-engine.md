# Player size, phase 2: engine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Size moves play: matchup edges at the engine's matchup points, the rating nudge at creation, and the rare
gem (`playsBig`), with league totals held.

**Architecture:** `size.ts` gains `sizeEdge(p, lever, opp)` (rating points in [−2, 2], zero when both builds sit at
their position medians) and the nudge. `gameSim.ts` adds edges where both players are known (pass game per target;
trenches once per game from both lineups). `traits.ts` rolls `playsBig` on the trait stream. A new `npm run size`
check proves each lever moves its stat and totals hold.

> **Built with two changes:** the nudge was dropped (see the spec's phase 2 "Size and ratings"), and `playsBig` is
> `Player.playsBig` rolled from the player's own stream (v55 rolls it for older saves), not a `Traits` field.

**Spec:** `docs/superpowers/specs/2026-10-27-player-size-design.md` (Phase 2).

## Global Constraints

- Every edge is in rating points, capped at ±2, and **0 when both players are at their own position's median**:
  gaps are measured as deviations from each player's median (`dev = value − SIZE[pos] mean`), so a median WR on a
  median CB is 0 even though WRs run half an inch taller.
- Antisymmetric where both sides are players (`edge(a, b) = −edge(b, a)` before the `playsBig` halving).
- `playsBig` halves a negative edge for its holder, never adds a positive one.
- No new draws on the league or game streams: edges are pure functions of stored builds.
- `npm run sim -- 10`, `npm run audit` must stay green; `npm run size` new and green.
- `SAVE_VERSION` 54 → 55 with a migrate step (`playsBig` absent reads false; nothing to write).
- Branch: `claude/vibrant-pascal-ntlfhz-2`, from phase 1's branch; PR base is phase 1's branch.

## Levers (values the tasks use)

| Lever | Players | Gap (a − b, deviations) | Full ±2 at | Applied |
| --- | --- | --- | --- | --- |
| `contested` | receiver vs his defender | height, inches | 5 in | `pComplete += 0.012 × edge` inside `contested()`; `pInt` exponent `− 0.065 × edge` |
| `press` | receiver vs defender, man, not deep | weight, lb | 30 lb | `sep += 0.5 × edge` |
| `edgeLength` | each EDGE vs the tackle across (RE–LT, LE–RT) | tackle height dev (negated), inches, × rusher speed factor `clamp((speed − 6) / 8, 0.5, 1.5)` | 4.4 in | per game: `pressureDelta += 0.5 × mean edge` |
| `leverage` | each DT vs the guards and center (mean) | blocker height dev − DT height dev, inches (shorter wins) | 4.4 in | per game: `pressureDelta += 0.5 × mean edge` |
| `mass` | OL mean weight dev vs DT+EDGE mean weight dev | lb | 30 lb | per game: `lineDelta += 0.5 × edge` (offense's view) |
| `contact` | ball carrier vs tackler | weight, lb | 30 lb | runs: `pBreak += 0.015 × edge`; catches: `yacSkill += edge` |
| `lanes` | QB alone | height dev, inches | 4 in | `rawAcc += edge` on medium and deep throws |

Batted passes don't exist in the engine: `lanes` is accuracy only (the spec's batted balls are out of scope).

## Review Focus

1. A median-vs-median matchup at every pairing (WR–CB, TE–S, RB–LB, OL–DT) must read 0 (Task 1 test).
2. Lineups missing a slot (no tackle, a 3-DT front, an injured starter) must not throw or produce NaN (Task 3 test).
3. League totals: the nudge plus edges must not move `sim` lines out of range (Task 4 sim).
4. Old saves: `playsBig` absent ⇒ false everywhere (Task 2 migrate test).
5. Audit: every OVR-weighted attribute still "moves play" (Task 4 audit).

---

### Task 1: `sizeEdge` and the nudge in `size.ts`

**Files:** Modify `src/engine/size.ts`; Test `src/engine/size.test.ts`

**Produces:** `type Lever = 'contested' | 'press' | 'edgeLength' | 'leverage' | 'mass' | 'contact' | 'lanes'`;
`sizeEdge(p: Player, lever: Lever, opp?: Player): number`; `massEdge(line: Player[], front: Player[]): number`;
`sizeNudge(ratings: Ratings, z: number): void` (phase 1's, restored: symmetric rounding, full ±1 from |z| ≥ 1).

- [ ] Tests: medians give 0 for each pair; 5'9" CB (69) vs 6'4" WR (76) contested = +2 for the receiver, −2 for the
      corner; antisymmetry; cap at ±2; `playsBig` on the loser halves −2 to −1 and leaves +2; `lanes` for a 5'11" QB
      < 0, 6'5" > 0; `massEdge` of median units = 0; nudge cases from phase 1's tests.
- [ ] Run → FAIL; implement; run → PASS; typecheck; commit `Size: matchup edges and the nudge`.

### Task 2: `playsBig`, the nudge at creation, save v55

**Files:** `src/engine/types.ts` (Traits: `playsBig?: boolean`), `src/engine/traits.ts`, `src/engine/generate.ts`,
`src/engine/migrate.ts`; Test `size.test.ts`, `src/engine/migrate` tests where the save version is asserted.

- [ ] Tests: across 4 000 generated players ~25% (20–30%) of outliers have `playsBig`, no non-outlier does; small CBs
      come out quicker than big ones; `potential >= ovr` for all; a v54 save migrates to 55 unchanged in builds and
      `playsBig` absent.
- [ ] `generateTraits` takes `position` too, draws one more `rng.next()` **last** (so earlier traits are unchanged), and
      sets `playsBig: true` only when `isOutlier` and the draw < 0.25. `generatePlayer` applies the nudge after the
      roll and shifts potential with the overall it moved (phase 1's rebase).
- [ ] Bump `SAVE_VERSION` to 55 and add the (no-op) upgrade step in `migrate.ts` following its pattern.
- [ ] Run; fix seeded expectations only where the world changed (say so in the commit); commit.

### Task 3: Edges in `gameSim.ts`

**Files:** `src/engine/match/gameSim.ts`; Test `src/engine/size.test.ts` (engine-level replay tests live in Task 4's
script).

- [ ] Per-game trench edges computed once when the game starts, for each side's defense against the other's offense
      (`edgeLength`, `leverage`, `mass`), from the lineups (OL spots LT, LG, C, RG, RT by `lineOrder`; EDGE RE/LE).
      Missing players are skipped; an empty pairing gives 0.
- [ ] Pass game: `contested()` adds `0.012 × sizeEdge(receiver, 'contested', defender)`; `pInt` exponent subtracts
      `0.065 × contested edge`; man and not deep: `sep += 0.5 × press edge`; medium and deep: `rawAcc += lanes edge`.
- [ ] Runs: `pBreak += 0.015 × contact edge` against the linebacker whose tackling is read; catches: `yacSkill += contact
      edge` against the tackler.
- [ ] `businessDecision` keeps its absolute 225 lb (a big body is a fact, not a rank): no change.
- [ ] Unit test: a game between two lineups with missing slots runs without NaN (`simulateGame` on a league with a
      team's tackles removed). Commit.

### Task 4: `npm run size` and tuning

**Files:** Create `scripts/size.ts`; modify `package.json` (script), `scripts/check.ts` (register the check, run it
when `size.ts`, `generate.ts`, `traits.ts` or `match/` changes), `CLAUDE.md` (command line + `size.ts` line).

- [ ] The script (fails non-zero on a miss): generated builds match the tables; each lever replayed on the same games
      with one side 2 sd bigger/smaller moves its stat the right way (contested completions, short-route
      completion in man, sacks, interior pressure, yards/carry, broken tackles, mid/deep completion); league totals
      with edges on match totals with edges forced to 0 within the sim's tolerances; no edge outside ±2; `playsBig`
      20–30% of outliers.
- [ ] `npm run sim -- 10`, `npm run audit`, `npm run size`; tune only the application coefficients above if a line
      leaves its range; record each change.
- [ ] Docs: MVP/version (0.2.3), changelog "Size matters on the field"; commit, push, PR (base: phase 1 branch).
