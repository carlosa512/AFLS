import { describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { capHit, yearsLeft } from '../finance/contract';
import { createLeague } from '../generate';
import { playWeek } from '../league';
import { playerOvr } from '../positions';
import { teamPlayers } from '../roster';
import {
  dealFor,
  evaluateTrade,
  executeTrade,
  fitzgeraldSpielberger,
  goingRate,
  isDeadlineDay,
  jimmyJohnson,
  judge,
  marketValue,
  pickChartValue,
  pickValue,
  playerTradeBlocker,
  playerValue,
  projectedSlot,
  salaryWeight,
  signingWait,
  suggestSweetener,
  TRADE_DEADLINE_WEEK,
  tradeContext,
  tradeProblem,
  tradeWindow,
  type TradeProposal,
} from '.';
import type { League } from '../types';
import { balance, picksOf as tradeablePicks } from './deals';

const base = JSON.stringify(createLeague({ seed: 'trade-tests' }));
const fresh = (): League => JSON.parse(base);
const USER = 0;
const AI = 9;

const picksOf = (l: League, teamId: number, round?: number) =>
  l.draftPicks.filter((p) => p.ownerId === teamId && (!round || p.round === round));
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

  it('blend the charts without making late picks worth a starter', () => {
    const oldSchool = { pickChart: 'johnson' as const };
    const analytics = { pickChart: 'analytics' as const };
    // A seventh-rounder stays a seventh-rounder to everyone...
    expect(pickChartValue(220, oldSchool)).toBeLessThan(20);
    expect(pickChartValue(220, analytics)).toBeLessThan(50);
    // ...while an analytics GM still prizes Day 2 over an old-school one, and the top of the draft is the same.
    expect(pickChartValue(48, analytics) / pickChartValue(48, oldSchool)).toBeGreaterThan(1.3);
    expect(pickChartValue(1, analytics)).toBeCloseTo(pickChartValue(1, oldSchool));
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
    const free: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: [] },
        { teamId: AI, players: [target.id], picks: [] },
      ],
    };
    expect(evaluateTrade(l, free).accepts).toBe(false);
    const firsts = picksOf(l, USER, 1).map((p) => p.id);
    const seconds = picksOf(l, USER, 2).map((p) => p.id);
    const rich: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: [...firsts, ...seconds] },
        { teamId: AI, players: [target.id], picks: [] },
      ],
    };
    expect(evaluateTrade(l, rich).get).toBeGreaterThan(evaluateTrade(l, free).get);
  });

  it('only gets more willing as you add to your side', () => {
    const l = fresh();
    const target = best(l, AI)[3];
    const mine = picksOf(l, USER).map((p) => p.id);
    let last = -Infinity;
    for (let n = 0; n <= 4; n++) {
      const v = evaluateTrade(l, {
        sides: [
          { teamId: USER, players: [], picks: mine.slice(0, n) },
          { teamId: AI, players: [target.id], picks: [] },
        ],
      });
      expect(v.get).toBeGreaterThanOrEqual(last);
      last = v.get;
    }
  });

  it('charges more for each first-round pick past the second it sends, instead of refusing outright', () => {
    const l = fresh();
    l.teams[AI].gm = { ...l.teams[AI].gm, winNow: 0.5 };
    const ctx = tradeContext(l);
    const firsts = picksOf(l, AI, 1).slice(0, 3);
    expect(firsts).toHaveLength(3);
    const values = firsts.map((p) => pickValue(l, p, l.teams[AI].gm, ctx)).sort((a, b) => b - a);
    const give = (n: number) =>
      judge(ctx, AI, {
        sides: [
          { teamId: USER, players: [], picks: [] },
          { teamId: AI, players: [], picks: firsts.slice(0, n).map((p) => p.id) },
        ],
      }).give;
    expect(give(3)).toBeGreaterThan(give(2));
    // All three leave it without a first in back-to-back drafts (+0.3 each), and the third is past the second (+0.4).
    expect(give(3)).toBeCloseTo(values[0] * 1.3 + values[1] * 1.3 + values[2] * 1.7);
  });

  it('moves a star only for a first-round pick or a front-line player', () => {
    const l = fresh();
    const ctx = tradeContext(l);
    // Not a division rival: no star goes to one in season, whatever comes back.
    const [teamId, star] = l.teams
      .filter((t) => t.id !== USER && t.division !== l.teams[USER].division)
      .flatMap((t) => teamPlayers(l, t.id).map((p) => [t.id, p] as const))
      .filter(([t, p]) => !playerTradeBlocker(l, p) && marketValue(ctx, l.teams[t], p) >= 1000)[0];
    const day2 = [...picksOf(l, USER, 2), ...picksOf(l, USER, 3)].map((p) => p.id);
    const without: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: day2 },
        { teamId, players: [star.id], picks: [] },
      ],
    };
    expect(judge(ctx, teamId, without, { vsUser: true }).refusal).toMatch(/first-round pick or a front-line player/);
    const withFirst: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: [...day2, picksOf(l, USER, 1)[0].id] },
        { teamId, players: [star.id], picks: [] },
      ],
    };
    expect(judge(ctx, teamId, withFirst, { vsUser: true }).refusal).toBeNull();
  });

  it('suggests a sweetener that closes the gap', () => {
    const l = fresh();
    // A good player whose salary fits; open a roster spot (a full roster is a rule problem).
    best(l, USER).at(-1)!.teamId = null;
    const target = best(l, AI).find((p) => playerOvr(p) >= 12 && capHit(p.contract!, l.season) < capSpace(l, USER))!;
    const proposal: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: [] },
        { teamId: AI, players: [target.id], picks: [] },
      ],
    };
    expect(evaluateTrade(l, proposal).problem).toBeNull();
    for (let i = 0; i < 4 && !evaluateTrade(l, proposal).accepts; i++) {
      const add = suggestSweetener(l, proposal);
      expect(add).not.toBeNull();
      if (add!.kind === 'pick') proposal.sides[0].picks.push(add!.id);
      else proposal.sides[0].players.push(add!.id);
    }
    expect(evaluateTrade(l, proposal).accepts).toBe(true);
  });

  it('explains rule problems instead of sweetening them', () => {
    const l = fresh();
    const target = best(l, AI)[2];
    const proposal: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: [] },
        { teamId: AI, players: [target.id], picks: [] },
      ],
    };
    expect(evaluateTrade(l, proposal).problem).toMatch(/too many players|over the cap/);
    expect(suggestSweetener(l, proposal)).toBeNull();
  });
});

describe('the deal search', () => {
  it('hands back a late pick when a package leaves the seller a late fifth-round pick ahead', () => {
    // A late pick rides back in 10-25% of NFL deals (docs/TRADES.md). Handed back only once the seller was an early
    // fifth's worth ahead (40 points), the opening league that commits next year like a settled one rode one back in
    // 9% of its AI deals: its packages land closer to the price.
    const l = fresh();
    const ctx = tradeContext(l);
    const ai = l.teams.filter((t) => t.id !== USER);
    let tried = 0;
    for (const seller of ai) {
      for (const target of best(l, seller.id).slice(0, 8)) {
        if (playerTradeBlocker(l, target) || marketValue(ctx, seller, target) <= 60) continue;
        for (const buyer of ai.filter((t) => t.id !== seller.id).slice(0, 6)) {
          const deal = dealFor(ctx, buyer, target);
          if (!deal || deal.proposal.sides[1].picks.length || deal.proposal.sides[0].players.length) continue;
          // A late pick that both GMs would still take with it: a seller this far ahead hands it back.
          const fits = tradeablePicks(ctx, seller.id, seller)
            .filter((pk) => goingRate(l, pk, ctx) <= 35)
            .some((pk) => {
              const [buys, sells] = deal.proposal.sides;
              const tried: TradeProposal = { sides: [buys, { ...sells, picks: [pk.id] }] };
              return (
                judge(ctx, seller.id, tried, { rosterCuts: true }).accepts &&
                judge(ctx, buyer.id, tried, { rosterCuts: true }).accepts
              );
            });
          if (!fits) continue;
          tried++;
          expect(balance(ctx, deal.proposal, 35).sides[1].picks, `${seller.abbrev} to ${buyer.abbrev}`).toHaveLength(1);
        }
      }
    }
    expect(tried).toBeGreaterThanOrEqual(3);
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
    const proposal: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: [pick.id] },
        { teamId: AI, players: [p.id], picks: [] },
      ],
    };
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

  it('blocks trades that break the cap or the roster', () => {
    const l = fresh();
    const stars = best(l, AI)
      .slice(0, 6)
      .map((p) => p.id);
    const v = tradeProblem(l, {
      sides: [
        { teamId: USER, players: [], picks: [] },
        { teamId: AI, players: stars, picks: [] },
      ],
    });
    expect(v).toMatch(/over the cap|too many players/);
  });

  it('keeps the window open on deadline day, after week 9, until week 10 is played', () => {
    const l = fresh();
    const swap = (): TradeProposal => ({
      sides: [
        { teamId: USER, players: [], picks: [picksOf(l, USER)[0].id] },
        { teamId: AI, players: [], picks: [picksOf(l, AI)[0].id] },
      ],
    });
    while (l.week <= TRADE_DEADLINE_WEEK) playWeek(l);
    expect(isDeadlineDay(l)).toBe(true);
    expect(tradeWindow(l)).toBeNull();
    expect(tradeProblem(l, swap())).toBeNull();
    playWeek(l);
    expect(isDeadlineDay(l)).toBe(false);
    expect(tradeProblem(l, swap())).toMatch(/deadline/);
  });

  it('hides the wait on new signings: each GM has his own, says it in words, and nothing is greyed out', () => {
    const l = fresh();
    const waits = l.teams.map((t) => signingWait(l, t.id));
    expect(Math.min(...waits)).toBeGreaterThanOrEqual(4);
    expect(Math.max(...waits)).toBeLessThanOrEqual(8);
    expect(new Set(waits).size).toBeGreaterThan(2);
    const p = best(l, AI).find((x) => x.contract!.kind === 'veteran')!;
    p.contract!.signedSeason = l.season;
    p.contract!.signedWeek = 0;
    // No league rule shows on the table...
    expect(playerTradeBlocker(l, p)).toBeNull();
    // ...but his GM won't move him yet, and says so without a week or a number.
    const ask: TradeProposal = {
      sides: [
        { teamId: USER, players: [], picks: picksOf(l, USER, 1).map((x) => x.id) },
        { teamId: AI, players: [p.id], picks: [] },
      ],
    };
    const refusal = judge(tradeContext(l), AI, ask, { vsUser: true }).refusal;
    expect(refusal).toMatch(/just signed/);
    expect(refusal).not.toMatch(/\d/);
    // Nor will a GM take a player you just signed.
    const mine = best(l, USER).find((x) => x.contract!.kind === 'veteran')!;
    mine.contract!.signedSeason = l.season;
    mine.contract!.signedWeek = 0;
    const offer: TradeProposal = {
      sides: [
        { teamId: USER, players: [mine.id], picks: [] },
        { teamId: AI, players: [], picks: [picksOf(l, AI, 7)[0].id] },
      ],
    };
    expect(judge(tradeContext(l), AI, offer, { vsUser: true }).refusal).toMatch(/signed with you/);
    // Once his own wait has passed, the line is gone.
    l.week = signingWait(l, AI) + 1;
    expect(judge(tradeContext(l), AI, ask, { vsUser: true }).refusal).toBeNull();
  });
});

describe('value v2', () => {
  it('values an expiring veteran less as the season runs out, and a long deal hardly at all less', () => {
    const l = fresh();
    const buyer = l.teams[3];
    // Players the buyer wants (an overpaid one is worth less than nothing, so ratios mean nothing for him).
    const wanted = (x: League['players'][number]) => playerOvr(x) >= 12 && playerValue(l, x, buyer) > 50;
    const expiring = l.teams
      .flatMap((t) => teamPlayers(l, t.id))
      .find((x) => x.teamId !== buyer.id && yearsLeft(x.contract!, l.season) === 1 && wanted(x))!;
    const long = l.teams
      .flatMap((t) => teamPlayers(l, t.id))
      .find((x) => x.teamId !== buyer.id && yearsLeft(x.contract!, l.season) >= 4 && wanted(x))!;
    const [e1, l1] = [playerValue(l, expiring, buyer), playerValue(l, long, buyer)];
    l.week = TRADE_DEADLINE_WEEK + 1;
    const [e10, l10] = [playerValue(l, expiring, buyer), playerValue(l, long, buyer)];
    expect(e10).toBeLessThan(e1 * 0.8);
    expect(l10).toBeGreaterThan(l1 * 0.75);
  });

  it('pays more for a starter where he fills a hole than behind a better one', () => {
    const l = fresh();
    const qbs = (teamId: number) =>
      teamPlayers(l, teamId)
        .filter((p) => p.position === 'QB')
        .sort((a, b) => playerOvr(b) - playerOvr(a));
    const target = qbs(AI)[0];
    const deep = l.teams.find((t) => t.id !== AI && playerOvr(qbs(t.id)[0]) > playerOvr(target) + 1)!;
    const hole = l.teams.find((t) => t.id !== AI && t.id !== deep.id)!;
    for (const p of qbs(hole.id)) p.teamId = null;
    expect(playerValue(l, target, hole)).toBeGreaterThan(2 * playerValue(l, target, deep));
  });

  it("doesn't sell a good starter for a seventh-round pick", () => {
    const l = fresh();
    const ctx = tradeContext(l);
    const starter = best(l, AI).find((p) => playerOvr(p) >= 13.5 && p.age <= 28)!;
    const buyer = l.teams.find((t) => t.id !== AI && t.id !== USER)!;
    const seventh = l.draftPicks.find((p) => p.ownerId === buyer.id && p.round === 7)!;
    const deal: TradeProposal = {
      sides: [
        { teamId: buyer.id, players: [], picks: [seventh.id] },
        { teamId: AI, players: [starter.id], picks: [] },
      ],
    };
    expect(judge(ctx, AI, deal, { rosterCuts: true }).accepts).toBe(false);
  });

  it('weighs salary by cap room: typical teams at 1, rich ones less, squeezed ones more', () => {
    const l = fresh();
    const ctx = tradeContext(l);
    const w = l.teams.map((t) => salaryWeight(ctx, t.id)).sort((a, b) => a - b);
    expect(w[0]).toBeGreaterThanOrEqual(0.5);
    expect(w.at(-1)!).toBeLessThanOrEqual(2);
    expect(w[16]).toBeGreaterThan(0.85);
    expect(w[16]).toBeLessThan(1.15);
    expect(w[0]).toBeLessThan(w.at(-1)!);
  });

  it('plays the same market from the same seed', () => {
    const trades = () => {
      const l = fresh();
      while (l.week <= 4) playWeek(l);
      return l.transactions.filter((t) => t.kind === 'trade').map((t) => t.text);
    };
    expect(trades()).toEqual(trades());
  });
});
