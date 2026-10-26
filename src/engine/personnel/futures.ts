import { activeRoster, practiceSquad } from '../roster';
import { perceive } from '../scouting';
import { Rng } from '../rng';
import type { League, Player } from '../types';
import { squadMinimumContract } from './squads';

const MAX_FUTURES = 10;

/** A club's season is over: the final is played, or it has no game left in the playoffs. */
export function futuresWindowOpen(league: League, teamId: number): boolean {
  if (!league.personnel?.enabled) return false;
  if (league.phase === 'complete') return true;
  if (league.phase !== 'playoffs') return false;
  return !league.games.some(
    (g) => g.season === league.season && !g.result && (g.homeId === teamId || g.awayId === teamId),
  );
}

const onSquad = (league: League, teamId: number, id: number) => {
  const p = league.players[id];
  return !!p && !p.retired && p.teamId === teamId && p.squad?.kind === 'practiceSquad';
};

/** The overall, by the club's own read, of the last man at a position inside its 53: the bar a keeper must reach. */
function backupBar(league: League, teamId: number, pos: Player['position']): number {
  const on = new Set(activeRoster(league, teamId).map((p) => p.id));
  const last = (league.teams[teamId].depthChart[pos] ?? []).filter((id) => on.has(id)).at(-1);
  return last === undefined ? 0 : perceive(league, teamId, league.players[last]).ovr;
}

/** Who the club's scouts would keep: estimated ceiling at least its backup level there, best first, at most ten. */
export function futuresPicks(league: League, teamId: number): number[] {
  return practiceSquad(league, teamId)
    .filter((p) => p.squad?.kind === 'practiceSquad')
    .map((p) => ({ p, pot: perceive(league, teamId, p).potMid }))
    .filter(({ p, pot }) => pot >= backupBar(league, teamId, p.position))
    .sort((a, b) => b.pot - a.pot || a.p.id - b.p.id)
    .slice(0, MAX_FUTURES)
    .map(({ p }) => p.id);
}

function state(league: League, season: number) {
  const s = league.personnel!.futures;
  return s?.season === season ? s : undefined;
}

/** Explicit choices if the club made any; otherwise its staff's picks (none for you when you run the squad). */
function keptFor(league: League, teamId: number, season: number): number[] {
  const marks = state(league, season)?.kept[teamId];
  if (marks) return marks.filter((id) => onSquad(league, teamId, id));
  if (teamId === league.userTeamId && league.teams[teamId].autoSquad === false) return [];
  return futuresPicks(league, teamId);
}

export const futuresKept = (league: League, teamId: number): number[] => keptFor(league, teamId, league.season);

export function setFuturesKeep(league: League, teamId: number, playerId: number, on: boolean): void {
  if (!futuresWindowOpen(league, teamId)) throw new Error('Futures deals open when your season is over.');
  if (!onSquad(league, teamId, playerId)) throw new Error('Only your own practice squad players can be kept.');
  const current = keptFor(league, teamId, league.season).filter((id) => id !== playerId);
  if (on && current.length >= MAX_FUTURES) throw new Error('At most ten players can be kept on futures deals.');
  if (league.personnel!.futures?.season !== league.season)
    league.personnel!.futures = { season: league.season, kept: {} };
  league.personnel!.futures!.kept[teamId] = on ? [...current, playerId] : current;
}

/**
 * Before the new league year ages anyone: a club without explicit choices keeps the picks its staff show now (the
 * list the director's mail and the squad desk promise), not a list recomputed after aging and retirements.
 */
export function freezeFuturesPicks(league: League): void {
  if (!league.personnel?.enabled) return;
  if (league.personnel.futures?.season !== league.season)
    league.personnel.futures = { season: league.season, kept: {} };
  const kept = league.personnel.futures!.kept;
  for (const team of league.teams) kept[team.id] ??= keptFor(league, team.id, league.season);
}

/**
 * At the new league year (the season has already turned): kept players still on their squad sign a minimum
 * one-year deal for this season and join the offseason roster. Called before the remaining agreements expire.
 */
export function signFuturesDeals(league: League): void {
  if (!league.personnel?.enabled) return;
  const last = league.season - 1;
  const signed: Record<number, number[]> = {};
  const kept = new Set<number>();
  for (const team of league.teams) {
    for (const id of keptFor(league, team.id, last)) {
      const p = league.players[id];
      // A whole new season: never prorated (beginOffseason still reads last season as fully paid here).
      p.contract = squadMinimumContract(league, p, 1, false);
      delete p.squad;
      (signed[team.id] ??= []).push(id);
      kept.add(id);
    }
  }
  const released = Object.values(league.players)
    .filter((p) => p.squad && !p.retired && !kept.has(p.id))
    .map((p) => p.id);
  league.personnel.futures = { season: last, kept: league.personnel.futures?.kept ?? {}, signed, released };
}

/**
 * How likely a squad castoff nobody signed by the end of camp leaves football: likely for a low ceiling, unlikely
 * for a real prospect, a bit likelier past 28, never certain and never zero. The engine's call, on true ratings.
 */
export function castoffRetireChance(p: Pick<Player, 'potential' | 'age'>): number {
  const base =
    p.potential < 7 ? 0.88 : p.potential < 8.5 ? 0.66 : p.potential < 10 ? 0.4 : p.potential < 12 ? 0.16 : 0.05;
  return Math.min(0.92, Math.max(0.03, base + (p.age >= 29 ? 0.15 : 0)));
}

/** End of camp: last year's unkept squad players still unsigned roll once, on their own stream, to leave football. */
export function retireCastoffs(league: League): void {
  const f = league.personnel?.futures;
  if (!league.personnel?.enabled || !f?.released?.length) return;
  for (const id of f.released) {
    const p = league.players[id];
    if (!p || p.retired || p.teamId !== null || p.contract || p.squad || p.waiver) continue;
    if (!new Rng(`${league.seed}:castoff:${league.season}:${id}`).chance(castoffRetireChance(p))) continue;
    p.retired = true;
    // As any retirement: the record stays, what only a developing player needs goes.
    delete p.quirkBag;
    delete p.learning;
    delete p.dev;
    delete p.ratingHistory;
  }
  f.released = [];
}
