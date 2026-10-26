import { capSpace, logTransaction } from '../finance/cap';
import { activeRoster, practiceSquad } from '../roster';
import { perceive } from '../scouting';
import type { Game, League, Player } from '../types';
import { STARTERS } from '../positions';
import { serviceSeasons } from './service';
import { settleSquadPayroll } from './payroll';
import { PERSONNEL_RULES } from './rules';
import type { Elevation } from './types';

const cents = (n: number) => Math.round(n * 1000) / 1000;
export const elevationRecords = (l: League): readonly Elevation[] =>
  l.personnel?.enabled && l.personnel.elevations?.season === l.season ? l.personnel.elevations.records : [];
function state(l: League) {
  if (!l.personnel?.enabled) throw new Error('Personnel transactions are not active.');
  if (l.personnel.elevations?.season !== l.season)
    l.personnel.elevations = { season: l.season, records: [], blocked: {} };
  return l.personnel.elevations;
}
export const gameElevations = (l: League, g: Game, teamId: number) =>
  elevationRecords(l).filter(
    (e) => e.gameId === g.id && e.teamId === teamId && ['planned', 'active', 'reverted'].includes(e.status),
  );
export function elevationUses(l: League, p: Player, teamId = p.teamId): number {
  return elevationRecords(l).filter(
    (e) =>
      e.playerId === p.id &&
      e.teamId === teamId &&
      ['active', 'reverted'].includes(e.status) &&
      !l.games.find((g) => g.id === e.gameId && g.season === l.season)?.playoffRound,
  ).length;
}
export function nextTeamGame(l: League, teamId: number): Game | undefined {
  return l.games
    .filter((g) => g.season === l.season && !g.result && (g.homeId === teamId || g.awayId === teamId))
    .sort((a, b) => a.week - b.week || a.id - b.id)[0];
}
/** CBA 2026–30 minimums; later years follow the cap, like practice-squad rates. */
export function elevationMinimum(l: League, p: Player): number {
  const credited = serviceSeasons(p, l.season);
  const tier = credited < 4 ? credited : credited < 7 ? 4 : 5;
  const year = Math.max(2026, Math.min(2030, l.season));
  const value = [885, 1005, 1075, 1145, 1215, 1300][tier] + (year - 2026) * 45;
  const scale = l.season > 2030 ? l.caps[l.season] / (l.caps[2030] ?? l.caps[l.season] / 1.07 ** (l.season - 2030)) : 1;
  return cents((value * scale) / 18);
}
export function elevationCost(l: League, p: Player, g: Game): number {
  return g.playoffRound ? 0 : cents(Math.max(0, elevationMinimum(l, p) - (p.squad?.agreement?.weeklyPay ?? 0)));
}
/** Regular-season charges already earned plus planned commitments; playoff call-ups cost nothing. */
export function elevationCap(l: League, teamId: number, season = l.season): number {
  if (season !== l.season) return 0;
  return cents(
    elevationRecords(l)
      .filter((e) => e.teamId === teamId && e.status !== 'cancelled' && !e.creditedToContract)
      .reduce((sum, e) => sum + e.additionalCap, 0),
  );
}
export function elevationProblem(l: League, p: Player, g: Game | undefined, filing?: Elevation): string | null {
  if (!l.personnel?.enabled) return 'Personnel transactions are not active.';
  if (!g || g.season !== l.season || !['regular', 'playoffs'].includes(l.phase))
    return 'No upcoming game for this club.';
  if (g.result || g.personnel?.lists) return 'This game’s roster is locked.';
  if (
    p.teamId === null ||
    ![g.homeId, g.awayId].includes(p.teamId) ||
    p.squad?.kind !== 'practiceSquad' ||
    !p.squad.agreement
  )
    return 'Choose a healthy player from this club’s practice squad.';
  if (p.squad.agreement.season !== l.season) return 'This squad agreement belongs to another season.';
  if (p.injury || p.retired || p.waiver) return 'The player must be medically cleared.';
  if (g.personnel?.elevationsFiled && !filing) return 'Call-ups for this game are already filed.';
  if (gameElevations(l, g, p.teamId).some((e) => e.playerId === p.id && e !== filing))
    return 'Already called up for this game.';
  if (gameElevations(l, g, p.teamId).filter((e) => e !== filing).length >= PERSONNEL_RULES.elevationsPerGame)
    return 'Only two call-ups are allowed per game.';
  if (l.personnel.elevations?.season === l.season && l.personnel.elevations.blocked[`${p.teamId}:${p.id}`])
    return 'A same-club re-sign cannot restore call-up eligibility this season. Sign him to the 53.';
  if (!g.playoffRound && elevationUses(l, p) >= PERSONNEL_RULES.regularElevations)
    return 'All three regular-season call-ups used. Sign him to the 53 to play again.';
  if (capSpace(l, p.teamId) + (filing?.additionalCap ?? 0) + 0.0001 < elevationCost(l, p, g))
    return 'Not enough cap room for this game’s extra pay.';
  return null;
}
export function planElevation(l: League, p: Player, g: Game): void {
  const issue = elevationProblem(l, p, g);
  if (issue) throw new Error(issue);
  state(l).records.push({
    playerId: p.id,
    teamId: p.teamId!,
    gameId: g.id,
    status: 'planned',
    additionalCap: elevationCost(l, p, g),
    weeklyPay: p.squad!.agreement!.weeklyPay,
  });
}
export function cancelElevation(l: League, p: Player, g: Game): void {
  const e = gameElevations(l, g, p.teamId!).find((e) => e.playerId === p.id);
  if (!e || e.status !== 'planned' || g.personnel?.elevationsFiled || g.personnel?.lists)
    throw new Error('This call-up is already filed and cannot be cancelled.');
  // No payroll or use was earned by a cancelled plan.
  e.status = 'cancelled';
}
export function markSquadDeparture(l: League, p: Player): void {
  if (!l.personnel?.enabled || p.teamId === null) return;
  if (
    elevationRecords(l).some(
      (e) => e.playerId === p.id && e.teamId === p.teamId && ['active', 'reverted'].includes(e.status),
    )
  )
    state(l).blocked[`${p.teamId}:${p.id}`] = true;
}
/** The whole live roster is frozen; filed call-ups additionally stay with their club until reversion. */
export function personnelMoveLock(l: League, p: Player): string | null {
  if (!l.personnel?.enabled) return null;
  if (
    l.games.some(
      (g) =>
        g.season === l.season &&
        !g.result &&
        g.personnel?.lists &&
        Object.values(g.personnel.lists).some(
          (r) => r.dressedIds.includes(p.id) || r.inactiveIds.includes(p.id) || r.emergencyQbId === p.id,
        ),
    )
  )
    return 'Finish the game before changing its roster.';
  if (elevationRecords(l).some((e) => e.playerId === p.id && e.status === 'active'))
    return 'This call-up stays with the club until automatic return.';
  if (elevationRecords(l).some((e) => e.playerId === p.id && e.status === 'planned'))
    return 'Cancel the planned call-up before changing this contract.';
  return null;
}
/** File a game's planned call-ups when it is prepared: each is rechecked, then becomes active or is cancelled. */
export function fileGameElevations(l: League, g: Game): void {
  for (const e of elevationRecords(l)) {
    if (e.gameId !== g.id || e.status !== 'planned') continue;
    const p = l.players[e.playerId];
    const issue = elevationProblem(l, p, g, e);
    if (issue) {
      e.status = 'cancelled';
      e.reason = issue;
      logTransaction(l, 'elevation', [e.teamId], `Call-up cancelled for ${p.firstName} ${p.lastName}: ${issue}`);
      continue;
    }
    settleSquadPayroll(l);
    e.status = 'active';
    logTransaction(
      l,
      'elevation',
      [e.teamId],
      `${l.teams[e.teamId].abbrev} called up ${p.position} ${p.firstName} ${p.lastName} for one game`,
    );
  }
}
/** Once the game is played every call-up returns to the practice squad, with no waivers. */
export function revertElevations(l: League, g: Game): void {
  for (const e of elevationRecords(l)) {
    if (e.gameId !== g.id || e.status !== 'active') continue;
    const p = l.players[e.playerId];
    e.status = 'reverted';
    logTransaction(l, 'elevation', [e.teamId], `${p.firstName} ${p.lastName} returned to the practice squad`);
  }
}
/** AI adds immediate help only; user signings/call-ups require an explicit instruction. */
export function planAIElevations(l: League, g: Game, autoUser = false): void {
  for (const teamId of [g.homeId, g.awayId]) {
    if (teamId === l.userTeamId && !autoUser) continue;
    const roster = activeRoster(l, teamId);
    const candidates = practiceSquad(l, teamId)
      .map((p) => {
        const read = perceive(l, teamId, p);
        const healthy = roster.filter((x) => x.position === p.position && !x.injury);
        const own = healthy.map((x) => perceive(l, teamId, x).ovr).sort((a, b) => b - a);
        const need = p.position === 'QB' ? 2 : STARTERS[p.position];
        const improvement = read.ovr - (own[Math.min(need - 1, own.length - 1)] ?? 0);
        return { p, score: (healthy.length < need ? 20 : 0) + improvement };
      })
      .filter(({ p, score }) => score > 0.5 && !elevationProblem(l, p, g))
      .sort((a, b) => b.score - a.score || a.p.id - b.p.id);
    const positions = new Set<string>();
    for (const { p } of candidates) {
      if (positions.has(p.position) || elevationProblem(l, p, g)) continue;
      planElevation(l, p, g);
      positions.add(p.position);
    }
  }
}
/** A same-week NFL contract already contains the game check. Move its filed extra out of the squad cap ledger. */
export function elevationPromotionCredit(l: League, p: Player, settle = false): number {
  const rows = elevationRecords(l).filter(
    (e) =>
      e.playerId === p.id &&
      e.teamId === p.teamId &&
      e.status === 'reverted' &&
      !e.creditedToContract &&
      l.games.some((g) => g.season === l.season && g.id === e.gameId && g.week === l.week && !g.playoffRound),
  );
  const credit = rows.reduce((sum, e) => sum + e.additionalCap, 0);
  if (settle) for (const e of rows) e.creditedToContract = true;
  return cents(credit);
}
