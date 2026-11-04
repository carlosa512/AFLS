# Chemistry on Sunday (L3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A room's mood and its time together move play a little on Sunday (±0.3 rating points, centred on the
league), Sparks and Anchors rub off on their rooms' moods, and your club sees it in words.

**Architecture:** A new `src/engine/chemistry.ts` works out each club's rooms once a week (mood part from L1's
`unitRead`, time together from `Player.statTeams`), centres them on the league, and hands `buildLineup` one edge per
room that joins the knocks every contest already reads. The Spark/Anchor pull is two new terms in `roomScore`
(`morale.ts`), read from a snapshot in `MoraleContext`. Then the Locker Room line, the tags and the coach's report
lines. **One PR** (the owner's call): part 1 the engine (Tasks 1–5), part 2 the words and screens (Tasks 6–7), one
version bump, CI tuned once against the final state.

**Tech Stack:** TypeScript, Vitest, React (part 2 only), the `scripts/morale.ts` check.

**Spec:** `docs/superpowers/specs/2026-11-03-chemistry-on-sunday-design.md`

## Global Constraints

- Edge cap ±0.3 (`CHEM.cap`); mood part ±0.2 (`CHEM.mood`); Divided extra −0.05 (`CHEM.split`), inside the mood part;
  time-together part ±0.15 (`CHEM.together`); a pair counts at most three seasons (`CHEM.maxSeasons`).
- Words: **Clicking** ≥ +0.15, **Out of sync** ≤ −0.15, **Still learning each other** in between when the time part is
  −0.05 or worse, **Gelling** otherwise. Clicking and Out of sync each 10–30% of read rooms.
- Pull weights: Spark 1, Anchor 0.5, plain voice 0.5; an Anchor in the room halves every Spark's weight; a man is
  never pulled by himself. `TONE.voices` 0.75, `TONE.friends` 0.25, inside `roomScore`'s existing ±1.5 clamp.
- Time together rooms only: OL (five depth-chart starters), DB (starting CBs and Ss), and the passing game (QB1 with
  WR1, WR2, TE1), counted for both the QB and WR rooms. All other rooms: no time part (`null`).
- No `Math.random`, nothing drawn from any stream, nothing new stored: no `SAVE_VERSION` bump.
- Your club only on screen, in words. Letters: no digits, no engine words (L1 §6.2 list, "chemistry" included).
- Never loosen a check range without the owner's call; measure against main first.
- Prettier before every commit; commit trailer as in CLAUDE.md's session rules. Push to the branch freely; open the one
  PR only when the owner says go.

## Review Focus

1. A room short of starters (injuries, a thin depth chart): fewer than two men in a time-together room gives `null`,
   never `NaN` or a crash (test in Task 2).
2. Players with no `statTeams` (old saves, rookies) count zero seasons together (test in Task 2).
3. Week 1 of a new league: every pair has zero seasons, so the time part is 0 everywhere and no room reads "Still
   learning each other" for that reason alone (test in Task 2).
4. A depth chart changed after the weekly cache filled: the next lineup's time together reads the new starters (test in
   Task 3).
5. Determinism: a replayed game with chemistry on plays the same as the first time (test in Task 3).

---

## Part 1: the engine

### Task 1: `UnitRead.level` and the voices' plain names

**Files:**
- Modify: `src/engine/standing.ts` (`UnitRead`, `unitRead`, after `soundOf`)
- Test: `src/engine/standing.test.ts`

**Interfaces:**
- Produces: `UnitRead.level: number` (the weighted mean mood `unitRead` already computes as `mean`);
  `export type VoiceName = 'Spark' | 'Anchor'`; `export const voiceName = (s: Sound | null): VoiceName | null`
  (`stirs` → Spark, `steadies` → Anchor).

- [ ] **Step 1: Write the failing tests** in `standing.test.ts`:
  `it('a unit read carries its weighted mood level')`: for a built league's first club, every `unitReads(...)` entry
  has a finite `level`, and `moraleStepOf(r.level) === r.mood`.
  `it('names a voice plainly')`: `voiceName('stirs') === 'Spark'`, `voiceName('steadies') === 'Anchor'`,
  `voiceName(null) === null`.
- [ ] **Step 2:** `npx vitest run src/engine/standing.test.ts -t "level|plainly"` → FAIL (no `level`, no `voiceName`).
- [ ] **Step 3:** add `level: mean` to the returned read and the interface (doc comment: "the weighted mean mood, the
  voices counting more"), and `voiceName` beside `soundOf`.
- [ ] **Step 4:** re-run → PASS. `npm run typecheck` clean.
- [ ] **Step 5:** commit `Standing: a unit read keeps its mood level; Spark and Anchor name a voice's sound`.

### Task 2: `chemistry.ts`, the weekly read

**Files:**
- Create: `src/engine/chemistry.ts`, `src/engine/chemistry.test.ts`

**Interfaces:**
- Consumes: `unitRead`, `UnitRead.level`, `unitOf`, `Unit` (standing.ts); `moraleContext`, `moraleMean`,
  `moraleClock` (morale.ts); `starters` (roster.ts).
- Produces:
  ```ts
  export type ChemRoom = Exclude<Unit, 'ST'>;
  export type ChemWord = 'Clicking' | 'Gelling' | 'Still learning each other' | 'Out of sync';
  export const CHEM = { cap: 0.3, mood: 0.2, split: 0.05, together: 0.15, maxSeasons: 3, roomSpan: 1.6,
    clicking: 0.15, outOfSync: -0.15, learning: -0.05 };
  export interface Chemistry {
    teamId: number; unit: ChemRoom;
    mood: number;               // the mood part, ±CHEM.mood
    together: number | null;    // the time part, ±CHEM.together; null outside OL, DB, QB, WR
    years: number | null;       // the room's mean seasons together (for words), null as above
    newStarters: number;        // starters with no season together with any other starter here (for words)
    edge: number;               // centred, ±CHEM.cap
    word: ChemWord;
  }
  export function seasonsTogether(league: League, a: Player, b: Player, teamId: number): number;
  export function chemistryWeek(league: League): Map<string, Chemistry>;   // key `${teamId}:${unit}`
  export function chemistryOf(league: League, teamId: number, unit: ChemRoom): Chemistry | null;
  export function wordOf(edge: number, together: number | null): ChemWord;
  ```

Rules the tests pin (from the spec, §1):
- `seasonsTogether`: past seasons `s < league.season` where both `statTeams[s]` include `teamId`, plus this season's
  `league.week / 18` (regular season; 1 in the playoffs) when both `statTeams[league.season]` include it; capped at
  `CHEM.maxSeasons`. Missing `statTeams` counts zero.
- The pairs: OL every pair of `starters(league, team, 'OL')`; DB every pair of the starting CBs and Ss; QB and WR both
  read QB1 with the first two WRs and the first TE (three pairs). Fewer than two men → `together`/`years` null.
- Mood part: `CHEM.mood × clamp((read.level − moraleMean) / CHEM.roomSpan, −1, 1)`, less `CHEM.split` when
  `read.word === 'Split'`, clamped to ±`CHEM.mood`; no read → 0.
- Time part: `CHEM.together × clamp(years − typical, −1, 1)`, `typical` the league's mean `years` for that room this
  week.
- Edge: `clamp(mood + together, ±CHEM.cap)` less the league's mean raw edge for that room this week (centring).
- Word: from the centred edge and the time part, per Global Constraints.
- Cache: `chemistryWeek` keyed on the league object and `${season}:${phase}:${week}:${moraleAt ?? moraleClock}`; it
  builds one `moraleContext` for all clubs. `chemistryOf` reads it.

- [ ] **Step 1: Write the failing tests** in `chemistry.test.ts` (build one league, play two weeks, reuse by JSON clone):
  - `seasonsTogether` counts shared past seasons and part of this one, caps at three, and gives 0 when either has no
    `statTeams` (Review Focus 2).
  - every club's OL, DB, QB and WR rooms have a `together` and `years`; RB, DL, LB have `together === null`.
  - centred: for each room, the mean `edge` across clubs is within 1e-9 of 0; every `|edge| <= 0.3`; every
    `|mood| <= 0.2`; every non-null `|together| <= 0.15`.
  - a Split room's mood part is lower than the same room with its read forced to `Settled` (mock `unitRead`'s word, or
    build two clubs' reads by hand through the exported parts).
  - the word follows the thresholds: construct `Chemistry` values at 0.15, 0.149, −0.15, and a −0.06 time part, and
    check `wordOf` gives Clicking, Gelling, Out of sync, Still learning each other.
  - a room with one healthy OL starter left (injure the rest) has `together === null` and a finite `edge` (Review
    Focus 1).
  - a fresh league in week 1: every `together` is 0 and no word is "Still learning each other" (Review Focus 3).
- [ ] **Step 2:** `npx vitest run src/engine/chemistry.test.ts` → FAIL (module missing).
- [ ] **Step 3:** implement `chemistry.ts` to the interfaces and rules above; comments explain why (centring holds
  league totals; three seasons because gains flatten).
- [ ] **Step 4:** re-run → PASS; `npm run typecheck`.
- [ ] **Step 5:** commit `Chemistry: each room's mood and time together, centred on the league each week`.

### Task 3: the edge on game day

**Files:**
- Modify: `src/engine/match/lineup.ts` (`buildLineup` signature and the knocks loop), `src/engine/match/gameSim.ts`
  (`SimOptions`, the two `buildLineup` calls at ~728 and ~1057)
- Test: `src/engine/chemistry.test.ts`

**Interfaces:**
- Consumes: `chemistryOf`, `ChemRoom` (Task 2).
- Produces: `buildLineup(league, team, out?, game?, mean?, today = 0, chem?: Partial<Record<ChemRoom, number>>)`;
  `SimOptions.chemistry?: [home: Partial<Record<ChemRoom, number>>, away: Partial<Record<ChemRoom, number>>]` (forced
  edges, for tests and probes).

- [ ] **Step 1: Write the failing tests:**
  - `it('a room forced to each end moves its own stats the right way')`: one league, 40 replays of `l.games[0]` per
    case with `{ seed: \`c:${i}\`, days: [0, 0], chemistry: [{ OL: x }, {}] }` for x = +0.3 and −0.3: home `sacked`
    per dropback lower and `rushYds / rushAtt` higher at +0.3. Same for `{ DB: x }` on the away side: home
    `passYds / passAtt` lower at +0.3. And `{ QB: x, WR: x }` home: `passCmp / passAtt` higher at +0.3. Timeout
    180 s.
  - `it('plays the same game twice with chemistry on')`: `simulateGame(l, g)` twice from a JSON clone gives equal
    `homeScore`, `awayScore`, `home.totalYds` (Review Focus 5).
  - `it('reads the depth chart as it is now')`: fill the cache with `chemistryWeek(l)`, swap the first and sixth OL on
    the user's depth chart, and `chemistryOf(l, userTeamId, 'OL').years` reflects the new five (Review Focus 4: the
    time part is read fresh per call from the current starters; only the moods and the league's typical values are
    cached).
  - no edge without a game: `buildLineup(l, team)` knocks equal those of main's call shape (the existing parity test
    pattern, `parity.test.ts:85`).
- [ ] **Step 2:** run them → FAIL (`chemistry` option unknown, no edge).
- [ ] **Step 3:** in the knocks loop, when `mean !== undefined`, subtract `chem?.[room] ?? chemistryOf(league,
  team.id, room)?.edge ?? 0` with `room = unitOf(p.position)` (skip `ST`); `gameSim` passes `options.chemistry?.[side]`
  to both calls. Restructure `chemistryOf` if needed so the time part is computed fresh while the moods and typical
  values come from the weekly cache.
- [ ] **Step 4:** re-run → PASS. Run `npx vitest run src/engine/parity.test.ts src/engine/match` → PASS.
- [ ] **Step 5:** commit `Lineup: each room plays with its chemistry on game day`.

### Task 4: Sparks and Anchors rub off

**Files:**
- Modify: `src/engine/standing.ts` (`toneOf`, `friendPull`, `TONE`), `src/engine/morale.ts` (`MoraleContext`,
  `moraleContext`, `roomScore`)
- Test: `src/engine/standing.test.ts`, `src/engine/morale.test.ts`

**Interfaces:**
- Consumes: `soundOf`, `tierOf`, `weightOf`, `unitOf` (standing.ts); `moodPull`, `moraleMean`.
- Produces:
  ```ts
  // standing.ts
  export const TONE = { voices: 0.75, friends: 0.25, spark: 1, anchor: 0.5, plain: 0.5 };
  export interface VoiceRef { id: number; lean: number; sound: Sound | null }
  export function roomVoices(league: League, ctx: MoraleContext): Map<string, VoiceRef[]>; // key `${teamId}:${unit}`
  export function toneOf(p: Player, ctx: MoraleContext): number;      // −1..1, his room's voices but himself
  export function friendPull(league: League, p: Player, ctx: MoraleContext): number; // −1..1, friends on the club
  // morale.ts, MoraleContext gains
  leans: Map<number, number>;          // every rostered man's moodPull(level, moraleMean) as the step began
  voices: Map<string, VoiceRef[]>;
  ```
  `roomScore` adds `TONE.voices × toneOf(p, ctx) + TONE.friends × friendPull(league, p, ctx)` inside its ±1.5 clamp.
  `toneOf`: weighted mean of the room's voices' leans (Spark 1, Anchor 0.5, plain 0.5; Sparks halved when the room has
  an Anchor), excluding `p`; 0 with no other voice. The voices are built last in `moraleContext` (weights read the
  records and snaps built above). The old L1 build of this (`git show 8fb494b`) is a reference for shape, not a spec.

- [ ] **Step 1: Write the failing tests:**
  - `standing.test.ts` `it('a Spark's mood pulls his room, an Anchor's half as hard')`: a room with one Spark at lean
    +1 gives another man `toneOf` = +1; replace him with an Anchor and it's still +1 (one voice, weighted mean) but
    with a Spark at −1 alongside an Anchor at +1 it's (0.5·(−1) + 0.5·1)/(1) = 0, against −1/3 without halving
    (assert the Anchor-present value is greater).
  - `it('never pulls a man by himself')`: the only voice in a room gets `toneOf` 0.
  - `morale.test.ts` `it('a happy room's voices lift a man's target, a sour one's drag it')`: the same man's
    `moraleTarget(moraleFactors(league, p, ctx))` is higher with his room's voices' leans set to +1 than to −1 (through `ctx.leans`), and the gap is
    no larger than the gap from making him a captain and back (the pull is worth at most a captain's 0.75).
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement per Interfaces.
- [ ] **Step 4:** run `npx vitest run src/engine/standing.test.ts src/engine/morale.test.ts` → PASS; then the full
  engine suite in the background (`npx vitest run src/engine > /tmp/l3-suite.log 2>&1`) and re-pin only snapshots
  that move because moods moved (say which in the commit body).
- [ ] **Step 5:** commit `Morale: a voice's mood rubs off on his room (Sparks and Anchors), and friends' a little`.

### Task 5: the checks and calibration

**Files:**
- Modify: `scripts/morale.ts` (header list, a `chemistrySample()` at weeks 9 and 18, the checks), `CLAUDE.md`
  (architecture note for `chemistry.ts` and the pull; the `npm run morale` line)

- [ ] **Step 1: Add the checks** (spec §4.1), each through the script's `check(label, value, [lo, hi])`:
  - `Chemistry: league mean edge (worst room, worst week)` in [0, 0.02].
  - `Chemistry: Clicking share` in [0.1, 0.3]; `Chemistry: Out of sync share` in [0.1, 0.3] (of read rooms, both
    samples, all seasons).
  - `Sparks: sour room below a happy one`: mean room level where the setter is a Spark at Poor or worse, minus where
    he's Good or better: in [−6, −0.1].
  - `Anchors calm a room`: standard deviation of members' levels in rooms with an Anchor ÷ in rooms with only Sparks:
    in [0, 0.98].
- [ ] **Step 2: Run** `npm run morale` on the branch and on main (`git worktree add /tmp/main-wt origin/main`, link
  `node_modules`), and `npm run sim -- 10` on the branch. Calibrate `CHEM.roomSpan` (only) until the shares sit inside
  their bands on the default seed and two others (`--seed m2`, `--seed m3`). Any existing line that leaves its range:
  compare with main's on the same seeds and bring the numbers to the owner; never loosen a range without his call.
- [ ] **Step 3:** the CLAUDE.md notes. `npm run format`, `npm run typecheck`. Commit `Morale check: chemistry and the
  voices' pull (L3)`; push (no PR). Report the calibration numbers to the owner; anything near an edge waits on his
  call before Task 6.

---

## Part 2: the words and screens

### Task 6: the coach's words

**Files:**
- Modify: `src/engine/roomFacts.ts` (a `chemKey`, `lastTold` reading it, a `chemFact`), `src/engine/roomVoice.ts`
  (`CHEM_REASON`, `CHEM_NOTE`), `src/engine/lockerReport.ts` (rows when a room's word changed)
- Test: `src/engine/roomVoice.test.ts`, `src/engine/lockerReport.test.ts`

**Interfaces:**
- Consumes: `chemistryOf`, `Chemistry`, `ChemWord` (Task 2); `voiceName` (Task 1).
- Produces:
  ```ts
  export const chemKey = (clock: number, teamId: number, unit: ChemRoom, word: ChemWord) =>
    `chem:${clock}:${teamId}:${unit}:${word}`;
  export interface ChemFact { unit: string; word: ChemWord; years: number | null; newStarters: number;
    split: boolean; spark?: { last: string; sour: boolean }; anchor?: string }
  export function chemFact(league: League, c: Chemistry, ctx: MoraleContext): ChemFact;
  export const CHEM_REASON: readonly Line<ChemFact>[];  // the card's short reason, may be ''
  export const CHEM_NOTE: readonly Line<ChemFact>[];    // the coach's sentence
  ```
  `lastTold` also returns `chem: Map<ChemRoom, { word: ChemWord; clock: number }>`.

- [ ] **Step 1: Write the failing tests:**
  - every `ChemWord` × (years 0, 1.5, 3, null) × (split, spark sour, anchor, none) gives a `CHEM_NOTE` line with no
    digit and none of L1's banned words (reuse the BANNED regex from `meetings/voice.test.ts`), and a `CHEM_REASON`
    without digits ("three years together", "two new starters", "divided room", "Mitchell's sour",
    "Okafor's holding them together").
  - the spec's examples read exactly: Clicking with years 3 → "The line's clicking. Three years together shows.";
    Out of sync with a sour Spark Mitchell in the D-line → "Mitchell's sour, and he's a spark. The D-line's feeling
    it."; Still learning each other with two new starters in the secondary → "The secondary is still learning each
    other. Two new starters back there."
  - `lockerReport` files a chemistry row for a room once when its word changes and not again at the next check-in
    with the same word.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; the report row goes in "The room" section beside L1's unit rows, keyed by `chemKey` in
  `covered`.
- [ ] **Step 4:** run the touched tests → PASS; `npm run typecheck`.
- [ ] **Step 5:** commit `Locker report: the coach tells a room's chemistry when it changes`.

### Task 7: the Locker Room, screenshots and the PR

**Files:**
- Modify: `src/ui/screens/LockerRoom.tsx` (the card line under the mood; a tag beside each name under "Who they
  follow"), `src/styles.css` (the tag reuses `.tag-pill`; a `.room-chem` line), `package.json`, `src/ui/changelog.ts`,
  `docs/MVP.md` (the locker room line)
- Test: `src/ui/meetings.test.tsx` neighbour: new `src/ui/chemistry.test.tsx`; the screen contract in `ui.test.ts`

- [ ] **Step 1: Write the failing tests** (`renderToStaticMarkup` with `NavContext`, as `meetings.test.tsx`):
  - the user's Locker Room shows one of the four words on each read room's card, with its `CHEM_REASON` when non-empty;
  - a Spark under "Who they follow" carries a "Spark" tag, an Anchor an "Anchor" tag, a plain voice neither;
  - no digit in any chemistry line; nothing about another club's rooms.
- [ ] **Step 2:** run → FAIL.
- [ ] **Step 3:** implement; names through `PlayerLink`; your club only (the screen already is).
- [ ] **Step 4:** run `npx vitest run src/ui/chemistry.test.tsx src/ui/ui.test.ts` → PASS; `npm run typecheck`.
- [ ] **Step 5:** shoot the Locker Room and a locker report from the real build (desktop and phone), send them to the
  owner, adjust words on his notes. One patch bump in `package.json`, a changelog entry (rooms that click play a little
  better; a sour Spark drags his room; you see each room's chemistry), the MVP line. Commit `Locker Room: each room's
  chemistry, and Sparks and Anchors by name`; push.
- [ ] **Step 6:** run the final whole-branch review (fresh reviewer); fix what it finds. Open the one PR when the owner
  says go (template headings; the check section lists the checks run locally and the numbers near an edge). Read CI
  and fix what's red per CLAUDE.md.
