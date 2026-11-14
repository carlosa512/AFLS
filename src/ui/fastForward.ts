/**
 * The fast-forward between highlights: when the highlight level skips plays, the field glides on, the clock counts
 * down and a card says what changed. These are its pure reads: how long the beat lasts, the clock it counts, and the
 * line under it. Spec: docs/superpowers/specs/2026-11-14-fast-forward-between-highlights-design.md.
 */
import type { PlayLogEntry } from '../engine/types';
import { clockOf, halfOf, secondsOf } from './gameRead';
import { BANNER_FLOOR } from './moments';

/** The beat at 1×, in milliseconds. Sped up it shortens with the square root of the speed, never under the floor. */
export const BEAT_MS = 2000;

/** How long the beat lasts at this speed: 2 s at 1×, about 1.4 s at 2×, 1 s at 4×, the banner floor at 8×. */
export function beatMs(speed: number): number {
  return Math.round(Math.max(BANNER_FLOOR, BEAT_MS / Math.sqrt(speed)));
}

/**
 * The game seconds a beat counts through: from the last highlight's snap to the next highlight's, so the clock never
 * jumps again when that play starts. A next play in another half (or none) stops it at the landed play's snap.
 */
export function beatSpan(plays: readonly PlayLogEntry[], from: number, to: number): { start: number; end: number } {
  const seconds = secondsOf(plays);
  const next = plays[to + 1];
  const end = next && halfOf(next.quarter) === halfOf(plays[to].quarter) ? seconds[to + 1] : seconds[to];
  return { start: seconds[from], end };
}

/** The clock `k` of the way through a beat (0 to 1), to the whole second. */
export function beatClock(
  plays: readonly PlayLogEntry[],
  span: { start: number; end: number },
  k: number,
): { quarter: number; clock: number } {
  return clockOf(plays, Math.round(span.start + (span.end - span.start) * k));
}
