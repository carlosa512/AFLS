import { capSpace, logTransaction } from '../finance/cap';
import { capHit } from '../finance/contract';
import { minSalary } from '../finance/market';
import { freeJersey } from '../generate';
import { inSeasonReserve } from '../offseason/ai';
import { freeAgents } from '../offseason/negotiation';
import { STARTERS } from '../positions';
import { activeRoster, isAvailable, practiceSquad, syncDepthChart, teamPlayers } from '../roster';
import { perceive } from '../scouting';
import type { Contract, League, Player, Position } from '../types';
import { POSITIONS } from '../types';
import {
  cancelPlannedElevations,
  elevationRecords,
  markSquadDeparture,
  nextTeamGame,
  personnelMoveLock,
} from './elevations';
import { invalidateSquadPayroll, settleSquadPayroll } from './payroll';
import { serviceSeasons } from './service';
import { squadMinimumContract } from './squads';
import type { PersonnelState, PoachOffer, PoachResult } from './types';
import { waiverOrder } from './waivers';

const PROTECTIONS = 2;

export function ensurePoaching(league: League): NonNullable<PersonnelState['poaching']> {
  if (!league.personnel?.enabled) throw new Error('Personnel transactions are not active.');
  const state = (league.personnel.poaching ??= {
    season: league.season,
    offers: [],
    results: [],
    locked: { week: -1, ids: {} },
    pins: {},
  });
  if (state.season !== league.season) {
    state.season = league.season;
    state.offers = [];
    state.results = [];
    state.locked = { week: -1, ids: {} };
  }
  return state;
}

const onSquad = (league: League, teamId: number, id: number) => {
  const p = league.players[id];
  return !!p && p.teamId === teamId && p.squad?.kind === 'practiceSquad';
};

/** Pins still on the squad first, then the club's own best estimated ceilings. Never the hidden potential. */
export function protectionPicks(league: League, teamId: number): number[] {
  const pins = (league.personnel?.poaching?.pins[teamId] ?? []).filter((id) => onSquad(league, teamId, id));
  const rest = practiceSquad(league, teamId)
    .filter((p: Player) => p.squad?.kind === 'practiceSquad' && !pins.includes(p.id))
    .map((p) => ({ id: p.id, pot: perceive(league, teamId, p).potMid }))
    .sort((a, b) => b.pot - a.pot || a.id - b.id)
    .map((x) => x.id);
  return [...pins, ...rest].slice(0, PROTECTIONS);
}

/** Once a week, at the settle: later pin changes wait a week, so protection can't cycle through a squad. */
export function lockProtections(league: League): void {
  const state = ensurePoaching(league);
  if (state.locked.week === league.week) return;
  state.locked = {
    week: league.week,
    ids: Object.fromEntries(league.teams.map((t) => [t.id, protectionPicks(league, t.id)])),
  };
}

/** This week's locked list, less anyone who has since left: a spent slot stays empty until next week. */
export function protectedIds(league: League, teamId: number): number[] {
  const locked = league.personnel?.poaching?.locked;
  if (!locked || locked.week !== league.week) return [];
  return (locked.ids[teamId] ?? []).filter((id) => onSquad(league, teamId, id));
}

export const pinnedIds = (league: League, teamId: number): number[] => league.personnel?.poaching?.pins[teamId] ?? [];

export function setPin(league: League, teamId: number, playerId: number, on: boolean): void {
  if (!onSquad(league, teamId, playerId)) throw new Error('Only players on your practice squad can be protected.');
  const state = ensurePoaching(league);
  const pins = (state.pins[teamId] ?? []).filter((id) => id !== playerId && onSquad(league, teamId, id));
  if (on && pins.length >= PROTECTIONS) throw new Error('At most two players can always be protected.');
  state.pins[teamId] = on ? [...pins, playerId] : pins;
}

/** Protected now: this week's locked list once the week has settled, otherwise the list it will lock. */
export function protectedThisWeek(league: League, teamId: number): number[] {
  return shielded(league, teamId);
}
function shielded(league: League, teamId: number): number[] {
  return league.personnel?.poaching?.locked.week === league.week
    ? protectedIds(league, teamId)
    : protectionPicks(league, teamId);
}

/** The minimum for his service, one or two years, with three weeks of base guaranteed (cut early: dead money). */
export function poachContract(league: League, p: Player, years: 1 | 2): Contract {
  const c = squadMinimumContract(league, p, years);
  const salary = minSalary(serviceSeasons(p, league.season), league.caps[league.season]);
  c.years[0].guaranteed = Math.min(c.years[0].base, Math.ceil((3 * salary) / 18));
  return c;
}

const thisWeeksGame = (league: League, teamId: number) => {
  const g = nextTeamGame(league, teamId);
  return g && g.week === league.week ? g : undefined;
};

export function poachProblem(league: League, offer: PoachOffer, resolving = false): string | null {
  if (!league.personnel?.enabled) return 'Personnel transactions are not active.';
  if (league.phase !== 'regular') return 'Practice squad players can be signed away in the regular season only.';
  const p = league.players[offer.playerId];
  if (!p || p.teamId === null || p.squad?.kind !== 'practiceSquad' || !p.squad.agreement || p.teamId === offer.teamId)
    return "Only another club's practice squad players can be signed this way.";
  if (offer.years !== 1 && offer.years !== 2) return 'Offer one or two years.';
  if (shielded(league, p.teamId).includes(p.id)) return 'He is protected this week.';
  const g = thisWeeksGame(league, offer.teamId);
  if (g && (g.homeId === p.teamId || g.awayId === p.teamId)) return 'You play them this week.';
  // A plan that hasn't filed is cancelled when he leaves; a filed call-up or a locked game list holds him.
  const planned = elevationRecords(league).some((e) => e.playerId === p.id && e.status === 'planned');
  const lock = planned ? null : personnelMoveLock(league, p);
  if (lock) return lock;
  if (p.injury) return 'The player must be medically cleared.';
  if (!resolving && league.personnel.poaching?.offers.some((o) => o.teamId === offer.teamId && o.playerId === p.id))
    return 'You already have an offer in for him.';
  if (activeRoster(league, offer.teamId).length >= 53) return 'No open place on the 53.';
  if (capSpace(league, offer.teamId) + 0.0001 < capHit(poachContract(league, p, offer.years), league.season))
    return 'Not enough cap room for his contract.';
  return null;
}

/** Offers wait for the week's settle; until then they're private and can be withdrawn. */
export function submitPoachOffer(league: League, offer: PoachOffer): void {
  const problem = poachProblem(league, offer);
  if (problem) throw new Error(problem);
  ensurePoaching(league).offers.push({ ...offer });
}

export function cancelPoachOffer(league: League, teamId: number, playerId: number): void {
  const state = ensurePoaching(league);
  state.offers = state.offers.filter((o) => o.teamId !== teamId || o.playerId !== playerId);
}

function sign(league: League, p: Player, offer: PoachOffer): void {
  const from = p.teamId!;
  cancelPlannedElevations(league, p, 'He signed with another club.');
  settleSquadPayroll(league);
  markSquadDeparture(league, p);
  const contract = poachContract(league, p, offer.years);
  delete p.squad;
  p.teamId = offer.teamId;
  p.contract = contract;
  p.jersey = freeJersey(
    p.position,
    new Set(
      teamPlayers(league, offer.teamId)
        .filter((x) => x.id !== p.id)
        .map((x) => x.jersey),
    ),
    p.jersey,
  );
  invalidateSquadPayroll(league);
  syncDepthChart(league, league.teams[from]);
  syncDepthChart(league, league.teams[offer.teamId]);
  logTransaction(
    league,
    'sign',
    [offer.teamId, from],
    `${league.teams[offer.teamId].abbrev} signed ${p.position} ${p.firstName} ${p.lastName} off ${league.teams[from].abbrev}'s practice squad`,
  );
}

/** Every offer at once: per player, the longer deal wins, then waiver priority. Each is rechecked first. */
export function resolvePoaching(league: League): PoachResult[] {
  const state = ensurePoaching(league);
  if (!state.offers.length) return [];
  const order = waiverOrder(league);
  const results: PoachResult[] = [];
  const players = [...new Set(state.offers.map((o) => o.playerId))].sort((a, b) => a - b);
  for (const playerId of players) {
    const p = league.players[playerId];
    const fromTeamId = p.teamId!;
    const ranked = state.offers
      .filter((o) => o.playerId === playerId)
      .sort((a, b) => b.years - a.years || order.indexOf(a.teamId) - order.indexOf(b.teamId));
    let signed = false;
    for (const o of ranked) {
      const reason = signed ? 'Another club signed him first.' : poachProblem(league, o, true);
      const base = { playerId, fromTeamId, teamId: o.teamId, season: league.season, week: league.week };
      if (reason) results.push({ ...base, toTeamId: null, reason });
      else {
        sign(league, p, o);
        signed = true;
        results.push({ ...base, toTeamId: o.teamId });
      }
    }
  }
  state.offers = [];
  state.results = [...state.results, ...results].slice(-96);
  return results;
}

/** Another club's squad player must read this much better than the cover a club could otherwise sign. */
const POACH_MARGIN = 1;

/** Waiting offers hold places on the club's 53 and the positions they'll fill until the settle. */
export function heldForPoaching(league: League, teamId: number): { places: number; positions: Set<Position> } {
  const offers = league.personnel?.poaching?.offers.filter((o) => o.teamId === teamId) ?? [];
  return { places: offers.length, positions: new Set(offers.map((o) => league.players[o.playerId].position)) };
}

/** The best unprotected squad player elsewhere at `pos`, by this club's read, beating `bar` and affordable. */
function bestPoach(league: League, teamId: number, pos: Position, bar: number): PoachOffer | undefined {
  const read = (p: Player) => perceive(league, teamId, p).ovr;
  let best: { offer: PoachOffer; ovr: number } | undefined;
  for (const t of league.teams) {
    if (t.id === teamId) continue;
    const shield = shielded(league, t.id);
    for (const p of practiceSquad(league, t.id)) {
      if (p.position !== pos || p.injury || shield.includes(p.id)) continue;
      const ovr = read(p);
      if (ovr < bar + POACH_MARGIN || (best && (ovr < best.ovr || (ovr === best.ovr && p.id > best.offer.playerId))))
        continue;
      const offer: PoachOffer = { playerId: p.id, teamId, years: 1 };
      if (poachProblem(league, offer)) continue;
      if (
        capSpace(league, teamId) - capHit(poachContract(league, p, 1), league.season) <
        inSeasonReserve(league, teamId)
      )
        continue;
      best = { offer, ovr };
    }
  }
  return best?.offer;
}

/**
 * AI injury cover with practice squads on: where a club would sign a free agent, another club's unprotected squad
 * player who reads a point better is the call instead. His place on the 53 waits for the week's settle. One offer
 * a club a week; never a cut to make room.
 */
export function aiPoachCover(league: League, teamId: number, pos: Position, freeAgent?: Player): boolean {
  if (!league.personnel?.enabled || league.phase !== 'regular') return false;
  const state = ensurePoaching(league);
  if (state.offers.some((o) => o.teamId === teamId)) return false;
  if (activeRoster(league, teamId).length >= 53) return false;
  const offer = bestPoach(league, teamId, pos, freeAgent ? perceive(league, teamId, freeAgent).ovr : 0);
  if (offer) state.offers.push(offer);
  return !!offer;
}

/**
 * At the settle, the same call for a club still short at a position: the best squad player elsewhere must beat its
 * best healthy option there and the best free agent by a point.
 */
export function submitAIPoachOffers(league: League, autoUser = false): void {
  if (league.phase !== 'regular') return;
  const state = ensurePoaching(league);
  const market = freeAgents(league);
  for (const team of [...league.teams].sort((a, b) => a.id - b.id)) {
    if (team.id === league.userTeamId && !autoUser) continue;
    if (state.offers.some((o) => o.teamId === team.id)) continue;
    const roster = activeRoster(league, team.id);
    if (roster.length >= 53) continue;
    const read = (p: Player) => perceive(league, team.id, p).ovr;
    for (const pos of POSITIONS) {
      const healthy = roster.filter((p) => p.position === pos && isAvailable(p));
      if (healthy.length >= (pos === 'QB' ? 2 : STARTERS[pos])) continue;
      const bar = Math.max(0, ...healthy.map(read), ...market.filter((f) => f.position === pos).map(read));
      const offer = bestPoach(league, team.id, pos, bar);
      if (offer) {
        state.offers.push(offer);
        break;
      }
    }
  }
}
