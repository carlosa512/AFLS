import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { bodyOf } from './body';
import { afterContactYards, contest, type Angle } from './contest';
import { man, randomStart, startOf } from './fixtures';
import { MID } from './geometry';
import { runField } from './run';
import { STEP } from './tuning';
import type { FieldPlayer, FieldSkills } from './types';

const N = 4000;

/** How often a contest ends each way, over N draws. */
function rates(
  o: {
    c?: Partial<FieldSkills>;
    d?: Partial<FieldSkills>;
    angle?: Angle;
    help?: number;
    room?: boolean;
    kind?: 'run' | 'catch' | 'return';
    edge?: number;
    speed?: number;
  } = {},
) {
  const cp: FieldPlayer = man(1, 0, 'RB', 50, MID, { vx: o.speed ?? 7, s: o.c });
  const dp: FieldPlayer = man(30, 1, 'LB', 51, MID, { s: o.d });
  const start = startOf({ players: [cp, dp], kind: o.kind ?? 'run', edge: o.edge ?? 0 });
  const rng = new Rng(`contest:${JSON.stringify(o)}`);
  const out = { tackle: 0, broken: 0, missed: 0 };
  for (let i = 0; i < N; i++) {
    const r = contest(
      cp,
      bodyOf(cp, false),
      dp,
      bodyOf(dp, false),
      o.help ?? 0,
      o.angle ?? 'side',
      start,
      rng,
      o.room ?? false,
    );
    out[r.out]++;
  }
  return { tackle: out.tackle / N, broken: out.broken / N, missed: out.missed / N };
}

describe('contests', () => {
  it('tackles more with better tackling, head-on, and with help', () => {
    expect(rates({ d: { tackle: 18 } }).tackle).toBeGreaterThan(rates({ d: { tackle: 6 } }).tackle + 0.05);
    const head = rates({ angle: 'head' }).tackle;
    const side = rates({ angle: 'side' }).tackle;
    const behind = rates({ angle: 'behind' }).tackle;
    expect(head).toBeGreaterThan(side);
    expect(side).toBeGreaterThan(behind);
    expect(rates({ help: 1 }).tackle).toBeGreaterThan(side + 0.05);
  });

  it('breaks more tackles with more power and a bigger build', () => {
    expect(rates({ c: { power: 18 } }).tackle).toBeLessThan(rates({ c: { power: 6 } }).tackle - 0.05);
    expect(rates({ c: { w: 255 } }).tackle).toBeLessThan(rates({ c: { w: 185 } }).tackle - 0.02);
  });

  it('makes more men miss with better moves, and a returner with his return skill and the coaching edge', () => {
    // Elusive, not powerful: his breaks are moves.
    const base = { power: 6, room: true };
    expect(rates({ c: { move: 18, power: 6 }, room: true }).missed).toBeGreaterThan(
      rates({ c: { move: 8, power: 6 }, room: true }).missed + 0.03,
    );
    expect(rates({ kind: 'return', c: { ret: 18, power: 6 }, room: true }).missed).toBeGreaterThan(
      rates({ kind: 'return', c: { ret: 8, power: 6 }, room: true }).missed + 0.03,
    );
    expect(rates({ kind: 'return', c: { power: 6 }, edge: 3, room: true }).missed).toBeGreaterThan(
      rates({ kind: 'return', c: { power: 6 }, edge: 0, room: true }).missed + 0.01,
    );
    expect(base.room).toBe(true);
  });

  it('carries the pile on further at speed, less head-on and less with help', () => {
    const cp = man(1, 0, 'RB', 50, MID);
    const dp = man(30, 1, 'LB', 51, MID);
    const y = (v: number, angle: Angle, help: number) => afterContactYards(cp, v, dp, angle, help);
    expect(y(8, 'side', 0)).toBeGreaterThan(y(4, 'side', 0));
    expect(y(7, 'head', 0)).toBeLessThan(y(7, 'side', 0));
    expect(y(7, 'side', 1)).toBeLessThan(y(7, 'side', 0));
    expect(y(0, 'head', 2)).toBeGreaterThanOrEqual(0);
  });

  it('sends a man who misses on past and down', () => {
    let seen = 0;
    for (let i = 0; i < 1500 && seen < 20; i++) {
      const players = [
        man(1, 0, 'RB', 40, MID, { vx: 8, s: { move: 20, power: 20, speed: 18 } }),
        man(30, 1, 'LB', 52, MID, { s: { tackle: 4 } }),
        man(31, 1, 'S', 75, MID + 8),
      ];
      const start = startOf({ players });
      const r = runField(start, new Rng(`miss:${i}`));
      const miss = r.misses.find((m) => m.by === 30);
      if (!miss) continue;
      seen++;
      const n = players.length;
      const from = Math.round(miss.t / STEP);
      const speed = (s: number) =>
        Math.hypot(
          r.frames[(s * n + 1) * 2] - r.frames[((s - 1) * n + 1) * 2],
          r.frames[(s * n + 1) * 2 + 1] - r.frames[((s - 1) * n + 1) * 2 + 1],
        ) / STEP;
      const last = Math.min(from + Math.round(1 / STEP) - 1, r.frames.length / (n * 2) - 1);
      for (let s = from + 2; s <= last; s++)
        expect(speed(s)).toBeLessThanOrEqual(Math.max(0, speed(s - 1) - 12 * STEP) + 0.05);
      // No second play on the carrier within a second.
      for (const m of r.misses) if (m.by === 30 && m !== miss) expect(m.t - miss.t).toBeGreaterThanOrEqual(1);
      if (r.tackler === 30) expect(r.duration - miss.t).toBeGreaterThanOrEqual(1);
    }
    expect(seen).toBeGreaterThanOrEqual(10);
  });

  it('records misses in order, with their time and move', () => {
    let moves = 0;
    let total = 0;
    for (let i = 0; i < 600; i++) {
      const r = runField(randomStart(`order:${i}`), new Rng(`order:${i}`));
      for (let k = 0; k < r.misses.length; k++) {
        const m = r.misses[k];
        total++;
        if (m.move) moves++;
        expect(m.t).toBeGreaterThan(0);
        expect(m.t).toBeLessThanOrEqual(r.duration + 1e-9);
        if (k) expect(m.t).toBeGreaterThanOrEqual(r.misses[k - 1].t);
      }
    }
    expect(total).toBeGreaterThan(30);
    expect(moves).toBeGreaterThan(0);
  });
});
