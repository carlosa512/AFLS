import { skill } from './attributes';
import { slotOvr } from './familiarity';
import { playerOvr, STARTERS } from './positions';
import type { DepthChart, Injury, League, Player, Position, Team } from './types';
import { POSITIONS } from './types';

export function teamPlayers(league: League, teamId: number): Player[] {
  return Object.values(league.players).filter((p) => p.teamId === teamId);
}

/** The players who count toward the 53: everyone but those on injured reserve. */
export function activeRoster(league: League, teamId: number): Player[] {
  return Object.values(league.players).filter((p) => p.teamId === teamId && !p.ir);
}

/** Playing through an injury: on injections, or back early in protective gear once his wait is over. */
export const playingHurt = (i: Injury | undefined) => !!i && (i.treatment === 'injection' || (i.treatment === 'brace' && !i.braceWait));

/** Can he play this week? Not on reserve, and healthy or playing through it. */
export const isAvailable = (p: Player) => !p.ir && (!p.injury || playingHurt(p.injury));

/** Depth chart ordered purely by overall rating at each position. */
export function buildAutoDepthChart(players: Player[]): DepthChart {
  const chart = Object.fromEntries(POSITIONS.map((pos) => [pos, [] as number[]])) as DepthChart;
  const sorted = [...players].sort((a, b) => playerOvr(b) - playerOvr(a));
  for (const p of sorted) chart[p.position].push(p.id);
  chart.OL = lineOrder(chart.OL.map((id) => players.find((p) => p.id === id)!)).map((p) => p.id);
  return chart;
}

/**
 * The five best linemen in spot order (LT, LG, C, RG, RT; see `schemes.ts`), the rest behind them as
 * depth: the best pass protectors play tackle, the line's sharpest mind snaps the ball, the guards
 * are what's left. Who starts is the overall's call; this only says where.
 */
export function lineOrder(ol: Player[]): Player[] {
  const five = ol.slice(0, 5);
  if (five.length < 5) return ol;
  const byPass = [...five].sort((a, b) => skill(b, 'passPro') - skill(a, 'passPro'));
  const [lt, rt] = byPass;
  const inside = five.filter((p) => p !== lt && p !== rt);
  const c = inside.reduce((a, b) => (skill(b, 'discipline') > skill(a, 'discipline') ? b : a));
  const [lg, rg] = inside.filter((p) => p !== c).sort((a, b) => skill(b, 'runBlocking') - skill(a, 'runBlocking'));
  return [lt, lg, c, rg, rt, ...ol.slice(5)];
}

/**
 * Make sure the depth chart only references players currently on the team and that every roster player
 * appears exactly once. An auto-sorted chart files everyone under his own position; a hand-sorted one keeps
 * a player where the user put him, even at another position (he plays there out of position, `knockFor`),
 * and adds anyone missing under his own.
 */
export function syncDepthChart(league: League, team: Team): void {
  const players = teamPlayers(league, team.id);
  if (team.autoDepth) {
    team.depthChart = buildAutoDepthChart(players);
    return;
  }
  const onTeam = new Set(players.map((p) => p.id));
  const placed = new Set<number>();
  const kept = {} as DepthChart;
  for (const pos of POSITIONS) {
    kept[pos] = (team.depthChart[pos] ?? []).filter((id) => onTeam.has(id) && !placed.has(id));
    kept[pos].forEach((id) => placed.add(id));
  }
  const auto = buildAutoDepthChart(players);
  for (const pos of POSITIONS) team.depthChart[pos] = [...kept[pos], ...auto[pos].filter((id) => !placed.has(id))];
}

/**
 * Line a player up at a position on his team's depth chart (at `index`, or last), his own or another:
 * away from his own he plays out of position and takes a knock (`knockFor`). Hand-sorts the chart.
 */
export function placeAt(league: League, playerId: number, pos: Position, index?: number): void {
  const p = league.players[playerId];
  if (p.teamId === null) throw new Error('Not on a team.');
  const team = league.teams[p.teamId];
  for (const q of POSITIONS) team.depthChart[q] = team.depthChart[q].filter((id) => id !== playerId);
  const list = team.depthChart[pos];
  list.splice(index === undefined ? list.length : Math.max(0, Math.min(index, list.length)), 0, playerId);
  team.autoDepth = false;
  syncDepthChart(league, team);
}

/** Where a player is lined up on his team's depth chart (his own position unless the user moved him). */
export function slotOf(league: League, p: Player): Position {
  if (p.teamId === null) return p.position;
  const chart = league.teams[p.teamId].depthChart;
  return POSITIONS.find((pos) => chart[pos].includes(p.id)) ?? p.position;
}

/** Starters at a position per the depth chart, skipping anyone hurt (may be fewer if the roster is short). */
export function starters(league: League, team: Team, pos: Position): Player[] {
  const out: Player[] = [];
  for (const id of team.depthChart[pos]) {
    const p = league.players[id];
    if (p && isAvailable(p)) out.push(p);
    if (out.length === STARTERS[pos]) return out;
  }
  // Nobody healthy at all: the depth chart as it stands.
  return out.length ? out : team.depthChart[pos].slice(0, STARTERS[pos]).map((id) => league.players[id]);
}

/** Team strength summary: average starter overall per unit, on the 1–20 scale. */
export function teamRatings(league: League, team: Team) {
  const avg = (positions: Position[]) => {
    // A starter lined up out of position counts at what he's worth there, knock included.
    const ps = positions.flatMap((pos) => starters(league, team, pos).map((p) => slotOvr(p, pos)));
    return ps.reduce((sum, v) => sum + v, 0) / Math.max(1, ps.length);
  };
  const qb = avg(['QB']);
  const offense = avg(['QB', 'RB', 'WR', 'TE', 'OL']);
  const defense = avg(['DT', 'EDGE', 'LB', 'CB', 'S']);
  const special = avg(['K', 'P']);
  // QB play matters most; weight it into the headline number.
  const overall = qb * 0.2 + offense * 0.35 + defense * 0.4 + special * 0.05;
  return { overall, qb, offense, defense, special };
}


export interface PlayerIdentity {
  firstName: string;
  lastName: string;
  jersey: number;
}

/** Why a name or number edit can't go through, or null. Teammates can't share a number; anyone else can. */
export function identityProblem(league: League, p: Player, edit: PlayerIdentity): string | null {
  if (!edit.firstName.trim() || !edit.lastName.trim()) return 'Both names are needed.';
  if (edit.firstName.trim().length > 24 || edit.lastName.trim().length > 24) return 'Names are 24 letters at most.';
  if (!Number.isInteger(edit.jersey) || edit.jersey < 0 || edit.jersey > 99) return 'Numbers run 0–99.';
  if (p.teamId !== null) {
    const holder = teamPlayers(league, p.teamId).find((x) => x.id !== p.id && x.jersey === edit.jersey);
    if (holder) return `#${edit.jersey} belongs to ${holder.firstName} ${holder.lastName}.`;
  }
  return null;
}

/** Renames or renumbers a player (a cosmetic edit: nothing in the sim reads names or numbers). */
export function editPlayerIdentity(league: League, playerId: number, edit: PlayerIdentity): void {
  const p = league.players[playerId];
  const problem = identityProblem(league, p, edit);
  if (problem) throw new Error(problem);
  const firstName = edit.firstName.trim();
  const lastName = edit.lastName.trim();
  if (firstName !== p.firstName || lastName !== p.lastName) p.nameEdited = true;
  p.firstName = firstName;
  p.lastName = lastName;
  p.jersey = edit.jersey;
}
