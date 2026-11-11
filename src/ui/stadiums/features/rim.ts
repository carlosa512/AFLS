/** Things that stand on the far wall or round the rim: fin blades, a ship's masts, a castle's towers. */
import { at, DECKS } from '../bowl';
import { lift } from '../colour';
import type { Pt } from '../pen';
import type { Bowl } from '../stands';
import type { Building, FeatureUse, Scene } from '../types';

const topOf = (b: Building) => (b.decks ?? DECKS)[(b.decks ?? DECKS).length - 1];
const farPost = (bowl: Bowl, x: number) => bowl.wall.findIndex((p) => p.part === 'F' && p.x >= x);

/** Shade blades round the rim, leaning the same way like fins; every third in the club's second colour. */
export function fins(s: Scene, b: Building, bowl: Bowl, use: Extract<FeatureUse, { kind: 'fins' }>) {
  const d = topOf(b).d1 + 1;
  const A = (i: number, y: number): Pt => {
    const p = at(bowl.wall[i], d, y);
    return [p.x, p.y];
  };
  for (let i = 1; i < bowl.wall.length - 3; i += 3) {
    if (bowl.open(i) || bowl.open(i + 2)) continue;
    const r = bowl.rim(bowl.wall[i]);
    const fill = Math.floor(i / 3) % 3 ? use.skin : lift(s.colors[1]);
    s.pen.poly([A(i, r), A(i + 1, r), A(i + 2, r + 7.5), A(i + 1, r + 7)], s.tone(fill, bowl.light(bowl.wall[i])));
  }
}

/** A gantry across the far side: two legs, a pair of girders braced between, a row of lamps under them, a trolley. */
export function gantry(s: Scene, b: Building, bowl: Bowl, use: Extract<FeatureUse, { kind: 'gantry' }>) {
  const d = topOf(b).d1 + 2;
  const i0 = farPost(bowl, -54);
  const i1 = farPost(bowl, 54);
  if (i0 < 0 || i1 < 0) return;
  const A = (i: number, y: number): Pt => {
    const p = at(bowl.wall[i], d, y);
    return [p.x, p.y];
  };
  const base = Math.max(bowl.rim(bowl.wall[i0]), bowl.rim(bowl.wall[i1]));
  const lo = base + 9;
  const hi = lo + 2.6;
  const col = s.tone(use.col);
  for (const i of [i0, i1]) s.pen.poly([A(i, base - 2), A(i + 2, base - 2), A(i + 2, hi), A(i, hi)], col);
  const web: Pt[] = [];
  for (let i = i0; i <= i1 + 2; i += 2) web.push(A(i, (i - i0) % 4 ? hi : lo));
  s.pen.line(web, col, 0.3);
  s.pen.line([A(i0, lo), A(i1 + 2, lo)], col, 0.55);
  s.pen.line([A(i0, hi), A(i1 + 2, hi)], col, 0.55);
  for (let i = i0 + 3; i < i1; i += 4) {
    const p = at(bowl.wall[i], d, lo - 0.9);
    s.pen.box(p.x - 0.9, p.y, 1.8, 0.6, s.lamp('#fff6cf'));
  }
  const mid = Math.round((i0 + i1) / 2) + 9;
  s.pen.poly([A(mid, lo - 2.2), A(mid + 4, lo - 2.2), A(mid + 4, lo), A(mid, lo)], s.tone('#3a3f44'));
  s.pen.flush();
}

/** A truss round the face of the club deck: a zigzag between its two edges. */
export function truss(s: Scene, b: Building, bowl: Bowl, use: Extract<FeatureUse, { kind: 'truss' }>) {
  const deck = (b.decks ?? DECKS)[1];
  if (!deck) return;
  const col = s.lamp(use.col);
  let run: Pt[] = [];
  const end = () => {
    if (run.length > 1) s.pen.line(run, col, 0.22);
    run = [];
  };
  bowl.wall.forEach((p, i) => {
    if (bowl.open(i)) return end();
    const q = at(p, deck.d0 - 0.05, i % 2 ? deck.y0 - 0.1 : deck.y0 - deck.face + 0.1);
    run.push([q.x, q.y]);
  });
  end();
}

/** Square towers on the far wall: taller than the rim, with battlements, a slit and a banner. */
export function towers(s: Scene, b: Building, bowl: Bowl, use: Extract<FeatureUse, { kind: 'towers' }>) {
  const top = topOf(b);
  const d = top.d1 + 1.4;
  for (const x of use.x) {
    const i = farPost(bowl, x);
    if (i < 0) continue;
    const A = (k: number, y: number): Pt => {
      const p = at(bowl.wall[i + k], d, y);
      return [p.x, p.y];
    };
    const r = bowl.rim(bowl.wall[i]) + 7;
    s.pen.poly([A(0, top.y1), A(7, top.y1), A(7, r), A(0, r)], s.tone(b.wall, 0.8));
    for (const k of [0, 3, 6])
      s.pen.poly([A(k, r), A(k + 1, r), A(k + 1, r + 1.4), A(k, r + 1.4)], s.tone(b.wall, 0.8));
    s.pen.poly([A(3, r - 5), A(4, r - 5), A(4, r - 2), A(3, r - 2)], '#1c1c1c');
    s.pen.line([A(3, r + 1.4), A(3, r + 9)], s.tone('#3a3a3a'), 0.3);
    s.pen.poly([A(3, r + 9), A(6, r + 8), A(3, r + 7)], s.tone(lift(s.colors[0])));
  }
}
