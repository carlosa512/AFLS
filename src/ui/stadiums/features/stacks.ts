/** Smokestacks rising from the far rim: white, with a cap in a club colour. */
import { at, DECKS } from '../bowl';
import type { Pt } from '../pen';
import type { Building, FeatureUse, Scene } from '../types';
import type { Bowl } from '../stands';

export function stacks(s: Scene, b: Building, bowl: Bowl, use: Extract<FeatureUse, { kind: 'stacks' }>) {
  const decks = b.decks ?? DECKS;
  const top = decks[decks.length - 1];
  const A = (i: number, y: number): Pt => {
    const p = at(bowl.wall[i], top.d1 + 3, y);
    return [p.x, p.y];
  };
  for (const x of use.x) {
    const i = bowl.wall.findIndex((p) => p.part === 'F' && p.x >= x);
    if (i < 0) continue;
    const y0 = top.y1 + 1;
    const y1 = y0 + 19;
    s.pen.poly([A(i, y0), A(i + 3, y0), A(i + 3, y1), A(i, y1)], s.tone('#ecebe4'));
    s.pen.poly([A(i, y1 - 3.4), A(i + 3, y1 - 3.4), A(i + 3, y1), A(i, y1)], s.tone(use.cap));
  }
}
