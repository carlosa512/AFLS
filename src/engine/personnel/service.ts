import { rosterList } from '../roster';
import type { Game, League, Player } from '../types';
import { PERSONNEL_RULES } from './rules';
import type { PlayerService, ServiceAssignment } from './types';

/** Calendar experience seeds the count; nothing before `throughSeason` is ever credited again. */
export function initialService(experience: number, throughSeason: number): PlayerService {
  return [throughSeason, Math.max(0, Math.floor(experience)), 0];
}

export function ensureService(p: Player, season: number): PlayerService {
  return (p.service ??= initialService(p.experience, season - 1));
}

function weeks(mask: number): number {
  let count = 0;
  for (let bits = mask >>> 0; bits; bits &= bits - 1) count++;
  return count;
}

/** A week counts once, even after a trade or a repeated settlement. No bye-week or squad service. */
export function creditService(p: Player, season: number, week: number): void {
  if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error('Service needs a regular-season week.');
  const service = ensureService(p, season);
  if (season <= service[0]) return;
  // A season skipped while out of the league rolls first, so the mask always belongs to `through + 1`.
  if (season > service[0] + 1) rollService(p, season - 1);
  service[2] |= 1 << (week - 1);
}

/** Completed seasons before `season`: the season in progress never counts. */
export function serviceSeasons(p: Player, season: number): number {
  const [through, seasons, mask] = p.service ?? initialService(p.experience, season - 1);
  return seasons + (through + 1 < season && weeks(mask) >= PERSONNEL_RULES.accruedGames ? 1 : 0);
}

/** Close every season through `season` into the count. Safe to call twice. */
export function rollService(p: Player, season: number): void {
  const service = ensureService(p, season + 1);
  if (season <= service[0]) return;
  service[1] = serviceSeasons(p, season + 1);
  service[0] = season;
  service[2] = 0;
}

export function serviceRoster(league: League, game: Game): ServiceAssignment[] {
  const out: ServiceAssignment[] = [];
  for (const p of Object.values(league.players)) {
    if (p.teamId !== game.homeId && p.teamId !== game.awayId) continue;
    const list = rosterList(p);
    if (list === 'active' || list === 'injuredReserve') out.push({ playerId: p.id, list });
    else if (game.personnel?.lists?.[p.teamId!]?.elevatedIds.includes(p.id))
      out.push({ playerId: p.id, list: 'elevated' });
  }
  return out;
}

/** Settle membership before game injuries and the weekly IR/FA passes can change it. Playoffs credit nothing. */
export function recordGameService(league: League, game: Game): void {
  if (game.season === league.season && !game.playoffRound)
    for (const { playerId } of game.serviceRoster ?? serviceRoster(league, game)) {
      const p = league.players[playerId];
      if (p) creditService(p, game.season, game.week);
    }
  delete game.serviceRoster;
}
