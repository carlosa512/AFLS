/**
 * Cliffs (spec 2026-11-14-league-age-design.md §4): an NFL career is a plateau that can end in a sudden drop, often
 * after an injury, so the players still playing at 34 are the few who aged well. Past a point near his position's turn
 * each year carries a chance of a sharp drop: physical and technical ratings at once (`rollYear`, on his own year's
 * stream). Rare before 28 and then only after a severe injury that season; likelier with age and a fragile body. The
 * man past a cliff is the one who retires (`retireChance`). Never shown: screens keep the scouts' words.
 */
import { declineOnset } from './aging';
import { clamp } from './rng';
import { TRAIT_MEAN } from './traits';
import type { Player, Position, Traits } from './types';

/**
 * - `from`: the youngest age a healthy player can fall off one
 * - `lead`: years before his technique turns (`declineOnset`) that the chance starts to climb
 * - `latest`: the climb starts at this age at every position but QB, K and P (the NFL's exits by age barely differ
 *   between the lines' long prime and the skill positions'; quarterbacks and kickers last)
 * - `base`: the chance a year once he's past `from` (and before the climb)
 * - `perYear`: what each year past the climb's start adds
 * - `hurt`: the chance multiplied after a severe injury that season (and, under `from`, `base × hurt`)
 * - `fragile`: per point of durability under the league's mean, the share the chance grows
 * - `size`: overall points a cliff takes, drawn between the two
 * Tuned with retirement (`RETIRE_BODY`) to the NFL's starters' exits by age and the careers check's survivor lines; a
 * fragile body's lean is held by the durability line (top vs bottom third at 32, 0.5–2).
 */
export const CLIFF = {
  from: 28,
  lead: 1,
  latest: 29,
  base: 0.03,
  perYear: 0.03,
  hurt: 3,
  fragile: 0.04,
  size: [2, 4] as [number, number],
};
/** Cliffs on or off (`on`), and every chance at 1 (`always`, for tests only). */
export const CLIFFS = { on: true, always: false };

/** Positions whose careers last past the others': their climb starts at their own turn. */
const LASTING: ReadonlySet<Position> = new Set(['QB', 'K', 'P']);

/** The most a year's chance can be. */
const CAP = 0.5;

/** Did he suffer a severe (or career-threatening) injury in `season`? */
export function severeInjuryIn(p: Pick<Player, 'injuries'>, season: number): boolean {
  return (p.injuries ?? []).some(
    (i) => i.season === season && (i.severity === 'severe' || i.severity === 'career-threatening'),
  );
}

/** The chance he falls off a cliff in the year he's rolled at `age`. */
export function cliffChance(age: number, pos: Position, traits: Pick<Traits, 'durability'>, hurt: boolean): number {
  if (!CLIFFS.on) return 0;
  if (CLIFFS.always) return 1;
  const injury = hurt ? CLIFF.hurt : 1;
  if (age < CLIFF.from) return hurt ? clamp(CLIFF.base * CLIFF.hurt, 0, CAP) : 0;
  const turn = declineOnset(pos, 'technical', traits) - CLIFF.lead;
  const climb = LASTING.has(pos) ? turn : CLIFF.latest;
  const body = Math.max(0, 1 + CLIFF.fragile * (TRAIT_MEAN - traits.durability));
  return clamp((CLIFF.base + CLIFF.perYear * Math.max(0, age - climb)) * injury * body, 0, CAP);
}
