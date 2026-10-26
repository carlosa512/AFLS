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
  practiceSquads: { firstSeason: 900, retainedSeasons: 1100, games: 0, annualGrowth: 0, playersGrowth: 80 },
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
