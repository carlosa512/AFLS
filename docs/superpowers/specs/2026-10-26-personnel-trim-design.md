# Personnel trim: fewer NFL rules, same game

Date: 2026-10-26 · Branch: `claude/confident-mccarthy-4ps246` (from `feature/practice-squad-elevations`)

## Why

Steps 1–4 of the practice squad plan (`docs/superpowers/plans/2026-10-25-practice-squads.md`) model CBA
detail the player never feels: three kinds of service credit, a minute-level Eastern clock, call-up pay by
credited service, postseason benefit rules. `docs/PRACTICE_SQUADS.md` puts fun and low micromanagement first,
and every rule is code that step 5 (poaching and protection) and step 6 (lifecycle) must build on. Trim
before building further. The feature stays off for ordinary careers (`createLeague({ personnel: true })`).

## Order of work

1. **Merge `origin/main` into the branch.** Resolve `generate.ts`, `migrate.ts`, `roster.ts` (main's
   coach-ordered depth charts win; personnel's list filters wrap them), `package.json`, `package-lock.json`
   (regenerate with `npm install`). Version: take main's 0.1.13 (its changelog test ties the version to
   `ui/changelog.ts`); the PR that finally lands the feature bumps it, not this branch.
2. **Collapse the save steps.** Main owns v41 (coach quirks). The branch's v41–45 steps become one v42 step
   that builds the trimmed shape from a v41 save. Saves made on the GPT branch (v41–45 without coach quirks)
   are development-only and are not supported.
3. **The trims below**, each with its tests updated in the same commit.
4. Then step 5 (poaching and the two automatic protections), on its own spec.

## Trims

### 1. Service time: one counter

- `PlayerService` becomes `[throughSeason, seasons, weeksThisSeason]`: completed seasons with 6+
  regular-season games on the active list or IR, plus a bitmask of this season's credited weeks.
  The season rolls into `seasons` at year end.
- Removed: salary and pension credit, postseason pension, the dressed/active-weeks mask, the
  estimated and incomplete flags, `archiveService`'s bit packing, `historicalActives`.
- Initial value: `experience` (as now), no "estimated" flag.
- Users of the old totals: the waiver veteran exemption reads `seasons >= 4` (completed seasons only, as
  now); call-up pay and promotion minimums read `seasons`.
- `PERSONNEL_RULES` drops `salaryCreditedGames` and `pensionCreditedGames`.

### 2. Squad eligibility

`squadCategory`: 0 seasons → base, 1–2 → developmental, 3+ → veteran. Limits unchanged (16 places, 10
expanded, 6 veterans). The "one season with under 9 dressed games" route to base is removed.

### 3. Clock: weekly settlement

- Delete the minute clock (`calendar.ts` minute math, `personnelLabel`, `waiverDeadline`,
  `elevationDeadline`, `elevationReversion`, `advanceNextPersonnelEvent`, `nextDeadlineBlocker`, the
  "Advance roster clock" button).
- `PersonnelState.clock` keeps only `{ season, cutdown }`. A waiver entry stores the stage it was posted in
  as a batch number (`batch`) instead of a minute deadline; a settle resolves every batch posted before it.
- **Settle points:** (a) before the first game of a week is prepared (batch or live), (b) each offseason
  phase advance, (c) the camp continue action (cutdown wire). At a settle point: AI submits claims,
  every pending entry resolves in one batch by priority, then AI cutdown replacements post for the next
  stage. Users can edit claims any time before the settle point.
- Trade deadline: the existing week-based deadline, no minute check in `trade/rules.ts`.
- Call-ups: planned any time before the week's settle point, filed when their game is prepared (AI plans its own
  then), returned automatically when the game's result is recorded. Game-day lists lock at kickoff.
- Screens say "Decided before Week N kickoff" / "Decided when camp ends" instead of clock times.

### 4. Call-up pay

- Regular season: each filed call-up charges 1/18 of the player's NFL minimum salary for his `seasons`,
  replacing that week's squad check (as now). Same-week promotion still absorbs it.
- Postseason: no cap charge, no extra pay record. `postseasonPay` is removed.
- Removed: injury salary continuation for call-ups and `SquadMembership.continuation`.

### 5. Squad injuries

An injured squad member keeps his weekly squad pay and stays on the squad. No separate continuation
record, no squad-injured service credit.

### 6. Waiver claims

User claims: ranked list, at most **one** conditional cut per claim, with the optional invite back to the
squad. Alternative groups (`WaiverClaim.group`) stay for AI only and leave the user UI.

## Kept as is

16-player squad and category limits, the squad pay table, 2 call-ups per game and 3 regular-season uses per
player per club, the same-club re-sign block, the automatic 47/48 game-day list with optional manual edits,
**the emergency third QB**, AI claims and squad offers on their own scouting read, waiver priority, the
contract-preserving waiver assignment and cap holds, and the audit scripts (`waivers`, `squads`,
`squad-careers`, `elevations`).

## Testing

- Update `personnel/*.test.ts` and the UI tests to the new shapes; delete tests for removed rules.
- New: a release posted mid-week resolves before that week's first kickoff (Thursday included), never
  after a game it could have affected; a call-up returns after its game and is gone before the next week.
- `npm run typecheck`, the touched tests, then `npm run waivers -- 2`, `npm run squads -- 2`,
  `npm run elevations -- 2`. CI on the branch once a PR exists (not yet).
- Update `docs/PRACTICE_SQUADS.md` to describe the trimmed rules (drop the CBA tables we no longer model).
