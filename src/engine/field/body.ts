/**
 * A man's body on the open field: top speed, acceleration, cuts and reaction from his skills, and one point-mass step
 * that never lets him past his own top speed.
 */
import type { QuirkId } from '../quirks';
import { SPEED } from './speed';
import { BRAKE, KNOBS } from './tuning';
import type { FieldPlayer } from './types';

export interface Body {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Yards a second. */
  top: number;
  /** Speed gained along his line in a second. */
  accel: number;
  /** Speed turned across his line in a second: a fixed cut makes sharper turns at lower speed. */
  cut: number;
  /** Seconds before he reacts to what the carrier did. */
  react: number;
  /** On the ground until then (seconds from `t0`): a man who missed. */
  downUntil: number;
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

export const hasHabit = (p: FieldPlayer, q: QuirkId) => !!p.s.habits?.includes(q);

/** `carrier`: he has the ball, and his skill counts by `KNOBS.carrier`. */
export function bodyOf(p: FieldPlayer, tired: boolean, carrier = false): Body {
  const base = SPEED[p.role];
  const perPoint = KNOBS.speed * (carrier ? KNOBS.carrier : 1);
  let top = clamp(base + perPoint * (p.s.speed - 12), base - 1.5, base + 1.5);
  if (tired && hasHabit(p, 'gassed')) top -= 0.5;
  const react =
    clamp(KNOBS.react * (0.3 - 0.02 * (p.s.reads - 12)), 0.12, 0.5) +
    (hasHabit(p, 'slowFlow') ? 0.2 : 0) -
    (hasHabit(p, 'diagnoses') ? 0.1 : 0);
  return {
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    top,
    // Agility's job in the open field is small on purpose: today's engine doesn't read it after the line (Decision 2).
    accel: clamp(6 + 0.05 * (p.s.burst - 12), 4, 8),
    cut: clamp(10 + 0.1 * (p.s.burst - 12), 5, 15),
    react: Math.max(0.05, react),
    downUntil: -1,
  };
}

/**
 * One step toward the velocity he wants: speed gained along his line at most `accel·dt`, turned across it at most
 * `cut·dt`, shed at most `brake·dt`, and never above his top speed.
 */
export function stepBody(b: Body, want: { vx: number; vy: number }, dt: number, brake = BRAKE): void {
  let dvx = want.vx - b.vx;
  let dvy = want.vy - b.vy;
  const sp = Math.hypot(b.vx, b.vy);
  if (sp > 0.1) {
    const hx = b.vx / sp;
    const hy = b.vy / sp;
    const along = clamp(dvx * hx + dvy * hy, -brake * dt, b.accel * dt);
    const across = clamp(-dvx * hy + dvy * hx, -b.cut * dt, b.cut * dt);
    dvx = along * hx - across * hy;
    dvy = along * hy + across * hx;
  } else {
    const m = Math.hypot(dvx, dvy);
    const most = b.accel * dt;
    if (m > most) {
      dvx *= most / m;
      dvy *= most / m;
    }
  }
  b.vx += dvx;
  b.vy += dvy;
  const v = Math.hypot(b.vx, b.vy);
  if (v > b.top) {
    b.vx *= b.top / v;
    b.vy *= b.top / v;
  }
  b.x += b.vx * dt;
  b.y += b.vy * dt;
}
