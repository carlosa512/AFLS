/**
 * The broadcast view's camera: the field seen from the near sideline, wider at the front than at the back, with
 * height drawn up the screen. Field coordinates: x from −10 (the end zone behind the home side's goal line) to 110, y
 * from 0 (the near sideline) to 53.3, h in yards above the grass. Drawn with x running right to left, so the end zone
 * behind x = 100 sits on the left, under the away side of the scorebug.
 */
import { FIELD_W } from '../../engine/field/ballPath';
import { stadiumSpot } from '../stage/ends';

export const VIEW_W = 360;
/** Tall enough for the stand behind the far sideline and the bench in front of the near one. */
export const VIEW_H = 188;
export const NEAR = { y: 168, w: 346 };
export const FAR = { y: 68, w: 226 };

/**
 * A field spot to the picture. Given the quarter, the spot is first put where the stadium has it (teams switch ends
 * each quarter, `stage/ends.ts`); the paint, which never moves, is drawn without one.
 */
export function project(fx: number, fy: number, h = 0, quarter = 1): { x: number; y: number; scale: number } {
  const { x, y } = stadiumSpot(fx, fy, quarter);
  const t = y / FIELD_W;
  const rowW = NEAR.w + (FAR.w - NEAR.w) * t;
  const scale = rowW / NEAR.w;
  return { x: VIEW_W / 2 + ((50 - x) / 120) * rowW, y: NEAR.y + (FAR.y - NEAR.y) * t - h * 2.2 * scale, scale };
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
  const rowW = NEAR.w + (FAR.w - NEAR.w) * (y / FIELD_W);
  return { dx: [-rowW / 120, 0], dy: [(((50 - x) / 120) * (FAR.w - NEAR.w)) / FIELD_W, (FAR.y - NEAR.y) / FIELD_W] };
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
