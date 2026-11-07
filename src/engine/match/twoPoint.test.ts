import { describe, expect, it } from 'vitest';
import { runShare, sureTwo, twoPointOdds, type TwoPointFacts } from './twoPoint';

const f = (over: Partial<TwoPointFacts> = {}): TwoPointFacts => ({
  quarter: 4,
  clock: 300,
  overtime: false,
  scoreDiff: 0,
  appetite: 0,
  passLean: 0,
  qbScrambling: 12,
  ...over,
});

describe('the two-point call', () => {
  it('is certain where the NFL always goes', () => {
    for (const scoreDiff of [-10, -5, -2, 1, 5]) {
      expect(sureTwo(f({ scoreDiff }))).toBe(true);
      expect(sureTwo(f({ scoreDiff, quarter: 5, overtime: true }))).toBe(true);
      expect(twoPointOdds(f({ scoreDiff }))).toBe(1);
    }
    expect(sureTwo(f({ scoreDiff: -1, clock: 60 }))).toBe(true);
    expect(sureTwo(f({ scoreDiff: -1, clock: 300 }))).toBe(false);
    expect(sureTwo(f({ scoreDiff: 5, quarter: 2 }))).toBe(false);
  });

  it("takes the NFL's odds on the judgment calls", () => {
    for (const scoreDiff of [-8, -9]) {
      expect(twoPointOdds(f({ scoreDiff }))).toBeGreaterThan(0.3);
      expect(twoPointOdds(f({ scoreDiff }))).toBeLessThan(0.5);
    }
    for (const scoreDiff of [-5, 5]) {
      expect(twoPointOdds(f({ scoreDiff, quarter: 2 }))).toBeGreaterThan(0.3);
      expect(twoPointOdds(f({ scoreDiff, quarter: 2 }))).toBeLessThan(0.5);
    }
    expect(twoPointOdds(f({ scoreDiff: 12, quarter: 2 }))).toBeGreaterThan(0.1);
    expect(twoPointOdds(f({ scoreDiff: 12, quarter: 2 }))).toBeLessThan(0.25);
    expect(twoPointOdds(f({ scoreDiff: 6, quarter: 2 }))).toBeLessThan(0.03);
  });

  it("leans on the head coach's appetite, never on a sure call", () => {
    expect(twoPointOdds(f({ scoreDiff: -8, appetite: 1 }))).toBeGreaterThan(twoPointOdds(f({ scoreDiff: -8 })));
    expect(twoPointOdds(f({ scoreDiff: -2, appetite: -1 }))).toBe(1);
  });

  it('runs 28% of tries, less for a passing play-caller, more with a quarterback who runs', () => {
    expect(Math.abs(runShare(f()) - 0.28)).toBeLessThan(0.02);
    expect(runShare(f({ passLean: 1 }))).toBeLessThan(runShare(f()));
    expect(runShare(f({ qbScrambling: 16 }))).toBeGreaterThan(runShare(f()));
  });
});
