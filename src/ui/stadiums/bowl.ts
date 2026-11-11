/**
 * The bowl's plan: the wall round the field as a line of posts, and the decks that rake back from it. A row `d` yards
 * behind the wall is the same line pushed out by `d`, so rows bend round the corners together.
 */
import { toFrame } from './camera';

/** A post of the wall: where it stands, which way is out, how far along the wall it is, and which stretch it is in. */
export interface Post {
  x: number;
  z: number;
  nx: number;
  nz: number;
  u: number;
  i: number;
  part: 'L' | 'LC' | 'F' | 'RC' | 'R';
}
/** Yards of apron beyond each sideline and end line, the corners' radius, and where the near side is cut away. */
export const PLAN = { apron: 7, corner: 12, cut: -12 };
/** Half the field's length with its end zones, and its width. */
const HALF_LEN = 60;
const WIDTH = 53.33;

/** The wall, from the near-left end, up it, round the far side and down the right end. */
export function wallLine(): Post[] {
  const hx = HALF_LEN + PLAN.apron;
  const zc = WIDTH / 2;
  const hz = zc + PLAN.apron;
  const r = PLAN.corner;
  const p: Omit<Post, 'u' | 'i'>[] = [];
  for (let z = PLAN.cut; z < zc + hz - r; z += 1) p.push({ x: -hx, z, nx: -1, nz: 0, part: 'L' });
  for (let a = 0; a <= 1.0001; a += 1 / 28) {
    const g = Math.PI - (a * Math.PI) / 2;
    p.push({
      x: -(hx - r) + r * Math.cos(g),
      z: zc + hz - r + r * Math.sin(g),
      nx: Math.cos(g),
      nz: Math.sin(g),
      part: 'LC',
    });
  }
  for (let x = -(hx - r) + 1; x < hx - r; x += 1) p.push({ x, z: zc + hz, nx: 0, nz: 1, part: 'F' });
  for (let a = 0; a <= 1.0001; a += 1 / 28) {
    const g = Math.PI / 2 - (a * Math.PI) / 2;
    p.push({
      x: hx - r + r * Math.cos(g),
      z: zc + hz - r + r * Math.sin(g),
      nx: Math.cos(g),
      nz: Math.sin(g),
      part: 'RC',
    });
  }
  for (let z = zc + hz - r - 1; z >= PLAN.cut; z -= 1) p.push({ x: hx, z, nx: 1, nz: 0, part: 'R' });
  let u = 0;
  return p.map((q, i) => {
    if (i) u += Math.hypot(q.x - p[i - 1].x, q.z - p[i - 1].z);
    return { ...q, u, i };
  });
}

/** A point `d` yards behind the wall at a post, `y` yards up, in the frame. */
export const at = (p: Post, d: number, y: number) => toFrame(p.x + p.nx * d, y, p.z + p.nz * d);

/** A deck: from `d0` to `d1` yards behind the wall, rising from `y0` to `y1`, in `rows`, with a front face this tall. */
export interface Deck {
  d0: number;
  d1: number;
  y0: number;
  y1: number;
  rows: number;
  face: number;
}
/** The decks every building shares unless it says otherwise: kept low, so the roof or the land has room. */
export const DECKS: Deck[] = [
  { d0: 0, d1: 14, y0: 1.1, y1: 6.6, rows: 14, face: 1.1 },
  { d0: 13, d1: 19, y0: 9, y1: 11.8, rows: 6, face: 1.6 },
  { d0: 18, d1: 31, y0: 13.8, y1: 21.4, rows: 14, face: 1.8 },
];
