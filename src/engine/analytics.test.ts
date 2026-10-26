import { describe, expect, it } from 'vitest';
import { expectedPoints, fourthDownValue, isExplosive, isSuccess, playEpa, type PlayState } from './analytics';

const at = (down: number, distance: number, yardLine: number, offense: 0 | 1 = 0, score: [number, number] = [0, 0]) =>
  ({ down, distance, yardLine, offense, score }) as PlayState;

describe('expected points', () => {
  it('anchors on first and ten and climbs with field position', () => {
    expect(expectedPoints(1, 10, 25)).toBeCloseTo(0.97, 2);
    expect(expectedPoints(1, 10, 55)).toBeCloseTo(2.87, 2);
    expect(expectedPoints(1, 10, 99)).toBeCloseTo(5.4, 2);
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
    expect(playEpa(at(4, 5, 70), at(1, 10, 25, 1, [3, 0]))).toBeCloseTo(3 - fourthDownValue(at(4, 5, 70)));
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

describe('fourth down', () => {
  const at = (down: number, distance: number, yardLine: number, offense: 0 | 1 = 0) =>
    ({ down, distance, yardLine, offense, score: [0, 0] }) as PlayState;
  it('values fourth down as the punt or kick that follows, not as a near-turnover', () => {
    // A failed third and 8 at our 25 costs about what the punt gives away, nowhere near an interception.
    const failed = playEpa(at(3, 8, 25), at(4, 8, 25));
    const picked = playEpa(at(3, 8, 25), at(1, 10, 75, 1));
    expect(failed).toBeLessThan(0);
    expect(failed).toBeGreaterThan(picked / 2);
    // Fourth and 5 at their 20 is a field-goal try: worth points, not a loss.
    expect(fourthDownValue(at(4, 5, 80))).toBeGreaterThan(1);
  });
  it('does not over-credit a fourth-down conversion', () => {
    expect(playEpa(at(4, 2, 50), at(1, 10, 52))).toBeLessThan(2.2);
  });
  it('never counts a gain that ended in a turnover as explosive', () => {
    expect(isExplosive('pass', 25, true, true)).toBe(false);
    expect(isExplosive('run', 15, false, true)).toBe(false);
  });
});
