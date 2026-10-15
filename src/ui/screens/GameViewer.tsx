import { useEffect, useMemo, useRef, useState } from 'react';
import type { League, PlayLogEntry, Team } from '../../engine/types';
import { ROUND_NAMES } from '../../engine/season/playoffs';
import { TeamChip } from '../components';
import { gameClock, weekLabel } from '../format';

// ───────── 2.5D field projection ─────────
// Field coordinates: x from -10 (home end zone) to 110 (away end zone), y from 0 (near
// sideline) to 53.3 (far sideline), h = height above the turf in yards. Drawn mirrored so the
// away team's end zone sits on the left, matching the away-then-home scorebug.
const VIEW_W = 360;
const VIEW_H = 176;
const NEAR = { y: 166, w: 346 };
const FAR = { y: 66, w: 226 };
const FIELD_W = 53.3;
const MID = FIELD_W / 2;

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

// ───────── ball paths ─────────
interface Seg {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Peak height for passes and kicks; 0 on the ground. */
  peak: number;
  dur: number;
}

function ground(x0: number, y0: number, x1: number, y1: number, pace = 1): Seg {
  return { x0, y0, x1, y1, peak: 0, dur: (0.3 + Math.min(1.9, Math.abs(x1 - x0) * 0.04)) * pace };
}
function air(x0: number, y0: number, x1: number, y1: number, peak: number, dur?: number): Seg {
  const dist = Math.hypot(x1 - x0, y1 - y0);
  return { x0, y0, x1, y1, peak, dur: dur ?? 0.5 + dist * 0.018 };
}

function buildPath(e: PlayLogEntry, homeId: number): Seg[] {
  if (e.from === undefined || e.to === undefined || !e.kind) return [];
  const { from, to } = e;
  const dir = e.offense === homeId ? 1 : -1;
  // Home drives toward screen-left, so its left hand is the near sideline; away is the reverse.
  const laneY = MID + (e.lane ?? 0) * dir * 16;
  const segs: Seg[] = [];
  switch (e.kind) {
    case 'pass':
    case 'incomplete':
    case 'int': {
      const qbX = from - dir * 6;
      segs.push(ground(from, MID, qbX, MID, 0.8));
      const target = e.air ?? from + dir * 2;
      const targetY = e.air === undefined ? (laneY > MID ? FIELD_W + 2 : -2) : laneY;
      segs.push(air(qbX, MID, target, targetY, Math.min(14, 2.5 + Math.abs(target - qbX) * 0.3)));
      if (e.kind !== 'incomplete' && Math.abs(to - target) > 0.5) segs.push(ground(target, targetY, to, laneY + (e.lane ?? 0) * 3));
      break;
    }
    case 'run':
    case 'scramble': {
      const handoff = from - dir * 3;
      segs.push(ground(from, MID, handoff, MID, 0.6));
      segs.push(ground(handoff, MID, to, laneY));
      break;
    }
    case 'kickoff':
    case 'punt': {
      const land = e.air ?? to;
      let start = from;
      if (e.kind === 'punt') {
        start = from - Math.sign(land - from || dir) * 13;
        segs.push(ground(from, MID, start, MID, 0.5));
      }
      segs.push(air(start, MID, land, MID, e.kind === 'kickoff' ? 24 : 20, 1.5));
      if (Math.abs(to - land) > 0.5) segs.push(ground(land, MID, to, MID + 4));
      break;
    }
    case 'fg':
    case 'xp':
      segs.push(air(from, MID, e.air ?? to, MID, 13, 1.1));
      break;
    default:
      segs.push(ground(from, MID, to, MID, e.kind === 'penalty' ? 1.6 : 1));
  }
  return segs;
}

function pointAt(seg: Seg, s: number) {
  return { x: seg.x0 + (seg.x1 - seg.x0) * s, y: seg.y0 + (seg.y1 - seg.y0) * s, h: 4 * seg.peak * s * (1 - s) };
}

/** Where the ball sits once a play is over (or before it, for plays without a path). */
export function restingSpot(plays: PlayLogEntry[], index: number, homeId: number): number {
  for (let i = index; i >= 0; i--) {
    const e = plays[i];
    if (e.to !== undefined) return e.kind === 'incomplete' ? e.from! : e.to;
    if (e.down) return e.offense === homeId ? e.yardLine : 100 - e.yardLine;
  }
  return 50;
}

// ───────── field ─────────
export function Field({ home, away, entry, restX, animKey, speed, onDone }: { home: Team; away: Team; entry: PlayLogEntry | undefined; restX: number; animKey: string; speed: number; onDone: () => void }) {
  const ballRef = useRef<SVGEllipseElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const segs = useMemo(() => (entry ? buildPath(entry, home.id) : []), [entry, home.id]);

  const trail = useMemo(() => {
    const pts: string[] = [];
    for (const seg of segs) {
      for (let i = 0; i <= 12; i++) {
        const p = pointAt(seg, i / 12);
        const q = project(p.x, p.y, p.h);
        pts.push(`${q.x.toFixed(1)},${q.y.toFixed(1)}`);
      }
    }
    return pts.length ? `M${pts.join('L')}` : '';
  }, [segs]);

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
    };
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const total = segs.reduce((s, x) => s + x.dur, 0) / speed;
    const last = segs[segs.length - 1];
    const finish = () => {
      if (last) place(last.x1, last.y1, 0, entry?.kind === 'incomplete' ? 0.35 : 1);
      else place(restX, MID, 0);
      trailRef.current?.setAttribute('stroke-dashoffset', '0');
    };
    if (!segs.length || reduced) {
      finish();
      const t = setTimeout(() => doneRef.current(), 450 / speed);
      return () => clearTimeout(t);
    }
    place(segs[0].x0, segs[0].y0, 0);
    trailRef.current?.setAttribute('stroke-dashoffset', '1');
    let raf = 0;
    let startAt = 0;
    const tick = (now: number) => {
      if (!startAt) startAt = now;
      let t = ((now - startAt) / 1000) * speed;
      if (t >= total * speed) {
        finish();
        doneRef.current();
        return;
      }
      trailRef.current?.setAttribute('stroke-dashoffset', String(1 - t / (total * speed)));
      for (const seg of segs) {
        if (t <= seg.dur) {
          const p = pointAt(seg, t / seg.dur);
          place(p.x, p.y, p.h);
          break;
        }
        t -= seg.dur;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // animKey identifies the play being shown; restarting on it replays the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey]);

  const offenseIsHome = entry?.offense === home.id;
  const los = entry?.down ? (offenseIsHome ? entry.yardLine : 100 - entry.yardLine) : null;
  const toGain = entry?.down && entry.yardLine + entry.distance < 100 ? (offenseIsHome ? entry.yardLine + entry.distance : 100 - entry.yardLine - entry.distance) : null;
  const line = (x: number, color: string, width: number) => {
    const a = project(x, 0);
    const b = project(x, FIELD_W);
    return <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={color} strokeWidth={width} strokeLinecap="round" />;
  };
  const endzoneLabel = (x: number, team: Team) => {
    const p = project(x, MID);
    return (
      <text x={p.x} y={p.y + 4} textAnchor="middle" className="ez-text" fontSize={11 * p.scale} transform={`rotate(${x < 50 ? 90 : -90} ${p.x} ${p.y})`}>
        {team.abbrev}
      </text>
    );
  };
  const trailColor = (offenseIsHome ? home : away).colors[1];

  return (
    <svg className="field-scene" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="Field view of the current play">
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
      {los !== null && line(los, '#5aa9ff', 2)}
      {toGain !== null && line(toGain, '#ffd43b', 2.2)}
      <path ref={trailRef} d={trail} fill="none" stroke={trailColor} strokeWidth="1.6" strokeLinecap="round" pathLength={1} strokeDasharray="1" strokeDashoffset="0" opacity="0.9" />
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
      return 'Kneel';
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
  const spot = e.yardLine === 50 ? 'midfield' : e.yardLine < 50 ? `${off.abbrev} ${e.yardLine}` : `${def.abbrev} ${100 - e.yardLine}`;
  return `${ord} & ${goal ? 'Goal' : e.distance} · Ball on ${spot}`;
}

const SPEEDS = [1, 2, 4];

export function GameViewer({ league, gameId, onBack, onBoxScore }: { league: League; gameId: number; onBack: () => void; onBoxScore: () => void }) {
  const game = league.games.find((g) => g.id === gameId);
  const plays = game?.result?.plays ?? [];
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [run, setRun] = useState(0); // bumps to replay the current play
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

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

  const go = (i: number, keepPlaying = false) => {
    clearTimeout(timer.current);
    setIndex(Math.max(0, Math.min(plays.length - 1, i)));
    setRun((r) => r + 1);
    if (!keepPlaying) setPlaying(false);
  };
  const onDone = () => {
    if (!playing) return;
    if (atEnd) return setPlaying(false);
    timer.current = setTimeout(() => go(index + 1, true), 650 / speed);
  };
  const togglePlay = () => {
    if (playing) {
      clearTimeout(timer.current);
      setPlaying(false);
    } else {
      setPlaying(true);
      go(atEnd ? 0 : index + 1, true);
    }
  };
  const recent = plays.slice(Math.max(0, index - 7), index + 1).reverse();
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
            <span>{final ? `Final${game.result.overtime ? '/OT' : ''}` : `${quarterLabel} · ${gameClock(entry.clock)}`}</span>
            <span>{label}</span>
          </div>
        </div>

        <Field home={home} away={away} entry={entry} restX={restingSpot(plays, index, home.id)} animKey={`${index}:${run}`} speed={speed} onDone={onDone} />

        <div className="viewer-sit">
          <span className="num">{situation(entry, home, away) || ' '}</span>
          <span className="viewer-tag">{playLabel(entry, home.id)}</span>
        </div>

        <div className="viewer-controls">
          <button className="vc-btn" onClick={() => go(index - 1)} disabled={index === 0} aria-label="Previous play">
            ◀◀
          </button>
          <button className="vc-btn vc-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
            {playing ? '❚❚' : '▶'}
          </button>
          <button className="vc-btn" onClick={() => go(index + 1)} disabled={atEnd} aria-label="Next play">
            ▶▶
          </button>
          <button className="vc-speed" onClick={() => setSpeed(SPEEDS[(SPEEDS.indexOf(speed) + 1) % SPEEDS.length])} aria-label="Playback speed">
            {speed}×
          </button>
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
        <div className="stack" style={{ gap: 0 }}>
          {recent.map((p, i) => {
            const idx = index - i;
            const team = p.offense === home.id ? home : away;
            return (
              <button key={idx} className={`play-card${i === 0 ? ' current' : ''}${p.scoring ? ' scoring' : ''}`} onClick={() => go(idx)}>
                <span className="pc-meta">
                  <TeamChip team={team} />
                  <span className="num muted">
                    {p.quarter <= 4 ? `Q${p.quarter}` : 'OT'} {gameClock(p.clock)}
                  </span>
                </span>
                <span className="pc-body">
                  <span className="pc-sit">{situation(p, home, away)}</span>
                  <span>{p.text}</span>
                </span>
                <span className="pc-tag">{playLabel(p, home.id)}</span>
              </button>
            );
          })}
        </div>
      </section>
    </>
  );
}
