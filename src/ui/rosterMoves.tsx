import { activeRoster } from '../engine/roster';
import { squadReturnProblem, type RosterMove } from '../engine/personnel/rosterMoves';
import type { League } from '../engine/types';
import { playerName } from './format';

/** Reused by claims and promotions: select the person first, then authorize a concrete action. */
export function RosterMovePicker({
  league,
  teamId,
  value,
  onChange,
  departingSquadId,
}: {
  league: League;
  teamId: number;
  value?: RosterMove;
  onChange: (move?: RosterMove) => void;
  departingSquadId?: number;
}) {
  const player = value ? league.players[value.playerId] : undefined;
  const squadIssue = player ? squadReturnProblem(league, teamId, player, departingSquadId) : null;
  return (
    <div className="roster-move-plan">
      <div className="row">
        <label>
          Player to make room
          <select
            aria-label="Player to make room"
            value={value?.playerId ?? ''}
            onChange={(e) =>
              onChange(e.target.value ? { playerId: Number(e.target.value), action: 'release' } : undefined)
            }
          >
            <option value="">Keep everyone</option>
            {activeRoster(league, teamId).map((p) => (
              <option key={p.id} value={p.id}>
                {p.position} · {playerName(p)}
              </option>
            ))}
          </select>
        </label>
        {value && (
          <label>
            Action
            <select
              aria-label="Roster action"
              value={value.action}
              onChange={(e) => onChange({ ...value, action: e.target.value as RosterMove['action'] })}
            >
              <option value="release">Release player</option>
              <option value="squad" disabled={!!squadIssue}>
                Release & offer squad deal
              </option>
            </select>
          </label>
        )}
      </div>
      {value?.action === 'squad' && (
        <p className="small muted">
          He leaves the main roster first. If waivers apply, other teams get a chance to claim him. We offer a squad
          deal only if he becomes available; a return is not guaranteed.
        </p>
      )}
      {player && squadIssue && <p className="small muted">Squad option unavailable: {squadIssue}</p>}
    </div>
  );
}
