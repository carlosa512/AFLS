/**
 * Draft day (docs/TRADES.md, section 6 and Phase 4). Teams trade picks on the clock for the reasons NFL front offices
 * give: a team trades up when the player it wants most won't last to its own pick and nobody it would take there is
 * as good (a tier break); the team on the clock trades down when it would get a player about as good later (it sees
 * a tier), when its flat chart prizes the extra pick, when it has holes to fill, or when its GM hoards picks.
 *
 * Covet is that wish in trade points: how much better a team's man at the earlier pick is, on its own board, than the
 * best it expects at the later one, as a share of the earlier pick's value on its own chart. `judge` adds it to both
 * sides' stakes in the draft, so every draft deal (the AI's, offers to you, your own proposals, counters) goes
 * through the one evaluator. Boards are each team's own (`boardOf`: its scouts' read leaned on the consensus).
 */
import { sizeBias } from '../gmTraits';
import {
  availableProspects,
  availableRanks,
  boardOf,
  boardScore,
  draftOrder,
  nextPick,
  picksAhead,
  positionDepth,
  type BoardMemo,
} from '../offseason/draft';
import { STARTERS } from '../positions';
import { clamp, type Rng } from '../rng';
import type { Advice } from './advice';
import type { DraftPick, League, Player, Position, Team, TradeOffer, Transaction } from '../types';
import { pickOf, refreshAfterTrade, tradeContext, type TradeContext } from './context';
import { TAGS, pickSwapFor, quickValue, type Deal } from './deals';
import { emptyMarket, executeTrade } from './execute';
import { judge } from './judge';
import { dealWatch } from './market';
import { file, openOffers } from './offers';
import { teamNeeds } from './plans';
import { tradeWindow, type TradeProposal, type TradeSide } from './rules';
import { goingRate, pickValue } from './value';

/** A switch for the checks and tests: with it on, the draft runs with no trades and covet is zero. */
export const draftTrades: { off?: boolean } = {};

/** Board points that make a full share of covet (about a round's drop in grade), and the most a pick's value grows by it. */
export const COVET_SCALE = 2;
export const COVET_MAX = 0.6;
/** The tier break a team needs before it calls about moving up: its man must stand this far above its best later. */
export const COVET_MIN = 0.8;
/** What a Pick Hoarder adds to every pick coming in, and a team with three or more holes. */
export const HOARDER_PICKS = 0.1;
export const MANY_HOLES = 0.05;
/** A need this urgent is a hole a second pick would fill. */
const HOLE = 0.6;

interface DraftMemo {
  season: number;
  /** The last log line the reads were made after: every pick and every trade logs one. */
  seen: Transaction | undefined;
  boards: BoardMemo;
  ranks: Map<number, number>;
  pool: Player[];
  /** Each team's depth and its noise-free board scores by prospect and round, until a log line names the team. */
  depth: Map<number, Record<Position, number[]>>;
  scores: Map<number, Map<number, number>>;
  bias: Map<number, number>;
  expected: Map<string, { best: Player | null; score: number }>;
  clock: DraftPick | undefined;
}
const memos = new WeakMap<League, DraftMemo>();

/**
 * This draft's reads. Boards last the draft (a view doesn't move); a pick or a trade logs a line, which moves the
 * board and the clock, and the teams it names get their depth and scores read again.
 */
function memoOf(league: League): DraftMemo {
  const log = league.transactions;
  const last = log[log.length - 1];
  let m = memos.get(league);
  if (!m || m.season !== league.season) {
    m = {
      season: league.season,
      seen: undefined,
      boards: new Map(),
      ranks: new Map(),
      pool: [],
      depth: new Map(),
      scores: new Map(),
      bias: new Map(),
      expected: new Map(),
      clock: undefined,
    };
    memos.set(league, m);
  }
  if (m.seen !== last || !m.clock) {
    // The new lines since the last read, back to the one seen (a long gap, or a trimmed log, reads everyone again).
    let found = false;
    for (let i = log.length - 1; i >= Math.max(0, log.length - 50); i--) {
      if (log[i] === m.seen) {
        found = true;
        break;
      }
      for (const id of log[i].teamIds) {
        m.depth.delete(id);
        m.scores.delete(id);
      }
    }
    if (!found) {
      m.depth.clear();
      m.scores.clear();
    }
    m.seen = last;
    m.clock = nextPick(league);
    m.ranks = availableRanks(league);
    m.pool = availableProspects(league);
    m.expected.clear();
  }
  return m;
}

/** A team's own board entry for a prospect, kept for the draft. */
function boardFor(league: League, teamId: number, p: Player) {
  const m = memoOf(league);
  let mine = m.boards.get(teamId);
  if (!mine) m.boards.set(teamId, (mine = new Map()));
  let board = mine.get(p.id);
  if (!board) mine.set(p.id, (board = boardOf(league, teamId, p)));
  return board;
}

/** A team's overalls by position while this pick is on the clock. */
function depthOf(league: League, teamId: number): Record<Position, number[]> {
  const m = memoOf(league);
  let depth = m.depth.get(teamId);
  if (!depth) m.depth.set(teamId, (depth = positionDepth(league, teamId)));
  return depth;
}

/** A front office's board score for a prospect with no pick-day noise: its own read, its depth, its GM's taste. */
export function boardBase(league: League, teamId: number, p: Player, round: number): number {
  const m = memoOf(league);
  let mine = m.scores.get(teamId);
  if (!mine) m.scores.set(teamId, (mine = new Map()));
  // Rounds only matter to a specialist: keyed by prospect and round.
  const key = p.id * 8 + round;
  const hit = mine.get(key);
  if (hit !== undefined) return hit;
  let bias = m.bias.get(teamId);
  if (bias === undefined) {
    const gmId = league.teams[teamId].gmId;
    bias = gmId == null || teamId === league.userTeamId ? 0 : sizeBias(league.seed, gmId);
    m.bias.set(teamId, bias);
  }
  const score = boardScore(depthOf(league, teamId), p, boardFor(league, teamId, p), null, round, bias);
  mine.set(key, score);
  return score;
}

/** Picks made before `pick` comes up, counting the one on the clock (0 for the pick on the clock). */
export function picksBefore(league: League, pick: DraftPick): number {
  const clock = memoOf(league).clock;
  return clock && pick.overall !== undefined ? pick.overall - clock.overall! : Infinity;
}

/**
 * The best a team expects at a pick: its top board score among the prospects likely still there, those the
 * consensus ranks past the picks before it (everyone, for the pick on the clock).
 */
export function expectedAt(
  league: League,
  teamId: number,
  pick: DraftPick,
  skip?: ReadonlySet<number>,
): { best: Player | null; score: number } {
  const m = memoOf(league);
  const key = `${teamId}:${pick.id}${skip?.size ? `:${[...skip].join(',')}` : ''}`;
  const hit = m.expected.get(key);
  if (hit) return hit;
  const before = picksBefore(league, pick);
  let best: Player | null = null;
  let score = -Infinity;
  for (const p of m.pool) {
    if ((m.ranks.get(p.id) ?? Infinity) <= before || skip?.has(p.id)) continue;
    const s = boardBase(league, teamId, p, pick.round);
    if (s > score) {
      best = p;
      score = s;
    }
  }
  const out = { best, score };
  m.expected.set(key, out);
  return out;
}

const NONE = { get: 0, give: 0 };

/** This draft's unused picks among `ids`, earliest first. */
const current = (ctx: TradeContext, ids: readonly number[]) =>
  ids
    .map((id) => pickOf(ctx, id)!)
    .filter((pk) => pk && pk.season === ctx.league.season && pk.overall !== undefined && pk.playerId === undefined)
    .sort((a, b) => a.overall! - b.overall!);

/**
 * Covet for an AI team in a draft deal, in its own trade points: `get` for moving up to its man (and for picks a
 * Pick Hoarder or a team full of holes wants), `give` for passing on its man now. Zero outside the draft and for you.
 */
export function draftCovet(ctx: TradeContext, teamId: number, proposal: TradeProposal): { get: number; give: number } {
  const { league } = ctx;
  if (draftTrades.off || league.phase !== 'draft' || teamId === league.userTeamId) return NONE;
  const mine = proposal.sides.find((s) => s.teamId === teamId);
  const theirs = proposal.sides.find((s) => s.teamId !== teamId);
  if (!mine || !theirs) return NONE;
  const ins = current(ctx, theirs.picks);
  const outs = current(ctx, mine.picks);
  if (!ins.length && !outs.length) return NONE;
  const team = league.teams[teamId];
  const kept = league.draftPicks
    .filter(
      (pk) =>
        pk.ownerId === teamId &&
        pk.season === league.season &&
        pk.overall !== undefined &&
        pk.playerId === undefined &&
        !mine.picks.includes(pk.id),
    )
    .sort((a, b) => a.overall! - b.overall!)[0];
  // What its man at the earlier pick is worth over its best at the pick it would use otherwise.
  const points = (early: DraftPick, later: DraftPick | undefined) => {
    if (!later) return 0;
    const gap = expectedAt(league, teamId, early).score - expectedAt(league, teamId, later).score;
    return pickValue(league, early, team.gm, ctx) * clamp(gap / COVET_SCALE, 0, COVET_MAX);
  };
  const [eIn, eOut] = [ins[0], outs[0]];
  let get = 0;
  let give = 0;
  if (eIn && (!eOut || eIn.overall! < eOut.overall!)) get += points(eIn, eOut ?? kept);
  if (eOut && (!eIn || eOut.overall! < eIn.overall!)) give += points(eOut, eIn ?? kept);
  const coming = theirs.picks.reduce((s, id) => s + pickValue(league, pickOf(ctx, id)!, team.gm, ctx), 0);
  if (team.gm.archetype === 'Pick Hoarder') get += HOARDER_PICKS * coming;
  if (teamNeeds(ctx, team).filter((n) => n.urgency >= HOLE).length >= 3) get += MANY_HOLES * coming;
  return { get, give };
}

// ───────── the AI's calls before each pick ─────────

/** The positions teams trade up for most (ESPN's 242 trade-ups: 38% of their picks, under 30% for teams that stay put). */
export const PREMIUM: ReadonlySet<Position> = new Set<Position>(['QB', 'EDGE', 'OL', 'CB', 'WR']);
/** How far ahead of its own pick a team looks to move up, and the longest jump for anyone but a QB. */
export const WINDOW = 10;
export const LONG_JUMP = 8;
/** Trade-ups a team makes in one draft at most. */
export const MAX_TRADE_UPS = 2;
/** The chance a pick's phones ring with a future-for-current pick swap ("our 2028 2nd for your 3rd now"). */
export const DRAFT_SWAP_RATE = 0.03;
/** Calls made before one pick, and add-ons tried in each. */
const CALLS = 3;
const ADD_ONS = 3;

/** Draft-day trade-ups a team has made this draft (it sent the later pick). */
const tradeUps = (league: League, teamId: number) =>
  (league.market?.history ?? []).filter(
    (r) => r.kind === 'draft' && r.season === league.season && r.sides[0].teamId === teamId,
  ).length;

const thin = (depth: Record<Position, number[]>, pos: Position) => depth[pos].length < STARTERS[pos] + 1;

/**
 * Why `team` would move up from `own` to the pick on the clock, or null: its man is at a position it needs or a
 * premium one, he likely won't last to its pick (the consensus has him inside the picks before it, or just past
 * them with a run on his position coming), and he stands a tier above its best there. A jump past `LONG_JUMP` is
 * for a quarterback it wants badly; two trade-ups a draft at most; no specialist before round 5.
 */
export function tradeUpReason(ctx: TradeContext, team: Team, own: DraftPick): { target: Player; gap: number } | null {
  const { league } = ctx;
  const clock = nextPick(league);
  if (!clock || own.overall === undefined) return null;
  const before = own.overall - clock.overall!;
  if (before < 1 || before > WINDOW || tradeUps(league, team.id) >= MAX_TRADE_UPS) return null;
  const { best: target, score } = expectedAt(league, team.id, clock);
  if (!target) return null;
  const pos = target.position;
  if ((pos === 'K' || pos === 'P') && clock.round < 5) return null;
  const depth = depthOf(league, team.id);
  const weakest = depth[pos][STARTERS[pos] - 1] ?? 0;
  if (!thin(depth, pos) && weakest >= boardFor(league, team.id, target).grade && !PREMIUM.has(pos)) return null;
  const rank = memoOf(league).ranks.get(target.id) ?? Infinity;
  const between = new Set(
    picksAhead(league, before - 1)
      .map((p) => p.ownerId)
      .filter((id) => id !== team.id),
  );
  const run = [...between].filter((id) => thin(depthOf(league, id), pos)).length >= 2;
  if (rank > before && !(run && rank <= before + 3)) return null;
  const gap = score - expectedAt(league, team.id, own, new Set([target.id])).score;
  if (gap < COVET_MIN) return null;
  if (before > LONG_JUMP && !(pos === 'QB' && gap >= 2 * COVET_MIN)) return null;
  return { target, gap };
}

/** A pick in the deal line: this draft's by its slot, a later one by year and round. */
const dealLabel = (league: League, pk: DraftPick) =>
  pk.season === league.season && pk.overall !== undefined ? `No. ${pk.overall}` : `${pk.season} round ${pk.round}`;

/** Mark this draft's picks in a deal as moved: who sent each one and what it got. */
export function pickMoved(league: League, proposal: TradeProposal): void {
  proposal.sides.forEach((side, i) => {
    const got = proposal.sides[1 - i].picks.map((id) => dealLabel(league, league.draftPicks.find((p) => p.id === id)!));
    for (const id of side.picks) {
      const pk = league.draftPicks.find((p) => p.id === id)!;
      if (pk.season === league.season && pk.playerId === undefined) pk.moved = { from: side.teamId, got };
    }
  });
}

/** An agreed draft deal into the books (picks have no physical). */
function closeDraftDeal(ctx: TradeContext, deal: Deal): void {
  dealWatch.onClose?.(ctx, deal, deal.proposal);
  pickMoved(ctx.league, deal.proposal);
  executeTrade(ctx.league, deal.proposal, { kind: deal.kind, tag: deal.tag });
  lapseUsedPicks(ctx.league);
  refreshAfterTrade(
    ctx,
    deal.proposal.sides.map((s) => s.teamId),
    [],
  );
}

/** A rookie just drafted joins his team in the run's trade context, so its needs read the roster it now has. */
export function draftedInto(ctx: TradeContext, teamId: number, player: Player): void {
  ctx.rosters.get(teamId)?.push(player);
  ctx.needs?.delete(teamId);
}

/**
 * The calls before an AI team's pick: now and then a future-for-current swap, then the teams behind it that want to
 * move up for their man, the keenest first, at most three. Each offers its own pick plus the cheapest add-on both GMs
 * accept (on their own charts, covet counted). Returns the team now on the clock and the prospect it moved up for.
 */
export function draftCalls(ctx: TradeContext, rng: Rng): { buyer: number; target: number } | null {
  const { league } = ctx;
  if (draftTrades.off) return null;
  const ai = league.teams.filter((t) => t.id !== league.userTeamId);
  if (rng.chance(DRAFT_SWAP_RATE)) {
    const team = rng.pick(ai);
    const swap = pickSwapFor(
      ctx,
      team,
      ai.filter((t) => t.id !== team.id),
    );
    if (swap) closeDraftDeal(ctx, swap);
  }
  const clock = nextPick(league);
  if (!clock || clock.ownerId === league.userTeamId) return null;
  const seller = league.teams[clock.ownerId];
  const seen = new Set<number>([seller.id, league.userTeamId]);
  const calls: { team: Team; own: DraftPick; target: Player; gap: number }[] = [];
  for (const own of picksAhead(league, WINDOW)) {
    if (seen.has(own.ownerId)) continue;
    seen.add(own.ownerId);
    const team = league.teams[own.ownerId];
    const why = tradeUpReason(ctx, team, own);
    if (why) calls.push({ team, own, ...why });
  }
  calls.sort((a, b) => b.gap - a.gap);
  for (const { team, own, target } of calls.slice(0, CALLS)) {
    const offer = (picks: number[]): TradeProposal => ({
      sides: [
        { teamId: team.id, players: [], picks },
        { teamId: seller.id, players: [], picks: [clock.id] },
      ],
    });
    const accepts = (p: TradeProposal) =>
      judge(ctx, seller.id, p, { rosterCuts: true }).accepts && judge(ctx, team.id, p, { rosterCuts: true }).accepts;
    let deal: TradeProposal | null = null;
    const alone = offer([own.id]);
    const ask = judge(ctx, seller.id, alone, { rosterCuts: true });
    if (accepts(alone)) deal = alone;
    else if (!ask.problem && !ask.refusal) {
      // The cheapest add-on in the buyer's eyes among those that cover most of what the seller is short.
      const short = ask.need - ask.get;
      const addOns = league.draftPicks
        .filter(
          (pk) =>
            pk.ownerId === team.id &&
            pk.playerId === undefined &&
            pk.id !== own.id &&
            (pk.season === league.season + 1 || (pk.season === league.season && pk.overall! > own.overall!)) &&
            pickValue(league, pk, seller.gm, ctx) >= 0.8 * short,
        )
        .sort((a, b) => pickValue(league, a, team.gm, ctx) - pickValue(league, b, team.gm, ctx))
        .slice(0, ADD_ONS);
      for (const pk of addOns) {
        const tried = offer([own.id, pk.id]);
        if (accepts(tried)) {
          deal = tried;
          break;
        }
      }
    }
    if (!deal) continue;
    closeDraftDeal(ctx, { proposal: deal, kind: 'draft', tag: TAGS.draft });
    return { buyer: team.id, target: target.id };
  }
  return null;
}

/**
 * Offers to you hang on their picks: once a pick in one is used it lapses, and once one has moved to another team it's
 * off. No cooldown either way: nobody turned anybody down.
 */
export function lapseUsedPicks(league: League): void {
  const byId = (id: number) => league.draftPicks.find((p) => p.id === id);
  for (const o of league.market?.offers ?? []) {
    if (o.status !== 'pending' || !(o.sides[0].picks.length || o.sides[1].picks.length)) continue;
    const used = (side: TradeSide) => side.picks.some((id) => byId(id)?.playerId !== undefined);
    const moved = (side: TradeSide) => side.picks.some((id) => byId(id)?.ownerId !== side.teamId);
    if (used(o.sides[0]) || used(o.sides[1])) {
      o.status = 'expired';
      o.outcome = used(o.sides[1]) ? 'It lapsed when you picked.' : 'It lapsed when the pick was made.';
    } else if (moved(o.sides[0]) || moved(o.sides[1])) {
      o.status = 'withdrawn';
      o.outcome = 'A pick in it has moved since, so it’s off the table.';
    }
  }
}

// ───────── calls to you ─────────

/** Open offers and asks to you that hang on a pick of this draft: the draft room shows them under the clock. */
export function draftDayOffers(league: League): TradeOffer[] {
  if (league.phase !== 'draft') return [];
  const live = (id: number) => {
    const pk = league.draftPicks.find((p) => p.id === id);
    return !!pk && pk.season === league.season && pk.playerId === undefined;
  };
  return openOffers(league).filter((o) => [...o.sides[0].picks, ...o.sides[1].picks].some(live));
}

/** Draft offers to you a pick on the clock, and the most that answer when you shop it or call the teams ahead. */
const CLOCK_OFFERS = 2;
const SHOP_OFFERS = 3;
/** Add-ons a team tries when it builds an offer to you or names its price. */
const YOUR_ADD_ONS = 6;

const sideOf = (teamId: number, picks: number[]): TradeSide => ({ teamId, players: [], picks });

/**
 * A team's or your unused picks after `after` in this draft, and next year's, that are big enough to matter (`fits`),
 * cheapest first to `valuer`.
 */
function addOnsOf(
  ctx: TradeContext,
  teamId: number,
  after: DraftPick,
  valuer: Team,
  fits: (pk: DraftPick) => boolean,
): DraftPick[] {
  const { league } = ctx;
  return league.draftPicks
    .filter(
      (pk) =>
        pk.ownerId === teamId &&
        pk.playerId === undefined &&
        (pk.season === league.season + 1 || (pk.season === league.season && pk.overall! > after.overall!)) &&
        fits(pk),
    )
    .sort((a, b) => pickValue(league, a, valuer.gm, ctx) - pickValue(league, b, valuer.gm, ctx))
    .slice(0, YOUR_ADD_ONS);
}

/**
 * What `team` offers to move up from `own` to your pick: its pick and the cheapest add-on its own judge takes against
 * you, never less than the league's going rate for your pick ([his, yours]), or null.
 */
function moveUpOffer(ctx: TradeContext, team: Team, own: DraftPick, yours: DraftPick): TradeProposal | null {
  const { league } = ctx;
  const user = league.teams[league.userTeamId];
  const floor = goingRate(league, yours, ctx);
  const short = floor - goingRate(league, own, ctx);
  for (const extra of [null, ...addOnsOf(ctx, team.id, own, team, (pk) => goingRate(league, pk, ctx) >= short)]) {
    const proposal: TradeProposal = {
      sides: [sideOf(team.id, extra ? [own.id, extra.id] : [own.id]), sideOf(user.id, [yours.id])],
    };
    if (quickValue(ctx, user, proposal.sides[0]) < floor) continue;
    if (judge(ctx, team.id, proposal, { vsUser: true }).accepts) return proposal;
  }
  return null;
}

/** The teams behind your pick on the clock that would move up to it, with their offers, the best for you first. */
function movingUp(ctx: TradeContext, yours: DraftPick, skip: ReadonlySet<number>) {
  const { league } = ctx;
  const user = league.teams[league.userTeamId];
  const seen = new Set<number>([league.userTeamId, ...skip]);
  const out: { team: Team; proposal: TradeProposal; value: number }[] = [];
  for (const own of picksAhead(league, WINDOW)) {
    if (seen.has(own.ownerId)) continue;
    seen.add(own.ownerId);
    const team = league.teams[own.ownerId];
    if (!tradeUpReason(ctx, team, own)) continue;
    const proposal = moveUpOffer(ctx, team, own, yours);
    if (proposal) out.push({ team, proposal, value: quickValue(ctx, user, proposal.sides[0]) });
  }
  return out.sort((a, b) => b.value - a.value);
}

/** Your pick, when you're on the clock. */
const yourClock = (league: League) => {
  const pick = nextPick(league);
  return pick && pick.ownerId === league.userTeamId ? pick : undefined;
};

/**
 * The calls you get on the clock: the teams behind you that want to move up for their man, at most two, once a pick.
 * The draft room's controls call it when the draft stops at your pick; simming the rest never does.
 */
export function clockOffers(league: League): TradeOffer[] {
  const pick = yourClock(league);
  const market = (league.market ??= emptyMarket());
  if (!pick || market.clockPick === pick.id || tradeWindow(league) || draftTrades.off) return [];
  market.clockPick = pick.id;
  const ctx = tradeContext(league);
  return movingUp(ctx, pick, new Set())
    .slice(0, CLOCK_OFFERS)
    .map((c) => file(ctx, market, c.team, 'draft', c.proposal, 'draft'))
    .filter((o): o is TradeOffer => !!o);
}

/** *Shop this pick*: every team that would move up to it answers now; the best three come back. Once a pick. */
export function shopPick(league: League): { offers: TradeOffer[]; message: string } {
  const pick = yourClock(league);
  if (!pick) return { offers: [], message: "You're not on the clock." };
  const market = (league.market ??= emptyMarket());
  if (market.shoppedPick === pick.id) return { offers: [], message: `You've already shopped No. ${pick.overall}.` };
  market.shoppedPick = pick.id;
  const ctx = tradeContext(league);
  const offering = new Set(
    market.offers.filter((o) => o.status === 'pending' && o.sides[1].picks.includes(pick.id)).map((o) => o.teamId),
  );
  const offers = movingUp(ctx, pick, offering)
    .slice(0, SHOP_OFFERS)
    .map((c) => file(ctx, market, c.team, 'shop', c.proposal, 'draft'))
    .filter((o): o is TradeOffer => !!o);
  return {
    offers,
    message: offers.length
      ? `${offers.length} team${offers.length > 1 ? 's' : ''} came back with an offer for No. ${pick.overall}.`
      : `Nobody wants to move up to No. ${pick.overall}.`,
  };
}

/**
 * *Call teams ahead*: the teams holding the picks just before your next one each name their price for theirs, your
 * pick plus the cheapest add-on of yours they'd take (their covet counted); the three cheapest for you come back.
 * Once while a pick is on the clock.
 */
export function callAhead(league: League): { offers: TradeOffer[]; message: string } {
  const clock = nextPick(league);
  const mine = draftOrder(league).find((p) => p.ownerId === league.userTeamId && p.playerId === undefined);
  if (!clock || !mine) return { offers: [], message: 'You have no pick coming.' };
  if (mine.id === clock.id) return { offers: [], message: "You're on the clock: shop this pick instead." };
  const market = (league.market ??= emptyMarket());
  if (market.calledAhead === clock.overall) return { offers: [], message: "You've already called around this pick." };
  market.calledAhead = clock.overall;
  const ctx = tradeContext(league);
  const user = league.teams[league.userTeamId];
  const seen = new Set<number>([user.id]);
  const asks: { team: Team; proposal: TradeProposal; cost: number }[] = [];
  for (const theirs of draftOrder(league)) {
    if (theirs.playerId !== undefined || theirs.overall! >= mine.overall! || theirs.overall! < mine.overall! - WINDOW)
      continue;
    if (seen.has(theirs.ownerId)) continue;
    seen.add(theirs.ownerId);
    const team = league.teams[theirs.ownerId];
    const alone: TradeProposal = { sides: [sideOf(team.id, [theirs.id]), sideOf(user.id, [mine.id])] };
    const ask = judge(ctx, team.id, alone, { vsUser: true });
    if (ask.problem || ask.refusal) continue;
    const short = ask.need - ask.get;
    const fits = (pk: DraftPick) => pickValue(league, pk, team.gm, ctx) >= 0.8 * short;
    for (const extra of [null, ...addOnsOf(ctx, user.id, mine, team, fits)]) {
      const yours = sideOf(user.id, extra ? [mine.id, extra.id] : [mine.id]);
      const proposal: TradeProposal = { sides: [sideOf(team.id, [theirs.id]), yours] };
      if (!judge(ctx, team.id, proposal, { vsUser: true }).accepts) continue;
      asks.push({ team, proposal, cost: quickValue(ctx, user, yours) });
      break;
    }
  }
  const offers = asks
    .sort((a, b) => a.cost - b.cost)
    .slice(0, SHOP_OFFERS)
    .map((a) => file(ctx, market, a.team, 'ask', a.proposal, 'draft'))
    .filter((o): o is TradeOffer => !!o);
  return {
    offers,
    message: offers.length
      ? `${offers.length} team${offers.length > 1 ? 's' : ''} gave you their price.`
      : 'No one ahead of you will move their pick for what you have.',
  };
}

/**
 * Your director's word on a draft deal, from your own board: how far down it is to the best you'd likely still get
 * at the later pick, or that the earlier pick makes your top choice sure. Null when no pick of this draft moves.
 */
export function draftLine(league: League, [theirs, yours]: readonly [TradeSide, TradeSide]): Advice | null {
  if (league.phase !== 'draft') return null;
  const ofDraft = (side: TradeSide) =>
    side.picks
      .map((id) => league.draftPicks.find((p) => p.id === id)!)
      .filter((p) => p && p.season === league.season && p.overall !== undefined && p.playerId === undefined)
      .sort((a, b) => a.overall! - b.overall!)[0];
  const out = ofDraft(yours);
  const inn = ofDraft(theirs);
  if (!out && !inn) return null;
  const me = league.userTeamId;
  if (inn && (!out || inn.overall! < out.overall!))
    return { who: 'scouts', line: `At No. ${inn.overall} we'd be sure of our top choice.`, tone: 'good' };
  if (!inn) return null;
  const at = expectedAt(league, me, inn).best;
  if (!at) return null;
  const mine = memoOf(league)
    .pool.map((p) => boardBase(league, me, p, inn.round))
    .sort((a, b) => b - a);
  const k = Math.max(1, mine.findIndex((s) => s <= boardBase(league, me, at, inn.round)) + 1);
  return {
    who: 'scouts',
    line: `At No. ${inn.overall} we'd still likely get one of our top ${k}.`,
    tone: k <= 3 ? 'good' : k <= 8 ? 'note' : 'warn',
  };
}
