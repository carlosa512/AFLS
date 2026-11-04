import { describe, expect, it } from 'vitest';
import { beliefOf, beliefRead, runnerOf, shiftBelief } from './belief';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { playWeek } from './league';
import type { League } from './types';

const base = (() => {
  const l = createLeague({ seed: 'belief' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);

describe('belief: the store', () => {
  it('reads the four words at their thresholds', () => {
    expect(beliefRead(0.4)).toBe('believes');
    expect(beliefRead(0.39)).toBe('steady');
    expect(beliefRead(-0.2)).toBe('doubts');
    expect(beliefRead(-0.49)).toBe('doubts');
    expect(beliefRead(-0.5)).toBe('lost');
  });

  it('holds belief inside ±1 and reads 0 when unset or vacant', () => {
    const l = fresh();
    const oc = teamCoaches(l, 0).find((c) => c.role === 'offCoord')!;
    expect(beliefOf(oc, 'OL')).toBe(0);
    shiftBelief(oc, 'OL', 5);
    expect(beliefOf(oc, 'OL')).toBe(1);
    shiftBelief(oc, 'OL', -9);
    expect(beliefOf(oc, 'OL')).toBe(-1);
    expect(beliefOf(undefined, 'OL')).toBe(0);
    expect(beliefOf(null, 'OL')).toBe(0);
  });

  it('the runner of a side is the coordinator, else the covering head coach', () => {
    const l = fresh();
    const oc = teamCoaches(l, 0).find((c) => c.role === 'offCoord')!;
    expect(runnerOf(l, 0, 'QB')?.id).toBe(oc.id);
    expect(runnerOf(l, 0, 'DB')?.role).toBe('defCoord');
    oc.teamId = null;
    // A new coaches object is a new index (a hand edit isn't a move through coaching.ts).
    l.coaches = { ...l.coaches };
    const hc = teamCoaches(l, 0).find((c) => c.role === 'headCoach')!;
    expect(runnerOf(l, 0, 'QB')?.id).toBe(hc.id);
    hc.coverOff = ['offCoord'];
    expect(runnerOf(l, 0, 'QB')).toBeNull();
  });
});
