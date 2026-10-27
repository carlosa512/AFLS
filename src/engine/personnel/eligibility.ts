import type { League, Player } from '../types';
import { isPathway } from '../offseason/arrivals';
import { hasInternationalPlace } from './rules';
import { serviceSeasons } from './service';

export type SquadCategory = 'base' | 'developmental' | 'veteran';

/** Completed seasons of service govern eligibility, not calendar experience or games in a box score. */
export function squadCategory(league: League, p: Player): SquadCategory {
  const seasons = serviceSeasons(p, league.season);
  return seasons === 0 ? 'base' : seasons <= 2 ? 'developmental' : 'veteran';
}

/** Assign base-eligible players first: flexible players never consume a scarce expanded slot. */
export function squadFit(league: League, all: readonly Player[]): string | null {
  // On v2 one Pathway player with no service may sit in the reserved place, outside the 16.
  const reserved = hasInternationalPlace(league)
    ? all.find((p) => isPathway(p) && squadCategory(league, p) === 'base')
    : undefined;
  const players = reserved ? all.filter((p) => p !== reserved) : all;
  if (players.length > 16)
    return reserved || !hasInternationalPlace(league)
      ? 'Practice squads have at most 16 players.'
      : 'Practice squads have at most 16 players, plus one International Pathway player.';
  const categories = players.map((p) => squadCategory(league, p));
  if (categories.filter((c) => c === 'veteran').length > 6)
    return 'At most six unrestricted veterans may join the practice squad.';
  if (categories.filter((c) => c !== 'base').length > 10)
    return 'At most ten expanded slots may be used, including the unrestricted veterans.';
  return null;
}

/** NFL weekly rates in $K through the CBA; later AFLS years follow the league cap. */
export function squadRates(league: League, p?: Player): { min: number; max: number } {
  return categoryRates(league, !!p && squadCategory(league, p) === 'veteran');
}

function categoryRates(league: League, veteran: boolean): { min: number; max: number } {
  const fixed = [8.4, 9.2, 11.5, 12, 12.5, 13, 13.75, 14.5, 15.25, 16, 16.75];
  const low = [12, 14, 15.4, 16.1, 16.8, 17.5, 18.35, 19.2, 20.05, 20.9, 21.75];
  const high = [12, 14, 19.9, 20.6, 21.3, 22, 22.85, 23.7, 24.55, 25.4, 26.25];
  const index = Math.max(0, Math.min(10, league.season - 2020));
  const scale =
    league.season > 2030
      ? league.caps[league.season] / (league.caps[2030] ?? league.caps[league.season] / 1.07 ** (league.season - 2030))
      : 1;
  const round = (n: number) => Math.round(n * scale * 1000) / 1000;
  return { min: round(veteran ? low[index] : fixed[index]), max: round(veteran ? high[index] : fixed[index]) };
}

/** Budget room for useful veterans as well as projects; six veteran minimums are a contingency, never a quota. */
export function squadFormationCost(league: League, slots = 16, veterans = 6): number {
  const base = categoryRates(league, false).min;
  const extra = categoryRates(league, true).min - base;
  return 18 * (Math.max(0, slots) * base + Math.max(0, Math.min(slots, veterans)) * extra);
}
