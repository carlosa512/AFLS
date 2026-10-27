import { describe, expect, it } from 'vitest';
import { createLeague, generatePlayer } from './generate';
import { Rng } from './rng';
import { teamPlayers } from './roster';
import { changePosition } from './training';
import { isOutlier, massEdge, rollSize, SIZE, sizeEdge, sizeLimits, sizeNudge, sizeZ } from './size';
import { POSITIONS, type Player, type Position, type Ratings } from './types';

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

describe('sizeEdge', () => {
  const at = (position: Position, heightIn: number, weightLb: number, playsBig = false) =>
    ({
      position,
      heightIn,
      weightLb,
      ...(playsBig ? { playsBig: true } : {}),
      ratings: { speed: 10 },
    }) as unknown as Player;
  const median = (pos: Position) => at(pos, SIZE[pos].h[0], SIZE[pos].w[0]);

  it('is zero when both builds sit at their medians', () => {
    expect(sizeEdge(median('WR'), 'contested', median('CB'))).toBe(0);
    expect(sizeEdge(median('TE'), 'contested', median('S'))).toBe(0);
    expect(sizeEdge(median('RB'), 'contact', median('LB'))).toBe(0);
    expect(sizeEdge(median('WR'), 'press', median('CB'))).toBe(0);
    expect(sizeEdge(median('DT'), 'leverage', median('OL'))).toBe(0);
    expect(sizeEdge(median('EDGE'), 'edgeLength', median('OL'))).toBe(0);
    expect(sizeEdge(median('QB'), 'lanes')).toBe(0);
    expect(massEdge([median('OL'), median('OL')], [median('DT'), median('EDGE')])).toBe(0);
  });

  it('gives a tall receiver the jump ball over a small corner, capped at two points', () => {
    const wr = at('WR', 77, 215);
    const cb = at('CB', 69.5, 182);
    expect(sizeEdge(wr, 'contested', cb)).toBe(2);
    expect(sizeEdge(cb, 'contested', wr)).toBe(-2);
    const close = at('WR', 74, 200);
    expect(sizeEdge(close, 'contested', median('CB'))).toBeCloseTo(-sizeEdge(median('CB'), 'contested', close), 10);
  });

  it('halves a loss for a player who plays bigger than his size, and never adds a gain', () => {
    const wr = at('WR', 77, 215);
    expect(sizeEdge(at('CB', 69.5, 182, true), 'contested', wr)).toBe(-1);
    expect(sizeEdge(at('WR', 77, 215, true), 'contested', at('CB', 69.5, 182))).toBe(2);
  });

  it('gives the short tackle trouble, the short tackle on a DT leverage, and a tall QB his lanes', () => {
    expect(sizeEdge(median('EDGE'), 'edgeLength', at('OL', 74, 313))).toBeGreaterThan(0);
    expect(sizeEdge(at('DT', 73, 300), 'leverage', at('OL', 78, 313))).toBeGreaterThan(0);
    expect(sizeEdge(at('QB', 71, 210), 'lanes')).toBeLessThan(0);
    expect(sizeEdge(at('QB', 77, 235), 'lanes')).toBeGreaterThan(0);
    expect(massEdge([at('OL', 77, 340)], [at('DT', 75, 290)])).toBeGreaterThan(0);
  });
});

describe('sizeNudge', () => {
  const make = (v: number) => ({ speed: v, agility: v, strength: v }) as Ratings;

  it('leaves a median build alone and moves both tails the same amount', () => {
    const r = make(10);
    sizeNudge(r, 0);
    sizeNudge(r, -0.4);
    expect([r.speed, r.agility, r.strength]).toEqual([10, 10, 10]);
    const lo = make(10);
    const hi = make(10);
    sizeNudge(lo, -1);
    sizeNudge(hi, 1);
    expect([lo.speed, lo.agility, lo.strength]).toEqual([11, 11, 9]);
    expect([hi.speed, hi.agility, hi.strength]).toEqual([9, 9, 11]);
  });

  it('stays on the 1–20 scale', () => {
    const top = make(20);
    sizeNudge(top, -2);
    expect([top.speed, top.agility, top.strength]).toEqual([20, 20, 19]);
  });
});
