/** Common recruitment rule, including promotions: another club keeps its staff during the season. */
import type { League } from './types';

export function recruitmentProblem(league: League, teamId: number, from: number | null): string | null {
  return (league.phase === 'regular' || league.phase === 'playoffs') && from !== null && from !== teamId
    ? 'Another team’s staff cannot be poached midseason.'
    : null;
}
