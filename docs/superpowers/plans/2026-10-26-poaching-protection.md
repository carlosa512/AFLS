# Poaching and Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Other clubs can sign your unprotected practice squad players to their 53 (and you theirs), with two
automatic protections a week, a three-week pay guarantee, AI poaching and a mail when you lose someone.

**Architecture:** One new module, `src/engine/personnel/poaching.ts`, run from the weekly settle point
(`settleWeek` in `flow.ts`) after waivers. State lives in `league.personnel.poaching`. The squad desk gets the
controls; `inbox.ts` gets one mail.

**Tech Stack:** TypeScript, Vitest, React, `tsx` audit scripts.

**Spec:** `docs/superpowers/specs/2026-10-26-poaching-protection-design.md`

## Global Constraints

- Ordinary careers (`personnel.enabled === false`) unchanged: the personnel fingerprint test keeps passing.
- `SAVE_VERSION = 48`, an empty upgrade step (the new field is optional and lazy).
- Ratings are read through `perceive` (AI) and `viewOf` (UI). Never `potential`, `playerOvr` for another club's
  decision, or `player.ratings` in a screen.
- Salaries in $K. No `Math.random`. `npm run format` before each commit; attribution lines on every commit.
- Version 0.1.15 with one changelog entry (GM name and age), MVP line and `docs/PRACTICE_SQUADS.md` updated.

## Review Focus

1. **Reload between the settle and kickoff:** protections and results must not re-pick or re-resolve. Test in Task 1/2.
2. **A protected player promoted by his own club** frees no slot until next week. Test in Task 1.
3. **Poached player had a planned call-up with his old club** — cancelled, not filed for the wrong club. Test in Task 2.
4. **Cut a poached player in week N+1** — the remaining guaranteed weeks become dead money, not more, not zero. Test in Task 2.
5. **AI club at 53 or short of cap** never poaches and never cuts to make room. Test in Task 3.

---

### Task 1: State, save step and protection

**Files:** Create `src/engine/personnel/poaching.ts`, `src/engine/personnel/poaching.test.ts`. Modify
`personnel/types.ts`, `generate.ts` (SAVE_VERSION 48), `migrate.ts` (v48 no-op step).

**Produces:**
- types: `PoachOffer { playerId: number; teamId: number; years: 1 | 2 }`, `PoachResult { playerId; fromTeamId;
  toTeamId: number | null; season; week; reason?: string }`, `PersonnelState.poaching?: { season; offers;
  results; locked: { week: number; ids: Record<number, number[]> }; pins: Record<number, number[]> }`.
- `ensurePoaching(league): NonNullable<PersonnelState['poaching']>` (resets offers/results/locked on a new season,
  keeps pins for players still on that club's squad).
- `protectionPicks(league, teamId): number[]` — pins still on the squad first (max 2), then by
  `perceive(league, teamId, p).potMid` desc, id asc, up to 2.
- `lockProtections(league): void` — if `locked.week !== league.week`: `locked = { week, ids: per club picks }`.
- `protectedIds(league, teamId): number[]` — the locked list filtered to players still on that squad.
- `setPin(league, teamId, playerId, on: boolean): void` — throws if not own squad player or a third pin.

- [ ] Tests: `auto protection takes the two best scouted ceilings`; `a pin replaces the lower auto pick`;
  `a pin after the lock waits until next week`; `a protected player who leaves frees no slot this week`;
  `locking twice in a week and after a JSON reload changes nothing`; `a third pin is refused`;
  `a v47 save migrates to v48 untouched` (in personnel.test.ts). Watch them fail.
- [ ] Implement; `npx vitest run src/engine/personnel/poaching.test.ts src/engine/personnel/personnel.test.ts` passes.
- [ ] Commit `Personnel: weekly squad protection`.

### Task 2: Poaching offers, resolution and the three-week guarantee

**Files:** `poaching.ts`, `poaching.test.ts`, `squads.ts` (share the contract builder), `flow.ts`.

**Produces:**
- `poachContract(league, p, years: 1 | 2): Contract` — minimum for `serviceSeasons`, year 1 prorated like
  `squadPromotionContract`, `years[0].guaranteed = min(base, ceil(3 × salary / 18))`; kind `'minimum'`.
- `poachProblem(league, offer): string | null` — regular season; target on another club's squad with an
  agreement; not protected (locked list); not your opponent this week (`nextTeamGame` of either club);
  signing club under 53 on `activeRoster` and `capSpace ≥ capHit(poachContract, season)`; one offer per club per player.
- `submitPoachOffer`, `cancelPoachOffer(league, teamId, playerId)`.
- `resolvePoaching(league): PoachResult[]` — group offers by player; recheck each with `poachProblem`; winner by
  years desc then `waiverOrder` index; execute: cancel his planned call-ups, `settleSquadPayroll`,
  `markSquadDeparture`, delete `p.squad`, set team and contract, `syncDepthChart` both clubs, log `'sign'`
  "X signed POS Name off Y's practice squad"; losers and lapsed get results with `reason`; clear offers; keep last 96 results.
- `flow.ts` `settleWeek`: after `settleWaivers`, `lockProtections`, `submitAIPoachOffers` (Task 3; a no-op stub
  until then), `resolvePoaching` — regular season only.

- [ ] Tests: `a protected player can't be poached`; `next opponents can't poach from each other`;
  `no room or cap: the offer lapses with a reason at the settle`; `the longer deal wins, then waiver priority`;
  `a poached player joins the 53 on a minimum deal with three guaranteed weeks and the old squad pay stops`;
  `cut a week later, the remaining guaranteed weeks are dead money`; `a planned call-up with the old club is cancelled`;
  `resolving twice or after a reload signs nobody twice`. Watch them fail.
- [ ] Implement; run `npx vitest run src/engine/personnel`.
- [ ] Commit `Personnel: poaching offers and the three-week guarantee`.

### Task 3: AI poaching and the audit

**Files:** `poaching.ts` (`submitAIPoachOffers`), `poaching.test.ts`, create `scripts/poaching.ts`, `package.json`
(`"poaching": "tsx scripts/poaching.ts"`), `scripts/check.ts` (planner entry with `waivers`/`squads`).

**Produces:** `submitAIPoachOffers(league, autoUser = false): void` — for each AI club (user only with `autoUser`):
skip if `activeRoster ≥ 53`; positions where healthy players < `STARTERS[pos]` (QB: 2); the best unprotected
other-club squad player there by `perceive(league, club, p).ovr` that beats its best healthy option and the best
free agent at that position (same read) by ≥ 1, affordable above `inSeasonReserve`; at most one offer a week; years 1.

- [ ] Tests: `an AI club short at a position poaches the best unprotected fit by its own read`;
  `an AI club at 53 or without cap room never poaches`; `at most one AI offer a club a week`; `the user's club
  never poaches without autoUser`. Watch them fail; implement; pass.
- [ ] `scripts/poaching.ts N`: N enabled worlds (`poaching-audit-i`), a full season with `playWeek`; assert every
  week rosters ≤ 53, cap ≥ 0, no protected player poached, no poach between that week's opponents, reload hash
  stable at a settle; print poaches; fail if league-wide total outside 16–96.
- [ ] `npm run poaching -- 2` passes (tune only the AI threshold, never the band). Commit `Personnel: AI poaching and its audit`.

### Task 4: Mail when you lose a player

**Files:** `src/engine/inbox.ts`, `src/ui/mail.test.tsx` or `src/engine/inbox` tests where poached mail lives.

**Produces:** `squadPoachedMail(league, have): Draft[]` — for each result in `personnel.poaching.results` with
`fromTeamId === userTeamId` and `toTeamId !== null`: id `squadPoach:season:week:playerId`, head coach's voice
(`coach(league)` helper as other mails), category `'staff'` or the closest existing squad category, subject
`"{name} signed with the {club}"`, body one sentence, action open player. Wired into `deliverMail` in season;
`mailSubject` reads the key back.

- [ ] Test: `losing a squad player sends one mail from the head coach, once`. Fail, implement, pass.
- [ ] Commit `Inbox: a mail when a club signs your squad player`.

### Task 5: Squad desk controls

**Files:** `src/ui/screens/PracticeSquad.tsx`, `src/ui/squads.test.tsx`.

- [ ] Own squad rows: "Protected this week · auto/pinned" badge from `protectedIds` + pins; an "Always protect"
  toggle (`setPin`) disabled at two pins. Other clubs' squad rows: "Sign to our 53" opens a dialog (1 or 2 years,
  cap hit, cap after, the problem if any) → `submitPoachOffer`; your pending offers listed with Cancel; a
  "Recent signings" list from public results.
- [ ] Tests (static render): badge and toggle on your squad; "Sign to our 53" on another club's squad and not on
  yours; protected players show no sign button. `npm run typecheck`, `npx vitest run src/ui`.
- [ ] Browser check desktop and phone. Commit `Squad desk: protection, pins and poaching`.

### Task 6: Docs, version, PR

- [ ] `docs/PRACTICE_SQUADS.md` rules table rows for Poaching, Protection, Losing a player; step 5 marked done.
  `MVP.md` line. `package.json` 0.1.15 + `src/ui/changelog.ts` entry: "Choose who you are" — GM name and starting
  age on New Game, a pencil on your card. `npm run format`, `npm run typecheck`, touched tests.
- [ ] Final review (fresh reviewer). Then open the PR to main (template if any), subscribe, read CI, fix red.
