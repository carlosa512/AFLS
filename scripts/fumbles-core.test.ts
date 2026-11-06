import { describe, expect, it } from 'vitest';
import type { StripTap } from '../src/engine/match/gameSim';
import { carrierSpread, judgeRecoveries, judgeStrips, newFumbleTally, tapStrip } from './fumbles-core';
import type { Line } from './sideline-core';

/** In range, or only reported. */
const printable = (l: Line) => !!l.info || (Number.isFinite(l.value) && l.value >= l.range[0] && l.value <= l.range[1]);

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

describe('strip-sacks and the loose ball', () => {
  const sack = (fumbled: boolean, spot: 'edge' | 'interior' = 'edge'): StripTap =>
    ({ down: 1, toGo: 10, trailingLate: false, leadingLate: false, spot, qb: 1, fumbled, forced: fumbled }) as StripTap;
  const line = (lines: Line[], label: string) => lines.find((l) => l.label === label)!;

  it('judges strip-sacks against the NFL’s 12.4 a hundred', () => {
    const ok = newFumbleTally();
    for (let i = 0; i < 10000; i++) tapStrip(ok, sack(i % 1000 < 124));
    expect(printable(line(judgeStrips(ok), 'strip-sacks, all: per 100 sacks'))).toBe(true);
    const high = newFumbleTally();
    for (let i = 0; i < 10000; i++) tapStrip(high, sack(i % 100 < 20));
    expect(printable(line(judgeStrips(high), 'strip-sacks, all: per 100 sacks'))).toBe(false);
  });

  it('reports a recovery bucket the NFL has too few of, judging nothing', () => {
    const t = newFumbleTally();
    const l = judgeRecoveries(t).find((x) => x.label.startsWith('scrambles: recovered by the DBs'))!;
    expect(l.info).toBe(true);
  });
});
