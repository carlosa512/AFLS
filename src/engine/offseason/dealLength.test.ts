import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { leagueMarket, marketApy } from '../finance/market';
import { askOffer, demand, makeOffer, offerProblem, offerValue } from './negotiation';

describe("a deal's length in talks (project B)", () => {
  it('a cheap player asks one year, and a five-year offer at his price still closes', () => {
    const l = createLeague({ seed: 'deal-length' });
    const m = leagueMarket(l);
    const p = Object.values(l.players).find(
      (x) => x.position === 'WR' && x.teamId !== null && marketApy(m, { ...x, age: 27 }) / m.cap < 0.008,
    )!;
    p.age = 27;
    const d = demand(l, p, p.teamId!);
    expect(d.askYears).toBe(1);
    const offer = { years: 5, apy: d.askApy, bonusPct: 0, gtdPct: d.askGtdPct, voidYears: 0 };
    expect(offerValue(l, p, p.teamId!, offer, d)).toBeGreaterThanOrEqual(d.walkAway);
  });
});

describe('a longer deal at his price is never refused for its length (final review)', () => {
  it('every one-year asker takes three or five years at his ask, the minimum players included', () => {
    const l = createLeague({ seed: 'deal-length' });
    let n = 0;
    let atMin = 0;
    for (const p of Object.values(l.players)) {
      if (p.teamId === null || p.retired) continue;
      const d = demand(l, p, p.teamId);
      if (d.askYears !== 1) continue;
      // Only players who'd take their own ask: the length is the one thing changed.
      if (offerValue(l, p, p.teamId, askOffer(d), d) < d.walkAway) continue;
      n++;
      if (d.askApy <= d.walkAway) atMin++;
      for (const years of [3, 5]) {
        const offer = { years, apy: d.askApy, bonusPct: 0, gtdPct: d.askGtdPct, voidYears: 0 };
        expect(offerValue(l, p, p.teamId, offer, d), `${p.id} ${years}`).toBeGreaterThanOrEqual(d.walkAway);
      }
    }
    expect(n).toBeGreaterThan(100);
    expect(atMin).toBeGreaterThan(0);
  });
});

describe('a refusal over length says so (final review)', () => {
  it('an offer that pays enough over his years but is short of them is turned down for the years, not the money', () => {
    const l = createLeague({ seed: 'deal-length' });
    // One of ours he could sign today (an extension, nothing in the way but the offer), asking two years or more.
    const p = Object.values(l.players).find((x) => {
      if (x.teamId !== l.userTeamId) return false;
      const d = demand(l, x, l.userTeamId);
      return (
        d.askYears >= 2 && d.walkAway > 3000 && offerProblem(l, x, l.userTeamId, { ...askOffer(d), years: 1 }) === null
      );
    })!;
    expect(p).toBeDefined();
    const d = demand(l, p, l.userTeamId);
    // Just enough pay at his years: one year at the same pay falls short only for the years.
    const perDollar = offerValue(l, p, l.userTeamId, { ...askOffer(d), apy: 1 }, d);
    const apy = Math.ceil((d.walkAway / perDollar) * 1.001);
    expect(offerValue(l, p, l.userTeamId, { ...askOffer(d), apy, years: 1 }, d)).toBeLessThan(d.walkAway);
    const r = makeOffer(l, p, l.userTeamId, { ...askOffer(d), apy, years: 1 });
    expect(r.accepted).toBe(false);
    expect(r.message).toBe(`The money works. He wants ${d.askYears} years.`);
  });
});
