/**
 * One play, staged for All-22: who's on the field, where they line up, the ball's path, the scripted players and the
 * steered rest, as tracks of every dot at 20 steps a second. Pure and seeded: the same play stages the same way.
 * Spec: docs/superpowers/specs/2026-10-31-all-22-view-design.md §3.
 */
import { Rng } from '../../engine/rng';
import type { FieldRecord, PlayLogEntry } from '../../engine/types';
import { MID } from './ballPath';
import type { Role } from './cast';
import { castFor } from './cast';
import { lineUp } from './formations';
import { ballTrack, script, stagedPath } from './scripts';
import { steer } from './steer';
import { COVERAGES } from '../../engine/schemes';

export const STEP = 0.05;
/** Plays where the quarterback has the ball first, and the ones where he drops back to throw. */
const HOLDERS: ReadonlySet<string> = new Set(['run', 'pass', 'incomplete', 'int', 'sack', 'scramble']);
const DROPBACKS: ReadonlySet<string> = new Set(['pass', 'incomplete', 'int', 'sack', 'scramble']);
/** A play with no path (a flag before the snap, a timeout): the line-up, held this long. */
const STILL = 0.5;
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
  /** Who has the ball at the whistle. */
  carrier: number | null;
  /** Per id: the spot he lined up at (QB, OL, WR...). */
  roles: Role[];
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
  // A snap a flag wiped out is staged as it ran (the walk-off is the official's, between plays).
  const e = asRan(args.plays[index]);
  const plays = e === args.plays[index] ? args.plays : Object.assign(args.plays.slice(), { [index]: e });
  const rng = new Rng(args.seed);
  const cast = castFor(record, plays, index, homeId);
  const dir: 1 | -1 = cast.offSide === 0 ? 1 : -1;
  // The line of scrimmage: a field goal is logged from the holder's spot, seven yards behind it.
  const logged = e.from ?? (cast.offSide === 0 ? e.yardLine : 100 - e.yardLine);
  const ballX = e.kind === 'fg' ? logged + dir * 7 : logged;
  const ballY = e.kind === 'kickoff' ? MID : args.snapY;
  const off = record.scheme[cast.offSide];
  const def = record.scheme[1 - cast.offSide];
  const start = lineUp(e, cast, off, def, ballX, ballY, dir, rng);
  const segs = stagedPath(e, homeId, args.snapY);
  const { keys, carrier, tackler, pursuer, release, catchAt, moments } = script(e, cast, start, segs, dir);
  const flight = segs.find((sg) => sg.peak > 0);
  const kick = e.kind === 'kickoff' || e.kind === 'punt' ? e.kind : e.kind === 'fg' || e.kind === 'xp' ? 'fg' : null;
  const total = segs.reduce((t, s) => t + s.dur, 0) || STILL;
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
    // The tackler runs the play down himself (`steer`); only where he meets the carrier is scripted, below.
    scripted: pursuer === null ? keys : new Map([...keys].filter(([id]) => id !== pursuer)),
    ball,
    release,
    carrier,
    tackler,
    pursuer,
    holder: e.kind && HOLDERS.has(e.kind) ? qb : null,
    dropback: !!e.kind && DROPBACKS.has(e.kind),
    run: e.kind === 'run',
    man: !!(def.coverage && COVERAGES[def.coverage].man),
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
  const earliest = Math.ceil((kick ? (catchAt ?? 0) : Number.isFinite(release) ? release : 0) / STEP);
  if (pursuer !== null)
    closeIn(
      pos,
      members.length,
      members.findIndex((m) => m.id === pursuer),
      keys.get(pursuer)!,
      steps,
      earliest,
    );
  const homeSide = cast.offSide === 0;
  return {
    dt: STEP,
    steps,
    ids: members.map((m) => m.id),
    offense: members.map((_, k) => k < cast.offense.length),
    home: members.map((_, k) => k < cast.offense.length === homeSide),
    pos,
    ball: ball.subarray(0, steps * 3),
    keys: [...keys.keys()],
    reveal: [...keys.keys()].map((id) => Math.max(0, (moments.get(id) ?? 0) - REVEAL_LEAD)),
    carrier,
    roles: members.map((m) => m.role),
  };
}

/** The tackler's top closing speed (yards a second): the last stretch into the carrier is never quicker than this. */
const CLOSE = 9.5;

/**
 * The tackler ran the play down himself (`steer`); he meets the carrier where his script says. From the latest moment
 * he can still get there at full speed, he runs straight into the hit, so the tackle is his run and not a slide.
 */
function closeIn(
  pos: Float32Array,
  n: number,
  k: number,
  keys: readonly { t: number; x: number; y: number }[],
  steps: number,
  earliest: number,
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
  const p0 = at(from);
  for (let st = from + 1; st <= last; st++) {
    const g = (st - from) / (last - from);
    pos[(st * n + k) * 2] = p0.x + (end.x - p0.x) * g;
    pos[(st * n + k) * 2 + 1] = p0.y + (end.y - p0.y) * g;
  }
}
