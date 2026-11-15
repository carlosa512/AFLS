import { describe, expect, it } from 'vitest';
import { cliffChance, CLIFF, severeInjuryIn } from './cliffs';
import { TRAIT_MEAN } from './traits';
import { POSITIONS, type InjuryRecord } from './types';

const body = (durability = TRAIT_MEAN) => ({ durability });

describe('cliffs', () => {
  it('never comes for a healthy player under CLIFF.from', () => {
    for (const pos of POSITIONS)
      for (let age = 21; age < CLIFF.from; age++) expect(cliffChance(age, pos, body(), false)).toBe(0);
  });

  it('a severe injury can bring one early', () => {
    expect(cliffChance(25, 'WR', body(), true)).toBeGreaterThan(0);
  });

  it('rises with age past the turn', () => {
    for (let age = 29; age < 36; age++)
      expect(cliffChance(age + 1, 'OL', body(), false)).toBeGreaterThanOrEqual(cliffChance(age, 'OL', body(), false));
    expect(cliffChance(35, 'OL', body(), false)).toBeGreaterThan(cliffChance(30, 'OL', body(), false));
  });

  it('a fragile body falls sooner than a durable one', () => {
    expect(cliffChance(31, 'WR', body(1), false)).toBeGreaterThan(cliffChance(31, 'WR', body(20), false));
  });

  it('severeInjuryIn reads the season on his record', () => {
    const rec = (severity: InjuryRecord['severity'], season: number): InjuryRecord => ({
      type: 'acl',
      severity,
      season,
      week: 5,
      weeks: 30,
    });
    expect(severeInjuryIn({ injuries: [rec('severe', 2030)] }, 2030)).toBe(true);
    expect(severeInjuryIn({ injuries: [rec('career-threatening', 2030)] }, 2030)).toBe(true);
    expect(severeInjuryIn({ injuries: [rec('severe', 2030)] }, 2031)).toBe(false);
    expect(severeInjuryIn({ injuries: [rec('moderate', 2030)] }, 2030)).toBe(false);
    expect(severeInjuryIn({}, 2030)).toBe(false);
  });
});
