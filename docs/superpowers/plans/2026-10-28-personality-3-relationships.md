# Relationships (PR 3 of 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Coach rapport, friendships, feuds in the position room, homecomings and grudges, and players speaking out,
each with a small effect on habits or contracts and a line in the story.

**Architecture:** A new `relationships.ts` owns all five. Rapport, homecomings and grudges are worked out from history
(coach careers, `statTeams`, `seasonRole` and a new short `Player.left` list). Friendships and feuds are stored in
`Player.ties` (three at most). Their effects plug into what exists: marbles through `quirkOffseason`/`addMarbles`,
contract nudges through `demand`/`offerValue`. Controversy gets its job, so `TRAITS_ON` gains `controversy`.

**Tech Stack:** TypeScript, Vitest, React (Vite), Prettier.

**Spec:** `docs/superpowers/specs/2026-10-28-personality-relationships-design.md` (§3, §5.1, §5.2, §5.4).

**Branch:** stacked on PR 2's branch; confirmed with the owner before the first push.

## Global Constraints

- Everything in PR 1's and PR 2's Global Constraints holds.
- Stored lists are capped: `ties` 3, `left` 3; `ties` cleared at retirement.
- Feuds stay inside a position room (same `position` on the same team).
- Every roll is seeded on its own stream: `${league.seed}:ties:${season}:${a}:${b}` (pairs keyed with the lower id
  first) and `${league.seed}:speak:${season}:${playerId}:${kind}`.
- The match engine never reads a relationship.
- Nothing is "needs you". Recaps state only what the box score backs.

## Review Focus

1. **A player cut twice by the same club:** one grudge, never two; `left` keeps the latest three (Task 1 test).
2. **A feud partner traded, then traded back:** the old feud is gone (it ended when he left the room); a new one
   needs a new roll (Task 3 test).
3. **A player whose friend retires mid-negotiation:** no friendship nudge after the retirement (Task 4 test).
4. **A Mercenary:** friendships never move his price (Task 4 test).
5. **Old saves:** players load with no `ties` and no `left`, and nothing reads them as anything but empty (Task 1).

---

### Task 1: How he left (`Player.left`)

**Files:**
- Modify: `src/engine/types.ts` (`Player.left?: Departure[]`, `Player.ties?: Tie[]`, the two types)
- Modify: `src/engine/finance/cap.ts:199` (`releasePlayer`), `src/engine/trade/execute.ts:29` (`executeTrade`, where
  `p.teamId = to` at `:82`), `src/engine/offseason/negotiation.ts:319` (`signPlayer`, a new club after a deal ran out)
- Create: `src/engine/relationships.ts` (`noteDeparture`)
- Modify: `src/engine/generate.ts`, `src/engine/migrate.ts` (version-only step)
- Test: `src/engine/relationships.test.ts`

**Interfaces:**
- Produces:
  - `type Departure = { teamId: number; season: number; how: 'cut' | 'traded' | 'walked' }`
  - `type Tie = { kind: 'friend' | 'feud'; with: number; since: number; why?: 'benched' | 'snubbed' }` (`why` only on a
    feud an event started, so SNN can report it later)
  - `noteDeparture(league: League, p: Player, teamId: number, how: Departure['how']): void` (one entry per club per
    season; keeps the newest 3; ends his feuds, since he has left the room)
  - `endFeudsOutsideRoom(league: League, p: Player): void` (also called from `changePosition`, `training.ts:261`)

- [ ] **Step 1: Write the failing tests**: a feud ends the moment either player is traded, cut or moved to another
  position (traded back the same week, it stays ended); releasing a player records `cut`; a trade records `traded` for
  each player moved; signing a free agent whose last club (latest `statTeams` entry) differs and who has no entry for it
  records `walked`; a fourth departure drops the oldest; a player cut by one club twice in a season has one entry.
- [ ] **Step 2: Run** — `npx vitest run src/engine/relationships.test.ts` → FAIL.
- [ ] **Step 3: Implement** the types, `noteDeparture`, the three call sites, and the version step.
- [ ] **Step 4: Run** — `npx vitest run src/engine/relationships.test.ts src/engine/trade && npm run typecheck` → PASS.
- [ ] **Step 5: Commit**

```bash
npm run format
git add src/engine
git commit -m "Relationships: how a player left each club (cut, traded, walked)"
```

---

### Task 2: Rapport, homecomings and grudges (worked out)

**Files:**
- Modify: `src/engine/relationships.ts`
- Test: `src/engine/relationships.test.ts`

**Interfaces:**
- Consumes: `Coach.career` (`CoachSeason`: season, teamId, role, room), `ROOM_OF` (`coaching.ts:69`),
  `p.statTeams`, `seasonRole(league, p, season)`, `Player.left`.
- Produces:
  - `coachedBy(league: League, p: Player, c: Coach, season: number): boolean`: `c` was his head coach, his side's
    coordinator or his room's position coach that season
  - `rapport(league: League, p: Player, c: Coach): 'good' | 'sour' | null`: sour if, while `c` was head coach of a
    club, that club cut or traded him (`left`), or `c` coached him in a season where he went from starter to backup
    (healthy: 10+ games); otherwise good with 2+ seasons coached by `c` as a starter or rotation player; else null
  - `clubFeeling(league: League, p: Player, teamId: number): 'home' | 'grudge' | null`: grudge if `left` has `cut` or
    `traded` for that club within the last 3 seasons; home if he walked from it after a starter or rotation season
    there; else null

- [ ] **Step 1: Write the failing tests**: two good seasons under a coordinator give `good`; being cut while that
  coach was head coach gives `sour`; one season gives null; a cut two seasons ago is a grudge, four seasons ago is
  nothing; walking away after starting is `home`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**. Comment why rapport is never stored (spec §3.1: worked out from history at each use).
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Relationships: coach rapport, homecomings and grudges, read off history"`

---

### Task 3: Friendships and feuds

**Files:**
- Modify: `src/engine/relationships.ts`
- Modify: `src/engine/offseason/index.ts` (after `beginOffseason`'s player loop: `tiesOffseason(league)`; in the
  retirement branch: `delete p.ties`, and remove him from his partners' lists)
- Modify: `src/engine/offseason/negotiation.ts` (`signPlayer`: an extension or re-signing calls `snubCheck(league,
  player)`)
- Modify: `src/engine/mentoring.ts` (`endPair`: a pair that banked 2+ seasons becomes a friendship)
- Test: `src/engine/relationships.test.ts`

**Interfaces:**
- Produces:
  - `FEUD_BASE = 0.02`, `FRIEND_BASE = 0.25`, `SETTLE_BASE = 0.35` (starting values; tuned in Task 7)
  - `addTie(league: League, a: Player, b: Player, kind: Tie['kind']): boolean` (both sides; refuses past 3; a feud
    replaces a friendship between the same two)
  - `endTie(a: Player, b: Player): void`
  - `feudOdds(league: League, a: Player, b: Player, room: Player[]): number` =
    `FEUD_BASE × exp(0.5 × (zControversy a + b) − 0.4 × (zTemper a + b)) × leaders × teacher`, where `leaders` =
    `max(0.4, 1 − 0.15 × (room players read with leadership z ≥ 1))` and `teacher` = 0.7 when the room's position
    coach holds Patient Teacher
  - `tiesOffseason(league: League): void`: (1) end feuds where the two no longer share a room; (2) settle each feud
    with chance `SETTLE_BASE + 0.1 × calm (temperament z of both, positive part) + 0.05 × leaders in the room + 0.1 ×
    years since it started`, capped 0.9; (3) per room, roll each pair: a benching last season (one went starter →
    backup while healthy as the other went backup → starter, by `seasonRole` for the last two seasons) triples the
    odds; (4) per room pair with 4+ seasons together (`statTeams`), roll a friendship at `FRIEND_BASE × (1 + 0.5 ×
    (zLoyalty a + b))`, clamped 0.05–0.6
  - `snubCheck(league: League, signed: Player): void`: when he signs for more per year than a roommate who started
    last season and is not on a new deal, roll a feud between them at triple odds; a new feud also calls
    `addMarbles(league, p, tempers, 1)` for both, where `tempers` is the `temper: true` habits at his position

- [ ] **Step 1: Write the failing tests**
  - `it('keeps feuds inside the room and ends them when one leaves it')` (trade one; run `tiesOffseason`; gone).
  - `it('is likelier between two who stir it up, and rarer with leaders in the room')` (compare `feudOdds`).
  - `it('caps a player at three ties, and a feud replaces a friendship')`.
  - `it('starts a feud with a temper marble for each')` (bag counts before and after).
  - `it('turns a long mentoring pair into a friendship')`.
  - `it('drops a retired player from his partners' lists')`.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**, plus the call sites.
- [ ] **Step 4: Run** — `npx vitest run src/engine/relationships.test.ts src/engine/mentoring.test.ts` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Relationships: friendships and feuds in the position room"`

---

### Task 4: What they change (the bag and the price)

**Files:**
- Modify: `src/engine/relationships.ts` (`relationshipMarbles`, `contractLean`)
- Modify: `src/engine/quirks.ts:808-815` (`quirkOffseason`: call `relationshipMarbles(league, p)` after `fillBag`)
- Modify: `src/engine/offseason/negotiation.ts:90-127` (`demand`, `offerValue`)
- Test: `src/engine/relationships.test.ts`, `src/engine/negotiation.test.ts` (or the existing negotiation tests)

**Interfaces:**
- Produces:
  - `relationshipMarbles(league: League, p: Player): void`: +1 fix marble per held bad habit (2 at most) if he has
    good rapport with a coach coaching him now; +1 fix marble per held bad habit his first season back at a club he
    feels is home; +1 marble on each `temper: true` habit at his position per feud he's in
  - `contractLean(league: League, p: Player, teamId: number): { value: number; walkAway: number; ask: number }`
    (multipliers, 1 when nothing applies): good rapport with that club's head coach, his coordinator or position
    coach → `value × (1.02 + 0.02 × loyalty)`; sour with its head coach → `value × 0.97`; a friend on that club →
    `value × 1.02` (another club) or `walkAway × 0.97` (his own); home → `walkAway × 0.97`; grudge → `ask × 1.05`,
    `walkAway × 1.05`. A Mercenary (greed z ≥ 1 and loyalty z ≤ −0.5) ignores friendships and home.

- [ ] **Step 1: Write the failing tests**: each row above moves its multiplier the right way; a Mercenary's
  friendship leaves all three at 1; `demand` and `offerValue` for a grudge club come out 5% dearer; marble counts for
  rapport, home and a feud.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**; `demand` multiplies `askApy` and `walkAway`, `offerValue` multiplies its result.
- [ ] **Step 4: Run the tests and the checks** —
  `npx vitest run src/engine && npm run quirks -- --effects && npm run offseason -- 6` → PASS, nothing flagged.
- [ ] **Step 5: Commit** — `git commit -m "Relationships: rapport, home and feuds in the bag; nudges on the price"`

---

### Task 5: Controversy switched on, and players speaking out

**Files:**
- Modify: `src/engine/personality.ts` (`TRAITS_ON` gains `'controversy'`)
- Modify: `src/engine/relationships.ts` (`speaksOut`)
- Modify: `src/engine/lockerMail.ts` (SNN items)
- Test: `src/engine/personality.test.ts`, `src/engine/relationships.test.ts`, `src/engine/inbox.test.ts`

**Interfaces:**
- Produces: `speaksOut(league: League, p: Player, season: number, kind: 'benched' | 'traded' | 'cut' | 'snubbed'): boolean`
  — pure: `new Rng(\`${league.seed}:speak:${season}:${p.id}:${kind}\`).chance(clamp(0.15 + 0.25 × zControversy, 0, 0.8))`,
  false below controversy z 0.5. Where each event comes from, all read from what's saved: `traded` and `cut` from
  this season's `left` entries; `benched` from `seasonRole` (starter two seasons ago, backup last season, 10+ games);
  `snubbed` from a feud with `why: 'snubbed'` that started this season.

- [ ] **Step 1: Write the failing tests**: Locker-Room Lawyer, Volatile and Diva now appear in a full league and
  every share stays in range; `speaksOut` is false for a quiet player and stable across calls; SNN carries a speak-out
  for your player or one who left your club within 3 seasons (id `speak:${season}:${playerId}:${kind}`), from `SNN
  league desk`, never twice.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement**. SNN's voice is neutral reporting: who, what happened, his words in one line.
- [ ] **Step 4: Run** — PASS.
- [ ] **Step 5: Commit** — `git commit -m "Relationships: controversy names, and players who speak out on SNN"`

---

### Task 6: The room, the card line, the letters and the recaps

**Files:**
- Modify: `src/ui/screens/LockerRoom.tsx` (the **In the room** section)
- Modify: `src/ui/scouting.tsx` (`lockerLine`: feud, then a grudge against your club, then the mentor, then a friend)
- Modify: `src/engine/lockerMail.ts` (a feud starts, a friend leaves, an agent's homecoming, an old coach's pull)
- Modify: `src/engine/inbox.ts:1414` (`recapMail`: the player-of-the-game sentence gains the revenge and clutch asides)
- Test: render tests beside `gm.test.tsx`, `src/engine/inbox.test.ts`

**Interfaces:**
- Consumes: `Player.ties`, `clubFeeling`, `rapport`, `personalityRead`.
- Produces (mail ids): `feud:${season}:${a}:${b}` (your position coach), `friend:${season}:${week}:left:${p}:${q}`
  (head coach, when one is cut or traded), `home:${season}:${playerId}` (his agent, free agency: *"he'd like to come
  home"*), `rapport:${season}:${playerId}` (your director, free agency: a free agent who did well under one of your
  coaches asked about joining).

- [ ] **Step 1: Write the failing tests**
  - In the room: friendships and feuds grouped by position, names through `PlayerLink`, no numbers.
  - Card: with a feud and a mentor, only the feud shows; a grudge shows only when it is against your club; at most one
    extra line in every case.
  - Recap, revenge: the opponent's player of the game holds a grudge against your club → the sentence adds *"against
    the club that cut him"* (or *traded him*); your player of the game against a club he holds a grudge with → the same
    from our side.
  - Recap, clutch: a win by 8 or fewer whose player of the game is yours and read as Clutch → adds *"He wanted the ball
    late."* Nothing for a loss or a bigger margin.
  - Each letter arrives once, from the right sender, and passes the banned-words check.
- [ ] **Step 2: Run** — FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** — `npx vitest run src/ui src/engine/inbox.test.ts && npm run typecheck` → PASS.
- [ ] **Step 5: Commit** — `git commit -m "Relationships: In the room, the card's line, letters and recap asides"`

---

### Task 7: The numbers, docs and the PR

**Files:**
- Modify: `scripts/offseason.ts` (feuds and friendships per team per season, judged with the script's range check)
- Modify: `docs/GAME_DESIGN.md`, `CLAUDE.md` (architecture line for `relationships.ts`), `package.json`,
  `src/ui/changelog.ts`

- [ ] **Step 1: Add the checks**: average feuds per team `[0.5, 1.8]`; share of teams with more than three feuds
  `[0, 0.1]`; average friendships per team `[1.5, 6]`.
- [ ] **Step 2: Run and tune** — `npm run offseason -- 6`. Tune `FEUD_BASE`, `SETTLE_BASE`, `FRIEND_BASE` only.
- [ ] **Step 3: Run the rest** — `npm run quirks -- --effects && npm run sim -- 10` → nothing flagged.
- [ ] **Step 4: Docs, version, commit, push**

```bash
npm run format
git add scripts/offseason.ts docs CLAUDE.md package.json src/ui/changelog.ts
git commit -m "Relationships 0.2.x: numbers, docs and changelog"
git push -u origin <PR 3 branch>
```

- [ ] **Step 5: When the owner asks, open the PR (base: PR 2's branch), then read CI and fix anything red.**
