import { describe, expect, it } from 'vitest';
import { capHit } from '../finance/contract';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import { playerOvr } from '../positions';
import { activeRoster } from '../roster';
import type { League } from '../types';
import { executeTrade, judge, keepToFit, maxRetain, salaryToTake, tradeContext, tradeProblem } from '.';
import type { TradeProposal } from './rules';

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
