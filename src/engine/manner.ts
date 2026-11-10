/** How he talks: an outspoken man sharper, a calm one plainer. A leaf, so letters and the cast sheet share it without importing each other. */
import { TRAIT_MEAN } from './traits';
import type { Player } from './types';

const z = (v: number) => (v - TRAIT_MEAN) / 3.5;
export const manner = (p: Player) => ({ loud: z(p.traits.controversy) >= 0.5, calm: z(p.traits.temperament) >= 0.5 });
