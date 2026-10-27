# Player size, phase 3: spot fit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Size decides where the starters line up, and the coaches can suggest a move for a player's build.

**Architecture:** `roster.ts` reorders the starters of CB, WR and DT by build after `coachOrder` (`spotOrder`), and
`lineOrder` weighs a tackle's length; both read the same `sizeEdge` the engine plays with, against `typicalAt(pos)`
(a median build). `training.ts` gains a move reason, `build`, read by the same planner for you and the AI.

**Spec:** `docs/superpowers/specs/2026-10-27-player-size-design.md` (Phase 3).

## Global Constraints

- Who starts never changes: only the order among the starters; the bench keeps its order.
- A hand-sorted chart is never reordered (`spotOrder` runs inside `buildAutoDepthChart` only).
- `build` follows the planner's rules: no move without a reason, cut-down day, cooldown, learning time.
- Branch `claude/vibrant-pascal-ntlfhz-3` from phase 2; PR base is phase 2's branch.

## Review Focus

1. A team with fewer than three healthy corners or receivers, or one tackle: `spotOrder` must not drop or duplicate
   anyone (test: who starts never changes).
2. An elite small corner keeps his outside spot: ratings outweigh a ±2 edge (test).
3. AI teams use the planner too: `build` must stay rare (strict: outlier |z| > 1.3 where he is, |z| ≤ 0.8 where he'd
   go, a starter there, a room that can spare him); `npm run training` checks the invariants.

---

### Task 1: `spotOrder` and a tackle's length

**Files:** `src/engine/roster.ts`, `src/engine/size.ts` (`typicalAt`); Test `src/engine/size.test.ts`

- [x] Tests: tall corners outside, small at nickel, bench untouched; an elite small corner stays outside; big
      receivers at X/Z, small in the slot; heavier DT at NT (second spot); the long lineman plays tackle when
      protection is level; who starts never changes.
- [x] CB: top two of the three starters by `coverage` + contested edge against a typical WR; WR: by `deepRoutes` +
      contested edge against a typical CB; DT (two starters): lighter first, heavier at the nose spot.
- [x] `lineOrder`: tackles by `passPro` + `edgeLength` edge against a typical EDGE.

### Task 2: the `build` move reason

**Files:** `src/engine/types.ts`, `src/engine/training.ts` (`conversionRead`, `reasonWords`, the GM weighting),
`src/engine/inbox.ts` (`reasonLine`, `MOVE_REASONS`); Test `src/engine/size.test.ts`

- [x] Test: a 242 lb backup safety with a linebacker's game reads `build` toward LB; at a median safety's build he
      does not.
- [x] Strength 0.6; the GM weighting reads it at 0.6; news "his build fits LB"; the coaches' line "His build fits LB".

### Task 3: checks, docs, PR

- [ ] `npm run training`, `npm run size`; CI runs the rest.
- [ ] Version 0.2.4, changelog; PR on phase 2's branch.

The coach's note on a hand-sorted chart ("he's a nickel") is a screen: it moved to phase 4.
