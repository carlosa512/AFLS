/**
 * One play, staged for All-22: who's on the field, where they line up, the ball's path, the scripted players and the
 * steered rest, as tracks of every dot at 20 steps a second. Pure and seeded: the same play stages the same way.
 * Spec: docs/superpowers/specs/2026-10-31-all-22-view-design.md §3.
 */
import { actorsIn, defenseCallAt } from '../../engine/playActors';
import { Rng } from '../../engine/rng';
import type { FieldRecord, PlayLogEntry } from '../../engine/types';
import { FIELD_W, MID, offenseSide } from './ballPath';
import type { Role } from './cast';
import { castFor } from './cast';
import { blitzersFor, lineUp } from './formations';
import { ballTrack, script, stagedPath } from './scripts';
import { SPEED, steer } from './steer';
import type { Pt } from './formations';
import { COVERAGES } from '../../engine/schemes';

export const STEP = 0.05;
/** Plays where the quarterback has the ball first, and the ones where he drops back to throw. */
const HOLDERS: ReadonlySet<string> = new Set(['run', 'pass', 'incomplete', 'int', 'sack', 'scramble']);
const DROPBACKS: ReadonlySet<string> = new Set(['pass', 'incomplete', 'int', 'sack', 'scramble']);
/** A play with no path (a timeout): the line-up, held this long. */
const STILL = 0.5;
/** A flag before the snap: the line-up held long enough to see who moved (`fouls.ts`). */
const PRE_SNAP = 1.6;
/** A key man's ring shows this long before his moment. */
const REVEAL_LEAD = 0.4;

export interface StagedPlay {
  /** Seconds a step. */
  dt: number;
  steps: number;
  /** Offense first, then defense. */
  ids: number[];
  /** Per id: on the side with the ball (the kicking side on a kick). */
  offense: boolean[];
  /** Per id: wears the home kit. */
  home: boolean[];
  /** steps × ids × (x, y), in field yards. */
  pos: Float32Array;
  /** steps × (x, y, h). */
  ball: Float32Array;
  /** The players the play was about: ringed and drawn on top. */
  keys: number[];
  /** Per key: seconds from the snap when his ring shows, just before his moment, so the ring never gives the play away. */
  reveal: number[];
  /** Per key: when his part is over and the ring goes (Infinity: it stays). */
  until: number[];
  /** Who has the ball at the whistle. */
  carrier: number | null;
  /** Per id: the spot he lined up at (QB, OL, WR...). */
  roles: Role[];
  /** Which way the offense (the kicking team on a kick) is going. */
  dir: 1 | -1;
  /** The play as staged ('penalty': a flag before the snap, held). */
  kind: PlayLogEntry['kind'];
  /** When the ball leaves the quarterback or the kicker (the handoff, the throw, the kick), from the snap. */
  release: number;
  /** When a pass or a kick comes down (null for anything else). */
  arrive: number | null;
  /**
   * A man in motion before the snap: he sets at `from` and moves to his spot over the last `dur` seconds before it
   * (`across`: from the far side of the formation, behind the line). Presentation only: the engine has no motion.
   */
  motion?: { id: number; from: Pt; dur: number; across: boolean };
}

/** The play as it ran: a flagged snap's own path (`PlayLogEntry.ran`), else the entry itself. */
export function asRan(e: PlayLogEntry): PlayLogEntry {
  return e.kind === 'penalty' && e.ran?.kind ? { ...e, ...e.ran } : e;
}

export function stagePlay(args: {
  plays: readonly PlayLogEntry[];
  index: number;
  record: FieldRecord;
  homeId: number;
  seed: string;
  /** Where the ball is snapped across the field (`snapYFor`). */
  snapY: number;
}): StagedPlay {
  const { record, homeId } = args;
  const index = args.index;
  // A snap a flag wiped out is staged as it ran (the walk-off is the official's, between plays); a punter roughed
  // before his punt was measured gets a punt to be roughed on.
  const ran = returned(asRan(args.plays[index]));
  const e = roughedPunt(ran, homeId) ?? ran;
  // The unit and the set it lines up in: a false start on a field goal try is the kick unit's.
  const look: PlayLogEntry = e.kind === 'penalty' && /^Field goal try\./.test(e.text) ? { ...e, kind: 'fg' } : e;
  const plays = look === args.plays[index] ? args.plays : Object.assign(args.plays.slice(), { [index]: look });
  const rng = new Rng(args.seed);
  const cast = castFor(record, plays, index, homeId);
  const dir: 1 | -1 = cast.offSide === 0 ? 1 : -1;
  // The line of scrimmage: a field goal is logged from the holder's spot, seven yards behind it.
  const logged = e.from ?? (cast.offSide === 0 ? e.yardLine : 100 - e.yardLine);
  const ballX = e.kind === 'fg' ? logged + dir * 7 : logged;
  const ballY = e.kind === 'kickoff' ? MID : args.snapY;
  const off = record.scheme[cast.offSide];
  const def = record.scheme[1 - cast.offSide];
  // The defense's call on the snap (run or pass defense, a blitz: the engine's own), and who a blitz sends.
  const call = defenseCallAt(record, index);
  const blitz = blitzersFor(e, cast, call, rng);
  const start = lineUp(look, cast, off, def, ballX, ballY, dir, rng, { call, blitz });
  const target = actorsIn(e).ball;
  const segs = stagedPath(e, homeId, args.snapY, target === undefined ? undefined : start.get(target));
  const { keys, carrier, tackler, pursuer, release, catchAt, moments, until, free } = script(e, cast, start, segs, dir);
  const flight = segs.find((sg) => sg.peak > 0);
  const kick = e.kind === 'kickoff' || e.kind === 'punt' ? e.kind : e.kind === 'fg' || e.kind === 'xp' ? 'fg' : null;
  const total = segs.reduce((t, s) => t + s.dur, 0) || (e.kind === 'penalty' ? PRE_SNAP : STILL);
  const steps = Math.ceil(total / STEP) + 1;
  let ball = ballTrack(segs, STEP);
  if (!segs.length) ball = new Float32Array(steps * 3).map((_, i) => (i % 3 === 0 ? ballX : i % 3 === 1 ? ballY : 0));
  // The track is one step short when the path's time lands exactly on a step: pad with its last spot.
  if (ball.length < steps * 3) {
    const padded = new Float32Array(steps * 3);
    padded.set(ball);
    for (let i = ball.length; i < padded.length; i++) padded[i] = padded[i - 3];
    ball = padded;
  }
  const qb = cast.offense.find((m) => m.role === 'QB')?.id ?? null;
  const pos = steer({
    cast,
    start,
    // The tackler runs the play down himself (`steer`), from the snap or once his own part is over (`free`); only
    // where he meets the carrier is scripted, below.
    scripted: pursuer === null || free.has(pursuer) ? keys : new Map([...keys].filter(([id]) => id !== pursuer)),
    free,
    ball,
    release,
    carrier,
    tackler,
    pursuer,
    holder: e.kind && HOLDERS.has(e.kind) ? qb : null,
    dropback: !!e.kind && DROPBACKS.has(e.kind),
    run: e.kind === 'run',
    // Man coverage behind a blitz, as the engine plays it.
    man: !!(def.coverage && COVERAGES[def.coverage].man) || call === 'blitz',
    coverage: def.coverage,
    call,
    blitz,
    hold: !segs.length,
    kick: segs.length ? kick : null,
    land: flight ? { x: flight.x1, y: flight.y1 } : null,
    catchAt: catchAt ?? Infinity,
    dir,
    dt: STEP,
    steps,
    rng,
  });
  const members = [...cast.offense, ...cast.defense];
  // No earlier than he may move: the ball down on a kick, the ball out on a snap.
  const earliest = Math.ceil(
    Math.max(
      kick ? (catchAt ?? 0) : Number.isFinite(release) ? release : 0,
      pursuer !== null ? (free.get(pursuer) ?? 0) : 0,
    ) / STEP,
  );
  if (pursuer !== null) {
    const k = members.findIndex((m) => m.id === pursuer);
    closeIn(pos, members.length, k, keys.get(pursuer)!, steps, earliest, {
      carrier: carrier === null ? -1 : members.findIndex((m) => m.id === carrier),
      top: SPEED[members[k].role] + 1,
    });
  }
  const homeSide = cast.offSide === 0;
  return {
    dt: STEP,
    steps,
    ids: members.map((m) => m.id),
    offense: members.map((_, k) => k < cast.offense.length),
    home: members.map((_, k) => k < cast.offense.length === homeSide),
    pos,
    ball: ball.subarray(0, steps * 3),
    // Featured: the men with a moment (a quarterback who only hands off is scripted, not featured).
    keys: [...moments.keys()],
    reveal: [...moments.values()].map((t) => Math.max(0, t - REVEAL_LEAD)),
    until: [...moments.keys()].map((id) => until.get(id) ?? Infinity),
    carrier,
    roles: members.map((m) => m.role),
    dir,
    kind: e.kind,
    release: Number.isFinite(release) ? release : total,
    ...motionFor(e, cast, start, off, ballY, carrier, args.seed),
    arrive:
      catchAt ??
      ((e.kind === 'pass' || e.kind === 'incomplete' || e.kind === 'int') && segs.length >= 3
        ? segs[0].dur + segs[1].dur + segs[2].dur
        : null),
  };
}

/**
 * A return a flag moved the ball after: staged to where the return ended ("returns to the NO 18"), not the spot the
 * walk-off put the ball (that's the official's, between plays). The log gives the yard line from one team's side;
 * of the two places that could be, the one nearer the walk-off spot.
 */
export function returned(e: PlayLogEntry): PlayLogEntry {
  if ((e.kind !== 'kickoff' && e.kind !== 'punt') || e.to === undefined) return e;
  const m = /returns to the \S+ (\d+)\. PENALTY/.exec(e.text);
  if (!m) return e;
  const n = Number(m[1]);
  const to = Math.abs(n - e.to) <= Math.abs(100 - n - e.to) ? n : 100 - n;
  return { ...e, to };
}

/** How often an offense sends a man in motion: most snaps out of two tight ends, fewer spread out, few in a hurry. */
const MOTION_RATE = { heavy: 0.45, base: 0.35, hurry: 0.1 };
const MOTION_KINDS: ReadonlySet<string> = new Set(['run', 'pass', 'incomplete', 'int', 'sack', 'scramble']);

/**
 * A man in motion before the snap (`StagedPlay.motion`): a receiver carrying a run is a jet sweep, coming across at
 * speed; otherwise, now and then, a receiver or tight end shifts a few yards or comes across the formation. Seeded on
 * its own stream: it never moves anyone else.
 */
function motionFor(
  e: PlayLogEntry,
  cast: ReturnType<typeof castFor>,
  start: ReadonlyMap<number, Pt>,
  off: { personnel: string },
  ballY: number,
  carrier: number | null,
  seed: string,
): { motion: NonNullable<StagedPlay['motion']> } | Record<string, never> {
  if (!e.kind || !MOTION_KINDS.has(e.kind)) return {};
  const rng = new Rng(`${seed}:motion`);
  const jet = e.kind === 'run' && cast.offense.find((m) => m.id === carrier)?.role === 'WR';
  const hurry = (e.quarter === 2 || e.quarter >= 4) && e.clock <= 120;
  const rate = hurry ? MOTION_RATE.hurry : off.personnel.startsWith('1') ? MOTION_RATE.base : MOTION_RATE.heavy;
  if (!jet && rng.next() >= rate) return {};
  const movers = cast.offense.filter((m) => m.role === 'WR' || m.role === 'TE');
  const mover = jet ? carrier! : movers[Math.floor(rng.next() * movers.length)]?.id;
  if (mover === undefined) return {};
  const spot = start.get(mover)!;
  const out = Math.sign(spot.y - ballY) || 1;
  const across = jet || rng.next() < 0.4;
  const y = across ? ballY - (spot.y - ballY) * 0.8 : spot.y + out * (rng.next() < 0.5 ? 6 : -5);
  const from = { x: spot.x, y: Math.max(3, Math.min(FIELD_W - 3, y)) };
  // Not on top of a teammate's spot.
  for (const m of cast.offense)
    if (m.id !== mover && Math.hypot(start.get(m.id)!.x - from.x, start.get(m.id)!.y - from.y) < 1.5) return {};
  const dur = Math.max(1, Math.min(2.2, Math.abs(from.y - spot.y) / (jet ? 8 : 6.5)));
  return { motion: { id: mover, from, dur, across } };
}

/** A punter roughed: how far the punt would have gone, for the picture (the flag wiped it out before it was measured). */
const ROUGHED_PUNT = 42;

/** "T.Harrison punts. PENALTY on CLE (J.Clemons): Roughing the kicker": a punt to stage the hit on, or undefined. */
function roughedPunt(e: PlayLogEntry, homeId: number): PlayLogEntry | undefined {
  if (e.kind !== 'penalty' || e.from === undefined || !/punts\. PENALTY/.test(e.text)) return undefined;
  const dir = offenseSide(e, homeId) === 0 ? 1 : -1;
  const air = Math.max(-5, Math.min(105, e.from + dir * ROUGHED_PUNT));
  return { ...e, kind: 'punt', air, to: air };
}

/** The tackler's top closing speed (yards a second): the last stretch into the carrier is never quicker than this. */
const CLOSE = 9.5;
/** A last run into the hit longer than this would be a slide alongside the carrier: he runs him down instead. */
const LONG_CLOSE = 1.2;
/** A run-down: he stays this far behind the carrier (yards) until the last `CLOSE_IN` seconds, then closes. */
const TRAIL = 2.6;
const CLOSE_IN = 1;
/** The last stretch of a run-down, eased onto the spot the script has the hit at (seconds). */
const INTO = 0.6;
/** How quickly a man gets up to speed (yards a second, each second). */
const ACCEL = 6;

/**
 * The tackler ran the play down himself (`steer`); he meets the carrier where his script says. From the latest moment
 * he can still get there at full speed, he runs straight into the hit, so the tackle is his run and not a slide. When
 * that run would be a long one (he was beaten, or left behind by a miss), he runs the carrier down from behind instead
 * (`chaseDown`): a straight line to the tackle would have him gliding along at the carrier's side.
 */
function closeIn(
  pos: Float32Array,
  n: number,
  k: number,
  keys: readonly { t: number; x: number; y: number }[],
  steps: number,
  earliest: number,
  chase: { carrier: number; top: number },
) {
  const last = steps - 1;
  const end = keys[keys.length - 1];
  const at = (st: number) => ({ x: pos[(st * n + k) * 2], y: pos[(st * n + k) * 2 + 1] });
  let from = last;
  for (let st = last - 1; st >= Math.min(earliest, last - 1); st--) {
    const p = at(st);
    const left = (last - st) * STEP;
    from = st;
    // Far enough out that a full-speed run covers the gap with a little room: start the run in here.
    if (left >= 0.35 && Math.hypot(end.x - p.x, end.y - p.y) <= CLOSE * left * 0.8) break;
  }
  if ((last - from) * STEP > LONG_CLOSE && chase.carrier >= 0 && chaseDown(pos, n, k, chase, end, from, last)) return;
  const p0 = at(from);
  for (let st = from + 1; st <= last; st++) {
    const g = (st - from) / (last - from);
    pos[(st * n + k) * 2] = p0.x + (end.x - p0.x) * g;
    pos[(st * n + k) * 2 + 1] = p0.y + (end.y - p0.y) * g;
  }
}

/**
 * Running the carrier down from behind, from step `from` to the tackle at `last`: he follows in the carrier's
 * footsteps, from his own pace up to the one that brings him level at the whistle (no quicker than a man can get up to
 * speed), so the carrier pulls away while he gets going and then the gap closes. He drifts off his own line onto the
 * carrier's as he comes. False when no pace he can reach catches him: the caller's straight run stands.
 */
function chaseDown(
  pos: Float32Array,
  n: number,
  k: number,
  chase: { carrier: number; top: number },
  end: Pt,
  from: number,
  last: number,
): boolean {
  const c = chase.carrier;
  const P = (st: number, j: number): Pt => ({ x: pos[(st * n + j) * 2], y: pos[(st * n + j) * 2 + 1] });
  // The carrier's footsteps, by the distance he's run.
  const run = new Float64Array(last + 1);
  for (let st = 1; st <= last; st++) {
    const a = P(st - 1, c);
    const b = P(st, c);
    run[st] = run[st - 1] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const foot = (d: number): Pt => {
    const s = Math.max(0, Math.min(run[last], d));
    let st = 1;
    while (st < last && run[st] < s) st++;
    const a = P(st - 1, c);
    const b = P(st, c);
    const g = run[st] > run[st - 1] ? (s - run[st - 1]) / (run[st] - run[st - 1]) : 1;
    return { x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g };
  };
  const me = P(from, k);
  const car = P(from, c);
  const back = P(Math.max(0, from - 2), c);
  const ahead = P(Math.min(last, from + 2), c);
  const hl = Math.hypot(ahead.x - back.x, ahead.y - back.y) || 1;
  const h = { x: (ahead.x - back.x) / hl, y: (ahead.y - back.y) / hl };
  // How far behind the carrier he is along the carrier's line (in front of him: negative), and his pace along it.
  const behind = (car.x - me.x) * h.x + (car.y - me.y) * h.y;
  const was = P(Math.max(0, from - 1), k);
  const pace = Math.max(0, ((me.x - was.x) * h.x + (me.y - was.y) * h.y) / STEP);
  // Level with him (or in front) with the run still long: the carrier makes him miss. His momentum's gone (most of it:
  // as much as still lets him catch the carrier) and he's knocked a yard off the carrier's line, so the carrier pulls
  // clear before he gets going again.
  // Well in front of him and the hit between them, he comes to meet him: the caller's straight run into it. (In front
  // with the hit beyond him, a straight run would have him backing off ahead of the carrier: he gets by him instead.)
  if (behind < -2.5 && (end.x - me.x) * h.x + (end.y - me.y) * h.y < 0) return false;
  const whiffed = behind < 2.5;
  const start = run[from] - Math.max(behind, whiffed ? -0.5 : behind);
  const side = Math.sign(-h.y * (me.x - car.x) + h.x * (me.y - car.y)) || 1;
  const off = { x: me.x - foot(start).x, y: me.y - foot(start).y };
  const knock = whiffed ? { x: -h.y * side, y: h.x * side } : { x: 0, y: 0 };
  const L = (last - from) * STEP;
  const need = run[last] - 0.6 - start;
  if (need <= 0) return false;
  /** How far he goes in `t` seconds, getting from `v0` to `v` at ACCEL and holding it. */
  const gone = (v0: number, v: number, t: number) => {
    const ramp = Math.min(t, Math.abs(v - v0) / ACCEL);
    const sign = v >= v0 ? 1 : -1;
    return v0 * ramp + (sign * ACCEL * ramp * ramp) / 2 + v * (t - ramp);
  };
  // The hardest miss he can still recover from, at his own top speed if he can, a burst over it if he must.
  const tries = (whiffed ? [0.5, 2.5, 4.5, pace] : [pace]).flatMap((v0) =>
    [chase.top, chase.top + 1.5].map((top) => ({ v0, top })),
  );
  const plan = tries.find(({ v0, top }) => gone(v0, top, L) >= need);
  if (!plan) return false;
  const v0 = plan.v0;
  /** The pace from `a` that covers `d` in `t` seconds (no more than `top`). */
  const paceFor = (a: number, d: number, t: number, top: number) => {
    let lo = 0;
    let hi = top;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const ramp = Math.min(t, Math.abs(mid - a) / ACCEL);
      const went = a * ramp + ((mid >= a ? 1 : -1) * ACCEL * ramp * ramp) / 2 + mid * (t - ramp);
      if (went < d) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  // Two legs: a couple of yards behind him until the last second, then the burst that closes it, so the hit is a
  // run-down and not a man creeping up at his elbow. One leg when there's no time for two or the burst is beyond him.
  const T1 = L - CLOSE_IN;
  const hold = T1 > 0.5 ? run[Math.min(last, from + Math.round(T1 / STEP))] - TRAIL - start : -1;
  let v1 = paceFor(v0, need, L, plan.top);
  let v2 = v1;
  let split = L;
  if (hold > 0) {
    const a = paceFor(v0, hold, T1, plan.top);
    const reach = gone(v0, a, T1);
    const b = paceFor(a, need - reach, CLOSE_IN, plan.top + 1.5);
    const ramp = Math.min(CLOSE_IN, Math.abs(b - a) / ACCEL);
    const went = a * ramp + ((b >= a ? 1 : -1) * ACCEL * ramp * ramp) / 2 + b * (CLOSE_IN - ramp);
    if (Math.abs(reach - hold) < 0.3 && Math.abs(went - (need - reach)) < 0.3) [v1, v2, split] = [a, b, T1];
  }
  /** How far along the carrier's footsteps he's come `t` seconds in. */
  const along = (t: number) => {
    if (t <= split) return gone(v0, v1, t);
    const t2 = t - split;
    const ramp = Math.min(t2, Math.abs(v2 - v1) / ACCEL);
    return gone(v0, v1, split) + v1 * ramp + ((v2 >= v1 ? 1 : -1) * ACCEL * ramp * ramp) / 2 + v2 * (t2 - ramp);
  };
  for (let st = from + 1; st <= last; st++) {
    const t = (st - from) * STEP;
    const u = t / L;
    const f = foot(start + along(t));
    // Off his own line onto the carrier's, then into the hit where the script has it.
    const k2 = Math.min(1, t / 0.3) * (1 - u);
    // His own line fades into the carrier's early (most of it by halfway), so little is left for the hit.
    const fade = (1 - u) ** 2;
    const p = { x: f.x + off.x * fade + knock.x * k2, y: f.y + off.y * fade + knock.y * k2 };
    const g = Math.max(0, Math.min(1, (t - (L - INTO)) / INTO));
    const into = g * g * (3 - 2 * g);
    pos[(st * n + k) * 2] = p.x + (end.x - p.x) * into;
    pos[(st * n + k) * 2 + 1] = p.y + (end.y - p.y) * into;
  }
  return true;
}
