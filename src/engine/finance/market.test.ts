import { describe, expect, it } from 'vitest';
import { dealTier, dealYears } from './market';

describe('deal length by worth, then age (project B)', () => {
  it('sorts a deal into key, role or depth by its share of the cap, a share on a bound going up', () => {
    expect(dealTier(0.0079)).toBe('depth');
    expect(dealTier(0.008)).toBe('role');
    expect(dealTier(0.0199)).toBe('role');
    expect(dealTier(0.02)).toBe('key');
  });

  it("gives a deal the table's years by its share and the player's age on his position's clock", () => {
    const wr = (age: number) => ({ age, position: 'WR' as const });
    const rows: [number, number[]][] = [
      [0.005, [3, 2, 1, 1, 1]], // 2026-11-16: young cheap players sign longer (the market and exits)
      [0.015, [2, 2, 1, 1, 1]],
      [0.03, [3, 3, 3, 2, 1]],
      [0.07, [4, 4, 3, 2, 2]],
      [0.12, [5, 4, 4, 3, 2]],
    ];
    for (const [share, years] of rows) expect([24, 27, 29, 31, 33].map((a) => dealYears(wr(a), share))).toEqual(years);
    // A 33-year-old quarterback reads as a 29-year-old on his clock.
    expect(dealYears({ age: 33, position: 'QB' }, 0.07)).toBe(dealYears(wr(29), 0.07));
  });
});
