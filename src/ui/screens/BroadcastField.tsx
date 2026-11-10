/**
 * The broadcast view of a play: the field seen from the sideline, the ball and its trail, the line of scrimmage and
 * the line to gain. It follows the play's logged path (`ballPath.ts`) and carries the ball from where the last play
 * left it to the next spot. The stadium around it and the paint on it are `BroadcastPaint.tsx`.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { PlayLogEntry, Team } from '../../engine/types';
import { buildPath, FIELD_W, HASH_HI, HASH_LO, MID, pointAt, snapYFor } from '../../engine/field/ballPath';

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
