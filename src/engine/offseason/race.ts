/**
 * Free agency's race (spec `docs/superpowers/specs/2026-11-20-free-agency-race-design.md`): every AI team puts in its
 * opening offers as the market opens (`openRace`), nobody signing yet; at each day's end the teams update their offers,
 * raises included, and every player with offers is judged (`raceDay`): he signs when his best stands out or he has
 * waited long enough (`decides`), else his offers stand overnight. The last day settles everyone with a valid offer.
 * It changes when a player chooses, not what he values (`offerValue`), and builds on the AI's bid pass (`bids.ts`).
 */
import { gunShyAt } from '../gmHabits';
import type { Rng } from '../rng';
import type { FaRace, League, Player, RaceOffer } from '../types';
import { winNow } from './ai';
import {
  bidPass,
  bidsFor,
  pickBest,
  poolOf,
  raiseTo,
  signBid,
  skips,
  type Bid,
  type BidPass,
  type FaPassOpts,
} from './bids';
import { FA_DAYS } from './index';
import { demand, offerValue, type Offer } from './negotiation';

/** Starting guesses, tuned against the NFL's signing timing. */
export const RACE = {
  /** The share his best offer must beat the next by, in his eyes, to stand out (half that at his full ask). */
  lead: 0.08,
  /** The days he waits at most before he takes his best. */
  wait: 2,
  /** The extra days the most patient one waits (scaled by his patience, 0–1). */
  patienceDays: 2,
  /** The share an AI team behind beats the leader by when it raises (a win-now GM; half that otherwise). */
  raise: 0.04,
  /** A team never raises past 15% above its own first price for him, the price its scouts' read set. */
  ceiling: 1.15,
};

/** An offer he would sign: worth `value` to him, at or above his walk-away from that team (`floor`). */
export interface RankedOffer {
  teamId: number;
  offer: Offer;
  value: number;
  floor: number;
}

/** What he weighs besides the offers: the days he has waited, his patience, the last day and his ask. */
export interface DecideOpts {
  waited: number;
  patience: number;
  lastDay: boolean;
  askApy: number;
}

/** The offers he would sign, best first (ties by team id); one under his walk-away doesn't stand. */
export function rankOffers(league: League, p: Player, offers: readonly RaceOffer[]): RankedOffer[] {
  return offers
    .map((o) => {
      const d = demand(league, p, o.teamId);
      return {
        teamId: o.teamId,
        offer: o.offer,
        value: offerValue(league, p, o.teamId, o.offer, d),
        floor: d.walkAway,
      };
    })
    .filter((o) => o.value >= o.floor)
    .sort((a, b) => b.value - a.value || a.teamId - b.teamId);
}

/**
 * Whether he picks his best offer today: on the last day, with nobody to beat, once he has waited long enough (longer
 * the more patient he is), or when his best leads the next by `RACE.lead` in his eyes (half that at his full ask).
 */
export function decides(ranked: readonly RankedOffer[], o: DecideOpts): boolean {
  const [best, next] = ranked;
  if (!best) return false;
  if (o.lastDay || !next) return true;
  if (o.waited >= RACE.wait + Math.round(o.patience * RACE.patienceDays)) return true;
  const lead = best.offer.apy >= o.askApy ? RACE.lead / 2 : RACE.lead;
  return best.value >= next.value * (1 + lead);
}

/**
 * A window on every player the race judges, in the day's own pass before he signs: the race's tests read his offers
 * there. Nothing in the game sets it.
 */
export const raceWatch: {
  onJudge?: (
    pass: BidPass,
    p: Player,
    offers: readonly RaceOffer[],
    ranked: readonly RankedOffer[],
    o: DecideOpts,
  ) => void;
} = {};

/** A race with nothing in it yet, for this season. */
const emptyRace = (league: League): FaRace => ({
  season: league.season,
  offers: {},
  since: {},
  warnings: [],
  warnedSinceLead: [],
  results: [],
});

/**
 * Free agency opens: every AI team (yours too when your staff runs it) puts in its opening offers, from the same bid
 * pass a day runs (a team's need and upgrade bars, its room), so a team doesn't bid on everyone. Only an offer that
 * clears his walk-away stands. Nobody signs.
 */
export function openRace(league: League, rng: Rng, opts: FaPassOpts): void {
  const race = (league.faRace = emptyRace(league));
  const pass = bidPass(league, rng, opts);
  for (const p of poolOf(pass)) {
    if (skips(pass, p)) continue;
    const offers = bidsFor(pass, p).bids.map((b) => raceOffer(league, b, b.offer.apy));
    const valid = new Set(rankOffers(league, p, offers).map((r) => r.teamId));
    if (!valid.size) continue;
    race.offers[p.id] = offers.filter((o) => valid.has(o.teamId));
    race.since[p.id] = league.faDay;
  }
}

const raceOffer = (league: League, bid: Bid, first: number): RaceOffer => ({
  teamId: bid.team.id,
  offer: bid.offer,
  day: league.faDay,
  first,
});

/** The share a team behind raises past the leader: a win-now GM more, a gun-shy one at his position not at all. */
function raiseStep(league: League, bid: Bid, p: Player): number {
  if (gunShyAt(league, bid.team, p.position)) return 0;
  return winNow(league, bid.team) >= 0.5 ? RACE.raise : RACE.raise / 2;
}

/**
 * Each AI team's offer for `p` today: its bid rebuilt from today's read, or its standing offer when that is worth more
 * to him and the team would still make it (`raiseTo`), never past its limit for him (`RACE.ceiling` over its first
 * price) and on the last day never above its standing offer. A team that no longer bids drops out. Then, unless it's
 * the last day, each team behind the leader raises once, to beat him by its step, up to its limit.
 */
function teamOffers(
  pass: BidPass,
  p: Player,
  standing: readonly RaceOffer[],
  bids: readonly Bid[],
  lastDay: boolean,
): { bid: Bid; first: number }[] {
  const { league } = pass;
  const before = new Map(standing.map((o) => [o.teamId, o]));
  const day: { bid: Bid; first: number }[] = [];
  for (const today of bids) {
    const old = before.get(today.team.id);
    const first = old?.first ?? today.offer.apy;
    let bid: Bid | null = today;
    if (old && offerValue(league, p, old.teamId, old.offer) > today.value)
      bid = raiseTo(pass, p, { ...today, offer: old.offer }, old.offer.apy) ?? today;
    const limit = lastDay && old ? Math.min(old.offer.apy, first * RACE.ceiling) : first * RACE.ceiling;
    // Held to its limit: a lower price than one the team would make, checked again for the restructures it needs.
    if (bid.offer.apy > limit) bid = raiseTo(pass, p, bid, Math.floor(limit));
    if (bid) day.push({ bid, first });
  }
  if (lastDay) return day;
  const valid = day.filter(({ bid }) => bid.value >= demand(league, p, bid.team.id).walkAway);
  const leader = valid.reduce<Bid | null>((a, { bid }) => (!a || bid.value > a.value ? bid : a), null);
  if (!leader) return day;
  return day.map((entry) => {
    const { bid, first } = entry;
    if (bid.value >= leader.value) return entry;
    const step = raiseStep(league, bid, p);
    if (!step) return entry;
    const target = Math.min(
      Math.round(bid.offer.apy * (leader.value / bid.value) * (1 + step)),
      Math.floor(first * RACE.ceiling),
    );
    if (target <= bid.offer.apy) return entry;
    const raised = raiseTo(pass, p, bid, target);
    return raised ? { bid: raised, first } : entry;
  });
}

/**
 * A free-agency day's end: for each free agent, best market first (budgets shrinking as teams sign, as the AI's pass
 * runs), the AI teams update their offers, and he signs his best if he decides today (`decides`). From the clearing day,
 * a player with no offer at his walk-away signs the best made for him as the AI's pass would (`pickBest`). Everyone
 * else's valid offers stand overnight. A race not yet open (a save from before it) opens instead. The signings made.
 */
export function raceDay(league: League, rng: Rng, opts: FaPassOpts): number {
  const race = league.faRace;
  if (!race || race.season !== league.season) {
    openRace(league, rng, opts);
    return 0;
  }
  const pass = bidPass(league, rng, opts);
  const lastDay = league.faDay >= FA_DAYS;
  const offers: FaRace['offers'] = {};
  let signings = 0;
  for (const p of poolOf(pass)) {
    if (skips(pass, p)) continue;
    const standing = race.offers[p.id] ?? [];
    const { bids, fallback } = bidsFor(pass, p);
    const day = teamOffers(pass, p, standing, bids, lastDay);
    const today = day.map(({ bid, first }) => {
      const old = standing.find((o) => o.teamId === bid.team.id);
      const same = old && JSON.stringify(old.offer) === JSON.stringify(bid.offer);
      return same ? old : raceOffer(league, bid, first);
    });
    const ranked = rankOffers(league, p, today);
    if (ranked.length) race.since[p.id] ??= league.faDay;
    const o: DecideOpts = {
      waited: league.faDay - (race.since[p.id] ?? league.faDay),
      patience: p.personality.patience,
      lastDay,
      askApy: ranked.length ? demand(league, p, ranked[0].teamId).askApy : Infinity,
    };
    raceWatch.onJudge?.(pass, p, today, ranked, o);
    if (decides(ranked, o)) {
      const won = day.find(({ bid }) => bid.team.id === ranked[0].teamId)!.bid;
      signBid(pass, p, won);
      signings++;
      const place = ranked.findIndex((r) => r.teamId === league.userTeamId);
      race.results.push({
        playerId: p.id,
        teamId: won.team.id,
        day: league.faDay,
        offers: ranked.length,
        userPlace: place < 0 ? null : place + 1,
      });
      continue;
    }
    if (!ranked.length) {
      // No offer at his walk-away: from the clearing day the best made for him is his market, as the AI's pass signs.
      const best = pickBest(pass, p, [], fallback);
      if (best) {
        signBid(pass, p, best);
        signings++;
      }
      continue;
    }
    offers[p.id] = today.filter((t) => ranked.some((r) => r.teamId === t.teamId));
  }
  race.offers = offers;
  return signings;
}

/** Free agency ends: offers lapse, and the results stay until the next race opens. */
export function closeRace(league: League): void {
  const race = league.faRace;
  if (!race) return;
  race.offers = {};
  race.since = {};
  race.warnings = [];
  race.warnedSinceLead = [];
}
