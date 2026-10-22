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

## Task 5 findings: what holds a settled league's in-season trades down

Temporary counters in the trade market, `npm run trades -- 9`, years 2-3 of the run, per league-season (main / cap branch):

- About 89 calls a season pass the activity roll on both; rolls are flat across years (main 784 / 798 / 793 over 9 leagues).
  What falls is conversion per roll: main 22% in year 1, then 15-16%.
- About 85% of rolled calls find no deal: `dealFor` is tried about 4.7 times a roll and about 3.5% of tries succeed.
- The plan's two tests both miss. Salary that won't fit even with retention is 1.4-1.9% of failed `dealFor` calls on main
  (1.3-3.5% on the cap branch), against the 40% the cap-bound branch needed. No targets or no buyers is 7-12% of rolls
  (6-10%), against the 60% the stance-bound branch needed. Sellers at week 9 are 53-60% of AI teams.
- Throttle 1, dead targets: 30-33% of `dealFor` calls go to a player whose market value is 0 or less, so the buyer's most
  is 0 and no package can be agreed, and each takes one of the three target slots a call tries. Success per live call
  is flat by year (main 5.7 / 4.9 / 5.7%); live calls fall (3056 / 2529 / 2403).
- Throttle 2, retained salary: calls that need the seller to keep salary are 10% of main's in year 1, then 31% / 40%; on
  the cap branch 42% in every year. They close at 1.8-3.2% against 3.6-5.1% without, mostly because the seller's ask with
  the retained salary is above the buyer's most. Estimated (not measured): without that penalty, +1.2-2.2 trades a
  season on main and +3.3-5.5 on the cap branch.

Decision: neither Task 6a nor 6b; reported to the project owner before writing a fix (the plan's stop).

## Results at the branch head (main merged, 0.1.3)

- Offseason audit (`npm run offseason -- 6`): 0 outside range. Most cap unspent at kickoff 19.5, 10.3, 5.8, 12.7, 5.2,
  6.3%; median 4.6, 2.5, 2.8, 2.6, 2.6, 2.1%; dead money at kickoff at most 19.3%, and at most 19% after any offseason step
  (scratch `cap-diag.ts`), under the spec's 30%. Save 6260 KB after the first season (ceiling 6300), 12900 at the end.
- Trade audit, 3 leagues (CI's run): 0 outside range; in season 15.2 a season (15.7 / 14.3 / 15.7), 32% on deadline day;
  listing draws an offer. 9 leagues: in season 15.2 (15.3 / 15.7 / 14.6), deadline quality-starter price 376 (band
  400-1300): a measurement question for the owner, below.
- The 9-league deadline quality-starter price: real (every player priced, 18 leagues: main 510, branch 391) and mostly
  NFL-right mix. Settled contract lengths put expiring market-rate veterans into the year-one sample, and they price at a
  3rd, as 2021-25 deadline deals did; the bonus cap and payroll fill lower prices a little within groups. In a settled
  season the branch reads 505 and 666 at the season-2 and season-3 deadlines. Options: split the bucket into rookie-scale
  and veteran players, or price the deadline in a settled season. Deciding fifth-year options at generation (they are all
  declined today, though the league opens after the May decision) is NFL-right but moves this price only +7 to +12 and
  adds a 3-league red (preseason star 992, n=3), so it waits for its own change.

## Parked (2026-10-22): the settled opening league, year two included

`claude/settled-opening-league` holds the work past PR #70, rebuilt on main after #70 merged. The first parked head
is kept as `claude/settled-opening-league-v1` (8ffe114).

On this branch:
- Year two committed at generation, re-signs and the rookie reserve charged at their first-year cap hits, drafts by
  board with deals on the position's clock (D1-D6), cheaper trade verdicts, the fill reserve at a veteran's minimum,
  and one kicker and one punter per AI roster (NFL 2019-2025: 0 of 224 teams opened with two of either).
- New: the re-sign window keeps room for void years about to land. The cap sheet charges only this year's slice of a
  running-out deal's void-year proration; the rest lands when free agency opens (BUF on 'offseason-tests': $8.0M,
  opening free agency $0.5M under its plan). `spendable` holds it back in the re-sign window.
- Left out on purpose: the retained-salary floor change (7419028's `judge` half, the buy-and-flip exploit; its
  `dealFor` half is on main), its softened retain test (93e07fe), and the draft-records trim (63f56d6; the save fits
  now and `PlayerCard.tsx` shows the records).

Measured on 2026-10-22 (CI's sizes):
- `npm run offseason -- 6`: 0 outside range; the short-roster warning is gone. Median kickoff space 3.7, 3.9, 3.5% over
  the last three (main 3.1, 2.7, 2.4), dead money median $3.6-8.7M (main $4.7-10.4M).
- `npm run trades`: 2 outside. In-season trades 13.8 a season (16.3, 12.3, 12.7; main 17.8) and deals voided or
  through with concerns 5.0 a season (band 1-4; main 3.0).
- Bisected over the commits: in-season trades read 15.4 after year two is committed (dumps 4.6, over the band, and one
  exploit probe worked), 15.3 after first-year cap hits (dumps 4.1), and 13.0 after the draft-board commit (years two
  and three at 11.0). Its D6 puts a new league's leftover cap on deals that run into next year: 77.6% of next year's
  cap committed at the median against a settled league's 72-76%, and finance.test's bounds were moved to fit (next
  year's median <= 0.80 from 0.76, last-year deals' payroll share >= 0.21 from 0.29). Less room next year, fewer buyers.
- The physicals number moved after the draft-board commit (3.2 there, 5.0 at the head); not yet bisected.

Ways forward (the owner parked it here):
- Tune D6 toward a settled league: part of the room back on last-year deals, about 74% of next year committed, without
  bringing back year-two hoarding (31.7% unspent when last-year deals took the raises), and restore the test bounds.
- Or make the trade market work under NFL-level commitments: sellers paid in full for salary they keep, with a
  buy-and-flip probe in `scripts/trades.ts` that fails today's exploit.
- Then: the careers check (K/P starters aged 38+ read 8.0 against 8 before; NFL about 2.6 of 64 a season) and the
  offseason audit's baseline comments.

## Picked up (2026-10-22, 0.1.7): D6 tuned, physicals and careers green, two calibrations left

- D6: `fitPayroll` pays last-year veteran deals past their market first, each up to 1.7x it and never past the
  position's top, as this year's salary only. A settled league (rev-0..3 played forward, kickoffs 2-6) pays its
  last-year deals 1.13-1.55x their market in all; the opening league now 1.19 (was 0.96). 50 seeds: next year
  committed 77.6% -> 72.6% at the median, its veterans 62.6% -> 57.2%, last-year deals 23.8% -> 29.3% of payroll.
  finance.test's bounds are back at 0.76 / 0.59 / 0.29; the last-year pay test reads the settled 1.1-1.55 (the old
  "<= 1.05, settled 0.79" did not match a settled league). No hoarding: max kickoff space in seasons 1-3 7.3-9.7%.
- Physicals: the rise came with 17b8b0b (3.2 -> 5.6 at three leagues); at nine leagues the parked head read 4.5
  (over) and this head 3.6 (in band), so it was real and the D6 tuning undid it.
- Careers: a kicker or punter aged 36+ gets a younger leg to beat in camp. K/P starters aged 38+ 8.3 -> 7.5, 0 outside.
- Fixtures: offers.test and retain.test's retained-salary cases depended on the old world (buyers' room next year, the
  case pool); adapted with their assertions kept.
- Still red at CI's sizes, both owner calls:
  - trades: in-season trades 14.8 a season (14.5 at nine leagues; by year 15.1, 14.9, 13.4). Main at nine leagues
    reads 17.8 (20.4, 16.7, 16.2), so the branch's steady state trades about two fewer a season; star trades 40 vs 64.
  - offseason: median kickoff space 4.0% in 2030 against [1, 4]; over four leagues 3.9, 3.8, 3.7. 17b8b0b's planned
    in-season reserve (3% x (1.5 - cap aggression), a median 3.1-3.6% of the cap) sits at the band's top; its own
    commit left "the band against IN_SEASON_RESERVE" to the owner.
- Resolved (owner's calls, 0.1.10):
  - Trades: between AI teams, what a seller keeps of an expiring deal counts toward the rental's worth at its floor
    share (`judge`); longer deals and anything with you stay in full (no buy-and-flip). In-season trades 15.9 at CI's
    size, 16.2 at nine leagues, 0 outside. The same share on every deal bought early dumps instead (4.1, over 1-4).
  - Kickoff room: the in-season reserve stays. After camp a team more than a point past its plan pays next year's
    salary ahead as a one-year roster bonus (`payAhead`); medians 3.0-3.8, four-league 3.2-3.4, 0 outside. Kept to half
    a point past plan, in-season trades fell to 14.4: that room is the deadline buyers'.
