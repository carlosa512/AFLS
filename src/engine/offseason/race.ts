/**
 * Free agency's race (spec `docs/superpowers/specs/2026-11-20-free-agency-race-design.md`): every AI team puts in its
 * opening offers as the market opens (`openRace`), nobody signing yet; at each day's end the teams update their offers,
 * raises included, and every player with offers is judged (`raceDay`): he signs when his best stands out or he has
 * waited long enough (`decides`), else his offers stand overnight. The last day settles everyone with a valid offer.
 * It changes when a player chooses, not what he values (`offerValue`), and builds on the AI's bid pass (`bids.ts`).
 * Your offers stand beside theirs (`placeUserOffer`), must fit together (`standingFitProblem`), and an agent warns you
 * once each time you lose the lead on a player who is about to sign elsewhere: he waits a day for your answer.
 */
import { capSpace } from '../finance/cap';
import { gunShyAt } from '../gmHabits';
import type { Rng } from '../rng';
import { activeRoster } from '../roster';
import type { FaRace, League, Player, RaceOffer, RaceResult } from '../types';
import { FA_DAYS } from '../types';
import { winNow } from './ai';
import {
  bidPass,
  bidsFor,
  bidGain,
  payable,
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
import {
  demand,
  makeOffer,
  negotiationFor,
  offerCharge,
  offerProblem,
  offerValue,
  rosterLimit,
  signPlayer,
  type Offer,
} from './negotiation';

/** Starting guesses, tuned against the NFL's signing timing. */
export const RACE = {
  /** The share his best offer must beat the next by, in his eyes, to stand out (half that at his full ask). */
  lead: 0.06,
  /** The days he waits at most before he takes his best. */
  wait: 1,
  /** The extra days the most patient one waits (scaled by his patience, 0–1). */
  patienceDays: 2,
  /** The share an AI team behind beats the leader by when it raises (a win-now GM; half that otherwise). */
  raise: 0.04,
  /** A team never raises past 15% above its own first price for him, the price its scouts' read set. */
  ceiling: 1.15,
  /**
   * Real teams talk to more players than they can sign: a team's open offers may add up to this many times what it can
   * spend, and its open spots on the roster.
   */
  overcommit: 2,
  /**
   * How many AI teams bid on one player, by his place in the pool by market worth: an NFL depth or role player draws one
   * to three suitors, and only the top of the market draws a crowd.
   */
  bidders: { top: 32, topMax: 8, next: 96, nextMax: 5, restMax: 3 },
};

/** The most AI teams that open offers for the player at `order` in the pool (best market first). */
export function bidderCap(order: number): number {
  const b = RACE.bidders;
  return order < b.top ? b.topMax : order < b.top + b.next ? b.nextMax : b.restMax;
}

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
 * Windows on the race in the day's own pass, for its tests: each team's offers once they are set (`onFit`), each
 * player as he is judged, before he signs (`onJudge`, again after a winner steps aside), and a winner that can no longer
 * sign him (`onStepAside`). Nothing in the game sets them.
 */
export const raceWatch: {
  onFit?: (pass: BidPass, teamId: number, offers: readonly { p: Player; bid: Bid }[]) => void;
  onStepAside?: (pass: BidPass, p: Player, bid: Bid) => void;
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
 * A team's open offers, which must fit together: their year-one charges within `RACE.overcommit` times what it can
 * spend (with the minimum back for each open spot they'd fill, and the room one restructure would make), and no more
 * of them than that many times its room on the roster. Whether it can sign one now is read as he chooses
 * (`signable`). A signing uses its money as `signBid` records it, so the next day's book starts from the new room.
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
  if (count > RACE.overcommit * money.room || plans > 1) return null;
  if (total > RACE.overcommit * (money.budget + money.back * Math.min(count, money.spots))) return null;
  return { money, charge: total, count, plans };
}

/**
 * Each AI team's offer for `p` today: its bid rebuilt from today's read, or its standing offer when that is worth more
 * to him and the team would still make it (`raiseTo`), never past its limit for him (`RACE.ceiling` over its first
 * price) and on the last day never above its standing offer. A team that no longer bids drops out, and only an offer
 * at his walk-away stands. A bid over the limit the team won't make at the limit leaves its standing offer, when it
 * would still make that. On the last day, for a player you have an offer in for (`held`), only the teams that stood
 * at the eve compete, none worth more to him than its standing offer: the eve's warnings told you everything that
 * can beat you.
 */
function dayBids(
  pass: BidPass,
  p: Player,
  standing: readonly RaceOffer[],
  bids: readonly Bid[],
  lastDay: boolean,
  held: boolean,
) {
  const { league } = pass;
  const before = new Map(standing.map((o) => [o.teamId, o]));
  const day: { bid: Bid; first: number }[] = [];
  for (const today of bids) {
    const old = before.get(today.team.id);
    if (held && !old) continue;
    const first = old?.first ?? today.offer.apy;
    // Its standing offer as the team would make it today, read once and only when needed.
    let kept: Bid | null | undefined;
    const keep = () =>
      kept === undefined ? (kept = old ? raiseTo(pass, p, { ...today, offer: old.offer }, old.offer.apy) : null) : kept;
    const was = old ? offerValue(league, p, old.teamId, old.offer) : 0;
    let bid: Bid | null = today;
    if (old && was > today.value) bid = keep() ?? today;
    const limit = lastDay && old ? Math.min(old.offer.apy, first * RACE.ceiling) : first * RACE.ceiling;
    // Held to its limit: a lower price than one the team would make, checked again for the restructures it needs.
    if (bid.offer.apy > limit) bid = raiseTo(pass, p, bid, Math.floor(limit)) ?? keep();
    // Against your offer on the last day: no more than its standing offer was worth to him.
    if (held && bid && bid.value > was) bid = keep();
    if (held && bid && bid.value > was) bid = null;
    if (bid && bid.value >= demand(league, p, bid.team.id).walkAway) day.push({ bid, first });
  }
  return day;
}

/** The share a team behind raises past the leader: a win-now GM more, a gun-shy one at his position not at all. */
function raiseStep(league: League, bid: Bid, p: Player): number {
  if (gunShyAt(league, bid.team, p.position)) return 0;
  return winNow(league, bid.team) >= 0.5 ? RACE.raise : RACE.raise / 2;
}

/** Your team, when you run it in this pass (your offers are yours, never the AI's); null when your staff does. */
const userOf = (pass: BidPass): number | null =>
  pass.teams.some((t) => t.id === pass.league.userTeamId) ? null : pass.league.userTeamId;

/** Whether your standing offer still stands: you could make it now (`offerProblem`) and it clears his walk-away. */
function standsFor(league: League, p: Player, o: RaceOffer): boolean {
  if (offerProblem(league, p, o.teamId, o.offer)) return false;
  const d = demand(league, p, o.teamId);
  return offerValue(league, p, o.teamId, o.offer, d) >= d.walkAway;
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
  const user = userOf(pass);
  poolOf(pass).forEach((p, order) => {
    if (skips(pass, p)) return;
    const made = bidsFor(pass, p);
    fallback.set(p.id, made.fallback);
    const standing = race.offers[p.id] ?? [];
    const held = lastDay && user !== null && standing.some((o) => o.teamId === user);
    const day = dayBids(pass, p, standing, made.bids, lastDay, held);
    // The most interested teams only (`RACE.bidders`): a team already in keeps its offer, the new ones fill what is left
    // by the upgrade he is to each. Your offer is never in this list, so it never counts.
    const mine = new Set(standing.map((o) => o.teamId));
    const slots = bidderCap(order) - day.filter((d) => mine.has(d.bid.team.id)).length;
    const fresh = day.filter((d) => !mine.has(d.bid.team.id));
    const cut = new Set<(typeof day)[number]>();
    if (fresh.length > Math.max(0, slots)) {
      const ranked = fresh.map((d) => ({ d, gain: bidGain(pass, d.bid.team, p) })).sort((a, b) => b.gain - a.gain);
      for (const { d } of ranked.slice(Math.max(0, slots))) cut.add(d);
    }
    for (const d of day) {
      if (cut.has(d)) continue;
      const { bid, first } = d;
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
      // The leader may be your standing offer: a team behind you raises as it would behind another team.
      const mine = user === null ? undefined : race.offers[p.id]?.find((o) => o.teamId === user);
      const yours = mine && standsFor(league, p, mine) ? offerValue(league, p, user!, mine.offer) : 0;
      const leader = Math.max(yours, ...entries.map((e) => e.bid.value));
      for (const entry of entries) {
        const { bid, first } = entry;
        if (bid.value >= leader) continue;
        const step = raiseStep(league, bid, p);
        if (!step) continue;
        const target = Math.min(
          Math.round(bid.offer.apy * (leader / bid.value) * (1 + step)),
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

/** The same deal, term by term. */
const sameOffer = (a: Offer, b: Offer): boolean =>
  a.years === b.years &&
  a.apy === b.apy &&
  a.bonusPct === b.bonusPct &&
  a.gtdPct === b.gtdPct &&
  a.voidYears === b.voidYears;

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
 * `bid` as its team can sign him now, after the day's earlier signings: a spot on its roster, a signing left today
 * (`dailyLimit`) and the money for this very offer (`payable`). Null when it can't.
 */
function signable(pass: BidPass, p: Player, bid: Bid): Bid | null {
  const money = teamMoney(pass, bid.team.id);
  if (money.room < 1 || money.signingsLeft < 1) return null;
  const now = payable(pass, p, bid);
  return now && sameOffer(now.offer, bid.offer) ? now : null;
}

/**
 * A free-agency day's end: the AI teams update their offers (`placeOffers`), then each free agent with offers, best
 * market first, signs his best if he decides today (`decides`) and that team can still sign him now (`signable`; else
 * its offer steps aside and he weighs the rest); everyone else's offers stand overnight. Your standing offer is judged
 * beside theirs while you could still make it (`offerProblem`, again as he signs): else it is dropped and his result
 * says so. When he'd sign elsewhere while your offer trails, and his agent hasn't warned you since you last led, he
 * waits a day and the agent warns you; on the eve of the last day you are warned about everyone you trail. On the last
 * day an offer of yours that led as the eve ended, or that led when you placed it that day, still leads (`ledAtEve`):
 * the final day closes out all deals, and he is never lost to the night's drift unwarned. Then, from the clearing day, a player with no offer at his walk-away signs the best made for
 * him as the AI's pass would (`pickBest`), with a team whose standing offers still leave it the room. A race not yet
 * open (a save from before it) opens instead. The signings made.
 */
export function raceDay(league: League, rng: Rng, opts: FaPassOpts): number {
  const race = league.faRace;
  if (!race || race.season !== league.season) {
    openRace(league, rng, opts);
    return 0;
  }
  const pass = bidPass(league, rng, opts);
  const lastDay = league.faDay >= FA_DAYS;
  const eve = league.faDay === FA_DAYS - 1;
  const user = userOf(pass);
  const { kept, fallback } = placeOffers(pass, race, lastDay, !lastDay);
  const offers: FaRace['offers'] = {};
  const warned = new Set(race.warnedSinceLead);
  const dropped = new Set(race.dropped);
  /** Why each was dropped (`FaRace.droppedWhy`): you couldn't make it any more, or it fell under his walk-away. */
  const why: Record<number, 'cap' | 'floor'> = { ...race.droppedWhy };
  /** The day each was dropped (`FaRace.droppedOn`). */
  const on: Record<number, number> = { ...race.droppedOn };
  const drop = (p: Player, reason: 'cap' | 'floor') => {
    dropped.add(p.id);
    why[p.id] = reason;
    on[p.id] = league.faDay;
  };
  /** His result: your place among the offers he weighed before any stepped aside (what you saw), and any drop. */
  const result = (p: Player, teamId: number, weighed: readonly RankedOffer[]): RaceResult => {
    const place = weighed.findIndex((r) => r.teamId === user);
    const r: RaceResult = {
      playerId: p.id,
      teamId,
      day: league.faDay,
      offers: weighed.length,
      userPlace: place < 0 ? null : place + 1,
    };
    if (place >= 0) r.userApy = weighed[place].offer.apy;
    // The deal he signed, read now (before anything can change it): the check judges good and elite signings by it.
    const c = p.contract;
    if (c) r.apyShare = c.apy / (league.caps[c.signedSeason] ?? league.caps[league.season]);
    if (dropped.delete(p.id)) r.userDropped = true;
    return r;
  };
  /** Each team's offers still open after the judging: what a signing from the fallback must leave room for. */
  const open = new Map<number, Bid[]>();
  const left: Player[] = [];
  let signings = 0;
  for (const p of poolOf(pass)) {
    const entries = kept.get(p.id) ?? [];
    const standing = race.offers[p.id] ?? [];
    let mine = user === null ? undefined : standing.find((o) => o.teamId === user);
    if (mine && !standsFor(league, p, mine)) {
      drop(p, offerProblem(league, p, mine.teamId, mine.offer) ? 'cap' : 'floor');
      mine = undefined;
    }
    if (!entries.length && !mine) {
      if (fallback.has(p.id)) left.push(p);
      continue;
    }
    let today = entries.map(({ bid, first }) => {
      const old = standing.find((o) => o.teamId === bid.team.id);
      const same = old && sameOffer(old.offer, bid.offer);
      return same ? old : raceOffer(league, bid, first);
    });
    if (mine) today.push(mine);
    // Your offer led as the eve ended, or led when you placed it on the last day (he hasn't been warned since): it
    // still leads, whatever the night did to what the others are worth to him (a rival's signings move its pull).
    // He is never lost to it unwarned.
    const ledAtEve = lastDay && !!mine && (mine.day < FA_DAYS || !!mine.led) && !warned.has(p.id);
    // He chooses; a winner that can no longer sign him now steps aside, and he weighs the rest the same day.
    let ranked: RankedOffer[];
    let weighed: RankedOffer[] | undefined;
    let won: Bid | null = null;
    let yoursWon = false;
    for (;;) {
      ranked = rankOffers(league, p, today);
      if (ledAtEve) ranked = [...ranked.filter((r) => r.teamId === user), ...ranked.filter((r) => r.teamId !== user)];
      weighed ??= ranked;
      if (ranked.length) race.since[p.id] ??= league.faDay;
      if (ranked.length && ranked[0].teamId === user) warned.delete(p.id);
      const o: DecideOpts = {
        waited: league.faDay - (race.since[p.id] ?? league.faDay),
        patience: p.personality.patience,
        lastDay,
        askApy: ranked.length ? demand(league, p, ranked[0].teamId).askApy : Infinity,
      };
      raceWatch.onJudge?.(pass, p, today, ranked, o);
      if (!decides(ranked, o)) break;
      if (ranked[0].teamId === user) {
        // Yours wins if you can still make it now, after the day's earlier signings.
        if (!offerProblem(league, p, user, mine!.offer)) {
          yoursWon = true;
          break;
        }
        drop(p, 'cap');
      } else {
        const best = entries.find(({ bid }) => bid.team.id === ranked[0].teamId)!.bid;
        won = signable(pass, p, best);
        if (won) break;
        raceWatch.onStepAside?.(pass, p, best);
      }
      const gone = ranked[0].teamId;
      today = today.filter((t) => t.teamId !== gone);
      if (gone === user) mine = undefined;
    }
    // You trail him: once each time you lose the lead his agent warns you before he signs elsewhere, and on the eve of
    // the last day about everyone you trail.
    const trailing = !!mine && ranked.length > 0 && ranked[0].teamId !== user && ranked.some((r) => r.teamId === user);
    if (trailing && !lastDay && !warned.has(p.id) && (won || eve)) {
      won = null;
      warned.add(p.id);
      race.warnings.push({ playerId: p.id, day: league.faDay, answered: false });
    }
    if (yoursWon) {
      signPlayer(league, p, user!, mine!.offer);
      signings++;
      race.results.push(result(p, user!, weighed));
      continue;
    }
    if (won) {
      signBid(pass, p, won);
      signings++;
      race.results.push(result(p, won.team.id, weighed));
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
    const room = (fallback.get(p.id) ?? []).flatMap((b) => {
      const now = withBid(bookOf(pass, b.team.id, open.get(b.team.id)), b) && signable(pass, p, b);
      return now ? [now] : [];
    });
    const best = pickBest(pass, p, [], room);
    if (!best) continue;
    signBid(pass, p, best);
    signings++;
    // Your offer for him was dropped: his result says where he went.
    if (dropped.has(p.id)) race.results.push(result(p, best.team.id, []));
  }
  race.offers = offers;
  // A player left with no offer waits for nobody: his days count again from his next one.
  for (const id of Object.keys(race.since)) if (!offers[+id]) delete race.since[+id];
  race.warnedSinceLead = [...warned].filter((id) => offers[id]);
  race.dropped = [...dropped].filter((id) => league.players[id].teamId === null);
  if (!race.dropped.length) delete race.dropped;
  const still = race.dropped ?? [];
  race.droppedWhy = Object.fromEntries(Object.entries(why).filter(([id]) => still.includes(+id)));
  race.droppedOn = Object.fromEntries(Object.entries(on).filter(([id]) => still.includes(+id)));
  if (!still.length) {
    delete race.droppedWhy;
    delete race.droppedOn;
  }
  return signings;
}

/** What placing an offer of yours did: signed on the spot, standing in the race, refused, or talks broken off. */
export interface RaceReply {
  status: 'signed' | 'standing' | 'refused' | 'broken';
  message: string;
}

/** This season's race while free agency runs, or null. */
const liveRace = (league: League): FaRace | null =>
  league.phase === 'freeAgency' && league.faRace?.season === league.season ? league.faRace : null;

/** Your standing offer for a player, if any. */
const yourOffer = (league: League, playerId: number): RaceOffer | undefined =>
  liveRace(league)?.offers[playerId]?.find((o) => o.teamId === league.userTeamId);

/** Whether another team has a standing offer for him: your offer for him goes through the race. */
export function inRace(league: League, playerId: number): boolean {
  return !!liveRace(league)?.offers[playerId]?.some((o) => o.teamId !== league.userTeamId);
}

/** Players whose agent's warning you haven't answered: the game waits for them. */
export function pendingWarnings(league: League): number[] {
  return [
    ...new Set(
      liveRace(league)
        ?.warnings.filter((w) => !w.answered)
        .map((w) => w.playerId) ?? [],
    ),
  ];
}

/** Whether his agent's warning is waiting on your answer. */
export function raceWarningOpen(league: League, playerId: number): boolean {
  return !!liveRace(league)?.warnings.some((w) => w.playerId === playerId && !w.answered);
}

/** His agent's warning answered (a raise, a pull, letting him go). */
function answer(race: FaRace, playerId: number): void {
  for (const w of race.warnings) if (w.playerId === playerId) w.answered = true;
}

/** Your offer for him taken out of the race; with no offer left he waits for nobody. */
function withdraw(race: FaRace, league: League, playerId: number): void {
  const left = (race.offers[playerId] ?? []).filter((o) => o.teamId !== league.userTeamId);
  if (left.length) race.offers[playerId] = left;
  else {
    delete race.offers[playerId];
    delete race.since[playerId];
  }
  answer(race, playerId);
}

const millions = (k: number) => `$${(Math.max(0, k) / 1000).toFixed(1)}M`;

/**
 * Whether a team's standing offers fit together, with `add` in place of its offer for him: their year-one charges within
 * its cap space (`space`, after a trade, else today's) and their count with its active roster (and the players a trade
 * brings in less those it sends, `roster`) within the roster limit. Yours are held to this, not the AI's books: the
 * dialog's own check (`offerProblem`) over all of them at once.
 */
export function standingFitProblem(
  league: League,
  teamId: number,
  o: { add?: { player: Player; offer: Offer }; space?: number; roster?: number } = {},
): string | null {
  const mine: { player: Player; offer: Offer }[] = [];
  for (const [id, offers] of Object.entries(liveRace(league)?.offers ?? {})) {
    if (+id === o.add?.player.id) continue;
    const ours = offers.find((x) => x.teamId === teamId);
    if (ours) mine.push({ player: league.players[+id], offer: ours.offer });
  }
  if (o.add) mine.push(o.add);
  const total = mine.reduce((a, m) => a + offerCharge(league, m.player, teamId, m.offer), 0);
  const space = o.space ?? capSpace(league, teamId);
  if (total > space)
    return `Not enough cap room for all your offers. Their hits this year add up to ${millions(total)}, you have ${millions(space)}.`;
  const limit = rosterLimit(league);
  if (activeRoster(league, teamId).length + (o.roster ?? 0) + mine.length > limit)
    return `Your roster and your offers come to more than ${limit} players. Release someone or pull an offer.`;
  return null;
}

/**
 * Your offer for a free agent. One you couldn't make, or with talks broken off, is refused as in any negotiation; so
 * is one that doesn't fit with your other offers (`standingFitProblem`). Under his walk-away it is refused and costs
 * his agent's patience (`makeOffer`), and nothing is stored. With no other team in for him he signs on the spot.
 * Otherwise it stands in the race (an offer worth no more to him than yours standing is refused: you can raise or
 * pull), and answers his agent's warning; one that takes the lead counts as leading, so losing it again brings a new
 * warning.
 */
export function placeUserOffer(league: League, p: Player, offer: Offer): RaceReply {
  const teamId = league.userTeamId;
  const problem = offerProblem(league, p, teamId, offer);
  if (problem) return { status: 'refused', message: problem };
  const n = negotiationFor(league, p, teamId);
  if (n.status === 'broken') return { status: 'broken', message: n.message ?? 'His agent has ended talks for now.' };
  const fit = standingFitProblem(league, teamId, { add: { player: p, offer } });
  if (fit) return { status: 'refused', message: fit };
  const d = demand(league, p, teamId);
  const value = offerValue(league, p, teamId, offer, d);
  if (value < d.walkAway) return { status: 'refused', message: makeOffer(league, p, teamId, offer).message };
  const race = liveRace(league);
  const old = yourOffer(league, p.id);
  if (!race || (!old && !inRace(league, p.id))) {
    const r = makeOffer(league, p, teamId, offer);
    return { status: r.accepted ? 'signed' : 'refused', message: r.message };
  }
  if (old && value <= offerValue(league, p, teamId, old.offer, d))
    return { status: 'refused', message: 'You can raise your offer or pull it.' };
  const placed: RaceOffer = { teamId, offer, day: league.faDay, first: old?.first ?? offer.apy };
  race.offers[p.id] = [...(race.offers[p.id] ?? []).filter((o) => o.teamId !== teamId), placed];
  // Judged when placed: on the last day an offer that ranks first now stays first at the day's end.
  const leads = rankOffers(league, p, race.offers[p.id])[0]?.teamId === teamId;
  if (leads) placed.led = true;
  race.since[p.id] ??= league.faDay;
  if (race.dropped) race.dropped = race.dropped.filter((id) => id !== p.id);
  if (race.droppedWhy) delete race.droppedWhy[p.id];
  if (race.droppedOn) delete race.droppedOn[p.id];
  answer(race, p.id);
  // Leading now, as the screen shows: lose the lead again and his agent warns you again.
  if (leads) race.warnedSinceLead = race.warnedSinceLead.filter((id) => id !== p.id);
  return { status: 'standing', message: 'Your offer is in. He will weigh it with the others.' };
}

/**
 * Pull your offer for him. Pulling one that leads or is second ends talks with him for the rest of free agency; one
 * further back is free.
 */
export function pullUserOffer(league: League, playerId: number): void {
  const race = liveRace(league);
  if (!race || !yourOffer(league, playerId)) return;
  const p = league.players[playerId];
  const place = rankOffers(league, p, race.offers[playerId]).findIndex((r) => r.teamId === league.userTeamId);
  if (place === 0 || place === 1) {
    const n = negotiationFor(league, p, league.userTeamId);
    n.status = 'broken';
    n.brokenPhase = league.phase;
    n.message = 'His agent has ended talks for now.';
  }
  withdraw(race, league, playerId);
}

/**
 * Let him go: your answer to his agent's warning, your offer pulled with no hard feelings. With no warning open it is
 * an ordinary pull (`pullUserOffer`), or leading and walking away would cost nothing.
 */
export function letGo(league: League, playerId: number): void {
  const race = liveRace(league);
  if (!race) return;
  if (raceWarningOpen(league, playerId)) withdraw(race, league, playerId);
  else pullUserOffer(league, playerId);
}

/**
 * Free agency ends: offers lapse, and the results stay until the next race opens, with the offers of yours the last day
 * dropped (their letters are filed after it).
 */
export function closeRace(league: League): void {
  const race = league.faRace;
  if (!race) return;
  race.offers = {};
  race.since = {};
  race.warnings = [];
  race.warnedSinceLead = [];
}
