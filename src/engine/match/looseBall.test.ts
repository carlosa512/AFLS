import { describe, expect, it } from 'vitest';
import type { Player } from '../types';
import { defenseRecovers, FORCER_RECOVERS, pickRecoverer, recovererGroup, returnYards, type Group } from './looseBall';

const man = (id: number) => ({ id }) as Player;
const field = (over: Partial<Record<Group, Player[]>> = {}): Record<Group, Player[]> => ({
  DB: [man(1), man(2), man(3), man(4)],
  LB: [man(5), man(6)],
  DL: [man(7), man(8), man(9), man(10)],
  ...over,
});

describe('the loose ball', () => {
  it('gives the defense the NFL’s share: a ball punched out goes its way, one he drops himself mostly stays', () => {
    expect(defenseRecovers('run', true)).toBe(0.6);
    expect(defenseRecovers('run', false)).toBe(0.25);
    expect(defenseRecovers('catch', false)).toBe(0.18);
    // A scramble he fumbles himself takes a sack's own share (the NFL has four).
    expect(defenseRecovers('scramble', false)).toBe(0.35);
  });

  it('splits the rest of the defense by group, a strip-sack among the linemen, a catch among the DBs', () => {
    for (const kind of ['run', 'catch', 'scramble', 'sack'] as const) {
      const g = recovererGroup(kind);
      expect(g.DB + g.LB + g.DL).toBeCloseTo(1, 9);
      expect(FORCER_RECOVERS[kind]).toBeGreaterThan(0);
    }
    expect(recovererGroup('sack').DL).toBeGreaterThan(recovererGroup('catch').DL);
    expect(recovererGroup('catch').DB).toBeGreaterThan(recovererGroup('sack').DB);
  });

  it('credits the man who forced it first, and never nobody', () => {
    const forcer = man(99);
    expect(pickRecoverer('run', forcer, field(), 0, 0.5)).toBe(forcer);
    for (let u = 0; u < 1; u += 0.01) expect(pickRecoverer('run', null, field(), 0, u)).toBeDefined();
  });

  it('passes a group with nobody on the field to the next', () => {
    const noLb = field({ LB: [] });
    for (let u = 0; u < 1; u += 0.01) {
      const p = pickRecoverer('run', null, noLb, 1, u);
      expect([...noLb.DB, ...noLb.DL]).toContain(p);
    }
  });

  it('runs a return back no further than the goal line: reaching it is the touchdown', () => {
    expect(returnYards('DB', 5, 0.999)).toBe(5);
    const deep = returnYards('DB', 100, 1 - 0.12 / 2);
    expect(deep).toBeGreaterThanOrEqual(20);
    expect(deep).toBeLessThan(100);
    for (const g of ['DB', 'LB', 'DL'] as const) expect(returnYards(g, 50, 0.01)).toBe(0);
  });

  it('runs a lineman back no further than a DB on the same draw', () => {
    for (let u = 0.05; u < 0.96; u += 0.05)
      expect(returnYards('DL', 50, u)).toBeLessThanOrEqual(returnYards('DB', 50, u));
  });
});
