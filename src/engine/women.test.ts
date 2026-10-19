import { describe, expect, it, vi } from 'vitest';
import { createLeague } from './generate';
import { migrateLeague } from './migrate';
import type { League } from './types';

// The share ships at 0 until women's first names land; turned on here, scouts and medics roll it once at
// creation and coaches never do.
vi.mock('./data/names', async (importOriginal) => ({ ...(await importOriginal<typeof import('./data/names')>()), WOMEN_SHARE: 0.02 }));

const flagged = (l: League) => [...Object.values(l.staff), ...Object.values(l.medics)].filter((p) => p.woman).map((p) => `${p.role}:${p.id}`);

describe('women on staff', () => {
  const leagues = ['w1', 'w2', 'w3', 'w4', 'w5'].map((seed) => createLeague({ seed }));

  it('flags about the share of scouts and medics, and no coach', () => {
    let people = 0;
    let women = 0;
    for (const l of leagues) {
      for (const p of [...Object.values(l.staff), ...Object.values(l.medics)]) {
        people++;
        if (p.woman) women++;
      }
      for (const c of Object.values(l.coaches)) expect('woman' in c).toBe(false);
    }
    expect(women / people).toBeGreaterThan(0.01);
    expect(women / people).toBeLessThan(0.03);
  });
  it('keeps the flag through a save and load', () => {
    const l = leagues[0];
    const saved = migrateLeague({ ...(JSON.parse(JSON.stringify(l)) as League), version: 25 })!;
    expect(flagged(l).length).toBeGreaterThan(0);
    expect(flagged(saved)).toEqual(flagged(l));
  });
});
