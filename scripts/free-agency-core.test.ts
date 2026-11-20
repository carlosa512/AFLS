import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../src/engine/generate';
import { buildContract } from '../src/engine/finance/contract';
import { activeRoster, retirePlayer, setTeam } from '../src/engine/roster';
import type { Contract, League, Player } from '../src/engine/types';
import {
  dealLengths,
  ELITE,
  faMeasures,
  GOOD,
  goodEnds,
  pooledMarket,
  pooledOutOfFootball,
  raceMeasures,
  windowStart,
  type FaMeasures,
} from './free-agency-core';

const template = createLeague({ seed: 'fa-core', personnel: true });
let l: League;
beforeEach(() => {
  l = structuredClone(template);
});

/** A deal signed in `signed` for `years` at `share` of that year's cap. */
function deal(signed: number, years: number, share: number, kind: Contract['kind'] = 'veteran'): Contract {
  l.caps[signed] ??= l.caps[l.season];
  const apy = Math.round(share * l.caps[signed]);
  const c = buildContract(
    { years, total: apy * years, signingBonus: 0, guaranteedBase: 0, voidYears: 0 },
    signed,
    kind,
    900,
  );
  c.apy = apy;
  c.signedSeason = signed;
  return c;
}
/** A player of club `teamId` whose good deal ended last season. */
function ending(teamId: number, i: number, share = GOOD * 2): Player {
  const p = activeRoster(l, teamId)[i];
  p.contract = deal(l.season - 3, 3, share);
  return p;
}

describe('the free-agency check', () => {
  it('a good deal re-signed with his club is stayed; with another club moved; unsigned, squad or retired none', () => {
    const [stay, move, gone] = [ending(0, 0), ending(0, 1), ending(0, 2)];
    const start = windowStart(l);
    expect(start.ending.map((e) => e.id).sort()).toEqual([stay.id, move.id, gone.id].sort());
    stay.contract = deal(l.season, 3, GOOD * 2);
    setTeam(l, move, 5);
    move.contract = deal(l.season, 3, GOOD * 2);
    setTeam(l, gone, null);
    gone.contract = null;
    const m = faMeasures(start, l);
    expect(m.ends).toBe(3);
    expect([m.stayed, m.moved, m.none]).toEqual([1 / 3, 1 / 3, 1 / 3]);
  });

  it('a deal ends where its play does: a void year after its last real year leaves it counted', () => {
    const p = ending(0, 0);
    const apy = p.contract!.apy;
    p.contract = buildContract(
      { years: 3, total: apy * 3, signingBonus: apy, guaranteedBase: 0, voidYears: 1 },
      l.season - 3,
      'veteran',
      900,
    );
    p.contract.apy = apy;
    expect(p.contract.years.at(-1)).toMatchObject({ season: l.season, void: true });
    expect(windowStart(l).ending.map((e) => e.id)).toEqual([p.id]);
  });

  it('read before the new league year, a man who retires as his good deal ends is a no deal (the NFL counts him so)', () => {
    const [stay, gone] = [activeRoster(l, 0)[0], activeRoster(l, 0)[1]];
    for (const p of [stay, gone]) p.contract = deal(l.season - 2, 3, GOOD * 2);
    // The league's own deals ending this season are read too: the scene's two are among them.
    const ends = goodEnds(l).filter((e) => e.id === stay.id || e.id === gone.id);
    expect(ends).toHaveLength(2);
    // The new league year: one retires, the other re-signs.
    setTeam(l, gone, null);
    gone.contract = null;
    retirePlayer(l, gone);
    stay.contract = deal(l.season + 1, 2, GOOD * 2);
    const m = faMeasures(windowStart(l, ends), l);
    expect([m.ends, m.stayed, m.none]).toEqual([2, 0.5, 0.5]);
  });

  it('a deal under 2% of the cap the year it was signed is not counted', () => {
    ending(0, 0, GOOD / 2);
    expect(windowStart(l).ending).toHaveLength(0);
  });

  it('an outside signing counts once, by its new club; a one-year one in the one-year share', () => {
    const [a, b] = [ending(0, 0), ending(1, 0)];
    const start = windowStart(l);
    setTeam(l, a, 7);
    a.contract = deal(l.season, 3, GOOD * 2);
    setTeam(l, b, 8);
    b.contract = deal(l.season, 1, GOOD * 2);
    const m = faMeasures(start, l);
    expect(m.outside).toBe(2);
    expect(m.oneYear).toBe(0.5);
    expect(m.clubs3).toBe(0);
  });

  it('a 26-year-old free agent priced at 5%+ at kickoff is an elite young unsigned player', () => {
    const best = Object.values(l.players)
      .filter((p) => p.teamId !== null && p.position === 'QB')
      .sort((a, b) => b.potential - a.potential)[0];
    const start = windowStart(l);
    setTeam(l, best, null);
    best.contract = null;
    best.age = 26;
    expect(faMeasures(start, l).eliteYoungUnsigned).toBe(1);
    best.age = 29;
    expect(faMeasures(start, l).eliteYoungUnsigned).toBe(0);
    // Hurt, he isn't one the market failed: nobody pays market price for a man who'll miss the start.
    best.age = 26;
    best.injury = { type: 'test', severity: 'moderate', weeksRemaining: 6, estimate: [4, 8] } as never;
    expect(faMeasures(start, l).eliteYoungUnsigned).toBe(0);
    expect(ELITE).toBe(0.05);
  });
});

describe('deal lengths by pay', () => {
  it('counts every veteran deal signed this offseason by pay band', () => {
    const at = (i: number) => activeRoster(l, 0)[i];
    for (const p of Object.values(l.players)) if (p.contract) p.contract.signedSeason = l.season - 1;
    at(0).contract = deal(l.season, 1, 0.005);
    at(1).contract = deal(l.season, 2, 0.015);
    at(2).contract = deal(l.season, 4, 0.06);
    at(3).contract = deal(l.season, 4, 0.01, 'rookie');
    at(4).contract = deal(l.season, 1, 0.08, 'tag');
    const d = dealLengths(l, l.season);
    expect(d.min).toEqual({ n: 1, mean: 1, oneYear: 1 });
    expect(d.mid).toEqual({ n: 1, mean: 2, oneYear: 0 });
    expect(d.big).toEqual({ n: 1, mean: 4, oneYear: 0 });
    expect(d.good.n).toBe(0);
    expect(d.star.n).toBe(0);
  });
});

describe('the market pooled over seasons 2–6 (market and exits)', () => {
  const season = (outside: number): FaMeasures =>
    ({ outside, oneYear: 0.2, clubs3: 10, none: 0.1, released: 0.25 }) as FaMeasures;
  it('pooledMarket averages seasons 2–6 of every league', () => {
    const a = [10, 20, 30, 40, 50, 60].map(season);
    const b = [20, 30, 40, 50, 60, 70].map(season);
    const p = pooledMarket([a, b]);
    expect(p.outside).toBeCloseTo(45);
    expect(p.oneYear).toBeCloseTo(0.2);
    expect(p.released).toBeCloseTo(0.25);
    expect(
      pooledOutOfFootball([
        [9, 1, 2, 3, 4, 5],
        [9, 5, 4, 3, 2, 1],
      ]),
    ).toBeCloseTo(3);
  });

  it('released counts a good outside signing cut by his club this league year', () => {
    const [cut, walked] = [ending(0, 0), ending(1, 0)];
    cut.contract = deal(l.season - 1, 4, GOOD * 2);
    const start = windowStart(l);
    for (const [p, to] of [
      [cut, 7],
      [walked, 8],
    ] as const) {
      setTeam(l, p, to);
      p.contract = deal(l.season, 3, GOOD * 2);
    }
    cut.left = [{ teamId: 0, season: l.season, how: 'cut' }];
    const m = faMeasures(start, l);
    expect(m.outside).toBe(2);
    expect(m.released).toBeCloseTo(0.5);
  });
});

describe('the free-agency race measured', () => {
  const at = (day: number, offers: number, apyShare: number) => ({
    playerId: 1,
    teamId: 0,
    day,
    offers,
    userPlace: null,
    apyShare,
  });
  it('counts good signings by day, the elite mean day and the contested share', () => {
    l.faRace = {
      offers: {},
      since: {},
      warnings: [],
      warnedSinceLead: [],
      results: [
        at(1, 1, GOOD * 2),
        at(1, 2, GOOD * 2),
        at(3, 1, ELITE * 2),
        // Under GOOD, and one with no recorded deal: neither counts.
        at(5, 3, GOOD / 2),
        { playerId: 2, teamId: 0, day: 2, offers: 2, userPlace: null },
      ],
    } as never;
    const m = raceMeasures(l);
    expect(m.n).toBe(3);
    expect(m.byDay.map((v) => +v.toFixed(2))).toEqual([0.67, 0.67, 1, 1, 1]);
    expect(m.contested).toBeCloseTo(1 / 3);
    expect(m.eliteDay).toBe(3);
  });
  it('is empty without a race', () => {
    l.faRace = undefined;
    expect(raceMeasures(l)).toEqual({ byDay: [0, 0, 0, 0, 0], eliteDay: NaN, contested: NaN, n: 0 });
  });
});
