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
  /** Who has the ball at the whistle. */
  carrier: number | null;
  /** Per id: the spot he lined up at (QB, OL, WR...). */
  roles: Role[];
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
  const { plays, index, record, homeId } = args;
  const e = plays[index];
  const rng = new Rng(args.seed);
  const cast = castFor(record, plays, index, homeId);
  const dir: 1 | -1 = cast.offSide === 0 ? 1 : -1;
  const ballX = e.from ?? (cast.offSide === 0 ? e.yardLine : 100 - e.yardLine);
  const ballY = e.kind === 'kickoff' ? MID : args.snapY;
  const off = record.scheme[cast.offSide];
  const def = record.scheme[1 - cast.offSide];
  const start = lineUp(e, cast, off, def, ballX, ballY, dir, rng);
  const segs = stagedPath(e, homeId, args.snapY);
  const { keys, carrier, tackler, release, catchAt } = script(e, cast, start, segs, dir);
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
    scripted: keys,
    ball,
    release,
    carrier,
    tackler,
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
    carrier,
    roles: members.map((m) => m.role),
  };
}
