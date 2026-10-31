/**
 * All-22: the play from above, every player a numbered dot. The play is staged once (`stagePlay`) and played back
 * here, writing each dot's spot straight to the SVG each frame (no React state per frame), as `Field` does.
 * Spec: docs/superpowers/specs/2026-10-31-all-22-view-design.md §4.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldRecord, Game, League, PlayLogEntry, Team } from '../../engine/types';
import { kitFor } from '../color';
import { PlayerLink } from '../components';
import { FIELD_W, HASH_HI, HASH_LO, MID, offenseSide, snapYFor } from '../stage/ballPath';
import { cameraCenter, cameraSpan, easeCamera, layoutFor, type Layout } from '../stage/camera';
import { stagePlay, type StagedPlay } from '../stage/stage';
import { celebrates, transition, type Huddle, type Mark } from '../stage/transition';
import { downLines } from './GameViewer';

/** A dot's radius in yards: bigger sideways, where the whole field shares the width. */
const DOT: Record<Layout, number> = { wide: 1.3, upright: 0.95 };
/** Taps land within this many yards of a dot. */
const REACH = 2.5;
/** The official walking the ball to its new spot, in yards a second. */
const CARRY = 6;
/** How far through a play a flag comes out. */
const FLAG_AT = 0.4;
/** A play a flag was thrown on, accepted or declined (a flag before the snap is its own play, `penalty`). */
const FLAGGED = /PENALTY|declined/;

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

/**
 * The officials on a kickoff, from the ball on the kicking 35: a pair on the sidelines at the kicking team's line
 * (the receiving 40), a pair at the receiving 20, and one deep on the receiving goal line.
 */
function crew(ballX: number, dir: 1 | -1): [number, number][] {
  const at = (yards: number) => ballX + dir * yards;
  return [
    [at(25), -1.2],
    [at(25), FIELD_W + 1.2],
    [at(45), -1.2],
    [at(45), FIELD_W + 1.2],
    [at(65), MID + 9],
  ];
}

/** An official: white with black stripes, a touch smaller than a player. */
function Official({ r }: { r: number }) {
  return (
    <>
      <circle r={r} fill="#f4f4f4" stroke="#111" strokeWidth={0.15} />
      <line x1={-r * 0.38} y1={-r * 0.92} x2={-r * 0.38} y2={r * 0.92} stroke="#111" strokeWidth={0.2} />
      <line x1={r * 0.38} y1={-r * 0.92} x2={r * 0.38} y2={r * 0.92} stroke="#111" strokeWidth={0.2} />
    </>
  );
}

/**
 * How long All-22 holds on a play's end before the next one, in milliseconds at 1×: a beat to read it, longer after
 * a kick, a score or a turnover.
 */
export function holdAfter(e: PlayLogEntry | undefined): number {
  if (!e) return 1600;
  const big =
    e.scoring ||
    e.kind === 'kickoff' ||
    e.kind === 'punt' ||
    e.kind === 'fg' ||
    e.kind === 'xp' ||
    e.kind === 'int' ||
    /FUMBLE|TOUCHDOWN/.test(e.text);
  return big ? 2600 : 1600;
}

/** Plays the offense huddles before: every snap from scrimmage. Kick units and two-point tries line straight up. */
const HUDDLED: ReadonlySet<string> = new Set([
  'run',
  'pass',
  'incomplete',
  'int',
  'sack',
  'scramble',
  'kneel',
  'spike',
]);

interface Memory {
  /** Where each man on the field was last drawn, and which kit he wears. */
  spots: Map<number, Mark>;
  ballX: number | null;
  ballY: number;
  cx: number;
  /** Where the last play shown ended and whose man had the ball: a big one is celebrated there. */
  ended: { index: number; at: Mark | null } | null;
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
  fallback,
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
  /** Shown if a play can't be staged: the broadcast field. */
  fallback?: ReactNode;
  onDone: () => void;
}) {
  const entry = plays[index];
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fieldRef = useRef<SVGGElement>(null);
  const dotRefs = useRef(new Map<number, SVGGElement>());
  const ringRefs = useRef(new Map<number, SVGCircleElement>());
  const crewRef = useRef<SVGGElement>(null);
  const spotterRef = useRef<SVGGElement>(null);
  const flagRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGEllipseElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const memory = useRef<Memory>({ spots: new Map(), ballX: null, ballY: MID, cx: 50, ended: null });
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const [layout, setLayout] = useState<Layout>('wide');
  const [card, setCard] = useState<number | null>(null);
  // A new play closes the card: its player may not even be on the field for it.
  useEffect(() => setCard(null), [index]);

  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([e]) => setLayout(layoutFor(e.contentRect.width, e.contentRect.height)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const staged: StagedPlay | null = useMemo(() => {
    if (!record || !entry) return null;
    try {
      return stagePlay({
        plays,
        index,
        record,
        homeId: home.id,
        seed: `${league.seed}:${game.season}:${game.id}:stage:${index}`,
        snapY: snapYFor(entry, memory.current.ballY),
      });
    } catch {
      // A log this view can't stage: the broadcast view instead, rather than take the viewer down.
      return null;
    }
    // The play is staged once per play shown; the memory it reads is where the last play left the ball.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, index, game.id]);

  const dir: 1 | -1 = entry && offenseSide(entry, home.id) === 1 ? -1 : 1;

  /**
   * The huddles before this snap: the offense seven yards off the ball round its quarterback, the defense five yards
   * off it round its play-caller (the middle linebacker, or a safety with none on). None in a two-minute drill, where
   * offenses go no-huddle, nor before a kick.
   */
  /** Late in a half (the two-minute warning on), or late in the game with the offense behind: a clock to beat. */
  const twoMinute = !!entry && (entry.quarter === 2 || entry.quarter >= 4) && entry.clock <= 120;
  const hurried = () => {
    if (!entry || !entry.down) return false;
    const behind =
      (entry.offense === home.id ? entry.homeScore - entry.awayScore : entry.awayScore - entry.homeScore) < 0;
    return twoMinute || (entry.quarter >= 4 && entry.clock <= 300 && behind);
  };
  const huddleFor = (s: StagedPlay): Huddle | undefined => {
    if (!entry?.kind || !HUDDLED.has(entry.kind)) return undefined;
    if (twoMinute) return undefined; // no-huddle
    const bx = s.ball[0];
    const by = s.ball[1];
    const lbs = s.ids.filter((_, k) => !s.offense[k] && s.roles[k] === 'LB');
    const caller = lbs[Math.floor(lbs.length / 2)] ?? s.ids.find((_, k) => !s.offense[k] && s.roles[k] === 'S');
    return {
      offense: { x: bx - dir * 7, y: by },
      defense: { x: bx + dir * 5, y: by },
      offenseHome: s.home[0],
      qb: s.ids.find((_, k) => s.roles[k] === 'QB'),
      caller,
    };
  };
  const span = cameraSpan(entry);
  const lines = downLines(entry, home.id);

  useEffect(() => {
    if (!staged || !svg.current) return;
    const s = staged;
    const n = s.ids.length;
    const last = s.steps - 1;
    const mem = memory.current;
    const view: View = { layout, dir, cx: mem.cx, span };
    // Between plays: everyone jogs from where the last play left him to his spot, subs come and go (none on the
    // first play shown, which starts set).
    const big =
      mem.ended && mem.ended.index === index - 1 && celebrates(plays, index - 1, home.id) ? mem.ended.at : null;
    // Only the play right after the one just shown jogs in from it. A jump (the scrubber, the log, a replay)
    // starts set: a jog from some other moment of the game means nothing.
    const following = mem.ended?.index === index - 1;
    const gap =
      mem.spots.size && following
        ? transition(mem.spots, s, {
            party: big ?? undefined,
            huddle: huddleFor(s),
            hurry: hurried(),
            seed: `${league.seed}:${game.id}:gap:${index}`,
            change: entry?.kind === 'kickoff',
          })
        : null;
    const ballFrom = mem.ballX === null || !following ? null : { x: mem.ballX, y: mem.ballY };
    /** A key man's ring, only once his moment is about to come (`t` seconds from the snap): nothing gives the play away. */
    const rings = (t: number) =>
      s.keys.forEach((id, i) => ringRefs.current.get(id)?.setAttribute('opacity', t >= s.reveal[i] ? '1' : '0'));

    const camera = (ballX: number, seconds: number) => {
      if (layout !== 'upright') return;
      view.cx = easeCamera(view.cx, cameraCenter(ballX, dir, span), seconds);
      fieldRef.current?.setAttribute('transform', fieldTransform(view));
      svg.current?.setAttribute('viewBox', viewBox(view));
    };
    const drawDot = (id: number, x: number, y: number, opacity = 1) => {
      const el = dotRefs.current.get(id);
      if (!el) return;
      const [sx, sy] = toScreen(view, x, y);
      el.setAttribute('transform', `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`);
      el.setAttribute('opacity', opacity.toFixed(2));
    };
    const drawBall = (x: number, y: number, h: number) => {
      const [bx, by] = toScreen(view, x, y);
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
      mem.ballX = x;
      mem.ballY = y;
    };

    /** The jog between plays, `t` seconds in. */
    const jog = (t: number, seconds: number) => {
      const g = gap!;
      rings(-1);
      // The officials walk out to their spots for a kickoff while the units change over.
      crewRef.current?.setAttribute('opacity', Math.min(1, t / 2).toFixed(2));
      flagRef.current?.setAttribute('opacity', '0');
      for (const m of g.moves) {
        const p = g.at(m, t);
        drawDot(m.id, p.x, p.y, p.opacity);
        if (!m.leave) mem.spots.set(m.id, { x: p.x, y: p.y, home: m.home });
      }
      // An official picks the ball up after the whistle, walks it to the new spot, sets it down and steps away.
      const tb = Math.max(0, t - g.beat);
      const dist = ballFrom ? Math.hypot(s.ball[0] - ballFrom.x, s.ball[1] - ballFrom.y) : 0;
      const carry = Math.min(Math.max(0.5, dist / CARRY), Math.max(0.5, (g.duration - g.beat - 1.5) * 0.8));
      const k = ballFrom ? Math.min(1, tb / carry) : 1;
      const bx = ballFrom ? ballFrom.x + (s.ball[0] - ballFrom.x) * k : s.ball[0];
      const by = ballFrom ? ballFrom.y + (s.ball[1] - ballFrom.y) * k : s.ball[1];
      drawBall(bx, by, 0);
      camera(bx, seconds);
      const away = Math.min(1, Math.max(0, (tb - carry) / 1.2));
      const side = by > MID ? 1 : -1;
      const [ox, oy] = toScreen(view, bx - dir * 0.6, by + side * (0.9 + away * 5));
      const el = spotterRef.current;
      el?.setAttribute('transform', `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`);
      el?.setAttribute(
        'opacity',
        (ballFrom ? Math.min(1, t / 0.4) * (1 - Math.max(0, away - 0.4) / 0.6) : 0).toFixed(2),
      );
    };

    /** The play itself, at `step`. */
    const place = (step: number, seconds: number) => {
      camera(s.ball[step * 3], seconds);
      rings(step === last ? Infinity : step * s.dt);
      spotterRef.current?.setAttribute('opacity', '0');
      crewRef.current?.setAttribute('opacity', '1');
      // A flag on the play: thrown partway through, from the official's spot near the line.
      flagRef.current?.setAttribute('opacity', step === last || step * s.dt >= FLAG_AT * last * s.dt ? '1' : '0');
      for (let k = 0; k < n; k++) {
        const x = s.pos[(step * n + k) * 2];
        const y = s.pos[(step * n + k) * 2 + 1];
        drawDot(s.ids[k], x, y);
        mem.spots.set(s.ids[k], { x, y, home: s.home[k] });
      }
      drawBall(s.ball[step * 3], s.ball[step * 3 + 1], s.ball[step * 3 + 2]);
      mem.cx = view.cx;
      if (step === last) mem.ended = { index, at: madeIt() };
    };
    /** Who made the play, where it ended: the man with the ball (for a fumble, the side that came up with it). */
    const madeIt = (): Mark | null => {
      const x = s.ball[last * 3];
      const y = s.ball[last * 3 + 1];
      const e = plays[index];
      if (/FUMBLE/.test(e.text)) {
        const next = plays.slice(index + 1).find((p) => p.down > 0);
        return next ? { x, y, home: next.offense === home.id } : null;
      }
      const c = s.carrier === null ? -1 : s.ids.indexOf(s.carrier);
      return c < 0 ? null : { x, y, home: s.home[c] };
    };
    /** The men who came off are gone once the play starts. */
    const clearBench = () => {
      for (const id of [...mem.spots.keys()]) if (!s.ids.includes(id)) mem.spots.delete(id);
      for (const id of gap?.moves.filter((m) => m.leave).map((m) => m.id) ?? []) drawDot(id, 0, -20, 0);
    };

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (still || reduced) {
      // Nothing moves, so the window jumps straight to where the play ended.
      clearBench();
      place(last, Infinity);
      const t = setTimeout(() => doneRef.current(), 450 / speed);
      return () => clearTimeout(t);
    }
    let raf = 0;
    let t0 = 0;
    let prev = 0;
    // Starting set: the last play's men are gone at once.
    let cleared = !gap;
    if (!gap) clearBench();
    const playTime = last * s.dt;
    const tick = (now: number) => {
      if (!t0) t0 = prev = now;
      const t = ((now - t0) / 1000) * speed;
      const frame = ((now - prev) / 1000) * speed;
      prev = now;
      const pre = gap?.duration ?? 0;
      if (t < pre) jog(t, frame);
      else if (t - pre < playTime) {
        if (gap && !cleared) {
          clearBench();
          cleared = true;
        }
        place(Math.min(last, Math.floor((t - pre) / s.dt)), frame);
      } else {
        clearBench();
        place(last, frame);
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

  if (!record) return null;
  if (!staged) return <>{fallback}</>;

  const view: View = { layout, dir, cx: memory.current.cx, span };
  const kit = (t: Team, isAway: boolean) => kitFor({ primary: t.colors[0], secondary: t.colors[1] }, isAway);
  const homeKit = kit(home, false);
  const awayKit = kit(away, true);
  const keys = new Set(staged.keys);
  const dot = DOT[layout];
  // Men from the last play who aren't in this one: drawn until they've jogged off.
  const leaving = [...memory.current.spots.entries()].filter(([id]) => !staged.ids.includes(id));
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
    for (const [id, { x, y }] of memory.current.spots) {
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
          {entry.kind === 'kickoff' && (
            <g ref={crewRef} opacity={0}>
              {crew(staged.ball[0], dir).map(([x, y], i) => (
                <g key={i} transform={`translate(${x} ${y})`}>
                  <Official r={dot * 0.8} />
                </g>
              ))}
            </g>
          )}
          {(entry.kind === 'penalty' || FLAGGED.test(entry.text)) && (
            <g ref={flagRef} opacity={0} transform={`translate(${staged.ball[0] + dir * 1.5} ${staged.ball[1] + 3})`}>
              <rect
                x={-0.55}
                y={-0.4}
                width={1.1}
                height={0.8}
                rx={0.15}
                fill="#ffd400"
                stroke="#7a5d00"
                strokeWidth={0.1}
              />
            </g>
          )}
        </g>
        {leaving.map(([id, m]) => {
          const k2 = m.home ? homeKit : awayKit;
          const [sx, sy] = toScreen(view, m.x, m.y);
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
              <circle r={dot} fill={k2.jersey} stroke={k2.trim} strokeWidth={0.18} />
              <text y={dot * 0.37} textAnchor="middle" fontSize={dot * 1.05} fontWeight={700} fill={k2.ink}>
                {record.jerseys[id] ?? ''}
              </text>
            </g>
          );
        })}
        {order.map((k) => {
          const id = staged.ids[k];
          const k2 = staged.home[k] ? homeKit : awayKit;
          // Where the dot is now (the last frame drawn), so a re-render never moves it; the effect takes it from there.
          const was = memory.current.spots.get(id);
          const [x, y] = was ? [was.x, was.y] : [staged.pos[k * 2], staged.pos[k * 2 + 1]];
          const [sx, sy] = toScreen(view, x, y);
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
              {keys.has(id) && (
                <circle
                  ref={(el) => {
                    if (el) ringRefs.current.set(id, el);
                    else ringRefs.current.delete(id);
                  }}
                  r={dot + 0.45}
                  fill="none"
                  stroke="#ffd43b"
                  strokeWidth={0.28}
                  opacity={0}
                />
              )}
              <circle r={dot} fill={k2.jersey} stroke={k2.trim} strokeWidth={0.18} />
              <text y={dot * 0.37} textAnchor="middle" fontSize={dot * 1.05} fontWeight={700} fill={k2.ink}>
                {record.jerseys[id] ?? ''}
              </text>
            </g>
          );
        })}
        <g ref={spotterRef} opacity={0}>
          <Official r={dot * 0.85} />
        </g>
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
