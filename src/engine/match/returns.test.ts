import { describe, expect, it } from 'vitest';
import { returnYards, type ReturnFacts } from './returns';

const N = 1000;
const grid = (f: ReturnFacts) => Array.from({ length: N }, (_, i) => returnYards(f, (i + 0.5) / N));
const kick = (over: Partial<ReturnFacts> = {}): ReturnFacts => ({
  kind: 'kickoff',
  from: 97,
  returner: 0,
  coverage: 0,
  coach: 0,
  ...over,
});
const punt = (over: Partial<ReturnFacts> = {}): ReturnFacts => ({ ...kick(), kind: 'punt', from: 60, ...over });
const mean = (y: number[]) => y.reduce((a, b) => a + b, 0) / y.length;
const over = (y: number[], a: number) => y.filter((v) => v >= a).length / y.length;
const at = (y: number[], q: number) => [...y].sort((a, b) => a - b)[Math.floor(q * y.length)];

describe("a return's length", () => {
  it("has the NFL's shape: kickoffs (2025) and punts", () => {
    const k = grid(kick());
    expect(Math.abs(mean(k) - 25.95)).toBeLessThan(1);
    expect(Math.abs(over(k, 40) - 0.0419)).toBeLessThan(0.015);
    expect(Math.abs(over(k, 60) - 0.0092)).toBeLessThan(0.006);
    const p = grid(punt({ from: 100 }));
    expect(Math.abs(mean(p) - 9.45)).toBeLessThan(0.8);
    expect(Math.abs(over(p, 20) - 0.082)).toBeLessThan(0.02);
    expect(Math.abs(over(p, 40) - 0.019)).toBeLessThan(0.008);
  });

  it('is whole yards, never negative, never past the end zone', () => {
    for (const f of [kick(), punt(), punt({ from: 30 }), kick({ returner: 8, coverage: -8 })])
      for (const y of grid(f)) {
        expect(Number.isInteger(y)).toBe(true);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThanOrEqual(f.from);
      }
    const tds = grid(kick()).filter((y) => y >= 97).length;
    expect(tds).toBeGreaterThanOrEqual(1);
    expect(tds).toBeLessThanOrEqual(5);
    expect(over(grid(punt({ from: 30 })), 30)).toBeGreaterThan(over(grid(punt({ from: 60 })), 60));
  });

  it('leans on the returner mostly in the tail, and on the coverage and the punter', () => {
    const base = grid(kick());
    const good = grid(kick({ returner: 4 }));
    expect(at(good, 0.95) - at(base, 0.95)).toBeGreaterThan(at(good, 0.5) - at(base, 0.5));
    expect(mean(grid(kick({ coverage: 4 })))).toBeLessThan(mean(base));
    expect(Math.abs(mean(grid(punt({ outkicks: true }))) - mean(grid(punt())) - 3)).toBeLessThan(0.6);
    expect(Math.abs(mean(grid(punt())) - mean(grid(punt({ highArc: true }))) - 1.5)).toBeLessThan(0.6);
  });
});
