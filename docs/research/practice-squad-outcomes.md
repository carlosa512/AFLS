# Practice squad roles and outcomes — 2026-10-25

## What the NFL evidence supports

A practice squad is a reserve workforce: injury cover, game-day elevations, special teams, familiar veterans and some young development projects. Denver describes using trusted veterans to keep younger players, while Tampa Bay's 2024 transactions show both an injury-driven receiver promotion and specialist cover. It is reasonable for a few squad members to have starter upside; treating every place as a future starter is not supported.

Sources: [Denver's roster-management explanation](https://www.denverbroncos.com/news/it-benefits-everyone-why-the-expanded-practice-squad-is-a-key-extension-of-denver-s-active-roster), [Tampa Bay's Gill/Thompson elevations and Shepard promotion](https://www.buccaneers.com/news/bucs-elevate-trenton-gill-cody-thompson-thursday-night-game), [NFL contract language and practice squad rules](https://operations.nfl.com/calendar-events/nfl-free-agency/contract-language).

## Reproducible modern sample

These are our calculations from public nflverse data, not an official NFL success-rate study. Downloaded October 25, 2026. Use completed 2022–24 seasons rather than mixing in a partial current season or the later roster-source change.

Run `python scripts/research-squads.py --data work/nfl-squads --download`. It uses only Python's standard library. Subsequent runs can omit `--download`. Inputs are [weekly rosters](https://nflreadr.nflverse.com/reference/load_rosters_weekly.html), [roster-status definitions](https://nflreadr.nflverse.com/articles/dictionary_roster_status.html), [PFR snap counts via nflverse](https://nflreadr.nflverse.com/reference/load_snap_counts.html), and the nflverse `players/players.csv` GSIS/PFR crosswalk. CSV URLs appear in the script. Research data and real names never become game rosters.

- Restrict rosters to regular-season weeks 1–18 and `DEV` status. A team-week snapshot is not a transaction log.
- Population mix uses player-weeks, so a one-week signing does not count as much as a season-long reserve. Age is measured September 1 each season. Experience is calendar NFL experience, not legally accrued seasons.
- Outcomes use unique opening-week squad players, followed across **all teams**, not a changing end-of-year denominator. Opening-week snapshots can miss a player already elevated that week.
- Join GSIS to PFR through explicit IDs only. Missing links remain in the denominator; game-usage rates are conservative lower bounds. No fuzzy or name-only matching: some players have the same name.
- **Any snaps** includes offensive, defensive or special-teams snaps, including temporary elevations. It is not a permanent 53-man signing rate.
- **Sustained offensive/defensive role** means at least eight games in one season with at least 50% of offensive or defensive snaps. This is a usage proxy, not official starts, awards or career success. It excludes pure special-teams contributions.
- A separate special-teams role proxy is eight games at 30% or more special-teams snaps. It may overlap the offensive/defensive role.

| Season | Opening-week cohort | Mapped IDs | Any snaps that year | Sustained offensive/defensive role that year | Unique PS players/team during season |
| --- | ---: | ---: | ---: | ---: | ---: |
| 2022 | 513 | 494 | 263 / 513 (51.3%) | 4 / 513 (0.8%) | 32.3 |
| 2023 | 486 | 474 | 239 / 486 (49.2%) | 3 / 486 (0.6%) | 30.3 |
| 2024 | 494 | 482 | 250 / 494 (50.6%) | 6 / 494 (1.2%) | 31.9 |

The 2022 opening-week **young cohort (0–2 years' experience)** has 348 players, 331 mapped. Through 2024, 208 (59.8%) recorded some snaps and 7 (2.0%) met the sustained offensive/defensive role definition. The rookie-only subset is 178 players, 168 mapped; 104 (58.4%) recorded some snaps and 2 (1.1%) met the sustained role definition. These are three-season observations, **not lifetime hit rates**; unmapped players and later careers can raise them.

Across the three seasons, rookies account for 27–31% of squad player-weeks, players with 4+ years' experience for 23–27%, and average age is 25.5–25.8. Kickers and punters together account for about 0.6–1.3%; OL, DL and DB groups make up much more of the workforce. The 30–32 distinct team signings per season illustrate turnover, not twice as many simultaneous squad places.

## Changes implemented in AFLS v0.1.17

Only opt-in personnel careers use this pool and squad AI. Ordinary careers retain their previous player/schedule RNG. Existing players' ratings and potential are never reduced.

- Replace equal position supply with rounded NFL player-week shares: OL 18%, WR 17%, DL 16%, DB 19%, LB 10%, RB/TE 8% each, QB 3%, K/P 1% combined. DL and DB splits are AFLS assumptions, not measured NFL position splits. These are supply weights, not forced team quotas.
- Mix rookies, prior practice reserves and veterans. Older unsigned reserves offer more immediate ability and little growth; young projects have some upside. Calendar experience does not invent accrued NFL service for a player whose past was practice-squad work.
- Newly generated unsigned young reserves usually have 0.2–2.2 points of upside. A 2.5% branch adds another 2–4 points. Veterans get 0–0.8. This preserves occasional discoveries without handing every young reserve the normal new-league player's much larger growth allowance. Drafted players, real cuts and existing squad members retain their existing potential.
- AI selection weighs its own scouted current ability 70% and ceiling 30%, adds healthy positional-cover value, and discounts repeated specialists more heavily. It never reads hidden potential for another club's decisions. No positional or veteran quotas.
- Formation budgeting allows up to six veteran minimums, so choosing experienced cover does not consume the separate injury/trade reserve. This is a contingency, not six mandatory veteran signings. New opt-in worlds reconcile their initial payroll before contracts are presented; established contracts are not rewritten.
- Active-roster contracts now include sortable, scouting-safe Ability pills.

These are distribution and decision changes, not a fixed success lottery. NFL rates guide the supply and evaluation; AFLS deliberately retains more room for enjoyable development stories.

## Playthrough method and limits

Two seeds, `ps-long-a` and `ps-long-b`, each play ten complete seasons in separate parallel processes. Baseline engine is commit `0d76f7b`; the same seeds are replayed with these changes. Run `npm run squad-careers -- --seed ps-long-a --seasons 10 --out work/squad-careers/a.json` (and seed b separately). In a restricted environment use `node --import tsx scripts/squad-careers.ts` with the same options.

The audit records squad size, true ability/potential and scouting estimates, ages/experience, cap space, roster sizes, moves, the original generated pool and each former squad player's later roles. Transactions are scanned after every calendar advance to survive the bounded transaction log. Each row includes the next offseason's moves, except the final row, which ends after that played season. Do not compare its smaller transaction count with full-year rows.

**Important limits:** AFLS's current role metric is eight regular-season **depth-chart snapshots**, including bye weeks and without a snap-share requirement. It is broader than the NFL usage definition above and must not be described as the same hit rate. Automatic temporary elevations and poaching are later implementation steps; ordinary squad players cannot play. NFL game-appearance and turnover rates cannot be matched until those steps ship. The audit runs the user club through AI offseasons; regular-season manual decisions remain manual. Two worlds are a balance check, not a population estimate.

The machine-readable study summary and results below are updated after the runs finish. High scouted ceilings in a ceiling-sorted screenshot are not a population average, nor a promise that a player reaches that ceiling.

## Completed results

All four runs completed ten seasons (40 total), with zero detected roster, eligibility, cap or payroll invariant violations. [Machine-readable summary](practice-squad-study.json) includes every annual observation and the NFL calculations.

| Metric, both seeds combined or averaged | Baseline | Updated |
| --- | ---: | ---: |
| Initial squad ability | 8.08 | 8.60 |
| Initial true ceiling | 11.24 | 9.70 |
| Initial rookies / 4+ years' experience | 100% / 0% | 40.0% / 27.1% |
| Tenth-season squad ability | 10.74 | 10.16 |
| Tenth-season true ceiling | 12.56 | 11.32 |
| Tenth-season starter ability | 13.21 | 13.03 |
| Tenth-season mean opening active roster | 53 | 53 |
| Tenth-season mean squad size | 13.56 | 13.16 |
| Tenth-season mean cap space | 3.06% | 3.14% |
| Original rookie cohort, broad chart role within three seasons | 130 / 1,024 (12.7%) | 37 / 410 (9.0%) |
| Original rookie cohort, broad chart role within ten seasons | 357 / 1,024 (34.9%) | 98 / 410 (23.9%) |
| Mean squad signings per season + following offseason | 426.1 | 418.0 |
| Mean NFL signings per season + following offseason | 298.3 | 322.0 |
| Mean successful waiver claims per season + following offseason | 164.4 | 173.3 |
| Mean trades per season + following offseason | 46.7 | 47.1 |

The initial rookie cohort changed because the updated pool contains experienced reserves; percentages use each version's own original rookie denominator. The game chart-role rates remain generous relative to the NFL snap-share proxy. This is a first balance pass, not proof that NFL career odds are reproduced. The stronger evidence is a smaller development pipeline, useful veterans, lower average ceilings and stable rosters/cap management. Squads can leave vacancies when the AI cannot afford another player while keeping its injury reserve; only initial formation is guaranteed full.

Validation: 90 targeted personnel/UI tests pass; typecheck and production build pass; two squad/payroll audits and two waiver audits pass. Browser checks cover Ability pills, light/dark/mobile, claims and conditional roster moves, promotions, cap previews and reload, with no browser errors. Remote CI has not run. No match or development formulas, test thresholds, or existing player ceilings changed.
