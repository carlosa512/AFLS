import { useState } from 'react';
import { capSpace } from '../../engine/finance/cap';
import { lastSeason, yearsLeft } from '../../engine/finance/contract';
import { fifthYearOptionValue } from '../../engine/finance/market';
import { draftForUser, draftToEnd, draftToUserPick, FA_DAYS } from '../../engine/offseason';
import { applyFranchiseTag, exerciseFifthYearOption, expiringPlayers, needGain, tagBlocker, tagValue } from '../../engine/offseason/ai';
import { availableProspects, boardValue, draftOrder, nextPick, POSITION_PREMIUM, positionDepth } from '../../engine/offseason/draft';
import { demand, extensionBlocker, freeAgents } from '../../engine/offseason/negotiation';
import { POSITION_NAMES } from '../../engine/positions';
import { teamPlayers } from '../../engine/roster';
import { isExpiring, teamStaff } from '../../engine/staff';
import type { League, Player, Position } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerAvatar, Rating, TeamChip } from '../components';
import { money, PHASE_LABELS } from '../format';
import { NegotiationDialog } from '../negotiation';
import { KnowledgeMeter, Ovr, potentialText, ScoutButton, seenOvr, Stars, starsOf, viewOf } from '../scouting';
import { StaffScreen } from './Staff';
import { Trades } from './Trades';
import { store } from '../store';

export type OfficeTab = 'resign' | 'fa' | 'draft' | 'trades' | 'staff';

export const defaultOfficeTab = (league: League): OfficeTab => (league.phase === 'resign' ? 'resign' : league.phase === 'draft' ? 'draft' : 'fa');

function PlayerCell({ league, p }: { league: League; p: Player }) {
  const nav = useNav();
  return (
    <button className="linklike player-link" onClick={() => nav.openPlayer(p.id)}>
      <PlayerAvatar player={p} team={p.teamId !== null ? league.teams[p.teamId] : null} size={26} />
      <span>
        {p.firstName} {p.lastName}
      </span>
    </button>
  );
}

function PositionFilter({ value, onChange }: { value: Position | 'ALL'; onChange: (v: Position | 'ALL') => void }) {
  return (
    <select aria-label="Filter by position" value={value} onChange={(e) => onChange(e.target.value as Position | 'ALL')}>
      <option value="ALL">All positions</option>
      {POSITIONS.map((p) => (
        <option key={p} value={p}>
          {POSITION_NAMES[p]}
        </option>
      ))}
    </select>
  );
}

// ───────── re-sign window ─────────

function Resign({ league, negotiate }: { league: League; negotiate: (p: Player) => void }) {
  const teamId = league.userTeamId;
  const team = league.teams[teamId];
  const expiring = league.phase === 'resign' ? expiringPlayers(league, teamId) : [];
  const options = teamPlayers(league, teamId).filter((p) => p.contract?.fifthYearOption === 'eligible' && lastSeason(p.contract) === league.season);
  // Worth a call: starters and promising young players, not the bottom of the depth chart.
  const extensions = teamPlayers(league, teamId)
    .filter((p) => p.contract && lastSeason(p.contract) >= league.season && yearsLeft(p.contract, league.season) <= 2 && !extensionBlocker(league, p) && p.contract.kind !== 'tag')
    .filter((p) => seenOvr(league, p) >= 11 || (p.age <= 25 && viewOf(league, p).potHi >= 12))
    .sort((a, b) => seenOvr(league, b) - seenOvr(league, a))
    .slice(0, 15);
  const tagged = team.taggedId ? league.players[team.taggedId] : null;

  return (
    <>
      {league.phase === 'resign' ? (
        <Panel title="Expiring contracts">
          <p className="muted small" style={{ marginTop: 0 }}>
            Anyone you don't re-sign or tag becomes a free agent when free agency opens. Asks are market value plus his agent's appetite.
            {tagged ? ` You tagged ${tagged.firstName} ${tagged.lastName} this year.` : ' You have one franchise tag: a fully guaranteed one-year deal.'}
          </p>
          {expiring.length === 0 ? (
            <p className="muted">No expiring contracts this year.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th className="sticky-col">Player</th>
                    <th>Pos</th>
                    <th className="num">Age</th>
                    <th className="num">OVR</th>
                    <th className="num">Old APY</th>
                    <th className="num">Market</th>
                    <th className="num">Ask</th>
                    <th>Talks</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {expiring.map((p) => {
                    const d = demand(league, p, teamId);
                    const n = league.negotiations[p.id];
                    const broken = n?.status === 'broken' && n.brokenPhase === league.phase;
                    const blocker = tagBlocker(league, p);
                    return (
                      <tr key={p.id}>
                        <td className="sticky-col">
                          <PlayerCell league={league} p={p} />
                        </td>
                        <td>{p.position}</td>
                        <td className="num">{p.age}</td>
                        <td className="num">
                          <Ovr league={league} player={p} />
                        </td>
                        <td className="num muted">{money(p.contract!.apy)}</td>
                        <td className="num">{money(d.market)}</td>
                        <td className="num">
                          {money(d.askApy)} × {d.askYears}
                        </td>
                        <td className={broken ? 'tone-bad small' : 'muted small'}>{broken ? 'Broken off' : n ? `${n.patience} left` : 'Open'}</td>
                        <td>
                          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <button className="btn btn-sm" onClick={() => negotiate(p)} disabled={broken}>
                              Negotiate
                            </button>
                            <button className="btn btn-sm" disabled={!!blocker} title={blocker ?? 'One-year deal, fully guaranteed'} onClick={() => store.mutate((l) => applyFranchiseTag(l, l.players[p.id]))}>
                              Tag {money(tagValue(league, p))}
                            </button>
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      ) : (
        <div className="notice">The re-sign window opens at the start of each offseason. During the year you can extend players in the last two years of their deals.</div>
      )}

      {options.length > 0 && (
        <Panel title="Fifth-year options">
          <p className="muted small" style={{ marginTop: 0 }}>
            First-round picks after three seasons. Exercising adds a fully guaranteed fifth year at a salary set by how he ranks at his position.
          </p>
          <div className="table-scroll">
            <table>
              <tbody>
                {options.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <PlayerCell league={league} p={p} />
                    </td>
                    <td>{p.position}</td>
                    <td className="num">
                      <Ovr league={league} player={p} />
                    </td>
                    <td className="num">{money(fifthYearOptionValue(league, p))} in {league.season + 1}</td>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <button className="btn btn-sm btn-primary" onClick={() => store.mutate((l) => exerciseFifthYearOption(l, l.players[p.id], true))}>
                          Exercise
                        </button>
                        <button className="btn btn-sm" onClick={() => store.mutate((l) => exerciseFifthYearOption(l, l.players[p.id], false))}>
                          Decline
                        </button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Extension candidates">
        <p className="muted small" style={{ marginTop: 0 }}>
          Players in the last two years of their deals (rookies after three seasons). Extending early can beat a rising market; the old bonus keeps counting.
        </p>
        {extensions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nobody is eligible right now.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <tbody>
                {extensions.map((p) => {
                  const d = demand(league, p, teamId);
                  return (
                    <tr key={p.id}>
                      <td>
                        <PlayerCell league={league} p={p} />
                      </td>
                      <td>{p.position}</td>
                      <td className="num">{p.age}</td>
                      <td className="num">
                        <Ovr league={league} player={p} />
                      </td>
                      <td className="num muted">thru {lastSeason(p.contract!)}</td>
                      <td className="num">
                        ask {money(d.askApy)} × {d.askYears}
                      </td>
                      <td>
                        <button className="btn btn-sm" onClick={() => negotiate(p)}>
                          Extend
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

// ───────── free agents ─────────

function FreeAgents({ league, negotiate }: { league: League; negotiate: (p: Player) => void }) {
  const [pos, setPos] = useState<Position | 'ALL'>('ALL');
  const teamId = league.userTeamId;
  const depth = positionDepth(league, teamId);
  if (league.phase === 'resign') {
    const pending = league.teams
      .filter((t) => t.id !== teamId)
      .flatMap((t) => expiringPlayers(league, t.id))
      .sort((a, b) => seenOvr(league, b) - seenOvr(league, a))
      .slice(0, 25);
    return (
      <Panel title="Coming to market">
        <p className="muted small" style={{ marginTop: 0 }}>
          Free agency opens when you advance. These players' deals have run out; their teams may still re-sign or tag them first.
        </p>
        <div className="table-scroll">
          <table>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id}>
                  <td>
                    <PlayerCell league={league} p={p} />
                  </td>
                  <td>{p.position}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Ovr league={league} player={p} />
                  </td>
                  <td>
                    <TeamChip team={league.teams[p.teamId!]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>
    );
  }
  const pool = freeAgents(league)
    .filter((p) => pos === 'ALL' || p.position === pos)
    .map((p) => ({ p, d: demand(league, p, teamId) }))
    .sort((a, b) => b.d.market - a.d.market)
    .slice(0, 120);
  return (
    <Panel
      title="Free agents"
      action={
        <span className="row" style={{ gap: 8 }}>
          <span className="muted small">Cap room {money(Math.round(capSpace(league, teamId)))}</span>
          <PositionFilter value={pos} onChange={setPos} />
        </span>
      }
    >
      <p className="muted small" style={{ marginTop: 0 }}>
        {league.phase === 'freeAgency'
          ? `Day ${league.faDay} of ${FA_DAYS}. Other teams sign players each time you advance a day, and asks soften as the market cools.`
          : 'Players still unsigned take less the longer they wait.'}
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th className="sticky-col">Player</th>
              <th>Pos</th>
              <th className="num">Age</th>
              <th className="num">OVR</th>
              <th>For you</th>
              <th className="num">Market</th>
              <th className="num">Ask</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {pool.map(({ p, d }) => {
              const gain = needGain(depth, p, seenOvr(league, p));
              return (
                <tr key={p.id}>
                  <td className="sticky-col">
                    <PlayerCell league={league} p={p} />
                  </td>
                  <td>{p.position}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Ovr league={league} player={p} />
                  </td>
                  <td>{gain >= 0.5 ? <span className="tag-pill tag-good">Would start</span> : gain > 0 ? <span className="tag-pill">Depth</span> : <span className="muted small">–</span>}</td>
                  <td className="num">{money(d.market)}</td>
                  <td className="num">
                    {money(d.askApy)} × {d.askYears}
                  </td>
                  <td>
                    <button className="btn btn-sm" onClick={() => negotiate(p)}>
                      Negotiate
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

// ───────── draft ─────────

type BoardSort = 'consensus' | 'mine';

/** Your own board value: the AI's formula, fed your scouts' grades instead of the consensus. */
const myBoardValue = (league: League, p: Player) => {
  const v = viewOf(league, p);
  return 0.6 * v.ovr + 0.4 * v.potMid + POSITION_PREMIUM[p.position];
};

function Draft({ league }: { league: League }) {
  const nav = useNav();
  const [pos, setPos] = useState<Position | 'ALL'>('ALL');
  const [sort, setSort] = useState<BoardSort>('consensus');
  const teamId = league.userTeamId;
  const myPicks = league.draftPicks.filter((p) => p.ownerId === teamId).sort((a, b) => a.season - b.season || (a.overall ?? a.round * 32) - (b.overall ?? b.round * 32));
  const all = availableProspects(league);
  // Consensus rank across the whole class: roughly where the league will take him.
  const rank = new Map([...all].sort((a, b) => boardValue(b) - boardValue(a)).map((p, i) => [p.id, i + 1]));
  const prospects = all
    .filter((p) => pos === 'ALL' || p.position === pos)
    .sort((a, b) => (sort === 'mine' ? myBoardValue(league, b) - myBoardValue(league, a) : rank.get(a.id)! - rank.get(b.id)!));
  const onClock = league.phase === 'draft' ? nextPick(league) : undefined;
  const userUp = onClock?.ownerId === teamId;
  const recent = draftOrder(league)
    .filter((p) => p.playerId !== undefined)
    .slice(-8)
    .reverse();

  return (
    <>
      {league.phase === 'draft' && (
        <Panel
          title={
            onClock ? (
              <div className="row">
                <TeamChip team={league.teams[onClock.ownerId]} large />
                <div>
                  <h2>{userUp ? "You're on the clock" : `${league.teams[onClock.ownerId].name} on the clock`}</h2>
                  <span className="muted">
                    Round {onClock.round}, pick {onClock.overall}
                  </span>
                </div>
              </div>
            ) : (
              <h2>The draft is complete</h2>
            )
          }
          action={
            onClock && (
              <span className="row" style={{ gap: 8 }}>
                {!userUp && (
                  <button className="btn" onClick={() => store.mutate(draftToUserPick)}>
                    Sim to my pick
                  </button>
                )}
                {userUp && (
                  <button className="btn" onClick={() => store.mutate((l) => draftForUser(l))}>
                    Auto-pick for me
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => store.mutate(draftToEnd)}>
                  Sim the rest (AI picks for you)
                </button>
              </span>
            )
          }
        >
          {recent.length > 0 && (
            <ul className="moves picks-feed">
              {recent.map((pk) => {
                const p = league.players[pk.playerId!];
                // Taken a round of the board ahead of his consensus rank is a reach; that far behind it, a steal.
                const gap = pk.consRank !== undefined && pk.overall !== undefined ? pk.consRank - pk.overall : 0;
                return (
                  <li key={pk.id}>
                    <span className="muted small">
                      No. {pk.overall} · {league.teams[pk.ownerId].abbrev}
                    </span>
                    <span>
                      {p.position} {p.firstName} {p.lastName}
                      {gap >= 12 && <span className="tag-pill tag-warn">reach</span>}
                      {gap <= -12 && <span className="tag-pill tag-good">steal</span>}{' '}
                      <span className="muted small">{pk.consRank !== undefined ? `consensus #${pk.consRank}` : `consensus ${p.scouting?.grade ?? '–'}`}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Panel>
      )}

      {prospects.length > 0 && (
        <Panel
          title={league.phase === 'draft' ? 'Big board' : `${league.season} draft class`}
          action={
            <span className="board-sort">
              <div className="seg seg-sm" role="group" aria-label="Rank prospects by">
                <button aria-pressed={sort === 'consensus'} onClick={() => setSort('consensus')}>
                  Consensus
                </button>
                <button aria-pressed={sort === 'mine'} onClick={() => setSort('mine')}>
                  Your board
                </button>
              </div>
              <PositionFilter value={pos} onChange={setPos} />
            </span>
          }
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            <b>Your grade</b> and <b>ceiling</b> are your scouts' estimates (a dashed grade is a guess). <b>Consensus</b> is how the rest of the league
            rates him. Rivals blend it with their own scouts' reads, and trust their scouts more when those scouts are good, so he can go earlier or later than
            his rank. When your read beats the consensus, you've found a sleeper; when it's worse, let someone else take the bust. Each scouting visit narrows a
            range:{' '}
            <b>
              {league.scoutPoints} visit{league.scoutPoints === 1 ? '' : 's'} left
            </b>{' '}
            this year.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th className="num">#</th>
                  <th className="sticky-col">Prospect</th>
                  <th>Pos</th>
                  <th className="num">Age</th>
                  <th className="num">40</th>
                  <th className="num">Your grade</th>
                  <th className="num">Ceiling</th>
                  <th>Stars</th>
                  <th className="num">Consensus</th>
                  <th>Known</th>
                  <th />
                  {userUp && <th />}
                </tr>
              </thead>
              <tbody>
                {prospects.slice(0, 150).map((p) => {
                  const v = viewOf(league, p);
                  return (
                    <tr key={p.id}>
                      <td className="num muted">{rank.get(p.id)}</td>
                      <td className="sticky-col">
                        <button className="linklike player-link" onClick={() => nav.openPlayer(p.id)}>
                          <PlayerAvatar player={p} team={null} size={26} />
                          <span>
                            {p.firstName} {p.lastName}
                          </span>
                        </button>
                      </td>
                      <td>{p.position}</td>
                      <td className="num">{p.age}</td>
                      <td className="num muted">{p.combine?.forty?.toFixed(2) ?? '–'}</td>
                      <td className="num">
                        <Ovr league={league} player={p} />
                      </td>
                      <td className="num">
                        {potentialText(v)}
                      </td>
                      <td>
                        <Stars s={starsOf(league, p, 'league', v)} size={13} />
                      </td>
                      <td className="num">
                        <Rating value={p.scouting!.grade} decimals={1} />
                      </td>
                      <td>
                        <KnowledgeMeter value={v.knowledge} />
                      </td>
                      <td>
                        <ScoutButton league={league} player={p} />
                      </td>
                      {userUp && (
                        <td>
                          <button className="btn btn-sm btn-primary" onClick={() => store.mutate((l) => draftForUser(l, p.id))}>
                            Draft
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel title="Your picks">
        {myPicks.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            You don't own any picks.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <tbody>
                {myPicks.map((pk) => {
                  const used = pk.playerId !== undefined ? league.players[pk.playerId] : null;
                  return (
                    <tr key={pk.id}>
                      <td className="num">{pk.season}</td>
                      <td>Round {pk.round}</td>
                      <td className="num">{pk.overall ? `No. ${pk.overall}` : '–'}</td>
                      <td>{pk.originalTeamId !== teamId ? <span className="muted small">from {league.teams[pk.originalTeamId].abbrev}</span> : null}</td>
                      <td>{used ? `${used.position} ${used.firstName} ${used.lastName}` : ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

export function FrontOffice({ league, tab }: { league: League; tab?: OfficeTab }) {
  const nav = useNav();
  const active = tab ?? defaultOfficeTab(league);
  const [talking, setTalking] = useState<number | null>(null);
  const TABS: [OfficeTab, string][] = [
    ['resign', 'Re-sign'],
    ['fa', 'Free agents'],
    ['draft', 'Draft'],
    ['trades', 'Trades'],
    ['staff', 'Staff'],
  ];
  const staffDue = league.phase === 'resign' ? teamStaff(league, league.userTeamId).filter((s) => isExpiring(league, s)).length : 0;
  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <div className="seg office-tabs" role="tablist" aria-label="Front office">
          {TABS.map(([key, label]) => (
            <button key={key} role="tab" aria-selected={active === key} aria-pressed={active === key} onClick={() => nav.go({ view: 'office', tab: key })}>
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">
          {league.season} · {PHASE_LABELS[league.phase]}
          {league.phase === 'freeAgency' ? `, day ${league.faDay} of ${FA_DAYS}` : ''}
        </span>
      </div>
      {staffDue > 0 && active !== 'staff' && (
        <div className="notice staff-notice">
          <span>
            {staffDue === 1 ? '1 scouting staff deal is up. He re-signs automatically unless you let him go.' : `${staffDue} scouting staff deals are up. They re-sign automatically unless you let them go.`}
          </span>
          <button className="btn btn-sm" onClick={() => nav.go({ view: 'office', tab: 'staff' })}>
            Review staff
          </button>
        </div>
      )}
      {active === 'resign' && <Resign league={league} negotiate={(p) => setTalking(p.id)} />}
      {active === 'fa' && <FreeAgents league={league} negotiate={(p) => setTalking(p.id)} />}
      {active === 'draft' && <Draft league={league} />}
      {active === 'trades' && <Trades league={league} />}
      {active === 'staff' && <StaffScreen league={league} />}
      {talking !== null && league.players[talking] && <NegotiationDialog league={league} player={league.players[talking]} onClose={() => setTalking(null)} />}
    </>
  );
}
