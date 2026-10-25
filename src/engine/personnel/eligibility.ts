import type { League, Player } from '../types';
import { initialService, historicalActives, serviceTotals } from './service';

export type SquadCategory = 'base' | 'developmental' | 'veteran';

/** Completed accrued seasons govern eligibility, not calendar experience or games in a box score. */
export function squadCategory(league: League, p: Player): SquadCategory {
  const service = p.service ?? initialService(p.experience, league.season - 1);
  const accrued = serviceTotals(service, league.season - 1).accrued;
  if (accrued === 0) return 'base';
  if (accrued === 1 && service.baseline[1] === 0) {
    // The lone accrued season must have a known dressing list. Unknown history uses an expanded slot.
    for (let year = service.baseline[0] + 1; year < league.season; year++) {
      if (serviceTotals(service, year).accrued <= serviceTotals(service, year - 1).accrued) continue;
      const actives = historicalActives(service, year);
      if (actives !== undefined && actives < 9) return 'base';
    }
  }
  return accrued <= 2 ? 'developmental' : 'veteran';
}

/** Assign base-eligible players first: flexible players never consume a scarce expanded slot. */
export function squadFit(league: League, players: readonly Player[]): string | null {
  if (players.length > 16) return 'Practice squads have at most 16 players.';
  const categories = players.map((p) => squadCategory(league, p));
  if (categories.filter((c) => c === 'veteran').length > 6)
    return 'At most six unrestricted veterans may join the practice squad.';
  if (categories.filter((c) => c !== 'base').length > 10)
    return 'At most ten expanded slots may be used, including the unrestricted veterans.';
  return null;
}

/** NFL weekly rates in $K through the CBA; later AFLS years follow the league cap. */
export function squadRates(league: League, p?: Player): { min: number; max: number } {
  const fixed = [8.4, 9.2, 11.5, 12, 12.5, 13, 13.75, 14.5, 15.25, 16, 16.75];
  const low = [12, 14, 15.4, 16.1, 16.8, 17.5, 18.35, 19.2, 20.05, 20.9, 21.75];
  const high = [12, 14, 19.9, 20.6, 21.3, 22, 22.85, 23.7, 24.55, 25.4, 26.25];
  const index = Math.max(0, Math.min(10, league.season - 2020));
  const scale =
    league.season > 2030
      ? league.caps[league.season] / (league.caps[2030] ?? league.caps[league.season] / 1.07 ** (league.season - 2030))
      : 1;
  const veteran = p && squadCategory(league, p) === 'veteran';
  const round = (n: number) => Math.round(n * scale * 1000) / 1000;
  return { min: round(veteran ? low[index] : fixed[index]), max: round(veteran ? high[index] : fixed[index]) };
}
