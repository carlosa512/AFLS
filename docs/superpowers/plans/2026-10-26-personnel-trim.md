# Personnel Trim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring `origin/main` into the practice squad branch and cut the personnel system's NFL detail down to
the rules a player feels, before step 5 (poaching) builds on it.

**Architecture:** All changes stay inside the staged `src/engine/personnel/` module and its callers
(`league.ts`, `offseason/index.ts`, `finance/cap.ts`, `trade/rules.ts`, the personnel screens). The minute
clock becomes settle points: waivers resolve in numbered batches, call-ups file when their game is prepared
and return when its result is recorded. Service time becomes one counter.

**Tech Stack:** TypeScript, Vitest, React (screens), `tsx` audit scripts.

**Spec:** `docs/superpowers/specs/2026-10-26-personnel-trim-design.md`

## Global Constraints

- Ordinary careers (`league.personnel.enabled === false`) must behave exactly as on main: no RNG draws, no
  roster, contract, chart or match changes. The existing foundation fingerprint test in
  `personnel/personnel.test.ts` must keep passing.
- `League` stays plain JSON; save version after this work is **42**, one migration step from main's 41.
- `package.json` version stays at main's **0.1.13**. No changelog entry.
- No `Math.random`; engine stays DOM-free. Salaries in $K.
- Never loosen an audit range to get green. Run `npm run format` before each commit.
- Commits end with the session's attribution lines; push to `claude/confident-mccarthy-4ps246` after each task.
- Local verification per CLAUDE.md: `npm run typecheck` plus touched tests; the personnel audits
  (`npm run waivers -- 2`, `npm run squads -- 2`, `npm run elevations -- 2`) at the end of tasks 3–5.

## Review Focus

1. **A release made after a week's first kickoff** (e.g. between a Thursday game and a Sunday live game)
   must wait for next week's settle, never resolve mid-week or vanish. Test in Task 4.
2. **Reload between settle and kickoff:** a JSON round trip after the week settled must not settle again
   or refile call-ups. Test in Task 4.
3. **A main save at v41** must migrate to v42 with personnel off and play identically. Test in Task 1.
4. **Releases in week 18 or the playoffs** must still settle (next playoff game or `beginOffseason`), never
   be stranded into the next season. Test in Task 4.
5. **A user claim submitted with two cuts** (old save or crafted call) must be rejected with a reason, not
   half-applied. Test in Task 5.

---

### Task 1: Merge main and collapse the save steps

**Files:**
- Modify (conflicts): `src/engine/generate.ts`, `src/engine/migrate.ts`, `src/engine/roster.ts`,
  `package.json`, `package-lock.json`
- Test: `src/engine/personnel/personnel.test.ts`

**Interfaces:**
- Produces: `SAVE_VERSION = 42`; migration step `if (league.version < 42)` that sets
  `league.personnel = initialPersonnelState()` and calls `ensureService(p, league.season)` for every player.

- [ ] **Step 1:** `git fetch origin main && git merge origin/main`.
- [ ] **Step 2: Resolve conflicts.** `roster.ts`: keep main's `buildAutoDepthChart(players, playingAt, staff)`
  and `coachOrder`; keep the branch's list helpers (`rosterList`, `onGameRoster`, `practiceSquad`, squad
  filters) and make the chart builder receive only game-eligible players as the branch does. `migrate.ts`:
  main's v41 (coach quirks) block stays first; replace the branch's v41–45 blocks with one v42 block
  (no `incomplete` marker: that field goes in Task 2). `generate.ts`: both sides' additions, `SAVE_VERSION = 42`.
  `package.json`: version `0.1.13`, keep the branch's four scripts. `package-lock.json`: take main's, then
  `npm install` to regenerate.
- [ ] **Step 3: Add test** `migrates a main v41 save to v42 with personnel off`: build a league, set
  `version = 41`, delete `personnel` and every `p.service`, round-trip through JSON and `migrateLeague`;
  expect `version === 42`, `personnel.enabled === false`, every player has `service`.
- [ ] **Step 4:** `npm run typecheck && npx vitest run src/engine/personnel src/ui src/engine/offseason src/engine/trade` → all pass
  (fix merge fallout only; no behavior changes).
- [ ] **Step 5:** Commit `Merge main into practice squads; one v42 save step`, push.

### Task 2: One service counter and simple squad categories

**Files:**
- Modify: `src/engine/personnel/types.ts`, `service.ts`, `eligibility.ts`, `rules.ts`, `waivers.ts`
  (`waiverApplies`), `elevations.ts` (`elevationMinimum`), `squads.ts` (promotion minimum, line ~140),
  `offseason/index.ts` (year-end roll), `migrate.ts` (v42 step uses the new shape)
- Test: `src/engine/personnel/personnel.test.ts`, `squads.test.ts`

**Interfaces:**
- Produces:
  - `type PlayerService = [through: number, seasons: number, weeks: number]` — `seasons` completed through
    `through`; `weeks` is the credited-week bitmask for season `through + 1`.
  - `ensureService(p: Player, season: number): PlayerService` — initial `[season - 1, experience, 0]`.
  - `creditService(p: Player, season: number, week: number): void` — sets the week bit; ignores
    `season <= through`; throws outside weeks 1–18.
  - `serviceSeasons(p: Player, season: number): number` — completed seasons before `season`, counting a
    not-yet-rolled `through + 1` season when it has ≥ 6 bits and `through + 1 < season`.
  - `rollService(p: Player, season: number): void` — called in `beginOffseason` where `archiveService` was.
  - `ServiceAssignment.list: 'active' | 'injuredReserve' | 'elevated'`; all three credit the week.
- Removed: `ServiceSeason`, `ServiceTotals`, `serviceTotals`, `archiveService`, `activeGames`,
  `historicalActives`, `incompleteServiceSeason`, `creditPostseasonPension`, `PERSONNEL_RULES.salaryCreditedGames`,
  `pensionCreditedGames`. Playoff games credit nothing.

- [ ] **Step 1: Replace the service tests** (delete pension/salary/incomplete/historical tests) with:
  `five games is no season, six is one` (weeks 1–5 → `serviceSeasons(p, s+1) === base`; add week 6 → `base + 1`);
  `IR and elevated weeks count, squad weeks and byes do not`; `the same week twice counts once`;
  `rollService keeps the count and clears weeks`; `playoff games credit nothing`.
- [ ] **Step 2: Replace category tests** with `0 seasons is base, 1–2 developmental, 3+ veteran`, and keep the
  existing 16 / 10 / 6 `squadFit` tests.
- [ ] **Step 3:** run `npx vitest run src/engine/personnel` → new tests fail.
- [ ] **Step 4: Implement** the interfaces above. `squadCategory` reads `serviceSeasons(p, league.season)`.
  `waiverApplies` veteran exemption: `serviceSeasons(p, league.season) >= 4`. `elevationMinimum(l, p)` drops
  the `down` parameter; its tier reads `serviceSeasons`. Promotion minimum in `squads.ts` reads `serviceSeasons`.
  `recordGameService` credits only regular-season games; emergency-QB snap evidence goes (he is on the 53
  and credits as `active`).
- [ ] **Step 5:** `npm run typecheck && npx vitest run src/engine/personnel src/engine/offseason` → pass.
- [ ] **Step 6:** Commit `Personnel: one service counter`, push.

### Task 3: Plain call-up pay and squad injuries

**Files:**
- Modify: `src/engine/personnel/elevations.ts`, `payroll.ts`, `types.ts`, `league.ts`
  (drop `noteElevationInjuries`, `settlePostseasonElevationPay` calls), UI that shows continuation or
  postseason pay (`src/ui/personnel.tsx`, `src/ui/contracts.tsx`, `src/ui/screens/PracticeSquad.tsx`)
- Test: `src/engine/personnel/elevations.test.ts`, `squads.test.ts`

**Interfaces:**
- Removed: `SquadMembership.continuation`, `Elevation.postseasonPay`, `noteElevationInjuries`,
  `settlePostseasonElevationPay`. `payroll.ts`'s display rate helper returns `agreement.weeklyPay`.
- Unchanged: `elevationCost` (regular season: minimum/18 minus squad check; playoffs: 0),
  `elevationPromotionCredit`.

- [ ] **Step 1: Tests:** delete continuation and postseason-pay tests; add
  `an injured squad member keeps his weekly pay and his place` (injure him, settle payroll for two weeks,
  earned grows by exactly 2 × weeklyPay, `p.squad.kind === 'practiceSquad'`) and
  `a playoff call-up charges no cap and records no pay`.
- [ ] **Step 2:** run them → fail (or fail to compile).
- [ ] **Step 3:** Remove the code and fields listed above; strip their copy from screens.
- [ ] **Step 4:** `npm run typecheck && npx vitest run src/engine/personnel src/ui` → pass.
- [ ] **Step 5:** `npm run elevations -- 2` and `npm run squads -- 2` → no invariant failures.
- [ ] **Step 6:** Commit `Personnel: plain call-up pay, no continuation`, push.

### Task 4: Settle points replace the minute clock

**Files:**
- Modify: `src/engine/personnel/calendar.ts` (keep only `gameTime` for kickoff ordering),
  `flow.ts`, `waivers.ts`, `ai.ts`, `elevations.ts`, `gameDay.ts`, `types.ts`, `league.ts`,
  `offseason/index.ts`, `finance/cap.ts`, `trade/rules.ts`; screens `src/ui/screens/Waivers.tsx`,
  `Home.tsx`, `src/ui/personnel.tsx`, `src/ui/contracts.tsx`
- Test: `src/engine/personnel/waivers.test.ts`, `elevations.test.ts`, `src/ui/waivers.test.tsx`

**Interfaces:**
- State: `PersonnelState.clock = { season: number; cutdown: boolean; settledWeek?: number }`;
  `waivers.batch: number` (current open batch, starts 0); `WaiverEntry.batch: number` replaces `deadline`;
  `WaiverResult.batch` replaces `deadline`; `Elevation` loses `deadline` and `revertsAt`.
- `settleWaivers(league: League, autoUser = false): WaiverResult[]` (in `flow.ts`) — closes the open batch
  (`batch++`), AI submits claims, resolves every entry with `batch < state.batch` in one priority pass;
  entries queued during resolution carry the new open batch.
- `settleWeek(league: League): void` — if `clock.settledWeek !== league.week`: `settleWaivers`, then set
  `settledWeek`. Called from `preparePersonnelGame` before anything else.
- `preparePersonnelGame(league, game)`: `settleWeek` → file this game's planned call-ups
  (`planAIElevations`, then planned → active or cancelled with reason, via the existing `elevationProblem`)
  → `lockGameDayLists` → checks → `serviceRoster`. Drops the "precedes the clock" check; keeps
  "play earlier games first".
- `revertElevations(league: League, game: Game): void` — active → reverted for that game; called from
  `recordResult` after `recordGameService`.
- Offseason: `settleOffseasonWaivers` loops `settleWaivers` until nothing is pending (as now, guard kept),
  at each phase advance and at camp continue. `beginOffseason` settles anything left from the season first.
- Deadlines: `waiverApplies` and `trade/rules.ts` use `league.week > TRADE_DEADLINE_WEEK` (from `trade/`)
  instead of `TRADE_DEADLINE_MINUTE`. `gameDayEditProblem` and `cancelElevation` lock on
  `g.personnel?.lists` only. `aiWaiverWindowKey` keys on `season:phase:week:faDay` (no minutes).
- Removed: `DAY`, `WEEK`, `DEADLINE_TIME`, `managementTime`, `personnelClock`'s minute, `personnelTime`,
  `waiverDeadline`, `personnelLabel`, `TRADE_DEADLINE_MINUTE`, `elevationDeadline`, `elevationReversion`,
  `advancePersonnelTo`, `advanceNextPersonnelEvent`, `nextDeadlineBlocker`, `nextWaiverDeadline`
  (replace callers with `pending.length`), `nextElevationEvent`, `settleElevationEvents`,
  `syncPersonnelTime` (keep its `formPracticeSquads` call where it ran), the "Advance roster clock" button.
- UI copy: `waiverDecision(league): string` in `src/ui/personnel.tsx` →
  `'Decided before Week N kickoff'` in season (N = `league.week`, or next week once `settledWeek === week`),
  `'Decided when camp ends'` in preseason before cutdown settles, `'Decided at the next offseason step'`
  otherwise. Call-up confirmation: `'Files at kickoff; back on the practice squad after the game.'`

- [ ] **Step 1: Rewrite clock tests** in `waivers.test.ts` and `elevations.test.ts`: delete minute/notice/
  business-day tests; add
  - `a release before kickoff resolves before that week's first game` (release Tuesday-equivalent, play
    the week's Thursday game first: player has a new club or cleared before that game's lists lock);
  - `a release after the week's first kickoff waits for next week` (Review Focus 1);
  - `settling twice in a week does nothing, also after a JSON reload` (Review Focus 2);
  - `a week-18 release settles at the first playoff game or at beginOffseason` (Review Focus 4);
  - `a call-up files at its game and is back on the squad before the next week`;
  - `a planned call-up can be cancelled until its game is prepared, not after`;
  - `releases after the trade deadline week always use waivers`.
- [ ] **Step 2:** run → fail.
- [ ] **Step 3:** Implement the interfaces; delete the removed functions and fix every caller listed in
  **Files** (`grep -rn "personnelTime\|personnelLabel\|Deadline\b\|advancePersonnelTo" src` returns nothing
  personnel-related afterwards).
- [ ] **Step 4:** Update screens to the new copy; remove the advance button and per-row dates in
  `Waivers.tsx`; update `src/ui/waivers.test.tsx` to the new flow.
- [ ] **Step 5:** `npm run typecheck && npx vitest run src/engine src/ui` → pass.
- [ ] **Step 6:** `npm run waivers -- 2 && npm run squads -- 2 && npm run elevations -- 2` → no failures;
  every opening roster at 53.
- [ ] **Step 7:** Commit `Personnel: settle points replace the minute clock`, push.

### Task 5: One conditional cut per user claim

**Files:**
- Modify: `src/engine/personnel/waivers.ts` (claim validation), `src/ui/screens/Waivers.tsx`,
  `src/ui/rosterMoves.tsx`
- Test: `src/engine/personnel/waivers.test.ts`, `src/ui/waivers.test.tsx`

**Interfaces:**
- Claim validation: when `claim.teamId === league.userTeamId` and `!claim.automatic`:
  `cutIds.length > 1` → `'Name at most one player to release for this claim.'`; `group` set →
  `'Alternative groups are not available for your claims.'`. AI claims unchanged.

- [ ] **Step 1: Tests:** `a user claim with two cuts is rejected and changes nothing` (Review Focus 5);
  `a user claim with one cut and a squad invite still works`; `AI groups still give one award per group`.
- [ ] **Step 2:** run → first fails.
- [ ] **Step 3:** Add the validation; the claim popup offers a single release picker (with the invite
  toggle) and no group control.
- [ ] **Step 4:** `npm run typecheck && npx vitest run src/engine/personnel src/ui` → pass.
- [ ] **Step 5:** Commit `Waivers: one release per claim`, push.

### Task 6: Docs and final checks

**Files:**
- Modify: `docs/PRACTICE_SQUADS.md`, `docs/MVP.md`, `CLAUDE.md` (personnel section if any line names
  removed rules), `docs/superpowers/plans/2026-10-25-practice-squads.md` (progress note)

- [ ] **Step 1:** Rewrite `PRACTICE_SQUADS.md`'s rule registry and step sections to the trimmed rules: one
  service counter, simple categories, settle points, plain call-up pay, squad injuries, one cut per claim,
  emergency QB kept. Drop the CBA salary/pension/postseason tables and minute timings. Keep the step 5–7
  queue.
- [ ] **Step 2:** `MVP.md` line: say the rules were trimmed for play; poaching next.
- [ ] **Step 3:** `npm run format && npm run typecheck`; `npx vitest run` on all touched suites;
  `npm run offseason -- 2` → no out-of-range numbers (personnel off, must match main).
- [ ] **Step 4:** Commit `Docs: practice squad rules after the trim`, push. No PR.
