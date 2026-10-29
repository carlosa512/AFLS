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
  // Mentoring (0.2.16): each mentored player's trait shifts beside his traits, who mentored him (for his card) and the
  // pair's week count, about 63 KB of player fields a season (shifts 29, mentoredBy 25, mentor and mentorWeeks 9). Measured
  // on offseason-audit after trimming (this year's shifts kept for your own players only, retirees dropping theirs):
  // players growth 1,020 KB against 980 in the first year, 17,151 KB retained against 17,100. Agreed by the owner.
  mentoring: { firstSeason: 0, retainedSeasons: 150, games: 0, annualGrowth: 0, playersGrowth: 70 },
  // Relationships (0.2.17): how a player left his last three clubs (`left`, for grudges and homecomings) and his
  // friendships and feuds (`ties`, three at most). Measured on offseason-audit after six seasons: 58 KB and 24 KB of
  // player fields; the retained save 17,279 KB against 17,250. Agreed by the owner.
  relationships: { firstSeason: 0, retainedSeasons: 100, games: 0, annualGrowth: 0, playersGrowth: 0 },
  // Coaching trees (0.2.18): founding coaches' pre-league staffs (`pastUnder`); trees themselves are read off careers,
  // never stored. Trees move who coaches where, and so the whole world: measured on offseason-audit, players growth
  // 1,051-1,067 KB against main's 1,037 (more retirees kept, until retirees are pruned) and the retained save 17,352 KB
  // against 17,350, with retirees now dropping their tag count. Agreed by the owner.
  coachingTrees: { firstSeason: 0, retainedSeasons: 150, games: 0, annualGrowth: 0, playersGrowth: 50 },
  // Morale talks (0.2.22, G3): each player's talk record (`Morale.talk`: an open ask, his last answer, an open promise,
  // what he remembers), league-wide since AI clubs answer their own. G1's moods (0.2.21) fit inside the budget without
  // an allowance. Measured on offseason-audit against main over six seasons: +56 KB first season (8,629 against
  // 8,573), retained +71 to +90 KB (17,571 against 17,481 at the sixth), players growth +14 KB at most (1,110 against
  // 1,096). Each rounded up to the next 10 KB, plus 10. Agreed by the owner (Oct 29: allow it as measured, trim later
  // if needed).
  moraleTalks: { firstSeason: 70, retainedSeasons: 100, games: 0, annualGrowth: 0, playersGrowth: 30 },
  // Moods that matter (0.2.24, G2): each young player's growth tilt (`DevYear.mood`, four places) while his year lands,
  // and growth years kept open until no tilt could still move them. Measured on offseason-audit after trimming (a
  // growth year closes early again once nothing it could still land would change: 1,188 -> 1,139 KB players growth):
  // players growth 1,139 KB against 1,130, growth 1,201 KB against 1,200 in the second year, the retained save
  // 17,620 KB against 17,600 at the sixth. Each rounded up to the next 10 KB, plus 10, as the spec allows (an
  // allowance as measured when the budget needs it).
  moraleEffects: { firstSeason: 0, retainedSeasons: 30, games: 0, annualGrowth: 20, playersGrowth: 20 },
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
