/**
 * A coach's character (docs/superpowers/specs/2026-10-30-coach-character-design.md): four hidden traits, 1–20 on the
 * player traits' scale, each with a job. Ambition decides whether he goes after the step up and whether a fired head
 * coach steps down; loyalty how hard he answers his old boss's call and how readily he re-signs; adaptability how far a
 * coordinator bends to his head coach; discipline a head coach's flags and locker room. No screen or letter shows a
 * number from here: the character box reads them in words (`coachCharacter`).
 */
import { clamp, Rng } from './rng';
import { temperamentOf, TRAIT_MEAN } from './traits';
import type { Coach, CoachRole, CoachTraits, Player } from './types';

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

/**
 * Wanting the step up: a lifer (ambition at `lifer` or less) never takes it, a climber (`climber` or more) always does,
 * and anyone between says yes as often as (ambition − lifer) / 10, less `cool` a year past 55. A coordinator's chair
 * is a step easier to want than a head coach's.
 */
export const STEP_UP = { headCoach: { lifer: 5, climber: 15 }, coordinator: { lifer: 3, climber: 13 }, cool: 0.05 };

/** Whether he wants the chair one rung up this offseason: one answer per season, the same for every club that asks. */
export function wantsStepUp(seed: string, season: number, c: Coach, chair: CoachRole): boolean {
  const { lifer, climber } = chair === 'headCoach' ? STEP_UP.headCoach : STEP_UP.coordinator;
  const ambition = traitOf(c, 'ambition');
  if (ambition <= lifer) return false;
  if (ambition >= climber) return true;
  const chance = (ambition - lifer) / 10 - STEP_UP.cool * Math.max(0, c.age - 55);
  return new Rng(`${seed}:wants:${season}:${c.id}:${chair}`).next() < chance;
}

/**
 * Stepping down: a fired head coach either waits for another head coach's job or goes back to coordinating. The chance
 * starts at `base`, rises `perYear` a year past 50 and by `fired` if he's lost a head coach's job before, falls
 * `perAmbition` a point of ambition above 10 (rises below it); an interim who isn't kept adds `interim`, the second
 * decision at camp `camp`. Kept between `min` and `max`.
 */
export const STEP_DOWN = {
  base: 0.3,
  perYear: 0.04,
  fired: 0.2,
  perAmbition: 0.05,
  interim: 0.4,
  camp: 0.2,
  min: 0.05,
  max: 0.9,
};

/** His head coach's jobs: runs of consecutive seasons in charge of one club. */
export function headStints(c: Pick<Coach, 'career'>): number {
  const rows = (c.career ?? []).filter((r) => r.role === 'headCoach').sort((a, b) => a.season - b.season);
  return rows.filter((r, i) => i === 0 || r.teamId !== rows[i - 1].teamId || r.season > rows[i - 1].season + 1).length;
}

/** Whether a head coach out of a job goes back to coordinating now (`when`: just dismissed, an interim not kept, camp). */
export function stepsDown(seed: string, season: number, c: Coach, when: 'dismissed' | 'interim' | 'camp'): boolean {
  const k = STEP_DOWN;
  const chance = clamp(
    k.base +
      k.perYear * Math.max(0, c.age - 50) +
      (headStints(c) > 1 ? k.fired : 0) -
      k.perAmbition * (traitOf(c, 'ambition') - 10) +
      (when === 'interim' ? k.interim : 0) +
      (when === 'camp' ? k.camp : 0),
    k.min,
    k.max,
  );
  return new Rng(`${seed}:stepDown:${season}:${c.id}:${when}`).next() < chance;
}
