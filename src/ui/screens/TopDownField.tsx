/**
 * All-22: the play from above, every player a numbered dot. The play is staged once (`stagePlay`) and played back
 * here, writing each dot's spot straight to the SVG each frame (no React state per frame), as `Field` does.
 * Spec: docs/superpowers/specs/2026-10-31-all-22-view-design.md §4.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldRecord, Game, League, PlayLogEntry, Team } from '../../engine/types';
import { kitFor } from '../color';
import { PlayerLink } from '../components';
import { FIELD_W, HASH_HI, HASH_LO, MID, snapYFor } from '../stage/ballPath';
import { cameraCenter, cameraSpan, layoutFor, type Layout } from '../stage/camera';
import { stagePlay, type StagedPlay } from '../stage/stage';
import { downLines } from './GameViewer';

/** A dot's radius in yards: bigger sideways, where the whole field shares the width. */
const DOT: Record<Layout, number> = { wide: 1.3, upright: 0.95 };
/** Taps land within this many yards of a dot. */
const REACH = 2.5;
/** Seconds (at 1×) to slide everyone from where the last play ended to the next line-up. */
const RESPOT = 0.6;

/** Field (x, y) to the picture: sideways like the broadcast view, or upright with the offense attacking up. */
interface View {
  layout: Layout;
  dir: 1 | -1;
  /** The upright window's centre yard line. */
  cx: number;
  span: number;
}
function toScreen(v: View, x: number, y: number): [number, number] {
  return v.layout === 'wide' ? [100 - x, FIELD_W - y] : [v.dir * (y - MID), -v.dir * (x - v.cx)];
}
function viewBox(v: View): string {
  return v.layout === 'wide' ? '-12 -2 124 57.3' : `${-MID - 1} ${-v.span / 2} ${FIELD_W + 2} ${v.span}`;
}
/** The field group's transform: the same mapping as `toScreen`, as an SVG matrix. */
function fieldTransform(v: View): string {
  return v.layout === 'wide'
    ? `matrix(-1 0 0 -1 100 ${FIELD_W})`
    : `matrix(0 ${-v.dir} ${v.dir} 0 ${-v.dir * MID} ${v.dir * v.cx})`;
}

interface Memory {
  spots: Map<number, [number, number]>;
  ballY: number;
  cx: number;
}

export function TopDownField({
  league,
  record,
  game,
  home,
  away,
  plays,
  index,
  animKey,
  speed,
  still = false,
  onDone,
}: {
  league: League;
  /** Who was on the field: the result's for a replay, the running game's for a live one. */
  record: FieldRecord | undefined;
  game: Game;
  home: Team;
  away: Team;
  plays: readonly PlayLogEntry[];
  index: number;
  animKey: string;
  speed: number;
  still?: boolean;
  onDone: () => void;
}) {
  const entry = plays[index];
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fieldRef = useRef<SVGGElement>(null);
  const dotRefs = useRef(new Map<number, SVGGElement>());
  const ballRef = useRef<SVGEllipseElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const trailRef = useRef<SVGPathElement>(null);
  const memory = useRef<Memory>({ spots: new Map(), ballY: MID, cx: 50 });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [layout, setLayout] = useState<Layout>('wide');
  const [card, setCard] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setLayout(layoutFor(e.contentRect.width, e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const staged: StagedPlay | null = useMemo(() => {
    if (!record || !entry) return null;
    return stagePlay({
      plays,
      index,
      record,
      homeId: home.id,
      seed: `${league.seed}:${game.season}:${game.id}:stage:${index}`,
      snapY: snapYFor(entry, memory.current.ballY),
    });
    // The play is staged once per play shown; the memory it reads is where the last play left the ball.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, index, game.id]);

  const dir: 1 | -1 = entry?.offense === home.id ? 1 : -1;
  const span = cameraSpan(entry);
  const lines = downLines(entry, home.id);

  useEffect(() => {
    if (!staged || !svg.current) return;
    const s = staged;
    const n = s.ids.length;
    const last = s.steps - 1;
    const mem = memory.current;
    const from = s.ids.map((id, k) => mem.spots.get(id) ?? [s.pos[k * 2], s.pos[k * 2 + 1]]);
    const view: View = { layout, dir, cx: mem.cx, span };

    const place = (step: number, slide: number) => {
      const ballX = s.ball[step * 3];
      const ballY = s.ball[step * 3 + 1];
      const h = s.ball[step * 3 + 2];
      if (layout === 'upright') {
        const target = cameraCenter(ballX, dir, span);
        view.cx += (target - view.cx) * (slide < 1 ? 0.08 : 0.12);
        fieldRef.current?.setAttribute('transform', fieldTransform(view));
        svg.current?.setAttribute('viewBox', viewBox(view));
      }
      for (let k = 0; k < n; k++) {
        let x = s.pos[(step * n + k) * 2];
        let y = s.pos[(step * n + k) * 2 + 1];
        if (slide < 1) {
          x = from[k][0] + (x - from[k][0]) * slide;
          y = from[k][1] + (y - from[k][1]) * slide;
        }
        const [sx, sy] = toScreen(view, x, y);
        dotRefs.current.get(s.ids[k])?.setAttribute('transform', `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`);
        mem.spots.set(s.ids[k], [x, y]);
      }
      const [bx, by] = toScreen(view, ballX, ballY);
      const grow = 1 + h / 18;
      ballRef.current?.setAttribute(
        'transform',
        `translate(${bx.toFixed(2)} ${(by - h * 0.15).toFixed(2)}) scale(${grow.toFixed(2)})`,
      );
      shadowRef.current?.setAttribute(
        'transform',
        `translate(${(bx + h * 0.3).toFixed(2)} ${(by + h * 0.3).toFixed(2)})`,
      );
      shadowRef.current?.setAttribute('opacity', String(Math.max(0.15, 0.45 - h / 40)));
      // The ball's trail so far, as the broadcast view draws it.
      const pts: string[] = [];
      for (let i = 0; i <= step; i += 2) {
        const [tx, ty] = toScreen(view, s.ball[i * 3], s.ball[i * 3 + 1]);
        pts.push(`${tx.toFixed(1)},${ty.toFixed(1)}`);
      }
      trailRef.current?.setAttribute('d', pts.length > 1 && slide >= 1 ? `M${pts.join('L')}` : '');
      mem.ballY = ballY;
      mem.cx = view.cx;
    };

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still || reduced) {
      place(last, 1);
      const t = setTimeout(() => doneRef.current(), 450 / speed);
      return () => clearTimeout(t);
    }
    let raf = 0;
    let t0 = 0;
    const playTime = last * s.dt;
    const tick = (now: number) => {
      if (!t0) t0 = now;
      const t = ((now - t0) / 1000) * speed;
      if (t < RESPOT) place(0, t / RESPOT);
      else if (t - RESPOT < playTime) place(Math.min(last, Math.floor((t - RESPOT) / s.dt)), 1);
      else {
        place(last, 1);
        doneRef.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // animKey names the play being shown; restarting on it replays the animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [animKey, staged, layout]);

  if (!record || !staged) return null;

  const view: View = { layout, dir, cx: memory.current.cx, span };
  const kit = (t: Team, isAway: boolean) => kitFor({ primary: t.colors[0], secondary: t.colors[1] }, isAway);
  const homeKit = kit(home, false);
  const awayKit = kit(away, true);
  const keys = new Set(staged.keys);
  const dot = DOT[layout];
  // Players in the play are drawn last, so their rings sit on top.
  const order = staged.ids
    .map((_, k) => k)
    .sort((a, b) => Number(keys.has(staged.ids[a])) - Number(keys.has(staged.ids[b])));

  const onTap = (ev: React.PointerEvent<SVGSVGElement>) => {
    const el = svg.current;
    const ctm = el?.getScreenCTM();
    if (!el || !ctm) return;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    let best: number | null = null;
    let d = REACH;
    for (const [id, [x, y]] of memory.current.spots) {
      if (!staged.ids.includes(id)) continue;
      const [sx, sy] = toScreen({ ...view, cx: memory.current.cx }, x, y);
      const dd = Math.hypot(sx - p.x, sy - p.y);
      if (dd < d) [d, best] = [dd, id];
    }
    setCard(best);
  };

  const cardPlayer = card !== null ? league.players[card] : undefined;
  const losLine = (x: number | null, color: string) =>
    x === null ? null : <line x1={x} y1={0} x2={x} y2={FIELD_W} stroke={color} strokeWidth={0.45} />;

  return (
    <div className={`td-field td-${layout}`} ref={box}>
      <svg
        ref={svg}
        className="td-scene"
        viewBox={viewBox(view)}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="All-22: the play from above"
        onPointerDown={onTap}
      >
        <g ref={fieldRef} transform={fieldTransform(view)}>
          <rect x={-12} y={-2} width={124} height={FIELD_W + 4} fill="#255f37" />
          <rect x={-10} y={0} width={120} height={FIELD_W} fill="#2f7a46" />
          {Array.from({ length: 10 }, (_, i) => i * 10)
            .filter((x) => (x / 10) % 2 === 0)
            .map((x) => (
              <rect key={x} x={x} y={0} width={10} height={FIELD_W} fill="#2b7141" />
            ))}
          <rect x={-10} y={0} width={10} height={FIELD_W} fill={home.colors[0]} />
          <rect x={100} y={0} width={10} height={FIELD_W} fill={away.colors[0]} />
          {Array.from({ length: 21 }, (_, i) => i * 5).map((x) => (
            <line
              key={x}
              x1={x}
              y1={0}
              x2={x}
              y2={FIELD_W}
              stroke="rgba(255,255,255,0.7)"
              strokeWidth={x % 10 ? 0.12 : 0.2}
            />
          ))}
          {Array.from({ length: 99 }, (_, i) => i + 1)
            .filter((x) => x % 5)
            .map((x) => (
              <g key={x} stroke="rgba(255,255,255,0.5)" strokeWidth={0.1}>
                <line x1={x} y1={HASH_LO - 0.4} x2={x} y2={HASH_LO + 0.4} />
                <line x1={x} y1={HASH_HI - 0.4} x2={x} y2={HASH_HI + 0.4} />
              </g>
            ))}
          <rect x={-10} y={0} width={120} height={FIELD_W} fill="none" stroke="#fff" strokeWidth={0.3} />
          {lines && losLine(lines.los, '#5aa9ff')}
          {lines && losLine(lines.gain, '#ffd43b')}
        </g>
        <path
          ref={trailRef}
          fill="none"
          stroke={(entry?.offense === home.id ? home : away).colors[1]}
          strokeWidth={0.35}
          strokeLinecap="round"
          opacity={0.9}
        />
        {order.map((k) => {
          const id = staged.ids[k];
          const k2 = staged.home[k] ? homeKit : awayKit;
          const [sx, sy] = toScreen(view, staged.pos[k * 2], staged.pos[k * 2 + 1]);
          return (
            <g
              key={id}
              className="dot"
              ref={(el) => {
                if (el) dotRefs.current.set(id, el);
                else dotRefs.current.delete(id);
              }}
              transform={`translate(${sx.toFixed(2)} ${sy.toFixed(2)})`}
            >
              {keys.has(id) && <circle r={dot + 0.45} fill="none" stroke="#ffd43b" strokeWidth={0.28} />}
              <circle r={dot} fill={k2.jersey} stroke={k2.trim} strokeWidth={0.18} />
              <text y={dot * 0.37} textAnchor="middle" fontSize={dot * 1.05} fontWeight={700} fill={k2.ink}>
                {record.jerseys[id] ?? ''}
              </text>
            </g>
          );
        })}
        <ellipse ref={shadowRef} rx={0.55} ry={0.32} fill="rgba(0,0,0,0.45)" />
        <ellipse ref={ballRef} rx={0.55} ry={0.34} fill="#7a3f1d" stroke="#fff" strokeWidth={0.1} />
      </svg>
      {cardPlayer && (
        <div className="td-card" role="dialog" aria-label="Player">
          <span className="num">#{record.jerseys[cardPlayer.id]}</span>{' '}
          <PlayerLink league={league} player={cardPlayer} /> <span className="muted">{cardPlayer.position}</span>
          <button className="td-card-x" onClick={() => setCard(null)} aria-label="Close">
            ×
          </button>
        </div>
      )}
    </div>
  );
}
