/**
 * The deal search (docs/TRADES.md, "The GM playbook"). For a buyer and a target, the cheapest
 * package both GMs accept, from the shapes NFL front offices use: picks for a player, a player swap,
 * a player and a pick, with a late pick riding back when a package overshoots. And the cap dump: a
 * bad contract plus a sweetener to a team with room to burn (the Osweiler trade). Every package is
 * judged by `judge`, on each GM's own read.
 */
import { isExpired, yearsLeft } from '../finance/contract';
import { STARTERS } from '../positions';
import type { DealKind, DraftPick, GmTraits, League, Player, Team } from '../types';
import { KEEP_MIN } from '../offseason/ai';
import { capRoom, ovrOf, rosterOf, spendable, type TradeContext } from './context';
import { heldPick, judge, marginFor, STAR, type Judgement } from './judge';
import { CONCERNS, onFile } from './physicals';
import { isSeller, stanceOf, starterLine, teamNeeds, untouchables } from './plans';
import {
  freshlySigned,
  maxRetain,
  playerTradeBlocker,
  salaryToTake,
  type TradeProposal,
  type TradeSide,
} from './rules';
import { goingRate, marketValue, nextDraftSeason, pickValue, salaryWeight } from './value';

export interface Deal {
  proposal: TradeProposal;
  kind: DealKind;
  /** The plain-English reason the news gives it ("deadline rental", "cap dump"). */
  tag: string;
  /** The sender weighed it against cutting the player (`judge`'s `releasing`): a cap casualty or a camp cut. */
  releasing?: boolean;
}

/** Packages tried with a full verdict each way from the price: pick packages, then ones with a player. */
const TRIES = 6;
const SWAP_TRIES = 3;
/** A seller left this far ahead (about a fifth-round pick) hands back a late pick to even it out. */
const BALANCE = 40;
/** A player worth sending in a swap: about a late fourth-round pick's worth to the seller or more, not a throw-in to fill a roster spot. */
const SWAP_WORTH = 70;
/** How much better (points, in his own eyes) a swap must leave the buyer than his best pick package. */
const SWAP_EDGE = 5;

/** A team's unused picks it would trade (not a first it's holding for draft day), the most valuable to `valuer` first. */
export function picksOf(ctx: TradeContext, teamId: number, valuer: Team): DraftPick[] {
  const { league } = ctx;
  return league.draftPicks
    .filter((p) => p.ownerId === teamId && p.playerId === undefined && !heldPick(ctx, p))
    .sort((a, b) => pickValue(league, b, valuer.gm, ctx) - pickValue(league, a, valuer.gm, ctx));
}

/** What a buyer could send: single picks, pairs and triples of its best, or a player from its block the seller needs, alone or with a pick. */
export function packages(ctx: TradeContext, buyer: Team, seller: Team): TradeSide[] {
  const picks = picksOf(ctx, buyer.id, seller);
  const top = picks.slice(0, 8);
  const side = (players: number[], ps: DraftPick[]): TradeSide => ({
    teamId: buyer.id,
    players,
    picks: ps.map((p) => p.id),
  });
  const out: TradeSide[] = [
    ...picks.map((a) => side([], [a])),
    ...top.flatMap((a, i) => top.slice(i + 1).map((b) => side([], [a, b]))),
    ...top
      .slice(0, 6)
      .flatMap((a, i) =>
        top.slice(i + 1, 6).flatMap((b, j) => top.slice(i + j + 2, 6).map((c) => side([], [a, b, c]))),
      ),
  ];
  for (const p of swapPieces(ctx, buyer, seller))
    out.push(side([p.id], []), ...top.slice(0, 6).map((a) => side([p.id], [a])));
  return out;
}

/**
 * Players a buyer could send in a swap: a backup of his who would start for the seller at a
 * position it needs, or a young one for a rebuilder; never a starter of his own or an untouchable.
 * The four the seller would value most, if they're worth a swap. Worked out once per pair and pass.
 */
function swapPieces(ctx: TradeContext, buyer: Team, seller: Team): Player[] {
  const key = buyer.id * 64 + seller.id;
  const hit = ctx.swapPieces?.get(key);
  if (hit) return hit;
  const pieces = findSwapPieces(ctx, buyer, seller);
  (ctx.swapPieces ??= new Map()).set(key, pieces);
  return pieces;
}

function findSwapPieces(ctx: TradeContext, buyer: Team, seller: Team): Player[] {
  const { league } = ctx;
  const needs = new Set(teamNeeds(ctx, seller).map((n) => n.position));
  const keep = untouchables(ctx, buyer);
  const line = starterLine(ctx);
  const rank = new Map<number, number>();
  const roster = rosterOf(ctx, buyer.id).filter(
    (p) =>
      p.contract &&
      !isExpired(p.contract, league.season) &&
      !playerTradeBlocker(league, p) &&
      !freshlySigned(league, p, buyer.id),
  );
  for (const pos of new Set(roster.map((p) => p.position)))
    roster
      .filter((p) => p.position === pos)
      .sort((a, b) => ovrOf(ctx, b) - ovrOf(ctx, a))
      .forEach((p, i) => rank.set(p.id, i));
  return (
    roster
      .filter((p) => !keep.has(p.id) && rank.get(p.id)! >= STARTERS[p.position])
      .filter(
        (p) =>
          (needs.has(p.position) && ovrOf(ctx, p) >= line[p.position] - 1) ||
          (stanceOf(seller) === 'rebuild' && p.age <= 24),
      )
      // The six best on the buyer's own exact read before the seller scouts them: each read costs.
      .sort((a, b) => ovrOf(ctx, b) - ovrOf(ctx, a))
      .slice(0, 6)
      .map((p) => ({ p, v: marketValue(ctx, seller, p) }))
      .filter((x) => x.v >= SWAP_WORTH)
      .sort((a, b) => b.v - a.v)
      .slice(0, 4)
      .map((x) => x.p)
  );
}

/** What the news calls a deal. */
export function kindOf(ctx: TradeContext, seller: Team, target: Player, sent: TradeSide): DealKind {
  const { league } = ctx;
  if (sent.players.length) return 'swap';
  if (marketValue(ctx, seller, target) >= STAR) return 'star';
  if (league.phase === 'regular' && yearsLeft(target.contract!, league.season) <= 1) return 'rental';
  return isSeller(seller) ? 'sale' : 'buy';
}

export const TAGS: Record<DealKind, string> = {
  rental: 'deadline rental',
  buy: 'contender add',
  sale: 'rebuild sale',
  star: 'star trade',
  swap: 'player swap',
  dump: 'cap dump',
  futureSwap: 'future pick swap',
  cutdown: 'cut-down deal',
  casualty: 'cap casualty',
  user: '',
};

/** A pick back from a seller the package leaves well ahead: the biggest that evens it out, if both still say yes. */
function balance(ctx: TradeContext, proposal: TradeProposal, ahead: number): TradeProposal {
  if (ahead < BALANCE) return proposal;
  const [buys, sells] = proposal.sides;
  const seller = ctx.league.teams[sells.teamId];
  const back = picksOf(ctx, seller.id, seller).filter((pk) => goingRate(ctx.league, pk, ctx) <= ahead);
  for (const pk of back) {
    const tried: TradeProposal = { sides: [buys, { ...sells, picks: [...sells.picks, pk.id] }] };
    if (
      judge(ctx, seller.id, tried, { rosterCuts: true }).accepts &&
      judge(ctx, buys.teamId, tried, { rosterCuts: true }).accepts
    )
      return tried;
  }
  return proposal;
}

/** What each other team asking about a player adds to his price, and the most that competition adds. */
export const PER_BIDDER = 0.1;
export const MAX_PREMIUM = 0.2;
/**
 * The most a GM pays for a player, against what the league would pay: about 1.3 times for most, up
 * to 1.5 for an All-In GM who has to have him (Ramsey, Mack). Bounded, so a desperate buyer can't be
 * milked for firsts every deadline.
 */
export const maxOver = (gm: GmTraits) => 1.3 + 0.4 * Math.max(0, gm.winNow - 0.45);

type Tried = { proposal: TradeProposal; sells: Judgement; buys: Judgement };

/** A quick read of a package at the league's prices (the going rate, market value on `valuer`'s read), before the full verdicts. */
export function quickValue(ctx: TradeContext, valuer: Team, side: TradeSide): number {
  const { league } = ctx;
  return (
    side.picks.reduce((s, id) => s + goingRate(league, league.draftPicks.find((x) => x.id === id)!, ctx), 0) +
    side.players.reduce((s, id) => s + marketValue(ctx, valuer, league.players[id]), 0)
  );
}

/**
 * The package for `target` that his team and `buyer` both accept, or null. The seller asks what the
 * league would pay for him, more when other teams are asking too, never less than his floor nor more
 * than the buyer could pay: a desperate buyer's need is his own business, competition is what raises
 * a price. The buyer sends whichever of picks or a player costs him less in his own eyes.
 */
/**
 * Whether `dealFor` can price `p` at all: a buyer offers at most a multiple of what he's worth to his
 * own team, so one worth nothing there can't be bought for anything (a bad contract goes as a dump).
 */
export const priceable = (ctx: TradeContext, p: Player) =>
  p.teamId !== null && marketValue(ctx, ctx.league.teams[p.teamId], p) > 0;

export function dealFor(ctx: TradeContext, buyer: Team, target: Player): Deal | null {
  const { league } = ctx;
  const seller = league.teams[target.teamId!];
  // A buyer who can't fit his salary gets him only if the seller keeps paying the difference (and asks more for it).
  const retain = keepToFit(league, target, spendable(ctx, buyer.id));
  if (retain === null) return null;
  const theirs: TradeSide = {
    teamId: seller.id,
    players: [target.id],
    picks: [],
    ...(retain ? { retain: { [target.id]: retain } } : {}),
  };
  const nothing: TradeProposal = { sides: [{ teamId: buyer.id, players: [], picks: [] }, theirs] };
  const ask = judge(ctx, seller.id, nothing).need;
  const most = judge(ctx, buyer.id, nothing, { rosterCuts: true }).get / marginFor(buyer, seller);
  const bidders = (league.market?.interest ?? []).filter(
    (x) => x.playerId === target.id && x.teamId !== buyer.id,
  ).length;
  const worth = marketValue(ctx, seller, target);
  const asking = worth * (1 + Math.min(MAX_PREMIUM, PER_BIDDER * bidders));
  const price = Math.max(ask, Math.min(asking, most));
  // A seller who wants more than that for him isn't really selling.
  const ceiling = Math.max(maxOver(buyer.gm) * worth, 0);
  const quick = (side: TradeSide) => quickValue(ctx, seller, side);
  const all = packages(ctx, buyer, seller);
  const affordable = all.filter((x) => quick(x) <= ceiling);
  const picks = search(
    ctx,
    buyer,
    seller,
    theirs,
    affordable.filter((x) => !x.players.length),
    quick,
    ask,
    price,
    TRIES,
  );
  const swap = search(
    ctx,
    buyer,
    seller,
    theirs,
    affordable.filter((x) => x.players.length),
    quick,
    ask,
    price,
    SWAP_TRIES,
  );
  // Picks are the NFL's currency: a player goes the other way only when that's clearly cheaper.
  const net = (t: Tried | null) => (t ? t.buys.get - t.buys.give : -Infinity);
  const best = net(swap) > net(picks) + SWAP_EDGE ? swap : picks;
  if (!best) return null;
  const kind = kindOf(ctx, seller, target, best.proposal.sides[0]);
  const label = target.contract?.kind === 'tag' ? 'tag and trade' : TAGS[kind];
  return {
    proposal: balance(ctx, best.proposal, quick(best.proposal.sides[0]) - price),
    kind,
    tag: retain ? `${label}, salary retained` : label,
  };
}

/**
 * What a seller must keep paying for a buyer with `room` to fit `p`'s salary: 0 if he fits, a round
 * amount a little over the gap if the seller can cover it (in season only), null if not even that does.
 */
export function keepToFit(league: League, p: Player, room: number): number | null {
  const gap = salaryToTake(league, p) - room;
  if (gap <= 0) return 0;
  // A season's trade, when buyers have spent their room: in the offseason there's room to make, not salary to keep.
  if (league.phase !== 'regular') return null;
  const keep = Math.ceil((gap + 100) / 50) * 50;
  return keep <= maxRetain(league, p) ? keep : null;
}

/**
 * The first of `sides` both GMs take: the cheapest at or above the price first (the seller's
 * opening ask), then down from it toward his floor (the buyer haggling). Each run stops early once
 * the side it leans on has said no twice: dearer packages won't win back a buyer, cheaper ones a seller.
 */
function search(
  ctx: TradeContext,
  buyer: Team,
  seller: Team,
  theirs: TradeSide,
  sides: TradeSide[],
  quick: (s: TradeSide) => number,
  ask: number,
  price: number,
  n: number,
): Tried | null {
  const valued = sides.map((side) => ({ side, value: quick(side) })).filter((x) => x.value >= ask * 0.9);
  const up = valued
    .filter((x) => x.value >= price)
    .sort((a, b) => a.value - b.value)
    .slice(0, n);
  const down = valued
    .filter((x) => x.value < price)
    .sort((a, b) => b.value - a.value)
    .slice(0, n);
  for (const [run, leans] of [
    [up, 'buyer'],
    [down, 'seller'],
  ] as const) {
    let refused = 0;
    for (const { side } of run) {
      if (refused >= 2) break;
      const proposal: TradeProposal = { sides: [side, theirs] };
      const sells = judge(ctx, seller.id, proposal, { rosterCuts: true });
      if (!sells.accepts) {
        if (leans === 'seller') refused++;
        continue;
      }
      const buys = judge(ctx, buyer.id, proposal, { rosterCuts: true });
      if (buys.accepts) return { proposal, sells, buys };
      if (leans === 'buyer') refused++;
    }
  }
  return null;
}

/** The worst contract a team takes on in a dump, in points under water: about a late first (Osweiler's was a second's worth). Bigger busts get cut. */
export const DUMP_LIMIT = 600;

/**
 * A cap-strapped team pays to move a bad contract: to a team with room (a low salary weight) that
 * takes it on for the cheapest pick it will, or for nothing if the contract isn't that bad.
 */
export function dumpFor(
  ctx: TradeContext,
  sender: Team,
  player: Player,
  among: readonly Team[],
  opts: { releasing?: boolean } = {},
): Deal | null {
  const { league } = ctx;
  // A player it would cut anyway that a team takes for nothing is a late-pick sale's (`lateSale`), not a dump.
  const first = opts.releasing ? 1 : 0;
  if (onFile(league, player) >= CONCERNS) return null;
  const absorbers = among
    .filter(
      (t) =>
        t.id !== sender.id &&
        salaryWeight(ctx, t.id) <= 0.85 &&
        spendable(ctx, t.id) >= 1.1 * salaryToTake(league, player),
    )
    .sort((a, b) => salaryWeight(ctx, a.id) - salaryWeight(ctx, b.id))
    .slice(0, 4);
  for (const absorber of absorbers) {
    if (marketValue(ctx, absorber, player) < -DUMP_LIMIT) continue;
    const sweeteners = [null, ...picksOf(ctx, sender.id, absorber).reverse().slice(0, 14)].slice(first);
    for (const pk of sweeteners) {
      const proposal: TradeProposal = {
        sides: [
          { teamId: sender.id, players: [player.id], picks: pk ? [pk.id] : [] },
          { teamId: absorber.id, players: [], picks: [] },
        ],
      };
      if (
        judge(ctx, absorber.id, proposal, { rosterCuts: true }).accepts &&
        judge(ctx, sender.id, proposal, { rosterCuts: true, releasing: opts.releasing }).accepts
      )
        return { proposal, kind: 'dump', tag: TAGS.dump, ...(opts.releasing ? { releasing: true } : {}) };
    }
  }
  return null;
}

/** The rounds a team gives for another's surplus player: "depth for a 6th or 7th". */
const LATE_ROUND = 6;
/** How many teams a front office calls about a player it's about to cut. */
const LATE_CALLS = 6;

/**
 * A player his team is about to cut (a cap casualty, the cut to 53), sold for a 6th or 7th to a team
 * that would keep him: one where he'd be among the players it can't go below at his position, with
 * the room to pay him. His team takes any pick over the release (`releasing`); the buyer judges him
 * like any player. `keeps` is the buyer's last word (in camp: would he survive its own cut to 53?).
 */
export function lateSale(
  ctx: TradeContext,
  seller: Team,
  p: Player,
  among: readonly Team[],
  kind: 'cutdown' | 'casualty',
  keeps: (buyer: Team) => boolean = () => true,
): Deal | null {
  const { league } = ctx;
  if (onFile(league, p) >= CONCERNS) return null;
  const owed = salaryToTake(league, p);
  const ovr = ovrOf(ctx, p);
  const bars = among
    .filter((b) => b.id !== seller.id && capRoom(ctx, b.id) >= owed)
    .map((b) => {
      const room = rosterOf(ctx, b.id)
        .filter((x) => x.position === p.position && !x.ir && !x.injury)
        .map((x) => ovrOf(ctx, x))
        .sort((x, y) => y - x);
      return { b, bar: room[KEEP_MIN[p.position] - 1] ?? 0 };
    })
    .filter((x) => ovr > x.bar)
    // The thinnest rooms call first.
    .sort((x, y) => x.bar - y.bar)
    .slice(0, LATE_CALLS);
  for (const { b } of bars) {
    for (const pk of picksOf(ctx, b.id, seller)
      .filter((x) => x.round >= LATE_ROUND)
      .reverse()
      .slice(0, 2)) {
      const proposal: TradeProposal = {
        sides: [
          { teamId: seller.id, players: [p.id], picks: [] },
          { teamId: b.id, players: [], picks: [pk.id] },
        ],
      };
      if (
        judge(ctx, seller.id, proposal, { rosterCuts: true, releasing: true }).accepts &&
        judge(ctx, b.id, proposal, { rosterCuts: true }).accepts &&
        keeps(b)
      )
        return { proposal, kind, tag: TAGS[kind], releasing: true };
    }
  }
  return null;
}

/** GMs who want help now (they discount the future steeply) and patient ones (they barely do). */
const NOW_GM = 0.3;
const PATIENT_GM = 0.22;

/**
 * Next year's pick for this year's, a round later (the NFL's "a round a year"): a GM who wants help
 * now trades his future pick to a patient one before the draft. Each prices the pair on his own
 * future discount, so both can come out ahead in their own eyes.
 */
export function pickSwapFor(ctx: TradeContext, team: Team, among: readonly Team[]): Deal | null {
  const { league } = ctx;
  if (team.gm.futureDiscount < NOW_GM || (league.phase !== 'resign' && league.phase !== 'freeAgency')) return null;
  const draft = nextDraftSeason(league);
  const future = picksOf(ctx, team.id, team).filter((p) => p.season === draft + 1 && p.round >= 2 && p.round <= 5);
  for (const partner of among.filter((t) => t.id !== team.id && t.gm.futureDiscount <= PATIENT_GM)) {
    const now = picksOf(ctx, partner.id, partner).filter((p) => p.season === draft);
    for (const f of future) {
      const c = now.find((p) => p.round === f.round + 1);
      if (!c) continue;
      const proposal: TradeProposal = {
        sides: [
          { teamId: team.id, players: [], picks: [f.id] },
          { teamId: partner.id, players: [], picks: [c.id] },
        ],
      };
      if (judge(ctx, team.id, proposal).accepts && judge(ctx, partner.id, proposal).accepts)
        return { proposal, kind: 'futureSwap', tag: TAGS.futureSwap };
    }
  }
  return null;
}
