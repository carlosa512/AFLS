/**
 * The ball's path for a play, in field coordinates: x from -10 (home end zone) to 110, y from 0 (near sideline) to
 * 53.3. Both views draw it (the broadcast view in 2.5D, All-22 from above), so both throw the same ball.
 */
import type { PlayLogEntry } from '../../engine/types';

export const FIELD_W = 53.3;
export const MID = FIELD_W / 2;

// NFL hash marks sit 70'9" in from each sideline; the ball is spotted between them.
export const HASH_LO = 23.6;
export const HASH_HI = FIELD_W - 23.6;
export const clampY = (y: number) => Math.max(1.5, Math.min(FIELD_W - 1.5, y));

export interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Peak height for passes and kicks; 0 on the ground. */
  peak: number;
  dur: number;
}

export function ground(x0: number, y0: number, x1: number, y1: number, pace = 1): Seg {
  return { x0, y0, x1, y1, peak: 0, dur: (0.3 + Math.min(1.9, Math.hypot(x1 - x0, y1 - y0) * 0.04)) * pace };
}
function air(x0: number, y0: number, x1: number, y1: number, peak: number, dur?: number): Seg {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  return { x0, y0, x1, y1, peak, dur: dur ?? 0.5 + dist * 0.018 };
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

export function buildPath(e: PlayLogEntry, homeId: number, snapY: number): Seg[] {
  if (e.from === undefined || e.to === undefined || !e.kind) return [];
  const { from, to } = e;
  const dir = e.offense === homeId ? 1 : -1;
  // Home drives toward screen-left, so its left hand is the near sideline; away is the reverse.
  const laneY = clampY(snapY + (e.lane ?? 0) * dir * 16);
  const segs: Seg[] = [];
  switch (e.kind) {
    case 'pass':
    case 'incomplete':
    case 'int': {
      const qbX = from - dir * 6;
      segs.push(ground(from, snapY, qbX, snapY, 0.8));
      const target = e.air ?? from + dir * 2;
      const targetY = e.air === undefined ? (laneY > MID ? FIELD_W + 2 : -2) : laneY;
      segs.push(air(qbX, snapY, target, targetY, Math.min(14, 2.5 + Math.abs(target - qbX) * 0.3)));
      if (e.kind !== 'incomplete' && Math.abs(to - target) > 0.5)
        segs.push(ground(target, targetY, to, clampY(laneY + (e.lane ?? 0) * 3)));
      break;
    }
    case 'run':
    case 'scramble': {
      const handoff = from - dir * 3;
      segs.push(ground(from, snapY, handoff, snapY, 0.6));
      segs.push(ground(handoff, snapY, to, laneY));
      break;
    }
    case 'spike':
      segs.push(ground(from, snapY, from - dir, snapY, 0.5));
      break;
    case 'kickoff':
    case 'punt': {
      const land = e.air ?? to;
      let start = from;
      const y = e.kind === 'punt' ? snapY : MID;
      if (e.kind === 'punt') {
        start = from - Math.sign(land - from || dir) * 13;
        segs.push(ground(from, y, start, y, 0.5));
      }
      segs.push(air(start, y, land, y, e.kind === 'kickoff' ? 24 : 20, 1.5));
      if (Math.abs(to - land) > 0.5) segs.push(ground(land, y, to, clampY(y + 4)));
      break;
    }
    case 'fg':
      segs.push(air(from, snapY, e.air ?? to, MID, 13, 1.1));
      break;
    case 'xp':
      segs.push(air(from, MID, e.air ?? to, MID, 13, 1.1));
      break;
    default:
      segs.push(ground(from, snapY, to, snapY, e.kind === 'penalty' ? 1.6 : 1));
  }
  return segs;
}

export function pointAt(seg: Seg, s: number) {
  return { x: seg.x0 + (seg.x1 - seg.x0) * s, y: seg.y0 + (seg.y1 - seg.y0) * s, h: 4 * seg.peak * s * (1 - s) };
}

/** Where the ball is snapped: plays from scrimmage on the hash nearest where the last play ended, others mid-field. */
export function snapYFor(e: PlayLogEntry | undefined, lastY: number): number {
  return e?.kind && SNAPPED.has(e.kind) ? Math.max(HASH_LO, Math.min(HASH_HI, lastY)) : MID;
}
