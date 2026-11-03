/**
 * A defender within reach of the carrier (spec §2, "Contests"). The carrier may try a move first, chosen by his skills,
 * his room and his habits; then the tackle: open-field tackling against breaking tackles, adjusted for size, the angle,
 * his speed and a second man arriving. A tackle carries the pile on; a broken tackle slows him; a miss sends the
 * defender on past and down. Every draw is always taken, so one contest never shifts another's.
 */
import type { Rng } from '../rng';
import { sizeEdge, type SizedBuild } from '../size';
import { hasHabit, type Body } from './body';
import { pickMove, type MoveKind } from './carrier';
import { KNOBS } from './tuning';
import type { FieldPlayer, FieldSkills, FieldStart } from './types';

export type Angle = 'head' | 'side' | 'behind';

export interface Contact {
  out: 'tackle' | 'broken' | 'missed';
  move?: MoveKind;
  /** Yards he carries the pile on after a tackle. */
  afterContact: number;
  /** A move he runs from here: how long it lasts (seconds) and the velocity he wants through it. */
  program: { dur: number; want: { vx: number; vy: number } } | null;
}

/** Tackle odds by where the tackler comes from. */
const ANGLE: Record<Angle, number> = { head: 0.05, side: 0, behind: -0.12 };
/** How far a tackle carries on, by the angle: a head-on hit stops him, one from behind rides him forward. */
const CARRY: Record<Angle, number> = { head: 0.6, side: 1, behind: 1.3 };
/** A move: how long it lasts (seconds), his pace through it (a share of his speed, or yards a second), the step across. */
const MOVES: Record<MoveKind, { dur: number; pace: (v: number) => number; across: number }> = {
  juke: { dur: 0.25, pace: (v) => Math.max(0.6 * v, 3), across: 1.5 },
  jumpCut: { dur: 0.35, pace: (v) => Math.min(v, 4), across: 2 },
  spin: { dur: 0.45, pace: () => 3.5, across: 0.6 },
  runThrough: { dur: 0.3, pace: (v) => 0.6 * v, across: 0 },
  stiffArm: { dur: 0.4, pace: (v) => 0.8 * v, across: 0 },
};

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const build = (s: FieldSkills): SizedBuild => ({
  position: s.pos,
  heightIn: s.h,
  weightLb: s.w,
  ...(s.big ? { playsBig: true as const } : {}),
});
const habitSet = (p: FieldPlayer) => new Set(p.s.habits ?? []);

/** Yards he carries the pile on after a tackle: momentum, power and size against the tackler, the angle, help. */
export function afterContactYards(cp: FieldPlayer, speed: number, dp: FieldPlayer, angle: Angle, help: number): number {
  if (hasHabit(dp, 'thumper')) return 0;
  let y =
    KNOBS.afterContact * (speed / 6) * CARRY[angle] +
    0.1 * KNOBS.skill * (KNOBS.carrier * (cp.s.power - 12) - (dp.s.tackle - 12)) +
    0.2 * sizeEdge(build(cp.s), 'contact', build(dp.s));
  if (hasHabit(cp, 'finishesForward')) y += 0.8;
  if (hasHabit(cp, 'contactAverse')) y *= 0.5;
  if (help > 0) y *= 0.5;
  return Math.max(0, y);
}

export function contest(
  cp: FieldPlayer,
  c: Body,
  dp: FieldPlayer,
  d: Body,
  help: number,
  angle: Angle,
  start: FieldStart,
  rng: Rng,
  /** No other defender within two yards: room for a move. */
  room: boolean,
  /** He left his feet from beyond arm's reach: no move to beat (the carrier doesn't see it), worse odds. */
  dive = false,
): Contact {
  const speed = Math.hypot(c.vx, c.vy);
  const size = sizeEdge(build(cp.s), 'contact', build(dp.s));
  const moveSkill = start.kind === 'return' ? cp.s.ret + start.edge : cp.s.move;
  const how: 'size' | 'move' = cp.s.power + size > moveSkill ? 'size' : 'move';
  // Every draw, every time: the try, the move, its success, the tackle.
  const tryRoll = rng.next();
  const kind = pickMove(how, habitSet(cp), habitSet(dp), rng);
  const moveRoll = rng.next();
  const tackleRoll = rng.next();

  if (!dive && room && speed >= 3 && tryRoll < 0.35 + 0.02 * (moveSkill - 12)) {
    const success = clamp(
      KNOBS.move + 0.025 * KNOBS.skill * (KNOBS.carrier * (moveSkill - 12) - (dp.s.tackle - 12)),
      0.05,
      0.6,
    );
    if (moveRoll < success)
      return {
        out: how === 'size' && kind !== 'juke' ? 'broken' : 'missed',
        move: kind,
        afterContact: 0,
        program: program(kind, c, d, speed),
      };
    // A move that doesn't come off costs him a step.
    c.vx *= 0.85;
    c.vy *= 0.85;
  }

  let p =
    KNOBS.tackle +
    0.025 * KNOBS.skill * (dp.s.tackle - 12 - KNOBS.carrier * (cp.s.power - 12)) -
    0.03 * size +
    ANGLE[angle] +
    0.12 * help -
    0.02 * Math.max(0, speed - 6);
  if (start.kind === 'return') p += KNOBS.retTackle;
  if (dive) p += KNOBS.dive;
  if (hasHabit(dp, 'armTackler')) p -= 0.08;
  if (hasHabit(cp, 'highKnee')) p -= 0.05;
  if (hasHabit(dp, 'businessDecision') && cp.s.w >= 225) p -= 0.15;
  if (tackleRoll < clamp(p, 0.3, 0.97))
    return { out: 'tackle', afterContact: afterContactYards(cp, speed, dp, angle, help), program: null };
  return {
    out: how === 'size' && !hasHabit(cp, 'contactAverse') ? 'broken' : 'missed',
    afterContact: 0,
    program: null,
  };
}

/** The move as velocities: on along his line at the move's pace, across to the side away from the man. */
function program(kind: MoveKind, c: Body, d: Body, speed: number): Contact['program'] {
  const m = MOVES[kind];
  const v = Math.max(speed, 0.1);
  const hx = c.vx / v;
  const hy = c.vy / v;
  // Away from the defender: the side of his line the defender isn't on.
  const his = Math.sign(-hy * (d.x - c.x) + hx * (d.y - c.y)) || 1;
  const sx = -hy * -his;
  const sy = hx * -his;
  const pace = m.pace(speed);
  const across = m.across / m.dur;
  return { dur: m.dur, want: { vx: hx * pace + sx * across, vy: hy * pace + sy * across } };
}

/** How long a move lasts (seconds). */
export const moveDuration = (kind: MoveKind) => MOVES[kind].dur;
