/**
 * The players a play was about, scripted to the engine's result: whoever has the ball is wherever the ball is, the
 * target meets the throw, the cover man trails him, the rusher gets home, the tackler meets the carrier at the end
 * spot. Timing comes from the ball's own path (`buildPath`), so both views tell the same play. Everyone else steers
 * (`steer.ts`).
 */
import { actorsIn } from '../../engine/playActors';
import type { PlayLogEntry } from '../../engine/types';
import { basePath, carried, FIELD_W, ground, loosen, offenseSide, pointAt, type Seg } from './ballPath';
import type { Cast } from './cast';
import { fumbleIn, HOP_PEAK } from './fumble';
import { FAKE, type PocketPlan } from './pocket';
import { decoyEnd, type Assignment, type Concept } from './concepts';
import { routeKeys, routeTime, type RouteId } from './routes';

/** The pass's pattern (`concepts.ts`): the target's route, everyone else's, which way is in for each, their speeds. */
export interface Pattern {
  route: RouteId;
  concept: Concept;
  assigned: ReadonlyMap<number, Assignment | undefined>;
  inward: ReadonlyMap<number, 1 | -1>;
  top: ReadonlyMap<number, number>;
  /** How far the man in coverage is from the target as the ball gets there (yards; NGS's separation at the target). */
  separation: number;
}
/** A decoy runs his route at this pace (or his top speed, if lower). */
const DECOY_PACE = 8.5;
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
/** The engine's beaten block is acted out when the two lined up within this many yards of each other across the field. */
export const BEAT_ACROSS = 6;
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

/**
 * `pocket`: the quarterback's keyframes from the snap to the throw, the sack or a scramble's break (`pocketPath`); the
 * ball rides with him. Without it (a caller with no cast), the drop and a hold sized to the route.
 */
export function stagedPath(
  e: PlayLogEntry,
  homeId: number,
  snapY: number,
  receiverAt?: Pt,
  pocket?: readonly Keyframe[],
): Seg[] {
  // A fumble: the play staged as carried to where the ball came out, then the loose ball (`loosen`), its legs run at a
  // ball carrier's pace (a tackled one's: someone brings the returner down, or he scores).
  return loosen(e, stageCarried(carried(e), homeId, snapY, receiverAt, pocket), (sg) => carry(sg, true));
}

/**
 * A pass's time in the air, by how far it goes: about a second at 20 yards, two at 45 (a deep ball is lofted). The
 * broadcast view keeps its own quicker flight.
 */
export const passFlight = (yards: number) => 0.3 + yards * 0.037;

/** The ball's flight to the catch, and the run the target needs to get there (seconds from the snap). */
function flightAndRoute(e: PlayLogEntry, homeId: number, snapY: number, receiverAt?: Pt) {
  const segs = basePath(carried(e), homeId, snapY);
  const dir = offenseSide(e, homeId) === 0 ? 1 : -1;
  let air: Seg | undefined = segs[1];
  // A catch the log gives no air yards for (a screen, a flat): the broadcast view throws it at the sideline; here it
  // goes to the receiver where the play went across the field, and he runs on from there.
  if (air && e.air === undefined && e.kind !== 'incomplete') {
    const y = Math.max(4, Math.min(FIELD_W - 4, snapY + (e.lane ?? 0) * dir * 16));
    air = { ...air, y1: y };
  }
  // The receiver's run from the line to the catch, up to speed and then at it. From where he lined up when that's
  // known (a crosser has the width of the field to run, too), else the depth.
  const route = !air
    ? 0
    : receiverAt
      ? // His route has a stem and a break: a little longer than the straight line.
        Math.hypot(air.x1 - receiverAt.x, air.y1 - receiverAt.y) * 1.1
      : Math.abs(air.x1 - (e.from ?? air.x0));
  const run = route < 3 ? route / 4 : 0.75 + (route - 3) / ROUTE_PACE;
  if (air) air = { ...air, dur: passFlight(Math.hypot(air.x1 - air.x0, air.y1 - air.y0)) };
  return { segs, air, run };
}

/** Where a pass is caught (or comes down), as All-22 throws it: null on anything but a throw. */
export function catchSpot(e: PlayLogEntry, homeId: number, snapY: number): Pt | null {
  if (e.kind !== 'pass' && e.kind !== 'incomplete' && e.kind !== 'int') return null;
  const { air } = flightAndRoute(e, homeId, snapY);
  return air ? { x: air.x1, y: air.y1 } : null;
}

/** The earliest the ball can leave for the target's route to reach the catch as it does (0 on anything but a throw). */
export function throwWindow(e: PlayLogEntry, homeId: number, snapY: number, receiverAt?: Pt): number {
  if (e.kind !== 'pass' && e.kind !== 'incomplete' && e.kind !== 'int') return 0;
  const { air, run } = flightAndRoute(e, homeId, snapY, receiverAt);
  return Math.max(0, run - (air?.dur ?? 0));
}

/** A path of keyframes after the snap as the ball's legs, from where it's snapped: the ball rides in his hands. */
const legs = (from: Pt, keys: readonly Keyframe[]): Seg[] =>
  keys.map((k, i) => {
    const a = i ? keys[i - 1] : { t: 0, ...from };
    return { x0: a.x, y0: a.y, x1: k.x, y1: k.y, peak: 0, dur: k.t - a.t };
  });

function stageCarried(
  e: PlayLogEntry,
  homeId: number,
  snapY: number,
  receiverAt?: Pt,
  pocket?: readonly Keyframe[],
): Seg[] {
  // A flag before the snap: no play, nothing moves (the walk-off is the official's, between plays).
  if (e.kind === 'penalty') return [];
  const segs = basePath(e, homeId, snapY);
  if (!segs.length || e.from === undefined || e.to === undefined) return segs;
  const dir = offenseSide(e, homeId) === 0 ? 1 : -1;
  const caught = !/TOUCHDOWN/.test(e.text);
  if (e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int') {
    const drop = segs[0];
    const { air: aimed, run } = flightAndRoute(e, homeId, snapY, receiverAt);
    let air = aimed;
    if (air && segs[2] && air.y1 !== segs[1].y1) segs[2] = { ...segs[2], y0: air.y1 };
    if (pocket?.length && air) {
      // His pocket, then the throw from wherever it left him.
      const from = pocket[pocket.length - 1];
      air = { ...air, x0: from.x, y0: from.y, dur: passFlight(Math.hypot(air.x1 - from.x, air.y1 - from.y)) };
      return [...legs({ x: drop.x0, y: drop.y0 }, pocket), air, ...segs.slice(2).map((sg) => carry(sg, caught))];
    }
    const depth = air ? Math.abs(air.x1 - air.x0) : 10;
    // In the pocket until the route has had time to get there, less the drop and the ball's flight. A deep shot is a
    // long hold, as it is on Sundays.
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
    if (/kicks off out of bounds/.test(e.text)) {
      // Out of bounds: the kick hooks over a sideline deep in the receiving half (the ball's placed at the 40 after).
      const tee = { x: segs[a].x0, y: segs[a].y0 };
      const side = (e.from ?? 0) % 2 === 0 ? -1.5 : FIELD_W + 1.5;
      const out = { ...segs[a], x1: Math.max(-5, Math.min(105, tee.x + dir * 52)), y1: side, dur: 3.4 };
      return [hold(tee, KICK_RUN_UP), out];
    }
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
    const end = segs[segs.length - 1];
    if (pocket?.length) {
      // His pocket, then the break (a scramble, at a runner's pace) or the rush taking him down.
      const from = pocket[pocket.length - 1];
      const out = ground(from.x, from.y, end.x1, end.y1);
      return [...legs({ x: e.from, y: snapY }, pocket), e.kind === 'scramble' ? carry(out, caught) : out];
    }
    const qb = { x: e.from - dir * 6, y: snapY };
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
  /** A fumble: when and where the ball came out, when it settled, and who recovered it. */
  loose?: { t: number; x: number; y: number; settle: number; by: number };
  /** Decoys let go at the end of their routes, and where they settle (`SteerArgs.settle`). */
  settle: Map<number, Pt>;
  /** A screen's other receivers, who block the nearest defensive back. */
  stalk: Set<number>;
}

export function script(
  e: PlayLogEntry,
  cast: Cast,
  start: ReadonlyMap<number, Pt>,
  segs: readonly Seg[],
  dir: 1 | -1,
  /** A dropback's pocket (`pocket.ts`): play action sends the back on a fake. */
  pocket?: PocketPlan | null,
  /** A pass's routes (`concepts.ts`). */
  pattern?: Pattern,
): Scripted {
  const keys = new Map<number, Keyframe[]>();
  const moments = new Map<number, number>();
  const free = new Map<number, number>();
  const until = new Map<number, number>();
  const settle = new Map<number, Pt>();
  const stalk = new Set<number>();
  if (!segs.length)
    return { keys, carrier: null, tackler: null, pursuer: null, release: 0, moments, until, free, settle, stalk };
  /** His moment: the first that comes, if he has two (a cover man who makes the tackle). */
  const moment = (id: number | undefined, t: number) => {
    if (id !== undefined && keys.has(id)) moments.set(id, Math.min(t, moments.get(id) ?? Infinity));
  };
  const ts = times(segs);
  const total = ts[ts.length - 1][1];
  /** The throw: the first leg that flies (not a fumble's hops). */
  const airIdx = segs.findIndex((sg) => sg.peak > HOP_PEAK);
  const passing = e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int';
  /** When the ball leaves the quarterback's hands: the throw, or a scramble's break out of the pocket. */
  const outT = e.kind === 'scramble' ? ts[ts.length - 1][0] : passing && airIdx > 0 ? ts[airIdx][0] : (ts[1]?.[1] ?? 0);
  const end = pointAt(segs[segs.length - 1], 1);
  const who = actorsIn(e);
  const qb = cast.offense.find((m) => m.role === 'QB')?.id;
  const from = (id: number): Keyframe => at(0, start.get(id)!);
  const set = (id: number | undefined, ks: Keyframe[]) => {
    if (id === undefined || !start.has(id)) return;
    keys.set(id, [from(id), ...ks.filter((k) => k.t > 0)]);
  };
  /**
   * The blocker the engine says the rush beat, where he lined up: only when the formation put the two near each other
   * (a rusher crossing the whole formation to beat a man on the far side would be a picture of nothing).
   */
  const beatenNear = (id: number | undefined, rusher: Pt): Pt | undefined => {
    const b = id === undefined ? undefined : start.get(id);
    return b && Math.abs(b.y - rusher.y) <= BEAT_ACROSS ? b : undefined;
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
      // A sack: home as his pocket ends (`sackTime`), then the two of them go down together on the spot.
      const contact = e.kind === 'sack' ? (pocket ? ts[ts.length - 1][0] : total * 0.6) : 0;
      if (e.kind === 'sack' && who.rush !== undefined && start.has(who.rush) && qb !== undefined) {
        // Past the man he beat (or straight in), onto the quarterback where he is, and with him to the ground.
        const s0 = start.get(who.rush)!;
        const qbAt = (t: number) => sample(keys.get(qb)!, t);
        const beat = beatenNear(who.beat, s0);
        const mid: Keyframe[] = beat ? [at(contact * 0.6, toward(beat, qbAt(contact * 0.6), 1))] : [];
        set(who.rush, [...mid, at(contact, toward(qbAt(contact), s0, 0.8)), at(total, toward(end, s0, 0.6))]);
        moment(who.rush, Math.max(0, contact - 0.4));
      }
      // A sack's moment is the rush getting home; a scramble's, breaking out of the pocket.
      moment(qb, e.kind === 'sack' ? contact : e.kind === 'scramble' ? outT : 0);
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
      // His pocket, then the throw (`stagedPath`).
      const a = airIdx > 0 ? airIdx : 2;
      if (qb !== undefined) set(qb, ride(segs, 0, a - 1));
      const throwEnd = segs[a] ? ts[a][1] : total;
      const land = segs[a] ? pointAt(segs[a], 1) : end;
      const target = who.ball;
      if (target !== undefined && start.has(target)) {
        const s0 = start.get(target)!;
        // His route to the ball, arriving as it does (a step short of a pick or a miss).
        const short = e.kind === 'pass' ? 0 : e.kind === 'int' ? 1.5 : 0.7;
        const arrive = short ? toward(land, s0, short) : land;
        const after = e.kind === 'pass' ? ride(segs, a + 1, segs.length - 1) : [];
        if (pattern) {
          const inward = pattern.inward.get(target) ?? 1;
          set(target, [
            ...routeKeys(pattern.route, s0, arrive, throwEnd, dir, inward, pattern.top.get(target) ?? 9),
            ...after,
          ]);
        } else {
          // No pattern (a caller with no cast): a stem upfield, then the break to the ball, each leg in its share of
          // the time so he runs it at one pace.
          const stem = { x: s0.x + (arrive.x - s0.x) * 0.6, y: s0.y + (arrive.y - s0.y) * 0.25 };
          const legs = [Math.hypot(stem.x - s0.x, stem.y - s0.y), Math.hypot(arrive.x - stem.x, arrive.y - stem.y)];
          const split = legs[0] + legs[1] > 0 ? legs[0] / (legs[0] + legs[1]) : 0.55;
          set(target, [at(throwEnd * Math.max(0.3, Math.min(0.75, split)), stem), at(throwEnd, arrive), ...after]);
        }
        if (e.kind === 'pass') carrier = target;
        moment(target, outT);
      }
      moment(qb, outT);
      // The rest of the pattern: each decoy runs his concept route at a decoy's pace, then is let go where it ends
      // (he settles there until the ball's out); a screen's other men block.
      if (pattern)
        for (const [id, job] of pattern.assigned) {
          if (job === undefined || id === target || id === who.beat || keys.has(id) || !start.has(id)) continue;
          if (job === 'block') {
            stalk.add(id);
            continue;
          }
          // The back sells the fake on play action, then is on his own.
          if (pocket?.playAction && cast.offense.find((m) => m.id === id)?.role === 'RB') continue;
          const s0 = start.get(id)!;
          const inward = pattern.inward.get(id) ?? 1;
          const top = Math.min(DECOY_PACE, pattern.top.get(id) ?? DECOY_PACE);
          const to = decoyEnd(job, s0, segs[0].x0, dir, inward);
          const t = routeTime(job, s0, to, dir, inward, top);
          set(id, routeKeys(job, s0, to, t, dir, inward, top));
          // Let go at his route's end, or when the ball gets there (a catch or a pick: everyone reacts).
          free.set(id, Math.min(t, throwEnd));
          settle.set(id, to);
        }
      const qbKeys = qb === undefined ? undefined : keys.get(qb);
      if (qbKeys && who.rush !== undefined && start.has(who.rush) && who.rush !== who.take && who.rush !== who.cover) {
        // Pressure: past the man he beat (or straight in), on the quarterback as the ball comes out, a hit on the
        // throw and no more (the engine called no sack); then he plays on. Off the edge he loops around his man's
        // outside shoulder and comes at the quarterback from beside and behind: why the quarterback climbs.
        const s0 = start.get(who.rush)!;
        const qbAt = (t: number) => sample(qbKeys, t);
        const beat = beatenNear(who.beat, s0);
        const ballY = segs[0].y0;
        const out = Math.sign(s0.y - ballY) || 1;
        const shift = (p: Pt, across: number, back: number): Pt => ({ x: p.x - dir * back, y: p.y + out * across });
        const edge = pocket?.pressure === 'edge';
        const beatAt = Math.min(outT * 0.55, outT - 1.2);
        const mid: Keyframe[] =
          beat && beatAt > 0.3 ? [at(beatAt, edge ? shift(beat, 1.5, 0.8) : toward(beat, qbAt(beatAt), 1))] : [];
        // Off the edge, a yard deeper than the quarterback and outside him as he starts to climb.
        const set0 = qbAt(outT - 0.7);
        set(who.rush, [
          ...mid,
          ...(edge ? [at(outT - 0.7, shift(set0, 2.5, 1))] : [at(outT - 0.3, toward(qbAt(outT - 0.3), s0, 1.8))]),
          at(outT, edge ? shift(qbAt(outT), 0.7, 0.7) : toward(qbAt(outT), s0, 1)),
          at(outT + 0.35, edge ? shift(qbAt(outT), 0.5, 0.4) : toward(qbAt(outT), s0, 0.7)),
        ]);
        free.set(who.rush, outT + 0.35);
        moment(who.rush, outT - 0.3);
      }
      // The throw is his; once it arrives the play is the receiver's (or the man who picked it off).
      if (qb !== undefined) until.set(qb, throwEnd);
      if (e.kind === 'int' && who.take !== undefined && start.has(who.take)) {
        set(who.take, [at(throwEnd, land), ...ride(segs, a + 1, segs.length - 1)]);
        carrier = who.take;
        moment(who.take, throwEnd);
      }
      if (who.cover !== undefined && who.cover !== who.take && start.has(who.cover)) {
        // As far off the receiver as the play's separation (NGS: about three yards at the target), on the side he
        // came from; without a pattern, a yard and a half deeper (under it on a miss). Beaten on a catch, he chases from
        // there on his own legs (`free`), not sliding along at the receiver's back.
        const sep = pattern?.separation;
        const spot =
          sep !== undefined
            ? toward(land, start.get(who.cover)!, sep)
            : { x: land.x + dir * (e.kind === 'incomplete' ? 0.7 : 1.5), y: land.y };
        set(who.cover, [at(throwEnd, spot)]);
        if (e.kind === 'pass') free.set(who.cover, throwEnd);
        moment(who.cover, throwEnd);
      }
      break;
    }
  }

  // Play action: the back meets the quarterback at the mesh and carries the fake into the line, then blocks or leaks
  // out on his own (steered from there).
  const qbKeys = qb === undefined ? undefined : keys.get(qb);
  const back = cast.offense.find((m) => m.role === 'RB' && m.id !== who.ball && !keys.has(m.id));
  if (pocket?.playAction && qbKeys && back && start.has(back.id)) {
    const b0 = start.get(back.id)!;
    const mesh = sample(qbKeys, FAKE);
    const side = Math.sign(b0.y - segs[0].y0) || 1;
    keys.set(back.id, [
      from(back.id),
      at(FAKE, { x: mesh.x + dir * 0.4, y: mesh.y + side * 0.9 }),
      at(FAKE + 0.7, { x: mesh.x + dir * 3.5, y: mesh.y + side * 1.5 }),
    ]);
    free.set(back.id, FAKE + 0.7);
  }

  // A fumble: the man with the ball goes down where it comes out, with the man who hit him; the ball bounces to the man
  // who recovers it (the engine's on a lost one; on a kept one he falls on it himself), and a lost one is returned.
  const f = fumbleIn(e);
  let loose: Scripted['loose'];
  let returned = false;
  const first = segs.findIndex((sg) => sg.peak > 0 && sg.peak <= HOP_PEAK);
  if (f && carrier !== undefined && first > 0) {
    let lastHop = first;
    while (lastHop + 1 < segs.length && segs[lastHop + 1].peak > 0) lastHop++;
    const [tHit] = ts[first];
    const tSettle = ts[lastHop][1];
    const hit = pointAt(segs[first], 0);
    const settle = pointAt(segs[lastHop], 1);
    const fumbler = carrier;
    const upTo = (id: number, t: number) => (keys.get(id) ?? [from(id)]).filter((k) => k.t < t);
    // Whoever hit him: the tackler on a run or a catch, the sacker on a strip-sack. He's on the move from the
    // release (or his own part), and meets him as the ball comes out.
    const hitter = e.kind === 'sack' ? who.rush : who.tackle;
    const release = e.kind === 'run' ? ts[0][1] : e.kind === 'sack' ? 0 : outT;
    const onTheMove = (id: number, t: number): Keyframe[] =>
      keys.has(id) ? upTo(id, t) : [from(id), at(Math.min(release, t - 0.3), start.get(id)!)];
    if (hitter !== undefined && hitter !== fumbler && start.has(hitter)) {
      keys.set(hitter, [
        ...onTheMove(hitter, tHit),
        at(tHit, toward(hit, start.get(hitter)!, 0.6)),
        at(total, toward(hit, start.get(hitter)!, 0.6)),
      ]);
      moment(hitter, tHit);
    }
    const by = f.lost ? who.take : fumbler;
    if (by !== undefined && start.has(by)) {
      const back = f.lost ? ride(segs, lastHop + 1, segs.length - 1) : [];
      if (by === fumbler) keys.set(by, [...upTo(by, tHit), at(tHit, hit), at(tSettle, settle), ...back]);
      else {
        // Already the hitter: he goes from the hit to the ball. Else he comes in from the play as the ball settles.
        const s0 = start.get(by)!;
        const lead =
          by === hitter
            ? keys.get(by)!.filter((k) => k.t <= tHit)
            : [...onTheMove(by, tHit), at(tHit, toward(hit, s0, 2.5))];
        keys.set(by, [...lead, at(tSettle, settle), ...back]);
        // The man who fumbled stays down where it came out.
        keys.set(fumbler, [...upTo(fumbler, tHit), at(tHit, hit), at(total, hit)]);
      }
      moment(by, tSettle);
      carrier = by;
      returned = back.length > 0;
      loose = { t: tHit, x: hit.x, y: hit.y, settle: tSettle, by };
    }
  }

  // The tackler meets the carrier at the whistle, from the side he came.
  let tacklerId: number | null = null;
  let pursuer: number | null = null;
  const kickReturn = catchAt !== undefined;
  // A fumble's tackle was the hit: only a lost one's return is run down, and not into the end zone.
  const scores = e.to !== undefined && (e.to < 0 || e.to > 100);
  if (
    carrier !== undefined &&
    !touchdown &&
    (loose
      ? returned && !scores
      : TACKLED.has(e.kind ?? '') || kickReturn || (e.kind === 'int' && who.tackle !== undefined))
  ) {
    // The coverage tackles a returner; the offense tackles a man who picked it off or picked a fumble up.
    const side =
      e.kind === 'int' || kickReturn || loose
        ? cast.offense.filter(
            (m) => m.role !== 'K' && m.role !== 'P' && m.id !== who.ball && keys.get(m.id) === undefined,
          )
        : cast.defense;
    let tackler =
      !loose && who.tackle !== undefined && start.has(who.tackle) && who.tackle !== carrier ? who.tackle : undefined;
    if (tackler === undefined && (e.kind !== 'int' || kickReturn || loose)) {
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
    loose && e.kind === 'sack'
      ? loose.t
      : kickAt !== undefined
        ? kickAt
        : e.kind === 'run'
          ? ts[0][1]
          : e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int' || e.kind === 'scramble'
            ? outT
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
    ...(loose ? { loose } : {}),
    settle,
    stalk,
  };
}
