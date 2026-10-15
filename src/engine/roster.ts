import { playerOvr, STARTERS } from './positions';
import type { DepthChart, League, Player, Position, Team } from './types';
import { POSITIONS } from './types';

export function teamPlayers(league: League, teamId: number): Player[] {
  return Object.values(league.players).filter((p) => p.teamId === teamId);
}

/** Depth chart ordered purely by overall rating at each position. */
export function buildAutoDepthChart(players: Player[]): DepthChart {
  const chart = Object.fromEntries(POSITIONS.map((pos) => [pos, [] as number[]])) as DepthChart;
  const sorted = [...players].sort((a, b) => playerOvr(b) - playerOvr(a));
  for (const p of sorted) chart[p.position].push(p.id);
  return chart;
}

/**
 * Make sure the depth chart only references players currently on the team and
 * that every roster player appears exactly once under their position.
 */
export function syncDepthChart(league: League, team: Team): void {
  const players = teamPlayers(league, team.id);
  if (team.autoDepth) {
    team.depthChart = buildAutoDepthChart(players);
    return;
  }
  const onTeam = new Set(players.map((p) => p.id));
  const auto = buildAutoDepthChart(players);
  for (const pos of POSITIONS) {
    const kept = (team.depthChart[pos] ?? []).filter(
      (id) => onTeam.has(id) && league.players[id].position === pos,
    );
    const missing = auto[pos].filter((id) => !kept.includes(id));
    team.depthChart[pos] = [...kept, ...missing];
  }
}

/** Starters at a position per the depth chart (may be fewer if the roster is short). */
export function starters(league: League, team: Team, pos: Position): Player[] {
  return team.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id]);
}

/** Team strength summary: average starter overall per unit, on the 1–20 scale. */
export function teamRatings(league: League, team: Team) {
  const avg = (positions: Position[]) => {
    const ps = positions.flatMap((pos) => starters(league, team, pos));
    return ps.reduce((sum, p) => sum + playerOvr(p), 0) / Math.max(1, ps.length);
  };
  const qb = avg(['QB']);
  const offense = avg(['QB', 'RB', 'WR', 'TE', 'OL']);
  const defense = avg(['DT', 'EDGE', 'LB', 'CB', 'S']);
  const special = avg(['K', 'P']);
  // QB play matters most; weight it into the headline number.
  const overall = qb * 0.2 + offense * 0.35 + defense * 0.4 + special * 0.05;
  return { overall, qb, offense, defense, special };
}

export function payroll(league: League, teamId: number): number {
  return teamPlayers(league, teamId).reduce((sum, p) => sum + p.contract.salary, 0);
}
