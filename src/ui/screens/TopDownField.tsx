/**
 * All-22: the play from above, every player a numbered dot. The play is staged once (`stagePlay`) and played back
 * here, writing each dot's spot straight to the SVG each frame (no React state per frame), as `Field` does.
 * Spec: docs/superpowers/specs/2026-10-31-all-22-view-design.md §4.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { FieldRecord, FieldUnits, Game, League, PlayLogEntry, Team } from '../../engine/types';
import { kitFor } from '../color';
import { PlayerLink } from '../components';
import { FIELD_W, MID, offenseSide, snapYFor } from '../stage/ballPath';
import { cameraCenter, cameraSpan, easeCamera, layoutFor, type Layout } from '../stage/camera';
import { exitFor, flagCall, hurtOnField, injuryBanner, injuryCall, type Exit } from '../stage/calls';
import { finaleBanner, finaleKind, finaleScene, type FinaleScene } from '../stage/finale';
import { injuryScene } from '../stage/injury';
import { conference, CREW, crewSpots, crewTrack, flagThrow, flagAt as flagIn, UMPIRE } from '../stage/officials';
import { asRan, stagePlay, type StagedPlay } from '../stage/stage';
import { celebrates, transition, type Huddle, type Mark } from '../stage/transition';
import { FieldPaint } from './FieldPaint';
import { downLines } from './GameViewer';

/** A dot's radius in yards: bigger sideways, where the whole field shares the width. */
const DOT: Record<Layout, number> = { wide: 1.3, upright: 0.95 };
/** Taps land within this many yards of a dot. */
const REACH = 2.5;
/** The umpire after the ball: running to it, and walking it to its spot (yards a second). */
const UMP_RUN = 6;
const UMP_CARRY = 5;
/** Past this far (yards) from its next spot, a dead ball stays where it is and a fresh one comes in from the sideline. */
const FRESH_BALL = 20;
/** How far through a play a flag comes out (a flag before the snap comes out at once). */
const FLAG_AT = 0.4;
/** A play a flag was thrown on: accepted, declined or offsetting (a flag before the snap is its own play, `penalty`). */
const FLAGGED = /PENALTY|declined|Offsetting/;
/** Fouls called at the line (the flag lands there): before the snap, or by the blockers. */
const AT_LINE = /False start|Offside|Encroachment|Neutral zone|holding|formation|Delay of game/i;
/** After a flag: the officials confer and the call goes up, before the walk-off (seconds). */
const BREAK = 2.6;

/** Field (x, y) to the picture: sideways like the broadcast view, or upright with the offense attacking up. */
interface View {
  layout: Layout;
  dir: 1 | -1;
  /** The upright window's centre yard line. */
  cx: number;
  span: number;
  /**
   * The upright field's turn: 0 with the home side's offense attacking up, π with the away side's. When the ball
   * changes hands it flips behind a quick dip to dark, like a camera cut.
   */
  phi: number;
}
function toScreen(v: View, x: number, y: number): [number, number] {
  if (v.layout === 'wide') return [100 - x, FIELD_W - y];
  const c = Math.cos(v.phi);
  const s = Math.sin(v.phi);
  return [c * (y - MID) + s * (x - v.cx), s * (y - MID) - c * (x - v.cx)];
}
function viewBox(v: View): string {
  // Wide enough to take in the benches: a man coming on is seen on his sideline before he runs on.
  return v.layout === 'wide' ? '-12 -4.5 124 62.3' : `${-MID - 4.5} ${-v.span / 2} ${FIELD_W + 9} ${v.span}`;
}
/** The field group's transform: the same mapping as `toScreen`, as an SVG matrix. */
function fieldTransform(v: View): string {
  if (v.layout === 'wide') return `matrix(-1 0 0 -1 100 ${FIELD_W})`;
  const c = Math.cos(v.phi);
  const s = Math.sin(v.phi);
  const f = (n: number) => n.toFixed(4);
  return `matrix(${f(s)} ${f(-c)} ${f(c)} ${f(s)} ${f(-c * MID - s * v.cx)} ${f(-s * MID + c * v.cx)})`;
}
/** The upright field's turn for an offense attacking toward x = 100 (1) or x = 0 (-1). */
const turnFor = (dir: 1 | -1) => (dir === 1 ? 0 : Math.PI);
/** The cut when the field flips with the ball: seconds to dark, and back. */
const DIP = 0.25;

/**
 * Whether the ball changed hands on the way to the play at `index` (not counting a kick, which has its own
 * change-over), and how: the words on the banner while the units change over.
 */
export function handoverFor(plays: readonly PlayLogEntry[], index: number, homeId: number): string | null {
  const e = plays[index];
  if (!e?.kind || e.kind === 'kickoff') return null;
  let prev: PlayLogEntry | undefined;
  for (let i = index - 1; i >= 0 && !prev; i--) if (plays[i].kind) prev = plays[i];
  if (!prev || prev.kind === 'kickoff' || prev.kind === 'punt') return null;
  if (offenseSide(prev, homeId) === offenseSide(e, homeId)) return null;
  if (prev.kind === 'int') return 'Interception';
  if (/FUMBLE/.test(prev.text)) return 'Fumble';
  if (prev.kind === 'fg') return 'Missed field goal';
  if (prev.down === 4) return 'Turnover on downs';
  return 'Change of possession';
}

/** Every man a side put on the field in the game (its units and every change to them). */
function squad(record: FieldRecord, side: 0 | 1): number[] {
  const ids = new Set<number>();
  const add = (u: FieldUnits) => {
    for (const id of [u.qb, u.rb, u.rb2, u.k, u.p, u.kr, u.pr]) if (id !== undefined) ids.add(id);
    for (const list of [u.ol, u.wr, u.te, u.dt, u.edge, u.lb, u.cb, u.s, u.st, u.fg])
      for (const id of list) ids.add(id);
    for (const [id] of u.rot) ids.add(id);
  };
  add(record.units[side]);
  for (const [, s, u] of record.changes) if (s === side) add(u);
  return [...ids];
}

/** A trainer: white, with the medical staff's red cross. */
function Trainer({ r }: { r: number }) {
  return (
    <>
      <circle r={r} fill="#fff" stroke="#c62828" strokeWidth={0.15} />
      <rect x={-r * 0.18} y={-r * 0.6} width={r * 0.36} height={r * 1.2} fill="#d32f2f" />
      <rect x={-r * 0.6} y={-r * 0.18} width={r * 1.2} height={r * 0.36} fill="#d32f2f" />
    </>
  );
}

/** The medical cart: a white cart with the red cross. */
function Cart({ r }: { r: number }) {
  return (
    <>
      <rect
        x={-r * 1.5}
        y={-r}
        width={r * 3}
        height={r * 2}
        rx={r * 0.35}
        fill="#fafafa"
        stroke="#555"
        strokeWidth={0.15}
      />
      <rect x={-r * 0.2} y={-r * 0.65} width={r * 0.4} height={r * 1.3} fill="#d32f2f" />
      <rect x={-r * 0.65} y={-r * 0.2} width={r * 1.3} height={r * 0.4} fill="#d32f2f" />
    </>
  );
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
  // An injury stoppage has had its moment on the field; a flag gets the time to read the call.
  if (injuryCall(e)) return 900;
  if (flagCall(e)) return 1400;
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
  /** The game this memory is of: another game starts fresh. */
  game: number;
  /** Where each man on the field was last drawn, and which kit he wears. */
  spots: Map<number, Mark>;
  ballX: number | null;
  ballY: number;
  cx: number;
  /** The upright field's turn as last drawn. */
  phi: number | null;
  /** Where the officials last stood. */
  crew: { x: number; y: number }[] | null;
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
  final = false,
  fallback,
  onDone,
  onSnap,
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
  /** The game's last play: the final whistle follows it (the celebration, the handshakes, the walk off). */
  final?: boolean;
  /** Shown if a play can't be staged: the broadcast field. */
  fallback?: ReactNode;
  onDone: () => void;
  /** The ball is snapped (the jog and huddle are over): the viewer clears the last play's result then. */
  onSnap?: () => void;
}) {
  const entry = plays[index];
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const fieldRef = useRef<SVGGElement>(null);
  const dotRefs = useRef(new Map<number, SVGGElement>());
  const ringRefs = useRef(new Map<number, SVGCircleElement>());
  const officialRefs = useRef<(SVGGElement | null)[]>([]);
  const bannerRef = useRef<HTMLDivElement>(null);
  const callRef = useRef<HTMLDivElement>(null);
  const trainerRefs = useRef<(SVGGElement | null)[]>([]);
  const cartRef = useRef<SVGGElement>(null);
  const extraRefs = useRef(new Map<number, SVGGElement>());
  const confettiRefs = useRef<(SVGRectElement | null)[]>([]);
  const finaleRef = useRef<HTMLDivElement>(null);
  const hurtRingRef = useRef<SVGCircleElement>(null);
  const flagRef = useRef<SVGGElement>(null);
  const ballRef = useRef<SVGEllipseElement>(null);
  const oldBallRef = useRef<SVGEllipseElement>(null);
  const shadowRef = useRef<SVGEllipseElement>(null);
  const fresh = (): Memory => ({
    game: game.id,
    spots: new Map(),
    ballX: null,
    ballY: MID,
    cx: 50,
    phi: null,
    crew: null,
    ended: null,
  });
  const memory = useRef<Memory>(fresh());
  // Another game in the same viewer: nothing carries over from the last one (its men would linger, numberless).
  if (memory.current.game !== game.id) memory.current = fresh();
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  const snapRef = useRef(onSnap);
  snapRef.current = onSnap;
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
  /** The play as it ran: a snap a flag wiped out still huddled and ran like any other. */
  const ran = entry ? asRan(entry) : undefined;
  const huddleFor = (s: StagedPlay): Huddle | undefined => {
    if (!ran?.kind || !HUDDLED.has(ran.kind)) return undefined;
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
  const handover = handoverFor(plays, index, home.id);
  /** The first snap after a kick: the kick units go off and the offense and defense come on. */
  const afterKick =
    !!entry?.kind &&
    entry.kind !== 'kickoff' &&
    ['kickoff', 'punt'].includes([...plays.slice(0, index)].reverse().find((p) => !!p.kind)?.kind ?? '');
  const span = cameraSpan(entry);
  const lines = downLines(entry, home.id);
  // The calls on the banner: a flag on this play, or a man hurt on the last one (who, from the men on the field).
  const flag = entry ? flagCall(entry) : null;
  const hurtCall = entry && !entry.kind ? injuryCall(entry) : null;
  const hurtId = hurtCall
    ? hurtOnField(league, memory.current.spots, hurtCall, { home: home.abbrev, away: away.abbrev })
    : undefined;
  const exit: Exit | null =
    hurtCall && hurtId !== undefined ? exitFor(league, hurtId, hurtCall.label, game.result?.injuries) : null;
  // The flag's yellow bar says it's a flag; an injury says so in words.
  const callText = flag ?? (hurtCall ? `Injury · ${injuryBanner(hurtCall, exit ?? 'walk')}` : null);
  /** A flag before the snap (a false start, an offside the play never ran with): out at once. Interference, as the
   * ball arrives; anything else partway through. */
  const preSnap = entry?.kind === 'penalty' && !entry.ran;
  const flagged = !!entry && (entry.kind === 'penalty' || FLAGGED.test(entry.text));
  const flagFrac = preSnap ? 0.05 : entry && /interference/i.test(entry.text) ? 0.8 : FLAG_AT;
  /** The crew for this snap: where each official stands, how he moves with the play, and the flag one throws. */
  const crewPlan = useMemo(() => {
    if (!staged || !entry) return null;
    const e = asRan(entry);
    const land = e.kind === 'punt' && e.air !== undefined ? { x: e.air, y: staged.ball[1] } : undefined;
    const start = crewSpots(e, staged.ball[0], staged.ball[1], dir, land);
    const track = crewTrack(start, staged.ball, staged.steps, staged.dt, dir);
    const playTime = (staged.steps - 1) * staged.dt;
    const thrown = flagged
      ? flagThrow(track, staged.ball, staged.steps, staged.dt, flagFrac * playTime, preSnap || AT_LINE.test(entry.text))
      : null;
    return { start, track, thrown };
    // Staged once per play shown, like the play itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [staged]);
  // The final whistle: who won, how, and the winners' men off the field who run on to celebrate.
  const ending = final && entry && record && staged ? finaleKind(plays, index) : null;
  const winnersHome = !ending || ending === 'tie' ? null : entry.homeScore > entry.awayScore;
  const winners = winnersHome === null ? null : winnersHome ? home : away;
  const sideline =
    winnersHome === null || !record || !staged
      ? []
      : squad(record, winnersHome ? 0 : 1)
          .filter((id) => !staged.ids.includes(id))
          .slice(0, 20);
  const finaleText = ending
    ? finaleBanner({
        kind: ending,
        winner: winners?.abbrev,
        score: `${away.abbrev} ${entry.awayScore} – ${home.abbrev} ${entry.homeScore}`,
        how: entry.kind === 'fg' ? 'field goal' : /TOUCHDOWN/.test(entry.text) ? 'touchdown' : undefined,
        playoff: !!game.playoffRound,
        title: game.playoffRound === 'FINAL',
      })
    : null;

  useEffect(() => {
    if (!staged || !svg.current) return;
    const s = staged;
    const n = s.ids.length;
    const last = s.steps - 1;
    const mem = memory.current;
    // The field turns with the ball: from where it was drawn last, through the change-over (none on a jump).
    const turnTo = turnFor(dir);
    const turnFrom = mem.phi ?? turnTo;
    const view: View = { layout, dir, cx: mem.cx, span, phi: turnTo };
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
            // Before a kickoff, and when the ball changes hands: the units change over at their sidelines.
            change: entry?.kind === 'kickoff' || !!handover || afterKick,
          })
        : null;
    const ballFrom = mem.ballX === null || !following ? null : { x: mem.ballX, y: mem.ballY };
    /** The last play's ball is in the net behind the posts (a field goal or an extra point, good or not). */
    const lastKind = index > 0 ? asRan(plays[index - 1]).kind : undefined;
    const deadBall = lastKind === 'fg' || lastKind === 'xp';
    /** A key man's ring, only once his moment is about to come (`t` seconds from the snap): nothing gives the play away. */
    const rings = (t: number) =>
      s.keys.forEach((id, i) => ringRefs.current.get(id)?.setAttribute('opacity', t >= s.reveal[i] ? '1' : '0'));

    const camera = (ballX: number, seconds: number) => {
      if (layout !== 'upright') return;
      view.cx = easeCamera(view.cx, cameraCenter(ballX, dir, span), seconds);
      fieldRef.current?.setAttribute('transform', fieldTransform(view));
      svg.current?.setAttribute('viewBox', viewBox(view));
    };
    const drawDot = (id: number, x: number, y: number, opacity = 1, scale = 1, el = dotRefs.current.get(id)) => {
      if (!el) return;
      const [sx, sy] = toScreen(view, x, y);
      el.setAttribute(
        'transform',
        `translate(${sx.toFixed(2)} ${sy.toFixed(2)})${scale !== 1 ? ` scale(${scale.toFixed(2)})` : ''}`,
      );
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

    /** A figure drawn at a field spot (an official, a trainer, the cart), or hidden. */
    const figure = (el: Element | null | undefined, f: { x: number; y: number; opacity: number } | null) => {
      if (!el) return;
      if (!f) return el.setAttribute('opacity', '0');
      const [sx, sy] = toScreen(view, f.x, f.y);
      el.setAttribute('transform', `translate(${sx.toFixed(2)} ${sy.toFixed(2)})`);
      el.setAttribute('opacity', f.opacity.toFixed(2));
    };
    const plan = crewPlan!;
    const crewAt = (step: number) =>
      CREW.map((_, k) => ({
        x: plan.track[(step * CREW.length + k) * 2],
        y: plan.track[(step * CREW.length + k) * 2 + 1],
      }));
    const drawCrew = (spots: readonly { x: number; y: number }[]) =>
      spots.forEach((p, k) => figure(officialRefs.current[k], { ...p, opacity: 1 }));
    /** The flag: in the air with its height, on the ground, or not out. */
    const drawFlag = (f: { x: number; y: number; h: number } | null) => {
      const el = flagRef.current;
      if (!el) return;
      if (!f) return el.setAttribute('opacity', '0');
      const [sx, sy] = toScreen(view, f.x, f.y);
      el.setAttribute(
        'transform',
        `translate(${sx.toFixed(2)} ${(sy - f.h * 0.3).toFixed(2)}) scale(${(1 + f.h / 5).toFixed(2)})`,
      );
      el.setAttribute('opacity', '1');
    };
    const crewFrom = mem.crew ?? plan.start;

    /** The jog between plays, `t` seconds in. */
    const jog = (t: number, seconds: number) => {
      const g = gap!;
      // The ball's changed hands: the picture dips to dark and comes back the other way round (a camera cut, not a
      // spin), once the moment's been had and before the units change over.
      if (turnFrom !== turnTo) {
        const cut = g.beat + g.celebrate + 0.2 + DIP;
        view.phi = t < cut ? turnFrom : turnTo;
        const dark = Math.max(0, 1 - Math.abs(t - cut) / DIP);
        svg.current?.style.setProperty('opacity', (1 - dark).toFixed(2));
      } else view.phi = turnTo;
      // The banner when the ball has changed hands: up after the whistle, gone before the formation sets.
      const shown = t > g.beat && t < g.duration - 1.2 ? 1 : 0;
      bannerRef.current?.style.setProperty('opacity', String(shown));
      rings(-1);
      drawFlag(null);
      callRef.current?.style.setProperty('opacity', '0');
      for (const m of g.moves) {
        const p = g.at(m, t);
        drawDot(m.id, p.x, p.y, p.opacity);
        if (!m.leave) mem.spots.set(m.id, { x: p.x, y: p.y, home: m.home });
      }
      // The ball between plays. Close by, the umpire runs to it where it died, picks it up and walks it to its spot.
      // A long way off (a kick in the net behind the posts, a touchback, anything past 20 yards), that ball stays
      // where it is and fades, and he collects a fresh one from the sideline level with the spot and brings it in.
      const tb = Math.max(0, t - g.beat);
      const spot = { x: s.ball[0], y: s.ball[1] };
      const umpFrom = crewFrom[UMPIRE] ?? plan.start[UMPIRE];
      const fresh = !ballFrom || deadBall || Math.hypot(spot.x - ballFrom.x, spot.y - ballFrom.y) > FRESH_BALL;
      const pick = fresh ? { x: spot.x, y: spot.y < MID ? -0.8 : FIELD_W + 0.8 } : ballFrom!;
      let fetch = Math.hypot(pick.x - umpFrom.x, pick.y - umpFrom.y) / UMP_RUN;
      let carry = Math.hypot(spot.x - pick.x, spot.y - pick.y) / UMP_CARRY;
      // He gets it there before the formation sets, hurrying if he has to.
      const room = Math.max(1, g.duration - g.beat - 1.2);
      if (fetch + carry > room) {
        const k = room / (fetch + carry);
        fetch *= k;
        carry *= k;
      }
      const carried = Math.min(1, Math.max(0, (tb - fetch) / Math.max(0.2, carry)));
      const ball =
        tb < fetch ? pick : { x: pick.x + (spot.x - pick.x) * carried, y: pick.y + (spot.y - pick.y) * carried };
      // The new ball shows once it's in his hands; the old one lies where it died, fading.
      if (fresh && tb < fetch) {
        ballRef.current?.setAttribute('opacity', '0');
        shadowRef.current?.setAttribute('opacity', '0');
      } else {
        ballRef.current?.setAttribute('opacity', '1');
        drawBall(ball.x, ball.y, 0);
      }
      if (fresh && ballFrom) {
        const [ox, oy] = toScreen(view, ballFrom.x, ballFrom.y);
        oldBallRef.current?.setAttribute('transform', `translate(${ox.toFixed(2)} ${oy.toFixed(2)})`);
        oldBallRef.current?.setAttribute('opacity', Math.max(0, 1 - Math.max(0, tb - 0.4) / 1.2).toFixed(2));
      } else oldBallRef.current?.setAttribute('opacity', '0');
      camera(tb < fetch && fresh ? spot.x : ball.x, seconds);
      // The crew walks to its spots for the next snap; the umpire fetches the ball, brings it, then takes his.
      const walkTime = Math.max(1, g.duration - g.beat - 0.8);
      const kWalk = Math.min(1, Math.max(0, tb / walkTime));
      const ease = kWalk * kWalk * (3 - 2 * kWalk);
      const hand = { x: -dir * 0.6, y: (spot.y > MID ? 1 : -1) * 0.9 };
      plan.start.forEach((to, i) => {
        const from = crewFrom[i] ?? to;
        let p = { x: from.x + (to.x - from.x) * ease, y: from.y + (to.y - from.y) * ease };
        if (i === UMPIRE) {
          const at = { x: pick.x + hand.x, y: pick.y + hand.y };
          if (tb < fetch) {
            // To the ball (or the sideline for a fresh one) at a run.
            const k = fetch > 0 ? tb / fetch : 1;
            const e = k * k * (3 - 2 * k);
            p = { x: from.x + (at.x - from.x) * e, y: from.y + (at.y - from.y) * e };
          } else if (tb < fetch + carry) p = { x: ball.x + hand.x, y: ball.y + hand.y };
          else {
            const left = Math.max(0.6, walkTime - fetch - carry);
            const k = Math.min(1, (tb - fetch - carry) / left);
            const set = { x: spot.x + hand.x, y: spot.y + hand.y };
            p = { x: set.x + (to.x - set.x) * k, y: set.y + (to.y - set.y) * k };
          }
        }
        figure(officialRefs.current[i], { ...p, opacity: 1 });
      });
    };

    /** The play itself, at `step`. */
    const place = (step: number, seconds: number) => {
      view.phi = turnTo;
      svg.current?.style.setProperty('opacity', '1');
      camera(s.ball[step * 3], seconds);
      rings(step === last ? Infinity : step * s.dt);
      bannerRef.current?.style.setProperty('opacity', '0');
      // The crew with the play; the flag, thrown by the official nearest the foul; the call once it's over.
      drawCrew(crewAt(step));
      drawFlag(plan.thrown ? flagIn(plan.thrown, step * s.dt) : null);
      callRef.current?.style.setProperty('opacity', step === last ? '1' : '0');
      if (step === last) mem.crew = crewAt(last);
      for (let k = 0; k < n; k++) {
        const x = s.pos[(step * n + k) * 2];
        const y = s.pos[(step * n + k) * 2 + 1];
        drawDot(s.ids[k], x, y);
        mem.spots.set(s.ids[k], { x, y, home: s.home[k] });
      }
      ballRef.current?.setAttribute('opacity', '1');
      oldBallRef.current?.setAttribute('opacity', '0');
      drawBall(s.ball[step * 3], s.ball[step * 3 + 1], s.ball[step * 3 + 2]);
      mem.cx = view.cx;
      mem.phi = turnTo;
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
    /** The men who came off are gone once the play starts, and so is anyone drawn for a play no longer shown. */
    const clearBench = () => {
      for (const id of [...mem.spots.keys()]) if (!s.ids.includes(id)) mem.spots.delete(id);
      for (const id of dotRefs.current.keys()) if (!s.ids.includes(id)) drawDot(id, 0, -20, 0);
    };

    /** The final whistle, `t` seconds after it: the celebration (or the handshakes), the walk off, the confetti. */
    let scene: FinaleScene | null = null;
    const finaleFrame = (t: number, seconds: number): boolean => {
      if (!ending) return true;
      if (!scene) {
        const kicker = s.ids.find((_, k) => s.offense[k] && s.roles[k] === 'K');
        scene = finaleScene({
          kind: ending,
          spots: new Map(mem.spots),
          winnersHome,
          // Where it ended: the carrier's spot; for a kick at the posts, where it was kicked from (the ball's own end
          // is beyond the uprights).
          at:
            ran?.kind === 'fg' || ran?.kind === 'xp'
              ? { x: s.ball[0], y: s.ball[1] }
              : { x: s.ball[last * 3], y: s.ball[last * 3 + 1] },
          hero: ending === 'walkoff' ? (s.carrier ?? kicker) : undefined,
          sideline,
          playoff: !!game.playoffRound,
          title: game.playoffRound === 'FINAL',
          colors: winners ? [winners.colors[0], winners.colors[1]] : [],
          seed: `${league.seed}:${game.id}:final`,
        });
      }
      finaleRef.current?.style.setProperty('opacity', t > 0.6 ? '1' : '0');
      callRef.current?.style.setProperty('opacity', '0');
      let sx = 0;
      let n2 = 0;
      for (const id of mem.spots.keys()) {
        const f = scene.at(id, t);
        if (!f) continue;
        drawDot(id, f.x, f.y, f.opacity, f.scale);
        // Remembered as it goes: when the viewer re-renders at the end, nobody snaps back to where the play ended.
        mem.spots.set(id, { x: f.x, y: f.y, home: mem.spots.get(id)!.home });
        if (f.opacity > 0.5 && winnersHome !== null && mem.spots.get(id)!.home === winnersHome) {
          sx += f.x;
          n2++;
        }
      }
      for (const id of sideline) {
        const f = scene.at(id, t);
        if (f) drawDot(id, f.x, f.y, f.opacity, f.scale, extraRefs.current.get(id));
      }
      scene.confetti(t).forEach((c, i) => {
        const el = confettiRefs.current[i];
        if (!el) return;
        const [cx, cy] = toScreen(view, c.x, c.y);
        el.setAttribute('x', (cx - 0.25).toFixed(2));
        el.setAttribute('y', (cy - c.h * 0.3 - 0.15).toFixed(2));
        el.setAttribute('fill', c.color);
        el.setAttribute('opacity', '1');
      });
      if (n2) camera(sx / n2, seconds);
      mem.cx = view.cx;
      return t >= scene.duration;
    };

    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    // A man hurt on the last play: the stoppage on the field, from where that play left everyone.
    if (hurtId !== undefined && exit && following && !still && !reduced && mem.spots.has(hurtId)) {
      const scene = injuryScene(mem.spots, hurtId, exit, `${league.seed}:${game.id}:hurt:${index}`);
      const others = [...mem.spots.keys()].filter((id) => id !== hurtId);
      // Men in this entry's cast who weren't on the field for the last play stay out of sight until the next snap.
      for (const id of s.ids) if (!mem.spots.has(id)) drawDot(id, 0, -20, 0);
      const ball = { x: mem.ballX ?? s.ball[0], y: mem.ballY };
      drawFlag(null);
      let raf = 0;
      let t0 = 0;
      let prev = 0;
      const tick = (now: number) => {
        if (!t0) t0 = prev = now;
        const t = ((now - t0) / 1000) * speed;
        const frame = ((now - prev) / 1000) * speed;
        prev = now;
        view.phi = mem.phi ?? turnTo;
        const h = scene.hurt(Math.min(t, scene.duration));
        camera(h.opacity > 0.05 ? h.x : ball.x, frame);
        callRef.current?.style.setProperty('opacity', t > 0.4 ? '1' : '0');
        for (const id of others) {
          const p = scene.at(id, t);
          if (p) drawDot(id, p.x, p.y, p.opacity);
        }
        drawDot(hurtId, h.x, h.y, h.opacity);
        // A red ring round the man down until he's up and off.
        const ring = hurtRingRef.current;
        if (ring) {
          const [rx, ry] = toScreen(view, h.x, h.y);
          ring.setAttribute('cx', rx.toFixed(2));
          ring.setAttribute('cy', ry.toFixed(2));
          ring.setAttribute('opacity', (h.opacity > 0.5 ? h.opacity : 0).toFixed(2));
        }
        scene.trainers(t).forEach((f, i) => figure(trainerRefs.current[i], f));
        figure(cartRef.current, scene.cart(t));
        drawBall(ball.x, ball.y, 0);
        // The officials hold where they were while the trainers work.
        drawCrew(crewFrom);
        if (t >= scene.duration) {
          // Everyone where the stoppage left him; the man hurt is gone, and the next snap's jog starts from here.
          mem.spots = new Map(scene.after);
          mem.cx = view.cx;
          mem.ended = { index, at: null };
          drawDot(hurtId, 0, -20, 0);
          hurtRingRef.current?.setAttribute('opacity', '0');
          doneRef.current();
          return;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(raf);
    }
    if (still || reduced) {
      // Nothing moves, so the window jumps straight to where the play ended.
      clearBench();
      place(last, Infinity);
      if (plan.thrown) drawFlag({ ...plan.thrown.to, h: 0 });
      if (ending && !reduced) {
        // A skipped batch that lands on the last play still gets its final whistle.
        let raf = 0;
        let t0 = 0;
        let prev = 0;
        const tick = (now: number) => {
          if (!t0) t0 = prev = now;
          const frame = ((now - prev) / 1000) * speed;
          prev = now;
          if (finaleFrame(((now - t0) / 1000) * speed, frame)) return doneRef.current();
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(raf);
      }
      const t = setTimeout(() => doneRef.current(), 450 / speed);
      return () => clearTimeout(t);
    }
    let raf = 0;
    let t0 = 0;
    let prev = 0;
    // Starting set: the last play's men are gone at once.
    let cleared = !gap;
    let stopped = false;
    let snappedYet = false;
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
        if (!snappedYet) {
          snappedYet = true;
          snapRef.current?.();
        }
        place(Math.min(last, Math.floor((t - pre) / s.dt)), frame);
      } else if (plan.thrown && t - pre - playTime < BREAK) {
        // The break after a flag: play stopped, the crew comes together round it, and the call goes up.
        if (!stopped) {
          clearBench();
          place(last, frame);
          stopped = true;
        }
        const k = Math.min(1, (t - pre - playTime) / (BREAK * 0.6));
        const e2 = k * k * (3 - 2 * k);
        const end = crewAt(last);
        const huddle = conference(end, plan.thrown.to);
        const now = end.map((p, i) => ({ x: p.x + (huddle[i].x - p.x) * e2, y: p.y + (huddle[i].y - p.y) * e2 }));
        drawCrew(now);
        mem.crew = now;
        camera(plan.thrown.to.x, frame);
      } else if (ending) {
        if (!stopped) {
          clearBench();
          place(last, frame);
          stopped = true;
        }
        if (finaleFrame(t - pre - playTime - (plan.thrown ? BREAK : 0), frame)) {
          doneRef.current();
          return;
        }
      } else {
        if (!stopped) {
          clearBench();
          place(last, frame);
        }
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

  const view: View = { layout, dir, cx: memory.current.cx, span, phi: memory.current.phi ?? turnFor(dir) };
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
          <FieldPaint home={home} away={away} />
          {lines && losLine(lines.los, '#5aa9ff')}
          {lines && losLine(lines.gain, '#ffd43b')}
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
        {/* The winners' men off the field, who run on at the final whistle. */}
        {sideline.map((id) => {
          const k2 = winnersHome ? homeKit : awayKit;
          return (
            <g
              key={`side:${id}`}
              className="dot"
              ref={(el) => {
                if (el) extraRefs.current.set(id, el);
                else extraRefs.current.delete(id);
              }}
              opacity={0}
            >
              <circle r={dot} fill={k2.jersey} stroke={k2.trim} strokeWidth={0.18} />
              <text y={dot * 0.37} textAnchor="middle" fontSize={dot * 1.05} fontWeight={700} fill={k2.ink}>
                {record.jerseys[id] ?? ''}
              </text>
            </g>
          );
        })}
        {/* The crew, drawn under the ball; the flag on top of everything once it's thrown. */}
        {CREW.map((role, i) => (
          <g
            key={role}
            ref={(el) => {
              officialRefs.current[i] = el;
            }}
            opacity={0}
          >
            <Official r={dot * 0.82} />
          </g>
        ))}
        {hurtCall && (
          <>
            <circle ref={hurtRingRef} r={dot + 0.55} fill="none" stroke="#e53935" strokeWidth={0.3} opacity={0} />
            {[0, 1].map((i) => (
              <g
                key={i}
                ref={(el) => {
                  trainerRefs.current[i] = el;
                }}
                opacity={0}
              >
                <Trainer r={dot * 0.85} />
              </g>
            ))}
            <g ref={cartRef} opacity={0}>
              <Cart r={dot} />
            </g>
          </>
        )}
        <ellipse ref={shadowRef} rx={0.55} ry={0.32} fill="rgba(0,0,0,0.45)" />
        {/* A dead ball left where it lay (in the net behind the posts) while a fresh one comes in. */}
        <ellipse ref={oldBallRef} rx={0.55} ry={0.34} fill="#7a3f1d" stroke="#fff" strokeWidth={0.1} opacity={0} />
        <ellipse ref={ballRef} rx={0.55} ry={0.34} fill="#7a3f1d" stroke="#fff" strokeWidth={0.1} />
        {ending && game.playoffRound === 'FINAL' && winnersHome !== null && (
          <g>
            {Array.from({ length: 140 }, (_, i) => (
              <rect
                key={i}
                ref={(el) => {
                  confettiRefs.current[i] = el;
                }}
                width={0.5}
                height={0.3}
                opacity={0}
              />
            ))}
          </g>
        )}
        {flagged && (
          <g ref={flagRef} opacity={0}>
            <rect
              x={-0.6}
              y={-0.42}
              width={1.2}
              height={0.84}
              rx={0.15}
              fill="#ffd400"
              stroke="#7a5d00"
              strokeWidth={0.1}
            />
          </g>
        )}
      </svg>
      {finaleText && (
        <div
          ref={finaleRef}
          key={`final:${index}`}
          className="td-call td-call-final"
          style={{ opacity: 0 }}
          aria-live="polite"
        >
          {finaleText}
        </div>
      )}
      {callText && (
        <div
          // A new element for each play: the last play's call never carries over, shown, onto this one.
          key={index}
          ref={callRef}
          className={`td-call ${hurtCall ? 'td-call-injury' : 'td-call-flag'}`}
          style={{ opacity: 0 }}
          aria-live="polite"
        >
          {callText}
        </div>
      )}
      {handover && (
        <div ref={bannerRef} className="td-banner" style={{ opacity: 0 }} aria-live="polite">
          {handover} · {(entry.offense === home.id ? home : away).abbrev} ball
        </div>
      )}
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
