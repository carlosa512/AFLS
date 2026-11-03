# Player size on real rosters

What `SIZE` and `BOUNDS` in `src/engine/size.ts` are fitted to, and how to rebuild them. Spec:
`docs/superpowers/specs/2026-11-02-real-heights-design.md`.

## Source

nflverse rosters, the `rosters` release of `nflverse/nflverse-data` (`roster_2020.csv` … `roster_2024.csv`), read
2026-11-02. Rows with status `ACT` only (the active 53s, not the practice squad, injured reserve or the reserve
lists), one row per player per season (the first by `gsis_id`), height (inches) and weight (pounds) as listed.

Why rosters, not the combine: the old curves came from combine percentiles, which include every prospect who worked
out, most of whom never make a 53. Real rosters run tighter (linemen ±1.5 in against the combine's ±2.2) and are
what a league should look like.

## Position mapping

From `depth_chart_position`, falling back to `position`:

- QB → QB; RB, HB, FB → RB (the game has no fullback); WR → WR; TE → TE
- T, G, C, OT, OG, LT, RT, LG, RG → OL
- DE, OLB → EDGE; DT, NT → DT; ILB, MLB, LB → LB
- CB → CB; S, FS, SS → S; K, PK → K; P → P

OLB covers 3-4 rushers and 4-3 outside linebackers alike, so EDGE runs a little light and wide on weight. Accepted:
it errs toward variety, not toward impossible builds.

## The numbers

Five seasons pooled. The range is the five seasons' shortest and tallest (lightest and heaviest): the founding
league's bounds. Arrivals (draft classes and everyone after) get one inch and ten pounds more each side
(`ARRIVAL_STEP`).

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

Players a season at the range's ends (the long run in `npm run size` judges against the max and min columns, scaled
to our rosters):

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

## Rebuilding

Download the five CSVs, keep `status == 'ACT'`, dedupe by `gsis_id` within a season, map positions as above, then per
position: the mean and population sd of height and weight, the min and max, Pearson's correlation of height with
weight, the players per season (rows ÷ seasons), and the count at each height divided by the seasons.
