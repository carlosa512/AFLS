# Retired Players Slimmed In Place Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A retired player keeps only his career (stats, awards, teams, draft) and his card shows only that, so the
save stops ballooning; play is unchanged.

**Architecture:** One keep-list (`RETIRED_KEEP`) and one function (`slimRetired`) in `roster.ts`, run at the end of the
moments that retire players and once for old saves (`SAVE_VERSION` 101). A census test runs every reader over a played
league's slimmed retirees. The card gets a career view; lists show a dash for a retired player's overall.

**Tech Stack:** TypeScript, React, Vitest, tsx scripts.

**Spec:** `docs/superpowers/specs/2026-11-17-retired-player-slim-design.md` (mock:
`docs/superpowers/specs/2026-11-17-retired-player-card-mock.html`)

## Global Constraints

- Keep list, exactly: `id`, `firstName`, `lastName`, `nameEdited`, `position`, `age`, `heightIn`, `weightLb`, `jersey`,
  `experience`, `draft`, `stats`, `statTeams`, `splitStats`, `origin`, `portrait`, `gear`, `captainSeasons`, `retired`,
  `teamId` (null), `contract` (null). Everything else goes.
- Play unchanged: `npm run fingerprint -- <seed> <n> [--personnel] --slim` gives the same hash before and after.
- `SAVE_VERSION` 101 with a `migrate.ts` step; old saves are never thrown away.
- Slimming runs after the moment's own steps: the new league year's (after `developCoaches`, the ties, `lockVerdicts`)
  and `retireCastoffs`'.
- The card's career view shows public facts only; words follow `docs/UI.md` (`npm run copy`).
- Version 0.4.52 (a fix), changelog entry ≤ 200 characters.

## Review Focus

1. A reader that runs over every player and touches `ratings`, `traits` or `personality` without checking `retired`
   (search, lists, scouting views, `characterNotes`): the census test (Task 2) must reach it.
2. A retired player shown in a list that displays an overall (draft history, team history, records): a dash, never a
   crash (Task 5's test).
3. A save loaded mid-league year: the upgrade slims retirees whose draft grade isn't locked yet only after locking it
   (Task 4).
4. A former player turned coach: his coach record was built before slimming and reads nothing from the player
   afterwards (census).
5. The user's own team's history and the GM screens' draft records reading a retired pick (census plus Task 5).

---

### Task 1: The keep list and the slim fingerprint

**Files:** Modify `src/engine/roster.ts` (export `RETIRED_KEEP: readonly (keyof Player)[]`), `scripts/fingerprint.ts`
(`--slim`: before hashing, every retired player keeps only `RETIRED_KEEP`).

- [ ] **Step 1:** add the constant (data only) and the flag.
- [ ] **Step 2: Baseline on this commit:** `npm run fingerprint -- fp-a 3 --personnel --slim` and
  `npm run fingerprint -- fp-b 3 --slim`, each twice. Expected: two stable hashes; record them in the ledger.
- [ ] **Step 3:** commit `"scripts: a fingerprint of a league with retired players slimmed"`.

### Task 2: The census

**Files:** Create `src/engine/retiredSlim.test.ts` (and a UI test beside the card's tests).

**Interfaces:** Consumes `RETIRED_KEEP`. Produces a test helper `slimAll(league)` (strips every retired player to
`RETIRED_KEEP`) the later tasks reuse.

- [ ] **Step 1: Failing tests:** a league played three seasons, `slimAll`, then:
  - `playWeek` through two more seasons and their offseasons without throwing;
  - every engine function that takes a `Player` and is called on retired players today keeps working (found by
    grepping readers of each dropped field; each one found gets a line in this test or a guard in its task);
  - rendering `PlayerCard` for a retired player, and the screens that list retired players (Stats, draft history,
    team history, records), without throwing.
- [ ] **Step 2:** run; expected FAIL where a reader touches a dropped field. Record each failing reader in the ledger.
- [ ] **Step 3:** fix each engine reader so a retired player never reaches the dropped field (a `retired` check, or the
  stored result it should have read). Screen readers wait for Task 5; mark those tests `.todo` with the screen named.
- [ ] **Step 4:** engine census green; both `--slim` fingerprints match Task 1's baseline. **Step 5:** commit.

### Task 3: `slimRetired` at the moments that retire

**Files:** `src/engine/roster.ts`, `src/engine/offseason/index.ts`, `src/engine/personnel/futures.ts`; test in
`retiredSlim.test.ts`.

**Interfaces:** Produces `slimRetired(p: Player): void` (deletes every key not in `RETIRED_KEEP`).

- [ ] **Step 1: Failing test:** after a played offseason, every retired player's keys ⊆ `RETIRED_KEEP`; a player who
  retired at this new league year still has his draft grade locked (`lockVerdicts`' record) and, if he became a coach,
  his coach record.
- [ ] **Step 2:** run, see it fail. **Step 3:** call `slimRetired` for the year's retirees after `lockVerdicts` in the new
  league year's step, and at the end of `retireCastoffs`.
- [ ] **Step 4:** the test, the census, both `--slim` fingerprints identical. **Step 5:** commit.

### Task 4: The save upgrade

**Files:** `src/engine/generate.ts` (`SAVE_VERSION` 101), `src/engine/migrate.ts`; test in `migrate.test.ts`.

- [ ] **Step 1: Failing test:** a v100 league with retired players carrying every field migrates to keys ⊆
  `RETIRED_KEEP` for each retired player, active players untouched, `league.version === 101`.
- [ ] **Step 2–4:** red, implement (after the existing steps), green; the migrate tests pass. **Step 5:** commit.

### Task 5: The card's career view and the lists

**Files:** `src/ui/screens/PlayerCard.tsx` (a `RetiredCareer` view: header with position, Retired and seasons played,
Honors, Draft, Teams by season from `statTeams`, Career stats), the lists Task 2 named; tests beside them.

- [ ] **Step 1: Failing tests:** a slimmed retired player's card shows Honors, Draft, Teams and Career stats and no
  ratings, makeup, habits, development, combine or injury section; a list row for him shows `—` for the overall.
- [ ] **Step 2–4:** red, implement (reuse the card's existing honors, draft and stat-row parts), green; `ui/ui.test.ts`
  passes; `npm run copy` and read the new lines. Un-`.todo` Task 2's screen tests. **Step 5:** commit.

### Task 6: Checks, docs and the PR

- [ ] `npx vitest run src/engine` and the UI tests; `npm run careers`, `npm run offseason -- 6`, `npm run gm-habits`
  one at a time (nothing out of range); the save size after ten seasons before and after (the probe's save).
- [ ] `npm run screens` of a retired player's card (desktop and phone) for the PR.
- [ ] Docs: CLAUDE.md (a retired player is slimmed: `RETIRED_KEEP`, `slimRetired`), MVP if it lists the save's growth,
  the spec's "What was built", changelog 0.4.52, `package.json` 0.4.52.
- [ ] A fresh reviewer (Review Focus above); fix Critical/Important with a failing test first; push, PR, read CI.
