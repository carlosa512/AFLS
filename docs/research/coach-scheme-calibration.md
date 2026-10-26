# NFL reference for coaching scheme habits

Reviewed October 25, 2026. This uses completed 2024/2025 seasons and retrospective analysis, rather than mixing
partial 2026 results with complete seasons. The purpose is to inform a fictional coaching model, not to assign
real coaches hidden game ratings.

## Evidence and its limits

- [Opta Analyst, May 20, 2025](https://theanalyst.com/articles/play-callers-new-offensive-coaches-2025-nfl-season)
  compares eight offenses after Shanahan, McVay or their coaching-tree successors took over. Six improved their
  average success rate by at least 2% against their predecessors, as reported by Opta. Its multi-year comparison
  also puts Todd Monken alongside Ben Johnson near the top among non-head-coach callers. This supports a broader
  group of effective designers, with a smaller exceptional group. These observational comparisons also include
  changes in players, opponents and circumstances.
- [PFF's play-calling coordinator review, July 29, 2024](https://www.pff.com/news/nfl-ranking-top-10-offensive-coordinators-entering-2024)
  describes different strengths in Monken, Kellen Moore, Arthur Smith and other callers. It also distinguishes the
  actual play-caller from the OC job title. Those examples illustrate specific offensive strengths that need not
  coincide with overall head-coaching success. A ranking is informed evaluation, not a causal coach-only metric.
- [Jacksonville's Liam Coen biography](https://www.jaguars.com/team/coaches-roster/liam-coen) records Tampa Bay's
  2024 offense finishing in the top five in scoring, total yards, passing yards and rushing yards under Coen.
  [Green Bay's September 17, 2024 game-plan discussion](https://www.packers.com/news/inbox-the-packers-plan-wouldn-t-have-worked-without-them-sept-17-2024)
  describes adapting the offense for newly acquired backup Malik Willis. These give concrete examples beyond
  the three most famous designers; neither team's output isolates coaching from player execution.
- [PFF's June 1, 2026 review of 2023–25 concepts](https://www.pff.com/news/fantasy-football-2026-how-play-action-pre-snap-motion-and-rpo-rates-define-2026-fantasy-value)
  reports 2025 shifts/motion on 63.92% of plays and play action on 25.65%. Play-action attempts averaged 7.76 YPA
  versus 6.72 without it. These are concept usage and observed efficiency, not the fraction of coaches who are
  good schemers or a causal play-action bonus. They do establish that schematic assistance is widespread.

## Implications for AFLS

1. Ordinary offenses already receive their existing scheme and play-action effects. Shot-Play Architect adds a
   particular situational strength; it does not confer the basic ability to scheme a receiver open.
2. Roughly the upper fifth to third of a 32-offense league is a reasonable **initial design benchmark** for an
   identifiable shot-design habit. This is an inference for the game, not an NFL-measured quirk prevalence.
3. The previous 1.9% experimental setting was too restrictive. The original approximately 40% was broad enough
   to blur the distinction. Use soft formation weights and measure the resulting population, rather than
   enforcing a roster quota or assigning the tag only to a few celebrity equivalents.
4. AFLS currently has youth-development and veteran-care ratings, not a measured play-design rating. Their role
   blend can be a weak acquisition prior, but must not hard-lock access to a tactical specialty. An otherwise
   ordinary teacher can have a good scheme idea; a strong teacher need not have this particular habit.
5. Keep the two-call game budget, situational eligibility, ordinary execution contests and habit lifecycle.
   A coach with Shot-Play Architect plus other relevant habits, fitting personnel and a well-executed scheme can
   resemble an exceptional offense without treating every carrier as an elite overall coach.
6. The empirical comparison includes offensive HCs and OCs who actually call plays. AFLS retains its existing
   OC ownership of offensive calls; this reference does not silently add HC play-calling delegation.

## Implemented starting point and observed population

Shot-Play Architect gets one formation marble for role quality below 9.5, two from 9.5 to below 12, and three at
12+. Repeated relevant choices can add one more. There is no hard eligibility cutoff. Existing traits, ratings,
call scripts, grip thresholds and the per-game effect are unchanged.

Across twenty fixed seeds (`coach-rarity-0` through `coach-rarity-19`), covering 640 employed OCs:

| Group | Coaches | Active Shot-Play Architect | Share |
|---|---:|---:|---:|
| Strong role quality, 12+ | 141 | 61 | 43.3% |
| Typical role quality, 9.5–12 | 294 | 65 | 22.1% |
| Below typical role quality, under 9.5 | 205 | 10 | 4.9% |
| All | 640 | 136 | 21.25% |

That is 6.8 active carriers per league on average, ranging from four to eleven. Another 28 established habits
were dormant behind the active-habit cap; forming habits are counted separately by the audit. This variation
arises from histories and draws, rather than a forced team count. Future career progression and staff turnover
will change it.

Reproduce with `npm run coach-quirks -- --population 20`. Initial histories use final budget-fitted ratings so
generation-time salary adjustments do not accidentally supply the wrong formation weights. Former-player
inheritance remains probabilistic, and held habits still require the appropriate coaching role to affect games.
