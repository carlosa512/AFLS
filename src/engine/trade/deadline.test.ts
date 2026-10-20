import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playerOvr } from '../positions';
import type { League } from '../types';
import { goingRate, judge, pickValue, playerSwing, tradeContext, tradeProblem } from '.';
import type { TradeProposal } from './rules';
import { nowWeight, readPlayer } from './value';

const base = JSON.stringify(createLeague({ seed: 'deadline' }));
const fresh = (): League => JSON.parse(base);

const firstOf = (l: League, teamId: number, season: number) =>
  l.draftPicks.find((p) => p.originalTeamId === teamId && p.round === 1 && p.season === season)!;
const sendPicks = (from: number, to: number, picks: number[]): TradeProposal => ({
  sides: [
    { teamId: from, players: [], picks },
    { teamId: to, players: [], picks: [] },
  ],
});

describe('a tight cap in season', () => {
  it("doesn't make a cheap starter's play worth more, as it does in the offseason", () => {
    const l = fresh();
    const buyer = l.teams.find((t) => t.id !== l.userTeamId)!;
    // A good player on an expiring rookie deal elsewhere: the rental a capped contender paid firsts for.
    const target = Object.values(l.players)
      .filter(
        (p) =>
          p.teamId != null &&
          p.teamId !== buyer.id &&
          p.teamId !== l.userTeamId &&
          p.contract?.kind === 'rookie' &&
          p.contract.years.at(-1)!.season === l.season,
      )
      .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    const gainAt = (phase: League['phase'], w: number) => {
      l.phase = phase;
      const ctx = tradeContext(l);
      ctx.salaryWeights = l.teams.map(() => 1);
      ctx.salaryWeights[buyer.id] = w;
      expect(nowWeight(ctx, buyer.id)).toBe(phase === 'regular' ? Math.min(1, w) : w);
      expect(readPlayer(ctx, buyer, target).pay).toBeGreaterThan(50);
      return playerSwing(ctx, buyer, [], [target.id]).gain;
    };
    // Squeezed, this year's money (all of his) counts like anyone's in season.
    expect(gainAt('regular', 2)).toBeCloseTo(gainAt('regular', 1), 6);
    // In the offseason the room a squeeze saves still buys a free agent.
    expect(Math.abs(gainAt('preseason', 2) - gainAt('preseason', 1))).toBeGreaterThan(50);
    // A rich team still discounts it.
    expect(gainAt('regular', 0.5)).toBeLessThan(gainAt('regular', 1));
  });
});

describe('first-round picks', () => {
  it('leaving drafts without a first is a price, not a rule, and a GM going all in pays less of it', () => {
    const l = fresh();
    const [ai, other] = l.teams.filter((t) => t.id !== l.userTeamId);
    const give = (picks: number[]) => judge(tradeContext(l), ai.id, sendPicks(ai.id, other.id, picks)).give;
    const next = firstOf(l, ai.id, 2028);
    const rise = (winNow: number) => {
      ai.gm = { ...ai.gm, winNow };
      firstOf(l, ai.id, 2027).ownerId = ai.id;
      const base = give([next.id]);
      // Its 2027 first gone in an earlier deal: sending 2028's leaves back-to-back drafts without one.
      firstOf(l, ai.id, 2027).ownerId = other.id;
      return give([next.id]) / base;
    };
    expect(rise(0.5)).toBeCloseTo(1.3, 6);
    expect(rise(1)).toBeLessThan(rise(0.2));
    // Nobody is stopped, you included.
    for (const team of [ai.id, l.userTeamId]) {
      firstOf(l, team, 2027).ownerId = other.id;
      expect(
        tradeProblem(l, sendPicks(team, other.id, [firstOf(l, team, 2028).id, firstOf(l, team, 2029).id])),
      ).toBeNull();
    }
  });

  it('a GM counts the firsts he already sold, and never prices a far-off pick under the going rate', () => {
    const l = fresh();
    const [ai, other, third] = l.teams.filter((t) => t.id !== l.userTeamId);
    ai.gm = { ...ai.gm, futureDiscount: 0.4, winNow: 0.5 };
    const far = firstOf(l, ai.id, 2029);
    const ctx = tradeContext(l);
    // A GM who barely values the future would have given it away for well under the league's price.
    expect(pickValue(l, far, ai.gm, ctx)).toBeLessThan(goingRate(l, far, ctx));
    const give = (picks: number[]) => judge(tradeContext(l), ai.id, sendPicks(ai.id, other.id, picks)).give;
    expect(give([far.id])).toBeCloseTo(goingRate(l, far, ctx), 6);
    // With its 2027 and 2029 firsts already sold, a first it picked up for 2028 is its third (its own 2028 stays).
    const extra = firstOf(l, third.id, 2028);
    extra.ownerId = ai.id;
    const before = give([extra.id]);
    firstOf(l, ai.id, 2027).ownerId = other.id;
    far.ownerId = other.id;
    expect(give([extra.id])).toBeCloseTo(before * 1.4, 6);
  });
});

describe('fog of war in trades', () => {
  it("an AI club trades on its scouts' full read of another AI club's player, but reads yours narrowly", () => {
    const l = fresh();
    const ctx = tradeContext(l);
    const reader = l.teams.find((t) => t.id !== l.userTeamId)!;
    const miss = (owner: (teamId: number) => boolean) =>
      Object.values(l.players)
        .filter((p) => p.teamId != null && p.teamId !== reader.id && owner(p.teamId) && p.contract)
        .map((p) => Math.abs(readPlayer(ctx, reader, p).ovr - playerOvr(p)));
    const yours = miss((id) => id === l.userTeamId);
    const theirs = miss((id) => id !== l.userTeamId);
    expect(Math.max(...yours)).toBeLessThanOrEqual(0.35 + 1e-9);
    expect(Math.max(...theirs)).toBeLessThanOrEqual(1 + 1e-9);
    expect(theirs.filter((x) => x > 0.35).length).toBeGreaterThan(20);
  });
});
