import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { playerOvr, POSITION_NAMES, STARTERS } from '../../engine/positions';
import { capSheet } from '../../engine/finance/cap';
import { capHit } from '../../engine/finance/contract';
import { buildAutoDepthChart, teamPlayers, teamRatings } from '../../engine/roster';
import { computeRecords } from '../../engine/season/standings';
import type { League, Player, Position, StatLine } from '../../engine/types';
import { POSITIONS } from '../../engine/types';
import { useNav } from '../App';
import { Panel, PlayerAvatar, Rating, TeamChip } from '../components';
import { thruLabel } from '../contracts';
import { ATTR_LABELS, band, keyAttributes, money, recordText, resultsSeason } from '../format';
import { store } from '../store';

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
      return `${n('gp')} GP`;
    default:
      return `${n('tackles')} tkl, ${n('sacks')} sk, ${n('defInt')} INT`;
  }
}

/** Move a player within his position group; any manual move turns auto-sort off. */
function moveInDepth(teamId: number, pos: Position, from: number, to: number) {
  store.mutate((l) => {
    const team = l.teams[teamId];
    const list = team.depthChart[pos];
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

export function Roster({ league, teamId }: { league: League; teamId: number }) {
  const nav = useNav();
  const team = league.teams[teamId];
  const isUser = teamId === league.userTeamId;
  const ratings = teamRatings(league, team);
  const record = computeRecords(league).get(teamId)!;
  const cap = capSheet(league, teamId);
  const players = teamPlayers(league, teamId);
  const { drag, start } = useDepthDrag(teamId);
  const [announcement, setAnnouncement] = useState('');
  const refocus = useRef<number | null>(null);
  // Keyboard moves re-render the list; keep focus on the grip that was used.
  useEffect(() => {
    if (refocus.current === null) return;
    document.querySelector<HTMLElement>(`[data-grip="${refocus.current}"]`)?.focus();
    refocus.current = null;
  });
  const keyMove = (p: Player, index: number, to: number) => {
    const count = team.depthChart[p.position].length;
    if (to < 0 || to >= count) return;
    moveInDepth(teamId, p.position, index, to);
    refocus.current = p.id;
    setAnnouncement(`${p.firstName} ${p.lastName} moved to ${p.position}${to + 1}${to < STARTERS[p.position] ? ', starter' : ''}.`);
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
          <select aria-label="Choose team" id="roster-team" value={teamId} onChange={(e) => nav.openTeam(Number(e.target.value))}>
            {[...league.teams]
              .sort((a, b) => a.city.localeCompare(b.city))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.city} {t.name}
                  {t.id === league.userTeamId ? ' (you)' : ''}
                </option>
              ))}
          </select>
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
        </div>
      </Panel>

      <Panel
        title="Depth chart"
        action={
          isUser ? (
            <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
              <input type="checkbox" id="auto-depth" checked={team.autoDepth} onChange={(e) => setAuto(teamId, e.target.checked)} />
              Auto-sort by rating
            </label>
          ) : undefined
        }
      >
        {isUser && (
          <p className="muted" style={{ marginTop: 0, fontSize: 'var(--step--1)' }}>
            Starters sit above the yellow line in each group. Drag a player by the <span aria-hidden="true">⠿</span> handle (or focus it and press ↑/↓) to promote or bench him; that turns auto-sort off for your team.
          </p>
        )}
        <span className="visually-hidden" aria-live="polite">
          {announcement}
        </span>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Depth</th>
                <th className="sticky-col">Player</th>
                <th className="num">OVR</th>
                <th className="num">Age</th>
                <th>Key ratings</th>
                <th className="num">Cap hit</th>
                <th className="num">Thru</th>
                <th>{resultsSeason(league)} stats</th>
              </tr>
            </thead>
            <tbody className={drag ? 'drag-active' : undefined}>
              {POSITIONS.map((pos) => {
                // While dragging, show the order the drop would produce.
                const ids = drag?.pos === pos ? reorder(team.depthChart[pos], drag.from, drag.over) : team.depthChart[pos];
                return [
                  <tr className="group-row" key={`g-${pos}`}>
                    <td colSpan={8}>
                      <span className="group-label">
                        {POSITION_NAMES[pos]} · {STARTERS[pos]} starter{STARTERS[pos] > 1 ? 's' : ''}
                      </span>
                    </td>
                  </tr>,
                  ...ids.map((id, i) => {
                    const p = league.players[id] ?? players.find((x) => x.id === id);
                    if (!p) return null;
                    const committed = team.depthChart[pos].indexOf(id);
                    return (
                      <RosterRow
                        key={id}
                        league={league}
                        player={p}
                        index={i}
                        count={ids.length}
                        editable={isUser}
                        dragging={drag?.id === id}
                        onGrip={(e) => start(pos, committed, id, e)}
                        onKeyMove={(to) => keyMove(p, committed, to)}
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
  index,
  count,
  editable,
  dragging,
  onGrip,
  onKeyMove,
}: {
  league: League;
  player: Player;
  index: number;
  count: number;
  editable: boolean;
  dragging: boolean;
  onGrip: (e: ReactPointerEvent) => void;
  onKeyMove: (to: number) => void;
}) {
  const nav = useNav();
  const starter = index < STARTERS[p.position];
  const lastStarter = index === STARTERS[p.position] - 1 && index < count - 1;
  const team = p.teamId !== null ? league.teams[p.teamId] : null;
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
              aria-label={`Reorder ${p.firstName} ${p.lastName}, ${p.position}${index + 1}. Drag, or use the up and down arrow keys.`}
              title="Drag to reorder (or use ↑/↓)"
              onPointerDown={onGrip}
              onKeyDown={onKey}
            >
              <svg width="10" height="16" viewBox="0 0 10 16" aria-hidden="true">
                {[2, 8].map((x) => [2, 8, 14].map((y) => <circle key={`${x}${y}`} cx={x} cy={y} r="1.6" />))}
              </svg>
            </button>
          )}
          <span className="num" style={{ fontWeight: starter ? 700 : 400, minWidth: '2.4em' }}>
            {p.position}
            {index + 1}
          </span>
        </span>
      </td>
      <td className="sticky-col">
        <button className="linklike player-link" style={{ fontWeight: starter ? 700 : 400 }} onClick={() => nav.openPlayer(p.id)}>
          <PlayerAvatar player={p} team={team} size={30} />
          <span>
            {p.firstName} {p.lastName}
          </span>
        </button>
      </td>
      <td className="num">
        <Rating value={playerOvr(p)} decimals={1} />
      </td>
      <td className="num">{p.age}</td>
      <td>
        <span className="row" style={{ gap: 10, flexWrap: 'nowrap' }}>
          {keyAttributes(p.position).map((a) => (
            <span key={a} className="num" style={{ fontSize: '0.75rem' }}>
              <span className="muted">{ATTR_LABELS[a][0]}</span> <span className={band(p.ratings[a])}>{p.ratings[a]}</span>
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
