# Real heights: builds bounded by real NFL rosters

## Problem

Builds come from each position's bell curve (`SIZE` in `size.ts`, fitted to NFL combine percentiles), clamped at
±2.5 sd (`TAIL`). Two things make a new league look unlike the NFL:

1. **The curves are too wide.** Combine numbers include prospects who never make a roster, so the spreads run wider
   than real 53s (OL ±2.2 in against a real ±1.5, CB ±2.3 against ±1.6). The caps then reach builds the NFL doesn't
   field: a new league has about 13 linemen at 6'9" or taller, 13 edge rushers at 6'8" or taller and linemen as short
   as 6'0".
2. **Tails pile up at the caps.** `rollSize` clamps a draw past the cap *onto* the cap, so each cap collects its whole
   tail: about 7 linemen at exactly 6'0" and 7.5 corners at exactly 5'7" in every new league (four seeds, 2026-11-02).

The owner wants a league that looks like the NFL: the tallest quarterback or the shortest receiver bounded by real
life, and room left for the rare build to come through the draft.

## Decisions (with the owner)

- **Two tiers, one curve.** A single curve per position, fitted to real active rosters. The founding league is cut
  off at the real five-season extremes; everyone who arrives later (draft classes, Pathway and CFL arrivals, squad
  and depth signings) is cut off one step further out. Because every founding player retires within about fifteen
  seasons, the arrival curve *is* the long-run league: there is no second, wider curve to drift toward, and the thin
  tail past the real extremes is what lets a rare build through.
- **Height and weight** both.
- **Old saves are left alone.** Players keep their builds and age out; no migration, no `SAVE_VERSION` bump.
- **Its own PR**, after the young players' review letter.

## The data

nflverse rosters (`nflverse-data` release `rosters`, `roster_{2020..2024}.csv`), status `ACT`, one row per player
per season (first row by `gsis_id`), height and weight as listed. Positions map from `depth_chart_position`, falling
back to `position`:

- QB → QB; RB, HB, FB → RB (the game has no fullback); WR → WR; TE → TE
- T, G, C, OT, OG, LT, RT, LG, RG → OL
- DE, OLB → EDGE; DT, NT → DT; ILB, MLB, LB → LB
- CB → CB; S, FS, SS → S; K, PK → K; P → P

Known blur: OLB covers 3-4 rushers and 4-3 outside linebackers alike, so EDGE runs a little light and wide on
weight. It's accepted: it errs toward variety, not toward impossible builds.

The research note (`docs/research/player-size-rosters.md`) keeps the source, the mapping, the script's logic and the
table below, the way other calibrations keep theirs.

| Pos | Height mean ± sd (in) | Height range | Weight mean ± sd (lb) | Weight range | h–w corr | Players/season |
| --- | --- | --- | --- | --- | --- | --- |
| QB | 74.7 ± 1.8 | 70–79 | 221 ± 10 | 194–245 | 0.62 | 65 |
| RB | 71.0 ± 1.9 | 66–76 | 217 ± 18 | 176–311 | 0.65 | 113 |
| WR | 72.5 ± 2.4 | 66–78 | 199 ± 15 | 153–247 | 0.74 | 168 |
| TE | 76.6 ± 1.3 | 72–80 | 250 ± 10 | 215–285 | 0.38 | 100 |
| OL | 76.9 ± 1.5 | 73–81 | 314 ± 14 | 260–380 | 0.31 | 256 |
| DT | 75.3 ± 1.5 | 71–80 | 309 ± 18 | 252–379 | 0.01 | 120 |
| EDGE | 75.4 ± 1.6 | 71–80 | 259 ± 22 | 205–342 | 0.50 | 210 |
| LB | 73.5 ± 1.3 | 70–77 | 234 ± 9 | 209–260 | 0.10 | 116 |
| CB | 71.8 ± 1.6 | 68–77 | 193 ± 9 | 158–218 | 0.47 | 156 |
| S | 72.1 ± 1.5 | 68–76 | 204 ± 8 | 178–225 | 0.44 | 128 |
| K | 72.0 ± 2.1 | 67–77 | 195 ± 16 | 156–232 | 0.53 | 32 |
| P | 74.2 ± 2.0 | 70–78 | 211 ± 17 | 176–250 | 0.48 | 32 |

Real tail counts per season, for the long-run check (height at the range's ends):

| Pos | At the max | One under | At the min | One over |
| --- | --- | --- | --- | --- |
| QB | 0.2 | 4.0 | 1.2 | 1.6 |
| RB | 0.4 | 4.2 | 1.2 | 1.8 |
| WR | 0.8 | 4.4 | 0.6 | 1.2 |
| TE | 1.6 | 4.2 | 0.8 | 0.0 |
| OL | 1.4 | 13.0 | 2.6 | 9.2 |
| DT | 0.6 | 2.6 | 0.4 | 3.6 |
| EDGE | 0.8 | 5.2 | 1.0 | 9.8 |
| LB | 2.2 | 4.4 | 0.4 | 6.4 |
| CB | 0.2 | 1.0 | 1.0 | 13.2 |
| S | 2.8 | 5.6 | 0.8 | 4.4 |
| K | 1.2 | 1.0 | 0.4 | 1.0 |
| P | 0.2 | 5.4 | 0.6 | 2.6 |

## Design

### The curves (`size.ts`)

- `SIZE` becomes the table above: `h: [mean, sd]`, `w: [mean, sd]`, plus `r`, the position's height–weight
  correlation (replacing the one `HEIGHT_WEIGHT = 0.5`; DT's 0.01 and LB's 0.10 are real, not noise to smooth).
- `BOUNDS: Record<Position, { h: [number, number]; w: [number, number] }>`: the founding bounds, the table's ranges.
- The arrival bounds are the founding bounds widened by `ARRIVAL_STEP = { h: 1, w: 10 }` each side (inches,
  pounds).
- `sizeLimits(pos, tier = 'arrival')` returns the tier's bounds. Callers that read today's limits (the size check,
  `toCurve`) keep working; `toCurve` (the pre-0.2.2 migration) uses `arrival` so it never narrows an old save.
- `sizeZ`, `isOutlier` and the gem keep their meaning against the new `SIZE`: a z-score is still "how unusual for
  his position", now measured against real rosters. `isOutlier`'s 1.3 sd line stays.
- `TAIL` goes: the bounds replace it.

### The roll

`rollSize(rng, pos, tier: 'founding' | 'arrival' = 'arrival')`:

- Still exactly **two draws** from `rng`, so names and jerseys drawn after it are unchanged in order.
- Height: a normal truncated to the tier's height bounds by inverse CDF on the first uniform (the uniform is
  mapped into the bounds' CDF interval, with the bounds widened by half an inch each side so rounding lands inside),
  then rounded. Nothing is clamped onto a bound, so nothing piles up there.
- Weight: the same on the second uniform, conditioned on height with the position's `r` (the conditional normal's
  mean and sd), truncated to the tier's weight bounds.
- The inverse normal CDF and the normal CDF are small pure helpers in `size.ts` (Acklam's or a similar rational
  approximation; accuracy to 1e-6 is plenty for whole inches and pounds).

### Who rolls which tier

- `createLeague`'s founding players: `founding`.
- Everyone generated after the league exists: `arrival`. That's draft classes (`offseason/draft.ts`), Pathway and CFL
  arrivals (`offseason/arrivals.ts`), squad-market players (`personnel/squadMarket.ts`) and AI depth signings
  (`offseason/ai.ts`).
- `generatePlayer`'s `PlayerSpec` gets `founding?: boolean`. Only `createLeague` sets it, so a new call site defaults
  to arrivals.

### What this moves

- **Every world rolls differently.** Heights and weights change for every seed; the draw count doesn't, so ratings,
  names and jerseys keep theirs. Tests pinned to a specific build get new expected values. Tests pinned to anything
  else must not change; one that does is a finding.
- **Play may shift a little.** The engine's edges work off inch and pound gaps (`sizeEdge`, `massEdge`,
  `rushSizeEdge`), so tighter curves mean smaller edges on average. The edges are centred at the medians, so league
  totals should hold; `npm run size`'s medians-against-as-built block must still pass, and CI's `sim` and `quirks`
  checks judge the rest. The lever block (one group pushed two sd out) keeps passing because two sd is now measured
  against the new sd.
- **Screens and the AI** read size through `sizeZ` (`buildNote`, `spotNotes`, `heightMismatch`, `sizeBias`). They keep
  working and simply call fewer players outliers in absolute inches.
- **Old saves:** untouched. Their founding players keep the old builds until they retire; every new arrival rolls on
  the real curve.

## The checks (`npm run size`)

The existing blocks change their reference: rolls are judged against the new `SIZE` and each tier's bounds (mean
±0.2 in and ±2 lb, sd within 10% of the curve truncated to its bounds, nothing outside the bounds). A founding roll
also checks that no bound collects more than its curve's share (the pile-up can't come back).

A new block, **the long run**: one league played for 25 seasons with `simToEndOfSeason` and `advanceOffseason`
(`autoUser`), in a child process if it needs one to stay within the run's time budget. Each season after the
offseason, count each position's rostered players at and past the founding height bounds, and every player outside
the arrival bounds.

- Over the last five seasons, the average count at the founding max and at the founding min per position stays
  within 2× the real rate in the table above, scaled by our rostered players at that position over the real
  players per season (a league carries more quarterbacks than the real 65), plus 1.5 players of slack for small numbers (a position whose real rate
  is 0.2 may carry up to 1.9). ✗ if not.
- Past the founding bounds (the arrival tier's extra inch): at most 1.5 per position per season over the last five.
  ✗ if not.
- Nobody outside the arrival bounds, ever. ✗ if anyone.
- It prints the rare builds that came through (position, height, weight, season drafted) so a reader can see them.

The `scripts/size.ts` header and CLAUDE.md's `npm run size` line say what the new block checks.

## Out of scope

- Moving old saves' players onto the new curves.
- Size changing with age (weight gain, weight cuts).
- Position-specific shapes beyond a truncated normal (skew). If the long run shows a real-world asymmetry the
  normal can't hold, that's a follow-up.

## Version

The middle number is for MVP items; this is a calibration of an existing system, so it is a fix: the last number,
from whatever main is at when this PR opens.
