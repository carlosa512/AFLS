/**
 * The deal search (docs/TRADES.md, "The GM playbook"). For a buyer and a target, the cheapest
 * package both GMs accept, from the shapes NFL front offices use: picks for a player, a player swap,
 * a player and a pick, with a late pick riding back when a package overshoots. And the cap dump: a
 * bad contract plus a sweetener to a team with room to burn (the Osweiler trade). Every package is
 * judged by `judge`, on each GM's own read.
 */
import { yearsLeft } from '../finance/contract';
import type { DealKind, DraftPick, Player, Team } from '../types';
import { capRoom, type TradeContext } from './context';
import { judge, STAR } from './judge';
import { isSeller, teamNeeds, tradeBlock } from './plans';
import { salaryToTake, type TradeProposal, type TradeSide } from './rules';
import { marketValue, pickValue, salaryWeight } from './value';

export interface Deal {
  proposal: TradeProposal;
  kind: DealKind;
  /** The plain-English reason the news gives it ("deadline rental", "cap dump"). */
  tag: string;
}

/** Packages tried with a full verdict per target: the cheapest pick packages that clear the seller's ask, then a few with a player. */
const TRIES = 10;
const SWAP_TRIES = 4;
/** A seller left this far ahead hands back a late pick to even it out. */
const BALANCE = 15;

/** A team's unused picks, the most valuable to `valuer` first. */
function picksOf(ctx: TradeContext, teamId: number, valuer: Team): DraftPick[] {
  const { league } = ctx;
  return league.draftPicks
    .filter((p) => p.ownerId === teamId && p.playerId === undefined)
    .sort((a, b) => pickValue(league, b, valuer.gm, ctx) - pickValue(league, a, valuer.gm, ctx));
}

/** What a buyer could send: single picks, pairs and triples of its best, or a player from its block the seller needs, alone or with a pick. */
function packages(ctx: TradeContext, buyer: Team, seller: Team): TradeSide[] {
  const { league } = ctx;
  const picks = picksOf(ctx, buyer.id, seller);
  const top = picks.slice(0, 8);
  const side = (players: number[], ps: DraftPick[]): TradeSide => ({ teamId: buyer.id, players, picks: ps.map((p) => p.id) });
  const out: TradeSide[] = [
    ...picks.map((a) => side([], [a])),
    ...top.flatMap((a, i) => top.slice(i + 1).map((b) => side([], [a, b]))),
    ...top.slice(0, 6).flatMap((a, i) => top.slice(i + 1, 6).flatMap((b, j) => top.slice(i + j + 2, 6).map((c) => side([], [a, b, c])))),
  ];
  const needs = new Set(teamNeeds(ctx, seller).map((n) => n.position));
  for (const entry of tradeBlock(ctx, buyer)) {
    const p = league.players[entry.playerId];
    if (!needs.has(p.position) || entry.reason === 'overpaid') continue;
    out.push(side([p.id], []), ...top.slice(0, 6).map((a) => side([p.id], [a])));
  }
  return out;
}

/** What the news calls a deal. */
function kindOf(ctx: TradeContext, seller: Team, target: Player, sent: TradeSide): DealKind {
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
  user: '',
};

/** A late pick back from a seller the package leaves well ahead, if both still say yes. */
function balance(ctx: TradeContext, proposal: TradeProposal, ahead: number): TradeProposal {
  if (ahead < BALANCE) return proposal;
  const [buys, sells] = proposal.sides;
  const seller = ctx.league.teams[sells.teamId];
  const back = picksOf(ctx, seller.id, seller).reverse().slice(0, 6);
  for (const pk of back) {
    const tried: TradeProposal = { sides: [buys, { ...sells, picks: [...sells.picks, pk.id] }] };
    if (judge(ctx, seller.id, tried, { rosterCuts: true }).accepts && judge(ctx, buys.teamId, tried, { rosterCuts: true }).accepts) return tried;
  }
  return proposal;
}

/** The cheapest package for `target` that his team and `buyer` both accept, or null. */
export function dealFor(ctx: TradeContext, buyer: Team, target: Player): Deal | null {
  const { league } = ctx;
  const seller = league.teams[target.teamId!];
  if (salaryToTake(league, target) > capRoom(ctx, buyer.id)) return null;
  const theirs: TradeSide = { teamId: seller.id, players: [target.id], picks: [] };
  const ask = judge(ctx, seller.id, { sides: [{ teamId: buyer.id, players: [], picks: [] }, theirs] }).need;
  // Rank packages by a quick read of what they're worth to the seller, then judge the cheapest.
  const quick = (side: TradeSide) =>
    side.picks.reduce((s, id) => s + pickValue(league, league.draftPicks.find((x) => x.id === id)!, seller.gm, ctx), 0) +
    side.players.reduce((s, id) => s + marketValue(ctx, seller, league.players[id]), 0);
  // Picks first, as in the NFL; a player goes the other way only when no pick package works.
  const rank = (sides: TradeSide[], n: number) =>
    sides
      .map((side) => ({ side, value: quick(side) }))
      .filter((x) => x.value >= ask * 0.9)
      .sort((a, b) => a.value - b.value)
      .slice(0, n);
  const all = packages(ctx, buyer, seller);
  const ranked = [...rank(all.filter((x) => !x.players.length), TRIES), ...rank(all.filter((x) => x.players.length), SWAP_TRIES)];
  for (const { side } of ranked) {
    const proposal: TradeProposal = { sides: [side, theirs] };
    const sells = judge(ctx, seller.id, proposal, { rosterCuts: true });
    if (!sells.accepts || !judge(ctx, buyer.id, proposal, { rosterCuts: true }).accepts) continue;
    const kind = kindOf(ctx, seller, target, side);
    return { proposal: balance(ctx, proposal, sells.get - sells.need), kind, tag: TAGS[kind] };
  }
  return null;
}

/**
 * A cap-strapped team pays to move a bad contract: to a team with room (a low salary weight) that
 * takes it on for the cheapest pick it will, or for nothing if the contract isn't that bad.
 */
export function dumpFor(ctx: TradeContext, sender: Team, player: Player, among: readonly Team[]): Deal | null {
  const { league } = ctx;
  const absorbers = among
    .filter((t) => t.id !== sender.id && salaryWeight(ctx, t.id) <= 0.85 && capRoom(ctx, t.id) >= 1.1 * salaryToTake(league, player))
    .sort((a, b) => salaryWeight(ctx, a.id) - salaryWeight(ctx, b.id))
    .slice(0, 4);
  for (const absorber of absorbers) {
    const sweeteners = [null, ...picksOf(ctx, sender.id, absorber).reverse().slice(0, 14)];
    for (const pk of sweeteners) {
      const proposal: TradeProposal = { sides: [{ teamId: sender.id, players: [player.id], picks: pk ? [pk.id] : [] }, { teamId: absorber.id, players: [], picks: [] }] };
      if (judge(ctx, absorber.id, proposal, { rosterCuts: true }).accepts && judge(ctx, sender.id, proposal, { rosterCuts: true }).accepts) return { proposal, kind: 'dump', tag: TAGS.dump };
    }
  }
  return null;
}
