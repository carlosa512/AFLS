import { useState } from 'react';
import { capHit, lastSeason } from '../../engine/finance/contract';
import { activeRoster } from '../../engine/roster';
import type { League } from '../../engine/types';
import {
  assignedContract,
  cancelWaiverClaim,
  claimProblem,
  reorderWaiverClaims,
  setWaiverClaim,
  waiverOrder,
} from '../../engine/personnel/waivers';
import { personnelLabel } from '../../engine/personnel/calendar';
import { advanceNextPersonnelEvent, nextDeadlineBlocker, nextWaiverDeadline } from '../../engine/personnel/flow';
import { Panel, PlayerLink, SortTh, sortRows, TeamLink, useSort } from '../components';
import { Ovr, seenOvr } from '../scouting';
import { money, playerName } from '../format';
import { store } from '../store';

export function Waivers({ league }: { league: League }) {
  const [cuts, setCuts] = useState<Record<number, number | null>>({});
  const [filter, setFilter] = useState<'available' | 'mine' | 'released'>('available');
  const [sort, onSort] = useSort<'player' | 'pos' | 'ovr' | 'cap' | 'deadline'>({ key: 'deadline', desc: false });
  const state = league.personnel?.waivers;
  if (!league.personnel?.enabled)
    return (
      <Panel title="Waiver wire">
        <p>Personnel transactions are not active in this career yet.</p>
      </Panel>
    );
  const teamId = league.userTeamId;
  const deadline = nextWaiverDeadline(league);
  const problem = nextDeadlineBlocker(league);
  const roster = activeRoster(league, teamId);
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
        return e.deadline;
    }
  });
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
              ? 'These are your requests to add players. A successful claim brings the player to your main roster on his current contract.'
              : 'These players were released by other teams. Place a claim to add a player to your main roster on his current contract.'}
        </p>
        {filter !== 'released' && (
          <>
            <p className="small muted">
              Your place in line:{' '}
              <b>
                {waiverOrder(league).indexOf(teamId) + 1} of {league.teams.length}
              </b>
              . If several teams want the same player, the team nearest the front gets him.
            </p>
          </>
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
        {deadline !== undefined && (
          <div className="row">
            <span>Claims decided: {personnelLabel(deadline)}</span>
            <button
              className="btn"
              disabled={!!problem}
              title={problem ?? undefined}
              onClick={() => store.mutate(advanceNextPersonnelEvent)}
            >
              Advance to deadline
            </button>
            {problem && <span className="small muted">{problem}</span>}
          </div>
        )}
        {filter !== 'released' && (
          <>
            <details className="personnel-help">
              <summary>How claims work</summary>
              <p>A successful claim brings the player to your main roster with his existing pay and contract years.</p>
              <p>
                If your roster is full, choose someone under “Release only if signed.” He is released only if your claim
                succeeds. If you lose the claim, you keep him.
              </p>
            </details>
          </>
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
                  <SortTh label="Deadline" k="deadline" sort={sort} onSort={onSort} />
                  {filter !== 'released' && <th>Release only if signed</th>}
                  <th>{filter === 'released' ? 'Status' : 'Request'}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((e) => {
                  const p = league.players[e.playerId];
                  const own = mine.find((c) => c.entryId === e.id);
                  const candidate = {
                    entryId: e.id,
                    teamId,
                    preference: own?.preference ?? mine.length,
                    cutIds: cuts[e.id] === undefined ? (own?.cutIds ?? []) : cuts[e.id] === null ? [] : [cuts[e.id]!],
                  };
                  const issue = claimProblem(league, candidate);
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
                      <td>{personnelLabel(e.deadline)}</td>
                      {filter !== 'released' && (
                        <>
                          <td>
                            <select
                              disabled={e.fromTeamId === teamId}
                              aria-label={`Release only if ${p.firstName} ${p.lastName} joins your team`}
                              value={cuts[e.id] === undefined ? (own?.cutIds[0] ?? '') : (cuts[e.id] ?? '')}
                              onChange={(event) =>
                                setCuts({ ...cuts, [e.id]: event.target.value ? Number(event.target.value) : null })
                              }
                            >
                              <option value="">Keep everyone</option>
                              {roster.map((x) => (
                                <option key={x.id} value={x.id}>{`${x.position} ${playerName(x)}`}</option>
                              ))}
                            </select>
                          </td>
                        </>
                      )}
                      <td>
                        {filter === 'released' ? (
                          <span className="small muted waiver-reason">
                            Waiting for other teams. If nobody claims him, you can offer a new deal.
                          </span>
                        ) : (
                          <>
                            <button
                              className="btn btn-sm"
                              disabled={!!issue}
                              title={issue ?? undefined}
                              onClick={() => store.mutate((l) => setWaiverClaim(l, candidate))}
                            >
                              {own ? 'Update claim' : 'Claim player'}
                            </button>
                            {own && (
                              <button
                                className="btn btn-sm"
                                onClick={() => store.mutate((l) => cancelWaiverClaim(l, e.id, teamId))}
                              >
                                Withdraw
                              </button>
                            )}
                            {issue && (
                              <div className="small muted waiver-reason">
                                {e.fromTeamId === teamId
                                  ? 'You released him. If nobody claims him, you can offer a new deal.'
                                  : issue}
                              </div>
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
              const e = state!.pending.find((e) => e.id === c.entryId)!;
              return (
                <li key={c.entryId}>
                  <PlayerLink league={league} player={league.players[e.playerId]} />{' '}
                  <button className="btn btn-sm" disabled={index === 0} onClick={() => reorder(index, -1)}>
                    Move up
                  </button>{' '}
                  <button className="btn btn-sm" disabled={index === mine.length - 1} onClick={() => reorder(index, 1)}>
                    Move down
                  </button>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}
      {!!state?.results.length && (
        <Panel title="Recent awards and clearances">
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
    </div>
  );
}
