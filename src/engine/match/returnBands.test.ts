import { describe, expect, it } from 'vitest';
import { bandReturn, type Bands } from './returnBands';

const b: Bands = { none: 0.5, short: 0.2, mid: 0.1, go: 0.5, tail: 5 };

describe('a return by yard bands', () => {
  it('runs nothing from the goal line, and never past it', () => {
    for (let u = 0; u < 1; u += 0.05) expect(bandReturn(b, 0, u)).toBe(0);
    expect(bandReturn(b, 5, 0.999)).toBe(5);
  });

  it('is nothing below the band of none, and goes the distance early in the 20+ band', () => {
    for (let u = 0; u < b.none; u += 0.05) expect(bandReturn(b, 100, u)).toBe(0);
    // The 20+ band is the last 0.2; its first half (go 0.5) goes the distance.
    expect(bandReturn(b, 100, 0.85)).toBe(100);
    expect(bandReturn(b, 100, 0.95)).toBeGreaterThanOrEqual(20);
    expect(bandReturn(b, 100, 0.95)).toBeLessThan(100);
  });
});
