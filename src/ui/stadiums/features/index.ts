/** Things on a building, each drawn once here and usable by any building. */
import type { Bowl } from '../stands';
import type { Building, FeatureUse, Scene } from '../types';
import { fins, gantry, towers, truss } from './rim';
import { wheel } from './wheel';

type Feature<K extends FeatureUse['kind']> = {
  /** Behind the stands (drawn before them) or in front (after the roof). */
  layer: 'behind' | 'front';
  paint(s: Scene, b: Building, bowl: Bowl, use: Extract<FeatureUse, { kind: K }>): void;
};
export const FEATURES: { [K in FeatureUse['kind']]: Feature<K> } = {
  wheel: { layer: 'behind', paint: (s) => wheel(s) },
  fins: { layer: 'front', paint: fins },
  towers: { layer: 'front', paint: towers },
  gantry: { layer: 'front', paint: gantry },
  truss: { layer: 'front', paint: truss },
};
