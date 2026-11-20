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
  bidGain,
  pickBest,
  poolOf,
  raiseTo,
  signBid,
  skips,
  teamMoney,
  yearOne,
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
 * Windows on the race in the day's own pass, for its tests: each team's offers once they are set (`onFit`), and each
 * player as he is judged, before he signs (`onJudge`). Nothing in the game sets them.
 */
export const raceWatch: {
  onFit?: (pass: BidPass, teamId: number, offers: readonly { p: Player; bid: Bid }[]) => void;
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

/** One team's offer for one player in a day's pass: its bid, its first price for him and the upgrade he is to it. */
interface Entry {
  p: Player;
  bid: Bid;
  first: number;
  gain: number;
  /** His place in the pool, best market first. */
  order: number;
}

/** What an offer takes of a team's room: its year-one charge, less the room its restructures would make. */
const charge = (bid: Bid) => yearOne(bid.offer) - (bid.plan?.saved ?? 0);

/**
 * A team's open offers, which must fit together as your own do: their year-one charges within what it can spend (with
 * the minimum back for each open spot they'd fill, and the room one restructure would make), and no more of them than
 * its room on the roster or its signings left today. A signing uses its money as `signBid` records it, so the next
 * day's book starts from the new room.
 */
interface Book {
  money: ReturnType<typeof teamMoney>;
  charge: number;
  count: number;
  plans: number;
}

const bookOf = (pass: BidPass, teamId: number, bids: readonly Bid[] = []): Book => ({
  money: teamMoney(pass, teamId),
  charge: bids.reduce((a, b) => a + charge(b), 0),
  count: bids.length,
  plans: bids.filter((b) => b.plan).length,
});

/** The book with `add` in it (in place of `drop`, a raise), or null when it doesn't fit. */
function withBid(book: Book, add: Bid, drop?: Bid): Book | null {
  const { money } = book;
  const count = book.count + (drop ? 0 : 1);
  const plans = book.plans + (add.plan ? 1 : 0) - (drop?.plan ? 1 : 0);
  const total = book.charge + charge(add) - (drop ? charge(drop) : 0);
  if (count > Math.min(money.room, money.signingsLeft) || plans > 1) return null;
  if (total > money.budget + money.back * Math.min(count, money.spots)) return null;
  return { money, charge: total, count, plans };
}

/**
 * Each AI team's offer for `p` today: its bid rebuilt from today's read, or its standing offer when that is worth more
 * to him and the team would still make it (`raiseTo`), never past its limit for him (`RACE.ceiling` over its first
 * price) and on the last day never above its standing offer. A team that no longer bids drops out, and only an offer
 * at his walk-away stands.
 */
function dayBids(pass: BidPass, p: Player, standing: readonly RaceOffer[], bids: readonly Bid[], lastDay: boolean) {
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
    if (bid && bid.value >= demand(league, p, bid.team.id).walkAway) day.push({ bid, first });
  }
  return day;
}

/** The share a team behind raises past the leader: a win-now GM more, a gun-shy one at his position not at all. */
function raiseStep(league: League, bid: Bid, p: Player): number {
  if (gunShyAt(league, bid.team, p.position)) return 0;
  return winNow(league, bid.team) >= 0.5 ? RACE.raise : RACE.raise / 2;
}

/**
 * The day's offers: every AI team's bids for the pool (`dayBids`), each team keeping the ones that fit its book, the
 * players it wants most first (by the upgrade each is to it). Then, when `raises`, each team behind a player's leader
 * raises once, to beat him by its step, up to its limit for him and only as far as its book holds. Draws only what
 * `bidsFor` draws. Each player's offers, by id, and the fallback bids for those under his walk-away.
 */
function placeOffers(
  pass: BidPass,
  race: FaRace,
  lastDay: boolean,
  raises: boolean,
): { kept: Map<number, Entry[]>; fallback: Map<number, Bid[]> } {
  const { league } = pass;
  const byTeam = new Map<number, Entry[]>();
  const fallback = new Map<number, Bid[]>();
  poolOf(pass).forEach((p, order) => {
    if (skips(pass, p)) return;
    const made = bidsFor(pass, p);
    fallback.set(p.id, made.fallback);
    for (const { bid, first } of dayBids(pass, p, race.offers[p.id] ?? [], made.bids, lastDay)) {
      const entry = { p, bid, first, gain: bidGain(pass, bid.team, p), order };
      const list = byTeam.get(bid.team.id);
      if (list) list.push(entry);
      else byTeam.set(bid.team.id, [entry]);
    }
  });
  const kept = new Map<number, Entry[]>();
  const books = new Map<number, Book>();
  for (const [teamId, entries] of byTeam) {
    let book = bookOf(pass, teamId);
    entries.sort((a, b) => b.gain - a.gain || a.order - b.order);
    for (const entry of entries) {
      const next = withBid(book, entry.bid);
      if (!next) continue;
      book = next;
      const list = kept.get(entry.p.id);
      if (list) list.push(entry);
      else kept.set(entry.p.id, [entry]);
    }
    books.set(teamId, book);
  }
  if (raises)
    for (const p of poolOf(pass)) {
      const entries = kept.get(p.id);
      if (!entries) continue;
      const leader = entries.reduce((a, e) => (e.bid.value > a.bid.value ? e : a)).bid;
      for (const entry of entries) {
        const { bid, first } = entry;
        if (bid.value >= leader.value) continue;
        const step = raiseStep(league, bid, p);
        if (!step) continue;
        const target = Math.min(
          Math.round(bid.offer.apy * (leader.value / bid.value) * (1 + step)),
          Math.floor(first * RACE.ceiling),
        );
        if (target <= bid.offer.apy) continue;
        const raised = raiseTo(pass, p, bid, target);
        const book = raised && withBid(books.get(bid.team.id)!, raised, bid);
        if (!book) continue;
        books.set(bid.team.id, book);
        entry.bid = raised;
      }
    }
  if (raceWatch.onFit) {
    const byTeamNow = new Map<number, { p: Player; bid: Bid }[]>();
    for (const entries of kept.values())
      for (const { p, bid } of entries) byTeamNow.set(bid.team.id, [...(byTeamNow.get(bid.team.id) ?? []), { p, bid }]);
    for (const [teamId, list] of byTeamNow) raceWatch.onFit(pass, teamId, list);
  }
  return { kept, fallback };
}

const raceOffer = (league: League, bid: Bid, first: number): RaceOffer => ({
  teamId: bid.team.id,
  offer: bid.offer,
  day: league.faDay,
  first,
});

/**
 * Free agency opens: every AI team (yours too when your staff runs it) puts in its opening offers, from the same bid
 * pass a day runs (a team's need and upgrade bars), as many as fit its book. Only an offer that clears his walk-away
 * stands. Nobody signs.
 */
export function openRace(league: League, rng: Rng, opts: FaPassOpts): void {
  const race = (league.faRace = emptyRace(league));
  const pass = bidPass(league, rng, opts);
  const { kept } = placeOffers(pass, race, false, false);
  for (const [id, entries] of kept) {
    race.offers[id] = entries.map(({ bid, first }) => raceOffer(league, bid, first));
    race.since[id] = league.faDay;
  }
}

/**
 * A free-agency day's end: the AI teams update their offers (`placeOffers`), then each free agent with offers, best
 * market first, signs his best if he decides today (`decides`); everyone else's offers stand overnight. Then, from the
 * clearing day, a player with no offer at his walk-away signs the best made for him as the AI's pass would
 * (`pickBest`), with a team whose standing offers still leave it the room. A race not yet open (a save from before it)
 * opens instead. The signings made.
 */
export function raceDay(league: League, rng: Rng, opts: FaPassOpts): number {
  const race = league.faRace;
  if (!race || race.season !== league.season) {
    openRace(league, rng, opts);
    return 0;
  }
  const pass = bidPass(league, rng, opts);
  const lastDay = league.faDay >= FA_DAYS;
  const { kept, fallback } = placeOffers(pass, race, lastDay, !lastDay);
  const offers: FaRace['offers'] = {};
  /** Each team's offers still open after the judging: what a signing from the fallback must leave room for. */
  const open = new Map<number, Bid[]>();
  const left: Player[] = [];
  let signings = 0;
  for (const p of poolOf(pass)) {
    const entries = kept.get(p.id);
    if (!entries) {
      if (fallback.has(p.id)) left.push(p);
      continue;
    }
    const standing = race.offers[p.id] ?? [];
    const today = entries.map(({ bid, first }) => {
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
      const won = entries.find(({ bid }) => bid.team.id === ranked[0].teamId)!.bid;
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
      left.push(p);
      continue;
    }
    offers[p.id] = today.filter((t) => ranked.some((r) => r.teamId === t.teamId));
    for (const { bid } of entries)
      if (ranked.some((r) => r.teamId === bid.team.id)) open.set(bid.team.id, [...(open.get(bid.team.id) ?? []), bid]);
  }
  for (const p of left) {
    // No offer at his walk-away: from the clearing day the best made for him is his market, as the AI's pass signs.
    const room = (fallback.get(p.id) ?? []).filter((b) => withBid(bookOf(pass, b.team.id, open.get(b.team.id)), b));
    const best = pickBest(pass, p, [], room);
    if (!best) continue;
    signBid(pass, p, best);
    signings++;
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
