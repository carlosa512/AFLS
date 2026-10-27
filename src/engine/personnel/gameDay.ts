import { buildAutoDepthChart, activeRoster, playingHurt } from '../roster';
import { teamCoaches } from '../coaching';
import { STARTERS } from '../positions';
import { perceive } from '../scouting';
import type { Game, League, Player, Team } from '../types';
import { POSITIONS } from '../types';
import { logTransaction } from '../finance/cap';
import { gameElevations } from './elevations';
import type { GameDayList, GameDayPlan } from './types';

export function gameDayPool(l: League, g: Game, teamId: number): Player[] {
  return [
    ...activeRoster(l, teamId),
    ...gameElevations(l, g, teamId)
      .map((e) => l.players[e.playerId])
      .filter((p) => p?.teamId === teamId && p.squad?.kind === 'practiceSquad'),
  ];
}
const healthy = (p: Player) => !p.injury || playingHurt(p.injury);
export const dressingLimit = (l: League, ids: readonly number[]) =>
  ids.filter((id) => l.players[id]?.position === 'OL').length >= 8 ? 48 : 47;

/** Pure recommendation. Charts determine starters; remaining places favor useful depth. */
export function recommendedGameDay(l: League, g: Game, teamId: number): GameDayList {
  const team = l.teams[teamId];
  const pool = gameDayPool(l, g, teamId).filter((p) => healthy(p) && !p.retired);
  const ids = new Set(pool.map((p) => p.id));
  const chart = buildAutoDepthChart(
    pool,
    team.playingAt,
    teamCoaches(l, teamId),
    new Set(gameElevations(l, g, teamId).map((e) => e.playerId)),
  );
  const order = (pos: (typeof POSITIONS)[number]) => [
    ...new Set([...(team.autoDepth ? chart[pos] : team.depthChart[pos]).filter((id) => ids.has(id)), ...chart[pos]]),
  ];
  const selected = new Set<number>();
  for (const pos of POSITIONS) for (const id of order(pos).slice(0, pos === 'QB' ? 2 : STARTERS[pos])) selected.add(id);
  // Eight actual OL unlock the extra place; a converted TE is not an eighth qualifying lineman.
  for (const p of pool
    .filter((p) => p.position === 'OL')
    .sort((a, b) => perceive(l, teamId, b).ovr - perceive(l, teamId, a).ovr)
    .slice(0, 8))
    selected.add(p.id);
  const qb = order('QB');
  const emergencyQbId = qb.slice(2).find((id) => !l.players[id].squad && l.players[id].position === 'QB');
  const rest = pool
    .filter((p) => p.position !== 'QB' && !selected.has(p.id))
    .sort((a, b) => perceive(l, teamId, b).ovr - perceive(l, teamId, a).ovr || a.id - b.id);
  const limit = dressingLimit(l, [...selected]);
  for (const p of rest) if (selected.size < limit) selected.add(p.id);
  const dressedIds = [...selected];
  const all = gameDayPool(l, g, teamId);
  return {
    teamId,
    dressedIds,
    inactiveIds: all.filter((p) => !selected.has(p.id)).map((p) => p.id),
    elevatedIds: gameElevations(l, g, teamId).map((e) => e.playerId),
    // Counted the way `gameDayProblem` counts: a QB dressed at another spot (a staff "Play at…") is still a third QB.
    ...(emergencyQbId !== undefined && dressedIds.filter((id) => l.players[id].position === 'QB').length === 2
      ? { emergencyQbId }
      : {}),
  };
}
export function gameDayPreview(l: League, g: Game, teamId: number): GameDayList {
  const locked = g.personnel?.lists?.[teamId];
  if (locked) return locked;
  const plan = g.personnel?.plans[teamId];
  if (!plan) return recommendedGameDay(l, g, teamId);
  const recommended = recommendedGameDay(l, g, teamId);
  const dressedIds = plan.dressedIds ?? recommended.dressedIds;
  const pool = gameDayPool(l, g, teamId);
  return {
    teamId,
    dressedIds: [...dressedIds],
    inactiveIds: pool.filter((p) => !dressedIds.includes(p.id)).map((p) => p.id),
    elevatedIds: gameElevations(l, g, teamId).map((e) => e.playerId),
    ...(plan.emergencyQbId !== undefined ? { emergencyQbId: plan.emergencyQbId } : {}),
  };
}
export function gameDayProblem(l: League, g: Game, teamId: number, plan = gameDayPreview(l, g, teamId)): string | null {
  if (![g.homeId, g.awayId].includes(teamId)) return 'This club is not in the game.';
  if (activeRoster(l, teamId).length > 53) return 'Cut down to 53 before kickoff.';
  const pool = gameDayPool(l, g, teamId);
  if (pool.length > 55 || plan.elevatedIds.length > 2) return 'Only two call-ups can expand the roster to 55.';
  if (new Set(plan.dressedIds).size !== plan.dressedIds.length)
    return 'A player can only appear once on the active list.';
  if (plan.dressedIds.some((id) => !pool.some((p) => p.id === id && (g.personnel?.lists || healthy(p)) && !p.retired)))
    return 'A selected player is unavailable. Let staff choose or update the active list.';
  const minimum = Math.min(26, pool.filter((p) => healthy(p) && !p.retired).length);
  if (plan.dressedIds.length < minimum) return `Keep at least ${minimum} available players ready.`;
  const limit = dressingLimit(l, plan.dressedIds);
  if (plan.dressedIds.length > limit)
    return limit === 47
      ? 'Dress at most 47 players, or include eight offensive linemen for 48.'
      : 'Dress at most 48 players.';
  if (plan.emergencyQbId !== undefined) {
    const p = l.players[plan.emergencyQbId];
    const qbs = plan.dressedIds.filter((id) => l.players[id]?.position === 'QB');
    if (
      !p ||
      !pool.includes(p) ||
      p.squad ||
      p.position !== 'QB' ||
      (!g.personnel?.lists && !healthy(p)) ||
      plan.dressedIds.includes(p.id) ||
      qbs.length !== 2
    )
      return 'The emergency quarterback must be a healthy QB on the 53, outside the active list, with two QBs active.';
  }
  return null;
}
export function gameDayEditProblem(l: League, g: Game): string | null {
  if (!l.personnel?.enabled) return 'Personnel transactions are not active.';
  if (g.result || g.personnel?.lists) return 'The game-day list is locked.';
  return null;
}
export function setGameDayPlan(l: League, g: Game, teamId: number, plan: GameDayPlan): void {
  const issue = gameDayEditProblem(l, g);
  if (issue) throw new Error(issue);
  if (![g.homeId, g.awayId].includes(teamId)) throw new Error('This club is not in the game.');
  // A partial list is allowed while planning, but each submitted selection must itself be legal.
  const before = g.personnel;
  const draft = {
    ...g,
    personnel: {
      ...before,
      plans: {
        ...before?.plans,
        [teamId]: { ...plan, dressedIds: plan.dressedIds ? [...plan.dressedIds] : undefined },
      },
    },
  };
  const invalid = gameDayProblem(l, draft, teamId);
  if (invalid) throw new Error(invalid);
  g.personnel = draft.personnel;
}
export function autoGameDay(l: League, g: Game, teamId: number): void {
  const issue = gameDayEditProblem(l, g);
  if (issue) throw new Error(issue);
  if (g.personnel) delete g.personnel.plans[teamId];
}
export function lockGameDayLists(l: League, g: Game): void {
  if (g.personnel?.lists) return;
  const lists: Record<number, GameDayList> = {};
  for (const id of [g.homeId, g.awayId]) {
    let list = gameDayPreview(l, g, id);
    let issue = gameDayProblem(l, g, id, list);
    // Availability can change after the user saved a list. Dressing adjustments never sign or cut anyone.
    if (issue && g.personnel?.plans[id]) {
      list = recommendedGameDay(l, g, id);
      issue = gameDayProblem(l, g, id, list);
      if (!issue)
        logTransaction(
          l,
          'elevation',
          [id],
          `${l.teams[id].abbrev} updated its active list after player availability changed`,
        );
    }
    if (issue) throw new Error(`${l.teams[id].abbrev}: ${issue}`);
    lists[id] = list;
  }
  (g.personnel ??= { plans: {} }).lists = lists;
}
/** Match-only charts include call-ups without ever adding them to the permanent 53 or saved chart. */
export function gameDayTeam(l: League, g: Game, team: Team): Team {
  const list = g.personnel?.lists?.[team.id];
  if (!list) return team;
  const selected = new Set(list.dressedIds);
  if (list.emergencyQbId !== undefined) selected.add(list.emergencyQbId);
  const pool = [...selected].map((id) => l.players[id]).filter(Boolean);
  const elevated = new Set(list.elevatedIds);
  const auto = buildAutoDepthChart(pool, team.playingAt, teamCoaches(l, team.id), elevated);
  const depthChart = team.autoDepth
    ? auto
    : (Object.fromEntries(
        POSITIONS.map((pos) => [
          pos,
          [...new Set([...team.depthChart[pos].filter((id) => selected.has(id)), ...auto[pos]])],
        ]),
      ) as Team['depthChart']);
  return { ...team, depthChart };
}
