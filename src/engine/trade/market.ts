/**
 * AI-to-AI trades: a weekly market up to the deadline, where contenders look for veteran starters
 * on rebuilding rosters and pay in picks. Each GM judges on its own read with the one evaluator
 * (`judge`); neither may lose value in its own eyes. Phase 1 of docs/TRADES.md grows this into the
 * full market.
 */
import { lastSeason } from '../finance/contract';
import { aiCutdown } from '../offseason/ai';
import { contenderScore, resetContenderCache } from '../offseason/negotiation';
import { playerOvr, STARTERS } from '../positions';
import type { Rng } from '../rng';
import type { League, Player } from '../types';
import { capRoom, rosterOf, tradeContext } from './context';
import { executeTrade } from './execute';
import { judge } from './judge';
import { freshlySigned, playerTradeBlocker, salaryToTake, tradeWindow, type TradeProposal } from './rules';
import { pickValue } from './value';

/** A few attempts a week: contenders and rebuilders deal with each other. Returns the trades made. */
export function aiTradeWeek(league: League, rng: Rng): TradeProposal[] {
  const made: TradeProposal[] = [];
  if (tradeWindow(league)) return made;
  resetContenderCache(league);
  for (let attempt = 0; attempt < 3; attempt++) {
    if (!rng.chance(0.5)) continue;
    const t = tradeAttempt(league, rng);
    if (t) made.push(t);
  }
  return made;
}

function tradeAttempt(league: League, rng: Rng): TradeProposal | null {
  // A fresh pass: nothing it reads changes until its trade goes through.
  const ctx = tradeContext(league);
  const teams = league.teams.filter((t) => t.id !== league.userTeamId);
  const buyers = teams.filter((t) => contenderScore(league, t.id) >= 0.6 && t.gm.winNow >= 0.45 && capRoom(ctx, t.id) > 0.02 * league.caps[league.season]);
  const sellers = teams.filter((t) => contenderScore(league, t.id) <= 0.4);
  if (!buyers.length || !sellers.length) return null;
  const buyer = rng.pick(buyers);
  const seller = rng.pick(sellers);
  // A veteran starter on a short deal who would start for the buyer, and whose salary it can take on.
  const buyerDepth = rosterOf(ctx, buyer.id);
  // The buyer shops on its own scouts' read of the seller's players.
  const seen = (p: Player) => ctx.view(buyer.id, p).ovr;
  const wouldStart = (p: Player) => buyerDepth.filter((x) => x.position === p.position && playerOvr(x) >= seen(p)).length < STARTERS[p.position];
  const room = capRoom(ctx, buyer.id);
  const targets = rosterOf(ctx, seller.id).filter(
    (p) =>
      p.age >= 26 &&
      seen(p) >= 13 &&
      !playerTradeBlocker(league, p) &&
      !freshlySigned(league, p, seller.id) &&
      lastSeason(p.contract!) <= league.season + 1 &&
      salaryToTake(league, p) <= room &&
      wouldStart(p),
  );
  if (!targets.length) return null;
  const target = rng.pick(targets);
  const picks = league.draftPicks.filter((p) => p.ownerId === buyer.id && p.playerId === undefined).sort((a, b) => pickValue(league, b, seller.gm, ctx) - pickValue(league, a, seller.gm, ctx));
  // What the seller wants back for him alone; then the cheapest single pick (or pair) that covers it.
  const want = judge(ctx, seller.id, { sides: [{ teamId: buyer.id, players: [], picks: [] }, { teamId: seller.id, players: [target.id], picks: [] }] }).need;
  const combos = [...picks.map((p) => [p]), ...picks.slice(0, 7).flatMap((p, i) => picks.slice(i + 1, 7).map((q) => [p, q]))]
    .map((combo) => ({ combo, value: combo.reduce((s, p) => s + pickValue(league, p, seller.gm, ctx), 0) }))
    .filter((x) => x.value >= want)
    .sort((x, y) => x.value - y.value);
  for (const { combo } of combos.slice(0, 5)) {
    const proposal: TradeProposal = { sides: [{ teamId: buyer.id, players: [], picks: combo.map((p) => p.id) }, { teamId: seller.id, players: [target.id], picks: [] }] };
    if (!judge(ctx, seller.id, proposal, { rosterCuts: true }).accepts) continue;
    // The buyer must like it too.
    if (!judge(ctx, buyer.id, proposal, { rosterCuts: true }).accepts) continue;
    executeTrade(league, proposal);
    aiCutdown(league, buyer);
    return proposal;
  }
  return null;
}
