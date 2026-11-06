import { addMarbles, drawHabits, habitsForce, HABIT_IDS, usedThisYear } from './gmHabits';
import { Rng } from './rng';
import type { GeneralManager, League } from './types';

/** Task 4 fills this: the year's moves, resolved before the habits fade and draw. */
export function resolveMoves(_league: League, _gm: GeneralManager): void {}

/**
 * The new league year's habit step. `league.season` has just ticked, so the season just played is `season - 1`.
 * A GM between jobs keeps his marbles and his grip: nothing draws for him.
 */
export function habitsNewYear(league: League): void {
  const played = league.season - 1;
  for (const gm of Object.values(league.gms)) {
    if (gm.id === league.userGmId || gm.retired) continue;
    resolveMoves(league, gm);
    for (const id of HABIT_IDS) if (gm.habits?.[id] && !usedThisYear(gm, id, played)) addMarbles(gm, `fade:${id}`, 1);
    if (gm.teamId === null || habitsForce.all || habitsForce.off) continue;
    drawHabits(league, gm, new Rng(`${league.seed}:${league.season}:gm-habits:${gm.id}`));
  }
}
