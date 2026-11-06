# Fumbles on Contact Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A contact fumble's chance reads the tackler, the situation (fighting for yards, a defense going for the ball),
fatigue and the carrier, on runs, catches and now scrambles. A fumble is forced or not, and its reason shows in the text
and on film, fitted to nflverse 2021–25.

**Architecture:** A pure module, `match/fumbleOdds.ts`, gives the odds from named factors, the forced share by kind, and
the reason. `gameSim.ts` draws against them at each tackle in bounds and writes the reason into the play text.
`field/fumble.ts` reads it back, so the stager draws each shape. `npm run fumbles` and `npm run sim` judge the league
against the NFL.

**Tech Stack:** TypeScript, Vitest, Python 3 (pandas) for the research script.

**Spec:** `docs/superpowers/specs/2026-11-05-fumbles-on-contact-design.md`

## Global Constraints

- Seeded streams only. The engine reads ratings through `skill()` and size through `sizeEdge()`.
- `fumbleOdds.ts` draws nothing; every factor is zero at `TYPICAL` (ratings 12, energy 85, 1st and 10, no habits,
  size edge 0).
- Odds are clamped to [0.001, 0.08]. Forced share: run 0.50, catch 0.95, scramble 0.95.
- No fumble out of bounds. A scramble that slides takes no roll. Yards stay today's roll. Recovery stays today's 52%.
- Play text keeps the substrings `FUMBLE, recovered by` and `Fumble, recovered by the offense` unchanged (`fumbleIn`,
  highlights and the viewer read them). The reason goes before them.
- NFL targets (all fumbles per 100, in bounds, no TD): run 1.46, catch 1.31, scramble 1.75; lost: run 0.65, catch 0.67.
- Version `0.4.5` → `0.4.6`. Never loosen a check's range. `npm run format` before each commit. Commits end with the
  session's attribution lines.

## Review Focus

- **A fumble on 4th down, recovered by the offense:** the down and the chains move as for any 4th-down play (no first
  down from a recovery behind the sticks). Test in Task 3.
- **An unforced fumble ('own'):** credits no `forcedFum`, but the tackler still has his tackle. Test in Task 3.
- **A scramble's lost fumble in the opponent's end zone side or near the goal:** the turnover spot is the scramble's
  end, as a run's. Test in Task 3 (spot equals `yardLine + yards`).
- **An old save's fumble text** (no reason words): the film draws it as today's ('hit'). Test in Task 4.
- **The rattled carrier at 0 energy with every habit:** the odds stay ≤ 0.08. Test in Task 2.

---

### Task 1: The NFL measurement

**Files:**
- Create: `scripts/research-fumbles.py`

**Interfaces:**
- Produces: printed tables that Task 5 copies into `FUMBLES_NFL` (`scripts/fumbles-core.ts`).

- [ ] **Step 1: Write the script** on the pattern of `scripts/research-passer.py` (pandas, `python3 -I`, cache
  `work/nflverse`). Seasons 2021–25, regular season. Touches:
  - runs (`play_type == 'run'`, no scramble or kneel), completions, scrambles;
  - no two-point tries;
  - ending in bounds (`out_of_bounds != 1`) with no touchdown.

  A fumble is `fumble == 1` with `fumbled_1_player_id` the carrier (rusher or receiver).
- [ ] **Step 2: Print**, for each kind:
  - fumbles and lost per 100, with n, for the pre-snap buckets: all; 1st–2nd; 3rd and 1–3, 4–9, 10+; 4th; last 5:00
    (`game_seconds_remaining <= 300`) offense trailing; last 5:00 offense leading;
  - the forced share (`fumble_forced` among fumbles);
  - for runs and catches, the spread between carriers with 150+ touches: median, p90, sd, and the binomial sd at their
    n.
- [ ] **Step 3: Run** `python3 -I scripts/research-fumbles.py`. Expected: close to the spec's §1 (run 1.46, catch 1.31,
  scramble 1.75; forced 0.50 / 0.95). Paste the output into the commit message.
- [ ] **Step 4: Commit** ("Research: contact fumbles by situation, forced share and the spread between carriers,
  nflverse 2021–25").

### Task 2: The odds (`match/fumbleOdds.ts`)

**Files:**
- Create: `src/engine/match/fumbleOdds.ts`, `src/engine/match/fumbleOdds.test.ts`

**Interfaces:**
- Produces, as the spec's §2:
  - `ContactKind`, `FumbleWhy`, `ContactFacts`;
  - `TYPICAL` (`{ ballSecurity: 12, tackling: 12, energy: 85 }`);
  - `fumbleOdds(f): number`;
  - `forcedOdds(kind): number`;
  - `fumbleWhy(f, u): 'strip' | 'hit' | 'fight'`.

- [ ] **Step 1: Write the failing tests** in `fumbleOdds.test.ts`, with a `typical(over)` builder (kind 'run', 1st and
  10, not late, weather 1, `TYPICAL` men, no habits, size 0):
  - `a typical tackle sits on its base`: `fumbleOdds(typical())` equals the run base. 2nd down equals 1st down.
  - `odds stay in bounds`: every kind typical, a "wild" one (4th and 10, trailing late, ballSecurity 1, energy 0,
    weather 1.5, carrier `looseCarriage`+`highKnee`+`gassed`+`finishesForward`, tackler `ballStripper`+`thumper`,
    tackling 20, size 2), and a "meek" one (leading late, ballSecurity 20, `contactAverse`, tackler `armTackler`,
    tackling 1, size −2). All in [0.001, 0.08].
  - `each factor leans its way`, against typical:
    - raise it: ballSecurity 6; energy 60 (and more with `gassed`); tackling 17; size 1.5; `looseCarriage`;
      `highKnee` (run); `ballStripper`; `thumper`; 3rd and 7; 4th and 2; trailing late; `finishesForward`;
      weather 1.3;
    - lower it: `contactAverse` (run); `armTackler`; leading late (run).
  - `forced shares`: `forcedOdds('run')` 0.5; `'catch'` and `'scramble'` 0.95.
  - `the reason follows the leans`: over u in steps of 0.01, count the reasons:
    - a typical tackle gives all three;
    - with `ballStripper` and the defense going for the ball, 'strip' is the most common;
    - on 4th and 7 with `finishesForward`, 'fight' is;
    - with `thumper` and size 2, 'hit' is.
- [ ] **Step 2: Run** `npx vitest run src/engine/match/fumbleOdds.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement.** Odds = `BASE[kind] × exp(Σ terms) × weather`, clamped. Starting values (Task 6 fits
  them), each a named constant whose comment cites its bucket:
  - **Base:** run 0.0134, catch 0.0135, scramble 0.0151.
  - **Ball security:** −0.13 per point (run, scramble), −0.12 (catch).
  - **Carrier habits:** `looseCarriage` ln 1.6; `highKnee` ln 1.3 (run); `contactAverse` ln 0.7 (run).
  - **Fatigue:** +0.01 per energy point under 85, ×2 with `gassed`.
  - **Tackler:** tackling +0.03 per point; size +0.05 per point; `ballStripper` ln 1.5; `thumper` ln 1.3;
    `armTackler` ln 0.8.
  - **Fight:**
    - 3rd and 1–3: run +0.24, catch −0.59;
    - 3rd and 4+: run +0.78, catch +0.1;
    - 4th: run +1.0, catch −0.57;
    - trailing late: run +0.48, catch +0.25;
    - `finishesForward` +0.2.
  - **Cover / strip:** leading late, run −0.15.

  `fumbleWhy`: weights start at strip 0.4, hit 0.4, fight 0.2, and each positive term adds to its reason's weight:
  - strip: `ballStripper`, the defense going for it;
  - hit: `thumper`, tackling, size;
  - fight: the down and distance terms, trailing late, `finishesForward`.

  `u` picks by the cumulative weight.
- [ ] **Step 4: Run** the test file and `npm run typecheck`. Expected: PASS.
- [ ] **Step 5: Commit** ("Engine: fumble odds from the hit, the fight for yards, the strip and fatigue").

### Task 3: The engine rolls it

**Files:**
- Modify: `src/engine/match/gameSim.ts`:
  - the run's fumble (about L3170–3197) and the catch's (about L3698–3726);
  - `scramble()` (after its tackle, before its return);
  - remove `fumbleOdds` (about L3908), `RUN_FUMBLE`, `CATCH_FUMBLE`, `LOOSE_CARRIAGE`;
  - add `SimOptions.contactTap`.
- Test: `src/engine/match/fumble.engine.test.ts` (create)

**Interfaces:**
- Consumes: Task 2's module.
- Produces:
  ```ts
  export interface ContactTap { kind: ContactKind; down: number; toGo: number; trailingLate: boolean;
    leadingLate: boolean; carrier: number; fumbled: boolean; forced?: boolean; why?: FumbleWhy;
    facts: ContactFacts }
  ```
  `SimOptions.contactTap?: (t: ContactTap) => void`, one call per tackle in bounds (runs and catches with a tackler
  and call 'in'; scrambles with a tackler, in bounds, not sliding, no TD).

- [ ] **Step 1: Write the failing tests** (40 seeded games of `createLeague({ seed: 'fumble-t' })`, collecting taps and
  logs):
  - `every tackle in bounds taps once`: the taps count the log's tackled in-bounds runs, catches and scrambles (no
    TD, no out of bounds, no slide).
  - `a fumble's text names its reason`: each fumbled tap's log text contains `stripped by`, `jarred loose by the hit`,
    `fighting for the extra yard` or `puts it on the ground`, matching `why`, before `FUMBLE, recovered by` or
    `Fumble, recovered by the offense`.
  - `forced fumbles only credit the tackler`: summed over the games, `forcedFum` equals the taps with `forced` true.
  - `a scramble can fumble`: with `fumbleOdds` mocked to 1 in a separate file (`fumble.forced.test.ts`, the pattern of
    `passer.grounding.test.ts`), a scramble's lost fumble is a turnover at `yardLine + yards`, and a 4th-down fumble
    recovered by the offense short of the sticks turns the ball over on downs.
  - `nothing fumbles out of bounds`: no log entry with `out of bounds` and a fumble.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3: Wire it.**
  - Build `ContactFacts`:
    - `skill(carrier, 'ballSecurity')`, `skill(tackler, 'tackling')`;
    - `sizeEdge(tackler, 'contact', carrier)`;
    - `this.body(carrier).energy`, `this.wx.fumble`;
    - late = 4th quarter, clock ≤ 300 (trailing: `scoreDiff < 0`; leading: `> 0`).
  - Draw `rng.chance(fumbleOdds(facts))`; then `rng.chance(forcedOdds(kind))`; then `fumbleWhy(facts, rng.next())`
    when forced, otherwise 'own'.
  - Credit `forcedFum` only when forced.
  - Text: insert `, stripped by X` / `, jarred loose by the hit` / `, fighting for the extra yard, the ball comes out`
    / `, puts it on the ground` before `. FUMBLE, recovered by …` or `. Fumble, recovered by the offense`.
  - A scramble's lost fumble returns a turnover like a run's (`returnYds` as the run's draw).
- [ ] **Step 4: Run** the new tests, `npx vitest run src/engine` (to a log file) and `npm run typecheck`. Expected: the
  new tests pass. Fixtures pinned to one game's plays (snapshots, the personnel hash) are re-taken and named in the
  commit message, never loosened.
- [ ] **Step 5: Commit** ("Engine: fumbles read the hit, the fight and the strip; scrambles fumble; forced or not").

### Task 4: The film shows why

**Files:**
- Modify: `src/engine/field/fumble.ts` (`Fumble` gains `why: FumbleWhy`), `src/engine/field/scripts.ts` (the hitter's
  approach at about L1117–1124)
- Test: `src/ui/stage/fumble.test.ts`

**Interfaces:**
- Consumes: `FumbleWhy` (Task 2); the text from Task 3.
- Produces: `fumbleIn(e).why`. It reads 'strip', 'hit', 'fight' or 'own' from the text, and 'hit' for a text with no
  reason (an old save, a strip-sack).

- [ ] **Step 1: Write the failing tests:**
  - `reads a fumble's reason off the play`: each of the four texts gives its `why`; the old texts already in the file
    give 'hit'.
  - `draws each reason`, staging the four variants of one lost fumble (the existing test's play with each reason
    inserted):
    - 'strip': at the moment the ball comes out, the hitter is within 1.2 yd of the ball and behind the carrier's
      line of run (dot product ≤ 0);
    - 'hit': within 1.2 yd and in front of it (> 0);
    - 'fight': a second defender also within 2.5 yd;
    - 'own': no defender within 1 yd.
- [ ] **Step 2: Run** `npx vitest run src/ui/stage/fumble.test.ts`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `fumbleIn` reads the reason.
  - `scripts.ts` places the hitter at the hit point:
    - 'strip': from behind (`toward(hit, a point 1.5 yd behind along the carrier's last segment, 0.6)`);
    - 'hit': head-on (the same, ahead);
    - 'fight': head-on plus the nearest other defender keyed to 1.5 yd of the hit at `tHit`;
    - 'own': the hitter keyed to arrive 0.4 s after `tHit`.
  - Drawn film only. If no `src/engine/field/` frame-producing code (`run.ts`, `pocketField.ts`) changes,
    `FIELD_VERSION` stays. A spatial replay re-runs those, and the stager's drawn shapes aren't versioned.
- [ ] **Step 4: Run** the stage and field tests (`npx vitest run src/ui/stage src/engine/field`). Expected: PASS.
- [ ] **Step 5: Commit** ("Film: a fumble shows its reason: stripped, the hit, fighting forward, his own").

### Task 5: `npm run fumbles`

**Files:**
- Create: `scripts/fumbles-core.ts`, `scripts/fumbles.ts`
- Modify: `package.json` (`"fumbles": "tsx scripts/fumbles.ts"`), `scripts/calibrate.ts`, `scripts/check.ts` (the
  planner: `match/fumbleOdds.ts` and `scripts/fumbles*.ts` → `sim`)

**Interfaces:**
- Consumes: `printLine`, `Line` (`sideline-core.ts`); `ContactTap` (Task 3).
- Produces:
  - `FUMBLES_NFL` (Task 1's tables);
  - `newFumbleTally()`, `tapContact(t, tap, who: string)`;
  - `judgeFumbles(t): Line[]`, `carrierSpread(t): Line[]`.

- [ ] **Step 1: Write `fumbles-core.ts`:**
  - Buckets by kind as Task 1, each judged when its tolerance is at least 3.5 standard errors (tolerance: the 'all' row
    ±12%, others ±25%, at least 0.3 per 100), otherwise reported.
  - The forced share by kind ±0.08.
  - Lost per 100 by kind ±25%.
  - The carrier spread: the sd of runs' fumble rates over carriers with 150+ touches, against the NFL's ±30%.
- [ ] **Step 2: Write `fumbles.ts`,** like `scripts/passer.ts` (leagues `fumbles-k`, default 200 games, exit 1 on any
  ✗). Wire `calibrate.ts` to tally its replayed weeks and print the buckets. The spread stays `npm run fumbles`'s, as
  the passer spread does.
- [ ] **Step 3: Run** `npm run fumbles -- 3000`. Expected: lines print; ✗ allowed until Task 6.
- [ ] **Step 4: Commit** ("Checks: npm run fumbles, contact fumbles against nflverse 2021–25").

### Task 6: Fit and hold the league

**Files:**
- Modify: `src/engine/match/fumbleOdds.ts` (constants), `src/engine/quirks.ts` (effect lines)

- [ ] **Step 1: Fit offline.** Add `facts` to the tap if it isn't there. Record 1,000 AI games' taps. Fit the
  constants in a scratch script (coordinate descent on the bucket rates and the spread, the signs fixed as Task 2's
  tests). Then confirm with `npm run fumbles -- 3000`. Expected: 0 lines out.
- [ ] **Step 2: Hold the league:**
  - `npm run sim -- 30`: `fumblesLost` and turnovers in range, the leaders;
  - `npm run quirks -- --effects`: Loose Carriage, High Knee, Contact Averse, Ball Stripper, Thumper, Arm Tackler,
    Finishes Forward, Gassed each move fumbles the right way;
  - `npm run audit`: ball security and tackling still move play; commit `docs/ATTRIBUTES.md`;
  - `npm run endings`, `npm run parity`, `npm run film`.

  Nothing ✗. Retune `fumbleOdds.ts`, never a check. If the sim's totals and the per-touch buckets disagree, the totals
  win: rule it and ledger it.
- [ ] **Step 3: Reword** the effect lines in `quirks.ts` for Thumper, Arm Tackler, Finishes Forward and Gassed, which
  now also move fumbles (e.g. Thumper: "… and his hits jar the ball loose more often").
- [ ] **Step 4: Commit** ("Fumbles: fitted to nflverse 2021–25") with the fumbles and sim summaries.

### Task 7: Docs and version

**Files:**
- Modify: `docs/MVP.md`, `CLAUDE.md`, `src/ui/changelog.ts`, `package.json`, the spec's status line

- [ ] **Step 1: Update the docs:**
  - `docs/MVP.md`: tick "High: fumbles on contact" with what it does and the fitted numbers (0.4.6);
  - `CLAUDE.md`: `npm run fumbles [-- games]` beside `npm run passer`, and `match/fumbleOdds.ts` beside
    `match/pocketChoice.ts`;
  - a 0.4.6 changelog entry;
  - `package.json` 0.4.6;
  - the spec's status: built (0.4.6).
- [ ] **Step 2: Run** `npm run typecheck`, `npx vitest run src/ui/ui.test.ts` and `npm run format:check`. Expected:
  PASS.
- [ ] **Step 3: Commit** ("0.4.6: fumbles on contact"), push, open the PR.
