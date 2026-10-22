# Team strength through your scouts — implementation plan (PR 3 of the UI consistency spec)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No screen shows a club's true unit ratings: Roster and Home read them through the user's scouts, and New Game shows only public reputation.

**Architecture:** `perceivedTeamRatings` in `engine/scouting.ts` averages the viewer's `perceive` of each starter the way `teamRatings` averages the truth, and returns each unit as a value with a range and whether the scouts know the starters well. The user's own club delegates to `teamRatings`, so it stays exact. A `TeamUnit` component in `ui/scouting.tsx` renders a unit the way `Ovr` renders a player: exact, an estimate chip, or a range with "Little film". New Game drops unit numbers for the franchise's ten-year win share (`TeamSeed.winPct`). A grep test bans `teamRatings` from `src/ui/`.

**Tech Stack:** TypeScript engine (pure, no `Math.random`), React UI, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-22-ui-consistency-design.md`, section "PR 3 — Team strength through your scouts".

## Global Constraints

- The engine keeps `teamRatings` (trade value, contract market) unchanged; it is never imported by `src/ui/`.
- Same unit weights as `teamRatings`: overall = 0.2 QB + 0.35 offense + 0.4 defense + 0.05 kicking; starters from `starters()`, out-of-position knock from `knockFor`.
- "Well known" means the starters' mean `knowledge` ≥ 0.7, the floor the opposition report already uses (`inbox.ts` `groupKnowledge … >= 0.7`).
- No `League` shape change, so no `SAVE_VERSION` bump.
- UI-only rules from PR 1–2 still hold; `npm run format`, `npm run typecheck`, `npx vitest run src/ui src/engine/scouting.test.ts` green before each commit.
- Version: `0.1.7` → `0.1.8` (last number), one line under MVP item 14.

## Review Focus

1. The user's own club must read exactly as before (same numbers as `teamRatings`). Pinned in Task 1.
2. A rival whose every starter the user has fully scouted reads at his true strength, within rounding. Pinned in Task 1.
3. A starter lined up out of position counts at his perceived value there, knock included, not at his own position. Pinned in Task 1.
4. A unit the scouts barely know shows a range and "Little film", never a single confident number. Pinned in Task 2.
5. A mod league with no `winPct` must still render New Game (no number, no crash). Pinned in Task 3.

---

### Task 1: `perceivedTeamRatings` in the engine

**Files:** Modify `src/engine/scouting.ts` (after `viewCache`); Test `src/engine/scouting.test.ts`.

**Interfaces:** Produces

```ts
export const WELL_KNOWN = 0.7;
export interface UnitView { value: number; lo: number; hi: number; exact: boolean; known: boolean }
export interface TeamView { overall: UnitView; qb: UnitView; offense: UnitView; defense: UnitView; special: UnitView }
export function perceivedTeamRatings(league: League, viewerId: number, team: Team): TeamView
```

Per starter at slot `pos`: `v = perceive(league, viewerId, p)`; his value is `v.ovr` at his own position, else `overall(view values, pos)`; minus `knockFor(p, pos)`; his lo/hi are that value minus `v.ovr - v.ovrLo` and plus `v.ovrHi - v.ovr`. A unit averages value, lo and hi over its starters; `known` is mean knowledge ≥ `WELL_KNOWN`. `viewerId === team.id` returns `teamRatings` with lo = hi = value, `exact: true`, `known: true`.

- [ ] **Step 1: Failing tests** in `scouting.test.ts` (`describe('perceived team strength')`), on `createLeague({ seed: 'units' })`:
  - own club: every unit `exact`, `value` equals `teamRatings(league, own)[unit]`.
  - fully scouted rival: set `league.knowledge[id] = 1` for every starter of team `r ≠ user`; each unit within 0.05 of `teamRatings`.
  - every rival: `lo <= value <= hi`, `exact === false`.
  - out of position: put a rival's backup CB first on the S depth chart; the defense unit moves by the same sign as `teamRatings`' defense does.
- [ ] **Step 2: Run** `npx vitest run src/engine/scouting.test.ts -t "perceived team"` — expected FAIL, not exported.
- [ ] **Step 3: Implement.** Import `starters`, `teamRatings` from `./roster` (scouting already imports `slotOf` from it) and `knockFor` from `./familiarity`.
- [ ] **Step 4: Run** the file and `npm run typecheck` — expected PASS.
- [ ] **Step 5: Commit** — `Scouting: a team's strength as our scouts read it`.

### Task 2: Roster and Home read it

**Files:** Modify `src/ui/scouting.tsx` (add `TeamUnit`), `src/ui/screens/Roster.tsx:332,394-409`, `src/ui/screens/Home.tsx:67-97`; Test `src/ui/links.test.tsx`, `src/ui/ui.test.ts`.

**Interfaces:** Produces `export function TeamUnit({ u }: { u: UnitView }): ReactElement` — exact: `<Rating value decimals={1}>`; known: the `Ovr` estimate chip (`rating est`, title "Scouted estimate: lo–hi"); not known: `lo–hi` plus `<small className="muted">Little film</small>`. Roster's Overall/QB/Offense/Defense facts and Home's two number columns render `TeamUnit`; Home's bar widths use `u.value`.

- [ ] **Step 1: Failing tests:** `links.test.tsx` renders `TeamUnit` for `{exact}`, `{known}` and `{!known}` units and asserts, in turn, no `est`; `rating est`; `Little film` with an en-dash range. `ui.test.ts` screen contract adds: no file in `src/ui` imports `teamRatings`.
- [ ] **Step 2: Run** — expected FAIL.
- [ ] **Step 3: Implement**; Roster and Home call `perceivedTeamRatings(league, league.userTeamId, team)`.
- [ ] **Step 4: Run** `npm run typecheck && npx vitest run src/ui` — the grep still fails on `NewGame.tsx` (Task 3); every other test passes.
- [ ] **Step 5: Commit** — `UI: Roster and Home show team strength as your scouts read it`.

### Task 3: New Game shows public reputation

**Files:** Modify `src/ui/screens/NewGame.tsx`; Test `src/ui/ui.test.ts` (the Task 2 grep goes green).

The team row drops `QB · OFF · DEF` and the `Rating`; it shows `Last 10 years: 62% wins` from `TEAM_SEEDS[team.id].winPct` (rounded percent), nothing when undefined, then the owner note as before. The intro paragraph loses nothing.

- [ ] **Step 1:** The Task 2 grep test is the red test (it lists `NewGame.tsx`).
- [ ] **Step 2: Implement**; add a `ui.test.ts` case: `TEAM_SEEDS.every((s, i) => createLeague({ seed: 'x' }).teams[i].abbrev === s.abbrev)` (the id → seed lookup the screen relies on).
- [ ] **Step 3: Run** `npm run typecheck && npx vitest run src/ui` — expected PASS.
- [ ] **Step 4: Commit** — `UI: New Game shows each franchise's record, not its true ratings`.

### Task 4: Version and MVP line

- [ ] `0.1.8` in `package.json` and `package-lock.json` (two fields); under MVP item 14: `Team strength reads through your scouts (perceivedTeamRatings); no screen imports teamRatings.`
- [ ] `npm run format && npm run typecheck && npx vitest run src/ui src/engine/scouting.test.ts && npx prettier --check .` — clean. Commit `0.1.8: team strength through your scouts`, push.

## Deviations from the spec, decided here

- New Game: a new league has no history, so "last season's record and playoff finish" cannot exist; the franchise's real ten-year win share (`TeamSeed.winPct`, already public and what tilts the opening rosters) stands in.
- Ranges are the mean of the starters' ranges, not a narrower combined interval: conservative, and the same idiom as a player's range.
