/**
 * How All-22 frames the field: the whole field sideways when the box is wide, an upright window that follows the ball
 * when it isn't (a phone held upright). Spec §4.
 */
import type { PlayLogEntry } from '../../engine/types';

/** Wide enough for the whole field sideways. */
const WIDE = 1.6;
/** Yards of field an upright window shows, and how far it leads the ball. */
const SPAN = 45;
const KICK_SPAN = 70;
const LEAD = 5;

export type Layout = 'wide' | 'upright';

export function layoutFor(width: number, height: number): Layout {
  if (!width || !height) return 'wide';
  return width / height >= WIDE ? 'wide' : 'upright';
}

/** Yards the upright window shows: wider for a kick, so the flight stays in frame. */
export function cameraSpan(e: Pick<PlayLogEntry, 'kind'> | undefined): number {
  return e?.kind === 'kickoff' || e?.kind === 'punt' ? KICK_SPAN : SPAN;
}

/** The yard line at the middle of the window: a step ahead of the ball, never past either end line. */
export function cameraCenter(ballX: number, dir: 1 | -1, span: number): number {
  const half = span / 2;
  return Math.max(-10 + half, Math.min(110 - half, ballX + dir * LEAD));
}

/** How quickly the upright window catches the ball: the share of the gap closed in a second is 1 - e^-RATE. */
const RATE = 4;

/** The window's centre after `seconds` easing toward `target`: the same at any frame rate; `Infinity` snaps. */
export function easeCamera(current: number, target: number, seconds: number): number {
  if (seconds === Infinity) return target;
  return current + (target - current) * (1 - Math.exp(-RATE * seconds));
}
