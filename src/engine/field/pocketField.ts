/**
 * The pocket (spec: docs/superpowers/specs/2026-11-04-spatial-pocket-design.md §2): from the snap, the line, every rusher
 * and the quarterback step together at 20 a second. Blockers and rushers pair off by alignment; each rep can be won, a
 * step at a time, by the rusher's rush against the blocker's protection; a won rusher goes after the quarterback. Pure
 * and seeded: the same start and stream give the same frames.
 */
import { sizeEdge, type SizedBuild } from '../size';
import type { Rng } from '../rng';
import { bodyOf, hasHabit, stepBody, type Body } from './body';
import { laneMatch } from './run';
import { BRAKE, KNOBS, STEP } from './tuning';
import type { FieldPlayer, FieldSkills } from './types';

export type PocketOutcome = 'clean' | 'pressure' | 'hit' | 'sack' | 'scramble' | 'escape' | 'away';

export interface PocketStart {
  /** The offense's direction. */
  dir: 1 | -1;
  /** Field x of the line of scrimmage. */
  los: number;
  qb: number;
  /** Every man the pocket moves, at the snap (side 0 the offense). */
  players: FieldPlayer[];
  /** Linemen, a back kept in, a tight end kept in. */
  blockers: number[];
  /** Tackles, edges and the blitzers. */
  rushers: number[];
  outcome: PocketOutcome;
  /** False: no blocker is charged (the coverage held, or he held the ball). */
  blamed: boolean;
  blitz: boolean;
  /** Yards behind the line he sets at. */
  setDepth: number;
  /** Seconds from the snap: the ball out, a sack's planned time, or the break out. */
  throwAt: number;
  /** Seconds from the snap the pocket runs to. */
  end: number;
  /** A sack's spot (field x). */
  sackX?: number;
}

export interface PocketResult {
  /** steps × players × (x, y), in `start.players` order; frame 0 is the snap. */
  frames: Float32Array;
  /** Who got home (pressure, hit, sack). */
  rusher: number | null;
  /** The blocker who lost him (null: unblamed, or a free rusher). */
  beat: number | null;
  /** Seconds from the snap he got home. */
  at: number | null;
  /** A scramble: the step he crosses the line. */
  breakout: number | null;
}

/** Where an engaged blocker holds his man from (yards); a man within this of a rusher meets him. */
const HOLD_GAP = 0.9;
const MEET = 1.5;
/** A rusher's push against a blocker (yards a second): a bull rush drives harder, an anchor gives half the ground. */
const PUSH = 0.8;
const BULL = 1.6;
/** No rep is won in the first half second against a heavy punch. */
const PUNCH = 0.5;
/** A bend round the corner, or a two-tap set against speed: the rep goes this much sooner. */
const HABIT_EDGE = 1.3;
/** A won rusher is off his man this long after the win before he's at full speed for the quarterback. */
const SHED = 0.2;

const build = (s: FieldSkills): SizedBuild => ({
  position: s.pos,
  heightIn: s.h,
  weightLb: s.w,
  ...(s.big ? { playsBig: true as const } : {}),
});

/**
 * Who takes whom at the snap: blockers and rushers in order across the field, paired so no two cross. With blockers to
 * spare, the spares double the rusher nearest them (the inside man); with rushers to spare, the men nobody takes are free.
 */
export function pairUp(start: PocketStart): {
  pairs: [number, number][];
  doubles: [number, number][];
  free: number[];
} {
  const y = new Map(start.players.map((p) => [p.id, p.y]));
  const across = (ids: readonly number[]) => [...ids].sort((a, b) => y.get(a)! - y.get(b)!);
  const blockers = across(start.blockers.filter((id) => y.has(id)));
  const rushers = across(start.rushers.filter((id) => y.has(id)));
  const pairs: [number, number][] = [];
  const doubles: [number, number][] = [];
  if (blockers.length >= rushers.length) {
    // Each rusher to a blocker across from him; the blockers left over help.
    const mine = laneMatch(rushers, blockers, (id) => y.get(id)!);
    const used = new Set<number>();
    rushers.forEach((r, k) => {
      pairs.push([mine[k], r]);
      used.add(mine[k]);
    });
    for (const b of blockers) {
      if (used.has(b) || !rushers.length) continue;
      let best = rushers[0];
      for (const r of rushers) if (Math.abs(y.get(r)! - y.get(b)!) < Math.abs(y.get(best)! - y.get(b)!)) best = r;
      doubles.push([b, best]);
    }
    return { pairs, doubles, free: [] };
  }
  const mine = laneMatch(blockers, rushers, (id) => y.get(id)!);
  const taken = new Set(mine);
  blockers.forEach((b, k) => pairs.push([b, mine[k]]));
  return { pairs, doubles, free: rushers.filter((r) => !taken.has(r)) };
}

/** A rep's chance to be won this step. */
function winChance(r: FieldPlayer, b: FieldPlayer, doubled: boolean, t: number): number {
  if (t < PUNCH && hasHabit(b, 'heavyPunch')) return 0;
  const size = sizeEdge(build(r.s), 'contact', build(b.s));
  let rate = KNOBS.rushWin * Math.exp(KNOBS.rushSkill * (r.s.rush - b.s.pro + size));
  if (r.role === 'EDGE' && hasHabit(r, 'bendsArc')) rate *= HABIT_EDGE;
  if (hasHabit(b, 'twoTapSet')) rate *= HABIT_EDGE;
  if (doubled) rate *= KNOBS.double;
  return 1 - Math.exp(-rate * STEP);
}

/** Today's outcomes that send a rusher to him, and how close he is when he gets there (yards). */
const ARRIVE: Partial<Record<PocketOutcome, number>> = { hit: 0.4, pressure: 2, away: 2, scramble: 2.5, sack: 0.6 };
/** He feels a won rep this long before the throw at the latest: a pressure's rep is won by then (`PRESSURE_REACT`). */
const FEEL = 0.9;
/** An unblamed sack comes no sooner than this: the coverage held, or he held the ball. */
const COVERAGE_SACK = 3.5;
/** Nobody but the man today's outcome sends gets this close to him before his moment. */
const KEEP_OFF = 2.5;
/** Footwork in the pocket (yards a second): a step up, a slide, a climb. */
const POCKET_PACE = 2.5;
/** A step up into a clean pocket, a climb or slide away from pressure, a drift (yards). */
const STEP_UP = 1;
const SLIDE = 1.5;
const DRIFT = 1;
/** A scramble's first strides go out at an angle, then upfield (seconds). */
const ANGLE_FOR = 0.6;
/** Seconds a man who bails early leaves before the break. */
const BAIL = 0.4;
/** A scramble's pocket runs on at most this long past its planned end to see him across the line. */
const OVER = 4;

/** The most speed a man can carry and still stop within `room` yards. */
const stoppable = (room: number) => Math.sqrt(2 * BRAKE * Math.max(0, room));

export function runPocket(start: PocketStart, rng: Rng): PocketResult {
  const P = start.players;
  const n = P.length;
  const dir = start.dir;
  const B: Body[] = P.map((p) => bodyOf(p, false));
  const index = new Map(P.map((p, i) => [p.id, i]));
  const qi = index.get(start.qb)!;
  const QP = P[qi];
  const { pairs, doubles, free } = pairUp(start);
  const on = new Int16Array(n).fill(-1);
  const helper = new Int16Array(n).fill(-1);
  const wonAt = new Float64Array(n).fill(-1);
  const lostTo = new Int16Array(n).fill(-1);
  for (const [b, r] of pairs) on[index.get(r)!] = index.get(b)!;
  for (const [b, r] of doubles) helper[index.get(r)!] = index.get(b)!;
  for (const r of free) wonAt[index.get(r)!] = 0;
  const rushing = start.rushers.map((id) => index.get(id)).filter((i): i is number => i !== undefined);

  const outcome = start.outcome;
  const runs = outcome === 'scramble' || outcome === 'escape';
  const arrive = ARRIVE[outcome];
  // His moment: the ball out, the sack, or the break.
  const breakT = runs ? Math.max(0.6, start.throwAt - (hasHabit(QP, 'bailsEarly') ? BAIL : 0)) : Infinity;
  const homeT =
    outcome === 'sack'
      ? start.blamed
        ? start.throwAt
        : Math.max(start.throwAt, COVERAGE_SACK)
      : outcome === 'scramble'
        ? breakT
        : outcome === 'clean' || outcome === 'escape'
          ? Infinity
          : start.throwAt;
  /** Until then nobody gets near him unless sent. */
  const quietUntil = runs ? breakT : outcome === 'clean' ? start.throwAt : homeT;
  const react = Math.max(0.05, 0.3 - 0.05 * (QP.s.poise - 12));
  let chosen = -1;

  const steps0 = Math.max(2, Math.ceil(start.end / STEP) + 1);
  const most = runs ? steps0 + Math.ceil(OVER / STEP) : steps0;
  const frames: number[] = [];
  const record = () => {
    for (let i = 0; i < n; i++) frames.push(B[i].x, B[i].y);
  };
  record();
  let breakout: number | null = null;
  let side = 0;
  const setX = start.los - dir * start.setDepth;
  const q = B[qi];

  const reach = (ri: number) => Math.hypot(q.x - B[ri].x, q.y - B[ri].y) / B[ri].top + SHED;
  const choose = (ri: number, t: number) => {
    chosen = ri;
    if (wonAt[ri] < 0) wonAt[ri] = t;
    if (on[ri] >= 0) lostTo[ri] = on[ri];
    on[ri] = -1;
  };

  for (let s = 1; s < most; s++) {
    if (s >= steps0 && (!runs || breakout !== null)) break;
    const t = (s - 1) * STEP;

    // The reps: every draw taken, won or not, so one rep never shifts another.
    let best = -1;
    let bestRate = -1;
    for (const ri of rushing) {
      const roll = rng.next();
      const bi = on[ri];
      if (bi < 0 || wonAt[ri] >= 0) continue;
      const pWin = winChance(P[ri], P[bi], helper[ri] >= 0, t);
      if (pWin > bestRate) [best, bestRate] = [ri, pWin];
      if (roll >= pWin) continue;
      // A win today's outcome wants: the first in time to get there; any other is held off.
      if (arrive !== undefined && chosen < 0 && reach(ri) <= homeT - t + 0.3) choose(ri, t);
    }
    // A free man the outcome can use from the snap.
    if (arrive !== undefined && chosen < 0)
      for (const r of free) {
        const ri = index.get(r)!;
        if (reach(ri) <= homeT - t + 0.3) {
          choose(ri, 0);
          break;
        }
      }
    // Nobody won in time: the likeliest rep is won as late as still gets him there.
    if (arrive !== undefined && chosen < 0 && best >= 0) {
      const need = reach(best) + (outcome === 'sack' ? 0 : FEEL);
      if (homeT - t <= need) choose(best, t);
    }

    // The quarterback.
    let qWant = { vx: 0, vy: 0 };
    if (runs && t >= breakT) {
      if (!side) {
        if (outcome === 'scramble' && chosen >= 0) side = Math.sign(q.y - B[chosen].y) || 1;
        else {
          // The widest lane: the nearer rusher on each side, an edge who loses contain counting double.
          const lane = (sd: number) => {
            let g = 30;
            for (const ri of rushing) {
              const dy = (B[ri].y - q.y) * sd;
              if (dy <= 0) continue;
              const w = dy * (hasHabit(P[ri], 'losesContainment') ? 2 : 1);
              g = Math.min(g, w);
            }
            return g;
          };
          side = lane(1) >= lane(-1) ? 1 : -1;
        }
      }
      const out = t - breakT < ANGLE_FOR;
      const ax = out ? 0.7 : 1;
      const ay = out ? 0.7 * side : 0;
      qWant = { vx: dir * ax * q.top, vy: ay * q.top };
    } else if (t < Math.min(start.throwAt, homeT, breakT)) {
      // The drop, then the pocket: a step up when it's clean, away from the man coming when it isn't.
      let tx = setX;
      let ty = q.y;
      const set = (q.x - setX) * dir <= 0.3;
      if (set) {
        // He steps up only into room: never toward a man already near him.
        let near = Infinity;
        for (const ri of rushing) near = Math.min(near, Math.hypot(B[ri].x - q.x, B[ri].y - q.y));
        tx = near < KEEP_OFF + 1 ? q.x : setX + dir * STEP_UP - (hasHabit(QP, 'muddyPockets') ? dir * DRIFT : 0);
        if (outcome === 'sack' && start.sackX !== undefined) tx = start.sackX;
        if (chosen >= 0 && t >= wonAt[chosen] + react && outcome !== 'sack') {
          const r = B[chosen];
          const ax = q.x - r.x;
          const ay = q.y - r.y;
          const a = Math.hypot(ax, ay) || 1;
          ty = q.y + (ay / a) * SLIDE * (outcome === 'away' ? 2.5 : 1);
          // Round him (the rusher behind his depth): he climbs.
          if ((r.x - q.x) * dir < 0) tx = setX + dir * SLIDE;
        }
      }
      const gx = tx - q.x;
      const gy = ty - q.y;
      const g = Math.hypot(gx, gy);
      const pace = set ? Math.min(POCKET_PACE, g / STEP) : Math.min(q.top, g / STEP);
      if (g > 0.05) qWant = { vx: (gx / g) * pace, vy: (gy / g) * pace };
    } else if (outcome === 'sack' && start.sackX !== undefined && Math.abs(start.sackX - q.x) > 0.3) {
      const gx = start.sackX - q.x;
      qWant = { vx: Math.sign(gx) * Math.min(POCKET_PACE, Math.abs(gx) / STEP), vy: 0 };
    }
    stepBody(q, qWant, STEP);
    if (runs && breakout === null && (q.x - start.los) * dir >= 0) breakout = s;

    // The rushers.
    for (const ri of rushing) {
      const r = B[ri];
      const dx = q.x - r.x;
      const dy = q.y - r.y;
      const d = Math.hypot(dx, dy) || 1;
      const bi = on[ri];
      if (bi >= 0 && Math.hypot(B[bi].x - r.x, B[bi].y - r.y) <= MEET) {
        const push = (hasHabit(P[ri], 'bullRush') ? BULL : PUSH) * (hasHabit(P[bi], 'anchor') ? 0.5 : 1);
        const sp = Math.hypot(r.vx, r.vy);
        if (sp > push) {
          r.vx *= push / sp;
          r.vy *= push / sp;
        }
        stepBody(r, { vx: (dx / d) * push, vy: (dy / d) * push }, STEP);
        continue;
      }
      let pace = wonAt[ri] >= 0 && t - wonAt[ri] < SHED ? r.top * 0.5 : r.top;
      if (ri === chosen && arrive !== undefined) {
        // On him at his moment, as close as today's outcome says.
        const left = homeT - t;
        const gap = t >= homeT ? (outcome === 'pressure' || outcome === 'away' ? arrive : 0.6) : arrive;
        pace = Math.min(pace, Math.max(0, d - gap) / Math.max(left, STEP));
      } else if (t < quietUntil) pace = Math.min(pace, stoppable(d - KEEP_OFF));
      stepBody(r, { vx: (dx / d) * pace, vy: (dy / d) * pace }, STEP);
    }

    // Blockers: between their man and the quarterback, a hold's gap off him; a double team side by side.
    for (let bi = 0; bi < n; bi++) {
      if (P[bi].side !== 0 || bi === qi) continue;
      const b = B[bi];
      let target: { x: number; y: number } | null = null;
      for (const ri of rushing) {
        const r = B[ri];
        const ux = q.x - r.x;
        const uy = q.y - r.y;
        const u = Math.hypot(ux, uy) || 1;
        if (on[ri] === bi) target = { x: r.x + (ux / u) * HOLD_GAP, y: r.y + (uy / u) * HOLD_GAP };
        else if (helper[ri] === bi && on[ri] >= 0) {
          const sd = Math.sign(b.y - r.y) || 1;
          target = {
            x: r.x + (ux / u) * HOLD_GAP - (uy / u) * 0.8 * sd,
            y: r.y + (uy / u) * HOLD_GAP + (ux / u) * 0.8 * sd,
          };
        }
      }
      if (!target) {
        stepBody(b, { vx: 0, vy: 0 }, STEP);
        continue;
      }
      const gx = target.x - b.x;
      const gy = target.y - b.y;
      const g = Math.hypot(gx, gy);
      const pace = Math.min(b.top, g / STEP);
      stepBody(b, g > 1e-6 ? { vx: (gx / g) * pace, vy: (gy / g) * pace } : { vx: 0, vy: 0 }, STEP);
    }

    // Nobody through anybody: a rusher never closer than half a yard to the man on him, or the man he beat.
    for (const ri of rushing)
      for (const bi of [on[ri], lostTo[ri], helper[ri]]) {
        if (bi < 0) continue;
        const r = B[ri];
        const b = B[bi];
        const g = Math.hypot(r.x - b.x, r.y - b.y);
        if (g < 0.55 && g > 1e-6) {
          const k = 0.55 / g;
          r.x = b.x + (r.x - b.x) * k;
          r.y = b.y + (r.y - b.y) * k;
        }
      }
    record();
  }

  const rusher = chosen >= 0 && arrive !== undefined && outcome !== 'escape' ? P[chosen].id : null;
  const beat = rusher !== null && start.blamed && lostTo[chosen] >= 0 ? P[lostTo[chosen]].id : null;
  return {
    frames: Float32Array.from(frames),
    rusher,
    beat,
    at: rusher !== null ? homeT : null,
    breakout,
  };
}
