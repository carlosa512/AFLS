import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { chairHolder, coachName, teamCoaches, teamScheme } from '../../engine/coaching';
import { POSITION_NAMES } from '../../engine/positions';
import { PERSONNEL_LABEL, spotsFor, type TeamScheme } from '../../engine/schemes';
import { capSheet, isOffseason } from '../../engine/finance/cap';
import { capHit, lastSeason } from '../../engine/finance/contract';
import { buildAutoDepthChart, isAvailable, slotOf, teamPlayers, teamRatings } from '../../engine/roster';
import { activeLearning, familiarity } from '../../engine/training';
import { computeRecords } from '../../engine/season/standings';
import type { Coach, League, Player, Position, StatLine, Team } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerAvatar, SortTh, sortRows, TeamChip, TeamPicker, useSort } from '../components';
import { thruLabel } from '../contracts';
import { ATTR_LABELS, band, keyAttributes, money, recordText, resultsSeason } from '../format';
import { FitnessCell, fitnessSort, InjuryTag } from '../injuries';
import { Ovr, repsOf, schemeFitOf, seenOvr, Stars, starsOf, viewOf } from '../scouting';
import { store } from '../store';
import { familiarityTone, knockAt, learnLine, lineupText, playAt, positionChoices } from '../training';

export function statSummary(position: Position, s: StatLine | undefined): string {
  if (!s || !s.gp) return '–';
  const n = (k: keyof StatLine) => s[k] ?? 0;
  switch (position) {
    case 'QB':
      return `${n('passCmp')}/${n('passAtt')}, ${n('passYds').toLocaleString()} yds, ${n('passTd')} TD, ${n('passInt')} INT`;
    case 'RB':
      return `${n('rushAtt')} car, ${n('rushYds')} yds, ${n('rushTd')} TD · ${n('rec')} rec`;
    case 'WR':
    case 'TE':
      return `${n('rec')} rec, ${n('recYds')} yds, ${n('recTd')} TD`;
    case 'K':
      return `FG ${n('fgMade')}/${n('fgAtt')} · XP ${n('xpMade')}/${n('xpAtt')}`;
    case 'P':
      return n('punts') ? `${n('punts')} punts, ${(n('puntYds') / n('punts')).toFixed(1)} avg` : '–';
    case 'OL':
      return `${n('gp')} GP · ${n('sacksAllowed')} sacks, ${n('pressuresAllowed')} pressures allowed`;
    case 'DT':
    case 'EDGE':
      return `${n('tackles')} tkl, ${n('sacks')} sk, ${n('pressures')} pressures, ${n('qbHits')} hits`;
    default:
      return `${n('tackles')} tkl, ${n('sacks')} sk, ${n('defInt')} INT`;
  }
}

/** "5 starters: LT LG C RG RT", or why nobody starts there in this personnel. */
function groupNote(scheme: TeamScheme, pos: Position): string {
  const spots = spotsFor(scheme, pos);
  if (!spots.length) return `No starters in ${scheme.offense.personnel} personnel (he rotates in)`;
  return `${spots.length} starter${spots.length > 1 ? 's' : ''}${spots.length > 1 || spots[0] !== pos ? `: ${spots.join(' ')}` : ''}`;
}

function CoordinatorLink({ c }: { c: Coach }) {
  const nav = useNav();
  return (
    <button className="linklike" onClick={() => nav.openStaff('coach', c.id)}>
      {coachName(c)}
    </button>
  );
}

/** What the coordinators run: it decides the spots and how many start at each position. */
function SchemeStrip({ league, teamId, scheme }: { league: League; teamId: number; scheme: TeamScheme }) {
  const staff = teamCoaches(league, teamId);
  const oc = chairHolder(staff, { role: 'offCoord' });
  const dc = chairHolder(staff, { role: 'defCoord' });
  const defense = [scheme.front.label, scheme.coverage?.label].filter(Boolean).join(' · ');
  return (
    <div className="scheme-strip">
      <div>
        <span className="eyebrow">
          Offense · {oc ? <CoordinatorLink c={oc} /> : 'no coordinator'}
        </span>
        <b>{scheme.offense.label}</b>
        <span className="muted small">{PERSONNEL_LABEL[scheme.offense.personnel]}. {scheme.offense.about}</span>
      </div>
      <div>
        <span className="eyebrow">
          Defense · {dc ? <CoordinatorLink c={dc} /> : 'no coordinator'}
        </span>
        <b>{defense}</b>
        <span className="muted small">
          {scheme.front.about}
          {scheme.coverage ? ` ${scheme.coverage.about}` : ''}
        </span>
      </div>
    </div>
  );
}

/**
 * A position's depth as the screen shows it. An auto-sorted chart puts the hurt behind the healthy, keeping
 * their order: that's who the lineup plays, since it skips anyone unavailable. The chart itself is left as it
 * is (the line's spots are given out from it), so the view changes no game.
 */
function shownDepth(league: League, team: Team, pos: Position): number[] {
  const ids = team.depthChart[pos];
  if (!team.autoDepth) return ids;
  const ok = (id: number) => !league.players[id] || isAvailable(league.players[id]);
  return [...ids.filter(ok), ...ids.filter((id) => !ok(id))];
}

/** Move a player within his position group as the screen shows it; any manual move turns auto-sort off. */
function moveInDepth(teamId: number, pos: Position, from: number, to: number) {
  store.mutate((l) => {
    const team = l.teams[teamId];
    const list = shownDepth(l, team, pos);
    if (to < 0 || to >= list.length || to === from) return;
    team.autoDepth = false;
    team.depthChart[pos] = reorder(list, from, to);
  });
}

function reorder<T>(list: T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

function setAutoInjuries(teamId: number, auto: boolean) {
  store.mutate((l) => {
    l.teams[teamId].autoInjuries = auto;
  });
}

const RETURNER_POSITIONS: readonly Position[] = ['RB', 'WR', 'CB', 'S'];

/** Who returns kicks and punts: the user's pick, or Auto (the best backup, as the AI does). A pick who's hurt sits like anyone else. */
function Returners({ league, team }: { league: League; team: Team }) {
  const choices = RETURNER_POSITIONS.flatMap((pos) => team.depthChart[pos].map((id) => league.players[id]).filter((p): p is Player => !!p));
  const pick = (role: 'kr' | 'pr', value: string) =>
    store.mutate((l) => {
      const t = l.teams[team.id];
      const next = { ...t.returners, [role]: value === '' ? undefined : Number(value) };
      if (next.kr === undefined && next.pr === undefined) delete t.returners;
      else t.returners = next;
    });
  return (
    <div className="row" style={{ gap: 14, marginBottom: 10, fontSize: 'var(--step--1)' }}>
      {(
        [
          ['kr', 'Kick returner'],
          ['pr', 'Punt returner'],
        ] as const
      ).map(([role, label]) => (
        <label key={role} className="row" style={{ gap: 6 }}>
          {label}
          <select aria-label={label} value={team.returners?.[role] ?? ''} onChange={(e) => pick(role, e.target.value)}>
            <option value="">Auto</option>
            {choices.map((p) => (
              <option key={p.id} value={p.id}>
                {p.position} {p.firstName[0]}. {p.lastName}
                {isAvailable(p) ? '' : ' (hurt)'}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function setAuto(teamId: number, auto: boolean) {
  store.mutate((l) => {
    const team = l.teams[teamId];
    team.autoDepth = auto;
    if (auto) team.depthChart = buildAutoDepthChart(teamPlayers(l, teamId));
  });
}

interface DragState {
  pos: Position;
  id: number;
  from: number;
  over: number;
}

/**
 * Drag-to-reorder for depth chart rows. Listeners sit on window rather than the grip: React may
 * move the dragged row in the DOM while previewing the new order, which would drop pointer capture.
 */
function useDepthDrag(teamId: number) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const geo = useRef<{ startY: number; dy: number; centers: number[]; height: number; state: DragState } | null>(null);

  const rowOf = (id: number) => document.querySelector<HTMLTableRowElement>(`tr[data-id="${id}"]`);
  const applyOffset = () => {
    const g = geo.current;
    const row = g && rowOf(g.state.id);
    if (g && row) row.style.transform = `translateY(${g.dy - (g.state.over - g.state.from) * g.height}px)`;
  };
  // Once React has rendered the preview order, re-anchor the dragged row under the pointer.
  useLayoutEffect(applyOffset, [drag]);

  const start = (pos: Position, index: number, id: number, e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const rows = [...document.querySelectorAll<HTMLTableRowElement>(`tr[data-pos="${pos}"]`)];
    const rects = rows.map((r) => r.getBoundingClientRect());
    const state = { pos, id, from: index, over: index };
    geo.current = {
      startY: e.clientY + window.scrollY,
      dy: 0,
      centers: rects.map((r) => r.top + window.scrollY + r.height / 2),
      height: rects[index].height,
      state,
    };
    setDrag(state);
    document.body.classList.add('is-dragging');

    const move = (ev: PointerEvent) => {
      const g = geo.current;
      if (!g) return;
      const y = ev.clientY + window.scrollY;
      g.dy = y - g.startY;
      const center = g.centers[g.state.from] + g.dy;
      const over = g.centers.filter((c, i) => i !== g.state.from && c < center).length;
      if (over !== g.state.over) {
        g.state = { ...g.state, over };
        setDrag(g.state);
      } else applyOffset();
      // Nudge the page when dragging near the window edge.
      if (ev.clientY < 48) window.scrollBy(0, -12);
      else if (ev.clientY > window.innerHeight - 48) window.scrollBy(0, 12);
    };
    const end = (commit: boolean) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      document.body.classList.remove('is-dragging');
      const g = geo.current;
      geo.current = null;
      if (!g) return;
      const row = rowOf(g.state.id);
      if (row) row.style.transform = '';
      if (commit && g.state.over !== g.state.from) moveInDepth(teamId, g.state.pos, g.state.from, g.state.over);
      setDrag(null);
    };
    const up = () => end(true);
    const cancel = () => end(false);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };

  return { drag, start };
}

type RosterSort = 'depth' | 'name' | 'ovr' | 'stars' | 'age' | 'fitness' | 'cap' | 'thru';

/** What each column sorts by: your scouts' view, never the true ratings. */
function rosterSortValue(league: League, p: Player, key: RosterSort): number | string {
  switch (key) {
    case 'name':
      return `${p.lastName} ${p.firstName}`.toLowerCase();
    case 'ovr':
      return seenOvr(league, p);
    case 'stars':
      return starsOf(league, p).ability;
    case 'age':
      return p.age;
    case 'fitness':
      return fitnessSort(league, p);
    case 'cap':
      return p.contract ? capHit(p.contract, league.season) : -1;
    case 'thru':
      return p.contract ? lastSeason(p.contract) : 0;
    default:
      return 0;
  }
}

export function Roster({ league, teamId }: { league: League; teamId: number }) {
  const nav = useNav();
  const team = league.teams[teamId];
  const isUser = teamId === league.userTeamId;
  const ratings = teamRatings(league, team);
  const record = computeRecords(league).get(teamId)!;
  const cap = capSheet(league, teamId);
  const players = teamPlayers(league, teamId);
  const { drag, start } = useDepthDrag(teamId);
  const scheme = teamScheme(league, teamId);
  const [announcement, setAnnouncement] = useState('');
  // The depth chart is the default; any other column shows the whole roster as one sorted list.
  const [sort, toggleSort, setSort] = useSort<RosterSort>({ key: 'depth', desc: false });
  const onSort = (key: RosterSort, desc: boolean) => (key === 'depth' ? setSort({ key, desc: false }) : toggleSort(key, desc));
  const grouped = sort.key === 'depth';
  const refocus = useRef<number | null>(null);
  // Keyboard moves re-render the list; keep focus on the grip that was used.
  useEffect(() => {
    if (refocus.current === null) return;
    document.querySelector<HTMLElement>(`[data-grip="${refocus.current}"]`)?.focus();
    refocus.current = null;
  });
  const keyMove = (p: Player, pos: Position, index: number, to: number) => {
    const count = shownDepth(league, team, pos).length;
    if (to < 0 || to >= count) return;
    moveInDepth(teamId, pos, index, to);
    refocus.current = p.id;
    const spots = spotsFor(scheme, pos);
    setAnnouncement(`${p.firstName} ${p.lastName} moved to ${spots[to] ?? `${pos}${to + 1}`}${to < spots.length ? ', starter' : ''}.`);
  };

  return (
    <>
      <Panel
        title={
          <div className="row">
            <TeamChip team={team} large />
            <div>
              <h2>
                {team.city} {team.name}
              </h2>
              <span className="muted">
                {league.divisions[team.division].name} · {recordText(record)}
              </span>
            </div>
          </div>
        }
        action={
          <TeamPicker league={league} value={teamId} onChange={nav.openTeam} id="roster-team" />
        }
      >
        <div className="facts">
          <span className="fact">
            <span className="eyebrow">Overall</span>
            <b className="num">{ratings.overall.toFixed(1)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">QB</span>
            <b className="num">{ratings.qb.toFixed(1)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Offense</span>
            <b className="num">{ratings.offense.toFixed(1)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Defense</span>
            <b className="num">{ratings.defense.toFixed(1)}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Cap used</span>
            <b className="num">{money(Math.round(cap.used))}</b>
          </span>
          <span className="fact">
            <span className="eyebrow">Cap space</span>
            <button className="linklike num fact-link" onClick={() => nav.go({ view: 'cap', teamId })}>
              {money(Math.round(cap.space))}
            </button>
          </span>
          <span className="fact">
            <span className="eyebrow">Roster</span>
            {/* As the Cap screen counts it: injured reserve is off the 53 (90 in the offseason). */}
            <span className="staff-age">
              <b className="num">
                {cap.rosterSize}/{isOffseason(league.phase) ? 90 : 53}
              </b>
              {players.some((p) => p.ir) && <span className="muted small">+{players.filter((p) => p.ir).length} on IR</span>}
            </span>
          </span>
        </div>
      </Panel>

      <Panel
        title={grouped ? 'Depth chart' : 'Roster'}
        action={
          isUser ? (
            <span className="row" style={{ gap: 14 }}>
              <label className="row" style={{ gap: 6, cursor: 'pointer' }} title="Your medical staff moves long injuries to injured reserve, brings players back, and signs a minimum-deal replacement when a position runs short.">
                <input type="checkbox" id="auto-injuries" checked={team.autoInjuries !== false} onChange={(e) => setAutoInjuries(teamId, e.target.checked)} />
                Staff handles injuries
              </label>
              <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
                <input type="checkbox" id="auto-depth" checked={team.autoDepth} onChange={(e) => setAuto(teamId, e.target.checked)} />
                Auto-sort by rating
              </label>
            </span>
          ) : undefined
        }
      >
        {grouped && <SchemeStrip league={league} teamId={teamId} scheme={scheme} />}
        {grouped && isUser && <Returners league={league} team={team} />}
        {!grouped && (
          <p className="muted" style={{ marginTop: 0, fontSize: 'var(--step--1)' }}>
            Showing the whole roster sorted by a column.{' '}
            <button className="linklike" onClick={() => onSort('depth', false)}>
              Back to the depth chart
            </button>
          </p>
        )}
        {isUser && grouped && (
          <p className="muted" style={{ marginTop: 0, fontSize: 'var(--step--1)' }}>
            Starters sit above the yellow line, in the spots your coordinators' schemes use. Drag a player by the <span aria-hidden="true">⠿</span> handle (or focus it and press ↑/↓) to promote or bench him; that turns auto-sort off for your team. In a pinch, "Play at…" lines a player up at another position: out of position he takes a knock, smaller in his own room or at a spot he has played.
          </p>
        )}
        <span className="visually-hidden" aria-live="polite">
          {announcement}
        </span>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <SortTh label="Depth" k="depth" sort={sort} onSort={onSort} desc={false} />
                <SortTh label="Player" k="name" sort={sort} onSort={onSort} desc={false} className="sticky-col" />
                <SortTh label="OVR" k="ovr" sort={sort} onSort={onSort} className="num" />
                <SortTh label="Stars" k="stars" sort={sort} onSort={onSort} />
                <SortTh label="Age" k="age" sort={sort} onSort={onSort} desc={false} className="num" />
                <SortTh label="Fitness" k="fitness" sort={sort} onSort={onSort} />
                <th>Key ratings</th>
                <SortTh label="Cap hit" k="cap" sort={sort} onSort={onSort} className="num" />
                <SortTh label="Thru" k="thru" sort={sort} onSort={onSort} className="num" />
                <th>{resultsSeason(league)} stats</th>
              </tr>
            </thead>
            <tbody className={drag ? 'drag-active' : undefined}>
              {!grouped &&
                sortRows(
                  POSITIONS.flatMap((pos) => team.depthChart[pos].map((id) => league.players[id]).filter((p): p is Player => !!p)),
                  sort,
                  (p, key) => rosterSortValue(league, p, key),
                ).map((p) => {
                  const slot = slotOf(league, p);
                  const ids = shownDepth(league, team, slot);
                  return (
                    <RosterRow
                      key={p.id}
                      league={league}
                      player={p}
                      slot={slot}
                      index={ids.indexOf(p.id)}
                      count={ids.length}
                      editable={false}
                      grouped={false}
                      scheme={scheme}
                      dragging={false}
                      onGrip={() => {}}
                      onKeyMove={() => {}}
                    />
                  );
                })}
              {grouped && POSITIONS.map((pos) => {
                // While dragging, show the order the drop would produce.
                const ids = drag?.pos === pos ? reorder(shownDepth(league, team, pos), drag.from, drag.over) : shownDepth(league, team, pos);
                return [
                  <tr className="group-row" key={`g-${pos}`}>
                    <td colSpan={10}>
                      <span className="group-label">
                        {POSITION_NAMES[pos]} · {groupNote(scheme, pos)}
                      </span>
                    </td>
                  </tr>,
                  ...ids.map((id, i) => {
                    const p = league.players[id] ?? players.find((x) => x.id === id);
                    if (!p) return null;
                    const committed = shownDepth(league, team, pos).indexOf(id);
                    return (
                      <RosterRow
                        key={id}
                        league={league}
                        player={p}
                        slot={pos}
                        index={i}
                        count={ids.length}
                        editable={isUser}
                        grouped
                        scheme={scheme}
                        dragging={drag?.id === id}
                        onGrip={(e) => start(pos, committed, id, e)}
                        onKeyMove={(to) => keyMove(p, pos, committed, to)}
                      />
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}

function RosterRow({
  league,
  player: p,
  slot,
  index,
  count,
  editable,
  grouped,
  scheme,
  dragging,
  onGrip,
  onKeyMove,
}: {
  league: League;
  player: Player;
  /** The position group he's lined up in: his own, or another one in a pinch. */
  slot: Position;
  index: number;
  count: number;
  editable: boolean;
  /** Shown inside its position group, where the starter line means something. */
  grouped: boolean;
  /** The team's schemes: they name the starting spots. */
  scheme: TeamScheme;
  dragging: boolean;
  onGrip: (e: ReactPointerEvent) => void;
  onKeyMove: (to: number) => void;
}) {
  const nav = useNav();
  const view = viewOf(league, p);
  const spots = spotsFor(scheme, slot);
  const starter = index < spots.length;
  const lastStarter = grouped && index === spots.length - 1 && index < count - 1;
  const spot = spots[index] ?? `${slot}${index + 1}`;
  const mine = p.teamId === league.userTeamId;
  const away = slot !== p.position;
  // Your own players only: how a rival's roster suits its scheme is its business.
  const fit = mine && starter && !away ? schemeFitOf(league, p, scheme) : null;
  const learning = mine ? activeLearning(p) : undefined;
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
  // Only your own young players: a rival's backups are none of your business.
  const needsReps = p.teamId === league.userTeamId && repsOf(league, p)?.needs;
  const onKey = (e: ReactKeyboardEvent) => {
    const to = { ArrowUp: index - 1, ArrowDown: index + 1, Home: 0, End: count - 1 }[e.key];
    if (to === undefined) return;
    e.preventDefault();
    onKeyMove(to);
  };
  return (
    <tr data-pos={p.position} data-id={p.id} className={`depth-row${lastStarter ? ' last-starter' : ''}${dragging ? ' dragging' : ''}`}>
      <td>
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {editable && (
            <button
              className="grip"
              data-grip={p.id}
              aria-label={`Reorder ${p.firstName} ${p.lastName}, ${spot}. Drag, or use the up and down arrow keys.`}
              title="Drag to reorder (or use ↑/↓)"
              onPointerDown={onGrip}
              onKeyDown={onKey}
            >
              <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                {[2, 8].map((x) => [2, 8, 14].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" />))}
              </svg>
            </button>
          )}
          <span className={`num spot${starter ? ' spot-starter' : ''}`} title={starter ? `Starting ${spot}` : 'Depth'}>
            {spot}
          </span>
          {editable && grouped && <PlayAt p={p} slot={slot} />}
        </span>
      </td>
      <td className="sticky-col">
        <button className="linklike player-link" style={{ fontWeight: starter ? 700 : 400 }} onClick={() => nav.openPlayer(p.id)}>
          <PlayerAvatar player={p} team={team} size={32} />
          <span>
            {p.firstName} {p.lastName}
          </span>
        </button>
        {fit && (fit.grade === 'Ideal' || fit.grade === 'Poor') && (
          <span className={`tag-pill name-sub ${fit.grade === 'Poor' ? 'tag-warn' : 'tag-good'}`} title={`The scheme leans on ${fit.skills.join(', ')}.`}>
            {fit.grade === 'Ideal' ? 'Scheme fit' : 'Poor fit'}
          </span>
        )}
        {away && (
          <span className={`tag-pill name-sub ${knockAt(p, slot) === 'big' ? 'tag-warn' : ''}`} title={lineupText(p, slot)}>
            Out of position ({p.position})
          </span>
        )}
        {learning && (
          <span className={`tag-pill name-sub ${familiarityTone(familiarity(p))}`} title={learnLine(p.position, learning.to, familiarity(p))}>
            Learning {learning.to}
          </span>
        )}
        {needsReps && (
          <span className="tag-pill tag-warn name-sub" title="Young and still growing, but he rarely plays: snaps speed up his development.">
            Needs reps
          </span>
        )}
        <InjuryTag league={league} p={p} sub />
      </td>
      <td className="num">
        <Ovr league={league} player={p} />
      </td>
      <td>
        <Stars s={starsOf(league, p, 'league', view)} size={13} />
      </td>
      <td className="num">{p.age}</td>
      <td>
        <FitnessCell league={league} p={p} />
      </td>
      <td>
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          {keyAttributes(p.position).map((a) => (
            <span key={a} className="num" style={{ fontSize: '0.75rem' }}>
              <span className="muted">{ATTR_LABELS[a][0]}</span> <span className={band(view.ratings[a].value)}>{view.ratings[a].value}</span>
            </span>
          ))}
        </span>
      </td>
      <td className="num">{p.contract ? money(Math.round(capHit(p.contract, league.season))) : '–'}</td>
      <td className="num">{p.contract ? thruLabel(league, p.contract) : '–'}</td>
      <td className="muted">{statSummary(p.position, p.stats[resultsSeason(league)])}</td>
    </tr>
  );
}

/** "Play at…": line him up at another position in a pinch, or back at his own. Each choice says the knock he'd take there. */
function PlayAt({ p, slot }: { p: Player; slot: Position }) {
  const choices = positionChoices(slot);
  const label = (pos: Position) => (pos === p.position ? `Back to ${pos}` : `${pos} · ${knockAt(p, pos)} knock`);
  return (
    <select
      className="play-at"
      aria-label={`Play ${p.firstName} ${p.lastName} at another position`}
      title="Line him up at another position"
      value=""
      onChange={(e) => {
        const pos = e.target.value as Position;
        if (pos) store.mutate((l) => playAt(l, p.id, pos));
      }}
    >
      <option value="">Play at…</option>
      {slot !== p.position && <option value={p.position}>{label(p.position)}</option>}
      {choices
        .filter((pos) => pos !== p.position)
        .map((pos) => (
          <option key={pos} value={pos}>
            {label(pos)}
          </option>
        ))}
    </select>
  );
}
