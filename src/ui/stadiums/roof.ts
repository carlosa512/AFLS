/** Roofs: a canopy over the back rows of an open-air ground, and the slab over a roofed one. */
import { at, type Deck, type Post } from './bowl';
import { toFrame } from './camera';
import { mix } from './colour';
import type { Pt } from './pen';
import type { Building, Canopy, Scene, Slab } from './types';

const P = (X: number, Y: number, Z: number): Pt => {
  const p = toFrame(X, Y, Z);
  return [p.x, p.y];
};
const A = (p: Post, d: number, y: number): Pt => {
  const q = at(p, d, y);
  return [q.x, q.y];
};

/** Where a slab is cut (yards beyond the near sideline): just short of the far sideline. */
export const SLAB_CUT = 50;
/** How far a slab reaches: off both sides of the picture, and to the back of the far stand. */
export function slabReach(top: Deck): { xr: number; zb: number } {
  return { xr: 67 + top.d1 + 3 + 18, zb: 26.665 + 33.665 + top.d1 + 3 };
}
/** The height of a slab's top at a spot. */
export function slabTop(s: Slab, x: number, z: number, xr: number, zb: number): number {
  const t = (z - SLAB_CUT) / (zb - SLAB_CUT);
  const p = s.profile;
  if (p.kind === 'flat') return p.h + p.crown * (1 - (x / xr) ** 2) - p.fall * t;
  const mid = p.ends + p.rise * Math.pow(Math.max(0, 1 - (x / xr) ** 2), 0.8);
  return p.back + (mid - p.back) * Math.pow(Math.cos((Math.max(0, Math.min(1, t)) * Math.PI) / 2), 0.9);
}

export function paintCanopy(
  s: Scene,
  c: Canopy,
  wall: Post[],
  light: (p: Post) => number,
  gone: (i: number) => boolean,
) {
  const skin = s.snowy ? mix(c.skin, '#f4f7f8', 0.6) : c.skin;
  for (let i = 0; i < wall.length - 1; i++) {
    if (gone(i)) continue;
    const a = wall[i];
    const b = wall[i + 1];
    s.pen.poly(
      [A(a, c.d0, c.y0), A(b, c.d0, c.y0), A(b, c.d1, c.y1), A(a, c.d1, c.y1)],
      s.tone(skin, light(a) * (i % 4 ? 1 : 0.9)),
    );
  }
  let run: Pt[] = [];
  const end = () => {
    if (run.length > 1) s.pen.line(run, '#2c3338', 0.7);
    run = [];
  };
  wall.forEach((p, i) => (gone(i) ? end() : run.push(A(p, c.d0, c.y0))));
  end();
  for (let i = 5; i < wall.length - 2; i += 7) {
    if (gone(i)) continue;
    const p = at(wall[i], c.d0 + 0.3, c.y0 - 0.2);
    s.pen.box(p.x - 1, p.y, 2, 0.6, s.lamp('#fffbe6'));
  }
}

/** The slab: its top far to near, its opening when it has one and stands open, then the cut face with its structure. */
export function paintSlab(s: Scene, b: Building, sl: Slab, top: Deck) {
  const { pen } = s;
  const { xr, zb } = slabReach(top);
  const nx = 48;
  const nz = 10;
  const X = (i: number) => -xr + (2 * xr * i) / nx;
  const Z = (j: number) => SLAB_CUT + ((zb - SLAB_CUT) * j) / nz;
  const h = (x: number, z: number) => slabTop(sl, x, z, xr, zb);
  const gap = sl.opening && s.look.roof === 'open' ? sl.opening : null;
  const inGap = (x: number, z: number) => !!gap && x > gap.x0 && x < gap.x1 && z < gap.z1;
  const skin = s.snowy ? mix(sl.skin, '#eef2f4', 0.6) : sl.skin;
  const dark = '#14181b';
  for (let j = nz - 1; j >= 0; j--)
    for (let i = 0; i < nx; i++) {
      const x0 = X(i);
      const x1 = X(i + 1);
      const z0 = Z(j);
      const z1 = Z(j + 1);
      if (inGap((x0 + x1) / 2, (z0 + z1) / 2)) continue;
      const tilt = (h(x0, z0) - h(x0, z1)) / (z1 - z0);
      const k = (0.92 + Math.max(-0.14, Math.min(0.12, tilt * 0.5))) * ((i >> 1) % 2 ? 1 : 0.955);
      pen.poly(
        [P(x0, h(x0, z0), z0), P(x1, h(x1, z0), z0), P(x1, h(x1, z1), z1), P(x0, h(x0, z1), z1)],
        s.tone(skin, k),
      );
    }
  for (let i = 0; i <= nx; i += 4) {
    const pts: Pt[] = [];
    for (let j = 0; j <= nz; j++)
      if (!inGap(X(i) + 0.01, Z(j) + 0.01) && !inGap(X(i) - 0.01, Z(j) + 0.01))
        pts.push(P(X(i), h(X(i), Z(j)) + 0.05, Z(j)));
    if (pts.length > 1) pen.line(pts, sl.rib ?? 'rgba(0,0,0,.3)', 0.35);
  }
  const edge = sl.edge ?? '#c7ced3';
  if (sl.opening && !gap)
    pen.line([P(0, h(0, SLAB_CUT) + 0.1, SLAB_CUT), P(0, h(0, sl.opening.z1) + 0.1, sl.opening.z1)], edge, 0.7);
  if (gap) {
    const { x0, x1, z1 } = gap;
    pen.poly(
      [P(x0, h(x0, z1), z1), P(x1, h(x1, z1), z1), P(x1, h(x1, z1) - sl.th, z1), P(x0, h(x0, z1) - sl.th, z1)],
      s.tone(sl.section, 0.8),
    );
    for (const x of [x0, x1])
      pen.poly(
        [
          P(x, h(x, SLAB_CUT), SLAB_CUT),
          P(x, h(x, z1), z1),
          P(x, h(x, z1) - sl.th, z1),
          P(x, h(x, SLAB_CUT) - sl.th, SLAB_CUT),
        ],
        s.tone(sl.section, 0.66),
      );
    pen.line(
      [P(x0, h(x0, SLAB_CUT), SLAB_CUT), P(x0, h(x0, z1), z1), P(x1, h(x1, z1), z1), P(x1, h(x1, SLAB_CUT), SLAB_CUT)],
      edge,
      0.6,
    );
  }
  // the cut: sliced where the near side is sliced, its structure showing in the section
  const runs: number[][] = [[]];
  for (let i = 0; i <= nx; i++) {
    if (gap && X(i) > gap.x0 && X(i) < gap.x1) {
      if (runs[runs.length - 1].length) runs.push([]);
      continue;
    }
    runs[runs.length - 1].push(X(i));
  }
  if (gap) {
    runs[0].push(gap.x0);
    runs[runs.length - 1].unshift(gap.x1);
  }
  for (const run of runs) {
    if (run.length < 2) continue;
    const up = run.map((x) => P(x, h(x, SLAB_CUT), SLAB_CUT));
    const down = run.map((x) => P(x, h(x, SLAB_CUT) - sl.th, SLAB_CUT));
    pen.poly([...up, ...down.slice().reverse()], s.tone(sl.section));
    pen.line(
      run.map((_, k) => (k % 2 ? up[k] : down[k])),
      sl.web ?? 'rgba(40,46,52,.55)',
      0.3,
    );
    pen.line(up, dark, 0.75);
    pen.line(down, dark, 0.75);
    pen.line([up[0], down[0]], dark, 0.75);
    pen.line([up[up.length - 1], down[down.length - 1]], dark, 0.75);
  }
  // the leaves of a roof that stands open, parked either side and lifted
  if (gap && sl.leaves)
    for (const sgn of [-1, 1]) {
      const L = sl.leaves;
      const xi = sgn * L.xi;
      const xo = sgn * L.xo;
      const yi = h(xi, SLAB_CUT) + L.yi;
      const yo = h(xo, SLAB_CUT) + L.yo;
      pen.poly([P(xi, yi, SLAB_CUT), P(xo, yo, SLAB_CUT), P(xo, yo, L.z1), P(xi, yi, L.z1)], s.tone(L.skin));
      pen.poly(
        [P(xi, yi, SLAB_CUT), P(xi, yi, L.z1), P(xi, yi - L.th, L.z1), P(xi, yi - L.th, SLAB_CUT)],
        s.lamp(sl.edge ?? '#ff7a3c'),
      );
      const face: Pt[] = [
        P(xi, yi, SLAB_CUT),
        P(xo, yo, SLAB_CUT),
        P(xo, yo - L.th, SLAB_CUT),
        P(xi, yi - L.th, SLAB_CUT),
      ];
      pen.poly(face, s.tone(sl.section, 0.9));
      pen.line([...face, face[0]], dark, 0.6);
      for (const z of [SLAB_CUT + 1, L.z1 - 1]) pen.line([P(xi, yi - L.th, z), P(xi, h(xi, z), z)], '#8d949a', 0.45);
    }
  void b;
}
