# How old the NFL's starters are, and what happens to them next season

Research input for `docs/superpowers/specs/2026-11-14-league-age-design.md`: the targets `npm run careers` judges a
20-season league against (`scripts/league-age-core.ts`). Reproduce with `python3 -I scripts/research-aging.py
--download`.

## Sources and definitions

- **Data:** nflverse's snap counts (`snap_counts_{2013..2025}.csv`, regular season) and players (`players.csv`, birth
  dates, joined on the Pro Football Reference id).
- **Starters:** a team-season's top N players at a position by season snaps, N as AFLS's `STARTERS` (QB 1, RB 1, WR 3, TE
  1, OL 5, DT 2, EDGE 2, LB 2, CB 3, S 2, K 1, P 1): offense snaps for the offense, defense snaps for the defense,
  special-teams snaps for K and P. Positions mapped: T, G, C → OL; DT, NT → DT; DE, OLB → EDGE; LB, ILB, MLB → LB; CB, DB
  → CB; S, FS, SS → S.
- **Age:** on September 1 of the season, in whole years (AFLS keeps whole years).
- **Next season:** a starter in Y is still starting in Y+1 (a starter anywhere), plays but doesn't start, or is gone (no
  snaps in Y+1). Left for good: no snaps in Y+1 or Y+2.
- **AFLS is read the same way** (`seasonStarters` in `scripts/league-age-core.ts`): top N by `StatLine.snaps`, K and P by
  games played.

## Starters' ages, 2016–25

| Position | n | Mean | 24 or younger | 31 or older |
| --- | --- | --- | --- | --- |
| QB | 320 | 28.02 | 32.5% | 28.8% |
| RB | 320 | 25.15 | 44.7% | 4.1% |
| WR | 957 | 25.54 | 41.6% | 6.2% |
| TE | 320 | 26.57 | 30.9% | 11.9% |
| OL | 1,600 | 26.75 | 26.7% | 12.5% |
| DT | 621 | 26.67 | 27.1% | 11.1% |
| EDGE | 603 | 26.48 | 32.0% | 11.6% |
| LB | 638 | 26.30 | 28.8% | 8.8% |
| CB | 960 | 25.66 | 41.1% | 6.0% |
| S | 634 | 26.20 | 32.3% | 9.3% |
| K | 319 | 28.97 | 18.8% | 32.6% |
| P | 319 | 28.09 | 22.9% | 25.1% |
| All | 7,611 | 26.48 | 32.2% | 11.8% |

2021–25 alone is within a point of these shares (31.7% and 11.5%).

## A starter's next season, 2013–24

Still starting / gone, by age:

| Age | All | Long prime (TE, OL, DT) | Short prime (RB, WR, CB, EDGE, LB, S) |
| --- | --- | --- | --- |
| 21–24 | 68.7% / 4.2% | 70.3% / 4.1% | 66.3% / 3.9% |
| 25–26 | 64.8% / 5.8% | 64.8% / 5.4% | 62.6% / 5.9% |
| 27–28 | 63.0% / 7.6% | 64.8% / 7.2% | 59.0% / 7.4% |
| 29 | 60.7% / 11.1% | 61.8% / 12.0% | 55.4% / 11.9% |
| 30 | 54.0% / 16.3% | 54.4% / 17.5% | 47.3% / 17.7% |
| 31 | 52.3% / 15.1% | 44.9% / 18.4% | 48.1% / 15.2% |
| 32 | 59.9% / 17.8% | 53.6% / 27.4% | 55.2% / 16.2% |

Past 32 the samples are small (all: 184 at 33, 126 at 34): the script prints them, and they aren't judged.

## The age a starter left for good, 2013–23 (median)

QB 37.0 (n 12), RB 27.0 (17), WR 27.0 (73), TE 31.0 (15), OL 30.0 (142), DT 29.0 (57), EDGE 29.0 (51), LB 29.0 (26), CB
30.0 (55), S 29.5 (56), K 32.0 (22), P 30.0 (27). Shown beside AFLS's, not judged: small samples, and the "gone" column
judges exits.

## Peak ages by the delta method, 2013–2025

The careers check's peak-age ranges (`scripts/careers.ts`, the owner's call, 2026-11-14) come from here rather than from
peak-season counts, which count only the players who lasted long enough to have one. The delta method compares each
player only with himself: the mean change from one season to the next at each age (pairs who played both, weighted by
volume), summed into a curve. Reproduce with `python3 -I scripts/research-peaks.py`.

| Position | Snap share: peak (within a tenth of the rise) | EPA a play: peak | Careers range (was) |
| --- | --- | --- | --- |
| RB | 24 (22–27) | 22, a carry (then a slow decline) | 23–26 (24–27) |
| WR | 23 (23–27) | 25, a target (22–25) | 24–27 (25–28.5) |
| CB | 25 (22–27) | | 24–27 (25–28.5) |
| DT | 27 (25–27) | | 25–28 (25–30) |
| EDGE | 26 (25–28) | | 25–28 (25–30) |
| LB | 26 (24–28) | | 25–28 (25–30) |
| S | 27 (24–27) | | 25–28 (25–30) |
| TE | 25 (24–25) | 25, a target | 24–28 (26–32) |
| OL | 25 (24–27) | | 24–28 (26–32) |
| QB | not meaningful (a starter plays every snap) | flat from 23 to 33, a dropback | 25–31 (27–31) |

Snap share is how much coaches play a man, the one measure every position has; EPA is play itself, for the positions with
the numbers. By 32 a tight end's or lineman's snap share is down about a quarter from its peak (a TE's EPA a target
similarly): the "holds within 0.6 at 32" lines may be stricter than the NFL too, left as they are for now.

## AFLS before this work (0.4.44)

Three 20-season leagues, seasons 11–20: starters average 27.7–27.8, 20% are 24 or younger and 21–22% are 31 or older;
quarterbacks 8–10% and 48–53%. A starter aged 21–28 is still starting the next season 76–80% of the time, and a long-prime
starter aged 29–31 is gone 3–4% of the time. The spec's tables have every position.
