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
import { KNOBS, STEP } from './tuning';
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
/** On him: a rusher this close to the quarterback has got home. */
const HOME = 1;
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

export function runPocket(start: PocketStart, rng: Rng): PocketResult {
  const P = start.players;
  const n = P.length;
  const B: Body[] = P.map((p) => bodyOf(p, false));
  const index = new Map(P.map((p, i) => [p.id, i]));
  const qi = index.get(start.qb)!;
  const { pairs, doubles, free } = pairUp(start);
  /** Per rusher: the blocker on him (-1 once the rep is won or for a free man), and when he won it. */
  const on = new Int16Array(n).fill(-1);
  const helper = new Int16Array(n).fill(-1);
  const wonAt = new Float64Array(n).fill(-1);
  const lostTo = new Int16Array(n).fill(-1);
  for (const [b, r] of pairs) on[index.get(r)!] = index.get(b)!;
  for (const [b, r] of doubles) helper[index.get(r)!] = index.get(b)!;
  for (const r of free) wonAt[index.get(r)!] = 0;
  const rushing = start.rushers.map((id) => index.get(id)).filter((i): i is number => i !== undefined);

  const steps = Math.max(2, Math.ceil(start.end / STEP) + 1);
  const frames = new Float32Array(steps * n * 2);
  const record = (s: number) => {
    for (let i = 0; i < n; i++) {
      frames[(s * n + i) * 2] = B[i].x;
      frames[(s * n + i) * 2 + 1] = B[i].y;
    }
  };
  record(0);
  let rusher: number | null = null;
  let beat: number | null = null;
  let homeAt: number | null = null;
  const setX = start.los - start.dir * start.setDepth;

  for (let s = 1; s < steps; s++) {
    const t = (s - 1) * STEP;
    const q = B[qi];
    // Every rep's draw, won or not, so one rep never shifts another.
    for (const ri of rushing) {
      const roll = rng.next();
      const bi = on[ri];
      if (bi < 0 || wonAt[ri] >= 0) continue;
      if (roll < winChance(P[ri], P[bi], helper[ri] >= 0, t)) {
        wonAt[ri] = t;
        lostTo[ri] = bi;
        on[ri] = -1;
      }
    }
    // The quarterback sets at his depth.
    const qx = setX - q.x;
    const qWant = Math.abs(qx) > 0.2 ? { vx: Math.sign(qx) * q.top, vy: 0 } : { vx: 0, vy: 0 };
    stepBody(q, qWant, STEP);
    // Rushers: engaged ones push toward him, won and free ones go after him.
    for (const ri of rushing) {
      const r = B[ri];
      const dx = q.x - r.x;
      const dy = q.y - r.y;
      const d = Math.hypot(dx, dy) || 1;
      const bi = on[ri];
      if (bi >= 0 && Math.hypot(B[bi].x - r.x, B[bi].y - r.y) <= MEET) {
        const push = (hasHabit(P[ri], 'bullRush') ? BULL : PUSH) * (hasHabit(P[bi], 'anchor') ? 0.5 : 1);
        // Into the block: his momentum is the pair's.
        const sp = Math.hypot(r.vx, r.vy);
        if (sp > push) {
          r.vx *= push / sp;
          r.vy *= push / sp;
        }
        stepBody(r, { vx: (dx / d) * push, vy: (dy / d) * push }, STEP);
      } else {
        const pace = wonAt[ri] >= 0 && t - wonAt[ri] < SHED ? r.top * 0.5 : r.top;
        stepBody(r, { vx: (dx / d) * pace, vy: (dy / d) * pace }, STEP);
      }
      if (homeAt === null && Math.hypot(q.x - r.x, q.y - r.y) <= HOME && (wonAt[ri] >= 0 || on[ri] < 0)) {
        homeAt = t + STEP;
        rusher = P[ri].id;
        beat = lostTo[ri] >= 0 && start.blamed ? P[lostTo[ri]].id : null;
      }
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
          const side = Math.sign(b.y - r.y) || 1;
          target = {
            x: r.x + (ux / u) * HOLD_GAP - (uy / u) * 0.8 * side,
            y: r.y + (uy / u) * HOLD_GAP + (ux / u) * 0.8 * side,
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
    record(s);
  }
  return { frames, rusher, beat, at: homeAt, breakout: null };
}
