/**
 * Hidden traits: the makeup no stat line shows. Each one is on the ratings scale (1–20, average
 * 10.5) and has a job (no trait without an engine hook):
 *
 * - **Work ethic**: how much of his ceiling a young player reaches, and how well he keeps his game
 *   once he ages (development).
 * - **Durability**: his body clock. When the decline starts, how steep it is, how long he lasts
 *   (development and retirement).
 * - **Temperament**: composure under the whistle. A lineman with a short fuse jumps early and grabs
 *   more (false starts, offside, holding).
 * - **Injury resistance**: how often his body breaks, and how that holds up with age (`injuries.ts`).
 * - **Natural fitness**: how much condition a game costs him, how fast it comes back, and how well he
 *   heals from an injury (`injuries.ts`).
 * - **Versatility**: how big a knock he takes lining up away from his own position, and how fast he
 *   learns a new one (`familiarity.ts`, `training.ts`).
 *
 * The truth drives the engine; teams only ever see their scouts' words for it (`characterRead`).
 */
import { clamp, Rng } from './rng';
import type { Player, Position, Traits } from './types';

export const TRAIT_MEAN = 10.5;
const TRAIT_SD = 3.5;

/**
 * A player's traits, from a stream seeded by the player himself (like his combine), so adding them
 * never shifts the league's random stream and a migrated save matches a new one.
 */
export function generateTraits(p: Pick<Player, 'id' | 'firstName' | 'lastName' | 'heightIn' | 'weightLb'>): Traits {
  const rng = new Rng(`traits:${p.id}:${p.firstName}:${p.lastName}:${p.heightIn}:${p.weightLb}`);
  const roll = (z: number) => Math.round(clamp(TRAIT_MEAN + TRAIT_SD * z, 1, 20));
  const work = rng.normal();
  const body = rng.normal();
  // Pros tend to keep their cool: temperament leans a little toward work ethic.
  const temper = 0.3 * work + 0.954 * rng.normal();
  // Drawn after the others, so adding them left every player's earlier traits as they were. A body
  // that ages well tends to hold together; the fit ones tend to be the ones who put in the work.
  const resist = 0.35 * body + 0.937 * rng.normal();
  const fitness = 0.25 * work + 0.2 * body + 0.947 * rng.normal();
  // Drawn last for the same reason. Versatility is its own gift: a football mind that picks up a new job.
  const versatile = rng.normal();
  return { workEthic: roll(work), durability: roll(body), temperament: roll(temper), injuryResistance: roll(resist), naturalFitness: roll(fitness), versatility: roll(versatile) };
}

/**
 * A player's work ethic as the game reads it. Today it is the trait itself; mentoring (docs/TRAINING.md §8)
 * will add a small, bounded offset here, so new readers go through this rather than `traits.workEthic`.
 */
export const workEthicOf = (p: Pick<Player, 'traits'>) => p.traits.workEthic;

/** Growth multiplier: about ×0.4 for the laziest player, ×1.6 for the hardest worker. Averages 1. */
export const growthMult = (t: Traits) => 1 + 0.065 * (t.workEthic - TRAIT_MEAN);

/** Decline multiplier: hard workers and durable bodies age more gently. Averages 1. */
export const declineMult = (t: Traits) => (1 - 0.03 * (t.workEthic - TRAIT_MEAN)) * (1 - 0.02 * (t.durability - TRAIT_MEAN));

/** Years his body clock runs ahead (−) or behind (+) his position's: up to about ±2. */
export const bodyShift = (t: Pick<Traits, 'durability'>) => clamp(0.2 * (t.durability - TRAIT_MEAN), -2, 2);

/** Share of the out-of-position knock he takes: about ×0.45 for the most versatile, ×1.55 for the least. Averages 1. */
export const knockMult = (t: Pick<Traits, 'versatility'>) => clamp(1 - 0.06 * (t.versatility - TRAIT_MEAN), 0.4, 1.6);

/** Learning-speed multiplier for a new position: a versatile player picks it up faster. Averages 1. */
export const learnMult = (t: Pick<Traits, 'versatility'>) => clamp(1 + 0.03 * (t.versatility - TRAIT_MEAN), 0.75, 1.25);

/** Positions whose discipline the engine reads (the `discipline` contest): the lines. */
export const TEMPER_POSITIONS: ReadonlySet<Position> = new Set(['OL', 'DT', 'EDGE']);

/** Discipline points a lineman's temperament adds or costs: about ±3 at the extremes. */
export const temperOffset = (t: Traits) => 0.3 * (t.temperament - TRAIT_MEAN);
