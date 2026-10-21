# In-Season Holes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A team short at a position first lines up a spare player there with "Play at…", then (AI only) signs a
free agent at what he'll take; the user's staff never signs or cuts, and the inbox says who's covering or links to
free agency.

**Architecture:** "Play at…" becomes a remembered move on the team (`Team.playingAt`) that auto-sort keeps, so staff
and AI teams can make the same move the user does. The weekly injury pass (`coverPositions` in `injuries.ts`) runs a
ladder: send staff covers back, cover from the roster, sign at a price, sign at the minimum. Mail reads the league as
it stands.

**Tech Stack:** TypeScript, Vitest, React (UI only in Tasks 4–5).

**Spec:** `docs/superpowers/specs/2026-10-21-in-season-signings-design.md`

## Global Constraints

- `COVER_BAR = 8.5`: a cover's `slotOvr(p, pos)` (overall at that position, knock included) must reach it.
- `League` stays plain JSON; `SAVE_VERSION` goes 34 → 35 with a `migrate.ts` step.
- Engine: no `Math.random`; randomness only from the `Rng` passed in. Pure functions, comments that explain why.
- Screens never render `player.ratings`, `playerOvr` or `potential` (fog of war); mail names a cover's level in words
  from the user's read (`perceive`), never a true number.
- Salaries in $K. In-season deals are built by `contractFromOffer` (it prorates year one).
- Never loosen an audit band to get green. `npm run format` before each commit.
- Commit trailer on every commit:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01XLCLNZCmTEDhTjfL2WgdZM`.
- Version stays 0.1.4 (this branch's bump); `docs/MVP.md` doesn't change (items 3, 4, 8 and 13 are already Done).

## Review Focus

- A user who hand-sorted his chart, then a staff cover is made: his order elsewhere must not change, and the cover
  must not land ahead of his own starters at that position. (Test in Task 1: hand-sorted chart keeps its order.)
- A covering player who gets hurt himself: he must go back (and stop counting at that position), not stay stuck out of
  position all season. (Test in Task 2.)
- A player covering at a position who's then traded or cut: his `playingAt` entry must not linger and break a sync on
  his new team. (Test in Task 1: entries for players off the team drop.)
- Two positions short in the same week: one spare player must not be used as the cover for both. (Test in Task 2.)
- An old save with a hand-sorted chart that already had a "Play at…" player: he must stay where he is after load, as
  the user's move. (Test in Task 1's migrate test.)

---

### Task 1: "Play at…" survives auto-sort

**Files:**
- Modify: `src/engine/types.ts` (`Team`, near `autoDepth` at :526)
- Modify: `src/engine/roster.ts` (`buildAutoDepthChart` :24, `syncDepthChart` :54, `placeAt` :75)
- Modify: `src/ui/training.ts:161` (`playAt`, `placeBack`)
- Modify: `src/engine/training.ts:259` (`changePosition`)
- Modify: `src/engine/generate.ts:29` (`SAVE_VERSION = 35`), `src/engine/migrate.ts` (add `toV35`)
- Modify: `src/ui/screens/Roster.tsx` (drag commit :331, help text :467, tag :665)
- Test: `src/engine/training.test.ts` (next to the "Play at" test at :208), `src/engine/injuries.test.ts` (migrate)

**Interfaces:**
- Produces:
  - `Team.playingAt?: Record<number, { pos: Position; by: 'staff' | 'user' }>` (absent or `{}` = none).
  - `placeAt(league, playerId, pos, index?, by: 'staff' | 'user' = 'user'): void`: records the entry; only a
    call with `index` (a drag) turns `autoDepth` off.
  - `returnHome(league: League, playerId: number): void` in `roster.ts`: deletes the entry and syncs (what
    `placeBack` and staff's send-back both call).

- [ ] **Step 1: Write the failing tests** in `training.test.ts`:

```ts
it('"Play at" survives auto-sort and leaves it on', () => {
  const l = fresh(); const team = l.teams[l.userTeamId];
  const cb = teamPlayers(l, team.id).find((p) => p.position === 'CB')!;
  playAt(l, cb.id, 'S');
  expect(team.autoDepth).toBe(true);
  expect(team.playingAt?.[cb.id]).toEqual({ pos: 'S', by: 'user' });
  syncDepthChart(l, team);
  expect(team.depthChart.S).toContain(cb.id);
  expect(team.depthChart.CB).not.toContain(cb.id);
  playAt(l, cb.id, 'CB');
  expect(team.playingAt?.[cb.id]).toBeUndefined();
  expect(team.depthChart.CB).toContain(cb.id);
});
it('an auto-sorted group ranks a "Play at" player by his worth there', () => {
  // A weak CB moved to S sits behind every S whose slotOvr at S is higher.
});
it('a hand-sorted chart keeps its order when staff lines someone up', () => {
  // Hand-sort CB (move a backup up), staff placeAt(..., 'staff') a WR at S: CB's list is unchanged, and the WR is
  // listed last at S.
});
it('drops entries for players who left the team or moved there for good', () => {
  // playAt then releasePlayer → entry gone after sync; playAt then changePosition(to that pos) → entry gone.
});
```

And in `injuries.test.ts`'s migrate block: an old (v34) league whose hand-sorted chart lists a CB under S loads with
`playingAt[cb] = { pos: 'S', by: 'user' }` and the CB still under S.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/engine/training.test.ts -t "Play at" && npx vitest run src/engine/injuries.test.ts -t "migrat"`
Expected: FAIL (`playingAt` undefined; `autoDepth` false after `playAt`).

- [ ] **Step 3: Implement**

- `buildAutoDepthChart(players, playingAt = {})`: a player with an entry files under its `pos`; each group sorts by
  `slotOvr(p, pos)` (equal to `playerOvr` for a player at his own position, so today's charts don't move); `OL` keeps
  `lineOrder`.
- `syncDepthChart`: first drop entries for players not on the team or whose `position === entry.pos`; pass
  `team.playingAt` to `buildAutoDepthChart`; on a hand-sorted chart, a player with an entry who isn't listed at its
  `pos` is appended there.
- `placeAt(..., by)`: write the entry (delete it when `pos === p.position`); set `autoDepth = false` only when `index`
  is given. A user move of a player whose entry is `by: 'staff'` writes `by: 'user'`.
- `playAt` (`ui/training.ts`): calls `placeAt` without an index; `placeBack` calls `returnHome` and then, on a
  hand-sorted chart, its current ordering logic.
- `changePosition`: delete `team.playingAt?.[p.id]` before its sync.
- `toV35`: for each team with `autoDepth === false`, every player listed under a position not his own gets
  `{ pos, by: 'user' }`. Then `league.version = 35`.
- `Roster.tsx`: the drag's `placeAt` passes its index (as now, it hand-sorts); help text drops "that turns auto-sort
  off" for "Play at…" (drags still do); the "Out of position" tag reads "Out of position ({p.position}) · staff" when
  the entry is `by: 'staff'`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/engine/training.test.ts src/engine/injuries.test.ts src/ui/ui.test.ts && npm run typecheck`
Expected: PASS, no type errors.

- [ ] **Step 5: Commit** — `git commit -m "Play at…: a remembered move that auto-sort keeps"`

---

### Task 2: Cover from the roster; the user's staff never signs or cuts

**Files:**
- Modify: `src/engine/roster.ts` (add `COVER_BAR`, `chooseCover`)
- Modify: `src/engine/injuries.ts` (`NEED` :1483 exported; `manageInjuries` :1426; `coverPositions` :1502)
- Test: `src/engine/injuries.test.ts`

**Interfaces:**
- Consumes: `placeAt(..., 'staff')`, `returnHome`, `Team.playingAt` (Task 1).
- Produces:
  - `export const COVER_BAR = 8.5` and
    `chooseCover(league: League, team: Team, pos: Position, need: Record<Position, number>): Player | null` in
    `roster.ts`.
  - `export const NEED` in `injuries.ts`.
  - `releaseCovers(league: League, team: Team): void` in `injuries.ts`: sends back every `by: 'staff'` entry whose
    position has `NEED[pos]` healthy players of its own, or who's unavailable himself.
  - `coverPositions` gains a `sign: boolean` parameter (false for the user's team).

- [ ] **Step 1: Write the failing tests** in `injuries.test.ts`:

```ts
it('covers a short position from the roster before signing anyone', () => {
  // AI team; hurt every S but one. A spare CB whose slotOvr at S >= COVER_BAR exists (set his ratings so).
  // After manageInjuries: playingAt[cb] = { pos: 'S', by: 'staff' }, no new player on the team, no release.
});
it('never covers with a starter, a man his position cannot spare, or anyone under the bar', () => {
  // chooseCover returns null when the only candidates are a starting CB, the last NEED[CB] healthy CBs, or a CB
  // whose slotOvr at S is 9.4.
});
it('uses one spare player for one hole only', () => {
  // Two positions short (S and LB) and one spare player good enough at both: he covers one; the other stays short.
});
it("sends staff's cover back when the position heals, or when he's hurt himself; leaves a user's move", () => {
  // Heal the S's: staff entry gone, he's back at CB. A user playAt at S stays through the same heal.
  // Hurt the covering CB: his staff entry goes.
});
it('your staff covers but never signs or cuts', () => {
  // User team, toggle on, full 53, S short with no cover good enough: roster ids identical before and after.
});
it('a healed player on your IR waits for a spot instead of costing someone his job', () => {
  // User team, toggle on, 53 active, healed IR player past IR_MIN_WEEKS: still on IR, roster ids unchanged.
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/engine/injuries.test.ts -t "cover|never signs|waits for a spot"`
Expected: FAIL (`chooseCover` not exported; the user team signs/cuts today).

- [ ] **Step 3: Implement**

- `chooseCover`: candidates are healthy players on the team with no `playingAt` entry, not at `pos`, not in the first
  `STARTERS[p.position]` of their own depth list, whose position keeps at least `need[p.position]` healthy players
  without them; best `slotOvr(p, pos)`; return him if that reaches `COVER_BAR`, else `null`.
- `coverPositions(league, team, rng, roster, sign)`: call `releaseCovers` first. Count healthy at a position by the
  depth chart (`slotOf`), so covers count where they play. For the shortest position: `chooseCover` → `placeAt(...,
  'staff')` and loop; else, if `!sign`, stop for that position and try the next; else today's signing (Task 3 adds the
  priced rung). The open-spot fill and `cutForRoom` run only when `sign`.
- `manageInjuries`: pass `sign = team.id !== league.userTeamId`. The IR return's `aiCutdown` runs only for AI teams;
  for the user's team a healed player leaves IR only while `activeRoster(...).length < ROSTER_MAX`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/engine/injuries.test.ts src/engine/training.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Injuries: cover a short position from the roster first; your staff never signs or cuts"`

---

### Task 3: AI teams sign for a hole at a price

**Files:**
- Modify: `src/engine/offseason/ai.ts` (export `reserve` as `inSeasonReserve`; add `signForNeed`)
- Modify: `src/engine/injuries.ts` (`coverPositions` ladder, `minimumFits` check before a cut)
- Test: `src/engine/injuries.test.ts`

**Interfaces:**
- Consumes: `coverPositions(..., sign)` (Task 2), `demand`, `offerValue`, `signPlayer` (`negotiation.ts`).
- Produces: `signForNeed(league: League, team: Team, position: Position, budget: number): boolean` and
  `export const inSeasonReserve = (league: League, teamId: number): number` in `offseason/ai.ts`.

- [ ] **Step 1: Write the failing tests** in `injuries.test.ts`:

```ts
it('an AI team with no cover signs a free agent at his price, above the minimum', () => {
  // AI team in season, S short, no cover. Put a free S on the market whose walkAway (demand vs this team) is about
  // 2× the minimum and fits inSeasonReserve. After manageInjuries: he's on the team, contract.kind === 'veteran',
  // apy >= his walkAway (offerValue meets it), length 1.
});
it('with no room for any real free agent it still covers the hole at the minimum', () => {
  // Same, with cap space just over the minimum: someone signs, contract.kind === 'minimum'.
});
it('never spends past its in-season reserve on one hole', () => {
  // Cap room 10× the reserve, the only free S asks 2× the reserve: he isn't signed; a minimum-taker is.
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/engine/injuries.test.ts -t "at his price|still covers the hole|in-season reserve"`
Expected: FAIL (`signForNeed` not exported; the hole is filled at the minimum).

- [ ] **Step 3: Implement `signForNeed`**

Candidates: `freeAgents(league)` at `position`, healthy, ranked as `signMinimum` ranks (`perceive` + `quirkWorth`).
Each one's APY is `Math.ceil(d.walkAway / offerValue(league, p, team.id, { years: 1, apy: 1, bonusPct: 0,
gtdPct: 0, voidYears: 0 }, d))` with `d = demand(league, p, team.id)` (`offerValue` is linear in APY). Take the best
whose APY ≤ `budget`; `signPlayer(league, p, team.id, offer)`; return whether anyone signed.

In `coverPositions` (when `sign`): `budget = Math.min(roomForMinimum(league, team), inSeasonReserve(league, team.id))`;
try `signForNeed`, then `signMinimum` with all the room. Before `cutForRoom`, check that either rung fits (a free
agent at the position whose price ≤ `budget`, or `minimumFits`), so nobody is cut for a deal that can't be made.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/engine/injuries.test.ts src/engine/offseason/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Injuries: an AI team signs for a hole at the player's price, from its in-season reserve"`

---

### Task 4: Mail and the free-agency link

**Files:**
- Modify: `src/engine/types.ts:810` (`InboxAction` `fa` gains `pos?: Position`)
- Modify: `src/engine/inbox.ts` (`MailSubject`, `mailSubject`, `needsYou`, new `coverMail`, `clearedMail` :1120,
  `deliverMail` :1928)
- Modify: `src/ui/routes.ts` (`office` route `pos?: Position`, hash `#/office/fa/S`)
- Modify: `src/ui/screens/Inbox.tsx:204`, `src/ui/App.tsx:397`, `src/ui/screens/FrontOffice.tsx` (`FrontOffice`,
  `FreeAgents` :310 take `pos`)
- Test: `src/engine/inbox.test.ts`, `src/ui/ui.test.ts`

**Interfaces:**
- Consumes: `Team.playingAt` (Task 1), `NEED` (Task 2).
- Produces: subjects `{ kind: 'covering'; season; week; playerId; pos }` (id `cover:season:week:playerId:pos`) and
  `{ kind: 'shortHanded'; season; week; pos }` (id `short:season:week:pos`).

- [ ] **Step 1: Write the failing tests**

`inbox.test.ts`:

```ts
it('names the player staff lined up at a short position', () => {
  // User team, staff covers S with a CB: one 'covering' message from the head coach naming him, with a player
  // action; needsYou false.
});
it('says a position is short when nobody can cover, and links to free agency there', () => {
  // User team short at S, no cover: one 'shortHanded' message with action { kind: 'fa', pos: 'S' }; needsYou true;
  // after a S is signed, needsYou false.
});
it('a healed player waiting on IR for a spot needs you, toggle on', () => {
  // The cleared mail says he waits until you make room; needsYou true while 53 are active, false after a cut.
});
```

Add `covering` and `shortHanded` ids to the existing "reads back what every message is about" test.
`ui.test.ts`: add `{ view: 'office', tab: 'fa', pos: 'S' }` to the round-trip list.

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run src/engine/inbox.test.ts src/ui/ui.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

- `coverMail(league, have)`, in season only, user's team: a `covering` draft for each `by: 'staff'` entry made this
  week; a `shortHanded` draft for each position below `NEED` (counted by `slotOf`) with no cover. Sender: the head
  coach (`headCoach(league)`, as other coach mail). The cover's level is words from the user's read
  (`perceive(league, league.userTeamId, p)`, as other mail reads its own players), never a number.
- `needsYou`: `covering` false; `shortHanded` while the position is still below `NEED`; `cleared` also true when the
  toggle is on, the player is healed on IR and `activeRoster(...).length >= ROSTER_MAX`.
- `clearedMail` text, toggle on with a full 53: "He's waiting on injured reserve: make room on the 53 and the staff
  will bring him back."
- Routes: `office` with `tab: 'fa'` and `pos` → `#/office/fa/S`; parse only a valid `Position`. `Inbox.tsx` sends an
  `fa` action to `{ view: 'office', tab: 'fa', pos: a.pos }`; its label reads "Free agents at S" when `pos` is set.
  `FreeAgents` starts its `pos` state from the prop.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/engine/inbox.test.ts src/ui/ui.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit** — `git commit -m "Inbox: who's covering, a short position with a free-agency link, a healed player waiting for a spot"`

---

### Task 5: Copy, audits, push

**Files:**
- Modify: `src/ui/screens/Roster.tsx:430` (toggle tooltip), `src/ui/screens/Medical.tsx:347` (line)
- Modify: `CLAUDE.md` (`injuries.ts` bullet: covers and the priced rung, one clause)

- [ ] **Step 1: Copy**

Tooltip: "Your medical staff moves long injuries to injured reserve, brings players back when there's room, and lines
up a spare player at a position that runs short. Signings and cuts stay yours."
Medical, toggle on: "Your staff moves long injuries to reserve, brings players back when there's room, and covers a
short position from the roster. Signings and cuts are yours. Turn that off on the roster screen."
Medical, toggle off: unchanged.

- [ ] **Step 2: Audits**

Run: `npm run format && npm run typecheck && npx vitest run`
Then, side by side: `npm run offseason -- 6`, `npm run trades`, `npm run sim -- 10`.
Expected: each ends "0 number(s) outside target range". If in-season trades leave their band, stop and report the
numbers to the owner (never widen the band).

- [ ] **Step 3: Commit and push**

`git commit -m "In-season holes: copy and notes"` then `git push -u origin claude/lucid-ride-i2b47h`.
