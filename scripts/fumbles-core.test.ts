import { describe, expect, it } from 'vitest';
import { carrierSpread, newFumbleTally } from './fumbles-core';

/** Thirty backs, 200 carries each, fumbling these many times in turn. */
function backs(fumbles: number[]) {
  const t = newFumbleTally();
  for (let i = 0; i < 30; i++) t.backs.set(`b${i}`, { n: 200, fum: fumbles[i % fumbles.length], forced: 0 });
  return carrierSpread(t)[0];
}

describe('the spread between backs', () => {
  it('judges what luck leaves, not the raw spread: backs alike but for luck read short of the NFL', () => {
    // Raw sd 0.0114 (inside ±30% of the NFL's raw 0.0128), luck alone 0.0086 at 200 carries: 0.0075 is real.
    const l = backs([0, 1, 3, 5, 6]);
    expect(l.value).toBeCloseTo(Math.sqrt(0.0114 ** 2 - 0.0086 ** 2), 3);
    expect(l.value).toBeLessThan(l.range![0]);
  });

  it('reads backs who truly differ as the NFL’s do inside its range', () => {
    const l = backs([0, 1, 2, 4, 7, 8]);
    expect(l.value).toBeGreaterThan(l.range![0]);
    expect(l.value).toBeLessThan(l.range![1]);
  });
});
