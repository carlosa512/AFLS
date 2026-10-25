import { releasePlayer } from '../finance/cap';
import { practiceSquad, onGameRoster } from '../roster';
import type { League, Player } from '../types';
import { squadFit } from './eligibility';
import { inviteSquadReturn } from './squads';

export interface RosterMove {
  playerId: number;
  action: 'release' | 'squad';
}

/** An NFL roster contract cannot be reassigned directly to the squad. This authorizes a return offer. */
export function squadReturnProblem(
  league: League,
  teamId: number,
  p: Player,
  departingSquadId?: number,
): string | null {
  if (!league.personnel?.enabled) return 'Personnel moves are not active.';
  if (p.teamId !== teamId || !onGameRoster(p) || !p.contract) return 'Choose a player from your main roster.';
  if (p.injury) return 'An injured player cannot join the practice squad until cleared.';
  return squadFit(league, [...practiceSquad(league, teamId).filter((x) => x.id !== departingSquadId), p]);
}

export function executeRosterMove(league: League, move: RosterMove): void {
  const p = league.players[move.playerId];
  if (move.action === 'squad') inviteSquadReturn(league, p.teamId!, p);
  releasePlayer(league, p);
}
