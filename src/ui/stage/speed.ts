/**
 * How fast a man runs, by his role: the steering's top speeds and the scripts' limits share one table. Yards a second,
 * roughly the NFL's tracking data (spec §6: the fastest ball carriers 10.2–10.9 yd/s; linemen 6–7).
 */
import type { Keyframe } from './scripts';
import type { Role } from './cast';
import type { Pt } from './formations';

/** Top speeds in yards a second, roughly the NFL's tracking data. */
export const SPEED: Record<Role, number> = {
  CB: 9,
  S: 9,
  WR: 9,
  RET: 9,
  LB: 8.5,
  RB: 8.5,
  ST: 8.5,
  TE: 8,
  QB: 8,
  DT: 7.5,
  EDGE: 7.5,
  K: 7,
  P: 7,
  OL: 6.5,
};

/**
 * Keyframes a man can run at `top` from `from`: a spot on the way that he can't reach in time is dropped (he goes
 * straight on to the next). The last stays whatever it asks: it's where the engine's play needs him.
 */
export function runnable(from: Pt & { t?: number }, keys: readonly Keyframe[], top: number): Keyframe[] {
  const out: Keyframe[] = [];
  let prev: Keyframe = { t: from.t ?? 0, x: from.x, y: from.y };
  keys.forEach((k, i) => {
    const fast = Math.hypot(k.x - prev.x, k.y - prev.y) > top * Math.max(0, k.t - prev.t) + 1e-6;
    if (fast && i < keys.length - 1) return;
    out.push(k);
    prev = k;
  });
  return out;
}
