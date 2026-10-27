# Practice Squad Lifecycle and Activation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Squads survive the year (futures deals), AI clubs and your staff use them, the mail and roster views
explain them, and every new career gets them, closing MVP #12 at 0.2.0.

**Architecture:** New `src/engine/personnel/futures.ts` and `src/engine/personnel/activation.ts`; hooks in
`injuries.ts` (`coverPositions`), `offseason/index.ts` (`beginOffseason`), `personnel/flow.ts`; mail in
`inbox.ts`; UI in `PracticeSquad.tsx`, `Roster.tsx`, `NewGame.tsx`.

**Tech Stack:** TypeScript, Vitest, React, `tsx` audits.

**Spec:** `docs/superpowers/specs/2026-10-26-practice-squad-lifecycle-activation-design.md`

## Global Constraints

- Fog of war: AI reads `perceive`, screens `viewOf`/`Ovr`/`ScoutedCeiling`; never `potential` or true ratings.
- Ordinary careers (personnel off) unchanged, except New Game now creates careers with it on.
- `SAVE_VERSION = 49`, empty upgrade step. No `Math.random`. Salaries $K. `npm run format` before commits.
- Staff never promotes, signs to the 53 or cuts for the user.
- Never loosen an audit range; the two roster checks become strict.

## Review Focus

1. A futures-kept player released, poached or promoted before the new league year: no contract is created for a
   player no longer on that squad. Test in Task 1.
2. Turning practice squads on mid-offseason (after free agency, before camp): squads form at camp, cap stays legal.
   Test in Task 6.
3. A short-absence skip at a position where the squad player's call-ups are used up: the club must still sign
   cover. Test in Task 2.
4. User with staff handling off: no squad refill, call-up or futures choice is made for them. Test in Task 3.
5. Mail on reload or a second `deliverMail`: no duplicates. Tests in Task 4.

---

### Task 1: Futures deals (engine, AI choice, mail) and save 49

**Files:** create `src/engine/personnel/futures.ts`, `futures.test.ts`; modify `personnel/types.ts`, `squads.ts`
(`expireSquadContracts`), `generate.ts`, `migrate.ts`, `inbox.ts`.

**Produces:**
- `futuresWindowOpen(league, teamId): boolean` — club's season over: phase `'complete'`, or `'playoffs'` and the
  club has no unplayed game this season.
- `futuresPicks(league, teamId): number[]` — own squad players whose `perceive(...).potMid ≥` the overall
  (`perceive`) of the last player at his position inside the club's 53 depth (`depthChart[pos][n-1]` within
  `activeRoster`), best first, max 10.
- `setFuturesKeep(league, teamId, playerId, on)`; `futuresKept(league, teamId): number[]` (marks, else picks when
  staff/AI decides; empty for the user with `autoSquad === false` and no marks).
- `signFuturesDeals(league)` — called at the top of `expireSquadContracts`: for every club, kept players still on
  its squad get a minimum one-year contract for `season + 1` (via `squadMinimumContract`-style builder with next
  year's cap) and leave the squad; the rest expire as today.
- Mail `futures:season:teamId` (director, when the window opens, listing picks) and `futuresKept:season` (at the new
  league year, who was kept).

- [ ] Tests: AI picks only reach the backup bar, at most 10; marks survive JSON reload; at `beginOffseason` kept
  players hold next-season minimum contracts and are on the roster, others are free agents; a kept player who left
  the squad gets nothing; mails once each. Watch fail; implement; pass `npx vitest run src/engine/personnel/futures.test.ts`.
- [ ] Commit `Personnel: futures deals keep squad players into next season`.

### Task 2: AI injury cover uses the squad

**Files:** `src/engine/injuries.ts` (`coverPositions`), `personnel/futures.test.ts` → new `personnel/cover.test.ts`.

**Produces:** `squadCover(league, team, pos): 'callup' | Player | null` in a new `personnel/cover.ts`:
`'callup'` when every unavailable player at `pos` has `injury.estimate[1] ≤ 2` and a healthy own squad player there
has `elevationUses < 3`; a `Player` (own squad, best by own read) for a long absence when his read ≥ the best free
agent's; else `null`. In `coverPositions` (personnel on, `sign`): `'callup'` → `stuck.add(pos)`; a player →
`promoteSquadPlayer` when `open`, then continue.

- [ ] Tests: two-week injury + squad player → no signing; uses exhausted → signs; IR absence + good squad player →
  promoted; worse than the free agent → free agent. Fail, implement, pass. Commit `AI injury cover uses the practice squad`.

### Task 3: Your staff handles the squad

**Files:** `types.ts` (`Team.autoSquad?: false`), `personnel/flow.ts` (`syncPersonnel` refill, `fileElevations`
plans), `futures.ts`, `PracticeSquad.tsx` toggle.

**Produces:** `staffHandlesSquad(league): boolean` (personnel on and `autoSquad !== false`). When true:
`formPracticeSquads(league, true)` for refills in season, `planAIElevations(league, game, true)` for your games,
futures picks by default.

- [ ] Tests: on → your squad refills to 16 and a short-handed game gets your call-up; off → neither; never a
  promotion or cut for you. Fail, implement, pass. Commit `Your staff handles the practice squad by default`.

### Task 4: Mail

**Files:** `inbox.ts`, `personnel/mail.test.ts` (or `inbox.test.ts`).

**Produces:** `waiverMail` — ids `waiverClaim:season:entryId` (won or lost, from your claims) and
`waiverOut:season:entryId` (your released player claimed or cleared); `callupsUsedMail` — `callups:season:playerId`
when a squad player of yours reaches 3 regular-season uses. Director or head coach voice, one sentence or two, player
and team actions. `mailSubject` cases for each.

- [ ] Tests: each mail once after two deliveries and a reload. Fail, implement, pass. Commit `Inbox: waiver and call-up notices`.

### Task 5: Roster view switch

**Files:** `src/ui/screens/Roster.tsx`, `src/ui/personnel.tsx` (shared squad table bits), `ui/squads.test.tsx`.

- [ ] A segmented control "53 · Practice squad" (aria-pressed buttons, like the waiver filters). The squad view lists
  the chosen club's squad with `PlayerLink`, position, age, `Ovr`, `ScoutedCeiling`, eligibility, and a link to the
  squad desk; hidden when personnel is off. Test: renders for your club and another, no `player.ratings` leak (screen
  contract tests stay green). Browser check desktop + phone. Commit `Roster: practice squad view`.

### Task 6: Switching it on

**Files:** create `personnel/activation.ts`, `activation.test.ts`; modify `NewGame.tsx` (`personnel: true`),
`offseason/index.ts` (offer at `beginOffseason`), `inbox.ts` (offer mail `personnelOffer:season`),
`PracticeSquad.tsx` (button when off).

**Produces:** `canTurnOnPersonnel(league): string | null` (off, offseason phase before `preseason`), and
`turnOnPersonnel(league)` (enable, `ensureWaivers`, `ensureService` for all players; squads form at camp as in
enabled careers).

- [ ] Tests: a new career from New Game's options has it on; an old save offered once at the offseason; turning on
  before camp leads to 32 squads after camp and legal caps; refused mid-season. Fail, implement, pass.
  Commit `Practice squads for new careers; a one-time switch for existing ones`.

### Task 7: Audit, MVP, release

**Files:** `scripts/offseason.ts`, `scripts/offseason-league.ts` (`personnel: true`), `docs/MVP.md`,
`docs/PRACTICE_SQUADS.md`, `docs/GAME_DESIGN.md` (if it lists #12), `package.json` 0.2.0, `src/ui/changelog.ts`.

- [ ] Run `npm run offseason -- 6` with practice squads on. Make "roster min" strict at ≥ 50 and "under 53 with
  room" strict at 0; drop those known-issue lines. If they fail, fix the engine (AI refill/futures), never the band.
- [ ] Docs, version, changelog ("Practice squads"). Final review (fresh reviewer). PR, CI green.
