/**
 * The players a play was about, scripted to the engine's result: whoever has the ball is wherever the ball is, the
 * target meets the throw, the cover man trails him, the rusher gets home, the tackler meets the carrier at the end
 * spot. Timing comes from the ball's own path (`buildPath`), so both views tell the same play. Everyone else steers
 * (`steer.ts`).
 */
import { actorsIn } from '../../engine/playActors';
import type { PlayLogEntry } from '../../engine/types';
import { buildPath, ground, pointAt, type Seg } from './ballPath';
import type { Cast } from './cast';
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

/** Each segment's start and end time from the snap. */
const times = (segs: readonly Seg[]) => {
  let t = 0;
  return segs.map((s) => {
    const a = t;
    t += s.dur;
    return [a, t] as const;
  });
};

const at = (t: number, p: { x: number; y: number }): Keyframe => ({ t, x: p.x, y: p.y });

/** The quarterback standing in the pocket: a segment that goes nowhere for `dur` seconds. */
const hold = (p: { x: number; y: number }, dur: number): Seg => ({ x0: p.x, y0: p.y, x1: p.x, y1: p.y, peak: 0, dur });

/** Seconds in the pocket before a sack gets home. */
const SACK_HOLD = 1.8;
/** Before a scramble breaks out. */
const SCRAMBLE_HOLD = 1.1;

/**
 * The ball's path as All-22 tells it. The broadcast view's path (`buildPath`) is the same ball, but a dropback there
 * goes straight from the drop to the throw or the sack: from above, routes need time to run. So a pass waits in the
 * pocket after the drop (longer for a deeper throw), a sack holds before the rush gets home, and a scramble holds
 * before the quarterback takes off. Every dropback here is: drop, hold, then the throw, the run or the sack.
 */
export function stagedPath(e: PlayLogEntry, homeId: number, snapY: number): Seg[] {
  const segs = buildPath(e, homeId, snapY);
  if (!segs.length || e.from === undefined || e.to === undefined) return segs;
  const dir = e.offense === homeId ? 1 : -1;
  if (e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int') {
    const drop = segs[0];
    const air = segs[1];
    const depth = air ? Math.abs(air.x1 - air.x0) : 10;
    return [
      drop,
      hold({ x: drop.x1, y: drop.y1 }, Math.max(0.8, Math.min(1.6, 0.7 + depth * 0.035))),
      ...segs.slice(1),
    ];
  }
  if (e.kind === 'sack' || e.kind === 'scramble') {
    const qb = { x: e.from - dir * 6, y: snapY };
    const end = segs[segs.length - 1];
    return [
      ground(e.from, snapY, qb.x, qb.y, 0.8),
      hold(qb, e.kind === 'sack' ? SACK_HOLD : SCRAMBLE_HOLD),
      ground(qb.x, qb.y, end.x1, end.y1),
    ];
  }
  return segs;
}

/** Keyframes that ride the ball through segments `from`..`to` (inclusive). */
function ride(segs: readonly Seg[], from: number, to: number): Keyframe[] {
  const ts = times(segs);
  const out: Keyframe[] = [];
  for (let i = from; i <= to && i < segs.length; i++) {
    out.push(at(ts[i][0], pointAt(segs[i], 0)));
    out.push(at(ts[i][1], pointAt(segs[i], 1)));
  }
  return out;
}

/** A point `d` yards from `p` toward `q`. */
const toward = (p: Pt, q: Pt, d: number): Pt => {
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  return { x: p.x + ((q.x - p.x) / len) * d, y: p.y + ((q.y - p.y) / len) * d };
};

const TACKLED: ReadonlySet<string> = new Set(['run', 'pass', 'scramble']);

export interface Scripted {
  keys: Map<number, Keyframe[]>;
  /** Who has the ball at the whistle (null on a miss, a kick or an announcement). */
  carrier: number | null;
  /** Who brings him down. */
  tackler: number | null;
  /** When the ball leaves the quarterback's hands (the throw or the handoff): the defense reacts from then. */
  release: number;
}

export function script(
  e: PlayLogEntry,
  cast: Cast,
  start: ReadonlyMap<number, Pt>,
  segs: readonly Seg[],
  dir: 1 | -1,
): Scripted {
  const keys = new Map<number, Keyframe[]>();
  if (!segs.length) return { keys, carrier: null, tackler: null, release: 0 };
  const ts = times(segs);
  const total = ts[ts.length - 1][1];
  const end = pointAt(segs[segs.length - 1], 1);
  const who = actorsIn(e);
  const qb = cast.offense.find((m) => m.role === 'QB')?.id;
  const from = (id: number): Keyframe => at(0, start.get(id)!);
  const set = (id: number | undefined, ks: Keyframe[]) => {
    if (id === undefined || !start.has(id)) return;
    keys.set(id, [from(id), ...ks.filter((k) => k.t > 0)]);
  };
  const touchdown = /TOUCHDOWN/.test(e.text);
  let carrier: number | undefined;

  switch (e.kind) {
    case 'run': {
      // The quarterback turns and hands off where the ball's first leg ends; the back takes it there and runs.
      const hand = pointAt(segs[0], 1);
      carrier = who.ball ?? cast.offense.find((m) => m.role === 'RB')?.id;
      // A quarterback run keeps the ball the whole way.
      if (carrier === qb) set(qb, ride(segs, 0, segs.length - 1));
      else {
        if (qb !== undefined) set(qb, [at(ts[0][1], hand), at(total, toward(hand, start.get(qb)!, 1))]);
        set(carrier, [at(ts[0][1], hand), ...ride(segs, 1, segs.length - 1)]);
      }
      break;
    }
    case 'scramble':
    case 'kneel':
    case 'spike':
    case 'sack':
      carrier = qb;
      set(qb, ride(segs, 0, segs.length - 1));
      if (e.kind === 'sack' && who.rush !== undefined && start.has(who.rush)) {
        // Past the man he beat (or straight in), then onto the quarterback where the sack lands.
        const beat = who.beat !== undefined ? start.get(who.beat) : undefined;
        const mid: Keyframe[] = beat ? [at(total * 0.6, toward(beat, end, 1))] : [];
        set(who.rush, [...mid, at(total, toward(end, start.get(who.rush)!, 0.6))]);
      }
      break;
    case 'pass':
    case 'incomplete':
    case 'int': {
      // Drop, hold in the pocket, throw (`stagedPath`).
      if (qb !== undefined) set(qb, ride(segs, 0, 1));
      const throwEnd = segs[2] ? ts[2][1] : total;
      const land = segs[2] ? pointAt(segs[2], 1) : end;
      const target = who.ball;
      if (target !== undefined && start.has(target)) {
        const s0 = start.get(target)!;
        // A stem upfield, then the break to the ball, arriving as it does (a step short of a pick or a miss).
        const short = e.kind === 'pass' ? 0 : e.kind === 'int' ? 1.5 : 0.7;
        const arrive = short ? toward(land, s0, short) : land;
        const stem = { x: s0.x + (arrive.x - s0.x) * 0.6, y: s0.y + (arrive.y - s0.y) * 0.25 };
        const after = e.kind === 'pass' ? ride(segs, 3, segs.length - 1) : [];
        set(target, [at(throwEnd * 0.55, stem), at(throwEnd, arrive), ...after]);
        if (e.kind === 'pass') carrier = target;
      }
      if (e.kind === 'int' && who.take !== undefined && start.has(who.take)) {
        set(who.take, [at(throwEnd, land), ...ride(segs, 3, segs.length - 1)]);
        carrier = who.take;
      }
      if (who.cover !== undefined && who.cover !== who.take && start.has(who.cover)) {
        // Trailing the receiver: a yard and a half deeper than the catch (under it on a miss).
        const trail = e.kind === 'incomplete' ? 0.7 : 1.5;
        const spot = { x: land.x + dir * trail, y: land.y };
        set(who.cover, [at(throwEnd, spot), ...(e.kind === 'pass' ? [at(total, toward(end, spot, 2.5))] : [])]);
      }
      break;
    }
  }

  // The tackler meets the carrier at the whistle, from the side he came.
  let tacklerId: number | null = null;
  if (
    carrier !== undefined &&
    !touchdown &&
    (TACKLED.has(e.kind ?? '') || (e.kind === 'int' && who.tackle !== undefined))
  ) {
    const side = e.kind === 'int' ? cast.offense : cast.defense;
    let tackler = who.tackle !== undefined && start.has(who.tackle) && who.tackle !== carrier ? who.tackle : undefined;
    if (tackler === undefined && e.kind !== 'int') {
      let best = Infinity;
      for (const m of side) {
        const p = start.get(m.id)!;
        const d = Math.hypot(p.x - end.x, p.y - end.y);
        if (d < best && m.id !== carrier) [best, tackler] = [d, m.id];
      }
    }
    if (tackler !== undefined) {
      const s0 = start.get(tackler)!;
      // Already scripted (the cover man on a catch): keep his path, and end it on the carrier.
      const before = keys.get(tackler)?.filter((k) => k.t < total) ?? [];
      keys.set(tackler, [from(tackler), ...before.filter((k) => k.t > 0), at(total, toward(end, s0, 0.6))]);
      tacklerId = tackler;
    }
  }
  // When the defense reads the ball out: the handoff, the throw (after the pocket), the scramble breaking out. A sack
  // never releases: the rush is on the quarterback and the coverage stays on the routes the whole play.
  const release =
    e.kind === 'run'
      ? ts[0][1]
      : e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int' || e.kind === 'scramble'
        ? (ts[1]?.[1] ?? 0)
        : e.kind === 'sack'
          ? Infinity
          : 0;
  return { keys, carrier: carrier ?? null, tackler: tacklerId, release };
}
