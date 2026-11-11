/** A paddlewheel standing in an open left end. */
import { toFrame } from '../camera';
import type { Pt } from '../pen';
import type { Scene } from '../types';

export function wheel(s: Scene) {
  const X = -84;
  const Y = 14.5;
  const Z = 41;
  const r = 13;
  const col = s.tone(s.colors[0]);
  const pt = (a: number, k = 1): Pt => {
    const p = toFrame(X, Y + Math.sin(a) * r * k, Z + Math.cos(a) * r * k);
    return [p.x, p.y];
  };
  const P = (y: number, z: number): Pt => {
    const p = toFrame(X, y, z);
    return [p.x, p.y];
  };
  for (const k of [1, 0.72]) {
    const ring: Pt[] = [];
    for (let a = 0; a <= 6.31; a += 0.15) ring.push(pt(a, k));
    s.pen.line(ring, col, k === 1 ? 1.5 : 0.7);
  }
  for (let q = 0; q < 14; q++) s.pen.line([pt((q / 14) * 6.283, 0.12), pt((q / 14) * 6.283)], col, 0.6);
  for (const z of [Z - 8, Z + 8]) s.pen.line([P(0, z), P(Y, Z)], s.tone('#e4e2da'), 1.1);
}
