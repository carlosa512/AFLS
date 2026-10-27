import { PERSONNEL_RULES, squadPlaces } from './rules';
import { collegeOrigin } from '../origin';
import { generatePlayer } from '../generate';
import { capSpace } from '../finance/cap';
import { inSeasonReserve } from '../offseason/ai';
import { contenderScore, resetContenderCache } from '../offseason/negotiation';
import { activeRoster, practiceSquad } from '../roster';
import { playerOvr } from '../positions';
import { recordRatings } from '../development';
import { Rng } from '../rng';
import { viewCache } from '../scouting';
import type { League, Player, Position } from '../types';
import { POSITIONS } from '../types';
import { squadCategory, squadRates } from './eligibility';
import { ensureSquads, settleSquadPayroll, squadPayWeek } from './payroll';
import { initialService } from './service';
import { acceptSquadOffer, squadOfferProblem, squadWindowProblem } from './squads';
import type { SquadOffer } from './types';

export function squadCandidates(league: League): Player[] {
  const draft = new Set(league.draftClass);
  return Object.values(league.players).filter(
    (p) => !p.retired && p.teamId === null && !p.contract && !p.waiver && !p.injury && !draft.has(p.id),
  );
}

// Rounded 2022–24 NFL practice-squad player-week shares; DL/DB split for AFLS positions.
const SUPPLY_WEIGHT: Record<Position, number> = {
  QB: 3,
  RB: 8,
  WR: 17,
  TE: 8,
  OL: 18,
  DT: 8,
  EDGE: 8,
  LB: 10,
  CB: 11,
  S: 8,
  K: 0.8,
  P: 0.2,
};

/** World supply is independent of the main RNG and never takes a player or dollar from an existing 53. */
export function ensureSquadSupply(league: League): void {
  const openings = league.teams.reduce(
    // The standard 16 only: the international place is for a Pathway player, and the Pathway class supplies those.
    (sum, t) => sum + Math.max(0, PERSONNEL_RULES.squadLimit - practiceSquad(league, t.id).length),
    0,
  );
  // Cuts and expired squad deals fill the pool first; new players cover only what's still missing, so the free-agent
  // pool doesn't grow every season (a spare 64 a round once pushed it past the offseason audit's band).
  const candidates = squadCandidates(league);
  let baseMissing = Math.max(
    0,
    Math.ceil(openings / 2) - candidates.filter((p) => squadCategory(league, p) === 'base').length,
  );
  const missing = Math.max(0, openings - candidates.length);
  const rng = new Rng(`${league.seed}:squad-pool:${league.season}:${league.nextPlayerId}`);
  for (let i = 0; i < missing || baseMissing > 0; i++) {
    const veteran = rng.chance(0.25);
    const experience = veteran ? rng.int(4, 7) : rng.chance(0.45) ? 0 : rng.int(1, 3);
    const p = generatePlayer(rng, {
      id: league.nextPlayerId++,
      position: rng.weighted(POSITIONS, (pos) => SUPPLY_WEIGHT[pos]),
      quality: veteran ? rng.float(8, 10.5) : rng.float(6.5, 10),
      age: veteran ? rng.int(27, 31) : experience === 0 ? rng.int(21, 23) : rng.int(23, 26),
      teamId: null,
      jerseysUsed: new Set(),
    });
    // Calendar experience can include prior practice-squad seasons with no accrued NFL service.
    p.experience = experience;
    p.origin = collegeOrigin(league.seed, p.id, 3);
    p.service = initialService(veteran ? experience : 0, league.season - 1);
    // Most unsigned reserves project as depth. Rare young breakouts survive; no change to drafted/cut players.
    const upside = veteran ? rng.float(0, 0.8) : rng.float(0.2, 2.2) + (rng.chance(0.025) ? rng.float(2, 4) : 0);
    p.potential = Math.min(20, playerOvr(p) + upside);
    recordRatings(p, league.season);
    p.contract = null;
    league.players[p.id] = p;
    if (!veteran) baseMissing--;
  }
}

/** Player choice, not club iteration order: money, familiarity, opportunity and contender preference. */
function preference(league: League, p: Player, offer: SquadOffer): number {
  const rate = squadRates(league, p).min;
  const depth = activeRoster(league, offer.teamId).filter((x) => x.position === p.position).length;
  const jitter = new Rng(`${league.seed}:squad-choice:${league.season}:${p.id}:${offer.teamId}`).float(0, 0.025);
  return (
    (offer.weeklyPay / rate - 1) * (0.5 + p.personality.greed) +
    (offer.formerTeam ? p.personality.loyalty * 0.18 : 0) +
    p.personality.winning * contenderScore(league, offer.teamId) * 0.08 +
    0.12 / (1 + depth) +
    jitter
  );
}

export function resolveSquadOffers(league: League): number {
  const problem = squadWindowProblem(league);
  if (problem) throw new Error(problem);
  settleSquadPayroll(league);
  // A prior waiver award may have changed the 53 without advancing the calendar cache key.
  // Rebuild at this shared decision boundary so reloading or inspecting a screen cannot change choices.
  resetContenderCache(league);
  const state = ensureSquads(league);
  const offers = [...state.offers];
  state.offers = [];
  const players = [...new Set(offers.map((o) => o.playerId))]
    .map((id) => ({ id, order: new Rng(`${league.seed}:squad-round:${league.season}:${id}`).float(0, 1) }))
    .sort((a, b) => a.order - b.order || a.id - b.id);
  let count = 0;
  for (const { id } of players) {
    const p = league.players[id];
    if (!p) continue;
    const ranked = offers
      .filter((o) => o.playerId === id)
      .map((o) => ({ offer: o, score: preference(league, p, o) }))
      .sort((a, b) => b.score - a.score || a.offer.teamId - b.offer.teamId);
    const winner = ranked.find(({ offer }) => !squadOfferProblem(league, offer));
    if (winner) {
      acceptSquadOffer(league, winner.offer);
      count++;
    }
  }
  return count;
}

/** Submit against a shared world, award, then refill. Scouts assess upside; no forced positional quotas. */
export function formPracticeSquads(league: League, autoUser = false): number {
  if (squadWindowProblem(league)) return 0;
  ensureSquadSupply(league);
  const state = ensureSquads(league);
  const returns = [...state.returns];
  state.returns = [];
  for (const offer of returns) {
    const p = league.players[offer.playerId];
    if (p?.waiver || (p?.teamId === offer.teamId && !!p.contract && !p.squad)) state.returns.push(offer);
    else if (!squadOfferProblem(league, offer)) state.offers.push(offer);
  }
  const view = viewCache(league);
  let total = 0;
  for (let round = 0; round < 32; round++) {
    const pool = squadCandidates(league);
    for (const team of [...league.teams].sort((a, b) => a.id - b.id)) {
      if (team.id === league.userTeamId && !autoUser) continue;
      const existing = practiceSquad(league, team.id);
      const open = squadPlaces(league) - existing.length;
      if (open <= 0) continue;
      const budget = capSpace(league, team.id) - inSeasonReserve(league, team.id);
      const healthy = activeRoster(league, team.id).filter((p) => !p.injury);
      const ranks = pool
        .map((p) => {
          const read = view(team.id, p);
          const coverage = existing.filter((x) => x.position === p.position).length;
          const roster = healthy.filter((x) => x.position === p.position);
          const cover = roster.length < (p.position === 'QB' ? 2 : 1) ? 1 : 0;
          const specialist = p.position === 'K' || p.position === 'P';
          return { p, score: read.ovr * 0.7 + read.potMid * 0.3 + cover - coverage * (specialist ? 4 : 0.8) };
        })
        .sort((a, b) => b.score - a.score || a.p.id - b.p.id);
      let offered = 0;
      let committed = 0;
      for (const { p } of ranks) {
        const rate = squadRates(league, p);
        const weeklyPay = rate.min; // The veteran range remains available to a specific user offer.
        const cost = weeklyPay * (19 - squadPayWeek(league));
        const offer: SquadOffer = { teamId: team.id, playerId: p.id, weeklyPay };
        if (committed + cost > budget || squadOfferProblem(league, offer)) continue;
        // One offer per open slot per round; losing clubs get another choice next round.
        state.offers.push(offer);
        committed += cost;
        offered++;
        if (offered >= open) break;
      }
    }
    const count = resolveSquadOffers(league);
    total += count;
    if (!count) break;
  }
  return total;
}
