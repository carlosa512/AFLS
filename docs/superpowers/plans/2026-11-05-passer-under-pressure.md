# The Passer Under Pressure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat scramble, throwaway and escape rolls in `passPlay` with one choice (throw, throw it away,
take off) made after the read from the pressure, the situation and the passer, add intentional grounding, and fit it to
FTN charting and NGS data.

**Architecture:** A pure module `match/pocketChoice.ts` turns a dropback's facts into three odds (a softmax over two
utilities against throw's zero); `passPlay` draws one number against them after the read. A throwaway then draws inside
or outside the pocket and, maybe, a grounding flag, which `penalties.ts` enforces (loss of down, the spot, a safety). The
pocket field stages the new shapes; `npm run passer` judges the league against the NFL.

**Tech Stack:** TypeScript (engine, scripts via `tsx`), Vitest, Python 3 for the research script.

**Spec:** `docs/superpowers/specs/2026-11-05-passer-under-pressure-design.md`

## Global Constraints

- All randomness through the game's seeded streams (`this.rng`, `this.creditRng`, `this.habitRng`); no `Math.random`.
- The engine reads ratings only through `skill()`; traits through `poiseOf`.
- `pocketChoice.ts` draws nothing and reads no league; every term is zero for `TYPICAL` (ratings 12, poise 10, energy 85,
  1st and 10 between the 20s, his read at `OPEN`).
- Odds bounds: away in [0.002, 0.45], run in [0.002, 0.5]; throw takes the rest.
- Gunslinger: away utility down by `Math.log(3)`.
- NFL targets: pressured 15.5% sack / 5.6% scramble / 9.2% away; clean 2.7% scramble / 1.3% away; grounding 0.17 a game,
  92% under pressure, about 1.3 safeties a season; throwaways 60% from outside the pocket.
- `FIELD_VERSION` 10 → 11. Version `0.4.4` → `0.4.5`.
- Never loosen a check's range. Every check named in a task ends with nothing ✗.
- `npm run format` before each commit. Commits end with the session's attribution lines.

## Review Focus

- **A throwaway on 4th down that's flagged:** loss of down on 4th turns the ball over on downs at the enforced spot, not
  a 5th down. Test in Task 4.
- **Grounding with the ball inside the offense's own 10:** the spot is in the end zone, so it's a safety, scored for
  the defense, with the free kick. Test in Task 4.
- **A declined grounding flag** (the play was worse for the offense anyway): the incompletion stands with its down used,
  the flag shows as declined, nothing else moves. Test in Task 4.
- **Kneels and spikes** never reach the choice (a spike is legal grounding). Test in Task 4.
- **A rattled gunslinger in a clean pocket with an open read:** the odds stay in bounds and still sum to 1 when every
  habit and term pushes at once. Test in Task 2.

---

### Task 1: The NFL measurement

**Files:**
- Create: `scripts/research-passer.py`

**Interfaces:**
- Produces: printed tables that Task 6 copies into `PASSER_NFL` (`scripts/passer-core.ts`).

- [ ] **Step 1: Write `scripts/research-passer.py`** on the pattern of `scripts/research-sideline.py` (stdlib only, run
  with `python3 -I`). Download into `work/nflverse/` if missing: `ftn_charting_{2022,2023,2024}.csv` and
  `pbp_participation_{2022,2023,2024}.csv` from `https://github.com/nflverse/nflverse-data/releases/download/<tag>/`
  (tags `ftn_charting`, `pbp_participation`); the play-by-play is already cached as `play_by_play_{y}.csv.gz`. Join per
  play on (`game_id`, `play_id` without its decimal) = FTN's (`nflverse_game_id`, `nflverse_play_id`) = participation's
  (`nflverse_game_id`, `play_id`). Keep regular-season `qb_dropback == 1`, no `qb_spike`, no `two_point_attempt`, a
  non-empty `was_pressure`. Outcome: sack (`sack`), scramble (`qb_scramble`), away (FTN `is_throw_away`), else throw.
  Key each passer on `passer_player_id`, falling back to `rusher_player_id` on scrambles, so a man's scrambles and
  throws land on one key.
- [ ] **Step 2: Print**, for pressured and clean dropbacks separately, the sack, scramble and away shares with n for the
  buckets: all; 1st–2nd down; 3rd and 1–3, 4–9, 10+; 4th; red zone (`yardline_100` ≤ 20); backed up (≥ 90); last 5:00
  trailing by 1–16; last 5:00 leading. Then: the out-of-pocket share of throwaways (FTN `is_qb_out_of_pocket`), pressured
  and clean; grounding (`intentional grounding` in `desc`) a game, its pressured share, its share inside the pocket,
  safeties from it; and the spread between passers with 250+ dropbacks (median, 10th and 90th percentile and sd of their
  scramble and away shares of all dropbacks).
- [ ] **Step 3: Run it.** `python3 -I scripts/research-passer.py` — expected close to the spec's §1 (pressured 15.5 /
  5.6 / 9.2; clean 0 / 2.7 / 1.3; about 47 grounding flags a season). Paste the output into the commit message.
- [ ] **Step 4: Commit** `scripts/research-passer.py` ("Research: the passer's choices and grounding, FTN and NGS
  2022–24").

### Task 2: The choice (`match/pocketChoice.ts`)

**Files:**
- Create: `src/engine/match/pocketChoice.ts`
- Test: `src/engine/match/pocketChoice.test.ts`

**Interfaces:**
- Consumes: `QuirkId` (`../quirks`), `clamp` (`../rng`), `PassDepth` (`../types`).
- Produces:
  ```ts
  export type PocketKind = 'throw' | 'away' | 'run';
  export interface PocketPasser { decisions: number; scrambling: number; pocket: number; poise: number;
    energy: number; hurt: number; rattled: number; has(q: QuirkId): boolean }
  export interface PocketFacts { pressured: boolean; sep: number; depth: PassDepth; down: number; toGo: number;
    toGoal: number; trailingLate: boolean; passer: PocketPasser }
  export type PocketOdds = Record<PocketKind, number>;
  export const TYPICAL: { readonly decisions: 12; readonly scrambling: 12; readonly pocket: 12; readonly poise: 10;
    readonly energy: 85 };
  export const OPEN: number; // the separation at which a read counts as open (start 1.5; Task 7 fits it)
  export function pocketOdds(f: PocketFacts): PocketOdds;
  export function pocketCall(o: PocketOdds, u: number): PocketKind; // u < away → 'away'; u < away + run → 'run'
  export function outsideOdds(f: PocketFacts): number;  // chance a throwaway comes from outside the pocket
  export function groundingOdds(pressured: boolean, outside: boolean): number; // before the crew's scale
  ```

- [ ] **Step 1: Write the failing tests** in `pocketChoice.test.ts`, with a `typical(over)` builder like
  `sideline.test.ts`'s (pressured false, sep `OPEN`, depth 'short', 1st and 10 at the 50, `TYPICAL` passer, no habits):
  - `odds sum to 1 and stay in bounds`: for the typical facts and for a "wild" one (pressured, sep −6, 3rd and 15,
    scrambling 20, decisions 1, poise 1, rattled 1, energy 0, hurt 3, habits `bailsEarly`, `seesGhosts`) and a "meek" one
    (clean, sep 8, 4th and 1, scrambling 1, pocket 20, `gunslinger`, `muddyPockets`): `throw + away + run` within 1e-12 of
    1; away in [0.002, 0.45]; run in [0.002, 0.5].
  - `pressure raises both`: pressured away > clean away; pressured run > clean run.
  - `a covered read raises both`: sep `OPEN − 3` raises away and run over sep `OPEN`; sep `OPEN + 3` lowers them.
  - `the down leans its way`: 3rd and 7 lowers away and raises run against 1st; 4th lowers away below 3rd's.
  - `red zone raises away`; `backed up lowers a clean run`; `trailing late lowers run`.
  - `ratings lean their way`: scrambling 17 raises run; pocket 17 lowers a pressured run; decisions 17 raises a
    pressured away; poise 17 lowers a pressured away; energy 60 and hurt 2 each lower run.
  - `decisions sharpens the situation`: on 4th down, (away at decisions 4) − (away at decisions 18) > 0 — a sharp man
    throws it away on 4th less.
  - `each habit leans its way`: `gunslinger` cuts the away utility by `ln 3` (with everything else typical, pressured,
    away odds ratio against typical within 1% of 1/3 after renormalising: compare `away/throw` ratios); `bailsEarly`
    raises run, more on a clean deep read than a clean short one; `muddyPockets` lowers pressured away and run;
    `seesGhosts` with rattled 1 raises clean away and run, and with rattled 0 changes nothing.
  - `a typical spot adds nothing`: odds at 1st and 10 and at 2nd and 10, at toGoal 50 and 60, are equal (no term fires
    between the 20s on early downs), pressured and clean.
  - `one draw makes the call`: odds `{ throw: 0.7, away: 0.2, run: 0.1 }`: u 0.1 → 'away', 0.25 → 'run', 0.5 → 'throw'.
  - `outside`: `outsideOdds` in (0, 1); higher for scrambling 17, for `bailsEarly` and when pressured.
  - `grounding`: `groundingOdds(true, false) > groundingOdds(true, true) > groundingOdds(false, false)`, the last at most
    0.02.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/pocketChoice.test.ts` — expected FAIL (module missing).
- [ ] **Step 3: Implement `pocketChoice.ts`.** A module comment in `sideline.ts`'s style (what's chosen, the data, the
  spec path). Every constant named, with a comment citing its bucket. Starting values (Task 7 fits them):
  - Base utilities (log odds against throw), pressured: away −2.03, run −2.53; clean: away −4.30, run −3.57.
  - Covered: per point of `OPEN − sep` (only when positive) away +0.35, run +0.25; open: per point of `sep − OPEN`
    (positive) away −0.1, run −0.1.
  - Situation (each multiplied by the read sharpness `0.5 + decisions / 24`, so 12 reads at 1): 3rd down away −0.42,
    run +0.2 plus +0.03 per yard to go past 3 (to 15); 4th down away −1.15, run +0.35; red zone (toGoal ≤ 20) away
    +0.3 pressured / +0.58 clean; backed up (toGoal ≥ 90) run −0.34 when clean; trailing late run −0.2.
  - Makeup, per point from `TYPICAL`: scrambling run +0.12; pocket run −0.05 when pressured; decisions away +0.04 when
    pressured; poise away −0.04 when pressured; energy under 85 run −0.02 per point; hurt (to 3) run −0.15 each.
  - Habits: `gunslinger` away −ln 3; `bailsEarly` run +0.5, +0.6 more on a clean deep read; `muddyPockets` (pressured)
    away −0.3, run −0.3; `seesGhosts` × rattled: away +0.6 and run +0.4 per point of `rattled`.
  - Outside: logistic(0.4 + 0.08 × (scrambling − 12) + 0.5 × bailsEarly + 0.3 × pressured) (0.4 ≈ logit 0.6).
  - Grounding: inside & pressured 0.11, outside 0.04, clean 0.015 (×1 for pressured outside; clean inside or out 0.015).
- [ ] **Step 4: Run** the test file — expected PASS.
- [ ] **Step 5: Commit** ("Engine: the passer's choice under pressure and from a clean pocket, as odds").

### Task 3: Intentional grounding as a foul

**Files:**
- Modify: `src/engine/types.ts` (the `Foul` union), `src/engine/penalties.ts` (`FoulInfo`, `FOULS`, `enforce`)
- Test: `src/engine/penalties.test.ts` (create if absent)

**Interfaces:**
- Produces: `Foul` gains `'grounding'`. `FoulInfo` gains `lossOfDown?: boolean` and `stands?: boolean` (the play stays
  in the book: an incompletion and an attempt). `FOULS.grounding = { label: 'Intentional grounding', side: 'offense',
  yards: 10, lossOfDown: true, stands: true, tendency: null }` (rolled in `passPlay`, scaled
  there by the crew's flag volume, `this.calls.all``. `enforce(foul, at, spotYards)` for a
  `lossOfDown` foul: `spotYards` is how far behind the line he threw it; yards = `max(10, spotYards)`, the 10 capped at
  half the distance but a spot past it not capped; `down: at.down + 1` (5 means a turnover on downs); `yardLine ≤ 0`
  means a safety. Return type unchanged.

- [ ] **Step 1: Write the failing tests:** `enforce('grounding', {yardLine: 40, down: 2, lineToGain: 50}, 7)` →
  yardLine 30, down 3, lineToGain 50, yards 10; spot 14 behind → yardLine 26, yards 14; at the 12 with spot 7 → yards 6
  (half the distance), yardLine 6; at the 5 with spot 8 → yardLine −3 (a safety); down 4 → down 5. Other fouls'
  results unchanged (a `holding` and a `defHolding` case from today).
- [ ] **Step 2: Run** `npx vitest run src/engine/penalties.test.ts` — expected FAIL.
- [ ] **Step 3: Implement** the union member, the registry entry and the `enforce` branch. Check every `Record<Foul, …>`
  and `switch` on `Foul` the compiler flags (`npm run typecheck`), giving grounding its row: the crews' tendency table
  in `officials.ts` and any UI label maps.
- [ ] **Step 4: Run** the test and `npm run typecheck` — expected PASS.
- [ ] **Step 5: Commit** ("Penalties: intentional grounding (loss of down, the spot, a safety from the end zone)").

### Task 4: The engine makes the choice

**Files:**
- Modify: `src/engine/match/gameSim.ts` (`passPlay` about L3184–3285 and the throw after the read; `PlayResult`;
  `playFouls`; `callFouls`; the play's recording after `callFouls`; `SimOptions`)
- Test: `src/engine/match/passer.engine.test.ts` (create)

**Interfaces:**
- Consumes: Task 2's `pocketOdds`, `pocketCall`, `outsideOdds`, `groundingOdds`, `PocketFacts`, `OPEN`; Task 3's
  `'grounding'`.
- Produces:
  - `PlayResult.grounding?: { back: number }` — a throwaway the engine flagged; `back` yards behind the line it was
    thrown from (7 inside the pocket, 2 outside when short of the line).
  - `PlayResult.thrownAway?: 'inside' | 'outside'`.
  - `SimOptions.dropbackTap?: (t: DropbackTap) => void` with
    `export interface DropbackTap { qb: number; pressured: boolean; down: number; toGo: number; toGoal: number;
    trailingLate: boolean; call: PocketKind | 'sack'; outside?: boolean; grounded?: boolean }` (a sack taps
    `pressured: true`). Read by Task 6's scripts only; nothing stored.
  - `dropOutcome` values: 'away' (pressured, inside), 'awayClean' (clean, inside), 'awayOut' (outside), 'scramble',
    'escape', 'clean', 'pressure', 'sack' (Task 5 adds the two new ones to `PocketOutcome`; until then this task may
    map them to 'away' behind a `// Task 5` line that Task 5 removes).

- [ ] **Step 1: Write the failing tests** (`passer.engine.test.ts`), each over many seeded games of one league
  (`createLeague({ seed: 'passer-t' })`, `simulateGame(league, g, { keepPlays: true, dropbackTap })`):
  - `every dropback taps once`: taps equal the play log's dropbacks (passes, incompletions, picks, sacks, scrambles that
    weren't designed runs).
  - `the choice comes after the read`: a clean-pocket throwaway exists (some tap with `pressured: false`,
    `call: 'away'`), and so does a clean 'run' — neither exists today.
  - `a gunslinger still throws it away now and then` (give every QB the habit in a copy of the league: some 'away').
  - `grounding stands as an incompletion`: in a game where a tap has `grounded: true` and the log shows the flag
    accepted, the passer's line counts the attempt, the next down is one more than the grounding's (the down is lost,
    not replayed), and the yard line moved back by `max(10, back)` (half the distance inside the 20).
  - `4th-down grounding turns it over on downs` and `grounding from inside the 10 is a safety` — build the situation by
    replaying with `SimOptions` that start a drive there if the engine has such a hook; otherwise scan enough seeded
    games for a 4th-down and a backed-up grounding (raise the seed count until each is found, at most 2,000 games) and
    assert possession and score changed accordingly.
  - `a declined grounding leaves the incompletion`: the log text has "Intentional grounding … declined" and the next
    play's down is the incompletion's next down.
  - `kneels and spikes never tap`.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/passer.engine.test.ts` — expected FAIL.
- [ ] **Step 3: Rewire `passPlay`.** Keep the pressure and sack rolls as they are (a sack taps `call: 'sack'`). Delete
  the pressured scramble roll, the 12% throwaway, the clean escape roll and the deep `bailsEarly` roll; move the depth
  call, target and `sep` ahead of the choice unchanged. Then build `PocketFacts` (`decisions` as computed in passPlay,
  `skill(qb, 'scrambling')`, `skill(qb, 'pocketPresence')` plus 1.5 for `muddyPockets` as today, `poiseOf(qb)`,
  `this.body(qb).energy`, injuries this season and last capped at 3 as in `sideline()`, `this.rattled.get(qb.id) ?? 0`,
  `trailingLate` = 4th quarter, clock ≤ 300, behind by 1–16), draw `pocketCall(pocketOdds(f), rng.next())`, and:
  - 'run' → `dropOutcome` 'scramble' if pressured else 'escape'; return `this.scramble(def, s)`.
  - 'away' → `outside = rng.chance(outsideOdds(f))`; `grounded = rng.chance(groundingOdds(pressured, outside) *
    this.calls.all)`; `dropOutcome` 'awayOut' if outside, else 'away' if pressured, else 'awayClean'; return today's
    throwaway result with text "under pressure, throws it away" / "rolls out and throws it away" / "throws it away", the
    passAtt, `thrownAway`, and `grounding: { back: outside ? 2 : 7 }` when grounded.
  - 'throw' → today's throw; the gunslinger's −0.1 applies when he threw under pressure, as now.
- [ ] **Step 4: Flag and enforce.** `playFouls` pushes `{ foul: 'grounding', by: qb }` when `result.grounding`, with
  `spotYards: result.grounding.back`. In `callFouls`, an accepted `stands` foul doesn't wipe the play: the stats stand
  (the attempt, the incompletion), the ball goes to the enforced spot with its down; then the recording handles
  `down > 4` as a turnover on downs at that spot and `yardLine ≤ 0` as `this.safety()`, with the log text "Intentional
  grounding on <QB>, <n> yards, loss of down" (", safety" from the end zone). A declined grounding is noted like any
  declined flag.
- [ ] **Step 5: Run** the new tests, `npx vitest run src/engine` and `npm run typecheck` — expected PASS except fixtures
  that pinned a particular game's plays (moving the choice reshuffles the draws): re-take those pins (snapshots with
  `-u`, hashes and counts re-read) and note each in the commit message; never loosen a range.
- [ ] **Step 6: Commit** ("Engine: the passer chooses after his read; intentional grounding is called").

### Task 5: The pocket stages the new shapes

**Files:**
- Modify: `src/engine/field/pocketField.ts` (`PocketOutcome`, the throwaway's movement), `src/engine/field/pocketMoment.ts`
  (timing, text), `src/engine/field/moment.ts` (`FieldFacts.gr`), `src/engine/field/tuning.ts` (`FIELD_VERSION` 11),
  `src/engine/match/gameSim.ts` (remove Task 4's mapping)
- Test: `src/engine/field/pocketMoment.test.ts`, `src/engine/field/pocketEngine.test.ts`

**Interfaces:**
- Produces: `PocketOutcome` gains `'awayClean' | 'awayOut'`; `FieldFacts.gr?: 1` (grounded).

- [ ] **Step 1: Write the failing tests:** staging each of 'away', 'awayClean', 'awayOut' from the existing castable
  helper: 'awayClean' — no rusher reaches the passer before the throw and the throw comes later than a clean throw's
  (`throwAt` + `AFTER.away` later than 'clean's); 'awayOut' — the passer's last frame before the throw is outside the
  tackle box (|y| beyond the tackles' and past their x), and the ball comes out after he gets there; a grounded
  throwaway's ball lands at least 5 yards from every receiver; the film's text says "throws it away" / "rolls out and
  throws it away".
- [ ] **Step 2: Run** `npx vitest run src/engine/field` — expected FAIL.
- [ ] **Step 3: Implement.** 'awayClean' moves like 'clean' with the rush held off (`quietUntil` the throw), the throw
  `AFTER.away` late; 'awayOut' moves like 'escape' until outside, then throws (like 'away' from there); `gr` picks a
  landing spot in open grass away from receivers. Bump `FIELD_VERSION` to 11 (games saved on 10 keep their film).
  Remove Task 4's mapping so `dropOutcome` passes through.
- [ ] **Step 4: Run** `npx vitest run src/engine` — expected PASS; `npm run parity` and `npm run film`-equivalent
  (`npm run check -- parity film`) — expected nothing ✗.
- [ ] **Step 5: Commit** ("Field: a clean throwaway, one from outside the pocket, and a grounded ball").

### Task 6: `npm run passer`

**Files:**
- Create: `scripts/passer-core.ts`, `scripts/passer.ts`
- Modify: `package.json` (`"passer": "tsx scripts/passer.ts"`), `scripts/calibrate.ts` (tally and judge the lines)

**Interfaces:**
- Consumes: `printLine`, `Line` from `scripts/sideline-core.ts`; Task 4's `DropbackTap`.
- Produces: `PASSER_NFL` (Task 1's output), `newPasserTally()`, `tapDropback(t, tap)`, `judgePasser(t): Line[]`,
  `passerSpread(t): Line[]`, `groundingLines(t, games): Line[]`.

- [ ] **Step 1: Write `passer-core.ts`.** Buckets as Task 1's, pressured and clean, each a [sack, scramble, away] share
  against `PASSER_NFL`; judged only when the tolerance is at least 3.5 standard errors at the tally's n (the
  `sideline-core.ts` rule); the spread lines (sd of scramble and away shares over passers with 250+ dropbacks, against
  Task 1's sd); the outside share of throwaways; grounding a game, its pressured share, safeties a season (per 272 games).
- [ ] **Step 2: Write `passer.ts`** like `scripts/sideline.ts` (leagues `passer-k`, AI games, `dropbackTap`, default
  200 games, exit 1 on any ✗) and wire `calibrate.ts`'s `sampleDepth` to tally the same taps and print the lines with
  the sideline lines.
- [ ] **Step 3: Run** `npm run passer -- 3000`. Expected now: lines print; ✗ allowed until Task 7.
- [ ] **Step 4: Commit** ("Checks: npm run passer, the passer's choices against FTN and NGS").

### Task 7: Fit and hold the league

**Files:**
- Modify: `src/engine/match/pocketChoice.ts` (constants only), `src/engine/quirks.ts` (wording)

- [ ] **Step 1: Fit** the constants until `npm run passer -- 3000` shows nothing ✗: base utilities first (the "all"
  rows), then `OPEN` and the covered slope (the clean rows), then the situation terms, then scrambling's slope against
  the spread line, then grounding (0.17 a game). Re-run Task 2's tests after each change.
- [ ] **Step 2: Hold the league:** `npm run sim -- 30` (completion rate, interceptions, sacks, QB rushing, passer
  rating, leaders), `npm run endings`, `npm run quirks -- --effects` (Gunslinger fewer throwaways and more picks; Bails
  Early more scrambles), `npm run audit` (decision-making, scrambling, pocket presence still move play; it rewrites
  `docs/ATTRIBUTES.md`), `npm run crews`, `npm run sideline -- 3000`. Nothing ✗, nothing under "Needs attention".
  Retune `pocketChoice.ts` (not the checks) where one is out.
- [ ] **Step 3: Reword** Gunslinger's effect in `quirks.ts`: "Rarely throws it away: under pressure he forces it into
  coverage, so fewer completions and more interceptions." Reword Bails Early or Sees Ghosts only if their effect line
  is now wrong.
- [ ] **Step 4: Commit** ("Passer: fitted to FTN and NGS 2022–24") with the passer and sim summaries in the message.

### Task 8: Docs and version

**Files:**
- Modify: `docs/MVP.md`, `docs/PENALTIES.md`, `CLAUDE.md`, `src/ui/changelog.ts`, `package.json`, the spec's status line

- [ ] **Step 1:** `docs/MVP.md`: tick "High: the passer under pressure" with what it does and the fitted numbers
  (0.4.5). `docs/PENALTIES.md`: the grounding row built (not Phase 4). `CLAUDE.md`: `npm run passer [-- games]` beside
  `npm run sideline`, and `match/pocketChoice.ts` beside `match/sideline.ts`. A 0.4.5 changelog entry. `package.json`
  0.4.5. The spec's status: built (0.4.5).
- [ ] **Step 2: Run** `npm run typecheck`, `npx vitest run src/ui/ui.test.ts`, `npm run format:check` — expected PASS.
- [ ] **Step 3: Commit** ("0.4.5: the passer under pressure") and push; open the PR when the owner asks.
