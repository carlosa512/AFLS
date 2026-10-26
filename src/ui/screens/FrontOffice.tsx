import { PracticeSquad } from './PracticeSquad';
import { useEffect, useRef, useState } from 'react';
import { GeneralManagers } from './GeneralManagers';
import { capSpace } from '../../engine/finance/cap';
import { lastSeason, yearsLeft } from '../../engine/finance/contract';
import { fifthYearOptionValue } from '../../engine/finance/market';
import { draftForUser, draftNextPick, draftToEnd, draftToUserPick, FA_DAYS } from '../../engine/offseason';
import {
  applyFranchiseTag,
  exerciseFifthYearOption,
  expiringPlayers,
  needGain,
  tagBlocker,
  tagValue,
} from '../../engine/offseason/ai';
import {
  availableProspects,
  boardValue,
  draftOrder,
  nextPick,
  POSITION_PREMIUM,
  positionDepth,
  reachOrSteal,
  ROUNDS,
} from '../../engine/offseason/draft';
import { demand, extensionBlocker, freeAgents } from '../../engine/offseason/negotiation';
import { POSITION_NAMES } from '../../engine/positions';
import { teamPlayers } from '../../engine/roster';
import { pron } from '../../engine/pronouns';
import { resignForecast, staffName, staffWindowOpen } from '../../engine/staff';
import type { League, Player, Position } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import {
  Panel,
  PlayerLink,
  Rating,
  Section,
  SortTh,
  sortRows,
  TeamChip,
  TeamPicker,
  useSort,
  type SortState,
} from '../components';
import { attentionText, coachAttention } from '../coaching';
import { money, PHASE_LABELS } from '../format';
import { NegotiationDialog } from '../negotiation';
import {
  combineRows,
  drillVerdict,
  KnowledgeMeter,
  MakeupPills,
  makeupOf,
  Ovr,
  QuirkPills,
  quirksOf,
  potentialText,
  ScoutButton,
  seenOvr,
  Stars,
  starsOf,
  viewOf,
} from '../scouting';
import { CoachesScreen } from './Coaches';
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

function PositionFilter({ value, onChange }: { value: Position | 'ALL'; onChange: (v: Position | 'ALL') => void }) {
  return (
    <select
      aria-label="Filter by position"
      value={value}
      onChange={(e) => onChange(e.target.value as Position | 'ALL')}
    >
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

// ───────── draft ─────────

type BoardSort = 'rank' | 'mine' | 'pos' | 'age' | 'drill' | 'grade' | 'ceiling' | 'stars' | 'consensus' | 'known';

/** The combine drills the board's drill column can show, with their short headers. */
const BOARD_DRILLS = [
  ['forty', '40', '40-yard dash'],
  ['shuttle', 'Shuttle', '20-yard shuttle'],
  ['cone', '3-cone', '3-cone drill'],
  ['vertical', 'Vertical', 'Vertical jump'],
  ['broad', 'Broad', 'Broad jump'],
  ['bench', 'Bench', 'Bench press'],
] as const;
type BoardDrill = (typeof BOARD_DRILLS)[number][0];

/** Board rows shown at a time: a round's worth, so the board stays a screen or two tall. */
const BOARD_PAGE = 32;

/** Your own board value: the AI's formula, fed your scouts' grades instead of the consensus. */
const myBoardValue = (league: League, p: Player) => {
  const v = viewOf(league, p);
  return 0.6 * v.ovr + 0.4 * v.potMid + POSITION_PREMIUM[p.position];
};

function Draft({ league }: { league: League }) {
  const [pos, setPos] = useState<Position | 'ALL'>('ALL');
  const [sort, onSort, setSort] = useSort<BoardSort>({ key: 'rank', desc: false });
  const [drill, setDrill] = useState<BoardDrill>('forty');
  const [shown, setShown] = useState(BOARD_PAGE);
  // A new filter or ranking starts back at the top of the board.
  useEffect(() => setShown(BOARD_PAGE), [pos, sort]);
  const teamId = league.userTeamId;
  const all = availableProspects(league);
  // Consensus rank across the whole class: roughly where the league will take him.
  const rank = new Map([...all].sort((a, b) => boardValue(b) - boardValue(a)).map((p, i) => [p.id, i + 1]));
  // Sort the whole class before paging it, so "fastest" or "best ceiling" reaches past the first page.
  const prospects = sortRows(
    all.filter((p) => pos === 'ALL' || p.position === pos),
    sort,
    (p, key) => {
      const v = viewOf(league, p);
      return key === 'mine'
        ? myBoardValue(league, p)
        : key === 'pos'
          ? POSITIONS.indexOf(p.position)
          : key === 'age'
            ? p.age
            : key === 'drill'
              ? (p.combine?.[drill] ?? (sort.desc ? -Infinity : Infinity))
              : key === 'grade'
                ? v.ovr
                : key === 'ceiling'
                  ? v.potMid
                  : key === 'stars'
                    ? starsOf(league, p, 'league', v).ability
                    : key === 'consensus'
                      ? p.scouting!.grade
                      : key === 'known'
                        ? v.knowledge
                        : rank.get(p.id)!;
    },
  );
  const onClock = league.phase === 'draft' ? nextPick(league) : undefined;
  const userUp = onClock?.ownerId === teamId;
  const order = draftOrder(league);
  const myNext = onClock && order.find((pk) => pk.ownerId === teamId && pk.playerId === undefined);
  const last = order.filter((pk) => pk.playerId !== undefined).at(-1);
  const lastP = last && league.players[last.playerId!];

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
                  <>
                    <button className="btn" onClick={() => store.mutate(draftNextPick)}>
                      Next pick
                    </button>
                    <button className="btn" onClick={() => store.mutate(draftToUserPick)}>
                      Sim to my pick
                    </button>
                  </>
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
          <p className="muted small" style={{ margin: 0 }}>
            {last && lastP && (
              <>
                Last pick: No. {last.overall} {league.teams[last.ownerId].abbrev}, {lastP.position}{' '}
                <PlayerLink league={league} player={lastP} /> (consensus #{last.consRank}).{' '}
              </>
            )}
            {!onClock
              ? 'Every pick is in.'
              : userUp
                ? 'Pick from the board below, or let your staff choose.'
                : myNext
                  ? `Your next pick: round ${myNext.round}, No. ${myNext.overall} (${myNext.overall! - onClock.overall!} picks away).`
                  : 'You have no picks left in this draft.'}
          </p>
        </Panel>
      )}

      {prospects.length > 0 && (
        <Panel
          title={league.phase === 'draft' ? 'Big board' : `${league.season} draft class`}
          action={
            <span className="board-sort">
              <div className="seg seg-sm" role="group" aria-label="Rank prospects by">
                <button aria-pressed={sort.key === 'rank'} onClick={() => setSort({ key: 'rank', desc: false })}>
                  Consensus
                </button>
                <button aria-pressed={sort.key === 'mine'} onClick={() => setSort({ key: 'mine', desc: true })}>
                  Your board
                </button>
              </div>
              <select
                aria-label="Combine drill to show"
                value={drill}
                onChange={(e) => {
                  const next = e.target.value as BoardDrill;
                  setDrill(next);
                  // Sorted by the drill: keep sorting by it, best first (times low, reps and jumps high).
                  if (sort.key === 'drill') setSort({ key: 'drill', desc: !isTimed(next) });
                }}
              >
                {BOARD_DRILLS.map(([k, , label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>
              <PositionFilter value={pos} onChange={setPos} />
            </span>
          }
        >
          <p className="muted small" style={{ marginTop: 0 }}>
            Each scouting visit narrows a range:{' '}
            <b>
              {league.scoutPoints} visit{league.scoutPoints === 1 ? '' : 's'} left
            </b>{' '}
            this year.
          </p>
          <details className="more">
            <summary>How to read the board</summary>
            <p className="muted small">
              <b>Your grade</b> and <b>ceiling</b> are your scouts' estimates (a dashed grade is a guess). <b>Makeup</b>{' '}
              shows once your scouts know a prospect, usually after a visit or two ("?" means not yet; dashed tags are
              early word). <b>Habits</b> are what shows on film: a few in the tape, more with visits. <b>Consensus</b>{' '}
              is how the rest of the league rates him. Rivals blend it with their own scouts' reads, and trust their
              scouts more when those scouts are good, so he can go earlier or later than his rank. When your read beats
              the consensus, you've found a sleeper; when it's worse, let someone else take the bust.
            </p>
          </details>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <SortTh label="Player" k="rank" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
                  <SortTh label="Pos" k="pos" sort={sort} onSort={onSort} desc={false} />
                  <SortTh label="Age" k="age" sort={sort} onSort={onSort} desc={false} className="num" />
                  <SortTh
                    label={BOARD_DRILLS.find(([k]) => k === drill)![1]}
                    k="drill"
                    sort={sort}
                    onSort={onSort}
                    desc={!isTimed(drill)}
                    className="num"
                  />
                  <SortTh label="Your grade" k="grade" sort={sort} onSort={onSort} className="num" />
                  <SortTh label="Ceiling" k="ceiling" sort={sort} onSort={onSort} className="num" />
                  <SortTh label="Stars" k="stars" sort={sort} onSort={onSort} />
                  <SortTh label="Consensus" k="consensus" sort={sort} onSort={onSort} className="num" />
                  <SortTh label="Known" k="known" sort={sort} onSort={onSort} />
                  <th>Makeup</th>
                  <th>Habits</th>
                  <th className="sticky-end" />
                </tr>
              </thead>
              <tbody>
                {prospects.slice(0, shown).map((p) => {
                  const v = viewOf(league, p);
                  return (
                    <tr key={p.id}>
                      <td className="sticky-col">
                        {/* The rank rides in the sticky cell: as a column of its own, the name would slide over it. */}
                        <span className="board-rank muted small">{rank.get(p.id)}</span>
                        <PlayerLink league={league} player={p} avatar={26} />
                      </td>
                      <td>{p.position}</td>
                      <td className="num">{p.age}</td>
                      <BoardDrillCell player={p} drill={drill} />
                      <td className="num">
                        <Ovr league={league} player={p} />
                      </td>
                      <td className="num">{potentialText(v)}</td>
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
                        <BoardMakeup league={league} player={p} />
                      </td>
                      <td>
                        <BoardHabits league={league} player={p} />
                      </td>
                      {/* Pinned right, so Scout and Draft stay in reach on a phone without scrolling the table. */}
                      <td className="sticky-end">
                        <ScoutButton league={league} player={p} />{' '}
                        {userUp && (
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={() => store.mutate((l) => draftForUser(l, p.id))}
                          >
                            Draft
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {prospects.length > shown && (
            <div className="row" style={{ justifyContent: 'center', marginTop: 10 }}>
              <button className="btn btn-sm" onClick={() => setShown((n) => n + BOARD_PAGE)}>
                Show {Math.min(BOARD_PAGE, prospects.length - shown)} more
              </button>
              <span className="muted small">
                {shown} of {prospects.length}
              </span>
            </div>
          )}
        </Panel>
      )}

      <DraftHistory league={league} live={onClock?.round} />

      <YourPicks league={league} />
    </>
  );
}

/**
 * Your picks in the next draft (or the one under way), with the later years folded away. Picks you
 * traded off stay listed, so a missing round reads as "traded to", not as a gap.
 */
function YourPicks({ league }: { league: League }) {
  const teamId = league.userTeamId;
  const next =
    league.phase === 'resign' || league.phase === 'freeAgency' || league.phase === 'draft'
      ? league.season
      : league.season + 1;
  const picks = league.draftPicks
    .filter((pk) => pk.season >= next && (pk.ownerId === teamId || pk.originalTeamId === teamId))
    .sort((a, b) => a.season - b.season || (a.overall ?? a.round * 32) - (b.overall ?? b.round * 32));
  const now = picks.filter((pk) => pk.season === next);
  const later = picks.filter((pk) => pk.season > next);
  const gained = later.filter((pk) => pk.originalTeamId !== teamId).length;
  const lost = later.filter((pk) => pk.ownerId !== teamId).length;
  const table = (rows: typeof picks) => (
    <div className="table-scroll">
      <table>
        <tbody>
          {rows.map((pk) => {
            const used = pk.playerId !== undefined ? league.players[pk.playerId] : null;
            const gone = pk.ownerId !== teamId;
            return (
              <tr key={pk.id} className={gone ? 'muted' : undefined}>
                <td className="num">{pk.season}</td>
                <td>Round {pk.round}</td>
                <td className="num">{pk.overall ? `No. ${pk.overall}` : '–'}</td>
                <td>
                  {gone ? (
                    <span className="tag-pill tag-warn">traded to {league.teams[pk.ownerId].abbrev}</span>
                  ) : pk.originalTeamId !== teamId ? (
                    <span className="tag-pill tag-good">from {league.teams[pk.originalTeamId].abbrev}</span>
                  ) : null}
                </td>
                <td>{used && !gone && <PlayerLink league={league} player={used} pos />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
  return (
    <Panel title="Your picks">
      {now.length ? (
        table(now)
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          No picks in the {next} draft.
        </p>
      )}
      {later.length > 0 && (
        <details className="more">
          <summary>
            Future picks ({later[0].season}–{later.at(-1)!.season}): {later.length - lost} yours
            {gained > 0 && `, ${gained} acquired`}
            {lost > 0 && `, ${lost} traded away`}
          </summary>
          {table(later)}
        </details>
      )}
    </Panel>
  );
}

/**
 * Every draft this league has held, a year and a round at a time: who went where, and where the
 * consensus had him then. Built from the players (their `draft` stays; old picks are pruned).
 * `live` is the round on the clock, which the league-wide table follows (newest pick first) until you choose a
 * round. It opens on your own team: every year and round of your drafting at a glance.
 */
function DraftHistory({ league, live }: { league: League; live?: number }) {
  // Drafts this league held: those players keep the consensus read. A new league's veterans come with made-up draft lines.
  const drafted = Object.values(league.players).filter((p) => p.draft && p.scouting);
  const years = [...new Set(drafted.map((p) => p.draft!.season))].sort((a, b) => b - a);
  const [team, setTeam] = useState<number | 'all'>(league.userTeamId);
  const [pickedYear, setYear] = useState<number | 'all' | null>(null);
  const [pickedRound, setRound] = useState<number | 'all' | null>(null);
  if (!years.length) return null;
  // One team's history is short enough to show whole; the league's goes a year and a round at a time.
  const year = pickedYear ?? (team === 'all' ? years[0] : 'all');
  const following = live !== undefined && year === league.season;
  const round = pickedRound ?? (team !== 'all' ? 'all' : following ? live : 1);
  const rows = drafted
    .filter(
      (p) =>
        (team === 'all' || p.draft!.teamId === team) &&
        (year === 'all' || p.draft!.season === year) &&
        (round === 'all' || p.draft!.round === round),
    )
    .sort(
      (a, b) =>
        b.draft!.season - a.draft!.season ||
        (following ? b.draft!.pick - a.draft!.pick : a.draft!.pick - b.draft!.pick),
    );
  return (
    <Panel className="draft-history">
      <Section id="draft-history" title="Draft history">
        <span className="row" style={{ gap: 8 }}>
          <TeamPicker league={league} value={team} onChange={setTeam} label="Team" allowLeague />
          <select
            aria-label="Draft year"
            value={year}
            onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All years</option>
            {years.map((y) => (
              <option key={y} value={y}>
                {y} draft
              </option>
            ))}
          </select>
          <select
            aria-label="Round"
            value={round}
            onChange={(e) => setRound(e.target.value === 'all' ? 'all' : Number(e.target.value))}
          >
            <option value="all">All rounds</option>
            {Array.from({ length: ROUNDS }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                Round {i + 1}
              </option>
            ))}
          </select>
        </span>
        {rows.length === 0 ? (
          <p className="muted small" style={{ margin: 0 }}>
            {team === league.userTeamId ? 'You have no picks here yet.' : 'No picks here yet.'}
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {year === 'all' && <th className="num">Year</th>}
                  <th className="num">Pick</th>
                  <th className="sticky-col">Player</th>
                  <th>Pos</th>
                  <th>Team</th>
                  <th className="num" title="Where the league consensus ranked him in his class when he was taken">
                    Consensus
                  </th>
                  <th className="num" title="The consensus grade and ceiling when he was taken">
                    Grade
                  </th>
                  <th className="num">Ceiling</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const d = p.draft!;
                  const value = reachOrSteal(d);
                  return (
                    <tr key={p.id} className={d.teamId === league.userTeamId && team === 'all' ? 'is-user' : undefined}>
                      {year === 'all' && <td className="num">{d.season}</td>}
                      <td className="num muted">
                        {d.round}.{d.pick - (d.round - 1) * 32} <span className="small">(No. {d.pick})</span>
                      </td>
                      <td className="sticky-col">
                        <PlayerLink league={league} player={p} />
                        {value === 'reach' && <span className="tag-pill tag-warn">reach</span>}
                        {value === 'steal' && <span className="tag-pill tag-good">steal</span>}
                      </td>
                      <td>{p.position}</td>
                      <td>
                        <TeamChip team={league.teams[d.teamId]} />
                      </td>
                      <td className="num">{d.rank !== undefined ? `#${d.rank}` : '–'}</td>
                      <td className="num">{p.scouting ? <Rating value={p.scouting.grade} decimals={1} /> : '–'}</td>
                      <td className="num muted">{p.scouting?.ceiling.toFixed(1) ?? '–'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </Panel>
  );
}

const isTimed = (d: BoardDrill) => d === 'forty' || d === 'shuttle' || d === 'cone';

/** A drill result on the board, coloured against a typical starter at his position (a 4.6 is slow for a corner, fast for a guard). */
function BoardDrillCell({ player: p, drill }: { player: Player; drill: BoardDrill }) {
  const v = p.combine?.[drill];
  const d = combineRows(p).find((r) => r.key === drill)!;
  if (v === undefined) return <td className="num muted">–</td>;
  const verdict = drillVerdict(d, v);
  return (
    <td
      className={`num ${verdict ? `tone-${verdict}` : 'muted'}`}
      title={d.typical !== undefined ? `Typical ${p.position}: ${d.fmt(d.typical)}` : undefined}
    >
      {d.fmt(v)}
    </td>
  );
}

/** A prospect's makeup in a board cell: "?" until your scouts know him, a dash when nothing stands out. */
function BoardMakeup({ league, player }: { league: League; player: Player }) {
  const m = makeupOf(league, player);
  if (!m.known)
    return (
      <span className="muted" title="Not known yet: a scouting visit or two">
        ?<span className="visually-hidden">Makeup unknown</span>
      </span>
    );
  if (!m.notes.length)
    return (
      <span className="muted" title="Nothing stands out">
        –<span className="visually-hidden">Nothing stands out</span>
      </span>
    );
  return <MakeupPills notes={m.notes} hedged={m.hedged} limit={1} oneLine />;
}

/** A prospect's habits on film in a board cell: "?" until your scouts have seen enough, a dash when none show. */
function BoardHabits({ league, player }: { league: League; player: Player }) {
  const h = quirksOf(league, player);
  if (!h.known)
    return (
      <span className="muted" title="Not seen enough of him yet">
        ?<span className="visually-hidden">Habits unknown</span>
      </span>
    );
  if (!h.notes.length)
    return (
      <span className="muted" title="None on film">
        –<span className="visually-hidden">None on film</span>
      </span>
    );
  return <QuirkPills notes={h.notes} limit={1} oneLine />;
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
