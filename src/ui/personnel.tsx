import { useState } from 'react';
import { capSpace } from '../engine/finance/cap';
import { activeRoster } from '../engine/roster';
import {
  cancelElevation,
  elevationCost,
  elevationMinimum,
  elevationProblem,
  elevationUses,
  elevationRecords,
  gameElevations,
  nextTeamGame,
  planElevation,
} from '../engine/personnel/elevations';
import {
  autoGameDay,
  dressingLimit,
  gameDayEditProblem,
  gameDayPool,
  gameDayPreview,
  gameDayProblem,
  setGameDayPlan,
} from '../engine/personnel/gameDay';
import { elevationDeadline, personnelLabel, personnelTime } from '../engine/personnel/calendar';
import { POSITIONS } from '../engine/types';
import { playingHurt } from '../engine/roster';
import type { League, Player } from '../engine/types';
import { Dialog, Panel, PlayerLink, TeamLink, SortTh, sortRows, useSort } from './components';
import { liveLock } from './live';
import { Ovr, viewOf } from './scouting';
import { money, weeklyMoney } from './format';
import { store } from './store';

// Native option labels are plain text: anchors cannot be nested in an option.
const optionName = (p: Player) => `${p.firstName} ${p.lastName}`;

/** Same one-game action on the squad desk, contract list and player card. */
export function CallupAction({ league, player }: { league: League; player: Player }) {
  const [open, setOpen] = useState(false);
  const g = nextTeamGame(league, player.teamId!);
  if (!g || player.teamId !== league.userTeamId) return null;
  const existing = gameElevations(league, g, player.teamId).find((e) => e.playerId === player.id);
  const issue = liveLock() ?? elevationProblem(league, player, g);
  if (existing)
    return (
      <button
        className="btn btn-sm"
        disabled={existing.status !== 'planned' || personnelTime(league) >= existing.deadline || !!liveLock()}
        title={
          existing.status === 'planned' ? 'Cancel this planned call-up' : 'Filed for this game; returns automatically'
        }
        onClick={() =>
          store.mutate((l) => cancelElevation(l, l.players[player.id], l.games.find((x) => x.id === g.id)!))
        }
      >
        {existing.status === 'planned' ? 'Cancel call-up' : 'Called up'}
      </button>
    );
  const cost = elevationCost(league, player, g);
  const space = capSpace(league, player.teamId);
  return (
    <>
      <button
        className="btn btn-sm"
        disabled={!!issue}
        title={issue ?? 'Use for one game without a cut or a new NFL contract'}
        onClick={() => setOpen(true)}
      >
        Call up
      </button>
      {open && (
        <Dialog
          title="Call up for one game?"
          onClose={() => setOpen(false)}
          footer={
            <>
              <button className="btn" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button
                className="btn btn-primary"
                disabled={!!issue}
                onClick={() => {
                  store.mutate((l) => planElevation(l, l.players[player.id], l.games.find((x) => x.id === g.id)!));
                  setOpen(false);
                }}
              >
                Plan call-up
              </button>
            </>
          }
        >
          <p>
            <PlayerLink league={league} player={player} /> will be available against{' '}
            <TeamLink team={league.teams[g.homeId === player.teamId ? g.awayId : g.homeId]} />. Your main roster stays
            at {activeRoster(league, player.teamId).length}/53; no cut is needed.
          </p>
          <p>
            {g.playoffRound
              ? 'Postseason pay is outside the salary cap.'
              : `His pay for this game is ${weeklyMoney(elevationMinimum(league, player))}, replacing the normal squad check.`}
          </p>
          <div className="facts">
            <span className="fact">
              <span className="eyebrow">Extra cap cost</span>
              <b>{money(cost)}</b>
            </span>
            <span className="fact">
              <span className="eyebrow">Cap space after</span>
              <b>
                {money(space)} → {money(space - cost)}
              </b>
            </span>
          </div>
          <p className="small muted">
            {g.playoffRound
              ? 'Playoff call-ups have no three-game limit.'
              : `${3 - elevationUses(league, player)} regular-season call-ups remain before this game.`}{' '}
            File by {personnelLabel(elevationDeadline(g))}. He returns automatically without waivers.
          </p>
          {issue && <p role="alert">{issue}</p>}
        </Dialog>
      )}
    </>
  );
}

/** Dressing is automatic by default; optional choices never sign, cut or call up a player. */
export function GameDayPanel({ league, teamId }: { league: League; teamId: number }) {
  const [message, setMessage] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [sort, onSort] = useSort<'name' | 'pos' | 'ability' | 'status' | 'active'>({ key: 'pos', desc: false });
  if (!league.personnel?.enabled || teamId !== league.userTeamId) return null;
  const g = nextTeamGame(league, teamId);
  if (!g) return null;
  const day = gameDayPreview(league, g, teamId);
  const limit = dressingLimit(league, day.dressedIds);
  const issue = gameDayProblem(league, g, teamId);
  const lock = liveLock() ?? gameDayEditProblem(league, g);
  const calls = gameElevations(league, g, teamId);
  const pool = gameDayPool(league, g, teamId);
  const act = (fn: () => void) => {
    try {
      fn();
      setMessage('');
    } catch (e) {
      setMessage((e as Error).message);
    }
  };
  const toggle = (id: number) =>
    act(() =>
      store.mutate((l) => {
        const game = l.games.find((x) => x.id === g.id)!;
        const current = gameDayPreview(l, game, teamId);
        const ids = current.dressedIds.includes(id)
          ? current.dressedIds.filter((x) => x !== id)
          : [...current.dressedIds, id];
        setGameDayPlan(l, game, teamId, {
          dressedIds: ids,
          emergencyQbId: current.emergencyQbId === id ? undefined : current.emergencyQbId,
        });
      }),
    );
  return (
    <Panel title="Game-day roster">
      <p>
        Next game: <TeamLink team={league.teams[g.homeId === teamId ? g.awayId : g.homeId]} />. Staff picks the active
        list automatically; you can adjust it below.
      </p>
      <div className="facts">
        <span className="fact">
          <span className="eyebrow">Ready to play</span>
          <b>
            {day.dressedIds.length}/{limit}
          </b>
        </span>
        <span className="fact">
          <span className="eyebrow">Offensive linemen</span>
          <b>{day.dressedIds.filter((id) => league.players[id].position === 'OL').length} active</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Squad call-ups</span>
          <b>{calls.length}/2</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Main roster</span>
          <b>{activeRoster(league, teamId).length}/53</b>
        </span>
        <span className="fact">
          <span className="eyebrow">Extra cap this game</span>
          <b>{money(calls.reduce((sum, e) => sum + e.additionalCap, 0))}</b>
        </span>
      </div>
      <p className="small muted">
        Dress 47 players, or 48 with eight offensive linemen. Call-ups keep their squad place and return automatically.
        Your choices lock 90 minutes before kickoff. Staff replaces a saved list if player availability changes.
      </p>
      {elevationRecords(league)
        .filter(
          (e) =>
            e.gameId === g.id &&
            e.teamId === teamId &&
            e.status === 'cancelled' &&
            e.reason &&
            !calls.some((c) => c.playerId === e.playerId),
        )
        .map((e) => (
          <p className="small" key={`cancel-${e.playerId}`}>
            <PlayerLink league={league} player={league.players[e.playerId]} /> · Call-up cancelled: {e.reason}
          </p>
        ))}
      {calls.map((e) => (
        <p key={e.playerId}>
          <PlayerLink league={league} player={league.players[e.playerId]} /> ·{' '}
          {e.status === 'planned' ? 'Planned call-up' : 'Filed call-up'} · returns {personnelLabel(e.revertsAt)}
        </p>
      ))}
      {day.emergencyQbId !== undefined && (
        <p className="small">
          Emergency QB: <PlayerLink league={league} player={league.players[day.emergencyQbId]} />. Can enter only when
          both active QBs are unavailable.
        </p>
      )}
      {(message || issue) && <p role="status">{message || issue}</p>}
      <details open={expanded} onToggle={(e) => setExpanded(e.currentTarget.open)}>
        <summary>Choose who dresses</summary>
        <div className="row" style={{ margin: '12px 0' }}>
          <button
            className="btn btn-sm"
            disabled={!!lock}
            title={lock ?? 'Return to automatic selection'}
            onClick={() => act(() => store.mutate((l) => autoGameDay(l, l.games.find((x) => x.id === g.id)!, teamId)))}
          >
            Let staff choose
          </button>
          <label>
            Emergency QB{' '}
            <select
              aria-label="Emergency quarterback"
              disabled={!!lock}
              value={day.emergencyQbId ?? ''}
              onChange={(e) =>
                act(() =>
                  store.mutate((l) =>
                    setGameDayPlan(l, l.games.find((x) => x.id === g.id)!, teamId, {
                      dressedIds: day.dressedIds,
                      emergencyQbId: e.target.value ? Number(e.target.value) : undefined,
                    }),
                  ),
                )
              }
            >
              <option value="">None</option>
              {pool
                .filter((p) => p.position === 'QB' && !p.squad && !day.dressedIds.includes(p.id) && !p.injury)
                .map((p) => (
                  <option key={p.id} value={p.id}>
                    {optionName(p)}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortTh label="Player" k="name" sort={sort} onSort={onSort} />
                <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} />
                <SortTh label="Ability" k="ability" sort={sort} onSort={onSort} />
                <SortTh label="Game status" k="status" sort={sort} onSort={onSort} />
                <SortTh label="Active" k="active" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {sortRows(pool, sort, (p, key) =>
                key === 'name'
                  ? `${p.lastName} ${p.firstName}`
                  : key === 'pos'
                    ? POSITIONS.indexOf(p.position)
                    : key === 'ability'
                      ? viewOf(league, p).ovr
                      : key === 'status'
                        ? p.injury
                          ? 'Injured'
                          : day.dressedIds.includes(p.id)
                            ? 'Ready'
                            : 'Inactive'
                        : Number(day.dressedIds.includes(p.id)),
              ).map((p) => (
                <tr key={p.id}>
                  <td>
                    <PlayerLink league={league} player={p} avatar={26} />
                  </td>
                  <td>{p.position}</td>
                  <td className="num">
                    <Ovr league={league} player={p} />
                  </td>
                  <td>
                    {p.injury
                      ? 'Injured'
                      : day.emergencyQbId === p.id
                        ? 'Emergency QB'
                        : day.dressedIds.includes(p.id)
                          ? 'Ready'
                          : 'Inactive'}
                    {p.squad ? ' · Call-up' : ''}
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Dress ${p.firstName} ${p.lastName}`}
                      checked={day.dressedIds.includes(p.id)}
                      disabled={!!lock || (!!p.injury && !playingHurt(p.injury))}
                      onChange={() => toggle(p.id)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Panel>
  );
}
