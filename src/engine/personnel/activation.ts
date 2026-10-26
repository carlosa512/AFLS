import type { League } from '../types';
import { personnelClock } from './calendar';
import { ensureService } from './service';
import { ensureWaivers } from './waivers';

/** Existing careers switch practice squads on once, in the offseason before camp; never mid-season. */
export function canTurnOnPersonnel(league: League): string | null {
  if (!league.personnel) return 'This save has no personnel profile.';
  if (league.personnel.enabled) return 'Practice squads are already on in this career.';
  if (league.personnel.offered !== league.season)
    return 'The offer to turn on practice squads comes once, at the offseason after an update adds them.';
  if (!['resign', 'freeAgency', 'draft'].includes(league.phase))
    return 'Practice squads can be turned on in the offseason, before training camp.';
  return null;
}

/** Permanent for the career: waivers and service start now, and squads form at camp like any enabled career. */
export function turnOnPersonnel(league: League): void {
  const problem = canTurnOnPersonnel(league);
  if (problem) throw new Error(problem);
  league.personnel!.enabled = true;
  personnelClock(league);
  ensureWaivers(league);
  for (const p of Object.values(league.players)) ensureService(p, league.season);
}
