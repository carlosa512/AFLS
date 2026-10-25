import type { Game, League } from '../types';

/** Football time, in Eastern minutes. Each management week starts Tuesday, before Thursday games. */
export const DAY = 1440;
export const WEEK = 7 * DAY;
export const DEADLINE_TIME = 16 * 60;
const GAME_DAYS = { thu: 2, sat: 4, sun: 5, mon: 6 } as const;

export function managementTime(league: League): number {
  switch (league.phase) {
    case 'resign':
      return -60 * DAY;
    case 'freeAgency':
      return (-50 + league.faDay) * DAY;
    case 'draft':
      return -30 * DAY;
    case 'preseason':
      return -21 * DAY;
    default:
      return (league.week - 1) * WEEK + DEADLINE_TIME;
  }
}

export function personnelClock(league: League) {
  if (!league.personnel) throw new Error('Personnel profile is missing.');
  if (league.personnel.clock?.season !== league.season)
    league.personnel.clock = { season: league.season, minute: managementTime(league), cutdown: false };
  return league.personnel.clock!;
}

/** Read-only queries must not mutate the save while React is rendering. */
export function personnelTime(league: League): number {
  return league.personnel?.clock?.season === league.season ? league.personnel.clock.minute : managementTime(league);
}

export function gameTime(game: Game): number {
  return (game.week - 1) * WEEK + GAME_DAYS[game.kickoff?.day ?? 'sun'] * DAY + (game.kickoff?.et ?? 13 * 60);
}

/** AFLS uses daily 4 PM notices with at least 24h exposure, compressing offseason dates into stages. */
export function waiverDeadline(now: number): number {
  return Math.ceil((now + DAY - DEADLINE_TIME) / DAY) * DAY + DEADLINE_TIME;
}

export function personnelLabel(minute: number): string {
  const week = Math.floor(minute / WEEK) + 1;
  const day = Math.floor((((minute % WEEK) + WEEK) % WEEK) / DAY);
  const at = ((minute % DAY) + DAY) % DAY;
  const h = Math.floor(at / 60);
  return `${week > 0 ? `Week ${week}` : 'Offseason'} · ${['Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun', 'Mon'][day]} ${h % 12 || 12}:${String(at % 60).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'} ET`;
}

export const TRADE_DEADLINE_MINUTE = 9 * WEEK + DEADLINE_TIME;
