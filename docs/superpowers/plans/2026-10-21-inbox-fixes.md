# Inbox fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix four inbox problems the owner hit in a real save: "See their offer" doesn't open the offer, the
cleared-to-play mail over-counts time out by one week, some names in mail are plain text, and the opposition
report's "How we match up" card compares units that never face each other.

**Architecture:** UI fixes in `src/ui/` plus one pure engine helper (`keyMatchups` in `src/engine/inbox.ts`) that
pairs each offensive unit with the defensive unit it plays against. No save-shape change, no sim change.

**Tech Stack:** TypeScript, React, Vitest (`renderToStaticMarkup` for UI tests).

**Spec:** the design agreed in chat (2026-10-21), summarised here:
1. "See their offer" opens the inbox on the offer's thread *with that message expanded*.
2. Cleared mail "Time out" counts weeks actually missed: hurt week 2, back week 4 → **1 wk** (today shows 2).
3. Every person and team named in mail is a link (head coach's offer notes, "to Washington" in offer text,
   the recap's "Next:" opponent…).
4. "How we match up" becomes **"Key matchups"**: two groups, **"Our offense vs their defense"** and
   **"Their offense vs our defense"**; each row a unit against the unit it faces, with the key player's
   existing `PlayerAvatar`, both scores, and an "Our edge"/"Their edge" tag only when the gap is clear.

## Global Constraints

- Screens show the user's view only (`perceive` / scouts' read); never `player.ratings`, `playerOvr`, `potential`.
- `League` stays plain JSON; no `SAVE_VERSION` bump (nothing stored changes).
- Match existing style: small pure functions, comments that explain *why*.
- Bump `package.json` version `0.1.1` → `0.1.2` (fixes: last number, `docs/VERSIONING.md`).
- Run `npm run format` before committing; locally only `npm run typecheck` and touched tests (`npx vitest run <file>`). No sims.
- Push to `claude/sleepy-johnson-j6drod`.

## Review Focus

1. Clicking "See their offer" when the offer is in the **same thread** you're reading (enquiry and offer share a
   thread) → the offer message expands. Test in Task 1.
2. Clicking it a second time after collapsing the offer → it expands again (route `messageId` unchanged, so no
   remount). Task 1 handles via a `focus` nonce; test in Task 1.
3. Injury in the offseason (`week 0`) or hurt in one season and cleared in the next → no nonsense count; show
   "Over the offseason" / the estimate only. Test in Task 2.
4. A city two teams share (New York, Los Angeles) or a city that is also a player's surname ("Marcus
   Washington") → shared city stays plain; the player's full name still wins. Test in Task 3.
5. A team with no starter at a group (injuries) → matchup row still renders, no avatar, no crash. Test in Task 4.

---

### Task 1: "See their offer" opens and expands the offer

**Files:**
- Modify: `src/ui/screens/Inbox.tsx` (`Inbox` ~150–200, `Folded` ~500–560)
- Modify: `src/ui/routes.ts:12` (inbox route)
- Modify: `src/ui/offers.tsx:322-332` (the button)
- Modify: `src/ui/App.tsx:394` (Inbox `key`)
- Test: `src/ui/mail.test.tsx`

**Interfaces:**
- Produces: route `{ view: 'inbox'; messageId?: string; focus?: number }`; `Folded` gains prop `focusId?: string`.

Why it breaks today: `Folded` starts with `openIds = []`, so the thread opens with every message collapsed; and
clicking the button again with the same `messageId` doesn't remount the keyed `Inbox`.

- [ ] **Step 1: Write the failing test** in `mail.test.tsx`, `describe('the offer card')`:
  `it('opens the thread with the offer it was sent to expanded')` — reuse `withEnquiry` + `answerEnquiry(..., 'offer')`,
  `deliverMail`, find the thread holding `mailForOffer(league, bid)`, render
  `<Folded league t needs index act focusId={offerMail.id} />` and assert the markup contains the bid's
  `Accept` button and `aria-expanded="true"` exactly once (only that message open).
- [ ] **Step 2: Run** `npx vitest run src/ui/mail.test.tsx` → FAIL (`focusId` ignored / no Accept).
- [ ] **Step 3: Implement.** `Folded`: `useState<string[]>(focusId ? [focusId] : [])`, plus a `useEffect` on
  `focusId` that adds it to `openIds` and scrolls `#mail-${focusId}` into view (`block: 'start'`); give each
  `fold-item` `id={`mail-${m.id}`}`. `Inbox` passes `focusId={messageId}` to `Folded`. Route gets optional
  `focus?: number`; the offer button sends `focus: Date.now()`; `App.tsx` keys `Inbox` on
  `${route.messageId ?? ''}:${route.focus ?? ''}` so a repeat click remounts.
- [ ] **Step 4: Run** the test → PASS; `npm run typecheck` clean.
- [ ] **Step 5: Commit** `fix(inbox): "See their offer" opens the offer, expanded`.

### Task 2: Cleared mail counts the weeks actually missed

**Files:**
- Modify: `src/ui/mail.tsx` (`ClearedCards` ~1027–1066; its caller passes `message` instead of `at`)
- Test: `src/ui/mail.test.tsx`

**Interfaces:**
- Produces: `export function weeksMissed(hurt: { season: number; week: number }, back: { season: number; week: number }): number | null`
  in `mail.tsx`: `back.week - hurt.week - 1` floored at 0 when same season and `hurt.week > 0`; else `null`.

Why: a player hurt in week N's game first misses week N+1; cleared in week M he plays week M. Weeks out = M − N − 1.
Save check: Harper hurt wk 2, missed wk 3, played wk 4 (estimate 1); Matthews hurt wk 1, missed wk 2, played wk 3.

- [ ] **Step 1: Write failing tests** `describe('cleared mail')`:
  `weeksMissed({season:2026,week:2},{season:2026,week:4})` → `1`; `(…week:1…, …week:3…)` → `1`;
  `(…week:5…, …week:6…)` → `0`; `({season:2026,week:0}, {season:2026,week:3})` → `null`;
  `({season:2025,week:17}, {season:2026,week:2})` → `null`.
- [ ] **Step 2: Run** → FAIL (not exported).
- [ ] **Step 3: Implement** `weeksMissed`, and in `ClearedCards` the "Time out" cell: number → `<b>{n} wk</b>`
  (`0` → `Didn't miss a game`); `null` → `<b>Over the offseason</b>` when `hurt.week === 0`, else `–`.
  Sub-line becomes `Expected {record.weeks} wk at the time`.
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `fix(mail): cleared mail counts weeks missed, not weeks since the injury`.

### Task 3: Names in mail are links

**Files:**
- Modify: `src/ui/moves.tsx` (`nameIndex` ~125–150)
- Modify: `src/ui/offers.tsx:285-292` (advice lines), `src/ui/mail.tsx:1011` (recap "Next:"), any other spot the sweep finds
- Test: `src/ui/moves.test.ts` (create if absent; else the existing moves test), `src/ui/mail.test.tsx`

**Interfaces:**
- Consumes: `LinkedText`, `nameIndex`, `linkedSegments` from `moves.tsx` (unchanged signatures).

- [ ] **Step 1: Write failing tests.**
  - `nameIndex` links a team's bare city: `linkedSegments(league, 'to Washington.')` has a segment
    `{ text: 'Washington', who: { kind: 'team', id } }`; a city two teams share (find one in `league.teams` or set
    two teams' `city` equal in the test) stays a plain string; a player named `X Washington` in text
    `'X Washington'` resolves to the player (longest match).
  - Offer card: render `OfferCard` for a bid whose `dealAdvice` names a player (head coach "next up" line) and
    assert that name renders inside a `linklike` button.
- [ ] **Step 2: Run** both files → FAIL.
- [ ] **Step 3: Implement.** `nameIndex`: after nicknames, add each `t.city` last (shared city → `null`, never over
  an existing key). Advice lines: `<LinkedText league={league} text={a.line} />`. Recap "Next:": team as a
  `linklike` button to `nav.openTeam`. Then **sweep**: `grep -n "playerName(\|\.name}\|fullName(" src/ui/mail.tsx src/ui/offers.tsx src/ui/screens/Inbox.tsx`
  and turn any plain person/team name in mail into a link. Leave text inside a toggle button (`fold-title`) plain:
  a link can't nest in a button.
- [ ] **Step 4: Run** → PASS; typecheck.
- [ ] **Step 5: Commit** `fix(mail): link team cities, staff notes and the recap's next opponent`.

### Task 4: "Key matchups" card

**Files:**
- Modify: `src/engine/inbox.ts` (next to `unitReads` ~458)
- Modify: `src/ui/mail.tsx` (`UnitsCard` ~460–500 → `MatchupsCard`; caller at ~333), `src/styles.css` (`.mail-unit` rules)
- Test: `src/engine/inbox.test.ts`, `src/ui/mail.test.tsx`

**Interfaces:**
- Produces (engine):
  ```ts
  export interface UnitRead { title: string; score: number; lead?: number } // lead: playerId of the unit's best starter, by our read
  export interface Matchup { title: string; offense: UnitRead; defense: UnitRead; edge: 'ours' | 'theirs' | null }
  export function keyMatchups(league: League, oppId: number): { attack: Matchup[]; defend: Matchup[] }
  ```
  `unitReads` returns `UnitRead[]` (adds `lead`). Pairs, in order: `Trenches` = Offensive line vs Defensive front;
  `Run game` = Backfield vs Linebackers; `Pass game` = mean of Quarterback and Receivers scores (lead: the QB) vs
  Secondary. `attack` = our offense vs their defense; `defend` = their offense vs ours. `edge` when
  `|offense − defense| ≥ EDGE_GAP = 0.15`, named for whichever side is ours/theirs on the stronger unit.

- [ ] **Step 1: Write failing engine tests** `describe('key matchups')`: on a fresh `createLeague({ seed: 'matchups' })`
  vs team 1: `attack` and `defend` each have titles `['Trenches','Run game','Pass game']`; every score in 0–1;
  `attack[0].offense.score === unitReads(league, user).find(Offensive line).score`; `edge` is `null` whenever the gap
  is under 0.15 and otherwise matches the stronger side; every `lead` is a starter on the right team. Plus: with
  every team-1 DT/EDGE given an `injury` (unavailable), `keyMatchups` still returns 3 rows and that row's
  `defense.lead` is `undefined` (Review Focus 5).
- [ ] **Step 2: Run** `npx vitest run src/engine/inbox.test.ts` → FAIL.
- [ ] **Step 3: Implement** `keyMatchups`/`lead` (lead = top of `starters(...)` by `perceive(league, user, p).ovr`).
- [ ] **Step 4: Run** → PASS.
- [ ] **Step 5: Write failing UI test** `describe('the opposition report')`: `MailCards` for a live matchup message
  renders `Key matchups`, `Our offense vs their defense`, `Their offense vs our defense`, no `How we match up`,
  and one `PlayerAvatar` (`class="avatar` or whatever `avatar.test.tsx` asserts on) per row side that has a lead.
- [ ] **Step 6: Implement `MatchupsCard`**: card title "Key matchups", one-line muted note ("Our scouts' read of the
  starters, as a league percentile: 100 is the best."), two sub-headed groups; each row: title · our/their unit
  name with `PlayerAvatar size={28}` + last name (link) + score · "vs" · the other side mirrored · tag pill
  (`tag-good` "Our edge" / `tag-bad` "Their edge"). Bar colours: use the team colour with a minimum lightness so
  dark navies read on the dark theme (reuse a helper in `ui/color.ts` if one exists, else a small one there).
  Stacks to one column under 641px. Delete `UnitsCard`.
- [ ] **Step 7: Run** both test files → PASS; `npm run typecheck`.
- [ ] **Step 8: Commit** `feat(mail): key matchups card pairs each unit with the one it faces`.

### Task 5: Version, format, push

- [ ] Bump `package.json` to `0.1.2`; `npm run format`; `npm run typecheck`.
- [ ] Commit `chore: bump to 0.1.2`; `git push -u origin claude/sleepy-johnson-j6drod`.
- [ ] If a PR exists, read its CI and fix anything red.
