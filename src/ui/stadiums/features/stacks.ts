/** Smokestacks rising from the far rim: white with a cap in a club colour, or a furnace's, dark and burning at the mouth. */
import { at, DECKS } from '../bowl';
import type { Pt } from '../pen';
import type { Bowl } from '../stands';
import type { Building, FeatureUse, Scene } from '../types';

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
    s.pen.poly([A(i, y0), A(i + 3, y0), A(i + 3, y1), A(i, y1)], s.tone(use.body ?? '#ecebe4'));
    s.pen.poly(
      [A(i, y1 - 3.4), A(i + 3, y1 - 3.4), A(i + 3, y1), A(i, y1)],
      use.glow ? s.lamp(use.cap) : s.tone(use.cap),
    );
    if (use.glow) s.pen.poly([A(i, y1), A(i + 3, y1), A(i + 2, y1 + 2.4), A(i + 1, y1 + 3.4)], s.lamp('#ffb347'));
  }
}
