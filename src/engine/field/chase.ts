/**
 * The chase: where a free defender aims (an intercept on where the carrier is heading, read a reaction late, with an
 * angle his pursuit sets), how a deep man keeps leverage, and the odds a blocked man gets off his block.
 */
import type { Body } from './body';
import { FIELD_W, MID } from './geometry';
import { KNOBS } from './tuning';

const unit = (x: number, y: number) => {
  const m = Math.hypot(x, y) || 1;
  return { x: x / m, y: y / m };
};

/** Close in (within 4 yards), a defender aims this far ahead of the carrier (seconds): at him, not his last step. */
const CLOSE_LEAD = 0.15;

/** Seconds for a man at `d` running `top` to meet a mover at `c` going `(vx, vy)`. */
export function interceptTime(c: { x: number; y: number }, vx: number, vy: number, d: Body, top: number): number {
  const rx = c.x - d.x;
  const ry = c.y - d.y;
  const a = vx * vx + vy * vy - top * top;
  const b = 2 * (rx * vx + ry * vy);
  const cc = rx * rx + ry * ry;
  const dist = Math.sqrt(cc) / Math.max(top, 0.5);
  if (Math.abs(a) < 1e-6) return b < 0 ? Math.min(-cc / b, dist * 2) : dist;
  const disc = b * b - 4 * a * cc;
  if (disc < 0) return dist;
  const s = Math.sqrt(disc);
  const roots = [(-b - s) / (2 * a), (-b + s) / (2 * a)].filter((t) => t > 0);
  return roots.length ? Math.min(...roots) : dist;
}

/** The spread of a defender's intercept estimate (a fraction of the time to get there): pursuit sharpens it. */
export const angleSpread = (pursuit: number) => Math.max(0.03, 0.25 * KNOBS.angle * (1 - 0.04 * (pursuit - 12)));

export interface Aim {
  /** The carrier as this defender saw him a reaction ago, and the velocity he saw. */
  seen: { x: number; y: number };
  vx: number;
  vy: number;
  /** His intercept estimate's error this read (1: exact). */
  q: number;
  /** A deep man keeping leverage (a corner or safety). */
  deep: boolean;
  dir: 1 | -1;
  /** Easing off (well behind the play, and no motor for it). */
  eased: boolean;
  react: number;
}

/** Where a free defender aims, and whether he's holding a deep man's leverage point (`chaseWant`). */
export function aimAt(d: Body, a: Aim): { aim: { x: number; y: number }; holding: boolean } {
  // Where the carrier is now, as best he can tell, and where they'd meet.
  const now = { x: a.seen.x + a.vx * a.react, y: a.seen.y + a.vy * a.react };
  const dist = Math.hypot(now.x - d.x, now.y - d.y);
  let aim: { x: number; y: number };
  let holding = false;
  if (a.deep && (d.x - now.x) * a.dir >= 5 && dist > 6) {
    // In front of him, inside-out, giving ground rather than lunging: he holds his depth and mirrors where the carrier
    // will cross it, a step inside, then attacks once he's close.
    const inside = Math.sign(MID - now.y) || 1;
    const closing = Math.max(1, a.vx * a.dir);
    const reach = Math.min(3, ((d.x - now.x) * a.dir) / closing);
    const y = Math.max(1, Math.min(FIELD_W - 1, now.y + a.vy * reach + inside * 1.5));
    aim = { x: d.x, y };
    holding = true;
  } else if (dist < 4) aim = { x: now.x + a.vx * CLOSE_LEAD, y: now.y + a.vy * CLOSE_LEAD };
  else {
    const tau = interceptTime(now, a.vx, a.vy, d, d.top);
    // Where they'd meet, on the field: a man running for the sideline is cut off at it, not chased past it.
    aim = {
      x: now.x + a.vx * tau * a.q,
      y: Math.max(1, Math.min(FIELD_W - 1, now.y + a.vy * tau * a.q)),
    };
  }
  return { aim, holding };
}

/** The velocity a free defender wants. */
export function chaseWant(d: Body, a: Aim): { vx: number; vy: number } {
  const cap = d.top * (a.eased ? 0.85 : 1);
  const { aim, holding } = aimAt(d, a);
  const u = unit(aim.x - d.x, aim.y - d.y);
  const close = Math.hypot(aim.x - d.x, aim.y - d.y);
  // Pull up on a spot he's already at (a deep man's leverage point), rather than overrun it.
  const sp = holding && close < 1.5 ? Math.min(cap, close * 2) : cap;
  return { vx: u.x * sp, vy: u.y * sp };
}

/** The odds a blocked man sheds his block this step. */
export const shedOdds = (shed: number, block: number, dt: number, mult = 1) =>
  Math.min(1, KNOBS.shed * mult * Math.exp(0.12 * KNOBS.skill * (shed - block)) * dt);
