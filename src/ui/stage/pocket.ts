/**
 * The quarterback's drop and his pocket, as All-22 stages a dropback: how deep he sets (by the throw), play action
 * and bootlegs, a clean pocket's step up, pressure's climb or slide away from the man who got there, a scramble's
 * escape. Pure and seeded like the rest of the stager. Spec: docs/superpowers/specs/2026-11-02-all-22-passing-game-
 * design.md §2 and §6; the numbers are the NFL's (`npm run film` holds the staging to them).
 */
import type { Rng } from '../../engine/rng';
import { OFF_SCHEMES, type OffSchemeId } from '../../engine/schemes';
import type { PlayLogEntry } from '../../engine/types';
import { FIELD_W } from './ballPath';
import type { Role } from './cast';
import type { Pt } from './formations';
import type { Keyframe } from './scripts';

/**
 * A drop by its depth, counted in steps from under center (PFF's buckets): 1 a quick set, 3 sets 4–6 yards deep,
 * 5 sets 7–8, 7 sets 9 and more. From the shotgun (lined up about 5 deep) he takes fewer steps to the same depth:
 * none, 1, 3 and 5.
 */
export type Drop = 1 | 3 | 5 | 7;

/** How a dropback plays out in the pocket. Times in seconds from the snap; depths in yards behind the ball. */
export interface PocketPlan {
  gun: boolean;
  drop: Drop;
  /** A hitch step at the end of the drop: the deep shots and the timing throws that wait on a route. */
  hitch: boolean;
  setDepth: number;
  playAction: boolean;
  /** Play action with the quarterback rolling out of the pocket the other way. */
  bootleg: boolean;
  /** Where the rusher the engine named came from: off the edge, up the middle, or no one got there. */
  pressure: 'none' | 'edge' | 'inside';
  /** Pressure he can't step up from: he rolls out of the pocket (a throwaway always does). */
  roll: boolean;
  /** The throw, the sack or the break out of the pocket. */
  throwAt: number;
}

export interface PocketContext {
  gun: boolean;
  scheme?: OffSchemeId;
  /** The two-minute drill: no time for a fake. */
  hurry: boolean;
  /** Air yards past the line, on a throw that has them. */
  air: number | null;
  /** The rusher the engine named, by his spot and his role. `across` is how far outside the ball he lined up. */
  rusher?: { role: Role; across: number };
  /** The earliest the ball can leave for the target's route to reach the catch with it (`throwWindow`). */
  minThrow: number;
  /** The defense sent a blitz: a sack comes quicker. */
  blitz?: boolean;
}

const DROPS: readonly Drop[] = [1, 3, 5, 7];
/** How often each drop is called (an estimate: the quick game is most of a modern passing game). */
const PRIOR: Record<Drop, number> = { 1: 0.25, 3: 0.4, 5: 0.25, 7: 0.1 };
/** Air yards off each drop, under center and from the gun (Sharp Football Analysis, 2018–19). */
const AIR_BY_DROP: Record<Drop, readonly [number, number]> = {
  1: [3.2, 4.9],
  3: [8.3, 9.4],
  5: [11.5, 12.3],
  7: [13.3, 15.1],
};
/** How far apart the throws off one drop land: wide, since a drop is called before anyone is open. */
const AIR_SPREAD = 14;
/** Where he sets, yards behind the ball (PFF's depths; under center he lines up 2 deep, in the gun 5). */
const SET: Record<Drop, readonly [number, number]> = { 1: [3, 3.5], 3: [4.8, 5.8], 5: [7, 8], 7: [9, 10] };
const GUN_SET: Record<Drop, readonly [number, number]> = { 1: [5, 5.3], 3: [5.6, 6.2], 5: [7, 8], 7: [9, 10] };
/** The drop's time, under center and from the gun (seconds); a hitch adds a beat. */
const DROP_TIME: Record<Drop, readonly [number, number]> = {
  1: [0.45, 0.25],
  3: [0.85, 0.5],
  5: [1.25, 0.9],
  7: [1.6, 1.25],
};
const HITCH = 0.25;
/**
 * When a clean, plain dropback's ball comes out, by air yards: the NFL's times (2.19, 2.62, 2.58, 3.12, 3.37 s,
 * 2022) less what play action, pressure and the drop from under center add across a game's throws. A deep shot's
 * is lowest: its route usually sets the time (`minThrow`), so this only matters for a short route deep.
 */
const CLEAN: readonly [number, number][] = [
  [0, 1.6],
  [5, 2.0],
  [10, 1.9],
  [20, 2.55],
  [Infinity, 2.15],
];
const THROW_SPREAD = 0.35;
/** Play action: about three early-down dropbacks in ten, one in twenty-odd later (FTN 2023–25); a third bootlegs. */
const PA_EARLY = 0.36;
const PA_LATE = 0.045;
const PA_LEAN = 0.4;
const BOOTLEG = 0.35;
/** The fake: the turn to the back and the ride, before he finishes the drop. */
export const FAKE = 0.45;
/** Pressure buys the rush time and costs the quarterback some: he climbs or slides before he throws. */
const PRESSURED = 0.8;
/** From under center the drop turns his back to the defense: a beat longer to the throw (NFL 3.05 s against 2.55). */
const UNDER_CENTER = 0.4;
/** Under pressure he can't climb from, he rolls out this often (and a throwaway always does). */
const ROLL = 0.25;
/** A scramble: under pressure he goes once the rush gets there; with nothing open, after a long look (NFL ~4.4 s). */
const SCRAMBLE_PRESSURED = [2.4, 3.2] as const;
const SCRAMBLE_OPEN = [3.2, 4.4] as const;
/**
 * Snap to sack: the NFL's median 2.9 s, a tenth of them past 5.3 (2023–25), so a long right tail (a log-normal); a
 * blitz gets there a little quicker. Never before the rush could have.
 */
const SACK_MEDIAN = 2.9;
const SACK_SPREAD = 0.47;
const SACK_BLITZ = 0.85;
const SACK_TIMES = [2.1, 6.5] as const;

/** When a sack gets home, seconds from the snap. */
export function sackTime(blitz: boolean, rng: Rng): number {
  const t = SACK_MEDIAN * Math.exp(rng.normal(0, SACK_SPREAD)) * (blitz ? SACK_BLITZ : 1);
  return Math.max(SACK_TIMES[0], Math.min(SACK_TIMES[1], t));
}

/** The drop for a throw of `air` yards: the drops whose throws land near it, weighted by how often each is called. */
function pickDrop(air: number | null, gun: boolean, e: PlayLogEntry, rng: Rng): Drop {
  if (air !== null && air < 0) return rng.next() < 0.55 ? 1 : 3;
  const weights = DROPS.map((d) => {
    if (air === null) {
      // No throw to read (a sack, a scramble): long yardage calls the deeper drops.
      const long = e.distance >= 8 || e.down === 3;
      return PRIOR[d] * (long ? [0.6, 1, 1.4, 1.8] : [1.2, 1.1, 0.8, 0.5])[DROPS.indexOf(d)];
    }
    const mean = AIR_BY_DROP[d][gun ? 1 : 0];
    return PRIOR[d] * Math.exp(-((air - mean) ** 2) / (2 * AIR_SPREAD ** 2));
  });
  return rng.weighted(DROPS, (d) => weights[DROPS.indexOf(d)]);
}

const range = (rng: Rng, [lo, hi]: readonly [number, number]) => rng.float(lo, hi);

export function pocketPlan(e: PlayLogEntry, ctx: PocketContext, rng: Rng): PocketPlan {
  const drop = pickDrop(ctx.air, ctx.gun, e, rng);
  const setDepth = range(rng, (ctx.gun ? GUN_SET : SET)[drop]);
  const screen = ctx.air !== null && ctx.air < 0;
  const lean = ctx.scheme ? OFF_SCHEMES[ctx.scheme].playAction : 0;
  const early = e.down === 1 || e.down === 2;
  const playAction = !ctx.hurry && !screen && rng.next() < (early ? PA_EARLY + PA_LEAN * lean : PA_LATE);
  const throwing = e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int';
  const bootleg = playAction && throwing && !ctx.rusher && rng.next() < BOOTLEG;
  const pressure = !ctx.rusher
    ? 'none'
    : ctx.rusher.role === 'EDGE' || Math.abs(ctx.rusher.across) >= 4
      ? 'edge'
      : 'inside';
  const throwaway = /throws it away/.test(e.text);
  const roll = throwaway || (pressure !== 'none' && rng.next() < ROLL);
  const drops = DROP_TIME[drop][ctx.gun ? 1 : 0] + (playAction ? FAKE : 0);
  const hitch = drop >= 5 || (drop === 3 && ctx.minThrow > drops + 1);
  const set = drops + (hitch ? HITCH : 0);
  let throwAt: number;
  if (e.kind === 'scramble')
    throwAt = Math.max(set + 0.4, range(rng, pressure === 'none' ? SCRAMBLE_OPEN : SCRAMBLE_PRESSURED));
  else if (e.kind === 'sack') throwAt = Math.max(set + 0.3, sackTime(!!ctx.blitz, rng));
  else {
    const base = CLEAN.find(([below]) => (ctx.air ?? 0) < below)![1];
    const t =
      base +
      rng.normal(0, THROW_SPREAD) +
      (playAction ? FAKE : 0) +
      (pressure !== 'none' ? PRESSURED : 0) +
      (ctx.gun ? 0 : UNDER_CENTER);
    // Never before he's set (a quick game's catch and throw is the exception that sets as it throws), nor before
    // the route can get there.
    throwAt = Math.max(t, set + (drop === 1 ? 0.1 : 0.25), ctx.minThrow, 1.2);
  }
  return { gun: ctx.gun, drop, hitch, setDepth, playAction, bootleg, pressure, roll, throwAt };
}

/** The quickest he moves in the pocket, yards a second (a drop, a roll, a reset). */
const QB_PACE = 7;
/** Stepping up or climbing, he stops this deep: the line's backs are a yard or two off the ball. */
const STEP_UP_TO = 4;
/** Held this long after a quick set, he resets to this depth. */
const RESET_AFTER = 1.3;
const RESET_DEPTH = 5;

export interface PathContext {
  /** Where the ball is snapped, and where he lined up. */
  ball: Pt;
  qb: Pt;
  dir: 1 | -1;
  /** The rusher the engine named, where he lined up, and the man he beat (where he comes through). */
  rusher?: Pt;
  through?: Pt;
  /** The back, for the fake. */
  back?: Pt;
}

/** Never past the line before the ball is out (that pass would be illegal), and never off the field. */
const keepIn = (p: Pt, ball: Pt, dir: 1 | -1): Pt => {
  const depth = Math.max(0.6, (ball.x - p.x) * dir);
  return {
    x: Math.max(-9.5, Math.min(109.5, ball.x - dir * depth)),
    y: Math.max(1, Math.min(FIELD_W - 1, p.y)),
  };
};

/**
 * Where he goes with the ball, snap to throw (or the break of a scramble, or the sack): his keyframes after the
 * snap, each a spot he reaches at its time. The ball rides with him (`stagedPath` makes them its legs).
 */
export function pocketPath(plan: PocketPlan, ctx: PathContext): Keyframe[] {
  const { ball, dir } = ctx;
  const behind = (depth: number, across = 0): Pt => keepIn({ x: ball.x - dir * depth, y: ball.y + across }, ball, dir);
  const keys: Keyframe[] = [];
  const to = (t: number, p: Pt) => keys.push({ t, x: p.x, y: p.y });
  // The back's side: the fake goes to him, a bootleg rolls away from him.
  const side = Math.sign((ctx.back?.y ?? ball.y + 1) - ball.y) || 1;
  const startDepth = (ball.x - ctx.qb.x) * dir;
  let t = 0;
  if (plan.playAction) {
    // The turn to the mesh: a step back and across to the back's side, the ball in his belly.
    t = FAKE;
    to(t, behind(Math.max(startDepth, 2.5) + 0.8, side * 1.3));
  }
  const dropTime = DROP_TIME[plan.drop][plan.gun ? 1 : 0];
  t += dropTime;
  // A bootleg rolls out wide the other way at a shallower depth, throwing on the run.
  const set = plan.bootleg ? behind(Math.min(plan.setDepth, 6.5), -side * 8.5) : behind(plan.setDepth);
  to(t, set);
  if (plan.hitch) {
    t += HITCH;
    to(t, plan.bootleg ? set : behind(plan.setDepth - 0.5));
  }
  // A long wait off a quick set: he resets deeper in the pocket rather than stand at the line's back.
  if (!plan.bootleg && plan.throwAt - t > RESET_AFTER && (ball.x - keys[keys.length - 1].x) * dir < RESET_DEPTH) {
    t += 0.6;
    to(t, behind(RESET_DEPTH));
  }
  const at = keys[keys.length - 1];
  const here: Pt = { x: at.x, y: at.y };
  const depthHere = (ball.x - here.x) * dir;
  const end = plan.throwAt;
  if (plan.bootleg) {
    // On the run toward the sideline until the throw.
    to(end, keepIn({ x: here.x, y: here.y - side * 3 }, ball, dir));
  } else if (plan.pressure !== 'none') {
    // The rush gets there late in the down: he holds, then moves away from it as it arrives.
    const away = Math.sign(ball.y - (ctx.through ?? ctx.rusher)!.y) || Math.sign(ball.y - (ctx.rusher?.y ?? 0)) || 1;
    const move = Math.max(t, end - 0.7);
    to(move, here);
    if (plan.roll) to(end, keepIn({ x: here.x + dir * 0.5, y: here.y + away * 6 }, ball, dir));
    else if (plan.pressure === 'edge') to(end, behind(Math.max(STEP_UP_TO, depthHere - 2.5), (here.y - ball.y) * 0.5));
    else to(end, keepIn({ x: here.x, y: here.y + away * 2.5 }, ball, dir));
  } else {
    // A clean pocket: he holds, then steps up into the throw (off a quick set he throws from where he is).
    const step = Math.max(t, end - 0.4);
    to(step, here);
    to(end, behind(Math.max(Math.min(depthHere, STEP_UP_TO), depthHere - 1.2), here.y - ball.y));
  }
  // No move quicker than his legs: a roll or a reset the throw would come too soon for comes as soon as he can make it
  // (the throw with it). Then one key per moment, in order.
  let prev: Keyframe = { t: 0, x: ctx.qb.x, y: ctx.qb.y };
  let late = 0;
  const paced = keys.map((k) => {
    const t = Math.max(k.t + late, prev.t + Math.hypot(k.x - prev.x, k.y - prev.y) / QB_PACE);
    late = t - k.t;
    prev = { ...k, t };
    return prev;
  });
  return paced.filter((k, i) => i === paced.length - 1 || k.t < paced[i + 1].t);
}
