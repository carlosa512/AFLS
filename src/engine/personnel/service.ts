import { rosterList } from '../roster';
import type { Game, GameResult, League, Player, PlayoffRound } from '../types';
import { PERSONNEL_RULES } from './rules';
import type { PlayerService, ServiceAssignment, ServiceSeason, ServiceTotals } from './types';

/** Historical experience is an estimate, never evidence that a player dressed or accrued service. */
export function initialService(experience: number, throughSeason: number): PlayerService {
  const years = Math.max(0, Math.floor(experience));
  return {
    baseline: [throughSeason, years, years, years, years > 0],
    seasons: {},
    history: [],
  };
}

export function ensureService(p: Player, season: number): PlayerService {
  return (p.service ??= initialService(p.experience, season - 1));
}

function weeks(mask: number): number {
  let count = 0;
  for (let bits = mask >>> 0; bits; bits &= bits - 1) count++;
  return count;
}

/** An observed game counts once even after a trade or a repeated settlement. No bye-week service. */
export function creditService(
  p: Player,
  season: number,
  week: number,
  status: 'active' | 'injuredReserve' | 'practiceSquad' | 'practiceSquadInjured' | 'elevated',
  dressed?: boolean,
): void {
  if (!Number.isInteger(week) || week < 1 || week > 18) throw new Error('Service needs a regular-season week.');
  const service = ensureService(p, season);
  if (season <= service.baseline[0] || historicalSummary(service, season) !== undefined) return;
  if (status === 'practiceSquad' || status === 'practiceSquadInjured') return;
  const row = (service.seasons[season] ??= [0, 0, 0, 0]);
  const bit = 1 << (week - 1);
  row[0] |= bit;
  row[2] |= bit;
  // IR earns accrued/pension service but not the minimum-salary credited season.
  if (status !== 'injuredReserve') {
    row[1] |= bit;
    if (dressed === true && row[3] !== null) row[3] |= bit;
    if (dressed === undefined) row[3] = null;
  }
}

export function serviceTotals(service: PlayerService, throughSeason = Infinity): ServiceTotals {
  const total = {
    accrued: service.baseline[1],
    salary: service.baseline[2],
    pension: service.baseline[3],
  };
  for (const [season, row] of Object.entries(service.seasons)) {
    if (Number(season) <= service.baseline[0] || Number(season) > throughSeason) continue;
    if (weeks(row[0]) >= PERSONNEL_RULES.accruedGames) total.accrued++;
    if (weeks(row[1]) >= PERSONNEL_RULES.salaryCreditedGames) total.salary++;
    if (weeks(row[2]) + weeks(row[4] ?? 0) >= PERSONNEL_RULES.pensionCreditedGames) total.pension++;
  }
  for (const [index, summary] of service.history.entries()) {
    if (summary === null || service.baseline[0] + 1 + index > throughSeason) continue;
    if (summary & 1) total.accrued++;
    if (summary & 2) total.salary++;
    if (summary & 4) total.pension++;
  }
  return total;
}

/** Undefined means the dressing list was not recorded; it must not masquerade as zero actives. */
export function activeGames(row: ServiceSeason): number | undefined {
  return row[3] === null ? undefined : weeks(row[3]);
}

export function serviceRoster(league: League, game: Game): ServiceAssignment[] {
  const out: ServiceAssignment[] = [];
  for (const p of Object.values(league.players)) {
    if (p.teamId !== game.homeId && p.teamId !== game.awayId) continue;
    const list = rosterList(p);
    const day = game.personnel?.lists?.[p.teamId!];
    const dressed = day ? day.dressedIds.includes(p.id) : undefined;
    if (list === 'active' || list === 'injuredReserve')
      out.push({ playerId: p.id, list, ...(dressed !== undefined ? { dressed } : {}) });
    else if (day?.elevatedIds.includes(p.id)) out.push({ playerId: p.id, list: 'elevated', dressed });
    else if (p.squad?.continuation && p.injury) out.push({ playerId: p.id, list: 'squadContinuation', dressed: false });
  }
  return out;
}

/** Settle membership before game injuries and the weekly IR/FA passes can change it. */
export function recordGameService(league: League, game: Game, result?: GameResult): void {
  if (game.season !== league.season) return;
  for (const { playerId, list, dressed } of game.serviceRoster ?? serviceRoster(league, game)) {
    const p = league.players[playerId];
    if (!p) continue;
    if (game.playoffRound) creditPostseasonPension(p, game.season, game.playoffRound);
    else if (list === 'squadContinuation') {
      const row = (ensureService(p, game.season).seasons[game.season] ??= [0, 0, 0, 0]);
      row[2] |= 1 << (game.week - 1);
    } else {
      const emergency = Object.values(game.personnel?.lists ?? {}).some((r) => r.emergencyQbId === playerId);
      creditService(
        p,
        game.season,
        game.week,
        list,
        emergency ? (result?.playerStats[playerId]?.snaps ?? 0) > 0 : dressed,
      );
    }
  }
  delete game.serviceRoster;
}

/** Retirement-plan service includes playoffs, unlike minimum-salary and accrued seasons. */
export function creditPostseasonPension(p: Player, season: number, round: PlayoffRound): void {
  const service = ensureService(p, season);
  if (season <= service.baseline[0] || historicalSummary(service, season) !== undefined) return;
  const row = (service.seasons[season] ??= [0, 0, 0, 0]);
  const bit = 1 << ['WC', 'DIV', 'CONF', 'FINAL'].indexOf(round);
  row[4] = (row[4] ?? 0) | bit;
}

/** Finished seasons need qualifications and active counts, not all their weekly masks.
 * Bits 0–2: earned accrued/salary/pension; 3–7: actives; 8: unknown actives; 9: incomplete history.
 */
export function archiveService(service: PlayerService, throughSeason: number): void {
  for (const [season, row] of Object.entries(service.seasons)) {
    if (Number(season) > throughSeason) continue;
    const earned =
      (weeks(row[0]) >= PERSONNEL_RULES.accruedGames ? 1 : 0) |
      (weeks(row[1]) >= PERSONNEL_RULES.salaryCreditedGames ? 2 : 0) |
      (weeks(row[2]) + weeks(row[4] ?? 0) >= PERSONNEL_RULES.pensionCreditedGames ? 4 : 0);
    const index = Number(season) - service.baseline[0] - 1;
    if (index < 0) continue;
    while (service.history.length < index) service.history.push(null);
    service.history[index] = earned | (row[3] === null ? 256 : weeks(row[3]) << 3) | (row[5] ? 512 : 0);
    delete service.seasons[Number(season)];
  }
}

export function historicalActives(service: PlayerService, season: number): number | undefined {
  const row = service.seasons[season];
  if (row) return activeGames(row);
  const summary = historicalSummary(service, season);
  return summary === undefined || (summary & 256) !== 0 ? undefined : (summary >> 3) & 31;
}

export function incompleteServiceSeason(service: PlayerService, season: number): boolean {
  return service.seasons[season]?.[5] === true || ((historicalSummary(service, season) ?? 0) & 512) !== 0;
}

function historicalSummary(service: PlayerService, season: number): number | undefined {
  return service.history[season - service.baseline[0] - 1] ?? undefined;
}
