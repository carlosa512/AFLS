/**
 * The land's parts, each drawn in the stadium's own space: car parks, streets, trees and woods, buildings with their
 * floors and windows, water, bridges. People are never drawn here: only the stadium has them.
 */
import { CAM, FRAME, toFrame } from '../camera';
import { shade } from '../colour';
import type { Pt } from '../pen';
import type { Scene } from '../types';

export const P = (X: number, Y: number, Z: number): Pt => {
  const p = toFrame(X, Y, Z);
  return [p.x, p.y];
};
/** A flat patch of ground between two X's and two Z's, at a height. */
export const patch = (x0: number, x1: number, z0: number, z1: number, y = 0): Pt[] => [
  P(x0, y, z0),
  P(x1, y, z0),
  P(x1, y, z1),
  P(x0, y, z1),
];
/** Outside the building and its plaza: nothing of the land is drawn nearer than this. */
export const clearOf = (x: number, z: number) => Math.abs(x) > 124 || z > 112;
/** Whether a spot is in the picture (with a margin), so what is off it is not drawn. */
export const seen = (X: number, Y: number, Z: number, margin = 14): boolean => {
  const p = toFrame(X, Y, Z);
  return p.depth > 1 && p.x > -margin && p.x < FRAME.w + margin && p.y > -margin && p.y < FRAME.h + margin;
};
const pick = <T>(s: Scene, list: readonly T[]): T => list[Math.floor(s.rng.next() * list.length)];

const CARS = ['#d9dcdf', '#b23b3b', '#3b5fa8', '#1f2327', '#c9c2a8', '#8a9096', '#e7e7e2'];
export function car(s: Scene, x: number, z: number) {
  const fill = s.tone(pick(s, CARS));
  if (!seen(x, 0.5, z, 2)) return;
  const p = toFrame(x, 0.5, z);
  const r = Math.max(0.18, (CAM.f * 0.95) / p.depth);
  s.pen.box(p.x - r, p.y - r * 0.55, r * 2, r * 1.1, fill);
}
/** A car park: bays in rows, a row every 6.5 yards. */
export function lot(s: Scene, x0: number, x1: number, z0: number, z1: number, col = '#4b5056') {
  s.pen.poly(patch(x0, x1, z0, z1), s.tone(col));
  for (let z = z0 + 3; z < z1 - 2; z += 6.5) {
    s.pen.line([P(x0 + 1, 0.05, z + 0.9), P(x1 - 1, 0.05, z + 0.9)], 'rgba(255,255,255,.22)', 0.15);
    for (let x = x0 + 2; x < x1 - 2; x += 2.7) {
      if (s.rng.next() < 0.2) continue;
      car(s, x, z);
      car(s, x, z + 1.8);
    }
  }
  s.pen.flush();
}
/** A street between two points along X or along Z: lane marks every 9 yards, and some traffic. */
export function street(
  s: Scene,
  from: [number, number],
  to: [number, number],
  w: number,
  col = '#6f757a',
  traffic = 0.5,
) {
  const [xa, za] = from;
  const [xb, zb] = to;
  const along = Math.abs(xb - xa) > Math.abs(zb - za);
  s.pen.poly(along ? patch(xa, xb, za - w / 2, za + w / 2) : patch(xa - w / 2, xa + w / 2, za, zb), s.tone(col));
  const len = along ? xb - xa : zb - za;
  for (let k = 3; k < len; k += 9) {
    const x = along ? xa + k : xa;
    const z = along ? za : za + k;
    const side = (s.rng.next() < 0.5 ? -1 : 1) * w * 0.25;
    const busy = s.rng.next() < traffic;
    if (!seen(x, 0, z, 4)) continue;
    s.pen.line([P(x, 0.05, z), P(x + (along ? 4 : 0), 0.05, z + (along ? 0 : 4))], 'rgba(255,255,255,.5)', 0.14);
    if (busy) car(s, x + (along ? 0 : side), z + (along ? side : 0));
  }
  s.pen.flush();
}
const ROUND = ['#2f5a3a', '#3a6a45', '#467a4f', '#356241'];
const PINE = ['#2b4a38', '#34573f', '#3c6248'];
/** A tree: a pine as a cone, a broadleaf as a ball (drawn as a polygon: dots are people). */
export function tree(s: Scene, x: number, z: number, h: number, y0: number, kind: 'pine' | 'round') {
  const fill = s.tone(pick(s, kind === 'pine' ? PINE : ROUND));
  if (!seen(x, y0 + h / 2, z, 8)) return;
  if (kind === 'pine') {
    const w = h * 0.3;
    s.pen.poly([P(x - w, y0, z), P(x + w, y0, z), P(x, y0 + h, z)], fill);
    if (s.snowy)
      s.pen.poly(
        [P(x - w * 0.45, y0 + h * 0.55, z), P(x + w * 0.45, y0 + h * 0.55, z), P(x, y0 + h, z)],
        s.tone('#e9eff2'),
      );
    return;
  }
  const c = toFrame(x, y0 + h * 0.62, z);
  const r = (CAM.f * h * 0.46) / c.depth;
  const ball: Pt[] = [];
  for (let a = 0; a < 8; a++) ball.push([c.x + Math.cos((a * Math.PI) / 4) * r, c.y + Math.sin((a * Math.PI) / 4) * r]);
  s.pen.poly(ball, s.snowy ? s.tone('#dfe7ea') : fill);
}
/** Woods thick enough that no ground shows: a tree every few yards, the far ones first. */
export function woods(
  s: Scene,
  x0: number,
  x1: number,
  z0: number,
  z1: number,
  kind: 'pine' | 'round',
  yOf: (z: number) => number = () => 0,
  every = 4.2,
) {
  const list: [number, number, number][] = [];
  for (let z = z1; z >= z0; z -= every * 0.8)
    for (let x = x0; x < x1; x += every) {
      const xx = x + (s.rng.next() - 0.5) * every;
      const zz = z + (s.rng.next() - 0.5) * every;
      const h = 6 + s.rng.next() * 6;
      if (clearOf(xx, zz)) list.push([xx, zz, h]);
    }
  list.sort((a, b) => b[1] - a[1]).forEach((t) => tree(s, t[0], t[1], t[2], yOf(t[1]), kind));
}
/** Trees along a street. */
export function lined(s: Scene, x0: number, x1: number, z: number, kind: 'pine' | 'round' = 'round') {
  for (let x = x0; x < x1; x += 7) {
    const h = 4.5 + s.rng.next() * 2;
    if (clearOf(x, z)) tree(s, x, z, h, 0, kind);
  }
}
/** A plain block: the side we can see, its top, the face toward us. */
export function box(s: Scene, x: number, z: number, w: number, d: number, h: number, col: string, y0 = 0) {
  const x0 = x - w / 2;
  const x1 = x + w / 2;
  const z1 = z + d;
  const T = y0 + h;
  const sx = x > 0 ? x0 : x1;
  s.pen.poly([P(sx, y0, z), P(sx, y0, z1), P(sx, T, z1), P(sx, T, z)], s.tone(col, 0.68));
  s.pen.poly([P(x0, T, z), P(x1, T, z), P(x1, T, z1), P(x0, T, z1)], s.tone(s.snowy ? '#e6ecef' : col, 1.08));
  s.pen.poly([P(x0, y0, z), P(x1, y0, z), P(x1, T, z), P(x0, T, z)], s.tone(col, 0.86));
}
/** A building with its floors and windows drawn: a floor every 3.5 yards, a window a bay. */
export function tower(s: Scene, x: number, z: number, w: number, d: number, h: number, col: string, glass = '#2c4254') {
  // every draw is made whether or not the building is in the picture, so the land is the same at any size
  const x0 = x - w / 2 + 0.9;
  const x1 = x + w / 2 - 0.9;
  const cols = Math.max(2, Math.round((x1 - x0) / 2.7));
  const cw = (x1 - x0) / cols;
  const sx = x > 0 ? x - w / 2 : x + w / 2;
  const inView = seen(x, 0, z, 60) || seen(x, Math.min(h, 30), z, 60);
  if (inView) {
    box(s, x, z, w, d, h, col);
    s.pen.poly([P(x0, 0, z - 0.03), P(x1, 0, z - 0.03), P(x1, 2.6, z - 0.03), P(x0, 2.6, z - 0.03)], s.tone(col, 0.6));
  }
  const day = s.tone(glass);
  const sky = s.tone('#cfe3ee');
  const lit = s.lamp('#f3dfa2');
  const side = s.tone(shade(glass, 0.75));
  for (let y = 3.4; y + 2.4 < h; y += 3.5) {
    const off = !inView || toFrame(x, y, z).y < -12;
    for (let c = 0; c < cols; c++) {
      const a = s.rng.next();
      if (off) continue;
      const xa = x0 + (c + 0.16) * cw;
      const fill = s.look.night ? (a < 0.45 ? lit : day) : a < 0.16 ? sky : a < 0.32 ? lit : day;
      s.pen.poly(
        [
          P(xa, y, z - 0.03),
          P(xa + cw * 0.68, y, z - 0.03),
          P(xa + cw * 0.68, y + 2.1, z - 0.03),
          P(xa, y + 2.1, z - 0.03),
        ],
        fill,
      );
    }
    if (!off)
      s.pen.poly([P(sx, y, z + 1), P(sx, y, z + d - 1), P(sx, y + 2.1, z + d - 1), P(sx, y + 2.1, z + 1)], side);
  }
  if (inView && h > 14 && toFrame(x, h, z).y > -8)
    box(s, x + w * 0.12, z + d * 0.3, w * 0.3, d * 0.3, 2, shade(col, 0.8), h);
}
/** City blocks on a grid of streets; `height` sets how tall they stand. */
export function city(
  s: Scene,
  o: { z0: number; z1?: number; height: 'low' | 'mid' | 'high'; palette: string[]; ground?: string; glass?: string },
) {
  const R = () => s.rng.next();
  const x0 = -430;
  const x1 = 430;
  const z1 = o.z1 ?? 250;
  s.pen.poly(patch(x0 - 20, x1 + 20, o.z0 - 8, z1 + 60), s.tone(s.snowy ? '#aab2b7' : (o.ground ?? '#7a7f83')));
  const list: [number, number, number, number, number, string][] = [];
  for (let z = o.z0; z < z1; z += 40) {
    street(s, [x0, z - 5], [x1, z - 5], 6);
    lined(s, x0, x1, z - 9.5);
    for (let x = x0; x < x1; x += 46) {
      const split = R() < 0.4;
      for (const part of split ? [-1, 1] : [0]) {
        const w = split ? 17 + R() * 3 : 30 + R() * 8;
        const d = 22 + R() * 8;
        const h = o.height === 'high' ? 22 + R() * R() * 120 : o.height === 'low' ? 6 + R() * 10 : 12 + R() * 34;
        list.push([x + 23 + part * 10.5, z, w, d, h, pick(s, o.palette)]);
      }
    }
  }
  for (let x = x0; x < x1; x += 46) street(s, [x, o.z0 - 8], [x, z1 + 40], 5, '#6f757a', 0.25);
  list
    .sort((a, b) => b[1] - a[1] || Math.abs(b[0]) - Math.abs(a[0]))
    .forEach((b) => tower(s, b[0], b[1], b[2], b[3], b[4], b[5], o.glass));
}
/** Water between two Z's, with a few light lines on it. */
export function water(s: Scene, z0: number, z1: number, col = '#6f9db3') {
  s.pen.poly(patch(-520, 520, z0, z1), s.tone(col));
  for (let z = z0 + 6; z < z1 - 2; z += 7) s.pen.line([P(-520, 0.1, z), P(520, 0.1, z)], 'rgba(255,255,255,.13)', 0.3);
}
/** A bridge over water along Z at an X: a deck on piers under two arches. */
export function bridge(s: Scene, x: number, z0: number, z1: number, col: string) {
  s.pen.poly(patch(x - 3, x + 3, z0 - 6, z1 + 6, 7), s.tone('#7a8187'));
  for (const side of [x - 3, x + 3]) {
    const arch: Pt[] = [];
    for (let k = 0; k <= 16; k++) arch.push(P(side, 7 + 15 * Math.sin((Math.PI * k) / 16), z0 + ((z1 - z0) * k) / 16));
    s.pen.line(arch, s.tone(col), 0.6);
    for (let k = 2; k < 16; k += 2) {
      const z = z0 + ((z1 - z0) * k) / 16;
      s.pen.line([P(side, 7, z), P(side, 7 + 15 * Math.sin((Math.PI * k) / 16), z)], s.tone(col), 0.3);
    }
  }
  for (const z of [z0 + (z1 - z0) * 0.25, z0 + (z1 - z0) * 0.72]) box(s, x, z, 5, 4, 7, '#8d8f8c');
}
export const BRICK = ['#9a6b55', '#8a5a48', '#b08a6e', '#a39584', '#7d6a5c'];
export const STEEL = ['#9aa5ad', '#b9c2c8', '#7f8b94', '#c9c4b6', '#8f989f'];
export const PALE = ['#d9d4c6', '#c9c2b0', '#b8b3a6', '#e3ddd0', '#a9a69c'];
