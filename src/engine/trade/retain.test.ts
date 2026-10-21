import { describe, expect, it } from 'vitest';
import { capHit, yearsLeft } from '../finance/contract';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import { playerOvr } from '../positions';
import { activeRoster } from '../roster';
import type { League, Team } from '../types';
import {
  capRoom,
  dealFor,
  executeTrade,
  judge,
  keepToFit,
  marketValue,
  maxRetain,
  playerTradeBlocker,
  POINTS_PER_K,
  salaryToTake,
  tradeContext,
  tradeProblem,
} from '.';
import { quickValue } from './deals';
import type { TradeProposal, TradeSide } from './rules';
import { pickValue } from './value';
import type { TradeContext } from './context';

const base = (() => {
  const l = createLeague({ seed: 'retain' });
  for (let w = 0; w < 4; w++) playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const richest = (l: League, teamId: number) =>
  activeRoster(l, teamId)
    .filter((p) => p.contract)
    .sort((a, b) => capHit(b.contract!, l.season) - capHit(a.contract!, l.season))[0];

describe('retained salary', () => {
  it('books what the sender keeps as its dead money and takes it off the buyer’s base', () => {
    const l = fresh();
    const p = richest(l, 9);
    const keep = Math.floor(maxRetain(l, p) / 2);
    const owed = salaryToTake(l, p);
    const pick = l.draftPicks.find((x) => x.ownerId === 4 && x.playerId === undefined)!;
    const deal: TradeProposal = {
      sides: [
        { teamId: 9, players: [p.id], picks: [], retain: { [p.id]: keep } },
        { teamId: 4, players: [], picks: [pick.id] },
      ],
    };
    expect(tradeProblem(l, deal, { rosterCuts: true })).toBeNull();
    const dead = (t: number) =>
      l.teams[t].deadMoney
        .filter((d) => d.season === l.season && d.note === 'Retained salary')
        .reduce((s, d) => s + d.amount, 0);
    executeTrade(l, deal);
    expect(dead(9)).toBe(keep);
    expect(capHit(l.players[p.id].contract!, l.season)).toBeCloseTo(owed - keep, -1);
  });

  it('never keeps more than he is owed past the minimum', () => {
    const l = fresh();
    const p = richest(l, 9);
    const pick = l.draftPicks.find((x) => x.ownerId === 4 && x.playerId === undefined)!;
    const deal: TradeProposal = {
      sides: [
        { teamId: 9, players: [p.id], picks: [], retain: { [p.id]: maxRetain(l, p) + 100 } },
        { teamId: 4, players: [], picks: [pick.id] },
      ],
    };
    expect(tradeProblem(l, deal, { rosterCuts: true })).toMatch(/can't keep paying more/);
  });

  it('costs the seller and helps the buyer in their own eyes', () => {
    const l = fresh();
    const ctx = tradeContext(l);
    // A good player with salary left to keep: a restructured deal's pay this year is bonus, and the opening league
    // restructures its over-target rosters' biggest deals.
    const p = activeRoster(l, 9)
      .filter((q) => maxRetain(l, q) > 0)
      .sort((a, b) => playerOvr(b) - playerOvr(a))[3];
    const pick = l.draftPicks.find((x) => x.ownerId === 4 && x.playerId === undefined)!;
    const plain: TradeProposal = {
      sides: [
        { teamId: 9, players: [p.id], picks: [] },
        { teamId: 4, players: [], picks: [pick.id] },
      ],
    };
    const kept: TradeProposal = {
      sides: [{ ...plain.sides[0], retain: { [p.id]: Math.min(2000, maxRetain(l, p)) } }, plain.sides[1]],
    };
    expect(judge(ctx, 9, kept).give).toBeGreaterThan(judge(ctx, 9, plain).give);
    expect(judge(ctx, 4, kept).get).toBeGreaterThan(judge(ctx, 4, plain).get);
  });

  it('gets a capped buyer his man, and is paid for the money it keeps in picks', { timeout: 30_000 }, () => {
    // Expiring veterans whose teams could keep more than they're worth (so next year's money is out
    // of it), each with a buyer that has the room and buys him outright.
    const l = fresh();
    const ctx = tradeContext(l);
    const cases: { seller: number; player: number; buyer: number; paid: number; floor: number }[] = [];
    // What comes back to a seller net of a late pick it hands back: at the league's prices, and in its own eyes.
    const net = (c: TradeContext, side: (s: TradeContext, t: Team, x: TradeSide) => number, deal: TradeProposal) =>
      side(c, c.league.teams[deal.sides[1].teamId], deal.sides[0]) -
      side(c, c.league.teams[deal.sides[1].teamId], { ...deal.sides[1], players: [] });
    const ownEyes = (c: TradeContext, t: Team, x: TradeSide) =>
      x.picks.reduce((v, id) => v + pickValue(c.league, c.league.draftPicks.find((pk) => pk.id === id)!, t.gm, c), 0);
    for (const seller of l.teams.filter((t) => t.id !== l.userTeamId)) {
      for (const p of activeRoster(l, seller.id)) {
        if (cases.length >= 8) break;
        if (!p.contract || playerTradeBlocker(l, p) || yearsLeft(p.contract, l.season) > 1) continue;
        const worth = marketValue(ctx, seller, p);
        if (worth <= 20 || POINTS_PER_K * maxRetain(l, p) < 1.5 * worth) continue;
        const buyer = l.teams.find(
          (t) =>
            t.id !== seller.id &&
            t.id !== l.userTeamId &&
            capRoom(ctx, t.id) >= salaryToTake(l, p) + 2000 &&
            dealFor(ctx, t, p),
        );
        const outright = buyer && dealFor(ctx, buyer, p);
        if (outright)
          cases.push({
            seller: seller.id,
            player: p.id,
            buyer: buyer.id,
            paid: net(ctx, quickValue, outright.proposal),
            // The least it would take for him from that buyer.
            floor: judge(ctx, seller.id, {
              sides: [
                { teamId: buyer.id, players: [], picks: [] },
                { teamId: seller.id, players: [p.id], picks: [] },
              ],
            }).need,
          });
      }
    }
    expect(cases.length).toBeGreaterThanOrEqual(4);
    let closed = 0;
    let extra = 0;
    let keptPoints = 0;
    for (const c of cases) {
      // The same buyer squeezed against the cap, so his team has to keep about 1.3 times his worth to fit him.
      const m = fresh();
      const p = m.players[c.player];
      const keep = Math.round((1.3 * marketValue(tradeContext(m), m.teams[c.seller], p)) / POINTS_PER_K);
      const room = capRoom(tradeContext(m), c.buyer);
      m.teams[c.buyer].deadMoney.push({
        season: m.season,
        amount: Math.round(room - (salaryToTake(m, p) - keep)),
        playerId: -1,
        note: 'Test',
      });
      const mctx = tradeContext(m);
      const kept = keepToFit(m, p, capRoom(mctx, c.buyer));
      expect(kept).toBeGreaterThan(0);
      const deal = dealFor(mctx, m.teams[c.buyer], p);
      if (!deal) continue;
      closed++;
      expect(deal.proposal.sides[1].retain?.[p.id]).toBe(kept);
      // It is paid for the money in picks, in its own eyes, on top of the least it would take from a buyer with room:
      // at least half of it, the least a team weighs this year's money at in season (`nowWeight`).
      expect(net(mctx, ownEyes, deal.proposal) - c.floor, m.teams[c.seller].abbrev).toBeGreaterThan(
        0.5 * POINTS_PER_K * kept!,
      );
      extra += net(mctx, quickValue, deal.proposal) - c.paid;
      keptPoints += POINTS_PER_K * kept!;
    }
    expect(closed).toBeGreaterThanOrEqual(cases.length / 2);
    // And most of the money comes back at the league's prices, on top of what buyers with room paid. Across the cases:
    // a haggled deal lands anywhere between the seller's floor and its price, a pick's width either way, so one deal
    // against another is noise of that size (CIN let a player go to a buyer with room for 77 points it would have
    // taken 47 for, then took 79 more for 166 points of salary kept).
    expect(extra).toBeGreaterThan(0.5 * keptPoints);
  });

  it('keeps just enough to fit a buyer short of room, or says it can’t', () => {
    const l = fresh();
    const p = richest(l, 9);
    const owed = salaryToTake(l, p);
    expect(keepToFit(l, p, owed + 1)).toBe(0);
    const keep = keepToFit(l, p, owed - 1000);
    if (keep !== null) expect(keep).toBeGreaterThanOrEqual(1000);
    expect(keepToFit(l, p, -1e9)).toBeNull();
  });
});
