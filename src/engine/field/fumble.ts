/**
 * The loose ball, for both views: a fumble read off the play, and the ball's few short hops from where it came out to
 * where it was recovered. Seeded from the play itself, so the broadcast view and All-22 bounce it the same way.
 * Spec: docs/superpowers/specs/2026-11-02-all-22-passing-game-design.md §5.
 */
import { Rng } from '../rng';
import type { PlayLogEntry } from '../types';
import type { Seg } from './ballPath';

/** A fumble on a play: lost to the defense or kept, and where it was recovered (field yards). */
export interface Fumble {
  lost: boolean;
  x: number;
}

const LOST = /FUMBLE, recovered by/;
const KEPT = /Fumble, recovered by the offense/;
const CARRIED: ReadonlySet<string> = new Set(['run', 'scramble', 'pass', 'sack']);

/**
 * The play's fumble, if it had one. A lost one is recovered where it came out (`loose`; a game before v78 has only
 * where the return ended, `to`); a kept one where the play ended.
 */
export function fumbleIn(e: PlayLogEntry): Fumble | null {
  if (!CARRIED.has(e.kind ?? '') || e.to === undefined) return null;
  if (LOST.test(e.text)) return { lost: true, x: e.loose ?? e.to };
  if (KEPT.test(e.text)) return { lost: false, x: e.to };
  return null;
}

/** No study measures a loose ball (spec §6): ours is a few yards over about a second, under shoulder height. */
const PATH = [2, 6] as const;
const TIME = [0.8, 1.3] as const;
const PEAK = [0.3, 0.6] as const;
/** No hop goes higher: anything above it on a play's path is a throw or a kick, not the loose ball. */
export const HOP_PEAK = PEAK[1];
/** It squirts mostly sideways: where it came out is at most this far up or down the field from where it's recovered. */
const DRIFT = 1.5;
const IN_BOUNDS = [0.5, 52.8] as const;

/**
 * The hops, ending at `at` (where it's recovered): two to four, each shorter and lower than the last, all one way
 * across the field so none crosses a sideline that its ends don't.
 */
export function bounce(e: PlayLogEntry, at: { x: number; y: number }): Seg[] {
  const rng = new Rng(`bounce:${e.quarter}:${e.clock}:${e.from}:${e.to}`);
  const n = rng.int(2, 4);
  const weights = Array.from({ length: n }, (_, i) => 0.7 ** i);
  const sum = weights.reduce((a, b) => a + b, 0);
  const path = rng.float(PATH[0], PATH[1]);
  const time = rng.float(TIME[0], TIME[1]);
  const drift = rng.float(-DRIFT, DRIFT);
  let side = rng.next() < 0.5 ? 1 : -1;
  const peak = rng.float(PEAK[0], PEAK[1]);
  // Each hop's share of the path, its share of the drift up the field, and the rest across it.
  const hops = weights.map((w) => {
    const len = (path * w) / sum;
    const dx = (drift * w) / sum;
    return { dx, dy: Math.sqrt(Math.max(0, len * len - dx * dx)), w };
  });
  const across = hops.reduce((a, h) => a + h.dy, 0);
  // Out of where it came out the other way, if this way would start it beyond a sideline.
  if (at.y - side * across < IN_BOUNDS[0] || at.y - side * across > IN_BOUNDS[1]) side = -side;
  let x = at.x - drift;
  let y = at.y - side * across;
  return hops.map((h, i) => {
    const seg: Seg = {
      x0: x,
      y0: y,
      x1: x + h.dx,
      y1: y + side * h.dy,
      peak: peak * 0.6 ** i,
      dur: (time * h.w) / sum,
    };
    [x, y] = [seg.x1, seg.y1];
    return seg;
  });
}
