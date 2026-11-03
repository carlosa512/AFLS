import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { man, randomStart, startOf } from './fixtures';
import { MID } from './geometry';
import { runField } from './run';
import { MAX_FIELD, STEP } from './tuning';
import type { FieldStart } from './types';

/** Where man `k` is at step `s`. */
const at = (start: FieldStart, frames: Float32Array, s: number, k: number) => {
  const n = start.players.length;
  return { x: frames[(s * n + k) * 2], y: frames[(s * n + k) * 2 + 1] };
};

describe('the open field', () => {
  it('lets a blocked man go only after his hold, and a weak blocker sooner', () => {
    const shedTime = (shed: number, seed: string, hold = 0) => {
      const players = [
        man(1, 0, 'RB', 48, MID + 4, { vx: 6 }),
        man(10, 0, 'OL', 50, MID),
        man(30, 1, 'DT', 50.9, MID, { s: { shed } }),
        man(31, 1, 'S', 80, MID + 10),
      ];
      const start = startOf({ players, blocks: [{ blocker: 10, defender: 30, holdFor: hold }] });
      const r = runField(start, new Rng(seed));
      const steps = r.frames.length / (players.length * 2);
      for (let s = 0; s < steps; s++) {
        const b = at(start, r.frames, s, 1);
        const d = at(start, r.frames, s, 2);
        if (Math.hypot(b.x - d.x, b.y - d.y) > 2) return s * STEP;
      }
      return Infinity;
    };
    for (let i = 0; i < 50; i++) expect(shedTime(20, `hold:${i}`, 1)).toBeGreaterThanOrEqual(1);
    const mean = (shed: number) => {
      let t = 0;
      let n = 0;
      for (let i = 0; i < 200; i++) {
        const x = shedTime(shed, `shed:${i}`);
        if (Number.isFinite(x)) {
          t += x;
          n++;
        }
      }
      return t / n;
    };
    expect(mean(18)).toBeLessThan(mean(12));
  });

  it('keeps a deep man in front of the carrier', () => {
    for (let i = 0; i < 100; i++) {
      const players = [man(1, 0, 'RB', 40, MID, { vx: 7 }), man(30, 1, 'S', 55, MID)];
      const r = runField(startOf({ players }), new Rng(`deep:${i}`));
      expect(r.touchdown, `seed ${i}`).toBe(false);
    }
  });

  it('closes sooner with a better angle', () => {
    const contact = (pursuit: number) => {
      let t = 0;
      for (let i = 0; i < 200; i++) {
        const players = [man(1, 0, 'RB', 30, MID - 10, { vx: 7 }), man(30, 1, 'LB', 40, MID + 6, { s: { pursuit } })];
        const r = runField(startOf({ players }), new Rng(`angle:${i}`));
        t += r.duration;
      }
      return t / 200;
    };
    expect(contact(18)).toBeLessThan(contact(6));
  });

  it('ends on a touchdown, out of bounds or a tackle, never at the time limit', () => {
    for (let i = 0; i < 2000; i++) {
      const r = runField(randomStart(`end:${i}`), new Rng(`end:${i}`));
      const ends = [r.touchdown, r.outOfBounds, r.tackler !== null].filter(Boolean).length;
      expect(ends, `seed ${i}`).toBe(1);
      expect(r.duration).toBeLessThan(MAX_FIELD);
      expect(Number.isFinite(r.yards)).toBe(true);
    }
    const alone = [man(1, 0, 'RB', 80, MID, { vx: 6 }), man(30, 1, 'LB', 20, MID)];
    expect(runField(startOf({ players: alone }), new Rng('alone')).touchdown).toBe(true);
  });

  it("handles the field's edges", () => {
    const cases: FieldStart[] = [
      startOf({ players: [man(1, 0, 'RB', 99, MID, { vx: 3 }), man(30, 1, 'LB', 100.5, MID + 3)] }),
      startOf({ players: [man(1, 0, 'WR', 50, 0.6, { vx: 6 }), man(30, 1, 'CB', 56, 3)] }),
      startOf({ dir: -1, players: [man(1, 0, 'RB', 2, MID, { vx: -2 }), man(30, 1, 'LB', -1, MID)] }),
    ];
    for (const [i, s] of cases.entries()) {
      const r = runField(s, new Rng(`edge:${i}`));
      expect(r.frames.every((v) => Number.isFinite(v))).toBe(true);
      expect([r.touchdown, r.outOfBounds, r.tackler !== null].filter(Boolean)).toHaveLength(1);
      expect(r.yards * s.dir + s.yardLine).toBeLessThanOrEqual(100);
    }
  });

  it('gives the same frames for the same start and seed', () => {
    const a = runField(randomStart('same'), new Rng('same'));
    const b = runField(randomStart('same'), new Rng('same'));
    expect(b).toEqual(a);
  });
});
