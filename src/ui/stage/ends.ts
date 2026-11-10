/**
 * Which end a team attacks. The log's field coordinates never change (the home side attacks toward 100 all game), but
 * teams switch ends each quarter, so a view places everything that comes from a play where the stadium has it that
 * quarter. The stadium itself (the paint, the benches) never moves. Spec:
 * docs/superpowers/specs/2026-11-10-broadcast-field-and-moments-design.md §1.
 */
import { FIELD_W } from '../../engine/field/ballPath';

/**
 * Whether the teams have switched from where they started: the second and fourth quarters, and every other overtime
 * period after them (the fifth as the first, the sixth as the second).
 */
export const endsSwitched = (quarter: number): boolean => quarter % 2 === 0;

/**
 * A spot in the log's coordinates as the stadium has it this quarter: itself, or turned half way round midfield. A
 * half-turn, not a mirror: a team's left is still its left.
 */
export function stadiumSpot(x: number, y: number, quarter: number): { x: number; y: number } {
  return endsSwitched(quarter) ? { x: 100 - x, y: FIELD_W - y } : { x, y };
}
