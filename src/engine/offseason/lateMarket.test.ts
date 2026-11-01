import { describe, expect, it } from 'vitest';
import { capHit } from '../finance/contract';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { playerOvr } from '../positions';
import { Rng } from '../rng';
import type { League } from '../types';
import { aiFreeAgencyDay, fitOffer, spendable } from './ai';
import { advanceOffseason, beginOffseason, FA_DAYS } from './index';
import { demand, freeAgents, OFFSEASON_ROSTER_MAX } from './negotiation';
import { activeRoster } from '../roster';
import { releasePlayer } from '../finance/cap';

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
        // Far enough under for the rest that no single cut could cover a deal.
        const want = t.id === clubId ? room(d.walkAway, d.market) : -100_000;
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
      // Room short of his walk-away: never a deal below it (the club may cut a lesser player to pay it).
      const short = setUp(t.id, (walkAway) => walkAway * 0.8);
      if (short.teamId !== null) {
        const l2: League = JSON.parse(lastDay);
        expect(capHit(short.contract!, l2.season)).toBeGreaterThanOrEqual(0.9 * demand(l2, pick(l2), t.id).walkAway);
      }
      break;
    }
    expect(signed).toBe(true);
  }, 120_000);
});

describe('the late market runs past day 5', () => {
  /** The draft step from free agency's end: what was left, and the league after. */
  const draftStep = (autoUser: boolean) => {
    const l: League = JSON.parse(lastDay);
    advanceOffseason(l, { autoUser }); // free agency's last day closes: the draft opens
    expect(l.phase).toBe('draft');
    // Eight good starters on AI clubs, cut once free agency has closed: what the late passes have to place.
    const cut = Object.values(l.players)
      .filter((p) => p.teamId !== null && p.teamId !== l.userTeamId && p.contract && !p.injury && p.age <= 29)
      .filter((p) => playerOvr(p) >= 12.5 && playerOvr(p) <= 14)
      .slice(0, 8);
    for (const p of cut) releasePlayer(l, p);
    const starters = (x: League) =>
      freeAgents(x)
        .filter((p) => playerOvr(p) >= 12 && p.age <= 31)
        .map((p) => p.id);
    const left = starters(l);
    const before = activeRoster(l, l.userTeamId).map((p) => p.id);
    advanceOffseason(l, { autoUser });
    return { l, left, after: starters(l), before };
  };

  it('signs most of the starter-quality free agents left after day 5 by the time camp opens', () => {
    const { left, after } = draftStep(true);
    expect(left.length).toBeGreaterThan(5);
    expect(after.length).toBeLessThanOrEqual(0.6 * left.length);
  }, 120_000);

  it('never takes a club past the 90', () => {
    const { l } = draftStep(true);
    for (const t of l.teams) expect(activeRoster(l, t.id).length).toBeLessThanOrEqual(OFFSEASON_ROSTER_MAX);
  }, 120_000);

  it('signs nobody for a club whose front office you run', () => {
    const { l, before } = draftStep(false);
    const drafted = new Set(l.draftClass ?? []);
    const added = activeRoster(l, l.userTeamId).filter(
      (p) => !before.includes(p.id) && !(p.draft && p.draft.season === l.season),
    );
    expect(added.map((p) => p.id).filter((id) => !drafted.has(id))).toEqual([]);
  }, 120_000);
});
