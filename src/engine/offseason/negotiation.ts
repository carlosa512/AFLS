/**
 * Contract negotiation. A player's agent shows an ask (market APY plus greed, his preferred
 * term, a guarantee share) and keeps a hidden walk-away number. Offers are compared in
 * "APY-equivalent" value: guarantees, term fit, a contender's pitch and loyalty all move it.
 *
 * Lessons from Football Manager complaints (see docs/research): demands never inflate just
 * because you countered; patience is the only thing a lowball offer costs.
 */
import { contractLean, noteDeparture, snubCheck } from '../relationships';
import { accelerateProration, capSpace, logTransaction, paidFraction, paidShare, weeksPaid } from '../finance/cap';
import { buildContract, capHit, isExpired, remainingProration, yearOf, yearsLeft } from '../finance/contract';
import { guaranteeAsk, leagueMarket, marketApy, minSalary, preferredYears } from '../finance/market';
import { freeJersey, rookieContract } from '../generate';
import { clamp, Rng } from '../rng';
import { activeRoster, syncDepthChart, teamPlayers, teamRatings } from '../roster';
import type { Contract, League, Negotiation, Player } from '../types';
import { OFFSEASON_PHASES } from '../types';

export interface Offer {
  years: number;
  /** Average per year, $K (bonus included). */
  apy: number;
  /** Share of the total paid as a signing bonus (0–1). */
  bonusPct: number;
  /** Share of the total guaranteed (bonus + guaranteed base), ≥ bonusPct. */
  gtdPct: number;
  voidYears: number;
}

export interface Demand {
  market: number;
  askApy: number;
  askYears: number;
  askGtdPct: number;
  /** Hidden: lowest APY-equivalent value he'll accept today. */
  walkAway: number;
  patience: number;
}

export const OFFSEASON_ROSTER_MAX = 90;
export const ROSTER_MAX = 53;
export const rosterLimit = (league: League) =>
  OFFSEASON_PHASES.includes(league.phase) && league.phase !== 'preseason' ? OFFSEASON_ROSTER_MAX : ROSTER_MAX;

/** Unsigned players lower their sights as free agency wears on. */
export function marketPressure(league: League): number {
  switch (league.phase) {
    case 'freeAgency':
      return Math.min(0.2, (league.faDay - 1) * 0.05);
    case 'draft':
      return 0.25;
    case 'preseason':
      return 0.35;
    case 'regular':
    case 'playoffs':
      return 0.45;
    default:
      return 0;
  }
}

const contenderCache = new WeakMap<League, { key: string; scores: number[] }>();

/**
 * Forget cached contender scores. Called at the start of every calendar step so AI decisions
 * see the rosters as they stand then, whatever the UI happened to read earlier (and the same
 * after a save is reloaded).
 */
export const resetContenderCache = (league: League) => contenderCache.delete(league);

/**
 * Where a team sits among the league's rosters, 0 (worst) to 1 (best). Cached per calendar step:
 * one signing barely moves it, and recomputing it for every offer would dominate free agency.
 */
export function contenderScore(league: League, teamId: number): number {
  const key = `${league.season}:${league.phase}:${league.faDay}:${league.week}`;
  let hit = contenderCache.get(league);
  if (!hit || hit.key !== key) {
    const overall = league.teams.map((t) => teamRatings(league, t).overall);
    const scores = overall.map(
      (mine, id) => overall.filter((o, j) => j !== id && o < mine).length / (league.teams.length - 1),
    );
    hit = { key, scores };
    contenderCache.set(league, hit);
  }
  return hit.scores[teamId];
}

const isOwnTeam = (player: Player, teamId: number) => player.teamId === teamId;

export function demand(league: League, player: Player, teamId: number): Demand {
  const m = leagueMarket(league);
  const market = marketApy(m, player);
  const p = player.personality;
  const own = isOwnTeam(player, teamId);
  const min = minSalary(player.experience, m.cap);
  const pressure = own ? 0 : marketPressure(league);
  const lean = contractLean(league, player, teamId);
  return {
    market,
    askApy: Math.max(min, Math.round(market * (1 + p.greed * 0.15) * lean.ask)),
    askYears: preferredYears(player),
    askGtdPct: Math.round(guaranteeAsk(m, player) * 100) / 100,
    walkAway: Math.max(
      min,
      market * (0.9 + 0.08 * p.greed) * (own ? 1 - 0.07 * p.loyalty : 1) * (1 - pressure) * lean.walkAway,
    ),
    patience: 1 + Math.round(p.patience * 3),
  };
}

/** What an offer is worth to the player, in APY-equivalent $K. */
export function offerValue(
  league: League,
  player: Player,
  teamId: number,
  offer: Offer,
  d = demand(league, player, teamId),
): number {
  const p = player.personality;
  const gtd = 1 + clamp((offer.gtdPct - d.askGtdPct) * 0.25, -0.12, 0.08);
  const term = 1 - 0.03 * Math.abs(offer.years - d.askYears);
  const win = p.winning * (contenderScore(league, teamId) - 0.5) * 0.12;
  const loyal = isOwnTeam(player, teamId) ? p.loyalty * 0.05 : 0;
  return offer.apy * gtd * term * (1 + win + loyal) * contractLean(league, player, teamId).value;
}

/** The offer that matches the agent's ask exactly. */
export function askOffer(d: Demand): Offer {
  return {
    years: d.askYears,
    apy: d.askApy,
    bonusPct: Math.round(d.askGtdPct * 0.6 * 100) / 100,
    gtdPct: d.askGtdPct,
    voidYears: 0,
  };
}

export function contractFromOffer(
  league: League,
  player: Player,
  offer: Offer,
  kind: Contract['kind'] = 'veteran',
): Contract {
  const cap = league.caps[league.season];
  const min = minSalary(player.experience, cap);
  const total = offer.apy * offer.years;
  const bonus = total * clamp(offer.bonusPct, 0, 1);
  const gtdBase = Math.max(0, total * clamp(offer.gtdPct, 0, 1) - bonus);
  const inSeason = league.phase === 'regular' || league.phase === 'playoffs';
  const c = buildContract(
    { years: offer.years, total, signingBonus: bonus, guaranteedBase: gtdBase, voidYears: offer.voidYears },
    league.season,
    offer.apy <= min * 1.05 ? 'minimum' : kind,
    min,
    inSeason ? league.week : 0,
  );
  if (inSeason) {
    // Signed mid-season: only the remaining weekly checks are paid this year.
    const y = c.years[0];
    const left = 1 - paidFraction(league);
    y.base = Math.round(y.base * left);
    y.guaranteed = Math.min(y.guaranteed, y.base);
    y.paidBefore = weeksPaid(league);
  }
  return c;
}

/** Salary of the player's current deal already paid this season (it stays on the cap when the deal is replaced). */
function paidUnderCurrentDeal(league: League, player: Player): number {
  const c = player.contract;
  if (!c) return 0;
  return (yearOf(c, league.season)?.base ?? 0) * paidShare(league, c);
}

/**
 * How much of the player's current charge this year disappears when a new deal replaces it.
 * An extension keeps the salary already paid; a deal that ran out leaves all its remaining bonus
 * money behind as dead money.
 */
function replacedCharge(league: League, player: Player, teamId: number): number {
  const c = player.teamId === teamId ? player.contract : null;
  if (!c) return 0;
  const now = capHit(c, league.season);
  return isExpired(c, league.season)
    ? now - remainingProration(c, league.season)
    : now - paidUnderCurrentDeal(league, player);
}

/**
 * Whether a player traded to `teamId` in the offseason, with a year or less left, would sign an
 * extension with it at once (the trade-and-extend: Adams, Hill and Brown in 2022). Some want to see
 * the market first, the less loyal the likelier, as in the re-sign window. It's settled per player,
 * team and league year, so the buying GM knows it from the agent before he trades and prices it in.
 */
export function willExtend(league: League, p: Player, teamId: number): boolean {
  const c = p.contract;
  if (!OFFSEASON_PHASES.includes(league.phase) || !c || isExpired(c, league.season) || yearsLeft(c, league.season) > 1)
    return false;
  if (c.kind === 'rookie' && p.experience < 3) return false;
  return !new Rng(`${league.seed}:extend:${league.season}:${p.id}:${teamId}`).chance(0.3 * (1 - p.personality.loyalty));
}

/** A player under contract can be extended in the last two years of his deal (rookies after three seasons). */
export function extensionBlocker(league: League, player: Player): string | null {
  const c = player.contract;
  if (!c || isExpired(c, league.season)) return null;
  if (c.kind === 'rookie' && player.experience < 3) return 'Rookie deals can be extended after three seasons.';
  if (c.kind === 'tag') return null;
  if (yearsLeft(c, league.season) > 2) return 'Extensions open in the final two years of a deal.';
  return null;
}

/**
 * The contract as it would stand after signing. An extension replaces the remaining years but
 * the old bonus proration keeps counting on schedule, as it does in the NFL.
 */
export function prospectiveContract(
  league: League,
  player: Player,
  teamId: number,
  offer: Offer,
  kind: Contract['kind'] = 'veteran',
): Contract {
  const c = contractFromOffer(league, player, offer, kind);
  const prior = player.teamId === teamId ? player.contract : null;
  if (prior && !isExpired(prior, league.season)) c.bonuses.unshift(...prior.bonuses);
  return c;
}

/** What signing `offer` adds to the team's cap this league year: the new deal's charge less the one it replaces. */
export function offerCharge(league: League, player: Player, teamId: number, offer: Offer): number {
  return (
    capHit(prospectiveContract(league, player, teamId, offer), league.season) - replacedCharge(league, player, teamId)
  );
}

/** Problems that make an offer impossible regardless of the player's opinion. */
export function offerProblem(league: League, player: Player, teamId: number, offer: Offer): string | null {
  if (player.retired) return 'He has retired.';
  if (player.waiver) return 'He must clear waivers before negotiating a new contract.';
  if (player.squad) return 'Practice squad players need a roster promotion, not a regular contract extension.';
  if (league.draftClass.includes(player.id)) return 'Draft prospects can only be drafted.';
  if (player.teamId !== null && player.teamId !== teamId) return 'He is under contract with another team.';
  if (league.phase === 'playoffs' || league.phase === 'complete')
    return 'Signings reopen when the new league year begins.';
  const min = minSalary(player.experience, league.caps[league.season]);
  if (offer.years < 1 || offer.years > 5) return 'Contracts run one to five years.';
  if (offer.apy < min) return `The minimum for his experience is $${(min / 1000).toFixed(2)}M.`;
  const own = player.teamId === teamId;
  if (own) {
    const ext = extensionBlocker(league, player);
    if (ext) return ext;
  }
  if (!own && activeRoster(league, teamId).length >= rosterLimit(league))
    return `Your roster is full (${rosterLimit(league)}). Release someone first.`;
  const hit = capHit(prospectiveContract(league, player, teamId, offer), league.season);
  const space = capSpace(league, teamId);
  if (hit - replacedCharge(league, player, teamId) > space)
    return `Not enough cap room: this year's hit is $${(hit / 1000).toFixed(1)}M, you have $${(Math.max(0, space) / 1000).toFixed(1)}M.`;
  return null;
}

export function negotiationFor(league: League, player: Player, teamId: number): Negotiation {
  if (player.waiver) return { playerId: player.id, teamId, patience: 0, status: 'open' };
  const existing = league.negotiations[player.id];
  if (existing && existing.teamId === teamId) {
    // Talks that broke down reopen in the next phase of the calendar.
    if (existing.status === 'broken' && existing.brokenPhase !== league.phase) {
      existing.status = 'open';
      existing.patience = demand(league, player, teamId).patience;
      existing.message = undefined;
    }
    return existing;
  }
  const n: Negotiation = {
    playerId: player.id,
    teamId,
    patience: demand(league, player, teamId).patience,
    status: 'open',
  };
  league.negotiations[player.id] = n;
  return n;
}

export interface OfferResponse {
  accepted: boolean;
  message: string;
  negotiation: Negotiation;
}

/** The user makes an offer. Accepted deals are signed on the spot. */
export function makeOffer(league: League, player: Player, teamId: number, offer: Offer): OfferResponse {
  const n = negotiationFor(league, player, teamId);
  if (n.status === 'broken')
    return {
      accepted: false,
      message: 'His agent isn’t taking calls right now. Try again later in the offseason.',
      negotiation: n,
    };
  const problem = offerProblem(league, player, teamId, offer);
  if (problem) return { accepted: false, message: problem, negotiation: n };
  const d = demand(league, player, teamId);
  const value = offerValue(league, player, teamId, offer, d);
  if (value >= d.walkAway) {
    signPlayer(league, player, teamId, offer);
    return { accepted: true, message: 'Deal! He has signed.', negotiation: n };
  }
  const insult = offer.apy < d.market * 0.75;
  n.patience -= insult ? 2 : 1;
  const gap = 1 - value / d.walkAway;
  if (n.patience <= 0) {
    n.status = 'broken';
    n.brokenPhase = league.phase;
    n.message = 'His agent has ended talks for now.';
  } else if (insult) n.message = 'That offer is an insult. Come back with something serious.';
  else if (gap < 0.06) n.message = 'Close. A little more money or guarantees should get it done.';
  else if (gap < 0.15) n.message = 'We’re still apart. Look at the money and the guarantees.';
  else n.message = 'That’s well short of what we’re looking for.';
  return { accepted: false, message: n.message, negotiation: n };
}

/** Put a player under a new contract with `teamId` (used by the user and the AI alike). */
export function signPlayer(
  league: League,
  player: Player,
  teamId: number,
  offer: Offer,
  kind: Contract['kind'] = 'veteran',
): void {
  if (player.squad) throw new Error('Practice squad players need a roster promotion.');
  if (player.waiver) throw new Error('This player is still on waivers.');
  const own = player.teamId === teamId;
  const extension = own && !!player.contract && !isExpired(player.contract, league.season);
  // Re-signing after a deal ran out: its remaining bonus money (void years included) is dead.
  if (own && !extension) accelerateProration(league, player, teamId);
  // Extending mid-season: the old salary already paid this year stays on this year's cap.
  const paid = extension ? Math.round(paidUnderCurrentDeal(league, player)) : 0;
  if (paid > 0)
    league.teams[teamId].deadMoney.push({
      season: league.season,
      amount: paid,
      playerId: player.id,
      note: 'Salary paid before extension',
    });
  // A free agent signing somewhere new walked away from his last club, unless it cut or traded him.
  if (!own) {
    const seasons = Object.keys(player.statTeams ?? {}).map(Number);
    const last = seasons.length ? player.statTeams![Math.max(...seasons)].at(-1) : undefined;
    if (last !== undefined && last !== teamId && !player.left?.some((d) => d.teamId === last))
      noteDeparture(league, player, last, 'walked');
  }
  player.contract = prospectiveContract(league, player, teamId, offer, kind);
  player.teamId = teamId;
  // Paid over a starter in his room who's still on an older deal: it may not go down well.
  if (own && kind !== 'tag') snubCheck(league, player);
  if (kind !== 'tag') player.tagCount = 0; // a new deal ends any run of consecutive tags
  delete league.negotiations[player.id];
  const team = league.teams[teamId];
  if (!own)
    player.jersey = freeJersey(
      player.position,
      new Set(
        teamPlayers(league, teamId)
          .filter((p) => p.id !== player.id)
          .map((p) => p.jersey),
      ),
      player.jersey,
    );
  syncDepthChart(league, team);
  const money = `${offer.years} yr, $${((offer.apy * offer.years) / 1000).toFixed(1)}M`;
  const verb = extension ? 'extended' : own ? 're-signed' : 'signed';
  logTransaction(
    league,
    own ? 'resign' : 'sign',
    [teamId],
    `${team.abbrev} ${verb} ${player.position} ${player.firstName} ${player.lastName} (${money})`,
  );
}

/** Free agents: unsigned, not retired, not in the draft class. */
export function freeAgents(league: League): Player[] {
  const prospects = new Set(league.draftClass);
  return Object.values(league.players).filter(
    (p) => p.teamId === null && !p.retired && !p.squad && !p.waiver && !prospects.has(p.id),
  );
}

/**
 * What this year's picks a team still holds will take of its cap once they're signed: their rookie deals' first-year
 * cap hits ($K). A rookie deal's first year charges 89-96% of its APY (the bonus spread over four years, salaries
 * climbing 8% a year); a reserve at 0.8x the APY left a front office short of the room it planned to keep.
 */
export function rookieCost(league: League, teamId: number): number {
  const season = league.season;
  return league.draftPicks
    .filter((p) => p.season === season && p.ownerId === teamId && p.playerId === undefined)
    .reduce((s, p) => s + capHit(rookieContract(p.overall ?? 100, season, league.caps[season]), season), 0);
}

/** Cap room a team keeps aside before the draft for this offseason's rookie class. */
export function rookieReserve(league: League, teamId: number): number {
  if (league.phase !== 'resign' && league.phase !== 'freeAgency') return 0;
  return rookieCost(league, teamId);
}
