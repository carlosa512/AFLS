import { describe, expect, it } from 'vitest';
import { capSpace } from './finance/cap';
import { createLeague } from './generate';
import { playWeek } from './league';
import { playerOvr } from './positions';
import { teamPlayers } from './roster';
import {
  evaluateTrade,
  executeTrade,
  fitzgeraldSpielberger,
  jimmyJohnson,
  MAX_AI_PICKS,
  pickValue,
  playerTradeBlocker,
  projectedSlot,
  suggestSweetener,
  TRADE_DEADLINE_WEEK,
  tradeProblem,
  type TradeProposal,
} from './trade';
import type { League } from './types';

const base = JSON.stringify(createLeague({ seed: 'trade-tests' }));
const fresh = (): League => JSON.parse(base);
const USER = 0;
const AI = 9;

const picksOf = (l: League, teamId: number, round?: number) => l.draftPicks.filter((p) => p.ownerId === teamId && (!round || p.round === round));
const best = (l: League, teamId: number) => teamPlayers(l, teamId).sort((a, b) => playerOvr(b) - playerOvr(a));

describe('pick charts', () => {
  it('match the doc anchors and only fall with the slot', () => {
    expect(jimmyJohnson(1)).toBeCloseTo(3000);
    expect(jimmyJohnson(32)).toBeCloseTo(590);
    expect(fitzgeraldSpielberger(32)).toBeCloseTo(1244);
    expect(fitzgeraldSpielberger(141)).toBeCloseTo(492);
    for (let p = 2; p <= 257; p++) {
      expect(jimmyJohnson(p)).toBeLessThanOrEqual(jimmyJohnson(p - 1));
      expect(fitzgeraldSpielberger(p)).toBeLessThanOrEqual(fitzgeraldSpielberger(p - 1));
    }
    // Analytics GMs value Day 2 far more: the gap a trade-down exploits.
    expect(fitzgeraldSpielberger(64) / jimmyJohnson(64)).toBeGreaterThan(3);
  });

  it('discounts future picks and projects slots from team strength', () => {
    const l = fresh();
    const gm = l.teams[AI].gm;
    const [near, far] = picksOf(l, USER, 1).sort((a, b) => a.season - b.season);
    expect(pickValue(l, far, gm)).toBeLessThan(pickValue(l, near, gm));
    const slots = l.teams.map((t) => projectedSlot(l, t.id, 2027));
    expect(Math.min(...slots)).toBeLessThanOrEqual(3);
    expect(Math.max(...slots)).toBeGreaterThanOrEqual(30);
  });
});

describe('AI trade evaluation', () => {
  it("doesn't give players away, and accepts a clear overpay", () => {
    const l = fresh();
    const target = best(l, AI)[0];
    const free: TradeProposal = { sides: [{ teamId: USER, players: [], picks: [] }, { teamId: AI, players: [target.id], picks: [] }] };
    expect(evaluateTrade(l, free).accepts).toBe(false);
    const firsts = picksOf(l, USER, 1).map((p) => p.id);
    const seconds = picksOf(l, USER, 2).map((p) => p.id);
    const rich: TradeProposal = { sides: [{ teamId: USER, players: [], picks: [...firsts, ...seconds] }, { teamId: AI, players: [target.id], picks: [] }] };
    expect(evaluateTrade(l, rich).get).toBeGreaterThan(evaluateTrade(l, free).get);
  });

  it('only gets more willing as you add to your side', () => {
    const l = fresh();
    const target = best(l, AI)[3];
    const mine = picksOf(l, USER).map((p) => p.id);
    let last = -Infinity;
    for (let n = 0; n <= 4; n++) {
      const v = evaluateTrade(l, { sides: [{ teamId: USER, players: [], picks: mine.slice(0, n) }, { teamId: AI, players: [target.id], picks: [] }] });
      expect(v.get).toBeGreaterThanOrEqual(last);
      last = v.get;
    }
  });

  it(`won't send more than ${MAX_AI_PICKS} picks for a non-star`, () => {
    const l = fresh();
    const role = best(l, USER).find((p) => playerOvr(p) < 14 && playerOvr(p) > 11)!;
    // Open a roster spot so only the pick rule is in play.
    const spare = best(l, AI).at(-1)!;
    spare.teamId = null;
    const theirs = picksOf(l, AI)
      .filter((p) => p.round >= 6)
      .slice(0, 3)
      .map((p) => p.id);
    const v = evaluateTrade(l, { sides: [{ teamId: USER, players: [role.id], picks: [] }, { teamId: AI, players: [], picks: theirs }] });
    expect(v.accepts).toBe(false);
    expect(v.message).toMatch(/won't send more than/);
  });

  it('suggests a sweetener that closes the gap', () => {
    const l = fresh();
    const target = best(l, AI)[2];
    const proposal: TradeProposal = { sides: [{ teamId: USER, players: [], picks: [] }, { teamId: AI, players: [target.id], picks: [] }] };
    for (let i = 0; i < 4 && !evaluateTrade(l, proposal).accepts; i++) {
      const add = suggestSweetener(l, proposal);
      expect(add).not.toBeNull();
      if (add!.kind === 'pick') proposal.sides[0].picks.push(add!.id);
      else proposal.sides[0].players.push(add!.id);
    }
    expect(evaluateTrade(l, proposal).get).toBeGreaterThan(0);
  });
});

describe('trade rules and execution', () => {
  it('leaves the bonus behind as dead money and moves the salary', () => {
    const l = fresh();
    // The cheapest veteran with bonus money, so the salary fits under any cap situation.
    const base = (x: League['players'][number]) => x.contract!.years[0].base;
    const p = teamPlayers(l, AI)
      .filter((x) => x.contract!.bonuses.length > 0 && x.contract!.kind === 'veteran')
      .sort((a, b) => base(a) - base(b))[0];
    const pick = picksOf(l, USER, 1)[0];
    const proposal: TradeProposal = { sides: [{ teamId: USER, players: [], picks: [pick.id] }, { teamId: AI, players: [p.id], picks: [] }] };
    // Make room so the rule check passes regardless of this seed's rosters.
    const cut = best(l, USER).at(-1)!;
    cut.teamId = null;
    l.teams[USER].depthChart[cut.position] = l.teams[USER].depthChart[cut.position].filter((id) => id !== cut.id);
    expect(tradeProblem(l, proposal)).toBeNull();
    executeTrade(l, proposal);
    expect(p.teamId).toBe(USER);
    expect(p.contract!.bonuses).toEqual([]);
    expect(l.teams[AI].deadMoney.some((d) => d.playerId === p.id)).toBe(true);
    expect(pick.ownerId).toBe(AI);
    expect(l.transactions.at(-1)!.kind).toBe('trade');
  });

  it("blocks trades that break the cap or the roster, and after the deadline", () => {
    const l = fresh();
    const stars = best(l, AI).slice(0, 6).map((p) => p.id);
    const v = tradeProblem(l, { sides: [{ teamId: USER, players: [], picks: [] }, { teamId: AI, players: stars, picks: [] }] });
    expect(v).toMatch(/over the cap|too many players/);
    while (l.week <= TRADE_DEADLINE_WEEK) playWeek(l);
    const late = tradeProblem(l, { sides: [{ teamId: USER, players: [], picks: [picksOf(l, USER)[0].id] }, { teamId: AI, players: [], picks: [picksOf(l, AI)[0].id] }] });
    expect(late).toMatch(/deadline/);
  });

  it('keeps freshly signed players off the market until the cooldown passes', () => {
    const l = fresh();
    const p = best(l, AI).find((x) => x.contract!.kind === 'veteran')!;
    p.contract!.signedSeason = l.season;
    p.contract!.signedWeek = 0;
    expect(playerTradeBlocker(l, p)).toMatch(/Signed this year/);
    p.contract!.signedWeek = -1;
    expect(playerTradeBlocker(l, p)).toBeNull();
    expect(capSpace(l, AI)).toBeGreaterThan(-Infinity);
  });
});
