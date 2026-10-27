# NFL draft outcomes: how often picks bust and how often late picks hit

Gathered 2026-10-27 for the settling ceilings (`docs/superpowers/specs/2026-10-27-draft-busts-design.md`). The
studies disagree mostly because they mean different things by "starter" and "bust", so each figure carries its
definition.

## First round

| Source | Sample | Definition | Figure |
| --- | --- | --- | --- |
| [RotoWire, draft pick value study](https://googlenews.rotowire.com/football/article/nfl-draft-pick-value-analysis-105496) | 2000–2024, 800 first-rounders | Bust: started one full season or fewer | Pick 5: 13% bust (the safest slot) |
| [Deephaven, NFL draft analytics](https://deephaven.io/blog/2026/04/20/nfl-draft-analytics/) | not stated | Didn't stick two seasons | OL 22% bust, QB about 45% |
| [RotoBaller](https://dev.rotoballer.com/?p=866796) | not stated | Bust category | Picks 21–32: 29.2%; picks 49–64: 43.8% |

The strict "one season started" count gives the low end; "never a reliable starter" sits around a third of the
round, higher late in it and at quarterback.

## Day 3 (rounds 4–7)

| Source | Sample | Definition | Figure |
| --- | --- | --- | --- |
| [Windy City Gridiron, draft research project](https://www.windycitygridiron.com/2025/4/18/24406978/nfl-draft-research-project-update-part-3-day-three-selections-hidden-gems-contributors-late-round) | 2011–2020 | 40+ starts in his first five years | About 10% |
| [Blogging the Boys](https://www.bloggingtheboys.com/dallas-cowboys-draft/200615/late-round-draft-picks-udfa-success-rates-trade) | 2010–2025 | Eight starts in at least one season | 23.1% of rounds 5–7 (round 4 about 47%) |

## What AFLS uses

A pick **hits** when his true overall reaches a **solid starter** at his position by 27: the 30th percentile of
the league's starters there, the scout report's "solid starter" tier (`tierOf` in `scouting.ts`). That sits
between the strict and loose counts above.

- **First-round busts** (never hit): **25–40%**, centred on about 1 in 3.
- **Day 3 hits** (rounds 4–7): **8–20%**, between the 40-start count and the looser one.

`npm run careers` checks both.
