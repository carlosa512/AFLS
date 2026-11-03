/**
 * The carrier's read: a fan of headings, each scored by the ground he can gain along it before a free defender can get
 * to his path (blocks in the way count, the sideline counts against), with noise his awareness sets. He takes the
 * best, or the sideline when the clock wants him out or he's cornered.
 */
import type { Rng } from '../rng';
import type { Body } from './body';
import { FIELD_W, MID } from './geometry';
import { FAN, FAN_STEP, LOOK, READ_NOISE } from './tuning';

export interface Reader {
  /** Where the defenders who can still make a play are, and when each could be anywhere: speed, reaction, a block. */
  chasers: { x: number; y: number; top: number; late: number }[];
  dir: 1 | -1;
  goalX: number;
  clock: { outOfBounds: boolean; stayIn: boolean };
  reads: number;
  /** He wastes ground going sideways (`runsEastWest`). */
  eastWest: boolean;
  /** He'd rather run out than take a hit (`contactAverse`). */
  averse: boolean;
  /** The heading he's on (unit vector): he keeps it unless another is clearly better. */
  prev?: { x: number; y: number };
}

/** A new lane must beat the one he's in by this much (yards) before he changes course: he commits, he doesn't wobble. */
const COMMIT = 1.5;
/** In the hurry-up he takes what he can and gets out once someone can reach him within this many yards. */
const HURRY_OUT = 5;
/** In the hurry-up, a free defender this close (yards) sends him out when the sideline is near. */
const HURRY_NEAR = 6;
/** Cornered: no lane worth this many yards (with noise) and the sideline within 4. */
const CORNERED = 3;
/** What a run out of bounds is worth in the hurry-up over the same yards tackled in bounds (yards). */
const OUT_BONUS = 5;

/** How far upfield he gets along heading `(ux, uy)` before somebody can be there. */
function gain(c: Body, ux: number, uy: number, r: Reader): number {
  // His time to cover `s` yards from the speed he has, accelerating to his top.
  const top = Math.max(c.top, 1);
  const v0 = Math.min(top, Math.max(0, c.vx * ux + c.vy * uy));
  const ramp = (top * top - v0 * v0) / (2 * c.accel);
  const timeTo = (s: number) =>
    s <= ramp ? (-v0 + Math.sqrt(v0 * v0 + 2 * c.accel * s)) / c.accel : (top - v0) / c.accel + (s - ramp) / top;
  let got = 0;
  for (let s = 1; s <= LOOK; s++) {
    const x = c.x + ux * s;
    const y = c.y + uy * s;
    // The sideline ends the run: in the hurry-up getting there is worth it (the clock stops), otherwise it's a wall.
    if (y < 1 || y > FIELD_W - 1) return r.clock.outOfBounds ? got + OUT_BONUS : got;
    const t = timeTo(s);
    let reached = false;
    for (const d of r.chasers)
      if (Math.hypot(x - d.x, y - d.y) / d.top + d.late <= t) {
        reached = true;
        break;
      }
    if (reached) break;
    got = (x - c.x) * r.dir;
    if ((x - r.goalX) * r.dir >= 0) return got + 5;
  }
  return got;
}

/** The velocity he wants for the next while. */
export function readField(c: Body, r: Reader, rng: Rng): { vx: number; vy: number } {
  const sd = Math.max(0.5, READ_NOISE * (1 - 0.05 * (r.reads - 12)));
  let best = -Infinity;
  let bx: number = r.dir;
  let by = 0;
  const side = c.y < MID ? -1 : 1;
  let sidelineScore = -Infinity;
  for (let a = -FAN; a <= FAN; a += FAN_STEP) {
    const th = (a * Math.PI) / 180;
    const ux = r.dir * Math.cos(th);
    const uy = Math.sin(th);
    // A long lane is misjudged by more than a short one: nobody misreads a two-yard gap by three.
    const g = gain(c, ux, uy, r);
    let score = g + rng.normal(0, sd * (0.3 + 0.7 * Math.min(1, Math.max(0, g) / 10)));
    if (r.eastWest && Math.abs(a) > 40) score += 1;
    if (r.prev && ux * r.prev.x + uy * r.prev.y > Math.cos(((FAN_STEP / 2) * Math.PI) / 180)) score += COMMIT;
    if (a === side * FAN) sidelineScore = score;
    if (score > best) [best, bx, by] = [score, ux, uy];
  }
  const toLine = side < 0 ? c.y : FIELD_W - c.y;
  const out = () => ({ vx: r.dir * 0.35 * c.top, vy: side * 0.94 * c.top });
  const pressed = r.chasers.some((d) => d.late < 1 && Math.hypot(d.x - c.x, d.y - c.y) < HURRY_NEAR);
  if (r.clock.outOfBounds && (toLine < 3 || best < HURRY_OUT || sidelineScore >= best - 2 || (pressed && toLine < 8))) {
    if (toLine < 3 || pressed) return out();
    const th = (side * FAN * Math.PI) / 180;
    return { vx: r.dir * Math.cos(th) * c.top, vy: Math.sin(th) * c.top };
  }
  const cornered = best < CORNERED && toLine < 4;
  if (cornered && !r.clock.stayIn) return out();
  if (r.averse && !r.clock.stayIn && best < 2 && toLine < 6) return out();
  return { vx: bx * c.top, vy: by * c.top };
}
