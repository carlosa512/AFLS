/**
 * A ball carrier's moves as path segments (spec: docs/superpowers/specs/2026-11-02-all-22-open-field-design.md §3):
 * the engine says a tackle was broken, by size or by a move; the film picks which move (the habits first) and draws
 * it as the carrier's path, every segment tagged with the move so the stager can script the man who missed against
 * it. Path only: no new marks or icons, the move reads off how the dot runs. Pure: no draws but the one it's given.
 */
import type { QuirkId } from '../../engine/quirks';
import type { Rng } from '../../engine/rng';
import { FIELD_W, type Seg } from './ballPath';
import type { Pt } from './formations';

export type MoveKind = 'juke' | 'jumpCut' | 'spin' | 'runThrough' | 'stiffArm';

/** The field a carrier's path stays on: the end zones' back lines and a yard in from each sideline. */
const X_MIN = -9;
const X_MAX = 109;
const Y_MIN = 1;
const Y_MAX = FIELD_W - 1;

export const clampToField = (p: Pt): Pt => ({
  x: Math.max(X_MIN, Math.min(X_MAX, p.x)),
  y: Math.max(Y_MIN, Math.min(Y_MAX, p.y)),
});

/**
 * Which move broke the tackle. The habits come first: a contact-averse back never lowers a shoulder (a size break is a
 * juke), a jump-cutter jump-cuts, and a high-knee back, or a man who only gets an arm on him, is run through. Otherwise
 * a size break is a run-through or a stiff arm and a move a juke, a jump cut or a spin. One draw, always taken.
 */
export function pickMove(
  how: 'size' | 'move',
  carrier: ReadonlySet<QuirkId>,
  missed: ReadonlySet<QuirkId>,
  rng: Rng,
): MoveKind {
  const r = rng.next();
  const averse = carrier.has('contactAverse');
  if (how === 'size') return averse ? 'juke' : r < 0.5 ? 'runThrough' : 'stiffArm';
  if (carrier.has('jumpCutter')) return 'jumpCut';
  if (!averse && (carrier.has('highKnee') || missed.has('armTackler'))) return 'runThrough';
  return r < 0.5 ? 'juke' : r < 0.7 ? 'jumpCut' : 'spin';
}

/** A point of a move: yards on along his line of run, yards across to the move's side, his pace getting there. */
interface Step {
  on: number;
  across: number;
  v: number;
}

/** A jump cut's most (yards a second): he gathers, plants both feet and goes. */
const JUMP_PACE = 4;
/** A spin dips to this (yards a second) through its back half. */
const SPIN_PACE = 3.5;
const SPIN_R = 0.6;

function shape(kind: MoveKind, pace: number): Step[] {
  switch (kind) {
    case 'juke':
      // A sharp step a yard and a half to the side, then back on his line, never slowing much.
      return [
        { on: 0.6, across: 1.5, v: pace },
        { on: 2.2, across: 0, v: pace },
      ];
    case 'jumpCut': {
      const v = Math.min(JUMP_PACE, pace);
      return [
        { on: 0.5, across: 2, v },
        { on: 2.5, across: 0, v },
      ];
    }
    case 'spin': {
      // A half loop to the side, slowest at its back.
      const vs = [SPIN_PACE + 1, SPIN_PACE, SPIN_PACE, SPIN_PACE + 1];
      return vs.map((v, i) => {
        const a = Math.PI - ((i + 1) * Math.PI) / 4;
        return { on: SPIN_R + SPIN_R * Math.cos(a), across: SPIN_R * Math.sin(a), v: Math.min(v, pace) };
      });
    }
    case 'runThrough':
      // Straight through the hit, slowed by it (0.3 s at 0.6 of his pace).
      return [{ on: 0.18 * pace, across: 0, v: 0.6 * pace }];
    case 'stiffArm':
      // Straight on, the arm out, a step slower (0.4 s at 0.8 of his pace).
      return [{ on: 0.32 * pace, across: 0, v: 0.8 * pace }];
  }
}

/** How far he can go from `at` along `h` before leaving the field. */
function room(at: Pt, h: Pt): number {
  let t = Infinity;
  if (h.x > 1e-9) t = Math.min(t, (X_MAX - at.x) / h.x);
  if (h.x < -1e-9) t = Math.min(t, (X_MIN - at.x) / h.x);
  if (h.y > 1e-9) t = Math.min(t, (Y_MAX - at.y) / h.y);
  if (h.y < -1e-9) t = Math.min(t, (Y_MIN - at.y) / h.y);
  return Math.max(0, t);
}

/**
 * The carrier's path through a move from `at`, running along `heading` at `pace` (yards a second), the move to
 * `side` (+1: to his left). It starts and ends on his line of run and stays on the field: a move toward a sideline
 * he's on goes the other way, and one that would carry him out shortens. No segment is quicker than his pace.
 */
export function moveSegs(kind: MoveKind, at: Pt, heading: Pt, pace: number, side: 1 | -1): Seg[] {
  const len = Math.hypot(heading.x, heading.y) || 1;
  const h = { x: heading.x / len, y: heading.y / len };
  const steps = shape(kind, pace);
  const wide = Math.max(...steps.map((s) => s.across));
  const across = (s: 1 | -1): Pt => ({ x: -h.y * s, y: h.x * s });
  const out = (s: 1 | -1) => {
    const q = { x: at.x + across(s).x * wide, y: at.y + across(s).y * wide };
    const c = clampToField(q);
    return c.x !== q.x || c.y !== q.y;
  };
  const toward: 1 | -1 = out(side) && !out(-side as 1 | -1) ? (-side as 1 | -1) : side;
  const n = across(toward);
  const reach = Math.max(...steps.map((s) => s.on));
  const k = reach > 0 ? Math.min(1, room(at, h) / reach) : 1;
  const segs: Seg[] = [];
  let from = at;
  for (const s of steps) {
    const to = clampToField({ x: at.x + h.x * s.on * k + n.x * s.across, y: at.y + h.y * s.on * k + n.y * s.across });
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    // (A step the field took away still takes a moment.)
    const dur = Math.max(0.05, dist / Math.max(0.1, s.v));
    segs.push({ x0: from.x, y0: from.y, x1: to.x, y1: to.y, peak: 0, dur, move: kind });
    from = to;
  }
  return segs;
}
