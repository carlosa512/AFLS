import { describe, expect, it } from 'vitest';
import { createLeague, generatePlayer } from './generate';
import { Rng } from './rng';
import { teamPlayers } from './roster';
import { changePosition } from './training';
import { isOutlier, rollSize, SIZE, sizeLimits, sizeZ } from './size';
import { POSITIONS } from './types';

const stats = (xs: number[]) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
  return { mean, sd };
};

describe('rollSize', () => {
  it('costs exactly two draws', () => {
    const a = new Rng('x');
    const b = new Rng('x');
    rollSize(a, 'CB');
    b.next();
    b.next();
    expect(a.next()).toBe(b.next());
  });

  it('matches the table at every position', () => {
    const rng = new Rng('size');
    for (const pos of POSITIONS) {
      const rolls = Array.from({ length: 20_000 }, () => rollSize(rng, pos));
      const h = stats(rolls.map((r) => r.heightIn));
      const w = stats(rolls.map((r) => r.weightLb));
      const lim = sizeLimits(pos);
      expect(Math.abs(h.mean - SIZE[pos].h[0]), pos).toBeLessThan(0.2);
      expect(Math.abs(w.mean - SIZE[pos].w[0]), pos).toBeLessThan(2);
      expect(Math.abs(h.sd / SIZE[pos].h[1] - 1), pos).toBeLessThan(0.1);
      const hs = rolls.map((r) => r.heightIn);
      const ws = rolls.map((r) => r.weightLb);
      expect(Math.min(...hs), pos).toBeGreaterThanOrEqual(lim.h[0]);
      expect(Math.max(...hs), pos).toBeLessThanOrEqual(lim.h[1]);
      expect(Math.min(...ws), pos).toBeGreaterThanOrEqual(lim.w[0]);
      expect(Math.max(...ws), pos).toBeLessThanOrEqual(lim.w[1]);
    }
  });

  it('ties weight to height', () => {
    const rng = new Rng('corr');
    const rolls = Array.from({ length: 20_000 }, () => rollSize(rng, 'CB'));
    const h = stats(rolls.map((r) => r.heightIn));
    const w = stats(rolls.map((r) => r.weightLb));
    const cov = rolls.reduce((a, r) => a + (r.heightIn - h.mean) * (r.weightLb - w.mean), 0) / rolls.length;
    const r = cov / (h.sd * w.sd);
    expect(r).toBeGreaterThan(0.4);
    expect(r).toBeLessThan(0.6);
  });
});

describe('sizeZ and isOutlier', () => {
  it('is zero at the median', () => {
    expect(sizeZ({ position: 'CB', heightIn: 72, weightLb: 195 })).toEqual({ h: 0, w: 0 });
    expect(sizeZ({ position: 'CB', heightIn: 69.7, weightLb: 195 }).h).toBeCloseTo(-1, 5);
  });

  it('reads against another position when asked', () => {
    expect(sizeZ({ position: 'CB', heightIn: 72.5, weightLb: 210 }, 'S')).toEqual({ h: 0, w: 0 });
  });

  it('flags the tails only', () => {
    expect(isOutlier({ position: 'CB', heightIn: 68, weightLb: 190 })).toBe(true);
    expect(isOutlier({ position: 'CB', heightIn: 72, weightLb: 195 })).toBe(false);
  });
});

describe('generation', () => {
  const make = (pos: (typeof POSITIONS)[number], i: number) =>
    generatePlayer(new Rng(`size-gen:${pos}:${i}`), {
      id: 3_000_000 + i,
      position: pos,
      quality: 11,
      age: 22,
      teamId: null,
      jerseysUsed: new Set(),
    });
  const corners = Array.from({ length: 2_000 }, (_, i) => make('CB', i));

  it('rolls new players from the bell curve', () => {
    const short = corners.filter((p) => p.heightIn <= 69).length / corners.length;
    expect(short).toBeGreaterThan(0.11);
    expect(short).toBeLessThan(0.17);
    expect(Math.min(...corners.map((p) => p.heightIn))).toBeGreaterThanOrEqual(sizeLimits('CB').h[0]);
    // The old flat roll stopped at 5'9" and 6'2": the tails are what the curve adds.
    expect(corners.some((p) => p.heightIn < 69)).toBe(true);
    expect(corners.some((p) => p.heightIn > 74)).toBe(true);
  });

  it('clamps weight to the new curve on a position move', () => {
    const l = createLeague({ seed: 'size-move' });
    const ol = teamPlayers(l, 0).find((p) => p.position === 'OL')!;
    ol.weightLb = 380;
    changePosition(l, ol, 'DT');
    expect(ol.weightLb).toBe(sizeLimits('DT').w[1]);
  });
});
