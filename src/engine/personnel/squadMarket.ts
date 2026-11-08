import { PERSONNEL_RULES, squadPlaces } from './rules';
import { collegeOrigin } from '../origin';
import { generatePlayer } from '../generate';
import { favoriteJersey } from '../jerseys';
import { capSpace } from '../finance/cap';
import { inSeasonReserve } from '../offseason/ai';
import { contenderScore, resetContenderCache, takesMinimum } from '../offseason/negotiation';
import { activeRoster, addPlayer, practiceSquad } from '../roster';
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
  // The standard 16 only: the international place is for a Pathway player, and the Pathway class supplies those. Only the
  // places a club can pay for: squads run short on money, not players, and a man made for a place nobody can fund sits in
  // the pool for years (counting willing men only, the supply made a hundred a year more than it had and the free-agent
  // pool passed its band).
  const check = squadRates(league).min * (19 - squadPayWeek(league));
  const openings = league.teams.reduce((sum, t) => {
    const open = Math.max(0, PERSONNEL_RULES.squadLimit - practiceSquad(league, t.id).length);
    const funded = Math.max(0, Math.floor((capSpace(league, t.id) - inSeasonReserve(league, t.id)) / check));
    return sum + Math.min(open, funded);
  }, 0);
  // Cuts and expired squad deals fill the pool first; new players cover only what's still missing, so the free-agent
  // pool doesn't grow every season (a spare 64 a round once pushed it past the offseason audit's band). A free agent
  // holding out for an NFL contract fills no place, so he doesn't count (a fringe one takes the first club asked).
  const willing = (p: Player) => league.teams.some((t) => takesMinimum(league, p, t.id));
  const candidates = squadCandidates(league).filter(willing);
  let baseMissing = Math.max(
    0,
    Math.ceil(openings / 2) - candidates.filter((p) => squadCategory(league, p) === 'base').length,
  );
  let missing = Math.max(0, openings - candidates.length);
  const rng = new Rng(`${league.seed}:squad-pool:${league.season}:${league.nextPlayerId}`);
  // A new man the market already values above the minimum is a free agent like any other, not squad supply: the
  // places still need one who'd sign (the guard: a market that priced every new man above it can't spin forever).
  for (let guard = 0; (missing > 0 || baseMissing > 0) && guard < 2 * openings + 64; guard++) {
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
    p.jersey = favoriteJersey(league.seed, p);
    p.service = initialService(veteran ? experience : 0, league.season - 1);
    // Most unsigned reserves project as depth. Rare young breakouts survive; no change to drafted/cut players.
    const upside = veteran ? rng.float(0, 0.8) : rng.float(0.2, 2.2) + (rng.chance(0.025) ? rng.float(2, 4) : 0);
    p.potential = Math.min(20, playerOvr(p) + upside);
    recordRatings(p, league.season);
    p.contract = null;
    // A new man the market values above the minimum would sit unsigned in the pool for years (it grew past 650 by year
    // five): he's never added. The supply's own stream drew him, so nothing else in the world moves.
    if (!willing(p)) continue;
    addPlayer(league, p);
    missing--;
    if (!veteran) baseMissing--;
  }
}

/**
 * Healthy free-agent specialists kept in circulation once squads have formed: the NFL always has street kickers and
 * punters on a tryout list, and a club whose kicker goes down signs one that week. Squads stash about a third of the
 * league's spares (a 2030 save: 10 kickers and 11 punters on squads, 2 and 4 left unsigned), and the supply's weights
 * almost never make a new one.
 */
export const SPECIALIST_FLOOR = { K: 6, P: 4 } as const;

/** Tops free agency up to `SPECIALIST_FLOOR` with street specialists, on its own stream: nothing else in the world moves. */
export function ensureSpecialistSupply(league: League): void {
  const rng = new Rng(`${league.seed}:specialist-pool:${league.season}:${league.week}:${league.nextPlayerId}`);
  for (const position of ['K', 'P'] as const) {
    const have = squadCandidates(league).filter((p) => p.position === position).length;
    for (let i = have; i < SPECIALIST_FLOOR[position]; i++) {
      const experience = rng.int(0, 4);
      const p = generatePlayer(rng, {
        id: league.nextPlayerId++,
        position,
        // A spare leg: below most starters, good enough to kick for a few weeks.
        quality: rng.float(7, 10),
        age: rng.int(23, 30),
        teamId: null,
        jerseysUsed: new Set(),
      });
      p.experience = experience;
      p.origin = collegeOrigin(league.seed, p.id, 3);
      p.jersey = favoriteJersey(league.seed, p);
      p.service = initialService(experience, league.season - 1);
      p.potential = Math.min(20, playerOvr(p) + rng.float(0, 1));
      recordRatings(p, league.season);
      p.contract = null;
      addPlayer(league, p);
    }
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
  // What the squads left: free agency keeps its street kickers and punters.
  ensureSpecialistSupply(league);
  return total;
}
