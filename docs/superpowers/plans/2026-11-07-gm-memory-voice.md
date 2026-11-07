# GM Memory and Voice (Build B) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rival GMs remember trades and negotiations with you, lean three existing trade decisions on that memory, and
talk to you in their own varied voice in letters and on the trade table.

**Architecture:** A new `gmMemory.ts` keeps each AI GM's moments with your GM on his record and works out a standing
from them (no dice drawn). The trade code records moments where deals close or threads end, and reads the standing at
three existing decisions. A new `gmTalk.ts` owns every word: a fact sheet per letter or line, banks of lines chosen
through `voice.ts`'s `say`, and helpers `inbox.ts`, `judge.ts`, `talks.ts` and `ui/gm.tsx` call.

**Tech Stack:** TypeScript, Vitest, React (one screen file), tsx scripts.

**Spec:** `docs/superpowers/specs/2026-11-07-gm-memory-voice-design.md`

## Global Constraints

- No `Math.random` and no new RNG draws: memory and voice are pure functions of the league.
- A GM at neutral standing (no moments) behaves exactly as today in every decision.
- No opener, sign-off, table line, refusal or director line contains a digit, a habit name (`HABITS` labels), an
  archetype name, or the words "standing" or "trust". The offer itself keeps its pick labels ("No. 12").
- Tone: businesslike to warm; a sour GM is curt, never rude, never insults you. Pronouns through `pron` (`pronouns.ts`).
- Screens never read memory: `src/ui` must not reference `withYou`, `standingWith` or `YouMoment`.
- `League` stays plain JSON. `SAVE_VERSION` 90 with a `migrate.ts` step.
- Never loosen a check range. `npm run trades` must stay green.
- `npm run format` before each commit. Locally run `npm run typecheck` and the test files touched; run `npm run trades`
  once, alone (it is memory-heavy), in Task 7.
- Commit messages end with:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01M3omQupUXyRu7iTWNDJTWU
  ```
- Branch `claude/amazing-dirac-sa4npe`, already restarted from main; plain `git push -u origin
  claude/amazing-dirac-sa4npe`.

## Review Focus

1. **The chair changes hands mid-thread.** An offer filed by one GM, answered after his club appointed another: the
   moment goes to the GM in the chair when you act, and to nobody if the chair is empty. Test in Task 2.
2. **A club with no GM sends a letter.** It signs as "<Team> front office" with no opener or memory and plain manner,
   never throws. Test in Task 5.
3. **A traded player retires or is cut before the trade is judged.** He reads as gone (role 0), not unknown, and the
   judge never throws on a missing player. Test in Task 3.
4. **An older save with pending offers and stored trust.** It loads, drops `trust`, keeps offers and talks working.
   Test in Task 1.
5. **Declining a bid you asked for.** Answering an enquiry with "make me an offer" files a bid with `replyTo`; declining
   it is a straight no, not being led on. Test in Task 2.

---

## File Structure

| File | Responsibility |
| --- | --- |
| `src/engine/gmMemory.ts` (new) | Moments: record, prune, judge a season later, standing, bands, steps. |
| `src/engine/gmTalk.ts` (new) | Every GM word to you: fact sheet, banks, letters, table line, refusal, director note. |
| `src/engine/types.ts` | `YouMoment` types, `GeneralManager.withYou`, `TradeTalks` without `trust`. |
| `src/engine/trade/talks.ts` | Proposals a moment by standing; refusal through `gmTalk`; trust removed. |
| `src/engine/trade/judge.ts` | Price by standing; table line through `gmTalk`. |
| `src/engine/trade/offers.ts` | Record moments; patience by standing; who calls first. |
| `src/engine/offseason/index.ts` | `memoryNewYear` beside `habitsNewYear`. |
| `src/engine/inbox.ts` | Letters signed by the GM, wrapped by `gmTalk`, with his face. |
| `src/ui/gm.tsx`, `src/ui/offers.tsx` | Director's history line; proposals left by standing. |
| `scripts/gm-letters.ts` (new) | Read-through file of sample letters and lines. |

---

### Task 1: Memory store, standing and his price

**Files:**
- Create: `src/engine/gmMemory.ts`, `src/engine/gmMemory.test.ts`
- Modify: `src/engine/types.ts` (beside `HabitMove`, `GeneralManager`, `TradeTalks`), `src/engine/generate.ts:54`,
  `src/engine/migrate.ts` (after `toV89`), `src/engine/migrate.test.ts`, `src/engine/trade/talks.ts`,
  `src/engine/trade/judge.ts:267-312`, `src/engine/trade/offers.ts` (remove the four `nudgeTrust` calls),
  `src/ui/trades.test.tsx:112`

**Interfaces:**
- Produces (types.ts):
  ```ts
  export type YouMomentKind = 'trade' | 'tookOffer' | 'ledOn' | 'finalNo';
  export type TradeVerdictLater = 'heWon' | 'both' | 'youWon' | 'brokeDown' | 'even';
  export interface YouMoment {
    kind: YouMomentKind;
    season: number;
    phase: Phase;
    got?: { players: number[]; picks: number[] }; // what moved to him
    gave?: { players: number[]; picks: number[] }; // what he sent you
    atClose?: 'paidUp' | 'fair' | 'squeezed';
    verdict?: TradeVerdictLater;
    big?: boolean;
  }
  // GeneralManager gains: /** Moments with your GM (gmMemory.ts); absent until one happens. */ withYou?: YouMoment[];
  // TradeTalks loses `trust`.
  ```
- Produces (gmMemory.ts):
  ```ts
  export const KEEP_SEASONS = 6;
  export const KEEP_MOMENTS = 12;
  export const STANDING_MARGIN = 0.06;
  export const WEIGHTS: Record<YouMomentKind | TradeVerdictLater, number>;
  export function noteMoment(league: League, gm: GeneralManager | undefined, m: Omit<YouMoment, 'season' | 'phase'>): void;
  export function pruneMoments(league: League, gm: GeneralManager): void;
  export function standingWith(league: League, gm: GeneralManager | undefined): number; // −1 … 1
  export type StandingBand = 'warm' | 'easy' | 'neutral' | 'cool' | 'sour';
  export function standingBand(s: number): StandingBand; // ≥0.35 warm, ≥0.12 easy, ≤−0.35 sour, ≤−0.12 cool
  export function standingStep(s: number): -1 | 0 | 1; // +1 at ≥0.35, −1 at ≤−0.35
  ```
- Changes: `marginFor(team, other, vsUser = false, standing = 0)` (the `trust` parameter renamed); `TRUST_MARGIN`
  replaced by `STANDING_MARGIN`; `nudgeTrust`, `TRUST_DRIFT` and the trust half of `settleTalks` removed.

- [ ] **Step 1: Write the failing tests** in `src/engine/gmMemory.test.ts` (build a league with
  `createLeague({ seed: 'gm-memory' })`, take an AI GM with `aiGm(l, l.teams[1])!`, set `gm.withYou` by hand):

  ```ts
  it('is neutral with no moments, and for no GM', () => {
    expect(standingWith(l, gm)).toBe(0);
    expect(standingWith(l, undefined)).toBe(0);
  });
  it('orders the weights', () => {
    expect(WEIGHTS.heWon).toBeGreaterThan(WEIGHTS.tookOffer);
    expect(WEIGHTS.tookOffer).toBeGreaterThan(0);
    expect(WEIGHTS.ledOn).toBeLessThan(0);
    expect(WEIGHTS.finalNo).toBeLessThan(WEIGHTS.ledOn);
    expect(WEIGHTS.youWon).toBeLessThan(WEIGHTS.finalNo);
  });
  it('stays within −1 … 1', () => { /* 12 finalNo this season */ expect(standingWith(l, gm)).toBe(-1); });
  it("a stubborn GM's moment outlasts a flexible GM's", () => {
    // one youWon trade two seasons ago; gm.traits.stubbornness 1 vs 0
    expect(Math.abs(stubborn)).toBeGreaterThan(Math.abs(flexible));
  });
  it("a big trade's verdict counts one and a half times", () => {
    expect(bigVerdictOnly).toBeCloseTo(1.5 * smallVerdictOnly, 5); // compare verdict contributions, trade weight subtracted
  });
  it('keeps six seasons and twelve moments, a big trade the last to go', () => {
    // 13 moments this season, the oldest one a big trade: after pruneMoments, 12 left and the big trade among them;
    // a moment 7 seasons old is dropped
  });
  it('bands and steps', () => {
    expect([0.4, 0.2, 0, -0.2, -0.4].map(standingBand)).toEqual(['warm', 'easy', 'neutral', 'cool', 'sour']);
    expect([0.35, 0.34, -0.34, -0.35].map(standingStep)).toEqual([1, 0, 0, -1]);
  });
  it('moves his price with you at most six percent either way', () => {
    const t = l.teams[1], o = l.teams[l.userTeamId];
    expect(marginFor(t, o, true, 1) - marginFor(t, o, true, 0)).toBeCloseTo(-0.06, 9);
    expect(marginFor(t, o, true, -1) - marginFor(t, o, true, 0)).toBeCloseTo(0.06, 9);
  });
  ```

  In `src/engine/migrate.test.ts`:
  ```ts
  it('v90 drops trust from talks and keeps pending offers', () => {
    // a v89 document: market.talks[3] = { moment: 2, asks: 1, trust: 0.4, cooldowns: {} } and one pending offer
    // after migrateLeague: 'trust' in talks[3] is false, asks is 1, the offer is still pending, no GM has withYou
  });
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run src/engine/gmMemory.test.ts src/engine/migrate.test.ts`
  Expected: FAIL (module `./gmMemory` not found; v90 step missing).

- [ ] **Step 3: Add the types, `gmMemory.ts`, the save step and the price lean**

  Weights: `trade` 0.05, `tookOffer` 0.05, `ledOn` −0.10, `finalNo` −0.15, `heWon` 0.25, `both` 0.20, `even` 0,
  `youWon` −0.30, `brokeDown` −0.25. Standing is read, never stored:

  ```ts
  // For each moment: its kind's weight, plus its verdict's weight (×1.5 when big) once judged,
  // faded by age = league.season − m.season at half-life h = 1 + 2 × stubbornness seasons
  // (stubbornness from gm.traits, 0.5 when absent). Sum, then clamp to −1 … 1.
  s += (WEIGHTS[m.kind] + (m.verdict ? WEIGHTS[m.verdict] * (m.big ? 1.5 : 1) : 0)) * 0.5 ** (age / h);
  ```

  `noteMoment` stamps `season` and `phase` from the league, pushes, then calls `pruneMoments` (drop moments older than
  `KEEP_SEASONS`; past `KEEP_MOMENTS`, drop the oldest non-big moment first, then the oldest). It does nothing for an
  undefined GM or for your own GM (`gm.id === league.userGmId`).

  In `judge.ts` line 310, read `standingWith(league, aiGm(league, team))` when `vsUser`, else 0, and pass it to
  `marginFor`, whose user branch becomes `1.05 + stubbornness * 0.15 - STANDING_MARGIN * standing`. Remove
  `nudgeTrust` and its four calls in `offers.ts` (lines 605, 663, 744, 786); Task 2 adds the moments that replace them.
  `SAVE_VERSION = 90`; `toV90` deletes `trust` from every `market.talks` entry. Fix the literal in
  `src/ui/trades.test.tsx:112` (no `trust`).

- [ ] **Step 4: Run the tests and typecheck**

  Run: `npx vitest run src/engine/gmMemory.test.ts src/engine/migrate.test.ts src/ui/trades.test.tsx && npm run typecheck`
  Expected: PASS, no type errors.

- [ ] **Step 5: Commit** — "GM memory: moments with you on the GM, a standing read from them, his price by it (v90)"

---

### Task 2: Recording moments where deals close and threads end

**Files:**
- Modify: `src/engine/trade/offers.ts` (`settle` 587, `declineOffer` 654, `counterOffer` 713), `src/engine/gmMemory.ts`
- Create: `src/engine/trade/youMoments.test.ts`

**Interfaces:**
- Consumes: `noteMoment`, `standingWith` (Task 1); `aiGm` (`gmHabits.ts`); `judge` (`judge.ts`); `starters`
  (`roster.ts`).
- Produces (gmMemory.ts):
  ```ts
  export function atCloseOf(get: number, need: number): 'paidUp' | 'fair' | 'squeezed'; // r = get / max(need, 1): r < 1.03 squeezed, r ≥ 1.15 paidUp
  export function isBig(league: League, sides: readonly TradeSide[]): boolean; // a first-round pick, or a player who starts for his club now
  ```

Rules (each records to `aiGm(league, team)` at the time you act; nothing when the chair is empty):
- `settle`, before `executeTrade`: `trade`, with `got`/`gave` read by `teamId` (his side is the one whose `teamId ===
  aiId`; the sides arrive in either order), `atClose` from `judge(ctx, aiId, { sides }, { vsUser: true, rosterCuts:
  true })`, `big` from `isBig`. Also `tookOffer` when `opts.offerId` names an offer whose `reason !== 'counter'` and
  the closed sides hold exactly that offer's players and picks.
- `declineOffer`: `finalNo` when `offer.final`; else `ledOn` when `offer.reason === 'counter'`; else nothing.
- `counterOffer`'s walk: `finalNo` when the offer was final (or out of patience); `ledOn` when he walks because no
  counter could be filed (`!next`).

- [ ] **Step 1: Write the failing tests** in `src/engine/trade/youMoments.test.ts`. Build offers by pushing
  `TradeOffer` literals into `l.market.offers` and use picks-only sides, so no physical holds a deal up:

  ```ts
  it('notes a closed trade once, with what he got and gave and how it looked at close', () => {
    // proposeTrade a picks-only deal he accepts
    expect(gm.withYou).toHaveLength(1);
    expect(gm.withYou![0]).toMatchObject({ kind: 'trade', got: { picks: [yourPick] }, gave: { picks: [hisPick] } });
    expect(['paidUp', 'fair', 'squeezed']).toContain(gm.withYou![0].atClose);
  });
  it('notes taking his offer at his price, not a counter of yours he took', () => { /* acceptOffer → trade + tookOffer; counterOffer accepted → trade only */ });
  it('a straight no notes nothing', () => {
    // declineOffer on a non-final bid; proposeTrade he rejects; an offer left to lapse (advance the moment)
    expect(gm.withYou ?? []).toEqual([]);
  });
  it('declining a bid you asked for is still a straight no', () => {
    // answerEnquiry(l, id, 'offer') files a bid with replyTo; declineOffer on it
    expect(gm.withYou ?? []).toEqual([]);
  });
  it('declining his counter after yours is being led on; his final offer is a final no', () => {
    // reason 'counter', final undefined → ledOn; reason 'counter', final true → finalNo; a final bid → finalNo
  });
  it('a counter that makes him walk at his final offer is a final no', () => { /* counterOffer on a final offer with a lowball */ });
  it('goes to the GM in the chair when you act, and to nobody when it is empty', () => {
    // offer filed; appointGm another GM to that club; decline the final offer → the new GM has finalNo, the old none
    // team.gmId = null → decline notes nothing, no throw
  });
  it('follows the people', () => {
    // a GM with a youWon trade is appointed to another club: standingWith unchanged
    // your GM moves to another club (user GM teamId changed): the AI GM's standing toward you unchanged
  });
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run src/engine/trade/youMoments.test.ts`
  Expected: FAIL (no moments recorded; `atCloseOf` not exported).

- [ ] **Step 3: Add `atCloseOf`, `isBig` and the recording calls** in the places and by the rules above.

- [ ] **Step 4: Run the trade tests**

  Run: `npx vitest run src/engine/trade/youMoments.test.ts src/engine/trade/offers.test.ts src/engine/trade/habits.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** — "GM memory: trades, his offer taken, being led on and a final no, noted as they happen"

---

### Task 3: Judging trades a season later

**Files:**
- Modify: `src/engine/gmMemory.ts`, `src/engine/offseason/index.ts:233`, `src/engine/gmMemory.test.ts`

**Interfaces:**
- Consumes: `seasonRole` (`scouting.ts`), `pruneMoments` (Task 1).
- Produces:
  ```ts
  export interface PieceRead { role: number; hurt: boolean } // 3 starter, 2 rotation, 1 backup, 0 gone or no games
  export function pieceRole(league: League, kind: 'player' | 'pick', id: number): PieceRead | null; // null: not known yet
  export function judgeTrade(m: YouMoment, season: number, read: (kind: 'player' | 'pick', id: number) => PieceRead | null): TradeVerdictLater | null;
  export function memoryNewYear(league: League): void; // judge every unjudged trade, then prune; called after habitsNewYear
  ```

`pieceRole`: a player missing, retired or on no roster → `{ role: 0, hurt: false }`; else `seasonRole(league, p)`
mapped starter 3, rotation 2, backup 1, null 0; `hurt` when `p.injuries` has a record from last season
(`league.season - 1`) of 4 or more weeks. A pick: not yet used → null; used, and its player has no stats for last
season → null; else that player's read.

`judgeTrade` returns null when `m.verdict` is set (a verdict is final), when `season <= m.season`, or when a piece is
unknown and `season - m.season < 3`. Otherwise, with unknown pieces left out:

```ts
if (gotReads.some((r) => r.hurt && r.role <= 1)) return 'brokeDown';
const G = sum(gotReads.role), V = sum(gaveReads.role);
if (G >= 3 && V >= 3 && Math.abs(G - V) <= 1) return 'both';
if (G - V >= 2) return 'heWon';
if (V - G >= 2) return 'youWon';
return 'even';
```

- [ ] **Step 1: Write the failing tests** in `src/engine/gmMemory.test.ts` (a fake `read` for `judgeTrade`):

  ```ts
  it('a starter he got against a man who barely played reads heWon', () => { expect(judgeTrade(m, s + 1, read)).toBe('heWon'); });
  it('a pick waits for its player’s first season', () => { expect(judgeTrade(withPick, s + 1, readPickNull)).toBeNull(); });
  it('three league years on, an unknown piece is left out', () => { expect(judgeTrade(withPick, s + 3, readPickNull)).not.toBeNull(); });
  it('a man he got who barely played through injury reads brokeDown', () => { /* hurt true, role 1 */ });
  it('each side getting a starter or better reads both', () => { /* G 3, V 3 */ });
  it('a verdict never changes once set', () => { /* m.verdict = 'heWon'; judgeTrade returns null; memoryNewYear twice leaves it */ });
  it('a traded player who retired or was cut reads as gone, not unknown', () => {
    // real league: p.retired = true → pieceRole(l, 'player', p.id) toEqual { role: 0, hurt: false }; setTeam(l, q, null) → role 0
  });
  it('judges last season’s trades at the new league year', () => {
    // createLeague, note a trade moment with two real players, simToEndOfSeason, beginOffseason → verdict set
  });
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run src/engine/gmMemory.test.ts`
  Expected: FAIL (`judgeTrade` not exported).

- [ ] **Step 3: Implement `pieceRole`, `judgeTrade`, `memoryNewYear`** and call `memoryNewYear(league)` right after
  `habitsNewYear(league)` in `offseason/index.ts`.

- [ ] **Step 4: Run the tests**

  Run: `npx vitest run src/engine/gmMemory.test.ts src/engine/gmHabitsYear.test.ts`
  Expected: PASS.

- [ ] **Step 5: Commit** — "GM memory: each trade judged a season on from how the men played"

---

### Task 4: His patience and who calls you first

**Files:**
- Modify: `src/engine/trade/talks.ts`, `src/engine/trade/offers.ts` (`file` 280, `offersMoment` 300-372, callers of
  `talkRefusal` 719 and 780), `src/engine/trade/judge.ts:382`, `src/ui/offers.tsx:620-622`
- Test: `src/engine/trade/youMoments.test.ts`

**Interfaces:**
- Consumes: `standingWith`, `standingStep` (Task 1); `aiGm`.
- Produces:
  ```ts
  // talks.ts
  export const ASKS = 4; // at neutral
  export function asksFor(league: League, teamId: number): number; // ASKS + standingStep(standing)
  export function talkRefusal(league: League, teamId: number): string | null; // was (market, teamId)
  // offers.ts
  export function patienceFor(league: League, team: Team): number; // max(1, 1 + round(2 × stubbornness) + standingStep)
  ```
- Changes in `offersMoment`: each call's `score` gains `standingWith(league, aiGm(league, c.team))`; a pitch from a
  GM at `standingStep === -1` gets `rate: OFFER_RATE / 2`. `BUDGET` and the draw order are unchanged (the `rng.chance`
  draw happens either way, so a neutral league draws the same).
- `ui/offers.tsx` reads `asksFor(league, teamId) - peekTalks(...).asks === 1` for "Nearly done talking this week".

- [ ] **Step 1: Write the failing tests** in `src/engine/trade/youMoments.test.ts`:

  ```ts
  it('hears three to five proposals by standing, four at neutral', () => {
    expect([sour, neutral, warm].map((g) => asksFor(l, g.teamId!))).toEqual([3, 4, 5]);
  });
  it('counters run a round longer for a friendly GM, never below today’s minimum', () => {
    // stubbornness 0: neutral 1, warm 2, sour 1; stubbornness 1: neutral 3, sour 2
  });
  it('a sour GM is still taking your call', () => { expect(talkRefusal(l, sourTeamId)).toBeNull(); });
  it('offers to you keep their count whoever is warm or sour', () => {
    // offersMoment on two JSON copies at the deadline, one with a warm and a sour GM planted: same length
  });
  it('a neutral league calls exactly as before', () => {
    // offersMoment on two JSON copies, one with every GM's withYou = [] set explicitly: deep-equal offers
  });
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run src/engine/trade/youMoments.test.ts`
  Expected: FAIL (`asksFor`, `patienceFor` not exported).

- [ ] **Step 3: Implement** the interfaces above; `talkRefusal` compares `asks >= asksFor(...)`; `file` sets
  `patience: patienceFor(league, team)`.

- [ ] **Step 4: Run the trade and UI tests**

  Run: `npx vitest run src/engine/trade src/ui/trades.test.tsx && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit** — "GM memory: his patience and who calls you first lean on how he feels about you"

---

### Task 5: His letters in his own voice

**Files:**
- Create: `src/engine/gmTalk.ts`, `src/engine/gmTalk.test.ts`
- Modify: `src/engine/inbox.ts` (`offerWords` 1172, `offerMail` 1263)

**Interfaces:**
- Consumes: `standingWith`, `standingBand` (Task 1); `say`, `recentBodies`, `Line` (`voice.ts`); `pron`; `aiGm`;
  `ago` (`gmVoice.ts`) for "last spring"-style time words.
- Produces:
  ```ts
  export type Manner = 'firm' | 'urgent' | 'careful' | 'easy' | 'plain';
  export type TalkMoment = 'deadline' | 'week' | 'leagueYear' | 'freeAgency' | 'camp' | 'draft' | 'offseason';
  export interface MemoryFact { kind: 'heWon' | 'both' | 'youWon' | 'brokeDown' | 'finalNo' | 'ledOn'; player: string; when: string }
  export interface TalkFacts {
    team: Team; gm?: GeneralManager; manner: Manner; band: StandingBand;
    memory?: MemoryFact; moment: TalkMoment; final: boolean; p: ReturnType<typeof pron>;
  }
  export function talkFacts(league: League, team: Team, opts?: { final?: boolean }): TalkFacts;
  export function letterFrom(league: League, team: Team): string; // "<First Last>, <Team name> GM", or "<City Name> front office" with an empty chair
  export function wrapLetter(league: League, offer: TradeOffer, core: string): string; // [opener, core, signOff] joined by spaces, empties dropped
  export const OPENERS: readonly Line<TalkFacts>[];
  export const MEMORY_OPENERS: readonly Line<TalkFacts>[];
  export const SIGNOFFS: readonly Line<TalkFacts>[];
  ```

Fact rules:
- **Manner**, first that fits: stubbornness ≥ 0.7 firm; winNow ≥ 0.7 urgent; capAggression ≤ 0.3 careful;
  stubbornness ≤ 0.3 easy; else plain. No GM: plain.
- **Memory**: the most recent judged trade with a verdict other than `even` from the last two seasons, else a
  `finalNo` or `ledOn` from this season or last; `player` is the full name of the deal's best-known player (the first
  player he got, else the first he gave); absent when none or no GM.
- **Moment** from phase and week: `regular` with `isDeadlineDay(league)` (`trade/rules.ts`) → deadline, other weeks
  → week; `resign` → leagueYear;
  `freeAgency` → freeAgency; `camp`/`preseason` → camp; `draft` → draft; anything else → offseason.

Bank rules:
- `OPENERS`: at least six lines with no band or moment condition (the neutral pool), three or more for each other
  band, and two or more for deadline and draft at `reads: 1`.
- `MEMORY_OPENERS`: two or more per memory kind at `reads: 2`; used only when `memory` is set and his previous letter
  (`recentBodies(league, from, 1)`) doesn't name `memory.player`.
- `SIGNOFFS`: at least six per manner; a `final` sign-off pool (three or more at `reads: 1`) that says it's his final
  offer in his words.
- Pick each slot with `say(bank, facts, { key: \`${offer.season}:${offer.id}\`, slot, recent: recentBodies(league, from) })`.
- Examples of the register (write the rest in the same voice):
  - neutral opener: "Wanted to get this in front of you before the week gets away."
  - sour opener: "I'll keep this short."
  - warm opener: "You've been straight with me, so I'll come to you first."
  - memory, `heWon`: "The Jefferson deal worked out for us, so let's talk again."
  - memory, `youWon`: "You got the better of me on the Jefferson deal. Not this time."
  - sign-off, firm: "That's where we are." · urgent: "I need an answer this week." · final: "That's as far as I go."

`offerWords` drops its `close` string (the final sign-off replaces it) and returns `body: wrapLetter(league, offer,
core)`. `offerMail` sets `from: letterFrom(league, team)` and, when the club has a GM, `gmNotes: [{ gmId, line: '' }]`
(`GmWho` already omits an empty line).

- [ ] **Step 1: Write the failing tests** in `src/engine/gmTalk.test.ts`:

  ```ts
  // Test-local: SAMPLES is every manner × band × moment, with and without memory and final; HABIT_LABELS is
  // Object.values(HABITS).map((h) => h.label) (gmHabits.ts); ARCHETYPE_NAMES is Object.keys(ARCHETYPE_ACTIVITY)
  // (gmTraits.ts); MANNERS the five manners; neutralOpeners and signOffsFor(m) filter all(...) by facts.
  const SAMPLES: TalkFacts[] = [];
  const all = (bank) => SAMPLES.flatMap((f) => bank.filter((x) => !x.when || x.when(f)).map((x) => x.text(f)));
  it('gives each common slot at least six lines', () => {
    expect(new Set(neutralOpeners).size).toBeGreaterThanOrEqual(6);
    for (const m of MANNERS) expect(new Set(signOffsFor(m)).size).toBeGreaterThanOrEqual(6);
  });
  it('never says a number, a habit, an archetype, standing or trust', () => {
    for (const s of [...all(OPENERS), ...all(MEMORY_OPENERS), ...all(SIGNOFFS)]) {
      expect(s).not.toMatch(/\d|standing|trust/i);
      for (const h of HABIT_LABELS) expect(s).not.toContain(h);
      for (const a of ARCHETYPE_NAMES) expect(s).not.toContain(a);
    }
  });
  it('keeps the offer exact', () => { expect(offerWords(l, offer).body).toContain(core); });
  it('does not repeat an opener inside his last five letters', () => {
    // six letters from one neutral GM filed into the inbox in turn: the openers of any five in a row are distinct
  });
  it('names a memory only when there is one, and not in back-to-back letters', () => {
    // no moments → no MEMORY_OPENERS text; a heWon trade → first letter names the player, the next does not
  });
  it('signs as the GM by name with his face, or the front office when the chair is empty', () => {
    // offerMail draft: from === 'First Last, Name GM' and gmNotes[0].gmId === gm.id
    // team.gmId = null: from ends with 'front office', no gmNotes, body still holds the offer
  });
  it('says it is his final offer in his own words', () => { /* final offer body has a final sign-off, no 'That is our final offer.' */ });
  ```

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run src/engine/gmTalk.test.ts`
  Expected: FAIL (module `./gmTalk` not found).

- [ ] **Step 3: Write `gmTalk.ts` and wire `offerWords`/`offerMail`** per the rules above.

- [ ] **Step 4: Run the tests**

  Run: `npx vitest run src/engine/gmTalk.test.ts src/engine/inbox.test.ts src/engine/trade/offers.test.ts && npm run typecheck`
  Expected: PASS. Update any `inbox.test.ts` assertion that pinned a fixed offer body to check the core instead.

- [ ] **Step 5: Commit** — "GM voice: his letters signed by him, opened and closed in his own words"

---

### Task 6: The trade table line, his refusal and your director's note

**Files:**
- Modify: `src/engine/gmTalk.ts`, `src/engine/trade/judge.ts:382-410`, `src/engine/trade/talks.ts` (`talkRefusal`),
  `src/ui/gm.tsx:48-60`, `src/ui/ui.test.ts:377`, `src/ui/trades.test.tsx:115`, `src/engine/trade/offers.test.ts:477`
- Test: `src/engine/gmTalk.test.ts`

**Interfaces:**
- Consumes: `talkFacts` (Task 5); `memory` facts.
- Produces:
  ```ts
  export type TableBand = 'accept' | 'close' | 'short' | 'far';
  export const TABLE_LINES: readonly Line<TalkFacts & { table: TableBand }>[];
  export const REFUSALS: readonly Line<TalkFacts>[];
  export const HISTORY: readonly Line<TalkFacts>[];
  export function tableLine(league: League, ai: Team, band: TableBand, proposal: TradeProposal): string;
  export function refusalLine(league: League, ai: Team): string;
  export function historyNote(league: League, gm: GeneralManager): string | null; // null with no memory fact
  ```

Rules:
- `evaluateTrade` maps its outcome to a band (accept; close below 0.12 of the scale; short below 0.4; far) and returns
  `tableLine(...)` as `message`. A league `problem` stays plain; a GM's own `refusal` line from `judge` stays as is.
- `tableLine` keys `say` on `${ai.id}:${market.moment}:${ids}` where `ids` is the sorted player and pick ids of both
  sides, so the same deal in the same moment always reads the same.
- At least six lines per table band; first person; a "close" line points at a small add ("Put a late pick on it and
  I'll do it."), never a number.
- `talkRefusal` returns `refusalLine(...)` (at least six lines, curt for a sour GM, never rude).
- `historyNote` is your director's hedged sentence ("He hasn't forgotten the Jefferson deal."), at least two lines per
  memory kind; `gmStyleNotes` appends it for an AI GM when it is not null.
- `ui.test.ts`'s banned-identifier regex adds `\bwithYou\b|\bstandingWith\b|\bYouMoment\b`.

- [ ] **Step 1: Write the failing tests** in `src/engine/gmTalk.test.ts`:

  ```ts
  it('answers in his own words by how close the deal is', () => {
    // a far proposal's evaluateTrade message is a TABLE_LINES 'far' text; an accepted one an 'accept' text
  });
  it('gives each table band and the refusal at least six lines', () => { /* distinct texts across SAMPLES */ });
  it('says the same thing for the same deal in the same moment', () => {
    expect(evaluateTrade(l, p).message).toBe(evaluateTrade(l, p).message);
    // the same deal with its sides' ids listed in another order reads the same
  });
  it('keeps a league rule plain', () => { /* a roster-limit problem returns the rule's own text */ });
  it('table, refusal and history lines never say a number, standing or trust', () => { /* as in Task 5 */ });
  it('your director notes your history only when there is one', () => {
    expect(historyNote(l, freshGm)).toBeNull();
    // after a youWon trade: a HISTORY line naming the player
  });
  ```
  Update `trades.test.tsx:115` and `offers.test.ts:477` to expect a `REFUSALS` text (membership), not the old string.

- [ ] **Step 2: Run them and see them fail**

  Run: `npx vitest run src/engine/gmTalk.test.ts`
  Expected: FAIL (`tableLine` not exported).

- [ ] **Step 3: Implement** per the rules above.

- [ ] **Step 4: Run the tests**

  Run: `npx vitest run src/engine/gmTalk.test.ts src/engine/trade src/ui/ui.test.ts src/ui/trades.test.tsx && npm run typecheck`
  Expected: PASS.

- [ ] **Step 5: Commit** — "GM voice: the trade table answers in his words, and your director remembers your history with him"

---

### Task 7: Read-through, docs, version and the trades check

**Files:**
- Create: `scripts/gm-letters.ts`
- Modify: `package.json` (script `"gm-letters": "tsx scripts/gm-letters.ts"`, version `0.4.10`), `src/ui/changelog.ts`,
  `docs/TRADES.md` (Offers to you; talks), `CLAUDE.md` (architecture: `gmMemory.ts`, `gmTalk.ts`; the commands list)

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Write `scripts/gm-letters.ts`.** Build `createLeague({ seed: 'gm-letters' })`; pick six AI GMs covering
  each manner; plant `withYou` moments to give two warm, two neutral and two sour, with at least one of each memory
  kind; for each GM write a pitch, a bid, a counter and a final counter (`offerWords` on `TradeOffer` literals with
  real players and picks), one table line per band, the refusal and the director's note. Write them under one
  heading per GM, with his manner and band in the heading only, to `.check/gm-letters.md`, and print the path.

- [ ] **Step 2: Run it**

  Run: `npm run gm-letters`
  Expected: prints `.check/gm-letters.md`; the file holds about thirty letters and lines; none contains a digit outside
  the offer, "standing" or "trust".

- [ ] **Step 3: Docs, changelog, version.** `docs/TRADES.md`: how GMs remember you (moments, a season-later verdict,
  standing) and its three leans, replacing the trust paragraph. `CLAUDE.md`: one architecture entry for `gmMemory.ts`
  and `gmTalk.ts`; `npm run gm-letters` in the commands list as a preview, not a check. Changelog entry in player-facing
  words. `package.json` 0.4.10.

- [ ] **Step 4: Run the trades check alone**

  Run: `npm run trades`
  Expected: "Nothing flagged" with no range loosened. A red line means the neutral path changed: find it, don't tune
  around it.

- [ ] **Step 5: Commit and push** — "GM memory and voice: read-through script, docs and 0.4.10"

  ```bash
  git push -u origin claude/amazing-dirac-sa4npe
  ```

- [ ] **Step 6: Owner read-through (gate).** Send the owner `.check/gm-letters.md`. Tune the banks from their notes,
  re-run Steps 2 and 4, commit. Only then open the PR.
