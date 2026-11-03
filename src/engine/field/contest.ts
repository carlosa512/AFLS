/**
 * A defender within reach of the carrier: the carrier's move, then the tackle (spec §2, "Contests"). Task 3's stub:
 * every contact is a tackle with nothing after it.
 */
import type { Rng } from '../rng';
import type { Body } from './body';
import type { MoveKind } from './carrier';
import type { FieldPlayer, FieldStart } from './types';

export type Angle = 'head' | 'side' | 'behind';

export interface Contact {
  out: 'tackle' | 'broken' | 'missed';
  move?: MoveKind;
  /** Yards he carries the pile on after a tackle. */
  afterContact: number;
  /** A move he runs from here: the velocity he wants until it's done. */
  program: { until: number; want: (t: number, c: Body) => { vx: number; vy: number } } | null;
}

export function contest(
  _carrier: FieldPlayer,
  _c: Body,
  _defender: FieldPlayer,
  _d: Body,
  _help: number,
  _angle: Angle,
  _start: FieldStart,
  _rng: Rng,
): Contact {
  return { out: 'tackle', afterContact: 0, program: null };
}
