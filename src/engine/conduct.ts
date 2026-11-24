/**
 * Discipline (spec `docs/superpowers/specs/2026-11-23-discipline-design.md`): trouble on and off the field and what
 * comes of it. This file so far holds the countdown; the rulings come with the later steps.
 */
import { suspended, teamPlayers } from './roster';
import type { League } from './types';

/** Lives in roster.ts (`isAvailable` reads it) so roster and conduct never import each other. */
export { suspended };

/**
 * After a week's games: each listed team's suspended players serve one, and a man with none left is clear. Pass only
 * the teams that played, so a bye holds the suspension (an offseason ruling keeps its games for week 1).
 */
export function serveGames(league: League, teamIds: number[]): void {
  for (const id of new Set(teamIds)) {
    for (const p of teamPlayers(league, id)) {
      if (!p.suspension) continue;
      p.suspension.games -= 1;
      if (p.suspension.games <= 0) delete p.suspension;
    }
  }
}
