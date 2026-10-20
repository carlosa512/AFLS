import { describe, expect, it } from 'vitest';
import { yearsLeft } from '../finance/contract';
import { createLeague } from '../generate';
import { contenderScore } from '../offseason/negotiation';
import { STARTERS } from '../positions';
import { activeRoster } from '../roster';
import type { League } from '../types';
import { judge, marketValue, tradeContext } from '.';
import type { TradeProposal } from './rules';

const base = JSON.stringify(createLeague({ seed: 'floor' }));
const fresh = (): League => JSON.parse(base);

/** What a seller asks for one of its players, as a share of his market value, from `buyer`. */
function ask(l: League, sellerId: number, playerId: number, buyer: number): number {
  const ctx = tradeContext(l);
  const proposal: TradeProposal = {
    sides: [
      { teamId: buyer, players: [], picks: [] },
      { teamId: sellerId, players: [playerId], picks: [] },
    ],
  };
  return judge(ctx, sellerId, proposal).need / marketValue(ctx, l.teams[sellerId], l.players[playerId]);
}

describe('a rental seller’s floor', () => {
  it('holds higher against you than against another AI team, and lets a rental go cheap on deadline day', () => {
    const l = fresh();
    const rentals = l.teams
      .filter((t) => t.id !== l.userTeamId && contenderScore(l, t.id) <= 0.4)
      .flatMap((t) =>
        activeRoster(l, t.id).filter(
          (p) =>
            p.contract &&
            yearsLeft(p.contract, l.season) <= 1 &&
            t.depthChart[p.position].slice(0, STARTERS[p.position]).includes(p.id),
        ),
      )
      .filter((p) => marketValue(tradeContext(l), l.teams[p.teamId!], p) > 50);
    expect(rentals.length).toBeGreaterThan(3);
    const buyer = l.teams.find((t) => t.id !== l.userTeamId && contenderScore(l, t.id) > 0.6)!.id;
    let cheap = 0;
    let lower = 0;
    for (const week of [1, 9]) {
      l.week = week;
      for (const p of rentals) {
        const theirs = ask(l, p.teamId!, p.id, buyer);
        const yours = ask(l, p.teamId!, p.id, l.userTeamId);
        expect(theirs).toBeLessThanOrEqual(yours + 1e-9);
        if (theirs < yours - 0.05) lower++;
        // The old floor held out for 65% of his worth all season.
        if (week === 9 && theirs < 0.5) cheap++;
      }
    }
    expect(cheap).toBeGreaterThan(0);
    expect(lower).toBeGreaterThan(0);
  });
});
