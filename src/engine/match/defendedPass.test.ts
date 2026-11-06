import { describe, expect, it, vi } from 'vitest';
import type { Player } from '../types';

// Ratings and height by id, so each case reads plainly.
const SKILL: Record<number, number> = {};
const HEIGHT: Record<number, number> = {};
vi.mock('../attributes', async (load) => {
  const real = await load<typeof import('../attributes')>();
  return { ...real, skill: (p: Player) => SKILL[p.id] ?? 12 };
});
vi.mock('../size', async (load) => {
  const real = await load<typeof import('../size')>();
  return { ...real, sizeZ: (p: Player) => ({ h: HEIGHT[p.id] ?? 0, w: 0 }) };
});

const { batterWeights, breakupBy, breakupRate, depthBand, groupOf, pickBatter, pickCatcher, pickReturn } =
  await import('./defendedPass');

const man = (id: number, position: Player['position']) => ({ id, position }) as Player;
const field = () => ({
  CB: [man(1, 'CB'), man(2, 'CB'), man(3, 'CB')],
  S: [man(4, 'S'), man(5, 'S')],
  LB: [man(6, 'LB'), man(7, 'LB')],
  DL: [man(8, 'DT'), man(9, 'DT'), man(10, 'EDGE'), man(11, 'EDGE')],
});
const BANDS = ['behind', 'short', 'mid', 'deep'] as const;

describe('who gets to the ball', () => {
  it('reads the band off the air yards', () => {
    expect(depthBand(-1)).toBe('behind');
    expect(depthBand(0)).toBe('short');
    expect(depthBand(9)).toBe('short');
    expect(depthBand(10)).toBe('mid');
    expect(depthBand(20)).toBe('deep');
    expect(groupOf(man(1, 'EDGE'))).toBe('DL');
  });

  it('gives the cover man the pick first', () => {
    const f = field();
    for (const b of BANDS) expect(pickCatcher(b, f.CB[0], f, f.DL[0], 0, 0.5)).toBe(f.CB[0]);
  });

  it('never gives a lineman a deep pick; behind the line the line takes its share through the batter', () => {
    const f = field();
    const batter = f.DL[2];
    let batterPicks = 0;
    for (let u = 0; u < 1; u += 0.005) {
      expect(groupOf(pickCatcher('deep', f.CB[0], f, batter, 0.99, u))).not.toBe('DL');
      if (pickCatcher('behind', f.CB[0], f, batter, 0.99, u) === batter) batterPicks++;
    }
    expect(batterPicks).toBeGreaterThan(0);
  });

  it('takes the next group when one has nobody on the field, and the cover man when nobody else is', () => {
    const f = { ...field(), LB: [] };
    for (let u = 0; u < 1; u += 0.01) expect(groupOf(pickCatcher('short', f.CB[0], f, null, 0.99, u))).not.toBe('LB');
    const alone = { CB: [man(1, 'CB')], S: [], LB: [], DL: [] };
    expect(pickCatcher('mid', alone.CB[0], alone, null, 0.99, 0.5)).toBe(alone.CB[0]);
  });

  it('picks within a group by ball skills', () => {
    const f = field();
    SKILL[4] = 18;
    SKILL[5] = 6;
    let a = 0;
    let b = 0;
    for (let u = 0; u < 1; u += 0.002) {
      const p = pickCatcher('deep', f.CB[0], f, null, 0.99, u);
      if (p.id === 4) a++;
      if (p.id === 5) b++;
    }
    expect(a).toBeGreaterThan(b);
    delete SKILL[4];
    delete SKILL[5];
  });

  it('weighs a batter by height, and the man who got the pressure double', () => {
    const front = field().DL;
    HEIGHT[10] = 2;
    const plain = batterWeights(front, null);
    expect(plain.every((w) => w > 0)).toBe(true);
    expect(plain[2]).toBeGreaterThan(plain[0]);
    const pressured = batterWeights(front, front[1]);
    expect(pressured[1]).toBeCloseTo(2 * plain[1], 9);
    expect(front).toContain(pickBatter(front, null, 0.5));
    delete HEIGHT[10];
  });

  it('breaks up more short of the line than deep, and credits the cover man first', () => {
    expect(breakupRate('behind')).toBeGreaterThan(breakupRate('deep'));
    const f = field();
    expect(breakupBy('mid', f.S[0], f, f.DL[0], 0, 0.5)).toBe(f.S[0]);
  });

  it('runs a pick back no further than the goal line', () => {
    for (let u = 0; u < 1; u += 0.1) expect(pickReturn('deep', 0, u)).toBe(0);
    // Early in the 20+ band (it starts at 0.69 for a short throw): the breakaway, the distance.
    expect(pickReturn('short', 50, 0.75)).toBe(50);
  });
});
