/**
 * The ball's path for a play, in field coordinates: x from -10 (home end zone) to 110, y from 0 (near sideline) to
 * 53.3. Both views draw it (the broadcast view in 2.5D, All-22 from above), so both throw the same ball.
 */
import type { PlayLogEntry } from '../../engine/types';
import { bounce, fumbleIn } from './fumble';

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

/** The ball's path for a play, in both views: the play as it was carried, then any fumble (`loosen`). */
export function buildPath(e: PlayLogEntry, homeId: number, snapY: number): Seg[] {
  return loosen(e, basePath(carried(e), homeId, snapY));
}

/** A lost fumble's play up to where the ball came out: its logged end (`to`) is where the return ended. */
export function carried(e: PlayLogEntry): PlayLogEntry {
  const f = fumbleIn(e);
  return f?.lost && e.to !== f.x ? { ...e, to: f.x } : e;
}

/** The path of the play as logged, by its kind, with no fumble. */
export function basePath(e: PlayLogEntry, homeId: number, snapY: number): Seg[] {
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

/** A ground leg timed as the broadcast view runs the ball along (`ground`). */
const groundPace = (s: Seg): Seg => ({ ...s, dur: ground(s.x0, s.y0, s.x1, s.y1).dur });

/**
 * A fumble on a play carried to where it came out (`carried`): the carry stops where the ball comes out, it bounces to
 * where it's recovered (`fumble.ts`), and a lost one is returned to where the play ended. `pace` times the legs men
 * run (All-22 runs them at a runner's pace). Without a fumble, the path as it was.
 */
export function loosen(e: PlayLogEntry, segs: Seg[], pace: (s: Seg) => Seg = groundPace): Seg[] {
  const f = fumbleIn(e);
  if (!f || !segs.length) return segs;
  const last = segs[segs.length - 1];
  // Recovered level with where the carry was heading across the field.
  const at = { x: f.x, y: last.y1 };
  const hops = bounce(e, at);
  const out = { x: hops[0].x0, y: hops[0].y0 };
  // The carry ends where it came out; after a catch with no run logged (the throw ends it), he runs on to it.
  const carry =
    last.peak > 0 ? [last, pace(ground(last.x1, last.y1, out.x, out.y))] : [pace({ ...last, x1: out.x, y1: out.y })];
  const back = f.lost && e.to !== undefined && Math.abs(e.to - f.x) > 0.5;
  return [
    ...segs.slice(0, -1),
    ...carry,
    ...hops,
    ...(back ? [pace(ground(at.x, at.y, e.to!, clampY(at.y + (MID - at.y) * 0.2)))] : []),
  ];
}

export function pointAt(seg: Seg, s: number) {
  return { x: seg.x0 + (seg.x1 - seg.x0) * s, y: seg.y0 + (seg.y1 - seg.y0) * s, h: 4 * seg.peak * s * (1 - s) };
}

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
