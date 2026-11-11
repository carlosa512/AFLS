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

/** Masts over the far side: a pole, two spars with a sail under each, and a pennant. */
export function masts(s: Scene, b: Building, bowl: Bowl, use: Extract<FeatureUse, { kind: 'masts' }>) {
  const d = topOf(b).d1 + 2;
  use.x.forEach((x, n) => {
    const i = farPost(bowl, x);
    if (i < 6) return;
    const A = (k: number, y: number): Pt => {
      const p = at(bowl.wall[i + k], d, y);
      return [p.x, p.y];
    };
    const r = bowl.rim(bowl.wall[i]);
    const top = r + (n % 2 ? 30 : 26);
    for (const [y, half] of [
      [r + 16, 4],
      [r + 8, 5],
    ] as [number, number][]) {
      s.pen.poly(
        [A(-half + 1, y - 0.3), A(half - 1, y - 0.3), A(half - 2, y - 6.5), A(-half + 2, y - 6.5)],
        s.tone('#ece6d4'),
      );
      s.pen.line([A(-half, y), A(half, y)], s.tone('#3b2c1c'), 0.45);
    }
    s.pen.line([A(0, r - 1), A(0, top)], s.tone('#3b2c1c'), 0.6);
    s.pen.poly([A(0, top), A(3, top - 1.2), A(0, top - 2.4)], s.tone(lift(s.colors[1])));
  });
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
