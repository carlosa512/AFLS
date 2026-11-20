/**
 * The AI's free-agency pass in pieces: who bids on a free agent and for what (`bidsFor`), which bid he takes
 * (`pickBest`), the signing and its bookkeeping (`signBid`), and a bid raised to a higher price if the club would still
 * make it (`raiseTo`). `aiFreeAgencyDay` in `ai.ts` runs them in order; the free-agency race builds on them.
 */
import { ageShift } from '../aging';
import { capSpace, releasePlayer } from '../finance/cap';
import { leagueMarket, marketApy, minSalary, topMinimum } from '../finance/market';
import { draftedBy, aiGm, gunShyAt, habitOn, logMove } from '../gmHabits';
import { startsOnReserve } from '../injuries';
import { leanOutlook, teamOutlook } from '../outlook';
import type { Rng } from '../rng';
import { activeRoster } from '../roster';
import { quirkWorth } from '../scouting';
import type { League, Player, Position, Team } from '../types';
import {
  aiOffer,
  bankBuys,
  CAMP_CUSHION,
  CLEARING_DAY,
  clearingFloor,
  clubRoom,
  depthOutlooks,
  fadingBar,
  fitOffer,
  fundedRoom,
  isYoungStar,
  lastCallTakes,
  minGainFor,
  needGain,
  openSpots,
  restructurePlan,
  restructureRoom,
  richness,
  spendable,
  swapGain,
  upgradeBar,
  winNow,
  youngQbClub,
  type ClubRoom,
  type RestructurePlan,
} from './ai';
import { capPlan, stanceFor } from './capPlan';
import { dealAdds, fits, priceToBooks, shapeToBooks } from './capBooks';
import { faReads } from './faReads';
import { demand, freeAgents, offerValue, rosterLimit, signPlayer, type Offer } from './negotiation';

export type FaPassOpts = { includeUser?: boolean; rosterMax?: number; lastCall?: boolean; starsOnly?: boolean };

/** A club's offer for one free agent: what it is worth to him (`value`), and how the club pays for it. */
export interface Bid {
  team: Team;
  offer: Offer;
  value: number;
  /** The restructures that make its room, made only once he has chosen the club. */
  plan?: RestructurePlan;
  /** An old quarterback for a year beside the club's young one. */
  bridging?: boolean;
  /** The last call's funded swap: the minimum man released to make his spot and room. */
  cut?: Player | null;
}

/**
 * One pass of the market: the league, its stream and options, and what the pass reads once and keeps up to date as
 * clubs sign. Read through this module's functions only.
 */
export interface BidPass {
  league: League;
  rng: Rng;
  opts: FaPassOpts;
  teams: Team[];
  depth: Map<number, Record<Position, number[]>>;
  budget: Map<number, number>;
  spots: Map<number, number>;
  room: Map<number, number>;
  plans: Map<number, ReturnType<typeof capPlan>>;
  funds: Map<string, ReturnType<typeof fundedRoom>>;
  clearing: boolean;
  signedToday: Map<number, number>;
  rich: Map<number, number>;
  dailyLimit: Map<number, number>;
  minGain: Map<number, number>;
  bridge: Map<number, Player | null>;
  pool: Player[];
  read: ReturnType<typeof faReads>;
  rooms: Map<number, ClubRoom>;
}

export function bidPass(league: League, rng: Rng, opts: FaPassOpts = {}): BidPass {
  const teams = league.teams.filter((t) => opts.includeUser || t.id !== league.userTeamId);
  const depth = new Map(teams.map((t) => [t.id, depthOutlooks(league, t)]));
  const budget = new Map(teams.map((t) => [t.id, spendable(league, t.id)]));
  // A signing fills a spot the fill reserve holds a minimum for, so that minimum comes back with him, as it does for a
  // re-sign (`aiResignWindow`). Uncredited, a club's spendable ran out on its first good signings and every minimum
  // man it still needed waited for camp: free agency's signings a club fell from 11 to 4 by a league's fifth season.
  const spots = new Map(teams.map((t) => [t.id, openSpots(league, t.id)]));
  const room = new Map(
    teams.map((t) => [t.id, (opts.rosterMax ?? rosterLimit(league)) - activeRoster(league, t.id).length]),
  );
  // From the clearing day on (and in the late passes), the market has passed a man by: a prove-it deal is his market.
  const clearing =
    league.phase === 'freeAgency'
      ? league.faDay >= CLEARING_DAY
      : league.phase === 'draft' || league.phase === 'preseason';
  // Each club's room to spend, read once a pass and again when it signs: a club's cap is read off every player in the
  // league, and reading it for each bid was most of a free-agency day (70% of a careers league).
  const rich = new Map(teams.map((t) => [t.id, richness(league, t)]));
  const dailyLimit = new Map(teams.map((t) => [t.id, 4 + Math.round(rich.get(t.id)! * 5)]));
  const minGain = new Map(teams.map((t) => [t.id, minGainFor(league, t, rich.get(t.id))]));
  // A bridge GM's young quarterback, read once a pass (it costs an outlook per quarterback).
  const bridge = new Map(teams.map((t) => [t.id, habitOn(league, t, 'bridgeQb') ? youngQbClub(league, t) : null]));
  const market = leagueMarket(league);
  const pool = freeAgents(league)
    .map((p) => ({ p, value: marketApy(market, p) }))
    // Camp's last word for the owner's rule: young stars still unsigned, and no one else.
    .filter(({ p, value }) => !opts.starsOnly || isYoungStar(league, p, value))
    .sort((a, b) => b.value - a.value)
    .map(({ p }) => p);
  // Each front office bids on what its own scouts see; the player's price is still his real market. Its read of each
  // free agent is kept across passes until something it uses moves (`faReads.ts`).
  const read = faReads(league);
  return {
    league,
    rng,
    opts,
    teams,
    depth,
    budget,
    spots,
    room,
    // Cap planning (`capPlan.ts`): each club's plan, built the first time a decision reads it (`planOf`).
    plans: new Map(),
    // The last call's funded room, read once per club and spot until the club signs or cuts (`fundedFor`).
    funds: new Map(),
    clearing,
    signedToday: new Map(),
    rich,
    dailyLimit,
    minGain,
    bridge,
    pool,
    read,
    // What each club could borrow for a free agent, read once a pass (and again after it signs or restructures).
    rooms: new Map(),
  };
}

/** The pass's free agents, best market first (only the young stars on the stars-only pass). */
export const poolOf = (pass: BidPass): Player[] => pass.pool;

/**
 * Injury reports are public: nobody pays market price for a player who'll miss the start of the season. On the last
 * call, nobody fills a spot on the 53 with a man its own staff would put on reserve the same day.
 */
export const skips = (pass: BidPass, p: Player): boolean =>
  !!p.injury && (p.injury.estimate[0] >= 4 || (!!pass.opts.lastCall && startsOnReserve(p.injury)));

/** What he signs for at `teamId`: his walk-away, or on the last call anything from his minimum up. */
export function floorFor(pass: BidPass, p: Player, teamId: number): number {
  const { league } = pass;
  return pass.opts.lastCall ? minSalary(p.experience, league.caps[league.season]) : demand(league, p, teamId).walkAway;
}

/** The minimum a signing gets back for the open spot he fills. */
const back = (pass: BidPass, teamId: number) =>
  pass.spots.get(teamId)! > 0 ? topMinimum(pass.league.caps[pass.league.season]) : 0;

/**
 * Each club's plan, built the first time a decision reads it (a big deal's next-year check, a banking club's bid): most
 * clubs never need one in a pass, and building all 32 every pass was most of a late pass's time. In free agency a plan
 * has no keepers, so it draws nothing: when it's built doesn't move the stream.
 */
function planOf(pass: BidPass, team: Team) {
  let plan = pass.plans.get(team.id);
  if (!plan) pass.plans.set(team.id, (plan = capPlan(pass.league, team, pass.rng)));
  return plan;
}

/**
 * The last call's funded room, read once per club and spot until the club signs or cuts: reading it for every free
 * agent at every club (a roster scan and a release price per minimum man) slowed every offseason, careers past its limit.
 */
function fundedFor(pass: BidPass, team: Team, position: Position, share: number) {
  const key = `${team.id}:${position}:${share}`;
  let f = pass.funds.get(key);
  if (!f) pass.funds.set(key, (f = fundedRoom(pass.league, team, position, share)));
  return f;
}

function roomOf(pass: BidPass, team: Team): ClubRoom {
  if (!pass.rooms.has(team.id)) pass.rooms.set(team.id, clubRoom(pass.league, team));
  return pass.rooms.get(team.id)!;
}

/**
 * Every year a deal reaches must fit the club's books (`capBooks`), net of the open spot he fills: a free agent gets
 * the hard limit, kept ahead of next spring's keepers the club reads below him (`above`). It replaced a next-year
 * check that let the years after fill up unchecked.
 */
function booksOk(pass: BidPass, team: Team, p: Player, o: Offer, above: number): boolean {
  const books = roomOf(pass, team).books;
  return fits(books, dealAdds(pass.league, p, team.id, o, books), false, above);
}

/** Year-one charge: bonus spreads, so the hit is below the APY for bigger deals. */
const yearOne = (offer: Offer) =>
  offer.apy * (1 - offer.bonusPct) +
  (offer.apy * offer.years * offer.bonusPct) / Math.min(5, offer.years + offer.voidYears);

/**
 * Only the stars-only pass breaks a whole reserve: every pass breaking it for every young star took the league's
 * kickoff room under its floor.
 */
const shareOf = (pass: BidPass) => (pass.opts.starsOnly ? 1 : CAMP_CUSHION.share);

/** How a club reads him: where he's headed (`ahead`), the upgrade he is to it (`gain`) and the bar his price must clear. */
function interest(pass: BidPass, team: Team, p: Player) {
  const { league } = pass;
  // Bid on what its own scouts see: his game, plus or minus the habits they've caught on film.
  const seen = pass.read(team.id, p);
  const ahead = leanOutlook(p, seen, winNow(league, team));
  const gm = aiGm(league, team);
  // A bridge GM wants an old quarterback for a year beside his young one; a gun-shy one asks more at his position.
  const bridging = !!pass.bridge.get(team.id) && p.position === 'QB' && p.age - ageShift('QB') >= 30;
  const bar =
    (bridging ? 0.5 : gunShyAt(league, team, p.position) ? 1.3 : 1) * (bridging ? 1 : fadingBar(p, ahead, seen.ovr));
  const gain =
    needGain(pass.depth.get(team.id)!, p, ahead + quirkWorth(league, team.id, p)) +
    (gm && draftedBy(gm, p) && habitOn(league, team, 'hisGuys') ? 0.5 : 0);
  return { ahead, bridging, bar, gain };
}

/**
 * Every club's offer for `p`: `bids` he weighs against his floor, and `fallback`, the offers a club wants to make but
 * that fall short of his floor (what he's worth to the market today).
 */
export function bidsFor(pass: BidPass, p: Player): { bids: Bid[]; fallback: Bid[] } {
  const { league, rng, opts } = pass;
  const bids: Bid[] = [];
  const fallback: Bid[] = [];
  const minimum = minSalary(p.experience, league.caps[league.season]);
  for (const team of pass.teams) {
    // A full club still has the last call's swap: its weakest minimum man for a clear upgrade (`fundedRoom`).
    const full = (pass.room.get(team.id) ?? 0) <= 0;
    if ((full && !opts.lastCall) || (pass.signedToday.get(team.id) ?? 0) >= pass.dailyLimit.get(team.id)!) continue;
    const { ahead, bridging, bar, gain } = interest(pass, team, p);
    // The last call's swap: the clear upgrade is read against the room without the man he'd replace (`swapGain`).
    // A swap's gain is read only where it can decide something: on the last call, for a clear upgrade his own gain
    // doesn't already make (`swapGain` against the room without the man he'd replace).
    const clear = 2 * pass.minGain.get(team.id)!;
    const share = shareOf(pass);
    const swap =
      opts.lastCall && gain < clear
        ? swapGain(
            league,
            team,
            pass.depth.get(team.id)!,
            p,
            ahead + quirkWorth(league, team.id, p),
            fundedFor(pass, team, p.position, share).cut,
          )
        : gain;
    const lift = Math.max(gain, swap);
    if (gain < pass.minGain.get(team.id)! * bar && !(full && lift >= clear)) continue;
    let offer = aiOffer(league, team, p, rng, lift, pass.rich.get(team.id));
    if (full) {
      if (lift < clear) continue;
      const funded = fundedFor(pass, team, p.position, share);
      const deal = funded.cut && fitOffer(offer, funded.room, minimum, p.age);
      if (deal && lastCallTakes(deal, minimum))
        bids.push({ team, offer: deal, value: offerValue(league, p, team.id, deal), cut: funded.cut });
      continue;
    }
    if (bridging) offer = { ...offer, years: 1, bonusPct: 0, voidYears: 0 };
    // The deal as the club can carry it on its books: void years, then bonus go first, and the keepers it reads below
    // him wait their turn. One its books can't carry even so is never cut short: in the market's first days that club
    // stays out and a club with room signs him long; once the market has passed him by (`clearing`), his price falls
    // to what its books carry and the length stays (`priceToBooks`), an offer he weighs against his walk-away.
    let shaped = shapeToBooks(league, team, p, offer, roomOf(pass, team).books, false, ahead);
    const lowered = !shaped;
    if (!shaped) {
      if (!pass.clearing) continue;
      shaped = priceToBooks(league, team, p, offer, roomOf(pass, team).books, minimum, false, ahead);
      if (!shaped) continue;
    }
    offer = shaped;
    if (gain < upgradeBar(league, team, offer.apy, pass.rich.get(team.id)) * bar) continue;
    if (
      planOf(pass, team).stance === 'bank' &&
      !bankBuys(p.age, gain, upgradeBar(league, team, offer.apy, pass.rich.get(team.id)))
    )
      continue;
    // Year-one charge must fit; bonus spreads, so the hit is below the APY for bigger deals.
    let plan: RestructurePlan | undefined;
    const short = yearOne(offer) - pass.budget.get(team.id)! - back(pass, team.id);
    // Can't fit his market price, but restructuring players it plans to keep could, within next year's room after
    // its needs and his own deal's: the NFL's March restructures are mostly room for free agency. A quick bound
    // first (what its deals could save, held to next year's room), then the plan itself; the room is made once he
    // has chosen the club.
    if (short > 0) plan = planFor(pass, team, p, offer, short);
    if (short > 0 && !plan) {
      // Can't fit his market price: offer what it can fit, and he takes it only if it beats his walk-away (below).
      // No cut to make room: releasing a pricier veteran for him put his bonus money on the cap at once, and by year
      // four the league's dead money passed 6% of a median cap; the late passes and the last call place him instead.
      const fitted = fitOffer(offer, pass.budget.get(team.id)! + back(pass, team.id), minimum, p.age);
      // A young man's fitted deal is a prove-it deal at the room a club has (no bonus, two years): it skips next
      // year's check, which is for the big market deals that eat a keeper's room (the owner, Nov 8).
      const young = p.age <= 28;
      if (fitted && !young && !booksOk(pass, team, p, fitted, ahead)) continue;
      if (!fitted && opts.lastCall && lift >= clear) {
        // The last call, funded: a clear upgrade it can't fit, paid for with half its in-season reserve and its
        // weakest minimum man at his spot (a minimum deal leaves no dead money).
        // A funded signing is a prove-it deal (`fitOffer`), and he takes it from his minimum up (`lastCallTakes`).
        const funded = fundedFor(pass, team, p.position, share);
        const deal = fitOffer(offer, funded.room, minimum, p.age);
        if (deal && lastCallTakes(deal, minimum))
          bids.push({ team, offer: deal, value: offerValue(league, p, team.id, deal), cut: funded.cut });
        continue;
      }
      if (!fitted || gain < upgradeBar(league, team, fitted.apy, pass.rich.get(team.id)) * bar) continue;
      const value = offerValue(league, p, team.id, fitted);
      if (value < floorFor(pass, p, team.id)) {
        fallback.push({ team, offer: fitted, value });
        continue;
      }
      offer = fitted;
    }
    if (
      !(offer.bonusPct === 0 && offer.years === 2 && p.age <= 28 && short > 0) &&
      !booksOk(pass, team, p, offer, ahead)
    )
      continue;
    const value = offerValue(league, p, team.id, offer);
    // A price fallen to the books' is an offer below his market: he weighs it as the clearing day does (`fallback`).
    if (lowered && value < floorFor(pass, p, team.id)) {
      fallback.push({ team, offer, value, plan });
      continue;
    }
    bids.push({ team, offer, value, plan, bridging });
  }
  return { bids, fallback };
}

/**
 * The restructures that would make `short` of room for `offer`, if they can: a quick bound first (what the club's deals
 * could save, held to next year's room after his own deal), then the plan itself. Nothing is changed.
 */
function planFor(pass: BidPass, team: Team, p: Player, offer: Offer, short: number): RestructurePlan | undefined {
  const r = roomOf(pass, team);
  const nextOwed = dealAdds(pass.league, p, team.id, offer, r.books)[0] ?? 0;
  const longest = Math.max(1, ...r.deals.map((x) => x.o.years));
  const bound = Math.min(
    r.deals.reduce((a, x) => a + x.o.savings, 0),
    (r.books.years[0].room - nextOwed) * (longest - 1),
  );
  if (bound < short) return undefined;
  const attempt = restructurePlan(pass.league, team, short, { deals: [{ player: p, offer }], room: r });
  return attempt.saved >= short ? attempt : undefined;
}

/**
 * The bid he takes: the best that beats what he'd walk away from. Nobody pays his floor: from the clearing day (and in
 * the late passes) the best offer made for him is his market, when it's at least half what he'd walk away from. Sights
 * by the offers clubs can make, not the calendar alone. Changes nothing.
 */
export function pickBest(pass: BidPass, p: Player, bids: Bid[], fallback: Bid[]): Bid | null {
  const best = bids.filter((b) => b.value >= floorFor(pass, p, b.team.id)).sort((a, b) => b.value - a.value)[0];
  if (best) return best;
  if (!pass.clearing || !fallback.length) return null;
  const top = [...fallback].sort((a, b) => b.value - a.value || a.team.id - b.team.id)[0];
  const minimum = minSalary(p.experience, pass.league.caps[pass.league.season]);
  return top.value >= clearingFloor(floorFor(pass, p, top.team.id), top.value, minimum) ? top : null;
}

/**
 * He signs `bid`: a club that borrows makes its room only now, a funded signing releases the man who paid for it, and
 * the pass's reads of the club move with its room and roster.
 */
export function signBid(pass: BidPass, p: Player, bid: Bid): void {
  const { league } = pass;
  const team = bid.team;
  if (bid.plan) {
    pass.budget.set(team.id, pass.budget.get(team.id)! + restructureRoom(league, team, bid.plan));
    pass.rooms.delete(team.id);
  }
  // A funded signing releases the man who paid for it first (his spot is the new man's).
  if (bid.cut) {
    releasePlayer(league, bid.cut);
    // A fringe man let go for a better one joins the squad castoffs: unsigned by the end of camp, he may leave
    // football (`retireCastoffs`), or every swap leaves one more free agent the pool never loses.
    if (league.personnel?.enabled) {
      const f = (league.personnel.futures ??= { season: league.season, kept: {} });
      (f.released ??= []).push(bid.cut.id);
    }
  }
  const before = capSpace(league, team.id);
  // Read before he signs: the new arrival can be the roster's best quarterback, no longer a young one.
  const bridgeYoung =
    p.position === 'QB' && p.age - ageShift('QB') >= 30 && bid.offer.years === 1
      ? (pass.bridge.get(team.id) ?? youngQbClub(league, team))
      : null;
  signPlayer(league, p, team.id, bid.offer);
  const signer = aiGm(league, team);
  // Logged for every GM that signs an old quarterback to a year beside a young one, habit or not (one outlook per signing).
  if (bridgeYoung) logMove(league, team, 'bridgeQb', { playerId: bridgeYoung.id });
  if (signer && draftedBy(signer, p)) logMove(league, team, 'hisGuys', { playerId: p.id });
  pass.budget.set(team.id, pass.budget.get(team.id)! - (before - capSpace(league, team.id)));
  if (!bid.cut) {
    pass.room.set(team.id, pass.room.get(team.id)! - 1);
    pass.budget.set(team.id, pass.budget.get(team.id)! + back(pass, team.id));
    pass.spots.set(team.id, Math.max(0, pass.spots.get(team.id)! - 1));
  }
  // Its room and roster moved: its funded reads are read again when next needed.
  for (const key of [...pass.funds.keys()]) if (key.startsWith(`${team.id}:`)) pass.funds.delete(key);
  pass.rich.set(team.id, richness(league, team));
  pass.rooms.delete(team.id);
  pass.signedToday.set(team.id, (pass.signedToday.get(team.id) ?? 0) + 1);
  const d = pass.depth.get(team.id)![p.position];
  d.push(teamOutlook(league, team.id, p, winNow(league, team)));
  d.sort((a, b) => b - a);
}

/**
 * `bid` raised to `apy`, if its club would still make that offer, checked as `bidsFor` checks it: the upgrade his price
 * must buy (`upgradeBar`, and a banking club's rule), the deal on its books (`shapeToBooks`: void years, then bonus go
 * first, never shorter) and its year-one charge in what it can spend or restructure. A last-call swap is checked against
 * its funded room alone, as it was made. Null when the club wouldn't. Draws nothing: a raise is the same offer at a
 * higher price, never a new one.
 */
export function raiseTo(pass: BidPass, p: Player, bid: Bid, apy: number): Bid | null {
  const { league } = pass;
  const team = bid.team;
  if (bid.cut) {
    const offer = { ...bid.offer, apy };
    if (yearOne(offer) > fundedFor(pass, team, p.position, shareOf(pass)).room) return null;
    return { ...bid, offer, value: offerValue(league, p, team.id, offer) };
  }
  const { ahead, bar, gain } = interest(pass, team, p);
  const rich = pass.rich.get(team.id);
  if (gain < upgradeBar(league, team, apy, rich) * bar) return null;
  // A banking club's stance is its plan's, read without building one (a plan draws for its keepers).
  const stance = pass.plans.get(team.id)?.stance ?? stanceFor(winNow(league, team));
  if (stance === 'bank' && !bankBuys(p.age, gain, upgradeBar(league, team, apy, rich))) return null;
  const offer = shapeToBooks(league, team, p, { ...bid.offer, apy }, roomOf(pass, team).books, false, ahead);
  if (!offer) return null;
  const short = yearOne(offer) - pass.budget.get(team.id)! - back(pass, team.id);
  const plan = short > 0 ? planFor(pass, team, p, offer, short) : undefined;
  if (short > 0 && !plan) return null;
  return { ...bid, offer, value: offerValue(league, p, team.id, offer), plan };
}
