/**
 * The players a play was about, scripted to the engine's result: whoever has the ball is wherever the ball is, the
 * target meets the throw, the cover man trails him, the rusher gets home, the tackler meets the carrier at the end
 * spot. Timing comes from the ball's own path (`buildPath`), so both views tell the same play. Everyone else steers
 * (`steer.ts`).
 */
import { actorsIn } from '../playActors';
import type { QuirkId } from '../quirks';
import { Rng } from '../rng';
import type { PlayLogEntry } from '../types';
import { basePath, carried, FIELD_W, ground, loosen, offenseSide, pointAt, type Seg } from './ballPath';
import type { Cast } from './cast';
import { fumbleIn, HOP_PEAK } from './fumble';
import { FAKE, PRESSURE_REACT, type PocketPlan } from './pocket';
import { runnable, SPEED } from './speed';
import { decoyEnd, type Assignment, type Concept } from './concepts';
import { routeKeys, routeTime, type RouteId } from './routes';
import { moveSegs, pickMove, type MoveKind } from './carrier';

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
import { isVictory, type Pt } from './formations';
import { ballTrack, BEAT_ACROSS, passFlight, sample, type Keyframe } from './keys';

export { ballTrack, BEAT_ACROSS, passFlight, sample, type Keyframe };

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
/** A rusher's get-off: at his man this long after the snap, before he fights him and wins. */
const ENGAGE = 0.45;
/** The victory formation: where he takes the snap, the step back, down on a knee by this long, held till the whistle. */
const QB_UNDER = 2;
/** The beaten back on play action plants this long at the mesh before he takes his man (seconds). */
const PLANT = 0.3;
const KNEEL_STEP = 0.8;
export const KNEEL_AT = 0.75;
const KNEEL_HOLD = 1.3;
/** Kickoff coverage: set up this far off the tee, then down the field at this pace once the ball's down (seconds to react). */
const KICKOFF_COVER = 25;
const COVER_PACE = 8;
const COVER_REACT = 0.4;
/** Running out the clock on fourth down: his pace back, yards a second. */
const RUN_OUT = 5;
/** A throwaway lands this far past the line, out of bounds. */
const THROWAWAY_DOWNFIELD = 12;
/** A sack's last stagger to the spot, yards a second at most. */
const SACK_PACE = 5;
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
/** A man running a carrier down closes this much quicker than the carrier runs (yards a second). */
const RUN_DOWN_EDGE = 1.6;
/**
 * A carrier's leg on the ground at his pace, never past his own legs (`top`: a tight end's breakaway is a tight
 * end's); one who's caught runs a step slower than the man who catches him (`chaser`'s top speed).
 */
const carry = (sg: Seg, caught = false, top = Infinity, chaser = Infinity): Seg => {
  const l = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0);
  const most = caught ? Math.min(CAUGHT_PACE, chaser - RUN_DOWN_EDGE) : Infinity;
  return { ...sg, dur: Math.max(0.3, l / Math.min(most, runPace(l), top)) };
};
/** The pace `carry` gives a leg of `l` yards, for a leg split into pieces that keep it. */
const carryPace = (l: number, caught: boolean, top: number, chaser: number) =>
  Math.min(caught ? Math.min(CAUGHT_PACE, chaser - RUN_DOWN_EDGE) : Infinity, runPace(l), top);
/** A ground leg at `pace`. */
const paced = (sg: Seg, pace: number): Seg => ({
  ...sg,
  // (No pace: a leg that goes nowhere keeps the time it was given.)
  dur: pace > 0 ? Math.max(0.05, Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0) / pace) : Math.max(0.05, sg.dur),
});
const NONE: ReadonlySet<QuirkId> = new Set();

/** A back crosses the line this long after the snap (seconds; NGS RBs 2022–24), give or take the spread. */
const TLOS = 2.78;
const TLOS_SPREAD = 0.25;
/** A patient presser takes this much longer to the line. */
const PATIENT = 0.3;
/** A back who dwells in the hole: this long (seconds), at a walk (yards a second; the spec's most is 3). */
const DWELL = 0.3;
const DWELL_PACE = 1.5;
/** A jet sweep's runner keeps at least this pace (yards a second) through the handoff. */
const JET_PACE = 5;
/** Without a hole from the blocking, the back presses at most this far across (yards). */
const PRESS_ACROSS = 4;
/** A bounce by a back who bounces outside goes this much wider (yards). */
const BOUNCE_WIDER = 2;
/** A jump cut is made this far past the line (yards), so its step back stays in front of it. */
const JUMP_PAST = 1.5;
/** A broken tackle on a run comes this many yards past the line. */
const MOVE_PAST = [4, 6] as const;
/** After the catch, an east-west runner's first moments: across, barely on (yards), and how long (seconds). */
const EAST_WEST = { across: 2.5, on: 0.5, t: 0.6 };
/** A return this long (yards) or a touchdown can show a miss, this often. */
const LONG_RETURN = 30;
const RETURN_MISS = 1 / 3;
/** A stuffed run: he's met this far short of the hole (yards), then driven to where he goes down at this pace. */
const MET_SHORT = 0.5;
const DRIVEN_PACE = 3;
const DRIVEN_T = 0.4;
/** The finish: the last yard, as a lunge forward or a slide into a hit a yard short (seconds). */
const LUNGE = 1;
const LUNGE_T = 0.35;
const SLIDE_T = 0.5;

/** What a caller with a cast knows about the play beyond its log (`stagePlay`); a caller without one passes none. */
export interface PathOpts {
  /** Where the target lined up. */
  receiverAt?: Pt;
  /**
   * The quarterback's keyframes from the snap to the throw, the sack or a scramble's break (`pocketPath`); the ball
   * rides with him. Without them, the drop and a hold sized to the route.
   */
  pocket?: readonly Keyframe[];
  /** The ball carrier's top speed, yards a second: no run of his is quicker. */
  top?: number;
  /** The tackler's top speed in pursuit: a carrier he runs down is a step slower. */
  chaser?: number;
  /** The play's seed: the run's timing and the move it shows are drawn on a stream of their own from it. */
  seed?: string;
  /** The habits the engine noted on the carrier, the man who missed and the tackler (`habits.ts`). */
  carrier?: ReadonlySet<QuirkId>;
  missed?: ReadonlySet<QuirkId>;
  tackler?: ReadonlySet<QuirkId>;
  /** Where the back presses on a run (`holeAt`); without it, a few yards across toward where the run went. */
  hole?: Pt;
  /** Where the man who missed lined up (the move goes away from him), and his top speed (it comes where he can get to). */
  missedAt?: Pt;
  missedTop?: number;
  /** A jet sweep: the runner is at speed from the snap through the handoff. */
  jet?: boolean;
}

export function stagedPath(e: PlayLogEntry, homeId: number, snapY: number, opts: PathOpts = {}): Seg[] {
  // A fumble: the play staged as carried to where the ball came out, then the loose ball (`loosen`), its legs run at a
  // ball carrier's pace (a tackled one's: someone brings the returner down, or he scores).
  return loosen(e, stageCarried(carried(e), homeId, snapY, opts, !!fumbleIn(e)), (sg) => carry(sg, true));
}

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

function stageCarried(e: PlayLogEntry, homeId: number, snapY: number, opts: PathOpts, fumbled: boolean): Seg[] {
  const { receiverAt, pocket } = opts;
  const top = opts.top ?? Infinity;
  const chaser = opts.chaser ?? Infinity;
  // A flag before the snap: no play, nothing moves (the walk-off is the official's, between plays).
  if (e.kind === 'penalty') return [];
  const segs = basePath(e, homeId, snapY);
  if (!segs.length || e.from === undefined || e.to === undefined) return segs;
  const dir = offenseSide(e, homeId) === 0 ? 1 : -1;
  const caught = !/TOUCHDOWN/.test(e.text);
  // The run's timing and the move, on a stream of their own (every draw always taken, so none shifts another).
  const rng = new Rng(`${opts.seed ?? e.text}:path`);
  const spread = (rng.next() * 2 - 1) * TLOS_SPREAD;
  const past = MOVE_PAST[0] + rng.next() * (MOVE_PAST[1] - MOVE_PAST[0]);
  const coin: 1 | -1 = rng.next() < 0.5 ? 1 : -1;
  const broke = e.open?.broke;
  const kind = broke ? pickMove(broke.how, opts.carrier ?? NONE, opts.missed ?? NONE, rng) : undefined;
  /**
   * A carry leg at `pace` starting `t0` seconds after the snap, split where the tackle's broken: `along` yards in, or
   * later if the man who missed can't get there by then on his legs; the move, then on to the leg's end.
   */
  const withMove = (leg: Seg, along: number, pace: number, t0: number): Seg[] => {
    const l = Math.hypot(leg.x1 - leg.x0, leg.y1 - leg.y0);
    if (!kind || l < 0.5) return [paced(leg, pace)];
    let g = Math.max(0, Math.min(0.9, along / l));
    const m0 = opts.missedAt;
    const legs = opts.missedTop;
    if (m0 && legs)
      for (; g < 0.9; g += 0.02) {
        const p = { x: leg.x0 + (leg.x1 - leg.x0) * g, y: leg.y0 + (leg.y1 - leg.y0) * g };
        if (Math.hypot(p.x - m0.x, p.y - m0.y) - 1 <= legs * (t0 + (g * l) / pace)) break;
      }
    const p = { x: leg.x0 + (leg.x1 - leg.x0) * g, y: leg.y0 + (leg.y1 - leg.y0) * g };
    const h = { x: (leg.x1 - leg.x0) / l, y: (leg.y1 - leg.y0) / l };
    // Away from the man who missed: to the side of the carrier's line he isn't on.
    const m = opts.missedAt;
    const his = m ? Math.sign(-h.y * (m.x - p.x) + h.x * (m.y - p.y)) : 0;
    const side: 1 | -1 = his > 0 ? -1 : his < 0 ? 1 : coin;
    const move = moveSegs(kind, p, h, pace, side);
    const after = move[move.length - 1];
    return [
      ...(g > 0 ? [paced({ ...leg, x1: p.x, y1: p.y }, pace)] : []),
      ...move,
      paced({ x0: after.x1, y0: after.y1, x1: leg.x1, y1: leg.y1, peak: 0, dur: 0 }, pace),
    ];
  };
  /** After the catch: a runner's pace; a broken tackle a few yards on (`min(4, 0.3 × yac)`). */
  const afterCatch = (rest: Seg[], segsBefore: readonly (Seg | undefined)[]): Seg[] => {
    if (!rest.length) return [];
    const [first, ...more] = rest;
    const l = Math.hypot(first.x1 - first.x0, first.y1 - first.y0);
    const pace = carryPace(l, caught, top, chaser);
    // (When the catch is made: the legs before this one.)
    const t0 = segsBefore.reduce((t, sg) => t + (sg?.dur ?? 0), 0);
    if (opts.carrier?.has('runsEastWest') && l > 3) {
      // East-west: his first moments after the catch go across the field (toward the middle), not up it.
      const toward = first.y0 < FIELD_W / 2 ? 1 : -1;
      const w = { x: first.x0 + dir * EAST_WEST.on, y: first.y0 + toward * EAST_WEST.across };
      const rest: Seg = { ...first, x0: w.x, y0: w.y };
      const rl = Math.hypot(rest.x1 - rest.x0, rest.y1 - rest.y0);
      return [
        { x0: first.x0, y0: first.y0, x1: w.x, y1: w.y, peak: 0, dur: EAST_WEST.t },
        ...withMove(rest, Math.min(4, 0.3 * rl), carryPace(rl, caught, top, chaser), t0 + EAST_WEST.t),
        ...more.map((sg) => carry(sg, caught, top, chaser)),
      ];
    }
    return [...withMove(first, Math.min(4, 0.3 * l), pace, t0), ...more.map((sg) => carry(sg, caught, top, chaser))];
  };
  /**
   * A long return (30 yards and more, or a touchdown): now and then a cover man is made to miss, at 40% of the way; never
   * more than one. Its own stream, both draws always taken.
   */
  const longReturn = (back: Seg[]): Seg[] => {
    const rr = new Rng(`${opts.seed ?? e.text}:return`);
    const chance = rr.next();
    const pick = rr.next();
    const total = back.reduce((t, sg) => t + Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0), 0);
    if (!back.length || (total < LONG_RETURN && !/TOUCHDOWN/.test(e.text)) || chance >= RETURN_MISS) return back;
    const mk: MoveKind = pick < 0.5 ? 'juke' : 'jumpCut';
    let along = total * 0.4;
    const out: Seg[] = [];
    let done = false;
    for (const sg of back) {
      const l = Math.hypot(sg.x1 - sg.x0, sg.y1 - sg.y0);
      if (done || along > l || l < 1) {
        along -= l;
        out.push(sg);
        continue;
      }
      done = true;
      const g = along / l;
      const p = { x: sg.x0 + (sg.x1 - sg.x0) * g, y: sg.y0 + (sg.y1 - sg.y0) * g };
      const h = { x: (sg.x1 - sg.x0) / l, y: (sg.y1 - sg.y0) / l };
      const pace = l / sg.dur;
      const move = moveSegs(mk, p, h, pace, pick < 0.25 || pick > 0.75 ? 1 : -1);
      const after = move[move.length - 1];
      out.push(
        ...(g > 0 ? [paced({ ...sg, x1: p.x, y1: p.y }, pace)] : []),
        ...move,
        paced({ x0: after.x1, y0: after.y1, x1: sg.x1, y1: sg.y1, peak: 0, dur: 0 }, pace),
      );
    }
    return out;
  };
  if (e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int') {
    const drop = segs[0];
    const { air: aimed, run } = flightAndRoute(e, homeId, snapY, receiverAt);
    let air = aimed;
    if (air && segs[2] && air.y1 !== segs[1].y1) segs[2] = { ...segs[2], y0: air.y1 };
    // Thrown away: past everyone, a dozen yards down and over the sideline the play went to.
    if (air && /throws it away/.test(e.text))
      air = { ...air, x1: e.from + dir * THROWAWAY_DOWNFIELD, y1: air.y1 > FIELD_W / 2 ? FIELD_W + 2.5 : -2.5 };
    if (pocket?.length && air) {
      // His pocket, then the throw from wherever it left him.
      const from = pocket[pocket.length - 1];
      air = { ...air, x0: from.x, y0: from.y, dur: passFlight(Math.hypot(air.x1 - from.x, air.y1 - from.y)) };
      const before = [...legs({ x: drop.x0, y: drop.y0 }, pocket), air];
      return [...before, ...afterCatch(segs.slice(2), before)];
    }
    const depth = air ? Math.abs(air.x1 - air.x0) : 10;
    // In the pocket until the route has had time to get there, less the drop and the ball's flight. A deep shot is a
    // long hold, as it is on Sundays.
    const wait = run - drop.dur - (air?.dur ?? 0);
    const before = [
      drop,
      hold({ x: drop.x1, y: drop.y1 }, Math.max(0.8, Math.min(3.4, Math.max(0.7 + depth * 0.035, wait)))),
      air,
    ];
    // After the catch (or the pick): a runner's pace, not the broadcast view's slide.
    return [...before, ...afterCatch(segs.slice(2), before)].filter((sg): sg is Seg => !!sg);
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
    // On the tee while the kicker runs up, then the hang time, then the return. The coverage sets up 25 yards off the
    // tee and may not move until the ball comes down, so the return lasts at least as long as their run to where it
    // ends (a short one is the returner picking his way while they close).
    const tee = { x: segs[a].x0, y: segs[a].y0 };
    const flight = { ...segs[a], dur: Math.max(3.2, Math.min(4, len(segs[a]) / 17)) };
    const back = segs.slice(a + 1).map(returnPace);
    if (back.length) {
      const coverX = tee.x + dir * KICKOFF_COVER;
      const ends = back[back.length - 1];
      const reach = Math.abs(ends.x1 - coverX) / COVER_PACE + COVER_REACT;
      const took = back.reduce((t, sg) => t + sg.dur, 0);
      if (took < reach) for (const sg of back) sg.dur *= reach / took;
    }
    return [hold(tee, KICK_RUN_UP), flight, ...longReturn(back)];
  }
  if (e.kind === 'punt') {
    const a = segs.findIndex((sg) => sg.peak > 0);
    if (a < 1) return segs.map(returnPace); // blocked: no flight
    const snap = { ...segs[0], dur: 0.75 };
    const flight = { ...segs[a], dur: Math.max(3.4, Math.min(4.6, len(segs[a]) / 11)) };
    return [snap, hold({ x: snap.x1, y: snap.y1 }, 0.45), flight, ...longReturn(segs.slice(a + 1).map(returnPace))];
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
    // The mesh, then the back presses the hole reading his blocks, crossing the line about 2.8 s after the snap (NGS),
    // then the cut and the burst.
    const hand = { x: segs[0].x1, y: segs[0].y1 };
    const end = { x: segs[1].x1, y: segs[1].y1 };
    const habit = (q: QuirkId) => !!opts.carrier?.has(q);
    const hole = opts.hole ?? {
      x: e.from,
      y: hand.y + Math.max(-PRESS_ACROSS, Math.min(PRESS_ACROSS, end.y - hand.y)),
    };
    const dist = (p: Pt, q: Pt) => Math.hypot(q.x - p.x, q.y - p.y);
    const mesh = { ...segs[0], dur: MESH };
    const press = TLOS + spread + (habit('patientPresser') ? PATIENT : 0) - MESH;
    // Stuffed at the line or behind it: he presses toward the hole and is met just short of it (a broken tackle on the
    // way, if he broke one), then he's driven to where he goes down.
    if ((end.x - e.from) * dir < 1) {
      const span = (hole.x - hand.x) * dir;
      const f = span > 0 ? Math.max(0.3, Math.min(1, (span - MET_SHORT) / span)) : 1;
      const met = { x: hand.x + (hole.x - hand.x) * f, y: hand.y + (hole.y - hand.y) * f };
      const d = dist(hand, met);
      const dur = Math.max(opts.jet ? d / JET_PACE : press * f, d / top, 0.3);
      const driven = dist(met, end);
      return [
        mesh,
        ...withMove({ x0: hand.x, y0: hand.y, x1: met.x, y1: met.y, peak: 0, dur }, d * 0.5, d / dur, MESH),
        // (The tackle is the meeting: he's hit there, and the two of them go on to where he's down.)
        {
          x0: met.x,
          y0: met.y,
          x1: end.x,
          y1: end.y,
          peak: 0,
          dur: Math.max(DRIVEN_T, driven / DRIVEN_PACE),
          ...(caught && !fumbled ? { hit: true as const } : {}),
        },
      ];
    }
    const out: Seg[] = [mesh];
    // A jet sweep is at speed through the handoff; a back presses at the pace that gets him there on time.
    const toHole = dist(hand, hole);
    const pressDur = opts.jet ? Math.min(press, toHole / JET_PACE) : press;
    out.push({ x0: hand.x, y0: hand.y, x1: hole.x, y1: hole.y, peak: 0, dur: Math.max(pressDur, toHole / top, 0.2) });
    let at: Pt = hole;
    const heading = (from: Pt) => {
      const l = dist(from, end) || 1;
      return { x: (end.x - from.x) / l, y: (end.y - from.y) / l };
    };
    if (habit('dwellsInHole')) {
      // A beat in the hole, waiting on a block, before he goes.
      const h = heading(at);
      const step = Math.min(DWELL * DWELL_PACE, dist(at, end) * 0.3);
      const to = { x: at.x + h.x * step, y: at.y + h.y * step };
      out.push({ x0: at.x, y0: at.y, x1: to.x, y1: to.y, peak: 0, dur: DWELL });
      at = to;
    }
    const L = dist(at, end);
    const pace = carryPace(L, caught, top, chaser);
    const cutBreaks = kind === 'jumpCut' && habit('jumpCutter') && L > 3;
    if (habit('jumpCutter') && L > 3) {
      // The cut at the hole is a jump cut (not a broken tackle: no one's beaten by it). He makes it just past the line:
      // made at the hole, its step back took him behind the line and he crossed it a second time at 3.75 s.
      if ((at.x - e.from) * dir < JUMP_PAST) {
        const through = { x: e.from + dir * JUMP_PAST, y: at.y };
        out.push(paced({ x0: at.x, y0: at.y, x1: through.x, y1: through.y, peak: 0, dur: 0 }, pace));
        at = through;
      }
      const h = heading(at);
      const across = Math.sign(-h.y * (end.x - hole.x) + h.x * (end.y - hole.y)) || coin;
      // With a tackle broken by a move, the cut is that move (`pickMove` gives a jump-cutter his cut): no second one
      // later, where a short carry would leave it no room.
      const cut = moveSegs('jumpCut', at, h, pace, across >= 0 ? 1 : -1).map((sg) =>
        cutBreaks ? sg : (({ move: _, ...rest }) => rest)(sg),
      );
      out.push(...cut);
      at = { x: cut[cut.length - 1].x1, y: cut[cut.length - 1].y1 };
    } else if (e.open?.bounce && habit('bouncesExternal')) {
      // A bounce that goes further outside before it turns up: a yard on, wider than his way to the end would have him
      // there (a run already headed outside drifts that far on its own; the bounce takes him past it).
      const out1 = Math.sign(hole.y - snapY) || coin;
      const h = heading(at);
      const drift = Math.max(0, (out1 * h.y) / Math.max(Math.abs(h.x), 0.33));
      const wide = {
        x: at.x + dir,
        y: Math.max(1, Math.min(FIELD_W - 1, at.y + out1 * (drift + BOUNCE_WIDER))),
      };
      out.push(paced({ x0: at.x, y0: at.y, x1: wide.x, y1: wide.y, peak: 0, dur: 0 }, pace));
      at = wide;
    }
    // The carry to the end: the broken tackle a few yards past the line, and the finish.
    const leg: Seg = { x0: at.x, y0: at.y, x1: end.x, y1: end.y, peak: 0, dur: 0 };
    const ahead = Math.max(0, past - (at.x - e.from) * dir);
    const carried = cutBreaks
      ? [paced(leg, pace)]
      : withMove(
          leg,
          ahead,
          pace,
          out.reduce((t, sg) => t + sg.dur, 0),
        );
    // The finish: a back who falls forward lunges the last yard as he's hit; one who shies from contact is hit a yard
    // short and slides into it; a thumper stops him where he hits him.
    const last = carried[carried.length - 1];
    const ll = Math.hypot(last.x1 - last.x0, last.y1 - last.y0);
    const averse = habit('contactAverse');
    const lunge =
      caught && !fumbled && ll > LUNGE + 0.3 && (averse || (!!e.open?.forward && !opts.tackler?.has('thumper')));
    if (lunge) {
      const g = (ll - LUNGE) / ll;
      const mid = { x: last.x0 + (last.x1 - last.x0) * g, y: last.y0 + (last.y1 - last.y0) * g };
      carried.splice(carried.length - 1, 1, paced({ ...last, x1: mid.x, y1: mid.y }, pace), {
        x0: mid.x,
        y0: mid.y,
        x1: last.x1,
        y1: last.y1,
        peak: 0,
        dur: averse ? SLIDE_T : LUNGE_T,
        hit: true,
      });
    }
    return [...out, ...carried];
  }
  if (isVictory(e)) {
    // The snap into his hands under center, a step back and down on a knee, and still until the whistle.
    const snap = { x: e.from, y: snapY };
    const hands = { x: e.from - dir * QB_UNDER, y: snapY };
    const knee = { x: e.from - dir * (QB_UNDER + KNEEL_STEP), y: snapY };
    return [
      { x0: snap.x, y0: snap.y, x1: hands.x, y1: hands.y, peak: 0, dur: 0.3 },
      { x0: hands.x, y0: hands.y, x1: knee.x, y1: knee.y, peak: 0, dur: KNEEL_AT - 0.3 },
      hold(knee, KNEEL_HOLD),
    ];
  }
  if (e.kind === 'kneel') {
    // On fourth down he rolls out and runs the clock out, a quarterback's drift back, not a dash.
    return segs.map((s) => ({ ...s, dur: Math.max(s.dur, Math.hypot(s.x1 - s.x0, s.y1 - s.y0) / RUN_OUT + 0.3) }));
  }
  if (e.kind === 'sack' || e.kind === 'scramble') {
    const end = segs[segs.length - 1];
    if (pocket?.length) {
      // His pocket, then the break (a scramble, at a runner's pace) or the rush taking him down.
      const from = pocket[pocket.length - 1];
      const out = ground(from.x, from.y, end.x1, end.y1);
      // Taken down: the two of them to the spot at a stagger's pace, not the broadcast view's slide.
      out.dur = Math.max(out.dur, Math.hypot(end.x1 - from.x, end.y1 - from.y) / SACK_PACE);
      return [...legs({ x: e.from, y: snapY }, pocket), e.kind === 'scramble' ? carry(out, caught, top, chaser) : out];
    }
    const qb = { x: e.from - dir * 6, y: snapY };
    return [
      ground(e.from, snapY, qb.x, qb.y, 0.8),
      hold(qb, e.kind === 'sack' ? SACK_HOLD : SCRAMBLE_HOLD),
      e.kind === 'scramble'
        ? carry(ground(qb.x, qb.y, end.x1, end.y1), caught, top, chaser)
        : ground(qb.x, qb.y, end.x1, end.y1),
    ];
  }
  return segs;
}

/**
 * On a breakaway the deepest safety comes up this far (yards) to fill and gets there a step late: this far behind the
 * carrier as he goes by, and this far off his line.
 */
const GONE_FILL = 4;
const GONE_BEHIND = 1.5;
const GONE_OFF = 1.5;
/** A return touchdown's last man gets this far off the returner's line (yards), a step behind him. */
const LAST_OFF = 1.5;

/** The tackler runs this much over his top speed in pursuit (`steer`'s edge): as quick as he ever gets. */
const PURSUIT = 0.6;

/**
 * His path up to the run into the hit at `t`: as it was until the latest moment he can still get to `hit` on his own
 * legs (`top`), then off it. Late off his part beats a run no man could make.
 */
function intoTheHit(way: readonly Keyframe[], hit: Pt, t: number, top: number, floor = 0): Keyframe[] {
  const upTo = way.filter((k) => k.t < t - 1e-6);
  if (!upTo.length) return [];
  const last = upTo[upTo.length - 1];
  if (Math.hypot(hit.x - last.x, hit.y - last.y) <= top * (t - last.t)) return upTo;
  for (let leave = last.t; leave >= floor; leave -= 0.05) {
    const p = sample(upTo, leave);
    if (Math.hypot(hit.x - p.x, hit.y - p.y) <= top * (t - leave))
      return [...upTo.filter((k) => k.t < leave - 1e-6), at(leave, p)];
  }
  return [at(0, upTo[0])];
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
  /** A sack: when the rusher's script has him past the man he beat (`SteerArgs.beatAt`). */
  beatAt?: number;
  /** A screen's other receivers, who block the nearest defensive back. */
  stalk: Set<number>;
  /** A finish where the tackle lands before the whistle (a lunge, a slide): when it lands. */
  hitAt?: number;
  /** The man made to miss (the engine's, or a long return's cover man): on the carrier as the move starts. */
  missed?: number;
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
  /** Blind to the result (the open field's approach): nobody is scripted to make the tackle. */
  blind = false,
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
  /** His top speed by his role on the field. */
  const topOf = (id: number) => SPEED[[...cast.offense, ...cast.defense].find((m) => m.id === id)?.role ?? 'WR'];
  /** A defender's scripted run: the spots on the way he can't reach in time dropped (`runnable`). */
  const setRun = (id: number, ks: Keyframe[]) => {
    if (start.has(id)) set(id, runnable(start.get(id)!, ks, topOf(id)));
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
  let beatAt: number | undefined;

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
      // The stagger to the spot is the last leg; on a strip-sack the ball's bounces come after it (`loosen`), so it's
      // the leg before the first hop.
      const hop = segs.findIndex((sg) => sg.peak > 0 && sg.peak <= HOP_PEAK);
      const stagger = hop > 0 ? hop - 1 : ts.length - 1;
      const contact = e.kind === 'sack' ? (pocket ? ts[stagger][0] : total * 0.6) : 0;
      if (e.kind === 'sack' && who.rush !== undefined && start.has(who.rush) && qb !== undefined) {
        // Past the man he beat (or straight in), onto the quarterback where he is, and with him to the ground.
        const s0 = start.get(who.rush)!;
        const qbAt = (t: number) => sample(keys.get(qb)!, t);
        const beat = beatenNear(who.beat, s0);
        const mid: Keyframe[] = beat ? [at(contact * 0.6, toward(beat, qbAt(contact * 0.6), 1))] : [];
        if (beat) beatAt = contact * 0.6;
        setRun(who.rush, [...mid, at(contact, toward(qbAt(contact), s0, 0.8)), at(total, toward(end, s0, 0.6))]);
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
      // Under the ball as it comes down: the returner, when he can get there (an onside kick is short of him: the
      // man nearest where it comes down goes to it instead).
      const deep = cast.defense.find((m) => m.role === 'RET')?.id;
      const reaches = (id: number) =>
        Math.hypot(land.x - start.get(id)!.x, land.y - start.get(id)!.y) <= topOf(id) * landT;
      const near = [...cast.offense, ...cast.defense]
        .filter((m) => m.id !== kicker && start.has(m.id))
        .sort(
          (a, b) =>
            Math.hypot(land.x - start.get(a.id)!.x, land.y - start.get(a.id)!.y) -
            Math.hypot(land.x - start.get(b.id)!.x, land.y - start.get(b.id)!.y),
        )[0]?.id;
      const ret = deep !== undefined && start.has(deep) && !reaches(deep) && near !== undefined ? near : deep;
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
        const short = e.kind === 'pass' ? 0 : e.kind === 'int' ? 0.7 : 0.7;
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
        // His man beaten just as the quarterback feels it (`PRESSURE_REACT` before the throw); then after him. Off the
        // edge he loops in from beside and behind where the quarterback set, chasing him up the pocket; up the middle
        // he comes through to where the quarterback was and closes on where he's slid to. On him as the ball comes out.
        const feel = Math.max(0.6, outT - PRESSURE_REACT);
        const pace = topOf(who.rush);
        // Round the corner his momentum carries him past where the quarterback set, outside and behind it; then a
        // straight sprint at him where he's climbed to. A quarterback who rolls out escapes him: he's on him (a step
        // and a half off) as the quarterback breaks out of the pocket, then after him.
        const roll = pocket?.roll === true;
        const loopAt = feel + (roll ? 0.15 : 0.3);
        const wide = shift(qbAt(feel), 3, 1.5);
        const loop = roll ? toward(qbAt(loopAt), edge ? wide : s0, 1.4) : wide;
        const outside = beat ? shift(beat, 1.5, 0.8) : undefined;
        const beatAt = edge
          ? outside
            ? Math.min(outT * 0.55, loopAt - Math.hypot(loop.x - outside.x, loop.y - outside.y) / pace)
            : 0
          : Math.min(outT * 0.55, feel - 0.1);
        const reach = (p: Pt) => Math.hypot(p.x - s0.x, p.y - s0.y) / pace;
        const mid: Keyframe[] =
          beat && beatAt > 0.3 && (!edge || beatAt >= reach(outside!))
            ? [at(beatAt, edge ? outside! : toward(beat, qbAt(beatAt), 1))]
            : [];
        const chase = edge || roll ? [at(loopAt, loop)] : [at(feel + 0.3, toward(qbAt(feel), s0, 2))];
        // Off the ball into the man he'll beat, and a beat of hand fighting on him before he wins.
        const engage: Keyframe[] = [];
        if (beat && mid.length) {
          const contact = toward(beat, s0, 0.9);
          if (mid[0].t > ENGAGE + 0.3 && reach(contact) <= ENGAGE) {
            engage.push(at(ENGAGE, contact));
            engage.push(at(mid[0].t - 0.25, toward(beat, s0, 0.6)));
          }
        }
        const hit = edge ? shift(qbAt(outT), 0.6, 0.8) : toward(qbAt(outT), qbAt(feel), 0.9);
        const way = runnable({ ...s0, t: 0 }, [...engage, ...mid, ...chase], pace);
        const last = way[way.length - 1] ?? { t: 0, ...s0 };
        const room = pace * Math.max(0, outT - last.t);
        if (Math.hypot(hit.x - last.x, hit.y - last.y) <= room) {
          // The hit as he lets it go: the quarterback knocked a step and a half on, away from the man who got there,
          // and the rusher driving through him, still on him.
          const knocked = toward(qbAt(outT), hit, -1.5);
          const knock = { x: knocked.x, y: Math.max(1, Math.min(FIELD_W - 1, knocked.y)) };
          setRun(who.rush, [...way, at(outT, hit), at(outT + 0.4, toward(knock, hit, 0.8))]);
          free.set(who.rush, outT + 0.55);
          keys.set(qb!, [...qbKeys.filter((k) => k.t <= outT + 1e-6), at(outT + 0.4, knock)]);
        } else {
          // Out of his reach (a quarterback who's rolled away from him): flat out after him as he throws, a step short.
          setRun(who.rush, [...way, at(outT, toward(last, hit, room))]);
          free.set(who.rush, outT + 0.2);
        }
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
        const c0 = start.get(who.cover)!;
        // As near as he could get by the time the ball does: a man lined up far off is further off the catch.
        const reach = Math.hypot(land.x - c0.x, land.y - c0.y) - topOf(who.cover) * throwEnd;
        const spot =
          sep !== undefined
            ? toward(land, c0, Math.max(sep, reach))
            : { x: land.x + dir * (e.kind === 'incomplete' ? 0.7 : 1.5), y: land.y };
        set(who.cover, [at(throwEnd, spot)]);
        if (e.kind === 'pass') free.set(who.cover, throwEnd);
        moment(who.cover, throwEnd);
      }
      break;
    }
  }

  // The victory formation: nobody plays it out. The line and the front give a token push at the snap, the up-backs
  // step up to wall him off, and then everyone stands until the whistle.
  if (isVictory(e)) {
    const ballX = segs[0].x0;
    for (const m of [...cast.offense, ...cast.defense]) {
      const s0 = start.get(m.id);
      if (!s0 || m.id === qb) continue;
      const off = (s0.x - ballX) * dir < 0;
      const back = Math.abs(s0.x - ballX);
      const lean = off ? (back > 6 ? 0 : back > 2 ? 0.6 : 0.3) : m.role === 'DT' || m.role === 'EDGE' ? 0.3 : 0;
      if (lean)
        set(m.id, [
          at(0.5, { x: s0.x + (off ? dir : -dir) * lean, y: s0.y }),
          at(total, { x: s0.x + (off ? dir : -dir) * lean, y: s0.y }),
        ]);
      else set(m.id, [at(total, s0)]);
    }
  }

  // Play action: the back meets the quarterback at the mesh and carries the fake into the line, then blocks or leaks
  // out on his own (steered from there).
  const qbKeys = qb === undefined ? undefined : keys.get(qb);
  const back = cast.offense.find((m) => m.id === pocket?.fakeBack && !keys.has(m.id));
  if (pocket?.playAction && qbKeys && back && start.has(back.id)) {
    const b0 = start.get(back.id)!;
    const mesh = sample(qbKeys, FAKE);
    const side = Math.sign(b0.y - segs[0].y0) || 1;
    const meet = { x: mesh.x + dir * 0.4, y: mesh.y + side * 0.9 };
    // At the mesh as soon as his legs get him there (from deep in the I, a beat after the quarterback turns).
    const there = Math.max(FAKE, Math.hypot(meet.x - b0.x, meet.y - b0.y) / topOf(back.id));
    // The back the engine says the rush beat sells it at the mesh and stays there to pick him up: the rusher's script
    // comes past where he'd be in protection, not where a fake into the line would leave him.
    const blocks = back.id === who.beat;
    keys.set(back.id, [
      from(back.id),
      at(there, meet),
      // (Planted at the mesh first: let go at the speed of his sprint to it, he'd run on yards past his man.)
      blocks ? at(there + PLANT, meet) : at(there + 0.7, { x: mesh.x + dir * 3.5, y: mesh.y + side * 1.5 }),
    ]);
    free.set(back.id, there + (blocks ? PLANT : 0.7));
  }

  // The man who missed: on the carrier as the move starts, a yard off on his side, then sent on past him (a move) or
  // driven back (size), and on his own again a moment after the move. No ring: the move is the carrier's.
  const mi = segs.findIndex((sg) => sg.move);
  /** A long return's miss: the cover man who can get there at the pace nearest a cover man's, off the ball being down. */
  const kickMiss = (): number | undefined => {
    if (catchAt === undefined || mi < 0) return undefined;
    const p = pointAt(segs[mi], 0);
    const [tMove] = ts[mi];
    const react = e.kind === 'kickoff' ? catchAt : (kickAt ?? 0);
    let best: number | undefined;
    let off = Infinity;
    for (const m of cast.offense) {
      if (m.role === 'K' || m.role === 'P' || m.id === who.tackle || keys.has(m.id) || !start.has(m.id)) continue;
      const s0 = start.get(m.id)!;
      const pace = Math.hypot(p.x - s0.x, p.y - s0.y) / Math.max(0.1, tMove - react);
      if (pace <= topOf(m.id) && Math.abs(pace - COVER_PACE) < off) [off, best] = [Math.abs(pace - COVER_PACE), m.id];
    }
    return best;
  };
  const by = e.open?.broke?.by ?? kickMiss();
  let missed: number | undefined;
  const how = e.open?.broke?.how ?? 'move';
  // (He can be the tackler too: he misses him, gets up and runs him down, from where the miss left him.)
  if (by !== undefined && mi >= 0 && start.has(by) && by !== carrier) {
    let mj = mi;
    while (mj + 1 < segs.length && segs[mj + 1].move) mj++;
    const [tMove] = ts[mi];
    const tEnd = ts[mj][1];
    const p = pointAt(segs[mi], 0);
    const q = pointAt(segs[mj], 1);
    const hl = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    const h = { x: (q.x - p.x) / hl, y: (q.y - p.y) / hl };
    const s0 = start.get(by)!;
    const his = Math.sign(-h.y * (s0.x - p.x) + h.x * (s0.y - p.y)) || 1;
    const spot = { x: p.x - h.y * his, y: p.y + h.x * his };
    // His own part until he reads it (a cover man's route), then from where that left him, as late as his legs allow.
    // On a return he's off once the ball's down (a kickoff) or kicked (a punt), straight at the spot at the pace that
    // gets him there.
    const kicked = catchAt !== undefined;
    const react = kicked
      ? e.kind === 'kickoff'
        ? catchAt!
        : (kickAt ?? 0)
      : Math.min(tMove, (e.kind === 'run' ? ts[0][1] : outT) + 0.3);
    const prior = kicked ? [at(react, s0)] : (keys.get(by) ?? []).filter((k) => k.t > 0 && k.t < react - 1e-6);
    const last = prior.length ? prior[prior.length - 1] : at(0, s0);
    const pace = topOf(by) + PURSUIT;
    const need = Math.hypot(spot.x - last.x, spot.y - last.y) / pace;
    if (need <= tMove - last.t) {
      const go = kicked ? last.t : tMove - need;
      const run: Keyframe[] = [...prior, ...(go > last.t + 0.05 ? [at(go, last)] : []), at(tMove, spot)];
      const was = sample([at(0, s0), ...run], tMove - 0.15);
      const al = Math.hypot(spot.x - was.x, spot.y - was.y);
      const a = al > 0.1 ? { x: (spot.x - was.x) / al, y: (spot.y - was.y) / al } : h;
      const on = (p: Pt, v: Pt, d: number): Pt => ({ x: p.x + v.x * d, y: p.y + v.y * d });
      const tail =
        how === 'size'
          ? [at(tMove + 0.4, on(spot, h, 1.5))]
          : [at(tMove + 0.25, on(spot, a, 1.5)), at(tMove + 0.5, on(spot, a, 2))];
      const rest = tail[tail.length - 1];
      const loose = Math.max(rest.t, tEnd + 0.6);
      keys.set(by, [from(by), ...run, ...tail, at(loose, rest)]);
      free.set(by, loose);
      missed = by;
    }
  }

  // A breakaway: the deepest safety comes up to fill as the run starts and is a step late, beside and behind the carrier
  // as he goes by.
  if (e.open?.gone && carrier !== undefined && keys.has(carrier)) {
    const ballX = segs[0].x0;
    const deep = cast.defense
      .filter((m) => m.role === 'S' && start.has(m.id))
      .sort((a, b) => (start.get(b.id)!.x - ballX) * dir - (start.get(a.id)!.x - ballX) * dir)[0]?.id;
    const cKeys = keys.get(carrier)!;
    if (deep !== undefined && deep !== who.tackle && deep !== by && deep !== carrier && !keys.has(deep)) {
      const s0 = start.get(deep)!;
      const react = ts[0][1] + 0.3;
      // Where the carrier gets to the depth he fills at.
      const fill = s0.x - dir * Math.min(GONE_FILL, Math.max(0, (s0.x - ballX) * dir - 3));
      let tp = -1;
      for (let t = react; t <= total; t += 0.05)
        if ((sample(cKeys, t).x - fill) * dir >= 0) {
          tp = t;
          break;
        }
      if (tp > react) {
        const c = sample(cKeys, tp);
        const b = sample(cKeys, Math.max(0, tp - 0.1));
        const hl = Math.hypot(c.x - b.x, c.y - b.y) || 1;
        const h = { x: (c.x - b.x) / hl, y: (c.y - b.y) / hl };
        const side = Math.sign(-h.y * (s0.x - c.x) + h.x * (s0.y - c.y)) || 1;
        const spot = {
          x: c.x - h.x * GONE_BEHIND - h.y * side * GONE_OFF,
          y: c.y - h.y * GONE_BEHIND + h.x * side * GONE_OFF,
        };
        const leave = Math.min(react, tp - Math.hypot(spot.x - s0.x, spot.y - s0.y) / topOf(deep));
        if (leave >= 0) {
          keys.set(deep, [from(deep), ...(leave > 0.05 ? [at(leave, s0)] : []), at(tp, spot)]);
          free.set(deep, tp);
        }
      }
    }
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
    // Off his spot when the ball's out, or sooner if he must to get to `to` by `t` on his own legs.
    const onTheMove = (id: number, t: number, to: Pt): Keyframe[] => {
      if (keys.has(id)) return upTo(id, t);
      const s0 = start.get(id)!;
      const run = Math.hypot(to.x - s0.x, to.y - s0.y) / topOf(id);
      return [from(id), at(Math.max(0, Math.min(release, t - 0.3, t - run)), s0)];
    };
    if (hitter !== undefined && hitter !== fumbler && start.has(hitter)) {
      keys.set(hitter, [
        ...onTheMove(hitter, tHit, toward(hit, start.get(hitter)!, 0.6)),
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
            : [...onTheMove(by, tHit, toward(hit, s0, 2.5)), at(tHit, toward(hit, s0, 2.5))];
        keys.set(by, [...lead, at(tSettle, settle), ...back]);
        // The man who fumbled stays down where it came out.
        keys.set(fumbler, [...upTo(fumbler, tHit), at(tHit, hit), at(total, hit)]);
      }
      moment(by, tSettle);
      // A lost one: the quarterback's handoff script ends as the ball comes out, and he plays on from there (steered),
      // so the play keeps him off the man who takes it instead of leaving him where the defense lands on it.
      if (f.lost && qb !== undefined && qb !== fumbler && qb !== by && qb !== hitter && !free.has(qb))
        free.set(qb, tHit);
      carrier = by;
      returned = back.length > 0;
      loose = { t: tHit, x: hit.x, y: hit.y, settle: tSettle, by };
    }
  }

  // The tackler meets the carrier at the whistle, from the side he came.
  let tacklerId: number | null = null;
  let pursuer: number | null = null;
  let hitAt: number | undefined;
  const kickReturn = catchAt !== undefined;
  // A fumble's tackle was the hit: only a lost one's return is run down, and not into the end zone.
  const scores = e.to !== undefined && (e.to < 0 || e.to > 100);
  if (
    !blind &&
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
    if (tackler === undefined && kickReturn && !loose && catchAt !== undefined) {
      // A return the log names no tackler for: the cover man whose lane gets him to where it ends as the returner does,
      // at a cover man's sprint (off the ball being down on a kickoff, the kick on a punt), not the man who happened to
      // line up nearest that spot (he'd be there seconds early, waiting).
      const react = e.kind === 'kickoff' ? catchAt : (kickAt ?? 0);
      let off = Infinity;
      for (const m of side) {
        if (m.id === carrier || m.id === missed || !start.has(m.id)) continue;
        const p = start.get(m.id)!;
        const pace = Math.hypot(p.x - end.x, p.y - end.y) / Math.max(0.1, total - react);
        if (pace <= topOf(m.id) && Math.abs(pace - COVER_PACE) < off)
          [off, tackler] = [Math.abs(pace - COVER_PACE), m.id];
      }
    }
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
      // His part so far: up to the whistle (a cover man scripted to a catch made where the tackle is has his part end
      // at it, and only needs ending on the carrier).
      const before = keys.get(tackler)?.filter((k) => k.t < total - 1e-6) ?? [];
      const there = (keys.get(tackler) ?? []).some((k) => k.t >= total - 1e-6 && k.t > 0);
      // On a kickoff he's set with the rest until the ball comes down, then he takes his angle on the returner.
      const set = e.kind === 'kickoff' && catchAt !== undefined && catchAt + 0.2 < total ? [at(catchAt + 0.2, s0)] : [];
      // On a catch, open by the play's separation as the ball gets there, then on him: not ambling up from the snap.
      const caughtAt = passing && airIdx > 0 ? ts[airIdx][1] : 0;
      const off =
        pattern && !before.some((k) => k.t > 0) && caughtAt > 0 && caughtAt < total - 0.1
          ? [at(caughtAt, toward(pointAt(segs[airIdx], 1), s0, pattern.separation + 0.5))]
          : [];
      // A finish where the hit lands before the whistle (a lunge, a slide): he's on him there and they go on together.
      const hi = loose ? -1 : segs.findIndex((sg) => sg.hit);
      const tHit = hi >= 0 ? ts[hi][0] : total;
      const hit = toward(hi >= 0 ? pointAt(segs[hi], 0) : end, s0, 0.6);
      const way = [from(tackler), ...set, ...before.filter((k) => k.t > 0 && k.t < tHit - 1e-6), ...off];
      // A kickoff's coverage may not leave before the ball's down.
      const floor = set.length ? set[0].t : 0;
      keys.set(tackler, [
        ...intoTheHit(way, hit, tHit, topOf(tackler) + PURSUIT, floor),
        at(tHit, hit),
        ...(hi >= 0 ? [at(total, toward(end, s0, 0.6))] : []),
      ]);
      if (hi >= 0) hitAt = tHit;
      tacklerId = tackler;
      // Nothing else scripted for him, or his part over well before the tackle (the cover man beaten on the catch, the
      // receiver a pass was picked off from): he runs the carrier down himself from there.
      const done = there ? total : before.length ? before[before.length - 1].t : 0;
      if (total - done > 0.5) {
        pursuer = tackler;
        if (done > 0) free.set(tackler, done);
        else free.delete(tackler);
      }
      moment(tackler, tHit);
    }
  }
  // A return touchdown: the kicker has the last angle and is a step short, behind the returner as he goes by.
  if (touchdown && catchAt !== undefined && carrier !== undefined && keys.has(carrier)) {
    const kicker = cast.offense.find((m) => m.role === (e.kind === 'punt' ? 'P' : 'K'))?.id;
    const kk = kicker === undefined ? undefined : keys.get(kicker);
    if (kicker !== undefined && kk) {
      const cKeys = keys.get(carrier)!;
      let tp = -1;
      for (let t = catchAt; t <= total; t += 0.05)
        if ((sample(cKeys, t).x - sample(kk, t).x) * dir <= 0) {
          tp = t;
          break;
        }
      if (tp > catchAt) {
        const c = sample(cKeys, tp);
        const b = sample(cKeys, Math.max(0, tp - 0.1));
        const hl = Math.hypot(c.x - b.x, c.y - b.y) || 1;
        const h = { x: (c.x - b.x) / hl, y: (c.y - b.y) / hl };
        const k0 = sample(kk, tp);
        const side = Math.sign(-h.y * (k0.x - c.x) + h.x * (k0.y - c.y)) || 1;
        const spot = {
          x: c.x - h.x * GONE_BEHIND - h.y * side * LAST_OFF,
          y: c.y - h.y * GONE_BEHIND + h.x * side * LAST_OFF,
        };
        let go = -1;
        for (let t = tp - 0.05; t >= (kickAt ?? 0); t -= 0.05) {
          const q = sample(kk, t);
          if (Math.hypot(spot.x - q.x, spot.y - q.y) <= topOf(kicker) * 0.9 * (tp - t)) {
            go = t;
            break;
          }
        }
        if (go >= 0) {
          keys.set(kicker, [...kk.filter((k) => k.t < go - 1e-6), at(go, sample(kk, go)), at(tp, spot)]);
          free.set(kicker, tp);
        }
      }
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
    ...(hitAt !== undefined ? { hitAt } : {}),
    ...(missed !== undefined ? { missed } : {}),
    ...(beatAt !== undefined ? { beatAt } : {}),
    settle,
    stalk,
  };
}
