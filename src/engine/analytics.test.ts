import { describe, expect, it } from 'vitest';
import { expectedPoints, isExplosive, isSuccess, playEpa, type PlayState } from './analytics';

const at = (down: number, distance: number, yardLine: number, offense: 0 | 1 = 0, score: [number, number] = [0, 0]) =>
  ({ down, distance, yardLine, offense, score }) as PlayState;

describe('expected points', () => {
  it('anchors on first and ten and climbs with field position', () => {
    expect(expectedPoints(1, 10, 20)).toBeCloseTo(0.4, 2);
    expect(expectedPoints(1, 10, 50)).toBeCloseTo(2.0, 2);
    expect(expectedPoints(1, 10, 99)).toBeCloseTo(6.0, 2);
    for (let y = 2; y < 100; y++) expect(expectedPoints(1, 10, y)).toBeGreaterThan(expectedPoints(1, 10, y - 1));
  });
  it('costs a later down and a longer distance', () => {
    expect(expectedPoints(3, 8, 50)).toBeLessThan(expectedPoints(2, 8, 50));
    expect(expectedPoints(2, 8, 50)).toBeLessThan(expectedPoints(1, 10, 50));
    expect(expectedPoints(4, 1, 50)).toBeGreaterThan(expectedPoints(4, 10, 50));
  });
});

describe('play EPA', () => {
  it('measures a gain, a touchdown, a field goal and a safety', () => {
    expect(playEpa(at(1, 10, 25), at(2, 4, 31))).toBeCloseTo(expectedPoints(2, 4, 31) - expectedPoints(1, 10, 25));
    expect(playEpa(at(1, 10, 80), at(1, 10, 25, 1, [7, 0]))).toBeCloseTo(7 - expectedPoints(1, 10, 80));
    expect(playEpa(at(4, 5, 70), at(1, 10, 25, 1, [3, 0]))).toBeCloseTo(3 - expectedPoints(4, 5, 70));
    expect(playEpa(at(1, 10, 2), at(1, 10, 25, 1, [0, 2]))).toBeCloseTo(-2 - expectedPoints(1, 10, 2));
  });
  it('charges a turnover and a return touchdown to the offense', () => {
    expect(playEpa(at(1, 10, 60), at(1, 10, 40, 1))).toBeCloseTo(
      -expectedPoints(1, 10, 40) - expectedPoints(1, 10, 60),
    );
    expect(playEpa(at(2, 10, 30), at(1, 10, 25, 0, [0, 7]))).toBeLessThan(-6);
  });
});

describe('success and explosives', () => {
  it('calls success the NFL way', () => {
    expect(isSuccess(1, 10, 4, false)).toBe(true);
    expect(isSuccess(1, 10, 3, false)).toBe(false);
    expect(isSuccess(2, 10, 6, false)).toBe(true);
    expect(isSuccess(2, 10, 5, false)).toBe(false);
    expect(isSuccess(3, 4, 3, false)).toBe(false);
    expect(isSuccess(4, 1, 1, false)).toBe(true);
    expect(isSuccess(3, 4, 2, true)).toBe(true);
  });
  it('marks explosive runs and completions', () => {
    expect(isExplosive('run', 10, false)).toBe(true);
    expect(isExplosive('run', 9, false)).toBe(false);
    expect(isExplosive('pass', 25, false)).toBe(false);
    expect(isExplosive('pass', 20, true)).toBe(true);
  });
});
