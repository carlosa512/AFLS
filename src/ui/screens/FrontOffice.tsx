import { PracticeSquad } from './PracticeSquad';
import { useEffect, useRef, useState } from 'react';
import { GeneralManagers } from './GeneralManagers';
import { capSpace } from '../../engine/finance/cap';
import { lastSeason, yearsLeft } from '../../engine/finance/contract';
import { fifthYearOptionValue } from '../../engine/finance/market';
import { FA_DAYS } from '../../engine/offseason';
import {
  applyFranchiseTag,
  exerciseFifthYearOption,
  expiringPlayers,
  needGain,
  tagBlocker,
  tagValue,
} from '../../engine/offseason/ai';
import { positionDepth } from '../../engine/offseason/draft';
import { demand, extensionBlocker, freeAgents } from '../../engine/offseason/negotiation';
import { teamPlayers } from '../../engine/roster';
import { pron } from '../../engine/pronouns';
import { resignForecast, staffName, staffWindowOpen } from '../../engine/staff';
import type { League, Player, Position } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PositionFilter, PlayerLink, SortTh, sortRows, TeamChip, useSort, type SortState } from '../components';
import { attentionText, coachAttention } from '../coaching';
import { money, PHASE_LABELS } from '../format';
import { NegotiationDialog } from '../negotiation';
import { Ovr, seenOvr, viewOf } from '../scouting';
import { CoachesScreen } from './Coaches';
import { Draft } from './Draft';
import { MedicalScreen } from './Medical';
import { StaffScreen } from './Staff';
import { Trades, type TradeTab } from './Trades';
import { Waivers } from './Waivers';
import { LinkedText, type Who } from '../moves';
import { store } from '../store';

export type OfficeTab =
  | 'resign'
  | 'fa'
  | 'squad'
  | 'waivers'
  | 'draft'
  | 'trades'
  | 'coaches'
  | 'staff'
  | 'medical'
  | 'gms';

export const defaultOfficeTab = (league: League): OfficeTab =>
  league.phase === 'resign' ? 'resign' : league.phase === 'draft' ? 'draft' : 'fa';

// ───────── re-sign window ─────────

/** The columns the re-sign tables share; each table sorts by the ones it shows. */
type ResignSort = 'name' | 'pos' | 'age' | 'ovr' | 'old' | 'market' | 'ask' | 'option' | 'thru' | 'team';

function resignSortValue(league: League, p: Player, key: ResignSort): number | string {
  switch (key) {
    case 'name':
      return `${p.lastName} ${p.firstName}`.toLowerCase();
    case 'pos':
      return POSITIONS.indexOf(p.position);
    case 'age':
      return p.age;
    case 'ovr':
      return seenOvr(league, p);
    case 'old':
      return p.contract?.apy ?? 0;
    case 'market':
      return demand(league, p, league.userTeamId).market;
    case 'ask':
      return demand(league, p, league.userTeamId).askApy;
    case 'option':
      return fifthYearOptionValue(league, p);
    case 'thru':
      return p.contract ? lastSeason(p.contract) : 0;
    case 'team':
      return p.teamId !== null ? league.teams[p.teamId].abbrev : '';
  }
}

export function Resign({ league, negotiate }: { league: League; negotiate: (p: Player) => void }) {
  const teamId = league.userTeamId;
  const team = league.teams[teamId];
  const [expSort, onExpSort] = useSort<ResignSort>({ key: 'ovr', desc: true });
  const [optSort, onOptSort] = useSort<ResignSort>({ key: 'ovr', desc: true });
  const [extSort, onExtSort] = useSort<ResignSort>({ key: 'ovr', desc: true });
  const by = (sort: SortState<ResignSort>) => (rows: Player[]) =>
    sortRows(rows, sort, (p, key) => resignSortValue(league, p, key));
  const expiring = by(expSort)(league.phase === 'resign' ? expiringPlayers(league, teamId) : []);
  const options = by(optSort)(
    teamPlayers(league, teamId).filter(
      (p) => p.contract?.fifthYearOption === 'eligible' && lastSeason(p.contract) === league.season,
    ),
  );
  // Worth a call: starters and promising young players, not the bottom of the depth chart.
  const extensions = teamPlayers(league, teamId)
    .filter(
      (p) =>
        p.contract &&
        lastSeason(p.contract) >= league.season &&
        yearsLeft(p.contract, league.season) <= 2 &&
        !extensionBlocker(league, p) &&
        p.contract.kind !== 'tag',
    )
    .filter((p) => seenOvr(league, p) >= 11 || (p.age <= 25 && viewOf(league, p).potHi >= 12))
    .sort((a, b) => seenOvr(league, b) - seenOvr(league, a))
    .slice(0, 15);
  const extensionRows = by(extSort)(extensions);
  const tagged = team.taggedId ? league.players[team.taggedId] : null;

  return (
    <>
      {league.phase === 'resign' ? (
        <Panel title="Expiring contracts">
          <p className="muted small" style={{ marginTop: 0 }}>
            Anyone you don't re-sign or tag becomes a free agent when free agency opens. Asks are market value plus his
            agent's appetite.
            {tagged ? (
              <>
                {' '}
                You tagged <PlayerLink league={league} player={tagged} /> this year.
              </>
            ) : (
              ' You have one franchise tag: a fully guaranteed one-year deal.'
            )}
          </p>
          {expiring.length === 0 ? (
            <p className="muted">No expiring contracts this year.</p>
          ) : (
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <SortTh
                      label="Player"
                      k="name"
                      sort={expSort}
                      onSort={onExpSort}
                      desc={false}
                      className="sticky-col"
                    />
                    <SortTh label="Pos" k="pos" sort={expSort} onSort={onExpSort} desc={false} />
                    <SortTh label="Age" k="age" sort={expSort} onSort={onExpSort} desc={false} className="num" />
                    <SortTh label="OVR" k="ovr" sort={expSort} onSort={onExpSort} className="num" />
                    <SortTh label="Old APY" k="old" sort={expSort} onSort={onExpSort} className="num" />
                    <SortTh label="Market" k="market" sort={expSort} onSort={onExpSort} className="num" />
                    <SortTh label="Ask" k="ask" sort={expSort} onSort={onExpSort} className="num" />
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
                          <PlayerLink league={league} player={p} avatar={26} />
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
                        <td className={broken ? 'tone-bad small' : 'muted small'}>
                          {broken ? 'Broken off' : n ? `${n.patience} left` : 'Open'}
                        </td>
                        <td>
                          <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                            <button className="btn btn-sm" onClick={() => negotiate(p)} disabled={broken}>
                              Negotiate
                            </button>
                            <button
                              className="btn btn-sm"
                              disabled={!!blocker}
                              title={blocker ?? 'One-year deal, fully guaranteed'}
                              onClick={() => store.mutate((l) => applyFranchiseTag(l, l.players[p.id]))}
                            >
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
        <div className="notice">
          The re-sign window opens at the start of each offseason. During the year you can extend players in the last
          two years of their deals.
        </div>
      )}

      {options.length > 0 && (
        <Panel title="Fifth-year options">
          <p className="muted small" style={{ marginTop: 0 }}>
            First-round picks after three seasons. Exercising adds a fully guaranteed fifth year at a salary set by how
            he ranks at his position.
          </p>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh label="Player" k="name" sort={optSort} onSort={onOptSort} desc={false} />
                  <SortTh label="Pos" k="pos" sort={optSort} onSort={onOptSort} desc={false} />
                  <SortTh label="OVR" k="ovr" sort={optSort} onSort={onOptSort} className="num" />
                  <SortTh label="Option" k="option" sort={optSort} onSort={onOptSort} className="num" />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {options.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <PlayerLink league={league} player={p} avatar={26} />
                    </td>
                    <td>{p.position}</td>
                    <td className="num">
                      <Ovr league={league} player={p} />
                    </td>
                    <td className="num">
                      {money(fifthYearOptionValue(league, p))} in {league.season + 1}
                    </td>
                    <td>
                      <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => store.mutate((l) => exerciseFifthYearOption(l, l.players[p.id], true))}
                        >
                          Exercise
                        </button>
                        <button
                          className="btn btn-sm"
                          onClick={() => store.mutate((l) => exerciseFifthYearOption(l, l.players[p.id], false))}
                        >
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
          Players in the last two years of their deals (rookies after three seasons). Extending early can beat a rising
          market; the old bonus keeps counting.
        </p>
        {extensions.length === 0 ? (
          <p className="muted" style={{ margin: 0 }}>
            Nobody is eligible right now.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh label="Player" k="name" sort={extSort} onSort={onExtSort} desc={false} />
                  <SortTh label="Pos" k="pos" sort={extSort} onSort={onExtSort} desc={false} />
                  <SortTh label="Age" k="age" sort={extSort} onSort={onExtSort} desc={false} className="num" />
                  <SortTh label="OVR" k="ovr" sort={extSort} onSort={onExtSort} className="num" />
                  <SortTh label="Thru" k="thru" sort={extSort} onSort={onExtSort} className="num" />
                  <SortTh label="Ask" k="ask" sort={extSort} onSort={onExtSort} className="num" />
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {extensionRows.map((p) => {
                  const d = demand(league, p, teamId);
                  return (
                    <tr key={p.id}>
                      <td>
                        <PlayerLink league={league} player={p} avatar={26} />
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

type FaSort = 'name' | 'pos' | 'age' | 'ovr' | 'fit' | 'market' | 'ask';

function FreeAgents({
  league,
  start,
  negotiate,
}: {
  league: League;
  /** The position a link opened the tab on. */
  start?: Position;
  negotiate: (p: Player) => void;
}) {
  const [pos, setPos] = useState<Position | 'ALL'>(start ?? 'ALL');
  const [sort, onSort] = useSort<FaSort>({ key: 'market', desc: true });
  const [pendingSort, onPendingSort] = useSort<ResignSort>({ key: 'ovr', desc: true });
  const teamId = league.userTeamId;
  const depth = positionDepth(league, teamId);
  if (league.phase === 'resign') {
    // The 25 best by our read, in whatever order the header asks for.
    const pending = sortRows(
      league.teams
        .filter((t) => t.id !== teamId)
        .flatMap((t) => expiringPlayers(league, t.id))
        .sort((a, b) => seenOvr(league, b) - seenOvr(league, a))
        .slice(0, 25),
      pendingSort,
      (p, key) => resignSortValue(league, p, key),
    );
    return (
      <Panel title="Coming to market">
        <p className="muted small" style={{ marginTop: 0 }}>
          Free agency opens when you advance. These players' deals have run out; their teams may still re-sign or tag
          them first.
        </p>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortTh label="Player" k="name" sort={pendingSort} onSort={onPendingSort} desc={false} />
                <SortTh label="Pos" k="pos" sort={pendingSort} onSort={onPendingSort} desc={false} />
                <SortTh label="Age" k="age" sort={pendingSort} onSort={onPendingSort} desc={false} className="num" />
                <SortTh label="OVR" k="ovr" sort={pendingSort} onSort={onPendingSort} className="num" />
                <SortTh label="Team" k="team" sort={pendingSort} onSort={onPendingSort} desc={false} />
              </tr>
            </thead>
            <tbody>
              {pending.map((p) => (
                <tr key={p.id}>
                  <td>
                    <PlayerLink league={league} player={p} avatar={26} />
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
  const rows = freeAgents(league)
    .filter((p) => pos === 'ALL' || p.position === pos)
    .map((p) => ({ p, d: demand(league, p, teamId), gain: needGain(depth, p, seenOvr(league, p)) }));
  // Sort the whole pool before trimming it, so "youngest" or "cheapest" reaches past the top of the market.
  const pool = sortRows(rows, sort, ({ p, d, gain }, key) =>
    key === 'name'
      ? `${p.lastName} ${p.firstName}`.toLowerCase()
      : key === 'pos'
        ? POSITIONS.indexOf(p.position)
        : key === 'age'
          ? p.age
          : key === 'ovr'
            ? seenOvr(league, p)
            : key === 'fit'
              ? gain
              : key === 'ask'
                ? d.askApy
                : d.market,
  ).slice(0, 120);
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
              <SortTh label="Player" k="name" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
              <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} desc={false} />
              <SortTh label="Age" k="age" sort={sort} onSort={onSort} desc={false} className="num" />
              <SortTh label="OVR" k="ovr" sort={sort} onSort={onSort} className="num" />
              <SortTh label="For you" k="fit" sort={sort} onSort={onSort} />
              <SortTh label="Market" k="market" sort={sort} onSort={onSort} className="num" />
              <SortTh label="Ask" k="ask" sort={sort} onSort={onSort} className="num" />
              <th />
            </tr>
          </thead>
          <tbody>
            {pool.map(({ p, d, gain }) => {
              return (
                <tr key={p.id}>
                  <td className="sticky-col">
                    <PlayerLink league={league} player={p} avatar={26} />
                  </td>
                  <td>{p.position}</td>
                  <td className="num">{p.age}</td>
                  <td className="num">
                    <Ovr league={league} player={p} />
                  </td>
                  <td>
                    {gain >= 0.5 ? (
                      <span className="tag-pill tag-good">Would start</span>
                    ) : gain > 0 ? (
                      <span className="tag-pill">Depth</span>
                    ) : (
                      <span className="muted small">–</span>
                    )}
                  </td>
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

export function FrontOffice({
  league,
  tab,
  pos,
  sub,
}: {
  league: League;
  tab?: OfficeTab;
  pos?: Position;
  sub?: TradeTab;
}) {
  const nav = useNav();
  const active = tab ?? defaultOfficeTab(league);
  const [talking, setTalking] = useState<number | null>(null);
  const TABS: [OfficeTab, string][] = [
    ['resign', 'Re-sign'],
    ['fa', 'Free agents'],
    ['draft', 'Draft'],
    ['trades', 'Trades'],
    ['coaches', 'Coaches'],
    ['staff', 'Scouts'],
    ['medical', 'Medical'],
    ['gms', 'GMs'],
  ];
  if (league.personnel?.enabled) TABS.splice(2, 0, ['waivers', 'Waiver wire'], ['squad', 'Practice squad']);
  // Seven tabs scroll on a phone: keep the one you're on (or were sent to) in view.
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bar.current
      ?.querySelector<HTMLElement>('[aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  // What the end of the window will do with the staff deals that are up, as the engine will do it.
  const forecast = league.phase === 'resign' ? [...resignForecast(league, league.userTeamId)] : [];
  const staffDue = forecast.length;
  const leavingStaff = forecast.filter(([, o]) => o !== 'stays').map(([id]) => league.staff[id]);
  const leaving = leavingStaff.map(staffName);
  // With one person up, or one leaving, the notice names the pronoun that person goes by.
  const soleDue = staffDue === 1 ? pron(league.staff[forecast[0][0]]) : null;
  const soleLeaving = leaving.length === 1 ? pron(leavingStaff[0]) : null;
  const showStaffNotice = staffDue > 0 && active !== 'staff';
  // The same for the coaching staff, plus any chair that is empty while moves are still open.
  const coaching = staffWindowOpen(league) ? coachAttention(league, league.userTeamId) : null;
  const showCoachNotice = active !== 'coaches' && !!coaching && (coaching.due.length > 0 || coaching.empty.length > 0);
  return (
    <>
      <div className="row office-bar" style={{ justifyContent: 'space-between' }}>
        <div ref={bar} className="seg office-tabs" role="tablist" aria-label="Front office">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={active === key}
              aria-pressed={active === key}
              onClick={() => nav.go({ view: 'office', tab: key })}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="muted small">
          {league.season} · {PHASE_LABELS[league.phase]}
          {league.phase === 'freeAgency' ? `, day ${league.faDay} of ${FA_DAYS}` : ''}
        </span>
      </div>
      {(showStaffNotice || showCoachNotice) && (
        <div className="notice staff-notices">
          {showStaffNotice && (
            <div className="staff-notice">
              <span>
                {staffDue === 1 ? '1 scouting staff deal is up.' : `${staffDue} scouting staff deals are up.`}{' '}
                {leaving.length === 0 ? (
                  `${soleDue ? `${soleDue.He} re-signs` : 'They re-sign'} automatically unless you let ${soleDue ? soleDue.him : 'them'} go.`
                ) : (
                  <LinkedText
                    league={league}
                    text={`${leaving.join(' and ')} will leave (no chair or budget for ${soleLeaving ? soleLeaving.him : 'them'}); ${staffDue - leaving.length === 0 ? 'nobody else is up' : 'the rest re-sign automatically'}.`}
                    about={leavingStaff.map((s): Who => ({ kind: 'scout', id: s.id }))}
                  />
                )}
              </span>
              <button className="btn btn-sm" onClick={() => nav.go({ view: 'office', tab: 'staff' })}>
                Review scouts
              </button>
            </div>
          )}
          {showCoachNotice && (
            <div className="staff-notice">
              <span>
                <LinkedText
                  league={league}
                  text={attentionText(league, league.userTeamId, coaching!)}
                  about={coaching!.leaving.map((c): Who => ({ kind: 'coach', id: c.id }))}
                />
              </span>
              <button className="btn btn-sm" onClick={() => nav.go({ view: 'office', tab: 'coaches' })}>
                Review coaches
              </button>
            </div>
          )}
        </div>
      )}
      {active === 'resign' && <Resign league={league} negotiate={(p) => setTalking(p.id)} />}
      {active === 'fa' && (
        // Keyed by the position a link asked for, so following another link resets the filter.
        <FreeAgents key={pos ?? 'ALL'} league={league} start={pos} negotiate={(p) => setTalking(p.id)} />
      )}
      {active === 'draft' && <Draft league={league} />}
      {active === 'waivers' && <Waivers league={league} />}
      {active === 'squad' && <PracticeSquad league={league} />}
      {active === 'trades' && <Trades league={league} tab={sub} />}
      {active === 'coaches' && <CoachesScreen league={league} />}
      {active === 'staff' && <StaffScreen league={league} />}
      {active === 'medical' && <MedicalScreen league={league} />}
      {active === 'gms' && <GeneralManagers league={league} />}
      {talking !== null && league.players[talking] && (
        <NegotiationDialog league={league} player={league.players[talking]} onClose={() => setTalking(null)} />
      )}
    </>
  );
}
