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
  const rows = sortRows(state?.pending ?? [], sort, (e, key) => {
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
          Your priority: <b>{waiverOrder(league).indexOf(teamId) + 1}</b>. A claim takes the existing salary and
          remaining years. Winning does not change your league priority.
        </p>
        <p className="small muted">
          Only your claims are shown. Conditional releases happen only if you win and the complete move still fits your
          roster and cap.
        </p>
        {deadline !== undefined && (
          <div className="row">
            <span>Next notice: {personnelLabel(deadline)}</span>
            <button
              className="btn"
              disabled={!!problem}
              title={problem ?? undefined}
              onClick={() => store.mutate(advanceNextPersonnelEvent)}
            >
              Process next notice
            </button>
            {problem && <span className="small muted">{problem}</span>}
          </div>
        )}
        {!rows.length ? (
          <p className="muted">No players are on waivers.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh label="Player" k="player" sort={sort} onSort={onSort} />
                  <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} />
                  <SortTh label="Overall" k="ovr" sort={sort} onSort={onSort} />
                  <SortTh label="This year" k="cap" sort={sort} onSort={onSort} />
                  <SortTh label="Deadline" k="deadline" sort={sort} onSort={onSort} />
                  <th>Conditional release</th>
                  <th>Claim</th>
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
                          From <TeamLink team={league.teams[e.fromTeamId]} />
                        </div>
                      </td>
                      <td>{p.position}</td>
                      <td>
                        <Ovr league={league} player={p} />
                      </td>
                      <td className="num">
                        {money(capHit(assignedContract(e), league.season))}
                        <div className="small muted">Through {lastSeason(e.contract)}</div>
                      </td>
                      <td>{personnelLabel(e.deadline)}</td>
                      <td>
                        <select
                          aria-label={`Conditional release for ${p.firstName} ${p.lastName}`}
                          value={cuts[e.id] === undefined ? (own?.cutIds[0] ?? '') : (cuts[e.id] ?? '')}
                          onChange={(event) =>
                            setCuts({ ...cuts, [e.id]: event.target.value ? Number(event.target.value) : null })
                          }
                        >
                          <option value="">No release</option>
                          {roster.map((x) => (
                            <option key={x.id} value={x.id}>{`${x.position} ${playerName(x)}`}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <button
                          className="btn btn-sm"
                          disabled={!!issue}
                          title={issue ?? undefined}
                          onClick={() => store.mutate((l) => setWaiverClaim(l, candidate))}
                        >
                          {own ? 'Update' : 'Submit claim'}
                        </button>
                        {own && (
                          <button
                            className="btn btn-sm"
                            onClick={() => store.mutate((l) => cancelWaiverClaim(l, e.id, teamId))}
                          >
                            Withdraw
                          </button>
                        )}
                        {issue && <div className="small muted">{issue}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      {mine.length > 0 && (
        <Panel title="Your claim preferences">
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
                    'cleared waivers'
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
