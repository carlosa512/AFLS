import { describe, expect, it } from 'vitest';
import { passDepth, type Situation } from './match/coach';
import { BEHIND_SHARE, passAir } from './match/gameSim';
import { Rng } from './rng';

/** An ordinary snap between the 20s, no clock pressure. */
const ordinary: Situation = {
  quarter: 2,
  clock: 600,
  down: 1,
  distance: 10,
  yardLine: 40,
  scoreDiff: 0,
  offTimeouts: 3,
  defTimeouts: 3,
  overtime: false,
  fgMakeProb: 0.5,
};

const shares = (s: Situation, n = 4000) => {
  const rng = new Rng('mix');
  const c = { short: 0, medium: 0, deep: 0 };
  for (let i = 0; i < n; i++) c[passDepth(s, rng)]++;
  return { short: c.short / n, medium: c.medium / n, deep: c.deep / n };
};

describe("the passing game's shape (nflverse 2019–24)", () => {
  it('calls the NFL mix on an ordinary down: two in three short, one in five 10 to 19 yards', () => {
    const m = shares(ordinary);
    expect(m.short).toBeGreaterThan(0.64);
    expect(m.short).toBeLessThan(0.72);
    expect(m.medium).toBeGreaterThan(0.18);
    expect(m.medium).toBeLessThan(0.24);
  });

  it('never leaves a negative weight in a hurry', () => {
    for (const distance of [1, 3, 5, 8, 15]) {
      const m = shares({ ...ordinary, quarter: 4, clock: 200, scoreDiff: -7, distance }, 1000);
      expect(m.short).toBeGreaterThan(0.3);
      expect(m.short + m.medium + m.deep).toBeCloseTo(1, 9);
    }
  });

  it("throws a quarter of a receiver's short passes behind the line, the rest 0 to 9", () => {
    const rng = new Rng('air');
    const air = Array.from({ length: 4000 }, () => passAir(rng, 'short', false, 50, 50));
    const behind = air.filter((a) => a < 0);
    const ahead = air.filter((a) => a >= 0);
    expect(Math.abs(behind.length / air.length - BEHIND_SHARE)).toBeLessThan(0.03);
    expect(Math.max(...ahead)).toBeLessThanOrEqual(9);
    const mean = ahead.reduce((a, b) => a + b, 0) / ahead.length;
    expect(mean).toBeGreaterThan(3.7);
    expect(mean).toBeLessThan(4.7);
  });

  it('never completes a pass behind its own goal line', () => {
    const rng = new Rng('goal-line');
    for (let i = 0; i < 2000; i++) expect(passAir(rng, 'short', false, 2, 98)).toBeGreaterThanOrEqual(-1);
  });
});
