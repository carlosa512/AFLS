import { useEffect, useMemo, useRef, useState } from 'react';
import type { Game, League, Player, PlayLogEntry, Team } from '../../engine/types';
import { teamPlayers } from '../../engine/roster';
import { useNav } from '../App';
import { ROUND_NAMES } from '../../engine/season/playoffs';
import { TeamChip } from '../components';
import { gameClock, weekLabel } from '../format';
import { buildPath, FIELD_W, HASH_HI, HASH_LO, MID, pointAt, snapYFor } from '../stage/ballPath';
import { HIGHLIGHT_LEVELS, nextShown, type HighlightLevel } from '../highlights';
import { HIGHLIGHTS_KEY, usePref } from '../viewerPrefs';

// ───────── 2.5D field projection ─────────
// Field coordinates: x from -10 (home end zone) to 110 (away end zone), y from 0 (near
// sideline) to 53.3 (far sideline), h = height above the turf in yards. Drawn mirrored so the
// away team's end zone sits on the left, matching the away-then-home scorebug.
const VIEW_W = 360;
const VIEW_H = 176;
const NEAR = { y: 166, w: 346 };
const FAR = { y: 66, w: 226 };

function project(x: number, y: number, h = 0) {
  const t = y / FIELD_W;
  const rowW = NEAR.w + (FAR.w - NEAR.w) * t;
  const scale = rowW / NEAR.w;
  return { x: VIEW_W / 2 + ((50 - x) / 120) * rowW, y: NEAR.y + (FAR.y - NEAR.y) * t - h * 2.2 * scale, scale };
}
const pt = (x: number, y: number) => {
  const p = project(x, y);
  return `${p.x.toFixed(1)},${p.y.toFixed(1)}`;
};
const quad = (x0: number, x1: number) => `${pt(x0, 0)} ${pt(x1, 0)} ${pt(x1, FIELD_W)} ${pt(x0, FIELD_W)}`;

/** Where the ball sits once a play is over (or before it, for plays without a path). */
export function restingSpot(plays: PlayLogEntry[], index: number, homeId: number): number {
  for (let i = index; i >= 0; i--) {
    const e = plays[i];
    if (e.to !== undefined) return e.kind === 'incomplete' ? e.from! : e.to;
    if (e.down) return e.offense === homeId ? e.yardLine : 100 - e.yardLine;
  }
  return 50;
}

/** Line of scrimmage and line to gain in field coordinates, or null when no snap is set. */
export function downLines(
  e: PlayLogEntry | undefined,
  homeId: number,
): { los: number | null; gain: number | null } | undefined {
  if (!e) return undefined;
  if (e.down) {
    const home = e.offense === homeId;
    const los = home ? e.yardLine : 100 - e.yardLine;
    const goalToGo = e.yardLine + e.distance >= 100;
    return { los, gain: goalToGo ? null : home ? e.yardLine + e.distance : 100 - e.yardLine - e.distance };
  }
  // Kicks clear the lines; timeouts and other announcements leave them where they were.
  if (e.kind === 'kickoff' || e.kind === 'xp' || e.kind === 'two') return { los: null, gain: null };
  return undefined;
}

const ease = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2);

/** What the field showed when the last animation finished, so the next one can pick up from there. */
interface FieldMemory {
  x: number;
  y: number;
  los: number | null;
  gain: number | null;
}

// ───────── field ─────────
export function Field({
  home,
  away,
  entry,
  restX,
  animKey,
  speed,
  still = false,
  onDone,
}: {
  home: Team;
  away: Team;
  entry: PlayLogEntry | undefined;
  restX: number;
  animKey: string;
  speed: number;
  /** A play the highlight level skipped: show where it ended without animating it. */
  still?: boolean;
  onDone: () => void;
}) {
  const ballRef = useRef<SVGEllipseElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const losRef = useRef<SVGLineElement>(null);
  const gainRef = useRef<SVGLineElement>(null);
  /** Live record of what is on screen, so an interrupted play hands off from where the ball really is. */
  const memory = useRef<FieldMemory | null>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;

  useEffect(() => {
    const place = (x: number, y: number, h: number, opacity = 1) => {
      const b = project(x, y, h);
      const g = project(x, y, 0);
      ballRef.current?.setAttribute('cx', String(b.x));
      ballRef.current?.setAttribute('cy', String(b.y));
      ballRef.current?.setAttribute('rx', String(4.4 * b.scale * (1 + h / 60)));
      ballRef.current?.setAttribute('ry', String(2.7 * b.scale * (1 + h / 60)));
      ballRef.current?.setAttribute('opacity', String(opacity));
      shadowRef.current?.setAttribute('cx', String(g.x));
      shadowRef.current?.setAttribute('cy', String(g.y + 1));
      shadowRef.current?.setAttribute('rx', String(4.6 * g.scale));
      shadowRef.current?.setAttribute('opacity', String(opacity));
      if (memory.current) Object.assign(memory.current, { x, y });
    };
    const drawLine = (el: SVGLineElement | null, x: number | null, opacity: number) => {
      if (!el) return;
      if (x === null || opacity <= 0) return el.setAttribute('opacity', '0');
      const a = project(x, 0);
      const b = project(x, FIELD_W);
      el.setAttribute('x1', String(a.x));
      el.setAttribute('y1', String(a.y));
      el.setAttribute('x2', String(b.x));
      el.setAttribute('y2', String(b.y));
      el.setAttribute('opacity', String(opacity));
    };
    /** Slide a line from `a` to `b`, fading it in or out when one end is missing. */
    const lineAt = (el: SVGLineElement | null, a: number | null, b: number | null, t: number) => {
      if (a === null && b === null) return drawLine(el, null, 0);
      if (a === null) return drawLine(el, b, t);
      if (b === null) return drawLine(el, a, 1 - t);
      // A new series far away (turnover, kick): fade across rather than sweep the field.
      if (Math.abs(b - a) > 25) return t < 0.5 ? drawLine(el, a, 1 - 2 * t) : drawLine(el, b, 2 * t - 1);
      drawLine(el, a + (b - a) * ease(t), 1);
    };

    const prev = memory.current;
    const lines = downLines(entry, home.id) ?? (prev ? { los: prev.los, gain: prev.gain } : { los: null, gain: null });
    const from = prev ? { ...prev } : { x: restX, y: MID, ...lines };
    memory.current = { ...from };
    const settleLines = () => Object.assign(memory.current!, lines);
    const snapY = snapYFor(entry, from.y);
    const segs = entry ? buildPath(entry, home.id, snapY) : [];
    // Plays without a path (timeouts, announcements) leave the ball where it lies.
    const start = segs.length
      ? { x: segs[0].x0, y: segs[0].y0 }
      : Math.abs(from.x - restX) < 0.5
        ? { x: from.x, y: from.y }
        : { x: restX, y: snapY };
    const last = segs[segs.length - 1];
    const end = last ? { x: last.x1, y: last.y1 } : start;
    const endOpacity = entry?.kind === 'incomplete' ? 0.35 : 1;

    // Trail for this play only (not the re-spot).
    const pts: string[] = [];
    for (const seg of segs) {
      for (let i = 0; i <= 12; i++) {
        const p = pointAt(seg, i / 12);
        const q = project(p.x, p.y, p.h);
        pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`);
      }
    }
    trailRef.current?.setAttribute('d', pts.length ? `M${pts.join('L')}` : '');
    trailRef.current?.setAttribute('stroke', (entry?.offense === home.id ? home : away).colors[1]);

    // Re-spot: carry the ball from where it lay to the new spot, and slide the chains.
    const gap = Math.hypot(start.x - from.x, start.y - from.y);
    const linesMove = from.los !== lines.los || from.gain !== lines.gain;
    const teleport = gap > 40;
    const respot = teleport
      ? linesMove
        ? 0.25
        : 0
      : gap > 0.3
        ? 0.3 + Math.min(0.35, gap * 0.012)
        : linesMove
          ? 0.3
          : 0;
    const playTime = segs.reduce((sum, x) => sum + x.dur, 0);

    const finish = () => {
      place(end.x, end.y, 0, endOpacity);
      lineAt(losRef.current, from.los, lines.los, 1);
      lineAt(gainRef.current, from.gain, lines.gain, 1);
      trailRef.current?.setAttribute('stroke-dashoffset', '0');
      settleLines();
    };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (reduced || still || (!segs.length && !respot)) {
      finish();
      const t = setTimeout(() => doneRef.current(), 450 / speed);
      return () => clearTimeout(t);
    }

    const startPos = teleport ? start : from;
    place(startPos.x, startPos.y, 0);
    trailRef.current?.setAttribute('stroke-dashoffset', '1');
    lineAt(losRef.current, from.los, lines.los, 0);
    lineAt(gainRef.current, from.gain, lines.gain, 0);

    let raf = 0;
    let startAt = 0;
    const tick = (now: number) => {
      if (!startAt) startAt = now;
      let t = ((now - startAt) / 1000) * speed;
      if (t >= respot + playTime) {
        finish();
        doneRef.current();
        return;
      }
      if (t < respot) {
        const k = t / respot;
        lineAt(losRef.current, from.los, lines.los, k);
        lineAt(gainRef.current, from.gain, lines.gain, k);
        if (!teleport) {
          const e = ease(k);
          place(from.x + (start.x - from.x) * e, from.y + (start.y - from.y) * e, 0);
        }
      } else {
        lineAt(losRef.current, from.los, lines.los, 1);
        lineAt(gainRef.current, from.gain, lines.gain, 1);
        settleLines();
        t -= respot;
        trailRef.current?.setAttribute('stroke-dashoffset', String(1 - t / playTime));
        for (const seg of segs) {
          if (t <= seg.dur) {
            const p = pointAt(seg, t / seg.dur);
            place(p.x, p.y, p.h);
            break;
          }
          t -= seg.dur;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // animKey identifies the play being shown; restarting on it replays the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey]);

  const endzoneLabel = (x: number, team: Team) => {
    const p = project(x, MID);
    return (
      <text
        x={p.x}
        y={p.y + 4}
        textAnchor="middle"
        className="ez-text"
        fontSize={11 * p.scale}
        transform={`rotate(${x < 50 ? 90 : -90} ${p.x} ${p.y})`}
      >
        {team.abbrev}
      </text>
    );
  };
  const line = (x: number, color: string, width: number) => {
    const a = project(x, 0);
    const b = project(x, FIELD_W);
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeLinecap="round" />;
  };
  // One-yard ticks along each sideline and on both hashes.
  const ticks = useMemo(() => {
    const segs: string[] = [];
    for (let x = 1; x < 100; x++) {
      if (x % 5 === 0) continue;
      for (const [y0, y1] of [
        [0, 0.9],
        [FIELD_W - 0.9, FIELD_W],
        [HASH_LO - 0.45, HASH_LO + 0.45],
        [HASH_HI - 0.45, HASH_HI + 0.45],
      ]) {
        const a = project(x, y0);
        const b = project(x, y1);
        segs.push(`M${a.x.toFixed(1)},${a.y.toFixed(1)}L${b.x.toFixed(1)},${b.y.toFixed(1)}`);
      }
    }
    return segs.join('');
  }, []);

  return (
    <svg
      className="field-scene"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Field view of the current play"
    >
      <defs>
        <pattern id="crowd" width="9" height="7" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.5" fill="rgba(255,255,255,0.16)" />
          <circle cx="6.5" cy="5" r="1.5" fill="rgba(255,255,255,0.09)" />
        </pattern>
      </defs>
      <rect width={VIEW_W} height={VIEW_H} className="scene-bg" />
      <rect y="6" width={VIEW_W} height={FAR.y - 16} fill="url(#crowd)" />
      <polygon points={quad(-12, 112)} className="turf-edge" />
      <polygon points={quad(-10, 110)} fill="#2f7a46" />
      {Array.from({ length: 10 }, (_, i) => i * 10)
        .filter((x) => (x / 10) % 2 === 0)
        .map((x) => (
          <polygon key={x} points={quad(x, x + 10)} fill="#2b7141" />
        ))}
      <polygon points={quad(-10, 0)} fill={home.colors[0]} />
      <polygon points={quad(100, 110)} fill={away.colors[0]} />
      {endzoneLabel(-5, home)}
      {endzoneLabel(105, away)}
      {Array.from({ length: 21 }, (_, i) => i * 5).map((x) => (
        <g key={x}>{line(x, 'rgba(255,255,255,0.75)', x % 10 === 0 ? 1.1 : 0.6)}</g>
      ))}
      <path d={ticks} stroke="rgba(255,255,255,0.55)" strokeWidth="0.5" />
      {Array.from({ length: 9 }, (_, i) => (i + 1) * 10).map((x) =>
        [6, FIELD_W - 7].map((y) => {
          const p = project(x, y);
          return (
            <text key={`${x}-${y}`} x={p.x} y={p.y + 3} textAnchor="middle" className="yard-num" fontSize={8 * p.scale}>
              {x <= 50 ? x : 100 - x}
            </text>
          );
        }),
      )}
      <polygon points={quad(-10, 110)} fill="none" stroke="#fff" strokeWidth="1.2" />
      <line ref={losRef} stroke="#5aa9ff" strokeWidth="2" strokeLinecap="round" opacity="0" />
      <line ref={gainRef} stroke="#ffd43b" strokeWidth="2.2" strokeLinecap="round" opacity="0" />
      <path
        ref={trailRef}
        fill="none"
        strokeWidth="1.6"
        strokeLinecap="round"
        pathLength={1}
        strokeDasharray="1"
        strokeDashoffset="0"
        opacity="0.9"
      />
      <ellipse ref={shadowRef} rx="4" ry="1.6" fill="rgba(0,0,0,0.35)" />
      <ellipse ref={ballRef} rx="4.4" ry="2.7" fill="#7a3f1d" stroke="#fff" strokeWidth="0.7" />
    </svg>
  );
}

// ───────── viewer screen ─────────
export function playLabel(e: PlayLogEntry, homeId: number): string {
  if (/TOUCHDOWN/.test(e.text)) return 'Touchdown';
  const dir = e.offense === homeId ? 1 : -1;
  const gain = e.from !== undefined && e.to !== undefined ? Math.round((e.to - e.from) * dir) : 0;
  const yds = `${gain > 0 ? '+' : ''}${gain} yds`;
  switch (e.kind) {
    case 'pass':
      return `Pass · ${yds}`;
    case 'run':
      return `Run · ${yds}`;
    case 'scramble':
      return `Scramble · ${yds}`;
    case 'sack':
      return /FUMBLE/.test(e.text) ? 'Strip sack' : `Sack · ${yds}`;
    case 'incomplete':
      return 'Incomplete';
    case 'int':
      return 'Interception';
    case 'kickoff':
      return 'Kickoff';
    case 'punt':
      return 'Punt';
    case 'fg':
      return /NO GOOD/.test(e.text) ? 'FG missed' : 'Field goal';
    case 'xp':
      return /NO GOOD/.test(e.text) ? 'PAT missed' : 'Extra point';
    case 'two':
      return 'Two-point try';
    case 'penalty':
      return 'Penalty';
    case 'kneel':
      return /runs out the clock/.test(e.text) ? 'Clock killed' : 'Kneel';
    case 'spike':
      return 'Spike';
    default:
      return /Timeout/.test(e.text) ? 'Timeout' : '';
  }
}

export function situation(e: PlayLogEntry, home: Team, away: Team): string {
  if (!e.down) return '';
  const ord = ['', '1st', '2nd', '3rd', '4th'][e.down];
  const goal = e.yardLine + e.distance >= 100;
  const off = e.offense === home.id ? home : away;
  const def = off === home ? away : home;
  const spot =
    e.yardLine === 50
      ? 'midfield'
      : e.yardLine < 50
        ? `${off.abbrev} ${e.yardLine}`
        : `${def.abbrev} ${100 - e.yardLine}`;
  return `${ord} & ${goal ? 'Goal' : e.distance} · Ball on ${spot}`;
}

const SPEEDS = [1, 2, 4];

const LEVEL_LABELS: Record<HighlightLevel, string> = { key: 'Key', extended: 'Ext', full: 'Full' };
const LEVEL_NAMES: Record<HighlightLevel, string> = {
  key: 'Key plays only',
  extended: 'Extended highlights',
  full: 'Full game',
};

/** How much of the game to animate: Key · Ext · Full. Skipped plays still land in the log and on the scoreboard. */
export function HighlightSwitch({ value, onChange }: { value: HighlightLevel; onChange: (v: HighlightLevel) => void }) {
  return (
    <span className="vc-levels" role="group" aria-label="Highlights">
      {HIGHLIGHT_LEVELS.map((l) => (
        <button
          key={l}
          className={`vc-level${l === value ? ' on' : ''}`}
          aria-pressed={l === value}
          title={LEVEL_NAMES[l]}
          onClick={() => onChange(l)}
        >
          {LEVEL_LABELS[l]}
        </button>
      ))}
    </span>
  );
}

/** The highlight level picked on this device. */
export const useHighlightPick = () => usePref<HighlightLevel>(HIGHLIGHTS_KEY, HIGHLIGHT_LEVELS, 'full');

/** "K.Snyder": how the engine writes a player into a play. */
const playName = (p: Player) => `${p.firstName[0]}.${p.lastName}`;

export interface PlayNames {
  /** Every linkable name, longest first so "A.Macken" wins over "A.Mack". Null when there are none. */
  re: RegExp | null;
  ids: Map<string, number>;
}

/**
 * The players a game's plays can name, by how the play text writes them: everyone who suited up (a finished
 * game keeps them, so a replay still links after a trade or a retirement) or, while it's live, both
 * rosters. A name two of them share stays plain text rather than guess.
 */
export function usePlayNames(league: League, game: Game | undefined): PlayNames {
  const done = !!game?.result;
  return useMemo(() => {
    if (!game) return { re: null, ids: new Map() };
    const ids = game.result
      ? Object.keys(game.result.playerTeams).map(Number)
      : [...teamPlayers(league, game.homeId), ...teamPlayers(league, game.awayId)].map((p) => p.id);
    const byName = new Map<string, number | null>();
    for (const id of ids) {
      const p = league.players[id];
      if (!p) continue;
      const key = playName(p);
      byName.set(key, byName.has(key) ? null : id);
    }
    const names = new Map([...byName].filter((e): e is [string, number] => e[1] !== null));
    if (!names.size) return { re: null, ids: names };
    const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const alternatives = [...names.keys()].sort((a, b) => b.length - a.length).map(escape);
    return { re: new RegExp(`(${alternatives.join('|')})(?![A-Za-z])`, 'g'), ids: names };
    // The rosters only matter until the final whistle; after that the game keeps its own list.
  }, [game?.id, done]);
}

/** A play's text with every player in it a link to his card. A tap on a name doesn't also jump the replay. */
export function PlayText({ text, names }: { text: string; names: PlayNames }) {
  const nav = useNav();
  if (!names.re) return <>{text}</>;
  return (
    <>
      {text.split(names.re).map((part, i) =>
        i % 2 ? (
          <button
            key={i}
            className="linklike"
            onClick={(e) => {
              e.stopPropagation();
              nav.openPlayer(names.ids.get(part)!);
            }}
          >
            {part}
          </button>
        ) : (
          part
        ),
      )}
    </>
  );
}

export function GameViewer({
  league,
  gameId,
  onBack,
  onBoxScore,
}: {
  league: League;
  gameId: number;
  onBack: () => void;
  onBoxScore: () => void;
}) {
  const game = league.games.find((g) => g.id === gameId);
  const plays = game?.result?.plays ?? [];
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [run, setRun] = useState(0); // bumps to replay the current play
  const [still, setStill] = useState(false);
  const [pick, setPick] = useHighlightPick();
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const names = usePlayNames(league, game);

  useEffect(() => () => clearTimeout(timer.current), []);

  // Pruned games keep only scoring plays; a replay needs the full log.
  if (!game?.result || !plays.some((p) => !p.scoring)) {
    return (
      <section className="panel">
        <h2>Replay not available</h2>
        <p className="muted">Full play-by-play is kept for your team's games and the most recent week.</p>
        <button className="btn" onClick={onBack}>
          Back
        </button>
      </section>
    );
  }

  const home = league.teams[game.homeId];
  const away = league.teams[game.awayId];
  const entry = plays[index];
  const atEnd = index >= plays.length - 1;
  const label = game.playoffRound ? ROUND_NAMES[game.playoffRound] : weekLabel(game.week);

  const go = (i: number, keepPlaying = false, skipped = false) => {
    clearTimeout(timer.current);
    setIndex(Math.max(0, Math.min(plays.length - 1, i)));
    setStill(skipped);
    setRun((r) => r + 1);
    if (!keepPlaying) setPlaying(false);
  };
  /** The next play to show from `from` at the level picked: past the plays it skips, they land together, still. */
  const advanceFrom = (from: number) => {
    const n = nextShown(plays, from, home.id, pick, 1);
    if (n === -1) return go(plays.length - 1, false, plays.length - 1 > from);
    if (n > from + 1) return go(n - 1, true, true);
    go(n, true);
  };
  const onDone = () => {
    if (!playing) return;
    if (atEnd) return setPlaying(false);
    // A skipped batch has been shown: its hold was the pause, so the highlight follows at once.
    if (still) return go(index + 1, true);
    timer.current = setTimeout(() => advanceFrom(index), 650 / speed);
  };
  const step = (dir: 1 | -1) => {
    const n = nextShown(plays, index, home.id, pick, dir);
    go(n === -1 ? (dir === 1 ? plays.length - 1 : 0) : n);
  };
  const togglePlay = () => {
    if (playing) {
      clearTimeout(timer.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      if (atEnd) go(0, true);
      else advanceFrom(index);
    }
  };
  // Every play up to this one, newest first: nothing past the current play, so the log never spoils it.
  const recent = plays.slice(0, index + 1).reverse();
  const quarterLabel = entry.quarter <= 4 ? `Q${entry.quarter}` : 'OT';
  const final = atEnd && !playing;

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <button className="btn btn-sm btn-ghost" onClick={onBack}>
          ← Back
        </button>
        <button className="btn btn-sm" onClick={onBoxScore}>
          Box score
        </button>
      </div>

      <section className="viewer">
        <div className="viewer-bug">
          {[away, home].map((t) => (
            <div key={t.id} className="vb-team" style={{ background: t.colors[0] }}>
              <span className="vb-name">
                {t.abbrev}
                {entry.offense === t.id && entry.down ? <span className="vb-poss" aria-label="has the ball" /> : null}
              </span>
              <span className="vb-score">{t.id === home.id ? entry.homeScore : entry.awayScore}</span>
            </div>
          ))}
          <div className="vb-clock">
            <span>
              {final ? `Final${game.result.overtime ? '/OT' : ''}` : `${quarterLabel} · ${gameClock(entry.clock)}`}
            </span>
            <span>{label}</span>
          </div>
        </div>

        <Field
          home={home}
          away={away}
          entry={entry}
          restX={restingSpot(plays, index, home.id)}
          animKey={`${index}:${run}`}
          speed={speed}
          still={still}
          onDone={onDone}
        />

        <div className="viewer-sit">
          <span className="num">{situation(entry, home, away) || ' '}</span>
          <span className="viewer-tag">{playLabel(entry, home.id)}</span>
        </div>

        <div className="viewer-controls">
          <button className="vc-btn" onClick={() => step(-1)} disabled={index === 0} aria-label="Previous play">
            ◀◀
          </button>
          <button className="vc-btn vc-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="vc-btn" onClick={() => step(1)} disabled={atEnd} aria-label="Next play">
            ▶▶
          </button>
          <button
            className="vc-speed"
            onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])}
            aria-label="Playback speed"
          >
            {speed}×
          </button>
          <HighlightSwitch value={pick} onChange={setPick} />
          <input
            className="vc-scrub"
            type="range"
            id="viewer-scrub"
            min={0}
            max={plays.length - 1}
            value={index}
            onChange={(e) => go(Number(e.target.value))}
            aria-label="Jump to play"
          />
        </div>
      </section>

      <section className="panel">
        <div className="play-log" aria-label="Plays so far">
          {recent.map((p, i) => {
            const idx = index - i;
            const team = p.offense === home.id ? home : away;
            return (
              // The whole card jumps to its play (the clock is the keyboard way in); a name opens the player.
              <div
                key={idx}
                className={`play-card${i === 0 ? ' current' : ''}${p.scoring ? ' scoring' : ''}`}
                onClick={() => go(idx)}
              >
                <span className="pc-meta">
                  <TeamChip team={team} />
                  <button
                    className="linklike num muted"
                    onClick={() => go(idx)}
                    aria-label={`Jump to the play at ${p.quarter <= 4 ? `Q${p.quarter}` : 'OT'} ${gameClock(p.clock)}`}
                  >
                    {p.quarter <= 4 ? `Q${p.quarter}` : 'OT'} {gameClock(p.clock)}
                  </button>
                </span>
                <span className="pc-body">
                  <span className="pc-sit">{situation(p, home, away)}</span>
                  <span>
                    <PlayText text={p.text} names={names} />
                  </span>
                </span>
                <span className="pc-tag">{playLabel(p, home.id)}</span>
              </div>
            );
          })}
        </div>
      </section>
    </>
  );
}
