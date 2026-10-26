/** Common recruitment rule, including promotions: another club keeps its staff during the season. */
import type { League } from './types';

/** userTeamId remains the last club for legacy filters; only the persistent appointment grants authority. */
export const employed = (league: League) => league.gms[league.userGmId]?.teamId !== null;
export const managesTeam = (league: League, teamId: number) =>
  league.gms[league.userGmId]?.teamId === teamId && league.teams[teamId]?.gmId === league.userGmId;

/** During spectator simulation every franchise uses the normal AI path. The last viewed club is not a user club. */
export function withLeagueAi<T>(league: League, fn: () => T): T {
  if (employed(league)) return fn();
  const last = league.userTeamId;
  league.userTeamId = -1;
  try {
    return fn();
  } finally {
    league.userTeamId = league.gms[league.userGmId]?.teamId ?? last;
  }
}

export function recruitmentProblem(league: League, teamId: number, from: number | null): string | null {
  return (league.phase === 'regular' || league.phase === 'playoffs') && from !== null && from !== teamId
    ? 'Another team’s staff cannot be poached midseason.'
    : null;
}
