import { describe, expect, it } from 'vitest';
import { STARTING_HABITS } from './gmHabits';
import { ARCHETYPE_ACTIVITY, generateGm } from './gmTraits';
import { Rng } from './rng';

describe('gm archetypes', () => {
  it('has ten archetypes, each with an activity and starting habits', () => {
    const names = new Set<string>();
    for (let i = 0; i < 400; i++) names.add(generateGm(new Rng(`arch:${i}`)).archetype);
    expect([...names].sort()).toEqual([
      'All-In',
      'Balanced',
      'Can-Kicker',
      'Cap Magician',
      'Core Keeper',
      'Draft and Develop',
      'Hard-Liner',
      'Market Mover',
      'Pick Hoarder',
      'Slow Mover',
    ]);
    for (const a of names) {
      expect(ARCHETYPE_ACTIVITY[a]).toBeDefined();
      expect(STARTING_HABITS[a]).toBeDefined();
    }
    const mean = Object.values(ARCHETYPE_ACTIVITY).reduce((s, v) => s + v, 0) / 10;
    expect(mean).toBeCloseTo(0.545, 2);
  });
});
