# Cap hoarding and dead money: spec

## The request (project owner, 2026-10-20, verbatim)

> Follow-up from PR #64 (green main). Fix why AI front offices hoard cap early and then book huge
> dead money. Two root causes were measured on the offseason audit seed (createLeague
> { seed: 'offseason-audit' }, advanceOffseason with { autoUser: true }):
>
> A. The opening market has nothing to buy. At kickoff of year 1 the lowest team has 62% of the cap
> committed and the median 91%; at the first new year the median team has only 67% committed, and
> the free-agent pool has 347 players of whom 2 are OVR 14+ and 15 are 13+. A hoarder (CHI, capAggr
> 0.90) banks ~$300M of carryover for two years, then spends it on the first star it can. This is the
> known ISSUE_HOARDING in scripts/offseason.ts. Cause: generated contracts in src/engine/generate.ts
> (remaining years rng.int(1,3) for most players, rng.int(2,5) for 14+) leave rosters under-committed
> and the first classes thin on quality. Fix: generate rosters paid like NFL rosters (85-100% of
> cap, ~25-30% of deals expiring a year), so year one looks like a steady-state league.
>
> B. Cap-aggressive GMs put up to 70% of a deal in the signing bonus: aiOffer in
> src/engine/offseason/ai.ts sets bonusPct = gtdPct * (0.45 + 0.4 * capAggression) with gtdPct up to
> 0.9. Real signing bonuses are 10-35% of value. CHI's QB had a $135M bonus on a $263M deal, which
> became a $59M dead charge on release. Cap the bonus share around 0.35 scaled by capAggression, and
> check restructure room still works (npm run trades, offseason).
>
> Note: the cap now draws on its own stream (seed:cap:season), so offseason numbers are comparable
> across commits. The audit seed's path contains two revenue shocks (2028, 2030); a team at 41% dead
> money in 2031 was the result. After A and B, no team should pass 30% even on that path.
>
> Rules: CLAUDE.md commands policy (npm run offseason -- 6 and npm run trades to steer, CI decides).
> Never loosen a band; the bands' comments in scripts/offseason.ts quote observed values, update the
> comments where the generation change moves a baseline, not the ranges. Bump SAVE_VERSION only if
> League's shape changes. New claude/ branch, PR, watch CI to green.

## Decisions since (project owner)

- **Save size:** to clear the offseason audit's 13,500 KB save ceiling, last season's games keep
  their box scores and scoring plays and drop the full play-by-play when a new league year opens.
  Full replays are for the season being played.
- **Process:** the work is planned with `superpowers:writing-plans` before more is built.

## What was measured (offseason audit seed, 6 seasons; trades audit, 3 leagues x 3 seasons)

| | main | WIP `761f6f2` |
|---|---|---|
| Opening payroll, % of cap (min / median) | 62 / 91 | 90 / 96 |
| 14+ veterans in their last year at generation | 0% | 17% on this seed (22-32% on three others) |
| Free agents when free agency first opens: 14+ / 13+ | 2 / 12 | 8 / 16 |
| Steady state (seasons 4-6) for comparison: 14+ / 13+ | 24-35 / 53-64 | same |
| Most cap unspent at the 2027 kickoff | 48.7% (ISSUE_HOARDING) | 17.9% |
| Worst dead money at any offseason step | 21.8% (kickoff) | 20% |
| Save size in 2031 (ceiling 13,500 KB) | 13,473 | 13,600 before the replay trim |
| Trades in season, by year of the run | 18.3 / 13.7 / 14.0 (mean 15.3) | 14.3 / 14.3 / 13.7 (mean 14.1, band 15-25) |
| Deadline star price (JJ points, band 1000-3500) | 1294 | 945 |

The trade audit's in-season volume on main passes only because the generated year one is roomy (up to
38% of the cap unspent); a settled league trades about 14 times a season, under the band's 15. PR #67
(the red-zone change) fails the same check (13.9; by year 19.7 / 10.3 / 11.7).

At 9 leagues x 3 seasons (`npm run trades -- 9`) the volume gap is no sampling accident: main trades 19.1 / 13.3 / 14.4
in season (mean 15.6), PR #67 20.0 / 13.4 / 14.9 (16.1), so a settled league is under 15 on both, and #67's 3-league
13.9 was noise. Its deadline prices are lower than main's on large samples, though (star 989 vs 1263, n 19-23;
quality starter 468 vs 535, n 125-141; rental 49 vs 64, n 47-56): that one is #67's own.

NFL reference (research workflow, mostly unverified): league-year-start median cap space about 12%;
Week 1 the five teams with the most space hold about 8-24% of the cap; carryover into 2025 averaged
4.1% of the cap (median 2.3%, most 17.9%).
