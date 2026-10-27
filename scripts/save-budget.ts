/** KB of serialized JSON, matching the offseason audit's existing size measurements.
 * Add measured allowances here when a feature deliberately persists new data. Retain the
 * component and annual-growth checks: a larger feature budget is not permission for a leak.
 */
export const BASE_SAVE_BUDGET = {
  firstSeason: 6450,
  retainedSeasons: 13500,
  games: 6500,
  annualGrowth: 1100,
};

export const SAVE_FEATURE_ALLOWANCES = {
  // Measured first-season increase ~570 KB (6,227 -> 6,797), including changed game records.
  // Two retained seasons need two game-evidence allowances; coach/advice history is bounded.
  coachQuirks: { firstSeason: 800, retainedSeasons: 1600, games: 800, annualGrowth: 100 },
  // 512 squad players (16 a club), their service records, squad deals and the personnel ledgers: first season measured
  // 8,003 KB against 7,250 (0.2.0); the retained-seasons save about 1,000 KB more than before (15,320 and 16,124 KB
  // against 15,100 over six seasons); players growth 862 KB a season against 800 (castoffs retire but, like every
  // retiree, stay in the save until retirees are pruned).
  // Games carry each club's frozen game-day list (47-48 dressed, the inactives, call-ups): 7,065-7,336 KB against main's
  // 6,673-6,892 over four worlds. Castoffs who retire add about 70 retirees a season: 281-321 against main's 173-253.
  practiceSquads: {
    firstSeason: 900,
    retainedSeasons: 1100,
    games: 300,
    annualGrowth: 0,
    playersGrowth: 80,
    retiredAdded: 40,
  },
  // Per-game advanced stats (EPA, success, explosives: TeamGameStats.adv) and the Gazette's numbers desk, on top of
  // practice squads: measured with both at 8,229 KB first season against 8,150, 16,625 KB retained against 16,200,
  // players growth 902 KB against 880 (0.2.0 merge). A modest allowance agreed by the owner, not a leak.
  analytics: { firstSeason: 300, retainedSeasons: 700, games: 0, annualGrowth: 0, playersGrowth: 40 },
  // Player origins (0.2.1): a school index on every player, `cflSeasons` on CFL arrivals, and the yearly Pathway class
  // (13) and CFL veterans (6) who join the pool. Measured on offseason-audit over six seasons against main: first season
  // 8,351 KB against 8,198, retained 12,997-16,557 KB against 12,809-16,521, players growth 923 KB against 862 in the
  // first full year (675-754 against 669-748 after). A small allowance agreed by the owner, not a leak.
  origins: { firstSeason: 200, retainedSeasons: 200, games: 0, annualGrowth: 0, playersGrowth: 60 },
};

export const SAVE_SIZE_BUDGET = Object.fromEntries(
  Object.entries(BASE_SAVE_BUDGET).map(([key, base]) => [
    key,
    base +
      Object.values(SAVE_FEATURE_ALLOWANCES).reduce(
        (sum, allowance) => sum + allowance[key as keyof typeof BASE_SAVE_BUDGET],
        0,
      ),
  ]),
) as typeof BASE_SAVE_BUDGET;
