# The passer under pressure

**Status:** built (0.4.5). Seasons 2023–25, not 2022–24: 2022's NGS file reads no pressure on any sack or scramble. Follows 0.4.4 (#149: out of bounds as the carrier's choice).

## Why

Today a dropback in `match/gameSim.ts` (`passPlay`) rolls pressure, then a sack, then, under pressure, a scramble
(`0.16 + 0.02 × (scrambling − 9)`, ×1.7 for `bailsEarly`), then a throwaway: a flat 12% for anyone who isn't a
gunslinger, who never throws it away. All of it comes before he has picked a receiver, and none of it reads his
decisions, the down, the distance, the score or the field. From a clean pocket he never throws it away; he leaves on a
flat 1.5% escape (more for a scrambler) or a 15% `bailsEarly` roll on deep reads. Intentional grounding doesn't exist.

This is the audit's first High item (`docs/MVP.md`, "choices and situations, not flat odds"): games that play like
the NFL's because the people in them choose, with the odds coming out of those choices and the situation, calibrated
against public data.

## Decisions (the owner's)

1. **Scope B:** the pressured choice (throw, throw it away, take off) and the same choice from a clean pocket when
   nobody's open. Sack odds stay as they are (the audit read them as fine); how long he holds the ball (NGS time to
   throw) is out (it overlaps "a play's time").
2. **Intentional grounding comes with it:** a throwaway from inside the pocket can be flagged, the rule
   `docs/PENALTIES.md` already describes.
3. **Gunslinger is a strong lean, not an absolute:** he throws it away about a third as often as a typical starter and
   forces the rest. No NFL starter sits at zero (the bottom tenth of QB seasons throw away 1.8% of dropbacks).
4. **One choice among three options** (of three approaches: this one; two chained logistic odds as in `sideline.ts`,
   whose order is arbitrary, so anything that leans him to run quietly cuts his throwaways; an expected-value chooser
   on `coach.downValue`, slow, hard to fit, and drifting with every engine change). Each option has a utility from named
   terms; the odds are their softmax.
5. **The engine decides, the field plays it out** (the owner's call H, as for out of bounds). One draw on the game's
   stream, the same in every game.

## 1. The NFL target

FTN charting (`is_throw_away`, `is_qb_out_of_pocket`) joined to NGS participation (`was_pressure`, `time_to_throw`) and
nflverse play-by-play, regular seasons 2022–24 (FTN begins in 2022), per play on game id and play id. Dropbacks
(`qb_dropback`) without spikes or two-point tries: 58,817 joined, about 98% of the league's. A sack is always
pressured. The numbers below are from the brainstorm; `scripts/research-passer.py` (§6) settles the final targets.

**All dropbacks:**

| | Dropbacks | Sack | Scramble | Throwaway | Throw |
|---|---|---|---|---|---|
| Pressured (30%) | 17,551 | 15.5% | 5.6% | 9.2% | 69.8% |
| Clean | 41,266 | 0.0% | 2.7% | 1.3% | 96.0% |

**By situation** (screens left out here):

| Bucket | Pressured: scramble | Pressured: away | Clean: scramble | Clean: away |
|---|---|---|---|---|
| All | 5.9% | 9.1% | 3.1% | 1.3% |
| 1st and 2nd down | 5.7% | 10.5% | 2.8% | 1.4% |
| 3rd and 1–3 | 6.6% | 6.8% | 3.7% | 0.9% |
| 3rd and 4–9 | 6.1% | 7.0% | 3.5% | 1.0% |
| 3rd and 10+ | 6.2% | 7.1% | 4.3% | 1.0% |
| 4th down | 6.0% | 3.4% | 4.1% | 1.6% |
| Red zone (inside the 20) | 5.7% | 13.8% | 3.5% | 2.5% |
| Backed up (own 10 or worse) | 6.9% | 11.6% | 2.0% | 0.6% |
| Last 5:00, trailing by 1–16 | 4.7% | 8.4% | 3.4% | 1.6% |
| Last 5:00, leading | 7.6% | 9.9% | 4.4% | 2.1% |

**Between quarterbacks** (QB seasons with 250+ dropbacks, 96 of them): scrambles a median 3.5% of dropbacks, the
spread from about 0 to 13.6% (Daniels 2024, Jackson 2023); throwaways a median 3.6%, the tenth to ninetieth percentile
1.8–5.7% (Young, Carr and Wilson at the top, about 7%). The research script re-takes these with each passer's
scrambles keyed on his id whichever column holds it.

**Throwaways and grounding, a season:** 712 throwaways, 60% from outside the pocket, 75% under pressure; a throwaway
leaves his hand at 4.3 s against a throw's 2.6 s. Intentional grounding about 47 flags (0.17 a game; 44 accepted), 92%
under pressure, two in three from inside the pocket: about 11% of throwaways from inside the pocket are flagged, about
4% from outside it, 1.5% of clean ones. About 1.3 safeties a season come from grounding in the end zone.

## 2. Where the choice sits

On every dropback, in this order:

1. **Pressure and the sack**, as today (`pressured`, `pSack`). A sack ends the play.
2. **The read**, as today: the depth call (`coach.passDepth`, the designed shot, the safe and end-zone leans), the
   target and his separation (`sep`). These draws move ahead of the choice; nothing in them changes.
3. **The choice** (`match/pocketChoice.ts`): throw, throw it away, or take off. The engine draws one uniform number
   against the three odds (`pocketCall`), on the game's stream.
   - **Throw:** today's completion and interception odds, with today's pressure penalty when pressured (and the
     gunslinger's forced ball, −0.1, when he chose to throw under pressure).
   - **Away:** an incompletion and a pass attempt; then where he threw it from (§4) and whether it's flagged (§5).
   - **Take off:** today's `scramble()`: `dropOutcome` 'scramble' under pressure, 'escape' from a clean pocket.
4. The pressured scramble roll, the flat 12% throwaway, the clean escape roll and the deep `bailsEarly` roll are gone;
   each is a term in step 3.

Moving the choice after the read reshuffles every passing game's draws. Like 0.4.4, that's expected: the checks judge
totals, and test fixtures that pinned a particular game are re-taken, never loosened.

## 3. The choice

```ts
export type PocketKind = 'throw' | 'away' | 'run';
export interface PocketFacts {
  pressured: boolean;
  /** His read's separation (`sep` in passPlay): below `OPEN` he's covered. */
  sep: number;
  depth: PassDepth;
  down: number;
  toGo: number;
  /** Yards to the goal line: the red zone at 20 or fewer, backed up at 90 or more. */
  toGoal: number;
  /** Trailing in the last five minutes (the clock is short: a run in bounds costs it). */
  trailingLate: boolean;
  passer: { decisions: number; scrambling: number; pocket: number; poise: number; energy: number; hurt: number;
    rattled: number; has(q: QuirkId): boolean };
}
export function pocketOdds(f: PocketFacts): Record<PocketKind, number>;
export function pocketCall(o: Record<PocketKind, number>, u: number): PocketKind;
```

Throw's utility is zero; away and run each have a utility from named terms; the odds are
`e^U / (1 + e^U_away + e^U_run)`. Every term is zero for a typical starter in a typical spot (`TYPICAL`: ratings 12,
poise 10, energy 85, 1st and 10 between the 20s), so a league of typical men keeps the base odds. Each constant is a
named const with a comment citing the bucket it comes from, as in `sideline.ts`.

**The situation:**
- **Pressure:** a base for each option, pressured or clean (the two rows of the first table).
- **Nobody open:** the less separation below `OPEN`, the higher both utilities; an open man (sep well above) lowers them.
  This is what makes the clean-pocket choices: a typical clean dropback with an open read throws.
- **Down:** 3rd down lowers away and raises run (the sticks); 4th lowers away hard (3.4% pressured) and raises run.
- **Red zone:** raises away (13.8% pressured, 2.5% clean).
- **Backed up:** lowers run from a clean pocket (2.0%).
- **Trailing late:** lowers run (4.7% under pressure).

**His makeup:**
- **Decision-making** (`decisions` in passPlay: the contest plus the hurry-up and rattled terms): scales how hard he
  reads the situation terms, as poise does the clock read in `sideline.ts` (a good decision-maker leans the right way
  further), and under pressure raises away (he throws it away rather than force it).
- **Scrambling** (`skill(qb, 'scrambling')`): raises run; the main source of the spread between quarterbacks.
- **Pocket presence** (`skill(qb, 'pocketPresence')`): lowers run under pressure (he climbs and stays in).
- **Poise** (`poiseOf`): a cool head throws on time under pressure (lowers away); a rattled one throws it away early.
- **Health:** under `TYPICAL.energy` and per injury this season and last (capped at 3), run drops.

**His habits:**
- **Gunslinger:** away down by `ln 3` (a third as often).
- **Bails Early:** run up, more on a clean deep read (today's 15% roll).
- **Navigates Muddy Pockets:** under pressure, away and run both down (he throws from it).
- **Sees Ghosts, once rattled** (`rattled` > 0): away and run up even from a clean pocket.
- **Thrives in No-Huddle:** the situation read sharpened in the hurry-up (already in `decisions`).

Bounds: away clamped to [0.002, 0.45], run to [0.002, 0.5], throw takes the rest; wide enough for the NFL's extremes and
no wider.

## 4. Where he threw it from

A throwaway is from outside the pocket or inside it: a second draw on the game's stream, only on a throwaway. Out of the
pocket is the base share (60% of throwaways), more for a scrambler, Bails Early or under pressure (FTN's out-of-pocket
share by pressure, from the research script). A ball thrown from outside past the line is legal; short of the line it
can still be flagged.

## 5. Intentional grounding

- **A new foul** in `penalties.ts`: `grounding`, the offense, loss of down, 10 yards from the previous spot or the spot
  of the pass if that's worse (the spot: his drop, about 7 yards behind the line inside the pocket, past it when he
  rolled out), a safety when the spot is in his own end zone. `enforce` handles loss of down and the safety.
- **The odds:** a throwaway from inside the pocket under pressure the most (fitted so inside throwaways land at about
  11%), from outside about 4%, a clean one about 1.5%; a crew's flag volume (`crewCalls`) scales it like every other
  foul. Drawn on the stream `playFouls` draws from, charged to the quarterback on its own stream.
- **Accept or decline:** `coach.takesPenalty`, as for every foul (the NFL accepts 44 of 47).
- **Stats:** a pass attempt and an incompletion; the foul on the quarterback's penalty line, as nflverse counts it.
- **The clock:** stops, as on any incompletion. The NFL's ten-second runoff for an offensive foul in the last minute is
  out: the engine has no runoff for any foul yet.
- **Target:** 0.17 a game, 92% under pressure, about 1.3 safeties a season.

## 6. The field and the words

- **The pocket gets two new shapes** beside today's 'away' (thrown away under pressure, inside the pocket):
  - **Clean, away:** nobody gets home; he holds, looks off his covered read, and throws it out of bounds near him.
  - **Out of the pocket, away:** he rolls past the tackle, then throws it away (the legal one).
  - **Grounded:** the ball lands in open grass, away from every receiver.
- `FieldFacts` carries where he threw it from (inside or outside) and whether it was flagged; the pocket's clock for a
  throwaway runs later than a throw's (4.3 s against 2.6 s in the NFL). `FIELD_VERSION` bumps.
- **Play text:** "under pressure, throws it away", "rolls out and throws it away", "throws it away", and
  "intentional grounding" with the yards (or "intentional grounding in the end zone, safety").
- **Habit wording** (`quirks.ts`): Gunslinger becomes "Rarely throws it away: under pressure he forces it into
  coverage, so fewer completions and more interceptions." Bails Early and Sees Ghosts are reworded only if what they
  do changes on screen.
- **AI games:** no field, the same draws; a throwaway's play time stays today's 4–6 s ("a play's time" is its own item).

## 7. Checks and targets

- **`scripts/research-passer.py`:** the NFL measurement in §1, cached under `work/nflverse` (FTN charting and NGS
  participation join the play-by-play already there). Prints the tables `passer-core.ts` copies.
- **`npm run passer [-- games]`** (`scripts/passer.ts` and `scripts/passer-core.ts`, the shape of `npm run sideline`):
  AI games tallied by §1's buckets, pressured and clean, with the NFL beside each. A bucket is judged only when its
  tolerance is at least 3.5 standard errors; the spread between quarterbacks (sd of throwaway and scramble shares over
  passers with 250+ dropbacks); throwaways from outside the pocket; grounding a game, its pressured share and
  safeties. Nothing may be ✗. `npm run sim` judges the same lines (`scripts/calibrate.ts`), so CI covers them.
- **Must hold:** `sim` (completion rate, interceptions, sacks, QB rushing yards, passer rating, the leaders, parity),
  `audit` (decision-making, scrambling and pocket presence still move play), `quirks --effects` (Gunslinger fewer
  throwaways and more picks; Bails Early more scrambles), `endings` (late-game choices), `parity` and `film` (the pocket's
  new shapes), `crews` (a new flag). No range is loosened.
- **Unit tests:** `pocketChoice.test.ts` (each term leans its way; a typical starter sits on the base odds; the odds sum
  to 1 and stay in bounds; one draw makes the call); grounding in the penalty tests (the spot against 10 yards, loss of
  down, a safety from the end zone, a declined flag); engine tests for the new film shapes.

## 8. Delivery

Version **0.4.5** (a follow-up item, so the last number, as 0.4.4 was). `docs/MVP.md`'s "passer under pressure" line
ticked; `docs/PENALTIES.md`'s grounding row built; `CLAUDE.md` gets `npm run passer` and `match/pocketChoice.ts`; the
changelog (`src/ui/changelog.ts`).

## 9. Out of scope

- Sack odds and who takes the sack (the audit read them as fine), QB-fault sacks and time to throw.
- A scramble's slide (its own Medium item) and its yards (today's).
- The ten-second runoff for offensive fouls; illegal forward pass (a scramble past the line that throws).
- A throwaway's play time in AI games ("a play's time").

## Risks

- **League totals move:** throwaways from clean pockets add incompletions; fewer scrambles under pressure (today's
  engine scrambles more than the NFL's 5.6%) cut QB rushing. The base odds are fitted with the sim's totals beside them;
  completion, interceptions and passer rating must stay in range.
- **Separation as "nobody open":** `sep` is the engine's own scale, not the NFL's yards; the open threshold and its
  slope are fitted to the clean-pocket rates, not read from NGS.
- **The pressure definitions differ:** NGS's `was_pressure` and the engine's `pressured` aren't the same event, so the
  fit targets the conditional shares (given pressure, given clean), and the engine's pressure rate stays its own.
- **Grounding's spot needs a drop depth** in AI games; a fixed typical drop (about 7 yards) is enough for the rule.
