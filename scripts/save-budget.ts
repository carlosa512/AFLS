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
