import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../src/engine/generate';
import { buildContract } from '../src/engine/finance/contract';
import { activeRoster, setTeam } from '../src/engine/roster';
import type { Contract, League, Player } from '../src/engine/types';
import { ELITE, faMeasures, GOOD, windowStart } from './free-agency-core';

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
