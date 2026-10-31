import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { playerOvr } from '../positions';
import { Rng } from '../rng';
import type { League } from '../types';
import { aiFreeAgencyDay, fitOffer, spendable } from './ai';
import { advanceOffseason, beginOffseason, FA_DAYS } from './index';
import { demand, freeAgents } from './negotiation';

/** A league at free agency's last day, after one season. */
const lastDay = (() => {
  const l = createLeague({ seed: 'late-market' });
  simToEndOfSeason(l);
  beginOffseason(l);
  while (l.phase !== 'freeAgency') advanceOffseason(l, { autoUser: true });
  l.faDay = FA_DAYS;
  return JSON.stringify(l);
})();

describe('the late market: a club offers what it can fit', () => {
  const offer = { years: 4, apy: 9_000, bonusPct: 0.3, gtdPct: 0.5, voidYears: 1 };

  it('turns a deal it can’t fit into one year at the room it has', () => {
    expect(fitOffer(offer, 5_200.7, 1_100)).toEqual({ years: 1, apy: 5_200, bonusPct: 0, gtdPct: 0.5, voidYears: 0 });
  });

  it('never offers more than the market deal, nor below the minimum', () => {
    expect(fitOffer(offer, 20_000, 1_100)!.apy).toBe(9_000);
    expect(fitOffer(offer, 900, 1_100)).toBeNull();
  });

  it('signs a wanted free agent on the room left when it beats his walk-away, and not when it doesn’t', () => {
    // The best young free agent left; every AI club but one with no room, and that one with room under his market
    // price (so no market-priced deal fits) but clear of what he'll walk away from, or (in a copy) short of it.
    const pick = (l: League) =>
      freeAgents(l)
        .filter((p) => !p.injury && p.age <= 29)
        .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    const setUp = (clubId: number, room: (walkAway: number, market: number) => number) => {
      const l: League = JSON.parse(lastDay);
      const p = pick(l);
      for (const t of l.teams) {
        if (t.id === l.userTeamId) continue;
        const d = demand(l, p, t.id);
        const want = t.id === clubId ? room(d.walkAway, d.market) : -1_000;
        t.deadMoney.push({
          season: l.season,
          amount: Math.round(spendable(l, t.id) - want),
          playerId: -1,
          note: 'test',
        });
      }
      aiFreeAgencyDay(l, new Rng('late'));
      return l.players[p.id];
    };
    const l: League = JSON.parse(lastDay);
    let signed = false;
    for (const t of l.teams) {
      if (t.id === l.userTeamId) continue;
      const got = setUp(t.id, (walkAway, market) => Math.min(walkAway / 0.88, market * 0.84));
      if (got.teamId !== t.id) continue;
      signed = true;
      expect(got.contract!.length).toBe(1);
      expect(setUp(t.id, (walkAway) => walkAway * 0.8).teamId).toBeNull();
      break;
    }
    expect(signed).toBe(true);
  }, 120_000);
});
