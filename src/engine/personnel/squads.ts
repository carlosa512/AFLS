import { personnelMoveLock, markSquadDeparture, elevationPromotionCredit } from './elevations';
import { capSpace, logTransaction, paidFraction } from '../finance/cap';
import { capHit, buildContract } from '../finance/contract';
import { minSalary } from '../finance/market';
import { activeRoster, onGameRoster, practiceSquad, syncDepthChart } from '../roster';
import { STARTERS } from '../positions';
import type { Contract, League, Player } from '../types';
import type { SquadOffer } from './types';
import { squadFit, squadRates, squadCategory, squadFormationCost } from './eligibility';
import { ensureService, initialService, serviceTotals } from './service';
import { ensureSquads, promotionCredit, settleSquadPayroll, squadPayWeek, startSquadPay } from './payroll';
import { executeRosterMove, squadReturnProblem, type RosterMove } from './rosterMoves';

export function squadWindowProblem(league: League): string | null {
  if (!league.personnel?.enabled) return 'Personnel transactions are not active.';
  if (league.phase === 'regular') return null;
  if (league.phase !== 'preseason' || !league.personnel.clock?.cutdown)
    return 'Practice squad formation opens after camp cutdowns.';
  if (league.personnel.waivers?.pending.length) return 'Finish the cutdown waiver notices before forming squads.';
  return null;
}

/** Reserved before AI NFL spending, independently of the injury/trade reserve. */
export function squadReserve(league: League, teamId: number): number {
  if (!league.personnel?.enabled || ['regular', 'playoffs', 'complete'].includes(league.phase)) return 0;
  const squad = practiceSquad(league, teamId);
  const veterans = squad.filter((p) => squadCategory(league, p) === 'veteran').length;
  return squadFormationCost(league, 16 - squad.length, 6 - veterans);
}

export function squadOfferProblem(league: League, offer: SquadOffer): string | null {
  const window = squadWindowProblem(league);
  if (window) return window;
  const p = league.players[offer.playerId];
  if (!league.teams[offer.teamId]) return 'Unknown club.';
  if (!p || p.retired || p.teamId !== null || p.contract || p.waiver || league.draftClass.includes(p.id))
    return 'The player must be an unattached, cleared free agent.';
  if (p.injury) return 'The player must pass a physical before joining the squad.';
  const rate = squadRates(league, p);
  if (
    !Number.isFinite(offer.weeklyPay) ||
    Math.abs(offer.weeklyPay * 1000 - Math.round(offer.weeklyPay * 1000)) > 0.00001 ||
    offer.weeklyPay < rate.min ||
    offer.weeklyPay > rate.max
  )
    return `Weekly pay must be between $${rate.min.toFixed(3)}K and $${rate.max.toFixed(3)}K.`;
  const fit = squadFit(league, [...practiceSquad(league, offer.teamId), p]);
  if (fit) return fit;
  const payroll = league.personnel?.squads?.payroll;
  const receipt = payroll?.week === squadPayWeek(league) ? (payroll.receipts[`${offer.teamId}:${p.id}`] ?? 0) : 0;
  const cost = offer.weeklyPay * (19 - squadPayWeek(league)) - Math.min(receipt, offer.weeklyPay);
  if (capSpace(league, offer.teamId) + 0.0001 < cost) return 'Not enough cap room for the remaining squad salary.';
  return null;
}

export function submitSquadOffer(league: League, offer: SquadOffer): void {
  const problem = squadOfferProblem(league, offer);
  if (problem) throw new Error(problem);
  const state = ensureSquads(league);
  state.offers = state.offers.filter((o) => o.teamId !== offer.teamId || o.playerId !== offer.playerId);
  state.offers.push({ ...offer });
}

export function cancelSquadOffer(league: League, teamId: number, playerId: number): void {
  const state = ensureSquads(league);
  state.offers = state.offers.filter((o) => o.teamId !== teamId || o.playerId !== playerId);
  state.returns = state.returns.filter((o) => o.teamId !== teamId || o.playerId !== playerId);
}

/** An invitation only: no reserved slot, matching right, or promise of clearing waivers. */
export function inviteSquadReturn(
  league: League,
  teamId: number,
  p: Player,
  weeklyPay = squadRates(league, p).min,
): void {
  if (!league.personnel?.enabled || (p.teamId !== teamId && p.waiver?.fromTeamId !== teamId))
    throw new Error('Only your own released player can receive a return invitation.');
  const rate = squadRates(league, p);
  if (weeklyPay < rate.min || weeklyPay > rate.max || !Number.isFinite(weeklyPay))
    throw new Error('Invalid squad weekly pay.');
  const state = ensureSquads(league);
  state.returns = state.returns.filter((o) => o.teamId !== teamId || o.playerId !== p.id);
  state.returns.push({ teamId, playerId: p.id, weeklyPay, formerTeam: true });
}

export function acceptSquadOffer(league: League, offer: SquadOffer): void {
  const problem = squadOfferProblem(league, offer);
  if (problem) throw new Error(problem);
  const p = league.players[offer.playerId];
  // Settle before assigning the new employer; no old rookie contract can be revived here.
  settleSquadPayroll(league);
  p.teamId = offer.teamId;
  p.contract = null;
  delete p.ir;
  ensureService(p, league.season);
  startSquadPay(league, p, offer.weeklyPay);
  const state = ensureSquads(league);
  state.results.push({ playerId: p.id, teamId: offer.teamId, weeklyPay: offer.weeklyPay });
  state.results = state.results.slice(-128);
  state.offers = state.offers.filter((o) => o.playerId !== p.id);
  state.returns = state.returns.filter((o) => o.playerId !== p.id);
  logTransaction(
    league,
    'sign',
    [offer.teamId],
    `${league.teams[offer.teamId].abbrev} signed ${p.position} ${p.firstName} ${p.lastName} to the practice squad`,
  );
}

export function squadReleaseProblem(league: League, p: Player): string | null {
  const lock = personnelMoveLock(league, p);
  if (lock) return lock;
  if (!p.squad?.agreement || p.teamId === null) return 'Not on a practice squad contract.';
  if (p.injury) return 'An injured squad player stays paid until medically cleared.';
  return squadWindowProblem(league);
}

export function releaseSquadPlayer(league: League, p: Player): void {
  const problem = squadReleaseProblem(league, p);
  if (problem) throw new Error(problem);
  settleSquadPayroll(league);
  const id = p.teamId!;
  markSquadDeparture(league, p);
  delete p.squad;
  p.teamId = null;
  p.contract = null;
  logTransaction(
    league,
    'release',
    [id],
    `${league.teams[id].abbrev} released ${p.position} ${p.firstName} ${p.lastName} from the practice squad`,
  );
}

export function squadPromotionContract(league: League, p: Player): Contract {
  const salarySeasons = serviceTotals(
    p.service ?? initialService(p.experience, league.season - 1),
    league.season - 1,
  ).salary;
  const salary = minSalary(salarySeasons, league.caps[league.season]);
  const c = buildContract(
    { years: 1, total: salary, signingBonus: 0, guaranteedBase: 0, voidYears: 0 },
    league.season,
    'minimum',
    salary,
    league.phase === 'regular' ? league.week : 0,
  );
  const y = c.years[0];
  y.base = Math.round(y.base * (1 - paidFraction(league)));
  y.paidBefore = league.phase === 'regular' ? league.week - 1 : 0;
  // At least the current NFL check is earned, including when immediately cut again.
  y.guaranteed = Math.min(y.base, Math.ceil(Math.max(salary / 18, promotionCredit(league, p))));
  return c;
}

export function squadPromotionPreview(
  league: League,
  p: Player,
  move?: RosterMove,
): { contract: Contract; additionalCap: number; problem: string | null } {
  if (move && p.teamId !== null && p.squad?.agreement) {
    const contract = squadPromotionContract(league, p);
    const cut = league.players[move.playerId];
    const invalid =
      !['release', 'squad'].includes(move.action) ||
      !cut ||
      cut.teamId !== p.teamId ||
      !onGameRoster(cut) ||
      !cut.contract;
    if (invalid) return { contract, additionalCap: 0, problem: 'Choose a player from your main roster.' };
    const moveLock = personnelMoveLock(league, cut);
    if (moveLock) return { contract, additionalCap: 0, problem: moveLock };
    if (move.action === 'squad') {
      const issue = squadReturnProblem(league, p.teamId, cut, p.id);
      if (issue) return { contract, additionalCap: 0, problem: issue };
    }
    const before = activeRoster(league, p.teamId).filter((x) => x.position === cut.position).length;
    if (before - 1 + (p.position === cut.position ? 1 : 0) < Math.min(before, STARTERS[cut.position]))
      return {
        contract,
        additionalCap: 0,
        problem: `This move would leave too few ${cut.position} on your main roster.`,
      };
    // Exercise the existing release/waiver accounting in a disposable draft. No cuts or invitations
    // reach the real save until the complete roster and cap plan validates.
    const draft = structuredClone(league);
    executeRosterMove(draft, move);
    const next = squadPromotionPreview(draft, draft.players[p.id]);
    const additionalCap = capSpace(league, p.teamId) - (capSpace(draft, p.teamId) - next.additionalCap);
    const future = capSpace(draft, p.teamId, league.season + 1);
    return {
      contract: next.contract,
      additionalCap,
      problem: next.problem ?? (future < 0 ? 'The release would exceed next season’s cap.' : null),
    };
  }
  const contract = squadPromotionContract(league, p);
  const a = p.squad?.agreement;
  const saved = a
    ? (18 - squadPayWeek(league)) * a.weeklyPay + promotionCredit(league, p) + elevationPromotionCredit(league, p)
    : 0;
  const additionalCap = capHit(contract, league.season) - saved;
  const problem =
    !a || p.teamId === null
      ? 'Not on a practice squad contract.'
      : (personnelMoveLock(league, p) ??
        (league.phase === 'playoffs' ? null : squadWindowProblem(league)) ??
        (p.injury
          ? 'The player must be medically cleared.'
          : activeRoster(league, p.teamId).length >= 53
            ? 'Make room on the 53 before signing him.'
            : capSpace(league, p.teamId) + 0.0001 < additionalCap
              ? 'Not enough cap room for the NFL contract.'
              : null));
  return { contract, additionalCap, problem };
}

export function promoteSquadPlayer(league: League, p: Player, move?: RosterMove): void {
  const preview = squadPromotionPreview(league, p, move);
  if (preview.problem) throw new Error(preview.problem);
  if (move) executeRosterMove(league, move);
  promotionCredit(league, p, true);
  elevationPromotionCredit(league, p, true);
  markSquadDeparture(league, p);
  delete p.squad;
  p.contract = preview.contract;
  syncDepthChart(league, league.teams[p.teamId!]);
  logTransaction(
    league,
    'sign',
    [p.teamId!],
    `${league.teams[p.teamId!].abbrev} signed ${p.position} ${p.firstName} ${p.lastName} from the practice squad to a new NFL contract`,
  );
}

/** Called after the old employer's coaching/development pass; future rights are a later lifecycle step. */
export function expireSquadContracts(league: League): void {
  for (const p of Object.values(league.players)) {
    if (!p.squad) continue;
    delete p.squad;
    p.teamId = null;
    p.contract = null;
  }
}
