import type { Game, League } from '../types';

const DAY = 1440;
const GAME_DAYS = { thu: 2, sat: 4, sun: 5, mon: 6 } as const;

/** Kickoff order within a season, in Eastern minutes from the Tuesday of week 1. Ordering only: no deadlines. */
export function gameTime(game: Game): number {
  return (game.week - 1) * 7 * DAY + GAME_DAYS[game.kickoff?.day ?? 'sun'] * DAY + (game.kickoff?.et ?? 13 * 60);
}

/** The personnel calendar: whether camp has reached cutdowns, and the last week whose business settled. */
export function personnelClock(league: League) {
  if (!league.personnel) throw new Error('Personnel profile is missing.');
  if (league.personnel.clock?.season !== league.season)
    league.personnel.clock = { season: league.season, cutdown: false };
  return league.personnel.clock!;
}
