/**
 * A coach's character (docs/superpowers/specs/2026-10-30-coach-character-design.md): four hidden traits, 1–20 on the
 * player traits' scale, each with a job. Ambition decides whether he goes after the step up and whether a fired head
 * coach steps down; loyalty how hard he answers his old boss's call and how readily he re-signs; adaptability how far a
 * coordinator bends to his head coach; discipline a head coach's flags and locker room. No screen or letter shows a
 * number from here: the character box reads them in words (`coachCharacter`).
 */
import { clamp, Rng } from './rng';
import { temperamentOf, TRAIT_MEAN } from './traits';
import type { Coach, CoachTraits, Player } from './types';

const TRAIT_SD = 3.5;
const roll = (v: number) => Math.round(clamp(v, 1, 20));

/** A trait as the hooks read it: a coach without traits (or without this one) is typical. */
export const traitOf = (c: Pick<Coach, 'traits'>, k: keyof CoachTraits): number => c.traits?.[k] ?? TRAIT_MEAN;

/** Every hook's scale: −1 at two sd below the mean (3.5), +1 at two above (17.5), 0 for a typical coach. */
export const traitLean = (v: number): number => clamp((v - TRAIT_MEAN) / 7, -1, 1);

/**
 * Loyalty's hooks, at the extremes (±2 sd): the pull of his old boss's call from half to one and a half times
 * `TREE_PULL`, the re-sign chance ±0.15, and his ask to stay with his own club 5% under or over. All centred.
 */
export const LOYAL = { pull: 0.5, keep: 0.15, ask: 0.05 };

/** His traits, on his own stream (`seed:coachTraits:id`), so adding them reshuffles nothing. The young are hungrier. */
export function rollCoachTraits(seed: string, c: Pick<Coach, 'id' | 'age'>): CoachTraits {
  const rng = new Rng(`${seed}:coachTraits:${c.id}`);
  const draw = () => TRAIT_MEAN + TRAIT_SD * rng.normal();
  return {
    ambition: roll(draw() + 0.15 * Math.max(0, 45 - c.age)),
    loyalty: roll(draw()),
    adaptability: roll(draw()),
    discipline: roll(draw()),
  };
}

/**
 * A former player's character carried into coaching, on the same stream: a competitor is ambitious, a loyal player
 * loyal, a clean and calm one a disciplinarian, a versatile one adaptable.
 */
export function traitsFromPlayer(seed: string, c: Pick<Coach, 'id'>, p: Player): CoachTraits {
  const rng = new Rng(`${seed}:coachTraits:${c.id}`);
  const noise = () => rng.normal(0, 2);
  return {
    ambition: roll(TRAIT_MEAN + 7 * (p.personality.winning - 0.5) + noise()),
    loyalty: roll(TRAIT_MEAN + 7 * (p.personality.loyalty - 0.5) + noise()),
    adaptability: roll(p.traits.versatility + noise()),
    discipline: roll((p.traits.sportsmanship + temperamentOf(p)) / 2 + noise()),
  };
}

/** The new league year: ambition cools a point a year from 56. */
export function coolAmbition(c: Coach): void {
  if (c.traits && c.age >= 56) c.traits.ambition = Math.max(1, c.traits.ambition - 1);
}

/** How far a coordinator bends to his head coach's plan: none at 1, most of the way (0.8) at 20. */
export const adaptShare = (c: Pick<Coach, 'traits'>): number => (0.8 * (traitOf(c, 'adaptability') - 1)) / 19;

/**
 * Discipline's hooks at the extremes (±2 sd), a head coach's only: his team's pre-snap and personal fouls 8% under
 * (disciplinarian) or over (player's coach), and his players' room ±0.5. Centred: a typical head coach changes nothing.
 */
export const DISCIPLINE = { flags: 0.08, room: 0.5 };
/** A head coach's multiplier on his team's pre-snap and personal fouls. */
export const cultureFlags = (hc: Pick<Coach, 'traits'>): number =>
  1 - DISCIPLINE.flags * traitLean(traitOf(hc, 'discipline'));
/** What a head coach adds to his players' room factor: a player's coach lifts it, a disciplinarian quiets it. */
export const cultureRoom = (hc: Pick<Coach, 'traits'>): number =>
  -DISCIPLINE.room * traitLean(traitOf(hc, 'discipline'));
