# A play's time, the half's last possession, the two-point try and returns

**Status:** designed (0.4.11). Follows 0.4.10. MVP follow-ups: "Medium-High: a play's time" (with the owner's note of
Nov 7: the first-half kneel ignores timeouts), "Medium: the two-point try" and "Low: return touchdowns as small
edge-scaled rates" (the breakups half done in 0.4.8).

## Why

Four things still come from flat rolls that ignore what happened or who's in it:

- **A play's time:** a run takes 4–7 seconds, a pass 5–8 (a screen and a bomb alike, caught or not), a throwaway 4–6, a
  punt 6–9, a kickoff 5–8. The NFL's incompletions take 4.7 seconds, about two fewer than ours, so two-minute drills lose
  a snap; its long plays take longer than ours and its returned punts nearly 11 seconds. Your games' runs and catches
  are timed by the field; everything else, and every AI game, keeps the flat draw.
- **The half's last possession:** `shouldKneel` kneels in the 2nd quarter with 30 seconds or less inside the 30 (a
  leader inside the 50), whatever the timeouts. The NFL kneels on 9% of drives that start with 21–40 seconds left; we
  kneel on nearly all of them inside the 30. The hurry-up starts only from the 25, and timeouts only from midfield, so
  a team that does try from deep doesn't play a two-minute drill.
- **The two-point try:** one roll on the quarterback's short accuracy (about 47%): no run or pass, nobody credited, no
  film. When to go for it is a fixed fourth-quarter chart that never goes for two at −8 or −9 and never before the 4th.
- **Returns:** a kickoff's or punt's return is a bell curve (sd 6) and the touchdown a separate coin (0.4% and 0.6%,
  nudged by the returner). The averages are right; the tail isn't: 1% of our kickoff returns go 40 yards against the
  NFL's 4%, and no punt return has a tail at all (the NFL's go 20+ one time in twelve). A long return and a touchdown
  never meet.

The owner's calls: three small modules beside `dropbackEnd.ts` (approach 1); the half's call is the NFL's rate leaned
by the head coach (flavor: the NFL shows no spread between coaches beyond luck); the two-point try becomes a real snap
and its call is refit to today's NFL; returns are drawn whole from the NFL's shape, a touchdown being the return that
reaches the end zone; the time between snaps (tempo) is already situational and stays.

## 1. The NFL (nflverse 2021–25 regular seasons; `scripts/research-situations.py`)

**A play's time**, measured on plays after which the clock stopped (an incompletion; out of bounds in the late
windows; a touchdown; a change of possession), so the time to the next snap is the play's own:

| Play | Seconds (n) |
| --- | --- |
| Incomplete, behind the line / 0–9 / 10–19 / 20+ air yards | 3.97 (4,726) / 4.36 (11,834) / 4.97 (8,106) / 5.72 (6,202); all 4.73, p10 3, p90 7 |
| Catch, by yards (touchdowns): <5 / 5–9 / 10–19 / 20–39 / 40+ | 4.15 / 4.65 / 5.32 / 6.29 / 9.27 |
| Catch out of bounds late, by yards: <5 / 5–9 / 10–19 / 20–39 / 40+ | 5.21 / 4.96 / 5.50 / 6.29 / 8.10 |
| Run, by yards (touchdowns): <5 / 5–9 / 10–19 / 20–39 / 40+ | 3.74 / 5.00 / 5.88 / 7.20 / 9.61 |
| Run out of bounds late, by yards: <5 / 5–9 / 10–19 / 20–39 | 5.61 / 6.43 / 6.41 / 7.95 |
| Punt returned / fair caught | 10.91 (3,388) / 6.94 (2,847) |
| Kickoff returned (the clock starts on the catch) | 5.74 (5,218) |

Sacks and scrambles can't be timed this way (the clock runs after them; a timeout's logged clock is unreliable), so
their time is not measured.

**The half's last possession** (1,552 drives whose first snap comes with 75 seconds or less in the 2nd quarter): kneel
on the first snap 28% overall; by the clock 64.6% at 20 or less, 9.2% at 21–40, 1.0% at 41–60, none past; by
timeouts, at 21–40 seconds, 17% with none, 16% with one, 13% with two, 4% with three (at 20 or less 82%, 79%, 70%,
72%); by the spot 35% from the own 1–25, 33% from the 26–35, 8% from the 36–50, none past midfield; by the score no
difference (trailing 34.3%, tied 33.7%, leading 34.0%). Drives that try from the own 35 or deeper end: the half 42.5%,
a punt 17.3%, a field goal 16.4%, a turnover 8.8%, a missed field goal 6.4%, a touchdown 4.8%. Team-seasons don't
differ beyond luck (sd 0.114 against 0.129).

**The two-point try** (6,779 tries after a touchdown): two 9.8% (by season 9.1–10.9%); 4.6% in quarters 1–3, 22.3% in
the 4th and overtime. In the 4th by the score after the touchdown: always at −10, −5, −2, +1, +5; 37% at −8, 41% at
−9, 16% at −1; 0–12% elsewhere. Quarters 1–3: 42% at −5, 35% at +5, 17% at +12, 7% at −8, 0–6% elsewhere. Success
47.5% (663): runs 56.4% (188), passes 44.0% (475); runs 28% of tries. A defensive two-point return 26 times (3.9% of
tries). Team-seasons differ a little past luck in quarters 1–3 (sd 0.053 against 0.040; the most 32%).

**Returns:** kickoffs on the 2025 rules (touchback to the 35, the game's), 2,076 returned: 25.95 yards, sd 8.63;
p10 18, p25 22, p50 25, p75 29, p90 33, p95 38, p99 56; 20+ 86.3%, 30+ 21.6%, 40+ 4.19%, 50+ 1.69%, 60+ 0.92%;
touchdowns 0.29% (0.43% over 2024–25, 13). Punts 2021–25, 4,504 returned: 9.45 yards, sd 10.23; p10 0, p25 3, p50 8,
p75 13, p90 18, p95 23, p99 53; 20+ 8.2%, 30+ 2.8%, 40+ 1.9%, 50+ 1.2%, 60+ 0.84%; touchdowns 0.80% (36). Between
returners (30+ returns) the mean spreads 1.54 yards against 1.42 from luck on kickoffs (about 0.6 a man; 0.8 over
2024–25) and 1.86 against 1.46 on punts (about 1.2 a man).

## 2. A play's time (`match/playTime.ts`)

A pure module: no draws, no league reads.

- **`playSeconds(f: PlayTimeFacts, u: number): number`** — whole seconds, at least 1: the NFL's time for what happened
  on draw `u`, each kind its own mean by §1's table and the NFL's spread about it (p10–p90 about ±2 seconds):
  - an incompletion (a throwaway included) by the throw's depth;
  - a catch by its yards (air and after), a run by its yards, each a touch longer when it ends out of bounds;
  - a pick or a fumble's return by its yards, read as a run's;
  - a punt returned by its return's length, fair caught or downed as §1's 6.9; a kickoff returned by its length;
  - a sack or a scramble: today's mean (a sack 4–6, a scramble 5–8), a scramble lengthening with its yards (not
    measured: marked so in the check);
  - a field goal stays 4–6 (kicks are read and fine).
- **`PlayTimeFacts`**: `{ kind: 'incomplete' | 'catch' | 'run' | 'scramble' | 'sack' | 'return' | 'punt' | 'fairCatch'
  | 'kickoff', yards: number, air?: number, outOfBounds?: boolean }`.
- **Where it applies:** every play of an AI game, and in your games every play the field doesn't time (incompletions,
  sacks the pocket doesn't, kicks). Your games' runs, catches and scrambles keep the field's clock (`fieldTime`): the
  bodies play it, and the parity check holds them to the same table.
- **The totals hold:** shorter incompletions mean more plays. The normal tempo's runoff between snaps (29–39 seconds) is
  refit so a team still runs 61–65 plays a game (`npm run sim` judges it). One draw replaces each of today's flat draws.

## 3. The half's last possession (`match/playTime.ts`)

- **`kneelOdds(f: HalfFacts): number`** — on the drive's first snap with 75 seconds or less in the 2nd quarter, the odds
  he kneels: by the clock (§1: about 65% at 20 or less, 9% at 21–40, nearly none past 40); by the timeouts (each one
  makes a try likelier: at 21–40 seconds 17% with none, 4% with three); by the spot (never past midfield, 8% from his
  own 36–50, about a third inside his own 35, the clock and timeouts leaning it); the score doesn't move it.
- **The head coach's lean:** his fourth-down appetite (`Situation.fourthDown`, −1…1): an aggressive coach tries more, a
  cautious one kneels, about ±5 points at 21–40 seconds. The NFL shows no spread between coaches beyond luck, so it
  stays small: flavor, the owner's call.
- **`HalfFacts`**: `{ clock, yardLine, timeouts, appetite }`.
- **One draw a drive:** the drive keeps one uniform, drawn at its first snap inside 75 seconds, and kneels on any snap
  where it falls under the odds then. The odds rise as the clock runs, so a team that tried at 40 seconds can kneel at
  12 after a sack, and it never flip-flops snap to snap.
- **Trying means a two-minute drill:** the hurry-up from anywhere (today from his own 25), a timeout after a gain in
  bounds (today from midfield); the spike and the kick at the gun as today.
- **Unchanged:** the 4th quarter's kneels (victory formation; tied in his own end at the end) and overtime.

## 4. The two-point try (`match/twoPoint.ts`)

- **`twoPointOdds(f: TwoPointFacts): number`** — the call after a touchdown. Certain where the NFL always goes (the
  4th quarter or overtime at −10, −5, −2, +1, +5; −1 with a minute or less, as today); the NFL's odds on the judgment
  calls (§1: −8 and −9 about 40% in the 4th, −1 earlier in the 4th 16%, ±5 about 40% and +12 17% before the 4th, a
  small chance elsewhere), so about 10% of tries go for two. The head coach's fourth-down appetite leans the judgment
  calls; Goes for Two (`twoPointHabit`) still fires on them (the spots where the odds aren't certain), as today.
- **`runShare(f): number`** — the play-caller's run or pass, 28% runs for the league, leaned by his pass lean
  (`Situation.passLean`) and a quarterback with legs (`scrambling`).
- **`TwoPointFacts`**: `{ quarter, clock, overtime, scoreDiff, appetite, passLean, qbScrambling }`.
- **The snap:** a real play from the 2 through today's run and pass code: the defense's goal-line call, the pocket
  (pressure, sack, scramble, throwaway), the catch or the run, picks and fumbles. It's good when it reaches the end
  zone; the run and pass odds on the 2 are leaned (a goal-line constant on each) so runs land at 56% and passes at 44%.
- **A turnover:** the defense returns it for 2 points (`DEF_TWO`, fitted so about 4% of tries end that way).
- **Books:** no stat line, as the NFL's (no rushing or passing yards, attempts, sacks or picks); the play's text names
  the men ("Two-point try: A.Passer pass to B.End is GOOD", "B.Back rush is stopped short", "intercepted by C.Corner,
  returned for 2"). Wear and contact count as a snap. No flags on the try, no clock (as today).
- **Film (your games):** the try stages as a snap from the 2 (the pocket, the open field), the result at the goal line.

## 5. Returns (`match/returns.ts`)

A pure module: no draws, no league reads.

- **`returnYards(f: ReturnFacts, u: number): number`** — the return's length on draw `u` from the NFL's shape, kickoffs
  (2025) and punts (2021–25) each their own table (§1's quantiles: the bulk and the tail), shifted by:
  - the returner's `returns` skill, mostly in the tail (a breakaway), held to the NFL's spread between returners (about
    0.6–0.8 yards a return on kickoffs, 1.2 on punts);
  - the coverage unit: the kicking side's special teamers' tackling and speed against the league's, new;
  - the special teams coordinators (`RETURN_COACH`) and the punter's habits (Outkicks Coverage, High Arc), as today.
- **The touchdown:** a return that reaches the end zone. No separate roll.
- **`ReturnFacts`**: `{ kind: 'kickoff' | 'punt', from: number, returner: number, coverage: number, coach: number,
  outkicks?: boolean, highArc?: boolean }` (`from`: yards to the end zone at the catch).
- **The averages hold:** 26 yards on kickoffs, 9.5 on punts.
- **Unchanged:** touchbacks, fair catches, muffs and fumbles on returns, the kickoff's catch spot, the return flags; the
  open field (your games) plays out today's length, so a breakaway is drawn as one.

## 6. The engine (`match/gameSim.ts`)

- Every flat play-time draw: `playSeconds` from what happened.
- `scrimmageDown()`: the drive's half draw and `kneelOdds` in place of `shouldKneel`'s 2nd-quarter branch; a trying
  team's tempo is hurry and its timeouts follow the two-minute drill (`coach.ts`: `tempo`, `offenseTimeout`).
- `conversion()`: `twoPointOdds` in place of `goForTwo`; the try as a snap (`twoPointTry()`), its men named, no stats.
- `kickoff()`, `punt()`: `returnYards`; the touchdown flag gone.
- `SimOptions.situationTap?: (tap: SituationTap) => void`: each play's time (kind, yards, seconds), each half drive's
  first call (clock, spot, timeouts, appetite, kneeled, how the drive ended), each try (the score, the call, run or pass,
  good, a defensive two), each return (kind, yards, touchdown, the returner's skill, the coverage).
- The try's snap taps nothing into `pocketTap`, `contactTap`, `endingTap` or the passer and picks taps: a snap from the
  2 would skew their buckets.
- No save change. The dice move: pinned results are re-taken (the personnel hash, the re-sign snapshot,
  `docs/ATTRIBUTES.md`).

## 7. Checks

- **`npm run situations [-- games]`** (`scripts/situations.ts`, `scripts/situations-core.ts`, the shape of `npm run
  dropback`; AI games):
  - judged: a play's time by kind and by yards or depth; the half's kneel share by the clock and by timeouts, and how
    drives that try from deep end; the two-point share of tries by the score and quarter, the run share, success by
    run and pass; returns' means, 20+, 40+, 60+, touchdowns per return, the spread between returners;
  - reported: sacks' and scrambles' time (not measured), tries before the 4th by the head coach's appetite, defensive
    twos, returns by the coverage unit.
  A share is judged once its tolerance clears 3.5 standard errors and the NFL's sample is 200 or more; a mean the same
  way on its standard error. Nothing may be ✗.
- **`npm run sim`** judges the same lines (`calibrate.ts`); `check.ts` maps the three modules and the scripts to them.
- **`npm run parity`** gains a line: your games' run and catch times (the field's) against the same table.
- **Must hold:** `sim` (plays a game 61–65, scoring, leaders), `endings`, `parity`, `film`, `fumbles`, `passer`,
  `picks`, `dropback`, `sideline`, `quirks --effects`, `audit`.

## 8. Tests

- `playTime.test.ts`: deeper incompletions take longer; time grows with the yards; out of bounds a touch longer; a
  returned punt longer than a fair catch; at least 1 second. The kneel: never past midfield; falls with each timeout;
  rises as the clock runs; mostly at 20 seconds or less; the appetite moves it.
- `twoPoint.test.ts`: the sure calls certain; −8 late and ±5 early near 40%; elsewhere small; the appetite moves the
  judgment calls only; the run share leans with the pass lean and the quarterback's legs.
- `returns.test.ts`: the NFL's quantiles over an even grid of draws; a touchdown exactly when it reaches the end zone;
  the returner's skill moves the tail most; a better coverage unit shortens returns; whole yards, never negative past
  the catch on a kickoff.
- Engine: a try names its men and books no yards or attempts; a defensive two scores for the defense; a team that tries
  before the half hurries and takes its timeouts; a return touchdown's length reaches the end zone; AI games' plays take
  the table's time.
- Film: a two-point try staged from the 2; a long return drawn the whole way.

## 9. Docs

`docs/MVP.md`: "a play's time", "the two-point try" and "return touchdowns" ticked (the "Low" line's breakups half
already done). CLAUDE.md: `npm run situations` beside `npm run dropback`; `match/playTime.ts`, `match/twoPoint.ts`,
`match/returns.ts` beside `match/dropbackEnd.ts`. A 0.4.11 changelog entry; `package.json` 0.4.11.
