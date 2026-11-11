/**
 * The broadcast view of a play: the field seen from the sideline, the ball and its trail, the line of scrimmage and
 * the line to gain. It follows the play's logged path (`ballPath.ts`) and carries the ball from where the last play
 * left it to the next spot. The stadium around it and the paint on it are `BroadcastPaint.tsx`.
 */
import { useEffect, useRef } from 'react';
import type { PlayLogEntry, Team } from '../../engine/types';
import { buildPath, FIELD_W, MID, pointAt, snapYFor } from '../../engine/field/ballPath';
import { endsSwitched } from '../stage/ends';
import type { Weather } from '../../engine/weather';
import { FieldGround, FieldPosts, Stadium, WeatherFall } from './BroadcastPaint';
import { project, quad, VIEW_H, VIEW_W } from './broadcastView';

export { project } from './broadcastView';

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
  /** Whether the ends were switched when this was drawn: a new quarter starts from the other side, with no sweep. */
  swapped: boolean;
}

// ───────── field ─────────
/** Inside this many yards of the goal line, the offense is in the red zone. */
const RED_ZONE = 20;

/**
 * What the drive has put on the grass, under the lines: a band in the offense's colour from where it began to this
 * snap, the spot it began marked and named, and the last twenty yards reddened once the ball is snapped inside them.
 * Drawn where the stadium has them this quarter.
 */
function DriveMarks({
  home,
  away,
  entry,
  drive,
}: {
  home: Team;
  away: Team;
  entry: PlayLogEntry | undefined;
  drive?: { teamId: number; from: number };
}) {
  const los = downLines(entry, home.id)?.los;
  if (!entry?.down || los === null || los === undefined) return null;
  const q = entry.quarter;
  const homeBall = entry.offense === home.id;
  const began = drive && Math.abs(drive.from - los) >= 1 ? drive.from : null;
  // Its far end on screen, where the label sits: the far sideline is the log's near one once the ends are switched.
  const b = began === null ? null : project(began, endsSwitched(q) ? 0 : FIELD_W, 0, q);
  const a = began === null ? null : project(began, endsSwitched(q) ? FIELD_W : 0, 0, q);
  return (
    <g className="drive-marks">
      {began !== null && a && b && (
        <>
          <polygon
            className="drive-band"
            points={quad(began, los, 0, FIELD_W, q)}
            fill={(homeBall ? home : away).colors[0]}
            opacity={0.24}
          />
          <line
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="#fff"
            strokeWidth={0.8}
            strokeDasharray="2.5 2"
            opacity={0.7}
          />
          <g transform={`translate(${b.x.toFixed(1)} ${(b.y - 7).toFixed(1)})`}>
            <rect x={-19} y={-4.4} width={38} height={8.4} rx={2} fill="rgba(6,10,9,0.82)" />
            <text textAnchor="middle" y={1.9} fontSize={5.2} fill="#fff" fontWeight={700}>
              Drive began
            </text>
          </g>
        </>
      )}
      {entry.yardLine >= 100 - RED_ZONE && (
        <polygon
          className="red-zone"
          points={homeBall ? quad(100 - RED_ZONE, 100, 0, FIELD_W, q) : quad(0, RED_ZONE, 0, FIELD_W, q)}
          fill="#ff3b30"
          opacity={0.2}
        />
      )}
    </g>
  );
}

/** A mild, dry afternoon: what is drawn when a caller has no weather to give. */
const FAIR: Weather = { roof: 'outdoors', tempF: 60, windMph: 5, precip: 'none' };

export function Field({
  home,
  away,
  neutral,
  weather = FAIR,
  drive,
  entry,
  restX,
  animKey,
  speed,
  still = false,
  onDone,
}: {
  home: Team;
  away: Team;
  /** A neutral site: each team has an end zone (`endZones`). */
  neutral?: boolean;
  /** The conditions in the quarter on screen (`weatherAt`): the sky, what is falling, the wind in the flags. */
  weather?: Weather;
  /** The drive this snap belongs to (`driveAt`): where it began is marked on the grass. */
  drive?: { teamId: number; from: number };
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
    // Teams switch ends each quarter: the play is drawn where the stadium has it, read from its own quarter.
    const quarter = entry?.quarter ?? 1;
    const swapped = endsSwitched(quarter);
    const place = (x: number, y: number, h: number, opacity = 1) => {
      const b = project(x, y, h, quarter);
      const g = project(x, y, 0, quarter);
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
      const a = project(x, 0, 0, quarter);
      const b = project(x, FIELD_W, 0, quarter);
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

    const drawn = memory.current;
    // A new quarter from the other side: nothing carries across, so no ball is swept over the field and no line slid.
    const prev = drawn && drawn.swapped === swapped ? drawn : null;
    const lines = downLines(entry, home.id) ?? (prev ? { los: prev.los, gain: prev.gain } : { los: null, gain: null });
    const from = prev
      ? { ...prev }
      : drawn
        ? { x: restX, y: MID, los: null, gain: null, swapped }
        : { x: restX, y: MID, ...lines, swapped };
    memory.current = { ...from, swapped };
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
        const q = project(p.x, p.y, p.h, quarter);
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

  return (
    <svg
      className="field-scene"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      role="img"
      aria-label="Field view of the current play"
    >
      <rect width={VIEW_W} height={VIEW_H} className="scene-bg" />
      <Stadium home={home} away={away} neutral={neutral} weather={weather} />
      <FieldGround home={home} away={away} neutral={neutral} snow={weather.precip === 'snow'} />
      <DriveMarks home={home} away={away} entry={entry} drive={drive} />
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
      <FieldPosts />
      <WeatherFall weather={weather} />
    </svg>
  );
}

/** The stadium before the kickoff: the paint and the weather, with no ball and no lines on it yet. */
export function IdleField({
  home,
  away,
  neutral,
  weather = FAIR,
}: {
  home: Team;
  away: Team;
  neutral?: boolean;
  weather?: Weather;
}) {
  return (
    <svg className="field-scene" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} role="img" aria-label="The field before kickoff">
      <rect width={VIEW_W} height={VIEW_H} className="scene-bg" />
      <Stadium home={home} away={away} neutral={neutral} weather={weather} />
      <FieldGround home={home} away={away} neutral={neutral} snow={weather.precip === 'snow'} />
      <FieldPosts />
      <WeatherFall weather={weather} />
    </svg>
  );
}
