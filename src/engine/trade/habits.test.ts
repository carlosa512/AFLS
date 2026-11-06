import { afterEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { habitsForce } from '../gmHabits';
import { playerOvr } from '../positions';
import { starters, teamPlayers } from '../roster';
import type { League, Player, Team } from '../types';
import { tradeContext } from './context';
import { maxOver } from './deals';
import { executeTrade } from './execute';
import { judge } from './judge';
import { tradeBlock, untouchables } from './plans';
import type { TradeProposal } from './rules';
import { playerValue } from './value';

const base = JSON.stringify(createLeague({ seed: 'trade-habits' }));
const fresh = (): League => JSON.parse(base);
const USER = 0;
const AI = 9;
const AI2 = 10;

afterEach(() => {
  habitsForce.all = null;
  habitsForce.off = false;
});

const withHabit = (id: typeof habitsForce.all) => {
  habitsForce.off = false;
  habitsForce.all = id;
};
const none = () => {
  habitsForce.all = null;
  habitsForce.off = true;
};

/** Credit the club's GM with drafting this player. */
function draftedHere(l: League, team: Team, p: Player) {
  const gm = l.gms[team.gmId!];
  gm.appointments = [{ teamId: team.id, start: { season: 1 } as never, interim: false, through: 0 }];
  p.draft = { season: l.season - 1, round: 1, pick: 1, teamId: team.id };
}

describe('GM habits in trades', () => {
  it('maxOver takes a bonus and defaults to none', () => {
    const gm = { winNow: 0.45 } as never;
    expect(maxOver(gm)).toBeCloseTo(1.3);
    expect(maxOver(gm, 0.2)).toBeCloseTo(1.5);
  });

  it('Trades Firsts for Stars: a contender feels each extra first half as much', () => {
    const l = fresh();
    const team = l.teams[AI];
    team.stance = { ...(team.stance ?? ({} as never)), mode: 'contend' } as never;
    const firsts = l.draftPicks.filter((p) => p.ownerId === AI && p.round === 1).map((p) => p.id);
    const proposal: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: [] },
        { teamId: AI, players: [], picks: firsts },
      ],
    };
    none();
    const off = judge(tradeContext(l), AI, proposal).give;
    withHabit('firstsForStars');
    const on = judge(tradeContext(l), AI, proposal).give;
    expect(firsts.length).toBeGreaterThan(2);
    expect(on).toBeLessThan(off);
  });

  it('Sticks With His Young QB: every young QB he drafted is untouchable', () => {
    const l = fresh();
    const team = l.teams[AI];
    const qb = teamPlayers(l, AI).find((p) => p.position === 'QB')!;
    qb.age = 23;
    draftedHere(l, team, qb);
    team.gm.loyalty = 0;
    none();
    expect(untouchables(tradeContext(l), team).has(qb.id)).toBe(false);
    withHabit('youngQb');
    expect(untouchables(tradeContext(l), team).has(qb.id)).toBe(true);
  });

  it('Sells a Year Early: a starter on a rookie deal with two years left goes on the block', () => {
    const l = fresh();
    const team = l.teams[AI];
    team.stance = { ...(team.stance ?? ({} as never)), mode: 'contend' } as never;
    const p = starters(l, team, 'WR')[0];
    p.contract!.kind = 'rookie';
    p.contract!.years = p.contract!.years.slice(0, 2);
    p.contract!.years.forEach((y, i) => (y.season = l.season + i));
    p.injuries = [];
    none();
    expect(tradeBlock(tradeContext(l), team).find((e) => e.playerId === p.id)?.reason).not.toBe('secondDeal');
    withHabit('sellsEarly');
    const entry = tradeBlock(tradeContext(l), team).find((e) => e.playerId === p.id);
    expect(entry?.reason).toBe('secondDeal');
    expect(entry?.keenness).toBe(0.45);
  });

  it('Brings His Guys Back: a man he drafted is worth 8% more to him', () => {
    const l = fresh();
    const team = l.teams[AI];
    const p = teamPlayers(l, AI).sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    draftedHere(l, team, p);
    none();
    const off = playerValue(l, p, team);
    withHabit('hisGuys');
    const on = playerValue(l, p, team);
    expect(off).toBeGreaterThan(0);
    expect(on).toBeCloseTo(off * 1.08, 5);
  });
});

describe('executeTrade logs habit moves', () => {
  const logOf = (l: League, teamId: number) => l.gms[l.teams[teamId].gmId!].habitLog ?? [];
  const pick = (l: League, teamId: number, n: number) =>
    l.draftPicks
      .filter((p) => p.ownerId === teamId && p.round === 1)
      .slice(0, n)
      .map((p) => p.id);

  it('firstsForStars: two firsts for one player', () => {
    const l = fresh();
    const star = teamPlayers(l, AI2)[0];
    executeTrade(l, {
      sides: [
        { teamId: AI, players: [], picks: pick(l, AI, 2) },
        { teamId: AI2, players: [star.id], picks: [] },
      ],
    });
    expect(logOf(l, AI).filter((m) => m.habit === 'firstsForStars')).toMatchObject([{ playerId: star.id }]);
    expect(logOf(l, AI2).filter((m) => m.habit === 'firstsForStars')).toEqual([]);
  });

  it('swaps: a player each way, no picks, logged for both clubs', () => {
    const l = fresh();
    const a = teamPlayers(l, AI).find((p) => p.position === 'TE')!;
    const b = teamPlayers(l, AI2).find((p) => p.position === 'TE')!;
    executeTrade(l, {
      sides: [
        { teamId: AI, players: [a.id], picks: [] },
        { teamId: AI2, players: [b.id], picks: [] },
      ],
    });
    expect(logOf(l, AI).some((m) => m.habit === 'swaps')).toBe(true);
    expect(logOf(l, AI2).some((m) => m.habit === 'swaps')).toBe(true);
  });

  it('sellsEarly: a rookie-deal starter sent for a day-two pick is a good one', () => {
    const l = fresh();
    const p = starters(l, l.teams[AI], 'WR')[0];
    p.contract!.kind = 'rookie';
    p.contract!.years = p.contract!.years.slice(0, 2);
    p.contract!.years.forEach((y, i) => (y.season = l.season + i));
    executeTrade(l, {
      sides: [
        { teamId: AI, players: [p.id], picks: [] },
        { teamId: AI2, players: [], picks: pick(l, AI2, 1) },
      ],
    });
    expect(logOf(l, AI).filter((m) => m.habit === 'sellsEarly')).toMatchObject([{ playerId: p.id, good: true }]);
  });

  it('hisGuys: receiving a man he drafted', () => {
    const l = fresh();
    const p = teamPlayers(l, AI2)[0];
    draftedHere(l, l.teams[AI], p);
    executeTrade(l, {
      sides: [
        { teamId: AI, players: [], picks: pick(l, AI, 1) },
        { teamId: AI2, players: [p.id], picks: [] },
      ],
    });
    expect(logOf(l, AI).filter((m) => m.habit === 'hisGuys')).toMatchObject([{ playerId: p.id }]);
  });
});
