import { afterEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import type { League, Phase, RaceOffer } from '../types';
import { raiseTo, teamMoney, yearOne, type BidPass } from './bids';
import { advanceOffseason, beginOffseason, FA_DAYS } from './index';
import { decides, raceWatch, rankOffers, RACE, type DecideOpts, type RankedOffer } from './race';

/** A ranked offer worth `value` to him at `apy` a year. */
const offer = (teamId: number, value: number, apy = 1): RankedOffer => ({
  teamId,
  offer: { years: 3, apy, bonusPct: 0, gtdPct: 0.3, voidYears: 0 },
  value,
  floor: 0.5,
});

/** Nobody waited, an average patience, not the last day, an ask no offer reaches. */
const fresh = { waited: 0, patience: 0.5, lastDay: false, askApy: Infinity };

describe('when he decides', () => {
  it('needs an offer', () => {
    expect(decides([], fresh)).toBe(false);
    expect(decides([], { ...fresh, lastDay: true })).toBe(false);
  });

  it('takes a lone offer: nobody to beat', () => {
    expect(decides([offer(1, 1)], fresh)).toBe(true);
  });

  it('takes a best offer that stands out by the lead', () => {
    expect(decides([offer(1, 1.1), offer(2, 1)], fresh)).toBe(true);
    expect(decides([offer(1, 1.05), offer(2, 1)], fresh)).toBe(false);
  });

  it('takes his best once he has waited long enough, longer when patient', () => {
    const close = [offer(1, 1.05), offer(2, 1)];
    expect(decides(close, { ...fresh, waited: 2, patience: 0 })).toBe(true);
    expect(decides(close, { ...fresh, waited: 2, patience: 1 })).toBe(false);
  });

  it('needs half the lead for an offer at his full ask', () => {
    expect(RACE.lead).toBe(0.08);
    expect(decides([offer(1, 1.05, 10), offer(2, 1)], { ...fresh, askApy: 10 })).toBe(true);
    expect(decides([offer(1, 1.03, 10), offer(2, 1)], { ...fresh, askApy: 10 })).toBe(false);
    expect(decides([offer(1, 1.05, 9), offer(2, 1)], { ...fresh, askApy: 10 })).toBe(false);
  });

  it('settles on the last day with any offer', () => {
    expect(decides([offer(1, 1.01), offer(2, 1), offer(3, 1)], { ...fresh, lastDay: true })).toBe(true);
  });
});

/** A league at the re-sign window after one season: the next step opens free agency. */
const atResign = (() => {
  const l = createLeague({ seed: 'front-office-b' });
  simToEndOfSeason(l);
  beginOffseason(l);
  while (l.phase !== 'resign') advanceOffseason(l, { autoUser: true });
  return JSON.stringify(l);
})();

/** A copy of the world on free agency's day `day`, its staff running your team unless `autoUser` is false. */
function onDay(day: number, autoUser = true): League {
  const l: League = JSON.parse(atResign);
  advanceOffseason(l, { autoUser });
  expect(l.phase).toBe('freeAgency');
  while (l.faDay < day) advanceOffseason(l, { autoUser });
  return l;
}

/** What the race judged for a player: his offers that day, the ones he would sign, best first, and what else he weighed. */
type Judged = { offers: RaceOffer[]; ranked: RankedOffer[]; o: DecideOpts };

/** The next advance, with what the race judged for each player (`check` sees each in the day's own pass). */
function advanceWatched(l: League, check?: (pass: BidPass, j: Judged, playerId: number) => void): Map<number, Judged> {
  const seen = new Map<number, Judged>();
  raceWatch.onJudge = (pass, p, offers, ranked, o) => {
    const j = { offers: structuredClone([...offers]), ranked: structuredClone([...ranked]), o: { ...o } };
    seen.set(p.id, j);
    check?.(pass, j, p.id);
  };
  advanceOffseason(l, { autoUser: true });
  delete raceWatch.onJudge;
  return seen;
}

/** Free-agency signings this league year. */
const faSignings = (l: League) =>
  l.transactions.filter((t) => t.kind === 'sign' && t.season === l.season && t.phase === 'freeAgency');

describe('the race for AI teams', () => {
  afterEach(() => {
    delete raceWatch.onJudge;
    delete raceWatch.onFit;
  });

  it('opening offers are in and nobody signs', () => {
    const l = onDay(1);
    const race = l.faRace!;
    expect(race.season).toBe(l.season);
    expect(Object.keys(race.offers).length).toBeGreaterThanOrEqual(10);
    expect(faSignings(l)).toHaveLength(0);
    // Only an offer at his walk-away stands, and every one is the team's opening price.
    for (const [id, offers] of Object.entries(race.offers)) {
      expect(rankOffers(l, l.players[+id], offers)).toHaveLength(offers.length);
      for (const o of offers) expect(o.first).toBe(o.offer.apy);
      expect(race.since[+id]).toBe(1);
    }
    expect(race.results).toEqual([]);
  });

  it('a clear leader signs, a close race waits', () => {
    const l = onDay(1);
    // Day 1: a player whose best doesn't stand out yet waits with his offers standing.
    let day = l.faDay;
    let seen = advanceWatched(l);
    const waiting = [...seen].filter(([, j]) => j.ranked.length >= 2 && !decides(j.ranked, j.o));
    expect(waiting.length).toBeGreaterThan(0);
    for (const [id, j] of waiting) {
      expect(l.players[id].teamId).toBeNull();
      expect(l.faRace!.offers[id].map((o) => o.teamId).sort()).toEqual(j.ranked.map((r) => r.teamId).sort());
    }
    // Every day, whoever signs in the race decided that day, for his best offer.
    let results = 0;
    for (;;) {
      for (const r of l.faRace!.results.filter((x) => x.day === day)) {
        const j = seen.get(r.playerId)!;
        expect(decides(j.ranked, j.o)).toBe(true);
        expect(r).toMatchObject({ teamId: j.ranked[0].teamId, offers: j.ranked.length });
        expect(l.players[r.playerId].teamId).toBe(r.teamId);
        results++;
      }
      if (l.phase !== 'freeAgency') break;
      day = l.faDay;
      seen = advanceWatched(l);
    }
    expect(results).toBeGreaterThan(0);
  });

  it("AI raises stop at the team's limit", () => {
    const l = onDay(1);
    let offers = 0;
    let raised = 0;
    // As a team sets its offers, it would still make each at its price.
    raceWatch.onFit = (pass, teamId, made) => {
      for (const { p, bid } of made) {
        expect(bid.team.id).toBe(teamId);
        expect(raiseTo(pass, p, bid, bid.offer.apy)).not.toBeNull();
      }
    };
    while (l.phase === 'freeAgency')
      advanceWatched(l, (pass, j) => {
        const ai = new Set(pass.teams.map((t) => t.id));
        for (const o of j.offers) {
          if (!ai.has(o.teamId)) continue;
          offers++;
          if (o.offer.apy > o.first) raised++;
          expect(o.offer.apy).toBeLessThanOrEqual(o.first * RACE.ceiling);
        }
      });
    expect(offers).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
  });

  it("a team's offers fit its money", () => {
    const l: League = JSON.parse(atResign);
    let teams = 0;
    raceWatch.onFit = (pass, teamId, made) => {
      teams++;
      const bids = made.map((m) => m.bid);
      const m = teamMoney(pass, teamId);
      // Year-one charges, less the room the one restructure it may plan would make.
      const total = bids.reduce((a, b) => a + yearOne(b.offer) - (b.plan?.saved ?? 0), 0);
      expect(total).toBeLessThanOrEqual(m.budget + m.back * Math.min(bids.length, m.spots));
      expect(bids.length).toBeLessThanOrEqual(Math.min(m.room, m.signingsLeft));
      expect(bids.filter((b) => b.plan).length).toBeLessThanOrEqual(1);
    };
    // The opening offers, then each day's.
    do advanceOffseason(l, { autoUser: true });
    while (l.phase === 'freeAgency');
    expect(teams).toBeGreaterThan(5 * 20);
  });

  it('no raises on the last day', () => {
    const l = onDay(FA_DAYS);
    const before = structuredClone(l.faRace!.offers);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    const seen = advanceWatched(l);
    let compared = 0;
    for (const [id, offers] of Object.entries(before)) {
      const today = seen.get(+id)?.offers ?? [];
      for (const o of offers) {
        const now = today.find((t) => t.teamId === o.teamId);
        if (!now) continue;
        compared++;
        expect(now.offer.apy).toBeLessThanOrEqual(o.offer.apy);
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('the last day settles everyone with a valid offer', () => {
    const l = onDay(FA_DAYS);
    const seen = advanceWatched(l);
    expect(l.phase as Phase).toBe('draft');
    const race = l.faRace!;
    expect(race.offers).toEqual({});
    let settled = 0;
    for (const [id, j] of seen) {
      if (!j.ranked.length) continue;
      settled++;
      expect(l.players[id].teamId).toBe(j.ranked[0].teamId);
      expect(race.results.find((r) => r.playerId === id)).toMatchObject({ day: FA_DAYS, teamId: j.ranked[0].teamId });
    }
    expect(settled).toBeGreaterThan(0);
  });

  it('a staff-run team bids like an AI team', () => {
    const offersFrom = (l: League, teamId: number) =>
      Object.values(l.faRace!.offers).filter((offers) => offers.some((o) => o.teamId === teamId)).length;
    const staff = onDay(1);
    expect(offersFrom(staff, staff.userTeamId)).toBeGreaterThan(0);
    const yours = onDay(1, false);
    expect(offersFrom(yours, yours.userTeamId)).toBe(0);
  });

  it('a save from before the race', () => {
    const l = onDay(2);
    delete l.faRace;
    const signed = faSignings(l).length;
    advanceOffseason(l, { autoUser: true });
    expect(l.faDay).toBe(3);
    expect(Object.keys(l.faRace!.offers).length).toBeGreaterThan(0);
    expect(l.faRace!.results).toEqual([]);
    expect(faSignings(l)).toHaveLength(signed);
  });
});
