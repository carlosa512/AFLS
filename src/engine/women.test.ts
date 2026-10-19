import { describe, expect, it } from 'vitest';
import { WOMEN_SHARE } from './data/heritage';
import { createLeague } from './generate';
import { migrateLeague } from './migrate';
import type { League } from './types';

const flagged = (l: League) => [...Object.values(l.staff), ...Object.values(l.medics)].filter((p) => p.woman).map((p) => `${p.role}:${p.id}`);

describe('women on staff', () => {
  const leagues = ['w1', 'w2', 'w3'].map((seed) => createLeague({ seed }));

  it("come at about each chair's share across a league, and never as coaches", () => {
    let expected = 0;
    let women = 0;
    for (const l of leagues) {
      for (const p of [...Object.values(l.staff), ...Object.values(l.medics)]) {
        expected += WOMEN_SHARE[p.role];
        if (p.woman) women++;
      }
      for (const c of Object.values(l.coaches)) expect('woman' in c).toBe(false);
    }
    expect(women / expected).toBeGreaterThan(0.7);
    expect(women / expected).toBeLessThan(1.3);
  });
  it('keeps the flag through a save and load', () => {
    const l = leagues[0];
    const saved = migrateLeague(JSON.parse(JSON.stringify(l)) as League)!;
    expect(flagged(l).length).toBeGreaterThan(0);
    expect(flagged(saved)).toEqual(flagged(l));
  });
});
