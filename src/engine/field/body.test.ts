import { describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { bodyOf, stepBody } from './body';
import { man, randomStart } from './fixtures';
import { FIELD_W } from './geometry';
import { runField } from './run';
import { STEP } from './tuning';

describe('bodies on the field', () => {
  it('never lets a man run faster than his top speed, or leave the field unless he carries the ball', () => {
    for (let i = 0; i < 500; i++) {
      const start = randomStart(`body:${i}`);
      const r = runField(start, new Rng(`body:${i}`));
      const n = start.players.length;
      const tops = start.players.map((p) => bodyOf(p, start.tired).top);
      const steps = r.frames.length / (n * 2);
      let over = 0;
      let off = 0;
      for (let s = 1; s < steps; s++)
        for (let k = 0; k < n; k++) {
          const dx = r.frames[(s * n + k) * 2] - r.frames[((s - 1) * n + k) * 2];
          const dy = r.frames[(s * n + k) * 2 + 1] - r.frames[((s - 1) * n + k) * 2 + 1];
          over = Math.max(over, Math.hypot(dx, dy) / STEP - tops[k]);
          if (start.players[k].id === start.carrier) continue;
          const x = r.frames[(s * n + k) * 2];
          const y = r.frames[(s * n + k) * 2 + 1];
          off = Math.max(off, 0.5 - y, y - (FIELD_W - 0.5), -10 - x, x - 110);
        }
      expect(over, `start ${i}: faster than his legs`).toBeLessThanOrEqual(1e-3);
      expect(off, `start ${i}: off the field`).toBeLessThanOrEqual(1e-3);
    }
  });

  it('accelerates and cuts within his limits, sharper at lower speed', () => {
    const b = bodyOf(man(1, 0, 'RB', 50, 20), false);
    let steps = 0;
    while (Math.hypot(b.vx, b.vy) < 0.95 * b.top) {
      stepBody(b, { vx: b.top, vy: 0 }, STEP);
      steps++;
    }
    expect(steps * STEP).toBeGreaterThanOrEqual((0.95 * b.top) / b.accel - STEP);
    const turn = (speed: number) => {
      const t = bodyOf(man(1, 0, 'RB', 50, 20, { vx: speed }), false);
      let n = 0;
      while (Math.atan2(t.vy, t.vx) < (80 * Math.PI) / 180 && n < 1000) {
        stepBody(t, { vx: 0, vy: speed }, STEP);
        n++;
      }
      return n;
    };
    expect(turn(8)).toBeGreaterThan(turn(3));
  });
});
