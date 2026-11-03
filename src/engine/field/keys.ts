/**
 * Keyframes and tracks shared by the open field and All-22: a man's scripted spots, where he is between them, the ball
 * at each step, and a pass's time in the air.
 */
import { pointAt, type Seg } from './geometry';
import type { Pt } from './formations';

/** A spot at a time: seconds from the snap. */
export interface Keyframe {
  t: number;
  x: number;
  y: number;
}

/** Where a scripted player is at `t`: straight lines between keyframes, held before the first and after the last. */
export function sample(keys: readonly Keyframe[], t: number): Pt {
  if (t <= keys[0].t) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (t <= b.t) {
      const a = keys[i - 1];
      const k = b.t === a.t ? 1 : (t - a.t) / (b.t - a.t);
      return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
    }
  }
  return keys[keys.length - 1];
}

/** The ball at each step: x, y and height, `dt` apart from the snap to the end of its path. */
export function ballTrack(segs: readonly Seg[], dt: number): Float32Array {
  const total = segs.reduce((t, s) => t + s.dur, 0);
  const steps = Math.max(1, Math.ceil(total / dt) + 1);
  const out = new Float32Array(steps * 3);
  for (let i = 0; i < steps; i++) {
    let t = Math.min(total, i * dt);
    let p = segs.length ? pointAt(segs[segs.length - 1], 1) : { x: 0, y: 0, h: 0 };
    for (const s of segs) {
      if (t <= s.dur) {
        p = pointAt(s, s.dur ? t / s.dur : 1);
        break;
      }
      t -= s.dur;
    }
    out.set([p.x, p.y, p.h], i * 3);
  }
  return out;
}

/**
 * A pass's time in the air, by how far it goes: about a second at 20 yards, two at 45 (a deep ball is lofted). The
 * broadcast view keeps its own quicker flight.
 */
export const passFlight = (yards: number) => 0.3 + yards * 0.037;

/** The engine's beaten block is acted out when the two lined up within this many yards of each other across the field. */
export const BEAT_ACROSS = 6;
