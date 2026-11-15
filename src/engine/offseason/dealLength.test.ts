import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { leagueMarket, marketApy } from '../finance/market';
import { demand, offerValue } from './negotiation';

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
