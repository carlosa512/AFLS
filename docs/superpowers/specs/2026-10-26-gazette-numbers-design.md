# The Arena Gazette: the numbers desk

Piece D of the mail pass (A + B: `2026-10-26-offseason-mail-diet-design.md`; C:
`2026-10-26-director-recommendations-design.md`). Owner feedback: the Gazette fires about once a season with two lines.
It should run more often and bring a different kind of coverage from SNN, not noise: analytics from around the league
(leaders in a QBR-like measure, passing and rushing success rate, EPA, a DVOA-like read), drawing on how much the sim
tracks.

Decided with the owner: a column after weeks 4, 7, 10, 13 and 16, plus a playoff preview and a season wrap; each one
story and two or three tables; teams and players; the Stats screen's Advanced tab is a later PR.

DVOA and QBR are proprietary formulas: the Gazette uses the open measures they stand for: EPA per play, success rate,
explosive-play rate, pressure rate, and EPA per dropback in QBR's place.

## 1. The measures (`src/engine/analytics.ts`, new, pure)

- `expectedPoints(down, distance, yardLine)`: points the offense can expect from this spot, on a fixed table shaped on
  NFL averages. First and 10 by field position (yards from the offense's own goal line), linear between:
  1 → −1.2, 20 → 0.4, 50 → 2.0, 80 → 3.9, 90 → 4.6, 99 → 6.0. Later downs subtract: 2nd `0.25 + 0.05 × max(0,
  distance − 3)`; 3rd `0.6 + 0.12 × max(0, distance − 1)`; 4th `1.2 + 0.15 × distance`; each capped at 2.5. The
  constants may be tuned in this PR to bring the league's averages inside the ranges in §5; the table only measures,
  it never moves play.
- `playEpa(before, after)`: after a play, from the offense's side:
  - points scored on the play (a touchdown with its try as scored, a field goal, a safety as −2, a return touchdown as
    the defense's points against): `points − EP(before)`;
  - the offense keeps the ball: `EP(after) − EP(before)`;
  - the ball changes hands without a score (turnover, downs): `−EP(after, from the new offense) − EP(before)`.
- `isSuccess(down, distance, gained)`: 40% of the distance on 1st down, 60% on 2nd, all of it on 3rd and 4th (a
  touchdown always).
- `isExplosive(kind, gained)`: a run of 10+ yards or a completed pass of 20+.

## 2. Counting in the match engine (`match/gameSim.ts`)

At the one point every scrimmage play passes (`this.resolve(result)` in the play loop), with the situation before
(`s`: down, distance, yard line, offense, score) and the state after:

- a play that counted (the offense's `teamStats.plays` went up: a flag that wipes it out isn't one) adds to its
  team's `TeamGameStats.adv` and to its players.
- Attribution reads the play's own stat buffer (`result.stats`), which already credits the passer (`passAtt` or
  `sacked`), the rusher (`rushAtt`), the target (`targets`) and pass rushers (`pressures`): no new tagging in the play
  logic.
- `TeamGameStats.adv?: { plays, success, epa, explosive, dropbacks, passSuccess, passEpa, rushes, rushSuccess, rushEpa,
  pressured }` (the offense's numbers; a defense's are its opponents' in the same games). `pressured` counts the
  offense's dropbacks with a pressure.
- New `StatKey`s: `dropbacks` (attempts, sacks and scrambles), `epa` (summed; on the passer for a dropback, the
  rusher for a designed run, and the target for a targeted pass, so a play can credit two players), `successes`
  (same attribution), and `rushSnaps` (a defender who rushed the passer on a dropback, counted where the engine picks
  the pass-rush rotation for the play). Season and career totals sum them like the rest.
- Nothing about play changes: the same seed gives the same scores and box scores, now with the new fields. A test
  replays seeded games and compares everything else.

Save: `TeamGameStats.adv` and the new stat keys are optional; games played before the upgrade have none and show a dash.
`SAVE_VERSION` + 1 (after #87's v51: 52) with a no-op `migrate.ts` step.

## 3. The column (`src/engine/gazette.ts`, new; filed by `inbox.ts`)

From "The Arena Gazette", category `league`, id `gazette:{season}:{edition}`, edition `w4`, `w7`, `w10`, `w13`,
`w16`, `preview` (once the regular season is complete), `wrap` (once the final is played). Filed only at its moment
(no backfill after a long advance, as SNN), whether or not we have a job (the league is public). Never Needs you.

**Sample sizes.** A team's numbers count once every club has played the checkpoint's games; a player needs 12
dropbacks (passers), 6 rushes (rushers) or 4 targets (receivers) per team game, and 15 `rushSnaps` per team game for a
pass rusher (rate: pressures per pass-rush snap). Ranks need every qualifying club.

**Tables.** Each table: a title, the top five, a gap row, the bottom three (or the top ten for players), and our row
wherever we stand (`tr.is-user`), with clubs as `TeamLink` and players as `PlayerLink`. Saved with the mail as a
snapshot (`InboxMessage.gazette`), like SNN's tables.

**Themes**, two or three per column, chosen so consecutive columns differ:

| Theme | Table(s) |
|---|---|
| Offense | team EPA/play, success rate |
| Defense | EPA/play allowed, success rate allowed |
| Passing | QB EPA per dropback (our QBR stand-in), team dropback success |
| Rushing | rusher success rate, team rush EPA |
| Explosives | team explosive-play rate, both sides |
| Pass rush | team pressure rate, player pressures per pass-rush snap |
| Situational | 3rd-down conversion, red-zone touchdown rate (from `TeamGameStats`) |

**The story.** One angle, the first that holds, then two or three short paragraphs that say what the numbers mean
(the sim makes the facts, the writing says what they mean; every sentence chosen by a condition):

1. A club leads a measure by a distance (the gap to second is at least a quarter of the spread between first and
   tenth): "The Summit are running away with it: 0.21 EPA a play, a tenth clear of anyone."
2. Our club stands out (top three or bottom three) on a measure in this column's themes.
3. The biggest mover since the last column (a club's rank on a measure up or down 10+).
4. A split: a top-five offense with a bottom-five defense, or the reverse.
5. The turnaround angle from today's trajectory stories (a club at .750 after six wins or fewer last year, or .375 after
   ten or more), which this replaces as a stand-alone story.
6. Otherwise the league's state on the lead theme ("Passing is up: dropbacks are worth 0.07 a play, against 0.04 at
   the same point last year" when last year's numbers exist).

A closing line locates us: "The Summit sit 12th on offense and 4th on defense."

**Preview:** the seeded clubs on offense and defense EPA, the widest first-round mismatch, and our place if we're in.
**Wrap:** the season's leaders on each theme, our season in numbers.

## 4. What changes elsewhere

- The Gazette's trajectory stories (`news.ts`) stop: the turnaround becomes a story angle (rule 5). SNN's stories are
  unchanged.
- `docs/NEWS.md`: the Gazette's rules. `docs/MVP.md`: "Full news and media outlets" stays Partial, with the Gazette's
  analytics column named.
- The Advanced tab on the Stats screen is a later PR.

## 5. Validation

`npm run sim` (`scripts/calibrate.ts`) prints the league's EPA/play, EPA per dropback, EPA per rush, success rate and
explosive rates against the NFL's, as `⚠` warnings outside these ranges (a measurement, not play, so it warns rather
than fails): EPA/play −0.05…0.05; per dropback 0.00…0.12; per rush −0.15…−0.02; success rate 0.42…0.48; explosive
runs 8–13% of rushes; explosive passes 7–11% of dropbacks.

## Testing

- `analytics.test.ts`: the EP table at its anchor points and monotone in field position; success on each down; a
  touchdown, a field goal, a turnover and a turnover on downs give the right sign and size of EPA; explosives.
- `engine.test.ts` (or a new file): seeded games give identical scores and box scores with the counting on; every
  counted play is in `adv.plays`; `dropbacks` equals attempts + sacks + QB scrambles; per-player `epa` sums to the
  team's when counted over passers and designed-run rushers only (targets share a passer's play, so they're left
  out of the sum); `rushSnaps` is counted only on dropbacks.
- `gazette.test.ts`: one column per edition, none filed late; samples respected; our row always present; story
  angles chosen by their conditions (a constructed leader, a mover, a split); consecutive columns differ in themes;
  the snapshot survives later games.
- `inbox.test.ts` / `news.test.ts`: no trajectory stories; the column is filed from the Gazette with its tables.
- `npm run sim -- 10` and the area checks CI's planner picks for `match/`.

## Release

The last number of `package.json`'s version (the news item stays Partial), a changelog entry, `docs/NEWS.md`,
`docs/MVP.md`.
