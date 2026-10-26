import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { adviceLean, pickRoundFor, raceFor } from './directorAdvice';
import { computeRecords } from './season/standings';
import { slotRate } from './trade/value';
import type { League } from './types';

const world = () => createLeague({ seed: 'director-advice' });
/** Every club 5–3; ours as given. */
function standings(l: League, w: number, lo: number) {
  const records = computeRecords(l);
  for (const r of records.values()) Object.assign(r, { w: 5, l: 3, t: 0 });
  Object.assign(records.get(l.userTeamId)!, { w, l: lo });
  return records;
}

describe('the director’s lean', () => {
  it('leans from the playoff race', () => {
    expect(adviceLean(0)).toBe('buy');
    expect(adviceLean(1)).toBe('buy');
    expect(adviceLean(2)).toBe('targeted');
    expect(adviceLean(3)).toBe('targeted');
    expect(adviceLean(3.5)).toBe('sell');
  });
  it('measures games back from the last seed', () => {
    const l = world();
    expect(raceFor(l, standings(l, 3, 5)).gamesBack).toBe(2);
    expect(raceFor(l, standings(l, 1, 7)).gamesBack).toBe(4);
    const top = raceFor(l, standings(l, 8, 0));
    expect(top.gamesBack).toBe(0);
    expect(top.seed).toBe(1);
  });
  it('prices in rounds', () => {
    const l = world();
    expect(pickRoundFor(l, slotRate(16) * 1.6)).toBe('a 1st and more');
    expect(pickRoundFor(l, slotRate(16))).toBe('likely a 1st');
    expect(pickRoundFor(l, slotRate(48))).toBe('likely a 2nd');
    expect(pickRoundFor(l, slotRate(208))).toBe('likely a 7th');
    expect(pickRoundFor(l, 0.01)).toBe('a late-round pick');
  });
});
