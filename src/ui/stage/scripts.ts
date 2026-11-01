/**
 * The players a play was about, scripted to the engine's result: whoever has the ball is wherever the ball is, the
 * target meets the throw, the cover man trails him, the rusher gets home, the tackler meets the carrier at the end
 * spot. Timing comes from the ball's own path (`buildPath`), so both views tell the same play. Everyone else steers
 * (`steer.ts`).
 */
import { actorsIn } from '../../engine/playActors';
import type { PlayLogEntry } from '../../engine/types';
import { buildPath, FIELD_W, ground, offenseSide, pointAt, type Seg } from './ballPath';
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
/** The kicker's run-up to the ball on the tee. */
const KICK_RUN_UP = 0.9;
/** The handoff, from the snap to the ball in the back's belly. */
const MESH = 0.8;
/** A receiver's pace down the field once he's up to speed (yards a second). */
const ROUTE_PACE = 8.5;
/** Before a scramble breaks out. */
const SCRAMBLE_HOLD = 1.1;

/**
 * The ball's path as All-22 tells it. The broadcast view's path (`buildPath`) is the same ball, but a dropback there
 * goes straight from the drop to the throw or the sack: from above, routes need time to run. So a pass waits in the
 * pocket after the drop (longer for a deeper throw), a sack holds before the rush gets home, and a scramble holds
 * before the quarterback takes off. Every dropback here is: drop, hold, then the throw, the run or the sack. A run is
 * the mesh, the press to the line while the back reads his blocks, then the burst.
 */
/**
 * A ball carrier's pace in the open, by how far he goes: a short gain is a back working through traffic; a long one
 * is a breakaway, at the speed the pursuit can't match (yards a second).
 */
export const runPace = (yards: number) => Math.min(9.3, 6.5 + yards * 0.05);
/**
 * A long gain someone runs down from behind: the carrier is a step slower than a breakaway's, so the man who catches
 * him can (a touchdown keeps the breakaway's pace).
 */
const CAUGHT_PACE = 8.4;
/** A carrier's leg on the ground at his pace. */
const carry = (sg: Seg, caught = false): Seg => {
  const l = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0);
  return { ...sg, dur: Math.max(0.3, l / Math.min(caught ? CAUGHT_PACE : Infinity, runPace(l))) };
};

export function stagedPath(e: PlayLogEntry, homeId: number, snapY: number, receiverAt?: Pt): Seg[] {
  // A flag before the snap: no play, nothing moves (the walk-off is the official's, between plays).
  if (e.kind === 'penalty') return [];
  const segs = buildPath(e, homeId, snapY);
  if (!segs.length || e.from === undefined || e.to === undefined) return segs;
  const dir = offenseSide(e, homeId) === 0 ? 1 : -1;
  const caught = !/TOUCHDOWN/.test(e.text);
  if (e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int') {
    const drop = segs[0];
    let air = segs[1];
    // A catch the log gives no air yards for (a screen, a flat): the broadcast view throws it at the sideline; here it
    // goes to the receiver where the play went across the field, and he runs on from there.
    if (air && e.air === undefined && e.kind !== 'incomplete') {
      const y = Math.max(4, Math.min(FIELD_W - 4, snapY + (e.lane ?? 0) * dir * 16));
      air = { ...air, y1: y };
      if (segs[2]) segs[2] = { ...segs[2], y0: y };
    }
    const depth = air ? Math.abs(air.x1 - air.x0) : 10;
    // In the pocket until the route has had time to get there: the receiver's run from the line to the catch, up to
    // speed and then at it, less the drop and the ball's flight. A deep shot is a long hold, as it is on Sundays.
    // From where he lined up when that's known (a crosser has the width of the field to run, too), else the depth.
    const route = !air
      ? 0
      : receiverAt
        ? // His route has a stem and a break: a little longer than the straight line.
          Math.hypot(air.x1 - receiverAt.x, air.y1 - receiverAt.y) * 1.1
        : Math.abs(air.x1 - (e.from ?? air.x0));
    const run = route < 3 ? route / 4 : 0.75 + (route - 3) / ROUTE_PACE;
    const wait = run - drop.dur - (air?.dur ?? 0);
    return [
      drop,
      hold({ x: drop.x1, y: drop.y1 }, Math.max(0.8, Math.min(3.4, Math.max(0.7 + depth * 0.035, wait)))),
      air,
      // After the catch (or the pick): a runner's pace, not the broadcast view's slide.
      ...segs.slice(2).map((sg) => carry(sg, caught)),
    ].filter((sg): sg is Seg => !!sg);
  }
  const len = (sg: Seg) => Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0);
  /** A return: a back's pace, not the broadcast view's quick slide. */
  const returnPace = (sg: Seg): Seg => ({ ...sg, dur: Math.max(0.4, len(sg) / 7 + 0.2) });
  if (e.kind === 'kickoff') {
    const a = segs.findIndex((sg) => sg.peak > 0);
    if (a < 0) return segs;
    // On the tee while the kicker runs up, then the hang time, then the return.
    const tee = { x: segs[a].x0, y: segs[a].y0 };
    const flight = { ...segs[a], dur: Math.max(3.2, Math.min(4, len(segs[a]) / 17)) };
    return [hold(tee, KICK_RUN_UP), flight, ...segs.slice(a + 1).map(returnPace)];
  }
  if (e.kind === 'punt') {
    const a = segs.findIndex((sg) => sg.peak > 0);
    if (a < 1) return segs.map(returnPace); // blocked: no flight
    const snap = { ...segs[0], dur: 0.75 };
    const flight = { ...segs[a], dur: Math.max(3.4, Math.min(4.6, len(segs[a]) / 11)) };
    return [snap, hold({ x: snap.x1, y: snap.y1 }, 0.45), flight, ...segs.slice(a + 1).map(returnPace)];
  }
  if (e.kind === 'fg' || e.kind === 'xp') {
    // The snap back to the holder, the hold, then the kick. The engine logs a field goal from the holder's spot and
    // an extra point from the line, so both are read as kicked from seven yards behind the line.
    const logged = segs[0];
    const kick = e.kind === 'xp' ? { ...logged, x0: logged.x0 - dir * 7 } : logged;
    const line = { x: kick.x0 + dir * 7, y: kick.y0 };
    return [
      { x0: line.x, y0: line.y, x1: kick.x0, y1: kick.y0, peak: 0, dur: 0.4 },
      hold({ x: kick.x0, y: kick.y0 }, 0.35),
      { ...kick, dur: 1.3 },
    ];
  }
  if (e.kind === 'run' && segs.length === 2) {
    // The mesh, then the back presses the line reading his blocks, then bursts through the hole.
    const hand = { x: segs[0].x1, y: segs[0].y1 };
    const end = { x: segs[1].x1, y: segs[1].y1 };
    // To the line and a step past it while the hole opens (a few yards at most: a long run bursts from there).
    const k = Math.min(0.35, 4 / Math.max(1, Math.abs(end.x - hand.x)));
    const press = { x: hand.x + (end.x - hand.x) * k, y: hand.y + (end.y - hand.y) * Math.min(0.5, k * 1.4) };
    const len = (p: { x: number; y: number }, q: { x: number; y: number }) => Math.hypot(q.x - p.x, q.y - p.y);
    return [
      { ...segs[0], dur: MESH },
      { x0: hand.x, y0: hand.y, x1: press.x, y1: press.y, peak: 0, dur: Math.max(0.9, len(hand, press) / 4.5 + 0.5) },
      carry({ x0: press.x, y0: press.y, x1: end.x, y1: end.y, peak: 0, dur: 0 }, caught),
    ];
  }
  if (e.kind === 'sack' || e.kind === 'scramble') {
    const qb = { x: e.from - dir * 6, y: snapY };
    const end = segs[segs.length - 1];
    return [
      ground(e.from, snapY, qb.x, qb.y, 0.8),
      hold(qb, e.kind === 'sack' ? SACK_HOLD : SCRAMBLE_HOLD),
      e.kind === 'scramble' ? carry(ground(qb.x, qb.y, end.x1, end.y1), caught) : ground(qb.x, qb.y, end.x1, end.y1),
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
  /**
   * The tackler when nothing else is scripted for him: he plays his own part (rush, drop, cover, run down on a kick)
   * and then runs the play down, steered, rather than sliding to the spot; only his final step is scripted.
   */
  pursuer: number | null;
  /** When the ball leaves the quarterback's hands (the throw or the handoff): the defense reacts from then. */
  release: number;
  /** A kick: when it comes down to the returner. */
  catchAt?: number;
  /**
   * When each featured man's moment comes (the handoff, the throw, the catch, the sack, the tackle), from the snap: he's
   * ringed from just before it. A scripted man with no moment (the quarterback handing off) isn't featured.
   */
  moments: Map<number, number>;
  /** When a featured man's part is over and his ring goes (the quarterback once his pass arrives); absent: never. */
  until: Map<number, number>;
  /** Scripted men let go after their part (`SteerArgs.free`): the cover man on a catch, from the catch. */
  free: Map<number, number>;
}

export function script(
  e: PlayLogEntry,
  cast: Cast,
  start: ReadonlyMap<number, Pt>,
  segs: readonly Seg[],
  dir: 1 | -1,
): Scripted {
  const keys = new Map<number, Keyframe[]>();
  const moments = new Map<number, number>();
  const free = new Map<number, number>();
  const until = new Map<number, number>();
  if (!segs.length) return { keys, carrier: null, tackler: null, pursuer: null, release: 0, moments, until, free };
  /** His moment: the first that comes, if he has two (a cover man who makes the tackle). */
  const moment = (id: number | undefined, t: number) => {
    if (id !== undefined && keys.has(id)) moments.set(id, Math.min(t, moments.get(id) ?? Infinity));
  };
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
  let kickAt: number | undefined;
  let catchAt: number | undefined;

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
      // The handoff is the back's moment; the quarterback is only featured when he keeps it.
      moment(carrier, ts[0][1]);
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
        moment(who.rush, total * 0.6);
      }
      // A sack's moment is the rush getting home; a scramble's, breaking out of the pocket.
      moment(qb, e.kind === 'sack' ? total * 0.6 : e.kind === 'scramble' ? (ts[1]?.[1] ?? 0) : 0);
      break;
    case 'kickoff':
    case 'punt':
    case 'fg':
    case 'xp': {
      const a = segs.findIndex((sg) => sg.peak > 0);
      if (a < 0) break;
      const [kickT, landT] = ts[a];
      const tee = pointAt(segs[a], 0);
      const land = pointAt(segs[a], 1);
      const kicker = cast.offense.find((m) => m.role === (e.kind === 'punt' ? 'P' : 'K'))?.id;
      if (kicker !== undefined) {
        const s0 = start.get(kicker)!;
        if (e.kind === 'kickoff')
          // The run-up to the tee, then down the field behind the coverage.
          set(kicker, [at(kickT, tee), at(total, { x: tee.x + dir * 12, y: tee.y })]);
        else if (e.kind === 'punt') set(kicker, [at(kickT, s0), at(total, { x: s0.x + dir * 4, y: s0.y })]);
        else set(kicker, [at(kickT, toward(tee, s0, 0.8)), at(total, toward(tee, s0, 0.5))]);
      }
      const ret = cast.defense.find((m) => m.role === 'RET')?.id;
      if (ret !== undefined && (e.kind === 'kickoff' || e.kind === 'punt')) {
        // Under the ball as it comes down, then the return (a touchback or a fair catch ends there).
        set(ret, [at(landT, land), ...ride(segs, a + 1, segs.length - 1)]);
        if (segs.length > a + 1) carrier = ret;
      }
      moment(kicker, kickT);
      // A kickoff or a punt is the returner's once it comes down; a kick at the posts stays the kicker's.
      if (kicker !== undefined && (e.kind === 'kickoff' || e.kind === 'punt')) until.set(kicker, landT);
      moment(ret, landT);
      kickAt = kickT;
      catchAt = landT;
      break;
    }
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
        // Each leg in its share of the time, so he runs it at one pace (a crosser's break is the long leg).
        const legs = [Math.hypot(stem.x - s0.x, stem.y - s0.y), Math.hypot(arrive.x - stem.x, arrive.y - stem.y)];
        const split = legs[0] + legs[1] > 0 ? legs[0] / (legs[0] + legs[1]) : 0.55;
        set(target, [at(throwEnd * Math.max(0.3, Math.min(0.75, split)), stem), at(throwEnd, arrive), ...after]);
        if (e.kind === 'pass') carrier = target;
        moment(target, ts[1]?.[1] ?? 0);
      }
      moment(qb, ts[1]?.[1] ?? 0);
      // The throw is his; once it arrives the play is the receiver's (or the man who picked it off).
      if (qb !== undefined) until.set(qb, throwEnd);
      if (e.kind === 'int' && who.take !== undefined && start.has(who.take)) {
        set(who.take, [at(throwEnd, land), ...ride(segs, 3, segs.length - 1)]);
        carrier = who.take;
        moment(who.take, throwEnd);
      }
      if (who.cover !== undefined && who.cover !== who.take && start.has(who.cover)) {
        // Trailing the receiver: a yard and a half deeper than the catch (under it on a miss). Beaten on a catch, he
        // chases from there on his own legs (`free`), not sliding along at the receiver's back.
        const trail = e.kind === 'incomplete' ? 0.7 : 1.5;
        const spot = { x: land.x + dir * trail, y: land.y };
        set(who.cover, [at(throwEnd, spot)]);
        if (e.kind === 'pass') free.set(who.cover, throwEnd);
        moment(who.cover, throwEnd);
      }
      break;
    }
  }

  // The tackler meets the carrier at the whistle, from the side he came.
  let tacklerId: number | null = null;
  let pursuer: number | null = null;
  const kickReturn = catchAt !== undefined;
  if (
    carrier !== undefined &&
    !touchdown &&
    (TACKLED.has(e.kind ?? '') || kickReturn || (e.kind === 'int' && who.tackle !== undefined))
  ) {
    // The coverage tackles a returner; the offense tackles a man who picked it off.
    const side =
      e.kind === 'int' || kickReturn ? cast.offense.filter((m) => m.role !== 'K' && m.role !== 'P') : cast.defense;
    let tackler = who.tackle !== undefined && start.has(who.tackle) && who.tackle !== carrier ? who.tackle : undefined;
    if (tackler === undefined && (e.kind !== 'int' || kickReturn)) {
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
      // On a kickoff he's set with the rest until the ball comes down, then he takes his angle on the returner.
      const set = e.kind === 'kickoff' && catchAt !== undefined && catchAt + 0.2 < total ? [at(catchAt + 0.2, s0)] : [];
      keys.set(tackler, [from(tackler), ...set, ...before.filter((k) => k.t > 0), at(total, toward(end, s0, 0.6))]);
      tacklerId = tackler;
      // Nothing else scripted for him, or his part over well before the tackle (the cover man beaten on the catch, the
      // receiver a pass was picked off from): he runs the carrier down himself from there.
      const done = before.length ? before[before.length - 1].t : 0;
      if (total - done > 0.5) {
        pursuer = tackler;
        if (done > 0) free.set(tackler, done);
        else free.delete(tackler);
      }
      moment(tackler, total);
    }
  }
  // When the defense reads the ball out: the handoff, the throw (after the pocket), the scramble breaking out. A sack
  // never releases: the rush is on the quarterback and the coverage stays on the routes the whole play.
  const release =
    kickAt !== undefined
      ? kickAt
      : e.kind === 'run'
        ? ts[0][1]
        : e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int' || e.kind === 'scramble'
          ? (ts[1]?.[1] ?? 0)
          : e.kind === 'sack'
            ? Infinity
            : 0;
  return {
    keys,
    carrier: carrier ?? null,
    tackler: tacklerId,
    pursuer,
    release,
    moments,
    until,
    free,
    ...(catchAt !== undefined ? { catchAt } : {}),
  };
}
