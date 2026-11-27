# The NFL's discipline: ejections and suspensions

Research input for `docs/superpowers/specs/2026-11-23-discipline-design.md`: the targets the discipline work is tuned to.
The owner's rule is the average, not hyper-realism. Read on 2026-11-24 from public pages (no data download, so no script).
Several figures are second-hand, read through a page summarizer, and the sources disagree for 2023 and 2024; where they
do, both are shown.

## Sources

- Quirky Research, NFL ejections list (1978 on, one row a player with the reason in free text; the reason groups below are
  mine): https://www.quirkyresearch.com/football-lists/nfl-ejections
- Football Zebras, "2025 officiating year in review": https://www.footballzebras.com/2026/02/2025-officiating-year-in-review/
- Football Zebras, "5 officiating observations for the 2024 season": https://www.footballzebras.com/2025/02/5-officiating-observations-for-the-2024-season/
- Football Zebras, "7 officiating observations from the 2023 season": https://www.footballzebras.com/2024/02/7-officiating-observations-from-the-2023-season/
- ESPN NFL Nation on ejection records: https://www.espn.com/blog/nflnation/post/_/id/220270/nfl-on-pace-to-obliterate-recent-ejections-record (page did not load; only its headline was seen)
- NFL Football Operations, gameday accountability (weekly fine schedule and results): https://operations.nfl.com/inside-football-ops/rules-enforcement/gameday-accountability (gives no season totals)
- NFL.com on one suspension: https://www.nfl.com/news/nfl-suspends-lions-brian-branch-one-game-postgame-fight-chiefs
- Spotrac, fines and suspensions tracker: https://www.spotrac.com/nfl/fines-suspensions (returned HTTP 402, not read)
- Pro Football Talk fine roundups (weekly): https://www.nbcsports.com/nfl/profootballtalk/rumor-mill/news/nfl-week-5-2023-fines-roundup
- NFLPA on the fine system (a party to the dispute): https://nflpa.com/posts/the-nfl-fine-system-is-not-fine

## Ejections a season

Quirky Research's table, regular season. 2017 was not in the table read.

| Season | Ejections | Fights | Hits to the head or helmet | Unsportsmanlike (incl. second) | Official contact | Other |
|---|---|---|---|---|---|---|
| 2025 | 11 | 6 | 2 | 0 | 2 | 1 |
| 2024 | 13 | 10 | 2 | 1 | 0 | 0 |
| 2023 | 19 | 10 | 6 | 0 | 2 | 1 |
| 2022 | 16 | 7 | 5 | 0 | 2 | 2 |
| 2021 | 13 | 10 | 1 | 0 | 1 | 1 |
| 2020 | 24 | 15 | 5 | 0 | 3 | 1 |
| 2019 | 16 | 7 | 6 | 1 | 1 | 1 |
| 2018 | 20 | 12 | 5 | 1 | 1 | 1 |
| 2016 | 13 | 7 | 0 | 4 | 2 | 0 |

- Nine seasons: 145 ejections, 16.1 a season (a 272-game season: about one ejection every 17 games). Last five (2021-25): 72, 14.4 a season, a falling trend.
- Fights: 84 of 145 (58%); last five 43 of 72 (60%).
- Hits to the head or helmet: 32 in nine seasons, 3.6 a season, range 0 to 6; last five 3.2.
- Where the sources disagree: Football Zebras counts 17 for 2024 ("all for fighting or a second unsportsmanlike foul") and
  17 or 21 for 2023, against Quirky's 13 and 19, and its 2025 review says 13 for 2024 and 11 for 2025. The gap is likely
  playoffs or coaches; the table above is the one with reasons. Football Zebras says "around 20 NFL ejections in a season"
  a few years ago.
- Not found: a count by league year from the NFL itself.

## On-field suspensions

No season total could be found. What was found is single cases, so the counts below are floors, not totals.

| Case (season) | Games | Reason | Source |
|---|---|---|---|
| Brian Branch, Lions (2025) | 1 | punched a receiver after a game (a fight) | NFL.com above |
| Ja'Marr Chase, Bengals (2025) | 1 | unsportsmanlike conduct in a game | https://700wlw.iheart.com/alternate/amp/2025-11-17-nfl-suspends-jamarr-chase |
| Denzel Perryman, Chargers (2025) | 2 | repeated violations of the rules protecting players (a hit on a receiver on the ground); his previous suspension was 2023 | https://www.foxnews.com/sports/nfl-suspends-chargers-denzel-perryman-2-games-repeated-violations-after-scary-hit-cowboys-receiver.amp |
| Tart and Williams (season not given) | 1 each | stepping on opponents | https://www.foxsports.com/articles/nfl/nfl-suspends-tart-williams-for-stepping-on-opponents |

- Four of the five suspensions seen were one game (80%); the one two-game ban was a repeat offender. The pattern matches
  the spec's ladder: first one game, a longer ban only for a pattern.
- A player disqualified for a second unsportsmanlike foul has also been suspended a game (reported for 2026), and the NFL
  fines most first offences: weekly on-field fines run about 20 to 36 players a week (PFT), with 253 fines through week 9
  of 2023 and about 460 for 2022 (NFLPA, about 100 of them rescinded). That is the clean figure for fines volume:
  roughly 400 a season, so a fine is the usual outcome and a suspension rare.
- Not found: a count of on-field suspensions a season, the share of first offences that are fines only (only that fines
  are the norm), and the length distribution beyond the cases above.

## Conduct policy (fits our tone only)

Kept to fights and unsportsmanlike conduct away from play. Skipped on purpose: anything about crimes, substances,
domestic matters or gambling; those suspensions (several a season, some long) are not wanted in AFLS and are not counted
here. No clean count of the fight-away-from-the-field kind was found beyond the postgame punch above.

## Targets for AFLS

Bands in `scripts/band.ts`'s shape: inside `usual` is quiet, outside it warns (unusual for a league), outside `normal`
fails. A league plays 272 games a season like the NFL. Rows marked guess had no NFL figure and keep the spec's guess.
The spec's earlier guess of about 9 ejections a season was low: the NFL's recent average is 14 to 16.

| Line | NFL | usual | normal | Basis |
|---|---|---|---|---|
| Ejections a league season | 14.4 (2021-25), 16.1 (9 seasons), range 11-24 | [10, 20] | [6, 26] | measured |
| Fight share of ejections | 58% (60% last five) | [0.45, 0.70] | [0.30, 0.85] | measured |
| Flagrant-hit ejections a league season | 3.6 (3.2 last five), range 0-6 | [1, 6] | [0, 8] | measured; the normal ceiling is the spec's fail line |
| League suspensions a season (on-field and our-tone conduct) | not found; at least 4 seen in 2025 | [3, 10] | [1, 14] | guess (spec: about 4-8) |
| One-game share of suspensions | 4 of 5 seen (80%) | [0.60, 0.95] | [0.45, 1.00] | thin sample, a guess leaning on it |

Also from the spec, unchanged: a first league suspension longer than one game never happens.
