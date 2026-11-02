/**
 * The quarterback's drop and his pocket, as All-22 stages a dropback: how deep he sets (by the throw), play action
 * and bootlegs, a clean pocket's step up, pressure's climb or slide away from the man who got there, a scramble's
 * escape. Pure and seeded like the rest of the stager. Spec: docs/superpowers/specs/2026-11-02-all-22-passing-game-
 * design.md §2 and §6.
 */

/**
 * A drop by its depth, counted in steps from under center (PFF's buckets): 1 a quick set, 3 sets 4–6 yards deep,
 * 5 sets 7–8, 7 sets 9 and more. From the shotgun (lined up about 5 deep) he takes fewer steps to the same depth:
 * none, 1, 3 and 5.
 */
export type Drop = 1 | 3 | 5 | 7;

/** How a dropback plays out in the pocket. Times in seconds from the snap; depths in yards behind the ball. */
export interface PocketPlan {
  gun: boolean;
  drop: Drop;
  /** A hitch step at the end of the drop: the deep shots and the timing throws that wait on a route. */
  hitch: boolean;
  setDepth: number;
  playAction: boolean;
  /** Play action with the quarterback rolling out of the pocket the other way. */
  bootleg: boolean;
  /** Where the rusher the engine named came from: off the edge, up the middle, or no one got there. */
  pressure: 'none' | 'edge' | 'inside';
  /** The throw, the sack or the break out of the pocket. */
  throwAt: number;
  /** When he's out of the pocket (a bootleg, a roll, a scramble), or null. */
  leaves: number | null;
}
