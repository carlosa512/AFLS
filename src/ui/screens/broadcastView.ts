/**
 * The broadcast view's camera: the stadium's own (`ui/stadiums/camera.ts`), so the field's paint and the play sit in
 * the same space as the building behind them. Field coordinates: x from −10 (the end zone behind the home side's goal
 * line) to 110, y from 0 (the near sideline) to 53.3, h in yards above the grass. Drawn with x running right to left,
 * so the end zone behind x = 100 sits on the left, under the away side of the scorebug.
 */
import { FIELD_W } from '../../engine/field/ballPath';
import { stadiumSpot } from '../stage/ends';
import { FRAME, toFrame } from '../stadiums/camera';

export const VIEW_W = FRAME.w;
/** Tall enough for the far stand, the land beyond it and the bench in front of the near sideline. */
export const VIEW_H = FRAME.h;
/** How far down the camera's line of sight the near sideline is: what is drawn there is drawn full size. */
const NEAR_DEPTH = toFrame(0, 0, 0).depth;

/**
 * A field spot to the picture. Given the quarter, the spot is first put where the stadium has it (teams switch ends
 * each quarter, `stage/ends.ts`); the paint, which never moves, is drawn without one.
 */
export function project(fx: number, fy: number, h = 0, quarter = 1): { x: number; y: number; scale: number } {
  const { x, y } = stadiumSpot(fx, fy, quarter);
  const p = toFrame(50 - x, h, y);
  return { x: p.x, y: p.y, scale: NEAR_DEPTH / p.depth };
}

export const pt = (x: number, y: number, h = 0, quarter = 1): string => {
  const p = project(x, y, h, quarter);
  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
};
/**
 * The four corners of a strip of field from `x0` to `x1`, across it or between two y's. With a quarter, the strip is
 * something a play made (the drive's band), drawn where the stadium has it then.
 */
export const quad = (x0: number, x1: number, y0 = 0, y1 = FIELD_W, quarter = 1): string =>
  `${pt(x0, y0, 0, quarter)} ${pt(x1, y0, 0, quarter)} ${pt(x1, y1, 0, quarter)} ${pt(x0, y1, 0, quarter)}`;

type Vec = [number, number];
/** Screen vectors for one yard along the field's x and along its y at a spot: what lays a shape flat on the grass. */
export function groundFrame(x: number, y: number): { dx: Vec; dy: Vec } {
  // read off the camera half a yard either side: it is not a straight-line map, so the frame differs spot to spot
  const a = project(x - 0.5, y);
  const b = project(x + 0.5, y);
  const c = project(x, y - 0.5);
  const d = project(x, y + 0.5);
  return { dx: [b.x - a.x, b.y - a.y], dy: [d.x - c.x, d.y - c.y] };
}
const neg = (v: Vec): Vec => [-v[0], -v[1]];

/** An SVG matrix that puts a drawing, in yards, flat on the grass at a spot: `right` and `down` are its axes there. */
export function flat(x: number, y: number, right: Vec, down: Vec): string {
  const p = project(x, y);
  const f = (n: number) => n.toFixed(3);
  return `matrix(${f(right[0])} ${f(right[1])} ${f(down[0])} ${f(down[1])} ${p.x.toFixed(2)} ${p.y.toFixed(2)})`;
}
/** Flat on the grass and the right way up from the camera: a yard number, the midfield mark. */
export function facing(x: number, y: number): string {
  const f = groundFrame(x, y);
  return flat(x, y, neg(f.dx), neg(f.dy));
}
/**
 * Flat on the grass with its feet toward the field of play: an end zone's letters. Behind x = 100 they read from the
 * near sideline to the far one; behind x = 0, from the far one to the near.
 */
export function endZoneLetter(x: number, y: number): string {
  const f = groundFrame(x, y);
  return x > 50 ? flat(x, y, f.dy, neg(f.dx)) : flat(x, y, neg(f.dy), f.dx);
}
