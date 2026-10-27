import { freeAgents } from '../offseason/negotiation';
import { activeRoster, isAvailable, practiceSquad, slotOf } from '../roster';
import { perceive } from '../scouting';
import type { League, Player, Position } from '../types';
import { elevationProblem, nextTeamGame } from './elevations';

/** Back within this many weeks, by the doctor's estimate: a call-up covers it, no signing needed. */
const SHORT_WEEKS = 2;

/**
 * How a club covers a hole from its own practice squad (practice squads on, regular season): `'callup'` for a short
 * absence when a healthy squad player there still has call-ups (the call-up files at kickoff), a squad player to
 * promote for a longer one when the club reads him at least as well as the best free agent, else null (sign or
 * poach as before). By the club's own read throughout.
 */
export function squadCover(league: League, teamId: number, pos: Position, promised = 0): 'callup' | Player | null {
  if (!league.personnel?.enabled || league.phase !== 'regular') return null;
  const squad = practiceSquad(league, teamId).filter(
    (p) => p.position === pos && p.squad?.kind === 'practiceSquad' && !p.injury,
  );
  if (!squad.length) return null;
  const out = activeRoster(league, teamId).filter((p) => slotOf(league, p) === pos && !isAvailable(p));
  if (out.length && out.every((p) => (p.injury?.estimate[1] ?? Infinity) <= SHORT_WEEKS)) {
    // Only a call-up the planner can file: two a game, his uses, cap room and the re-sign rule (elevationProblem).
    const g = nextTeamGame(league, teamId);
    const fileable = !!g && promised < 2 && squad.some((p) => !elevationProblem(league, p, g));
    return fileable ? 'callup' : null;
  }
  const read = (p: Player) => perceive(league, teamId, p).ovr;
  const best = [...squad].sort((a, b) => read(b) - read(a) || a.id - b.id)[0];
  const market = Math.max(
    0,
    ...freeAgents(league)
      .filter((f) => f.position === pos && !f.injury)
      .map(read),
  );
  return read(best) >= market ? best : null;
}
