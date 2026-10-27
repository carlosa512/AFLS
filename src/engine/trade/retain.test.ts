import { describe, expect, it } from 'vitest';
import { capHit, yearsLeft } from '../finance/contract';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import { playerOvr } from '../positions';
import { activeRoster } from '../roster';
import type { League } from '../types';
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
import { floorShare, marginFor } from './judge';
import { nowWeight } from './value';
import type { TradeProposal } from './rules';

const base = (() => {
  const l = createLeague({ seed: 'retain' });
  for (let w = 0; w < 4; w++) playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
let secondBase: string | undefined;
/** A second league four weeks in, built when a test needs more of the world than one league holds. */
const second = () => {
  if (secondBase) return secondBase;
  const l = createLeague({ seed: 'retain-2' });
  for (let w = 0; w < 4; w++) playWeek(l);
  return (secondBase = JSON.stringify(l));
};
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
    // A starter with salary left to keep: a deal restructured down to the minimum base has none.
    const p = activeRoster(l, 9)
      .filter((x) => maxRetain(l, x) >= 2000)
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
    // Two leagues: one opening league holds as few as four such players (its last-year deals paid past their market,
    // fewer have a roomy buyer), too few to read half of them closing.
    const cases: { league: string; seller: number; player: number; buyer: number; floor: number }[] = [];
    for (const league of [base, second()]) {
      const l: League = JSON.parse(league);
      const ctx = tradeContext(l);
      for (const seller of l.teams.filter((t) => t.id !== l.userTeamId)) {
        for (const p of activeRoster(l, seller.id)) {
          if (cases.length >= 8 * (league === base ? 1 : 2)) break;
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
          if (buyer && dealFor(ctx, buyer, p)) {
            const alone: TradeProposal = {
              sides: [
                { teamId: buyer.id, players: [], picks: [] },
                { teamId: seller.id, players: [p.id], picks: [] },
              ],
            };
            cases.push({
              league,
              seller: seller.id,
              player: p.id,
              buyer: buyer.id,
              floor: judge(ctx, seller.id, alone).need,
            });
          }
        }
      }
    }
    expect(cases.length).toBeGreaterThanOrEqual(4);
    let closed = 0;
    for (const c of cases) {
      // The same buyer squeezed against the cap, so his team has to keep about 1.3 times his worth to fit him.
      const m: League = JSON.parse(c.league);
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
      // The money comes back to it in picks, on top of its floor for the player alone: at least the seller's floor
      // share of it. Between front offices a rental's kept salary is priced at that share (35% by week 5, 20% on
      // deadline day), so a fixed half failed whenever a selling team took its floor, as one of these deals does.
      // Measured from the floor, not from what a buyer with room paid: that deal haggles to its own spot above the
      // floor, and the slack it happened to leave isn't owed again.
      expect(quickValue(mctx, m.teams[c.seller], deal.proposal.sides[0]) - c.floor).toBeGreaterThanOrEqual(
        floorShare(m, m.teams[c.seller], p, false) * POINTS_PER_K * kept!,
      );
    }
    expect(closed).toBeGreaterThanOrEqual(cases.length / 2);
  });

  it('holds out for its floor share of what it keeps of a rental from an AI buyer, and all of it from you', () => {
    // Between front offices what a seller keeps of an expiring deal is part of the rental's price, held out for at the
    // same share as the rest of his worth: held out for in full, it priced out every buyer short of room now but not
    // next year (that buyer counts this year's dollar at less), and in-season trades fell under the NFL's (14.8 a
    // season, floor 15). Against you it stays in full, or you buy a player with his salary kept and sell him on at a
    // profit.
    const l = fresh();
    const ctx = tradeContext(l);
    const user = l.userTeamId;
    const deal = (seller: number, id: number, to: number, retain: number): TradeProposal => ({
      sides: [
        { teamId: seller, players: [id], picks: [], ...(retain ? { retain: { [id]: retain } } : {}) },
        { teamId: to, players: [], picks: [] },
      ],
    });
    // A seller with room to spare (it weighs this year's money under face value) selling a player whose price its
    // floor sets: what it asks is past its own read of him, so the money kept moves the floor, not the read.
    const cases = l.teams
      .filter((t) => t.id !== user && nowWeight(ctx, t.id) <= 0.8)
      .flatMap((seller) => {
        const buyer = l.teams.find((t) => t.id !== user && t.id !== seller.id && t.division !== seller.division)!;
        return activeRoster(l, seller.id)
          .filter(
            (p) =>
              p.contract &&
              yearsLeft(p.contract, l.season) <= 1 &&
              !playerTradeBlocker(l, p) &&
              maxRetain(l, p) >= 2000,
          )
          .map((p) => ({ seller, buyer, p, v: judge(ctx, seller.id, deal(seller.id, p.id, buyer.id, 0)) }))
          .filter(({ seller, buyer, v }) => v.give > 0 && v.need > marginFor(seller, buyer) * v.give + 1);
      });
    expect(cases.length, 'players a seller with room prices at its floor').toBeGreaterThan(0);
    const { seller, buyer, p } = cases[0];
    const keep = Math.floor(maxRetain(l, p) / 2);
    const ask = (to: number, retain: number) =>
      judge(ctx, seller.id, deal(seller.id, p.id, to, retain), { vsUser: to === user }).need;
    const face = POINTS_PER_K * keep;
    expect(ask(buyer.id, keep) - ask(buyer.id, 0), 'from an AI buyer').toBeLessThan(0.9 * face);
    expect(ask(user, keep) - ask(user, 0), 'from you').toBeGreaterThanOrEqual(face);
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
