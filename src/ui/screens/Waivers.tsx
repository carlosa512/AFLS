import { useState } from 'react';
import { capHit, lastSeason } from '../../engine/finance/contract';
import type { League } from '../../engine/types';
import type { RosterMove } from '../../engine/personnel/rosterMoves';
import type { WaiverClaim } from '../../engine/personnel/types';
import {
  assignedContract,
  cancelWaiverClaim,
  claimProblem,
  reorderWaiverClaims,
  setWaiverClaim,
  waiverOrder,
} from '../../engine/personnel/waivers';
import { Dialog, Panel, PlayerLink, SortTh, sortRows, TeamLink, useSort } from '../components';
import { Ovr, seenOvr } from '../scouting';
import { money } from '../format';
import { store } from '../store';
import { liveLock } from '../live';
import { RosterMovePicker } from '../rosterMoves';
import { waiverDecision } from '../personnel';

export function Waivers({ league }: { league: League }) {
  const [filter, setFilter] = useState<'available' | 'mine' | 'released'>('available');
  const [editing, setEditing] = useState<number | null>(null);
  const [move, setMove] = useState<RosterMove>();
  const [sort, onSort] = useSort<'player' | 'pos' | 'ovr' | 'cap' | 'deadline'>({ key: 'deadline', desc: false });
  const state = league.personnel?.waivers;
  if (!league.personnel?.enabled)
    return (
      <Panel title="Waiver wire">
        <p>Personnel transactions are not active in this career yet.</p>
      </Panel>
    );
  const teamId = league.userTeamId;
  const lock = liveLock();
  const mine = state?.claims.filter((c) => c.teamId === teamId).sort((a, b) => a.preference - b.preference) ?? [];
  const pending = state?.pending ?? [];
  const visible = pending.filter((e) =>
    filter === 'available'
      ? e.fromTeamId !== teamId
      : filter === 'mine'
        ? mine.some((c) => c.entryId === e.id)
        : e.fromTeamId === teamId,
  );
  const rows = sortRows(visible, sort, (e, key) => {
    const p = league.players[e.playerId];
    switch (key) {
      case 'player':
        return `${p.lastName} ${p.firstName}`;
      case 'pos':
        return p.position;
      case 'ovr':
        return seenOvr(league, p);
      case 'cap':
        return capHit(assignedContract(e), league.season);
      case 'deadline':
        return e.batch;
    }
  });
  const entry = pending.find((e) => e.id === editing);
  const old = mine.find((c) => c.entryId === editing);
  const plan: WaiverClaim | undefined = entry
    ? {
        entryId: entry.id,
        teamId,
        preference: old?.preference ?? mine.length,
        cutIds: move ? [move.playerId] : [],
        ...(move?.action === 'squad' ? { squadReturnIds: [move.playerId] } : {}),
      }
    : undefined;
  const planProblem = lock ?? (plan ? claimProblem(league, plan) : null);
  const openPlan = (id: number) => {
    const own = mine.find((c) => c.entryId === id);
    const playerId = own?.cutIds[0];
    setMove(
      playerId === undefined
        ? undefined
        : { playerId, action: own?.squadReturnIds?.includes(playerId) ? 'squad' : 'release' },
    );
    setEditing(id);
  };
  const reorder = (index: number, delta: number) =>
    store.mutate((l) => {
      const ordered = [...mine];
      [ordered[index], ordered[index + delta]] = [ordered[index + delta], ordered[index]];
      reorderWaiverClaims(
        l,
        teamId,
        ordered.map((c) => c.entryId),
      );
    });
  return (
    <div className="stack">
      <Panel title="Waiver wire">
        <p>
          {filter === 'released'
            ? 'These are players you released. Other teams can claim them; unclaimed players become free agents.'
            : filter === 'mine'
              ? 'These are your plans to add players. No roster move happens unless you win the claim.'
              : 'These players were released by other teams. Plan a claim to add one on his existing contract.'}
        </p>
        {filter !== 'released' && (
          <p className="small muted">
            Your place in line:{' '}
            <b>
              {waiverOrder(league).indexOf(teamId) + 1} of {league.teams.length}
            </b>
            . If several teams want a player, the team nearest the front gets him.
          </p>
        )}
        <div className="seg" role="group" aria-label="Waiver players">
          {(
            [
              ['available', 'Available to claim'],
              ['mine', 'Your claims'],
              ['released', 'Your released players'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        {pending.length > 0 && (
          <div className="personnel-deadline">
            <p>
              <b>{waiverDecision(league)}</b>
            </p>
            <p className="small muted">Every open claim is decided together, by waiver priority.</p>
          </div>
        )}
        {!rows.length ? (
          <p className="muted">
            {filter === 'mine'
              ? 'You have no claims waiting.'
              : filter === 'released'
                ? 'None of your released players are waiting on waivers.'
                : 'No players are available to claim right now.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh label="Player" k="player" sort={sort} onSort={onSort} />
                  <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} />
                  <SortTh label="Overall" k="ovr" sort={sort} onSort={onSort} />
                  <SortTh label="Cap cost this season" k="cap" sort={sort} onSort={onSort} />
                  <th>{filter === 'released' ? 'Status' : 'Your actions'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const p = league.players[e.playerId];
                  const own = mine.find((c) => c.entryId === e.id);
                  return (
                    <tr key={e.id} className={own ? 'is-user' : undefined}>
                      <td className="sticky-col">
                        <PlayerLink league={league} player={p} />
                        <div className="small muted">
                          Released by <TeamLink team={league.teams[e.fromTeamId]} />
                        </div>
                      </td>
                      <td>{p.position}</td>
                      <td>
                        <Ovr league={league} player={p} />
                      </td>
                      <td className="num">
                        {money(capHit(assignedContract(e), league.season))}
                        <div className="small muted">Contract ends {lastSeason(e.contract)}</div>
                      </td>
                      <td>
                        {filter === 'released' ? (
                          <div className="small muted waiver-reason">
                            Waiting for other teams. If nobody claims him, you can offer a new deal.
                          </div>
                        ) : (
                          <>
                            {own && <span className="small muted">Claim saved · </span>}
                            <button className="btn btn-sm" disabled={!!lock} onClick={() => openPlan(e.id)}>
                              {own ? 'Edit plan' : 'Plan claim'}
                            </button>{' '}
                            {own && (
                              <button
                                className="btn btn-sm"
                                disabled={!!lock}
                                onClick={() => store.mutate((l) => cancelWaiverClaim(l, e.id, teamId))}
                              >
                                Cancel claim
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {mine.length > 0 && filter !== 'released' && (
        <Panel title="Your signing order">
          <p className="small muted">
            We try to sign players in this order. Put your favorite first if you cannot fit everyone.
          </p>
          <ol>
            {mine.map((c, index) => {
              const e = pending.find((e) => e.id === c.entryId)!;
              return (
                <li key={c.entryId}>
                  <PlayerLink league={league} player={league.players[e.playerId]} />{' '}
                  <button className="btn btn-sm" disabled={!!lock || index === 0} onClick={() => reorder(index, -1)}>
                    Move up
                  </button>{' '}
                  <button
                    className="btn btn-sm"
                    disabled={!!lock || index === mine.length - 1}
                    onClick={() => reorder(index, 1)}
                  >
                    Move down
                  </button>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}
      {!!state?.results.length && (
        <Panel title="Claim results">
          <ul>
            {[...state.results]
              .reverse()
              .slice(0, 20)
              .map((r) => (
                <li key={r.entryId}>
                  <PlayerLink league={league} player={league.players[r.playerId]} />{' '}
                  {r.toTeamId === null ? (
                    'was not claimed and became a free agent'
                  ) : (
                    <>
                      claimed by <TeamLink team={league.teams[r.toTeamId]} />
                    </>
                  )}
                  {r.userReason && <span className="small muted"> · Your claim: {r.userReason}</span>}
                </li>
              ))}
          </ul>
        </Panel>
      )}
      {entry && plan && (
        <Dialog
          title="Plan this claim"
          onClose={() => setEditing(null)}
          footer={
            <>
              <button className="btn" onClick={() => setEditing(null)}>
                Back
              </button>
              <button
                className="btn btn-primary"
                disabled={!!planProblem}
                onClick={() => {
                  store.mutate((l) => setWaiverClaim(l, plan));
                  setEditing(null);
                }}
              >
                {old ? 'Save changes' : 'Save claim'}
              </button>
            </>
          }
        >
          <p>
            <PlayerLink league={league} player={league.players[entry.playerId]} /> joins your main roster if you win.
            His current contract stays in place.
          </p>
          <RosterMovePicker league={league} teamId={teamId} value={move} onChange={setMove} />
          <p className="small muted">
            {move
              ? 'The selected roster move happens only if you win. If you lose, you keep your player.'
              : 'Keep everyone if there is room for the new player.'}
          </p>
          <p className="small muted">
            {waiverDecision(league)}. “Save claim” files your plan; it does not advance time.
          </p>
          {planProblem && (
            <p className="callout callout-bad" role="status">
              {planProblem}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
