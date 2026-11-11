/**
 * Paints a building from its description: the land outside, the plaza, the bowl with its crowd, the roof, and the
 * things on it. One function for the game's canvas, the owner's review pages and the tests' recorder. Every draw comes
 * from the seeded `Rng`, so a club's building is the same picture every time.
 */
import { Rng } from '../../engine/rng';
import { DECKS, wallLine } from './bowl';
import { FRAME } from './camera';
import { mix, shade } from './colour';
import { FEATURES } from './features';
import { SETTINGS } from './land';
import type { Pen } from './pen';
import { paintCanopy, paintSlab } from './roof';
import { bowlOf, paintBowl, paintGround } from './stands';
import type { Building, FeatureUse, Look, Scene } from './types';

/** At night the land outside goes dark and the ground stays floodlit: it is the lit thing in the picture. */
const NIGHT_LAND = 0.36;
const NIGHT_GROUND = 0.94;

export function paintStadium(pen: Pen, b: Building, colors: [string, string], look: Look, seed: string): void {
  const snowing = look.precip === 'snow' || look.precip === 'mixed';
  const s: Scene = {
    pen,
    rng: new Rng(`${seed}:land`),
    look,
    colors,
    snowy: !!look.lying || snowing,
    // light in steps, so a deck is a dozen colours and not hundreds (the pen draws a colour's seats as one path)
    tone: (hex, k = 1) => shade(hex, Math.round(k * (look.night ? NIGHT_GROUND : 1) * 20) / 20),
    lamp: (hex) => hex,
  };
  const land: Scene = {
    ...s,
    tone: (hex, k = 1) => shade(hex, Math.round(k * (look.night ? NIGHT_LAND : 1) * 20) / 20),
  };
  const bowl = bowlOf(b, wallLine());
  const decks = b.decks ?? DECKS;
  const use = (layer: 'behind' | 'front') => {
    for (const f of b.features) {
      const feature = FEATURES[f.kind] as {
        layer: string;
        paint(s: Scene, b: Building, bw: typeof bowl, u: FeatureUse): void;
      };
      if (feature.layer === layer) feature.paint(s, b, bowl, f);
    }
  };
  pen.poly(
    [
      [0, 0],
      [FRAME.w, 0],
      [FRAME.w, FRAME.h],
      [0, FRAME.h],
    ],
    land.tone(s.snowy ? mix(b.ground, '#eef2f4', 0.6) : b.ground),
  );
  (SETTINGS[b.setting.kind] as (s: Scene, u: Building['setting']) => void)(land, b.setting);
  // the far land pales a little with distance
  if (!look.night)
    for (const [y, a] of [
      [10, 0.1],
      [20, 0.1],
      [32, 0.1],
    ])
      pen.poly(
        [
          [0, 0],
          [FRAME.w, 0],
          [FRAME.w, y],
          [0, y],
        ],
        `rgba(235,240,244,${a})`,
      );
  paintGround(s, b, bowl);
  use('behind');
  paintBowl(s, b, bowl, seed);
  if (b.roof?.kind === 'canopy') paintCanopy(s, b.roof, bowl.wall, bowl.light, bowl.open);
  if (b.roof?.kind === 'slab') paintSlab(s, b, b.roof, decks[decks.length - 1]);
  use('front');
  pen.flush();
}
