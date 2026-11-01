/**
 * The officials in All-22: five of the crew on the field for every snap. Where each stands for the kind of play, how
 * he moves with it (the wings along their sidelines with the ball, the referee and umpire trailing it, the back judge
 * staying deeper than it), the flag one of them throws when there's a foul, and the conference after it. Pure, like
 * the rest of the stager: where each is at any step.
 */
import type { PlayLogEntry } from '../../engine/types';
import { FIELD_W, MID } from './ballPath';
import type { Pt } from './formations';

/** Referee, umpire, down judge (near sideline), line judge (far sideline), back judge. */
export const CREW = ['R', 'U', 'DJ', 'LJ', 'BJ'] as const;
export const UMPIRE = 1;

/** Where the crew stands for a snap: `ballX`/`ballY` the ball, `dir` the way the offense (or kicking side) goes. */
export function crewSpots(e: PlayLogEntry, ballX: number, ballY: number, dir: 1 | -1, land?: Pt): Pt[] {
  const near = -0.9;
  const far = FIELD_W + 0.9;
  const at = (depth: number, y: number): Pt => ({ x: ballX + dir * depth, y: Math.max(2, Math.min(FIELD_W - 2, y)) });
  if (e.kind === 'kickoff')
    // On the kicking team's line and at the receiving 20 on each sideline, the referee deep on the goal line.
    return [
      at(65, MID + 9),
      at(-6, MID - 8),
      { x: ballX + dir * 25, y: near },
      { x: ballX + dir * 25, y: far },
      at(45, MID - 12),
    ];
  if (e.kind === 'punt') {
    const deep = land ? Math.abs(land.x - ballX) + 6 : 45;
    return [at(-17, ballY + 6), at(-7, ballY - 6), { x: ballX, y: near }, { x: ballX, y: far }, at(deep, ballY + 9)];
  }
  if (e.kind === 'fg' || e.kind === 'xp') {
    // Two under the uprights at the end line, the referee behind the holder.
    const posts = dir === 1 ? 110 : -10;
    return [
      at(-10, ballY + 5),
      at(-6, ballY - 6),
      { x: ballX, y: near },
      { x: ballX, y: far },
      { x: posts, y: MID + 3 },
    ];
  }
  // A snap from scrimmage: the referee and umpire in the offensive backfield, a wing on each sideline at the line,
  // the back judge deep in the middle of the defense.
  return [at(-12, ballY + 5), at(-10, ballY - 5), { x: ballX, y: near }, { x: ballX, y: far }, at(22, MID)];
}

/** Top speed (yards a second) and how quickly they get there. */
const PACE = 7;
const ACCEL = 5;

/**
 * Where each official is at every step of the play (steps × 5 × (x, y)), following the ball (`ball`: x, y, h per
 * step): the wings keep level with it along their sideline, the referee and umpire trail it, the back judge stays a
 * few yards deeper than it.
 */
export function crewTrack(
  start: readonly Pt[],
  ball: Float32Array,
  steps: number,
  dt: number,
  dir: 1 | -1,
): Float32Array {
  const out = new Float32Array(steps * start.length * 2);
  const px = start.map((p) => p.x);
  const py = start.map((p) => p.y);
  const vx = start.map(() => 0);
  const vy = start.map(() => 0);
  const ball0 = ball[0];
  for (let st = 0; st < steps; st++) {
    // The ball a beat ago: an official reacts to the play, he doesn't lead it.
    const lag = Math.max(0, st - 6);
    const bx = ball[lag * 3];
    const by = ball[lag * 3 + 1];
    const gain = (bx - ball0) * dir;
    for (let k = 0; k < start.length; k++) {
      let gx = start[k].x;
      let gy = start[k].y;
      if (k === 2 || k === 3)
        gx = bx; // the wings, level with the ball
      else if (k === 4) {
        // The back judge: deeper than the ball, never shallower than he started.
        const depth = Math.max((start[k].x - ball0) * dir, gain + 8);
        gx = ball0 + dir * depth;
        gy = start[k].y + (by - start[k].y) * 0.3;
      } else if (gain > 0) {
        // The referee and umpire trail a gain from behind it.
        gx = start[k].x + dir * gain * 0.6;
        gy = start[k].y + (by - start[k].y) * 0.25;
      }
      const dx = gx - px[k];
      const dy = gy - py[k];
      const d = Math.hypot(dx, dy);
      const want = Math.min(PACE, d * 2);
      const tvx = d > 1e-6 ? (dx / d) * want : 0;
      const tvy = d > 1e-6 ? (dy / d) * want : 0;
      const ax = tvx - vx[k];
      const ay = tvy - vy[k];
      const a = Math.hypot(ax, ay);
      const cap = ACCEL * dt;
      const f = a > cap ? cap / a : 1;
      vx[k] += ax * f;
      vy[k] += ay * f;
      px[k] += vx[k] * dt;
      py[k] += vy[k] * dt;
      out[(st * start.length + k) * 2] = px[k];
      out[(st * start.length + k) * 2 + 1] = py[k];
    }
  }
  return out;
}

/** A flag in flight: thrown by the official nearest where it lands, arcing there in about half a second. */
export interface FlagThrow {
  by: number;
  from: Pt;
  to: Pt;
  /** Seconds from the snap it leaves his hand, and lands. */
  thrown: number;
  lands: number;
}

const FLIGHT = 0.55;

/**
 * The flag on a play: where it lands (at the line for a foul before the snap or by the blockers, else where the ball
 * is when it comes out) and who throws it, the official nearest that spot when it does.
 */
export function flagThrow(
  crew: Float32Array,
  ball: Float32Array,
  steps: number,
  dt: number,
  thrownAt: number,
  atLine: boolean,
): FlagThrow {
  const st = Math.min(steps - 1, Math.round(thrownAt / dt));
  const to = atLine ? { x: ball[0], y: ball[1] + 2 } : { x: ball[st * 3] + 1.2, y: ball[st * 3 + 1] + 1.5 };
  let by = 0;
  let best = Infinity;
  for (let k = 0; k < CREW.length; k++) {
    const x = crew[(st * CREW.length + k) * 2];
    const y = crew[(st * CREW.length + k) * 2 + 1];
    const d = Math.hypot(x - to.x, y - to.y);
    if (d < best) [best, by] = [d, k];
  }
  const from = { x: crew[(st * CREW.length + by) * 2], y: crew[(st * CREW.length + by) * 2 + 1] };
  return { by, from, to, thrown: st * dt, lands: st * dt + FLIGHT };
}

/** The flag at `t` seconds from the snap: in his hand, in the air (with its height), or on the ground. */
export function flagAt(f: FlagThrow, t: number): (Pt & { h: number }) | null {
  if (t < f.thrown) return null;
  const k = Math.min(1, (t - f.thrown) / (f.lands - f.thrown));
  return { x: f.from.x + (f.to.x - f.from.x) * k, y: f.from.y + (f.to.y - f.from.y) * k, h: 4 * 2.5 * k * (1 - k) };
}

/** The conference after a flag: where each official walks to, round the flag (the wings in a few yards). */
export function conference(crewEnd: readonly Pt[], flag: Pt): Pt[] {
  return crewEnd.map((p, k) => {
    const angle = (k / CREW.length) * Math.PI * 2;
    const ring = { x: flag.x + Math.cos(angle) * 2.6, y: flag.y + Math.sin(angle) * 2.6 };
    // Each covers most of the way, not all of it: the far ones stop short.
    const d = Math.hypot(ring.x - p.x, ring.y - p.y);
    const k2 = d > 14 ? 14 / d : 1;
    return { x: p.x + (ring.x - p.x) * k2, y: p.y + (ring.y - p.y) * k2 };
  });
}
