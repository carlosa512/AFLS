import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { bodyOf } from './body';
import { man, pinKnobs, pocketStartOf } from './fixtures';
import { MID } from './geometry';
import { pairUp, runPocket, type PocketStart } from './pocketField';
import { STEP } from './tuning';

/** Where man `k` is at step `s`. */
const at = (start: PocketStart, frames: Float32Array, s: number, k: number) => {
  const n = start.players.length;
  return { x: frames[(s * n + k) * 2], y: frames[(s * n + k) * 2 + 1] };
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('the pocket', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = pinKnobs();
  });
  afterAll(() => restore());

  it('pairs by alignment: the ends on the tackles, the tackles on the guards, a spare blocker doubling inside', () => {
    const { pairs, doubles, free } = pairUp(pocketStartOf());
    const on = new Map(pairs.map(([b, r]) => [r, b]));
    expect(on.get(30)).toBe(10);
    expect(on.get(33)).toBe(14);
    expect(on.get(31)).toBe(11);
    expect(on.get(32)).toBe(13);
    expect(doubles).toHaveLength(1);
    expect(doubles[0][0]).toBe(12);
    expect([31, 32]).toContain(doubles[0][1]);
    expect(free).toEqual([]);
  });

  it('leaves a sixth rusher free when the back is out', () => {
    const start = pocketStartOf({
      extra: [man(40, 1, 'LB', 45, MID - 3), man(41, 1, 'LB', 45, MID + 3)],
      blitz: true,
    });
    const { free, doubles } = pairUp(start);
    expect(free).toHaveLength(1);
    expect(doubles).toHaveLength(0);
  });

  it('lets a better rusher win sooner', () => {
    const homeAt = (rush: number, pro: number) => {
      const times: number[] = [];
      for (let k = 0; k < 40; k++) {
        const start = pocketStartOf({ outcome: 'pressure', end: 6, throwAt: 5.5, s: { 30: { rush }, 10: { pro } } });
        const r = runPocket(start, new Rng(`better:${rush}:${k}`));
        times.push(r.rusher === 30 && r.at !== null ? r.at : 6);
      }
      return mean(times);
    };
    expect(homeAt(18, 8)).toBeLessThan(homeAt(12, 12));
  });

  it('gives the same frames for the same start and seed', () => {
    const a = runPocket(pocketStartOf({ outcome: 'pressure' }), new Rng('same'));
    const b = runPocket(pocketStartOf({ outcome: 'pressure' }), new Rng('same'));
    expect(b).toEqual(a);
  });

  it('moves nobody faster than his legs, and no rusher through his blocker', () => {
    for (let k = 0; k < 30; k++) {
      const outcome = (['clean', 'pressure', 'hit', 'sack'] as const)[k % 4];
      const start = pocketStartOf({ outcome, end: 4, throwAt: 2.6 + (k % 5) * 0.2, sackX: 33 });
      const r = runPocket(start, new Rng(`legs:${k}`));
      const steps = r.frames.length / (start.players.length * 2);
      const { pairs } = pairUp(start);
      start.players.forEach((p, i) => {
        const top = bodyOf(p, false).top;
        for (let s = 1; s < steps; s++) {
          const a = at(start, r.frames, s - 1, i);
          const b = at(start, r.frames, s, i);
          expect(Math.hypot(b.x - a.x, b.y - a.y), `${outcome} man ${p.id} step ${s}`).toBeLessThanOrEqual(
            top * STEP + 0.05,
          );
        }
      });
      const index = new Map(start.players.map((p, i) => [p.id, i]));
      for (const [b, rr] of pairs)
        for (let s = 0; s < steps; s++) {
          const pb = at(start, r.frames, s, index.get(b)!);
          const pr = at(start, r.frames, s, index.get(rr)!);
          expect(Math.hypot(pb.x - pr.x, pb.y - pr.y), `${outcome} pair ${b}-${rr} step ${s}`).toBeGreaterThanOrEqual(
            0.5,
          );
        }
    }
  });
});
