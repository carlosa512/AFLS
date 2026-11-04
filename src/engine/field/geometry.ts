/**
 * The field's geometry, shared by the open field and All-22: x from -10 (home end zone) to 110, y from 0 (near
 * sideline) to 53.3, the hash marks, and a leg of the ball's path.
 */
import type { PlayLogEntry } from '../types';
import type { MoveKind } from './carrier';

export const FIELD_W = 53.3;
export const MID = FIELD_W / 2;

// NFL hash marks sit 70'9" in from each sideline; the ball is spotted between them.
export const HASH_LO = 23.6;
export const HASH_HI = FIELD_W - 23.6;
export const clampY = (y: number) => Math.max(1.5, Math.min(FIELD_W - 1.5, y));

/** Where across the field a play's lane goes (-1 left … 1 right, from the offense's view) from where it's snapped. */
export const laneY = (snapY: number, lane: number, dir: 1 | -1) => clampY(snapY + lane * dir * 16);

export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Peak height for passes and kicks; 0 on the ground. */
  peak: number;
  dur: number;
  /** A ball carrier's move; the stager scripts the man who missed against it. */
  move?: MoveKind;
  /** The tackle lands at this leg's start: the pair go on to its end together (a lunge forward, a slide into it). */
  hit?: true;
}

export function pointAt(seg: Seg, s: number) {
  return { x: seg.x0 + (seg.x1 - seg.x0) * s, y: seg.y0 + (seg.y1 - seg.y0) * s, h: 4 * seg.peak * s * (1 - s) };
}

/** Plays snapped from scrimmage start on the hash nearest to where the last play ended. */
export const SNAPPED = new Set([
  'run',
  'pass',
  'incomplete',
  'int',
  'sack',
  'scramble',
  'kneel',
  'spike',
  'penalty',
  'punt',
  'fg',
]);

/** Where the ball is snapped: plays from scrimmage on the hash nearest where the last play ended, others mid-field. */
export function snapYFor(e: PlayLogEntry | undefined, lastY: number): number {
  return e?.kind && SNAPPED.has(e.kind) ? Math.max(HASH_LO, Math.min(HASH_HI, lastY)) : MID;
}

/**
 * The side with the ball: 0 home, 1 away. A kick's log entry can name the receiving team (the engine logs it after
 * possession changes on a touchback), so a kick reads its side off the ball's flight, which always goes away from
 * the kicking team.
 */
export function offenseSide(e: PlayLogEntry, homeId: number): 0 | 1 {
  const kick = e.kind === 'kickoff' || e.kind === 'punt' || e.kind === 'fg' || e.kind === 'xp';
  if (kick && e.air !== undefined && e.from !== undefined && e.air !== e.from) return e.air > e.from ? 0 : 1;
  return e.offense === homeId ? 0 : 1;
}
