# Director's Recommendations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the director's market report with four recommendation mails a year (weeks 6 and 9, league year
opens, free agency opens), each with two to four picks read through our scouts, a ballpark price and a button.

**Architecture:** A new pure engine module `src/engine/directorAdvice.ts` builds the lean, our needs, the picks and the
mail; `inbox.ts` calls it in place of `marketMail` and drops two deadline notices; `ui/mail.tsx` renders the advice
card with per-row buttons through the existing `tradeDesk`.

**Tech Stack:** TypeScript, React, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-26-director-recommendations-design.md`

## Global Constraints

- Fog of war: picks read our view only (`perceive(league, league.userTeamId, p)` / `viewCache`); never
  `player.ratings`, `playerOvr`, `potential`, or another club's private `tradeBlock`. A target needs knowledge ≥ 0.35.
- Pure functions, no randomness; mail is built in `deliverMail`, one id per moment: `advice:{season}:{w6|w9|resign|fa}`.
- Filed only at the moment itself (no backfill). Never Needs you.
- `SAVE_VERSION` 50 → 51 with a no-op `migrate.ts` step.
- Commands per task: `npm run typecheck`, `npx vitest run <touched tests>`, `npm run format` before each commit.
- Commit trailer: `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_011v2LBUCkesLYVVQ4bbGtKB`.

## Review Focus

1. A user with no job (spectating) reaches week 6 → no advice mail. (Task 3 test.)
2. A long sim from week 4 to week 10 → no week-6 or week-9 mail filed late. (Task 3 test.)
3. We hold the top seed with no affordable upgrade anywhere → one-line "we hold" mail, not an empty table. (Task 3.)
4. A sell candidate who was traded away or retired before the mail is opened → the filed row still renders (snapshot
   name/position), and the button is hidden when he's no longer ours. (Task 4 test.)
5. Free agency: our cap space is negative → no FA picks, and no FA mail at all. (Task 2 test.)

---

### Task 1: Lean, needs and price words

**Files:**
- Create: `src/engine/directorAdvice.ts`, `src/engine/directorAdvice.test.ts`
- Modify: `src/engine/trade/value.ts` (export `slotRate(slot: number): number`, the curve inside `goingRate`, which
  then calls it)

**Interfaces:**
- Produces:
  - `type AdviceLean = 'buy' | 'targeted' | 'sell'`
  - `raceFor(league: League): { gamesBack: number; seed: number | null; record: Record3 }` (our conference, standings'
    records; `gamesBack` 0 when we hold a seed; ties count half)
  - `adviceLean(gamesBack: number): AdviceLean` (≤1 buy, ≤3 targeted, else sell)
  - `adviceNeeds(league: League): { position: Position; urgency: number; reason: 'hole' | 'upgrade' | 'nextYear' }[]`
    (our view; same thresholds as `teamNeeds`)
  - `pickRoundFor(league: League, value: number): string` → `'a 1st and more' | 'likely a 1st' | 'likely a 2nd'` …
    `'likely a 7th'`, or `'a late-round pick'` below the 7th's mid-round rate.

- [ ] **Step 1: Failing tests.**

```ts
it('leans from the playoff race', () => {
  expect(adviceLean(0)).toBe('buy');
  expect(adviceLean(1)).toBe('buy');
  expect(adviceLean(2)).toBe('targeted');
  expect(adviceLean(3)).toBe('targeted');
  expect(adviceLean(3.5)).toBe('sell');
});
it('measures games back from the last seed', () => {
  // play 8 weeks of a seeded league; set records so we are 2 games behind the 7th seed
  expect(raceFor(l).gamesBack).toBe(2);
});
it('reads our needs through our scouts, not the truth', () => {
  // make our starting LT's true ratings elite but our view of him poor (knowledge fixed low, read below the line)
  expect(adviceNeeds(l).map((n) => n.position)).toContain('OL');
});
it('prices in rounds', () => {
  expect(pickRoundFor(l, slotRate(16) * 1.6)).toBe('a 1st and more');
  expect(pickRoundFor(l, slotRate(48))).toBe('likely a 2nd');
  expect(pickRoundFor(l, 0.1)).toBe('a late-round pick');
});
```

- [ ] **Step 2: Run** `npx vitest run src/engine/directorAdvice.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** `slotRate` is `goingRate`'s expression without the years-out discount. `pickRoundFor`:
  round r's mark is `slotRate(16 + 32 * (r - 1))`; above 1.5 × round 1's mark → "a 1st and more"; else the first
  round whose mark the value reaches; below round 7's → "a late-round pick". `adviceNeeds` mirrors `teamNeeds`'s loop
  with `perceive(league, userTeamId, p).ovr` in place of `ovrOf` and `starterLine(tradeContext(league))`.
- [ ] **Step 4: Run** the test file and `npx vitest run src/engine/trade` (goingRate unchanged). Expected: PASS.
- [ ] **Step 5: Commit** "Director's advice: the lean, our needs, prices in rounds".

### Task 2: The picks

**Files:**
- Modify: `src/engine/directorAdvice.ts`, `src/engine/types.ts` (`AdviceRow`), `src/engine/directorAdvice.test.ts`

**Interfaces:**
- Consumes: Task 1.
- Produces: `interface AdviceRow { kind: 'buy' | 'sell' | 'sign'; playerId: number; teamId: number | null; name:
  string; position: Position; why: string; price: string; partnerId?: number }` in `types.ts`;
  `buyTargets(league, opts: { rentals: boolean; max: number }): AdviceRow[]`;
  `sellCandidates(league, lean: AdviceLean, max: number): AdviceRow[]`;
  `expiringTargets(league, max: number): AdviceRow[]`; `faTargets(league, max: number): AdviceRow[]`.

- [ ] **Step 1: Failing tests.**

```ts
it('buys only from public sources', () => {
  // club A: seller stance, a player at our top need; club B: buyer stance, a better player at the same need
  // club C: buyer stance, but its player is named in a 'shopping' rumor this season
  const ids = buyTargets(l, { rentals: true, max: 4 }).map((r) => r.playerId);
  expect(ids).toContain(aPlayer.id);
  expect(ids).toContain(cPlayer.id);
  expect(ids).not.toContain(bPlayer.id);
});
it('ranks targets by our read', () => { /* target with high truth, low read ranks below one we read higher */ });
it('skips rentals unless buying, and anything we cannot afford', () => { /* rentals:false drops a 1-year deal; salary over cap space dropped */ });
it('sells a player clubs asked about first', () => {
  // an open offer for our player X this season
  const [first] = sellCandidates(l, 'sell', 3);
  expect(first.playerId).toBe(X.id);
  expect(first.why).toMatch(/asked about him/);
  expect(first.partnerId).toBe(offeringClub);
});
it('sells surplus depth when targeted', () => { /* third starter-level CB on our read → a sell row */ });
it('names other clubs’ expiring players at our needs', () => { /* resign phase; an expired contract on club D at our need */ });
it('signs only free agents our cap can carry', () => {
  expect(faTargets(l, 4).every((r) => r.teamId === null)).toBe(true);
  // set cap space negative → []
});
```

- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement** per spec §"The picks". Public sources: `league.market?.rumors` with `kind === 'shopping'`
  and `season === league.season`, plus players of clubs with `stanceOf(team) === 'seller'`. Score: urgency × min(gain,
  4) × (1 + years left / 3); one per position. Prices: trades `pickRoundFor(league, marketValue(ctx, buyer, p))` with
  buyer = us for buys and a typical buyer-stance club for sells; FA/expiring `$X.XM a year` from `marketApy`. Why
  lines exactly as the spec's examples, filled by condition.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** "Director's advice: buy, sell and sign picks".

### Task 3: The mail, in place of the market report

**Files:**
- Modify: `src/engine/directorAdvice.ts` (`directorAdviceMail`), `src/engine/inbox.ts` (`deliverMail` wiring,
  `mailSubject` `advice` kind, `deadlineMail` drops the two notices, remove `marketMail` and helpers only it used),
  `src/engine/types.ts` (`InboxMessage.advice`), `src/engine/generate.ts` (51), `src/engine/migrate.ts`,
  `src/engine/inbox.test.ts` (drop `marketMail` tests; add the new expectations), `src/engine/directorAdvice.test.ts`

**Interfaces:**
- Produces: `directorAdviceMail(league: League, have: Set<string>): Draft[]` (export `Draft` from `inbox.ts` if
  needed, or return `Omit<InboxMessage, 'read'>[]`); `MailSubject` `{ kind: 'advice'; season: number; moment: string }`;
  tag label 'Advice' in `Inbox.tsx` `KIND_TAGS`.

- [ ] **Step 1: Failing tests.**

```ts
it('files one mail at each moment, from the director', () => {
  // at week 6
  const [m] = directorAdviceMail(l, new Set());
  expect(m.id).toBe(`advice:${l.season}:w6`);
  expect(m.from).toMatch(/Director of scouting|Scouting department/);
  expect(m.advice!.lean).toBe('buy');
  expect(m.advice!.rows.length).toBeGreaterThanOrEqual(2);
  expect(m.advice!.rows.length).toBeLessThanOrEqual(4);
  expect(directorAdviceMail(l, new Set([m.id]))).toEqual([]);
});
it('says we hold when nothing clears the bar', () => { /* no public targets → body 'Nothing worth chasing; we hold.', rows [] */ });
it('files nothing for a moment already passed', () => { /* week 10 → [] */ });
it('files nothing while spectating', () => { /* user without a job at week 6 → [] */ });
it('skips the offseason mails when there is nothing to recommend', () => { /* faTargets empty → [] in freeAgency */ });
// inbox.test.ts
it('files no market report and only the deadline-day notice', () => {
  // play through week 9 and deadline day
  expect(l.inbox!.some((m) => m.id.startsWith('market:') && !m.id.endsWith(':recap'))).toBe(false);
  expect(l.inbox!.filter((m) => m.id.startsWith('deadline:')).map((m) => m.id)).toEqual([`deadline:${l.season}:day`]);
  expect(l.inbox!.some((m) => m.id === `advice:${l.season}:w6`)).toBe(true);
});
```

- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.** Moment from phase/week/`faDay` per the spec table; return [] unless `employed(league)`.
  Subjects, chosen by moment and lean: w6 `Three weeks to the deadline: ${n} upgrade(s)` (buy), `… one in, one out`
  (targeted), `… what we could sell` (sell); w9 the same with `Deadline week:`; resign `Before free agency: who's about
  to be available`; fa `Free agency: ${count} fits`; a "hold" mail `Deadline week: we hold`. Opening sentence per the
  spec's examples. Lean only in season. `marketRecapMail` stays.
- [ ] **Step 4: Run** `npx vitest run src/engine/directorAdvice.test.ts src/engine/inbox.test.ts
  src/engine/news.test.ts src/ui/mail.test.tsx src/ui/ui.test.ts` and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "The director's recommendations replace the market report".

### Task 4: The advice card

**Files:**
- Modify: `src/ui/mail.tsx` (`case 'advice'` → `AdviceCards`), `src/ui/mail.test.tsx`

**Interfaces:**
- Consumes: `InboxMessage.advice`, `AdviceRow`, `tradeDesk.put(draft: DeskDraft)`, `useNav()`.

- [ ] **Step 1: Failing tests.**

```ts
it('shows each pick with links, the ballpark and its button', () => {
  const html = renderToStaticMarkup(<MailCards league={l} message={adviceMessage} />);
  expect(html).toContain(buy.name.split(' ').at(-1)!);
  expect(html).toContain('likely a 4th');
  expect(html).toContain('Open talks');
  expect(html).toContain('Free agency');
});
it('hides the talks button for a player who is no longer where the row says', () => {
  // move the sell row's player to another club → no 'Open talks' for that row; the row still shows his name
});
it('puts the buy row on the trade desk', () => {
  openTalks(l, buy); // the click handler, exported for the test
  expect(tradeDesk.take()).toEqual({ partnerId: buy.teamId, mine: empty, theirs: { players: [buy.playerId], picks: [] } });
});
```

- [ ] **Step 2: Run** `npx vitest run src/ui/mail.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** `AdviceCards`: a `Card` titled by kind ("To add" / "To move" / "To sign"), a
  `mail-table` row per pick: player (`PlayerLink` when he still exists, else the snapshot name), club (`TeamLink` or
  "Free agent"), why, price, button. `openTalks(league, row)` builds the `DeskDraft` (sell: `mine.players`, partner
  `row.partnerId` ?? first buyer-stance club) and navigates to `{ view: 'office', tab: 'trades' }`.
- [ ] **Step 4: Run** the file, `src/ui/ui.test.ts`, `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** "Advice card: picks with a price and a button".

### Task 5: Docs and version

- [ ] **Step 1:** `docs/NEWS.md`: replace the market report rule ("SNN tells a trade's story; the director's market
  report says what it means for us…") with the four moments, the lean and the picks' fog-of-war rule.
- [ ] **Step 2:** `package.json` 0.1.18 → 0.1.19; changelog entry ("Your director's recommendations").
- [ ] **Step 3: Run** `npm run format && npm run typecheck && npx vitest run`. Expected: all pass.
- [ ] **Step 4: Commit** "Director's recommendations: docs and 0.1.19"; push; open the PR; read CI.
