import { describe, expect, it } from 'vitest';
import { capHit } from '../finance/contract';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { playerOvr } from '../positions';
import { Rng } from '../rng';
import type { League, Player } from '../types';
import {
  aiFreeAgencyDay,
  bankBuys,
  CLEARING_DAY,
  clearingFloor,
  fitOffer,
  fitsNextYear,
  fundedRoom,
  inSeasonReserve,
  spendable,
} from './ai';
import { capHit as hitOf } from '../finance/contract';
import { capSheet, releasePreview } from '../finance/cap';
import { leagueMarket, marketApy, minSalary } from '../finance/market';
import { setTeam } from '../roster';
import { advanceOffseason, beginOffseason, FA_DAYS } from './index';
import { demand, freeAgents, OFFSEASON_ROSTER_MAX, offerValue } from './negotiation';
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
    // What a one-year deal must pay at a club to clear his walk-away there (his valuation is linear in the pay).
    const floorPay = (l: League, p: Player, teamId: number) => {
      const unit = offerValue(l, p, teamId, { years: 1, apy: 1_000, bonusPct: 0, gtdPct: 0.5, voidYears: 0 }) / 1_000;
      return demand(l, p, teamId).walkAway / unit;
    };
    // A club where room clear of his floor is still under his market price: the case this test needs.
    const testable = (l: League, p: Player, teamId: number) =>
      floorPay(l, p, teamId) * 1.03 <= demand(l, p, teamId).market * 0.84;
    // The best young free agent left that some club can test (his walk-away sits near the cut-off at every club, so
    // which one it is depends on the world a season of play leaves).
    const pick = (l: League) =>
      freeAgents(l)
        .filter((p) => !p.injury && p.age <= 29)
        .sort((a, b) => playerOvr(b) - playerOvr(a) || a.id - b.id)
        .find((p) => l.teams.some((t) => t.id !== l.userTeamId && testable(l, p, t.id)))!;
    const setUp = (clubId: number, room: (floor: number, market: number) => number, day = FA_DAYS) => {
      const l: League = JSON.parse(lastDay);
      const p = pick(l);
      l.faDay = day; // after the pick: his walk-away eases with the day
      // He's the only one left on the market, so the club's room is his (a club spends it on the best it wants first).
      for (const q of freeAgents(l)) if (q.id !== p.id) q.retired = true;
      for (const t of l.teams) {
        if (t.id === l.userTeamId) continue;
        const d = demand(l, p, t.id);
        // Far enough under for the rest that no single cut could cover a deal.
        const want = t.id === clubId ? room(floorPay(l, p, t.id), d.market) : -100_000;
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
      // Room clear of his floor at this club but under his market price; a club where no such room exists can't test it.
      if (!testable(l, pick(l), t.id)) continue;
      const got = setUp(t.id, (floor) => floor * 1.03);
      if (got.teamId !== t.id) continue;
      signed = true;
      expect(got.contract!.length).toBe(1);
      // Room short of his walk-away before day 3: never a deal below it.
      const short = setUp(t.id, (floor) => floor * 0.8, CLEARING_DAY - 1);
      if (short.teamId !== null) {
        const l2: League = JSON.parse(lastDay);
        expect(capHit(short.contract!, l2.season)).toBeGreaterThanOrEqual(0.9 * demand(l2, pick(l2), t.id).walkAway);
      }
      // From day 3 the market has shown its hand: the best offer made for him, at least half his walk-away, signs him.
      const cleared = setUp(t.id, (floor) => floor * 0.7, CLEARING_DAY);
      expect(cleared.teamId).toBe(t.id);
      // Far under half, still nothing.
      expect(setUp(t.id, (floor) => floor * 0.3, CLEARING_DAY).teamId).toBeNull();
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

describe('spending discipline', () => {
  const offer = { years: 4, apy: 9_000, bonusPct: 0.3, gtdPct: 0.5, voidYears: 1 };

  it('a fitted offer to a 26-year-old runs two years; to a 31-year-old one', () => {
    expect(fitOffer(offer, 5_200.7, 1_100, 26)).toEqual({
      years: 2,
      apy: 5_200,
      bonusPct: 0,
      gtdPct: 0.5,
      voidYears: 0,
    });
    expect(fitOffer(offer, 5_200.7, 1_100, 31)!.years).toBe(1);
  });

  it('a multi-year bid that eats next year’s keepers’ room is refused', () => {
    // Next year's books, its keepers and the draft, and the new deal, within what this GM lets next year carry.
    expect(fitsNextYear(250_000, 30_000, 20_000, 310_000)).toBe(true);
    expect(fitsNextYear(250_000, 50_000, 20_000, 310_000)).toBe(false);
  });

  it('a bank club passes on a 30-year-old marginal upgrade but signs a 25-year-old', () => {
    expect(bankBuys(30, 1.2, 1)).toBe(false);
    expect(bankBuys(25, 1.2, 1)).toBe(true);
    expect(bankBuys(30, 2.5, 1)).toBe(true); // a big upgrade, whatever his age
  });
});

describe('the market clears', () => {
  it('clearingFloor: best fitted at least half → that; below half → his walk-away; never under the minimum', () => {
    expect(clearingFloor(10_000, 6_000, 1_000)).toBe(6_000);
    expect(clearingFloor(10_000, 4_000, 1_000)).toBe(10_000);
    expect(clearingFloor(10_000, null, 1_000)).toBe(10_000);
    expect(clearingFloor(1_500, 800, 1_000)).toBe(1_000);
  });

  /** Camp opens: a young star nobody had room for, every AI club with no room at all but one with none past its reserves. */
  const lastCall = () => {
    const l: League = JSON.parse(lastDay);
    l.phase = 'preseason';
    const market = leagueMarket(l);
    const star = Object.values(l.players)
      .filter((p) => p.teamId !== null && p.teamId !== l.userTeamId && p.contract && !p.injury && p.age <= 26)
      .sort((a, b) => marketApy(market, b) - marketApy(market, a))[0];
    setTeam(l, star, null);
    star.contract = null;
    for (const q of freeAgents(l)) if (q.id !== star.id) q.retired = true;
    return { l, star };
  };

  it('on the last call a young star signs with a needy club that cuts its weakest minimum man', () => {
    const { l, star } = lastCall();
    const club = l.teams.find((t) => t.id !== l.userTeamId && fundedRoom(l, t, star.position).cut)!;
    for (const t of l.teams) {
      if (t.id === l.userTeamId) continue;
      const want = t.id === club.id ? 0 : -100_000;
      t.deadMoney.push({ season: l.season, amount: Math.round(spendable(l, t.id) - want), playerId: -1, note: 'test' });
    }
    const cut = fundedRoom(l, club, star.position).cut!;
    const dead = capSheet(l, club.id, l.season).dead;
    aiFreeAgencyDay(l, new Rng('funded'), { rosterMax: OFFSEASON_ROSTER_MAX, lastCall: true });
    expect(l.players[star.id].teamId).toBe(club.id);
    expect(l.players[cut.id].teamId).toBeNull();
    expect(capSheet(l, club.id, l.season).dead).toBe(dead);
  }, 120_000);

  it('no funding from a cut that would leave dead money', () => {
    const { l } = lastCall();
    for (const t of l.teams)
      for (const pos of ['QB', 'WR', 'OL', 'CB', 'EDGE'] as const) {
        const { cut } = fundedRoom(l, t, pos);
        if (!cut) continue;
        expect(cut.contract!.kind).toBe('minimum');
        expect(releasePreview(l, cut).thisYear + releasePreview(l, cut).nextYear).toBe(0);
      }
  });

  it('funding draws at most half the in-season reserve', () => {
    const { l } = lastCall();
    for (const t of l.teams.slice(0, 8)) {
      const f = fundedRoom(l, t, 'WR');
      const cutPay = f.cut ? hitOf(f.cut.contract!, l.season) : 0;
      expect(f.room).toBeCloseTo(spendable(l, t.id) + 0.5 * inSeasonReserve(l, t.id) + cutPay);
      expect(f.cut === null || hitOf(f.cut.contract!, l.season) <= minSalary(30, l.caps[l.season])).toBe(true);
    }
  });

  it('never cuts or signs for your club on the last call', () => {
    const { l } = lastCall();
    const mine = activeRoster(l, l.userTeamId).map((p) => p.id);
    aiFreeAgencyDay(l, new Rng('funded'), { rosterMax: OFFSEASON_ROSTER_MAX, lastCall: true });
    expect(activeRoster(l, l.userTeamId).map((p) => p.id)).toEqual(mine);
  }, 120_000);
});
