/**
 * The open field's shapes (spec: docs/superpowers/specs/2026-11-03-spatial-open-field-design.md §1): what it starts
 * from at the moment of possession, what it decided, and the per-man skills it reads.
 */
import type { QuirkId } from '../quirks';
import type { Position } from '../types';
import type { Role } from './cast';
import type { MoveKind } from './carrier';

/** What the man with the ball is doing: running past the line, running after a catch, or returning a kick. */
export type FieldKind = 'run' | 'catch' | 'return';

/**
 * Everything the open field reads about one man, from contests (`skill`) and his build: the numbers a game's snapshot
 * keeps so its replay re-runs the same. Rounded to hundredths, and the sim reads the rounded values.
 */
export interface FieldSkills {
  /** His build, as `sizeEdge` reads it: position, height (in), weight (lb), plays bigger than it. */
  pos: Position;
  h: number;
  w: number;
  big?: 1;
  /** `longSpeed`: top speed. */
  speed: number;
  /** `burst`: acceleration and cuts. */
  burst: number;
  /** `reads`: reaction, a defender's angle, a runner's lane. */
  reads: number;
  /** `pursuit`: a defender's angle. */
  pursuit: number;
  /** `tackling`. */
  tackle: number;
  /** Getting off a block: `runDefense` (DT, EDGE), `runFit` (LB, S), `tackling` (anyone else). */
  shed: number;
  /** `runBlocking`. */
  block: number;
  /** `afterCatch`: moves with the ball. */
  move: number;
  /** `returns`: moves on a return. */
  ret: number;
  /** `breakTackles`: breaking a tackle, yards after contact. */
  power: number;
  /** His active quirks the field plays (`FIELD_HABITS`) or the film shows before possession (`FILM_HABITS`), sorted. */
  habits?: QuirkId[];
}

export interface FieldPlayer {
  id: number;
  /** 0: the carrier's team. */
  side: 0 | 1;
  role: Role;
  x: number;
  y: number;
  vx: number;
  vy: number;
  s: FieldSkills;
}

/** Everything the open field starts from: positions and motion at the moment of possession. */
export interface FieldStart {
  kind: FieldKind;
  /** Seconds from the snap. */
  t0: number;
  /** The carrier's direction: 1 toward x = 100. */
  dir: 1 | -1;
  /** The field x the yards are measured from: the line of scrimmage, or a return's catch. */
  yardLine: number;
  carrier: number;
  /** All 22, in cast order (offense, then defense); `frames` keep the same order. */
  players: FieldPlayer[];
  blocks: { blocker: number; defender: number; holdFor: number }[];
  /** The situation wants him out of bounds (the hurry-up), or in (milking the clock). */
  clock: { outOfBounds: boolean; stayIn: boolean };
  /** A return's special-teams coaching edge, in rating points (0 on scrimmage). */
  edge: number;
  /** The front is tired (a long drive, the hurry-up): `gassed` men shed and run slower. */
  tired: boolean;
  /** An outside run's play side across the field (field y): he stretches the edge first. */
  stretch?: 1 | -1;
  /**
   * Where today's engine ended the play (field x) and whether it scored: the open field plays out how he gets there
   * (the path, the cuts, who misses, who tackles) and ends there. The owner's call H: the yards stay today's.
   */
  target?: { x: number; touchdown: boolean };
  /** Free defenders who react late on a clean run (seconds from `t0`): the second level held by the hole. */
  late?: { id: number; until: number }[];
}

/** What the open field decided. */
export interface FieldResult {
  /** From `yardLine`, as `PlayResult.yards`. */
  yards: number;
  /** Null on a touchdown or out of bounds untouched. */
  tackler: number | null;
  touchdown: boolean;
  outOfBounds: boolean;
  /** Broken (`size`) or missed (`move`) tackles, in order: when (seconds from `t0`) and the move, if he made one. */
  misses: { by: number; how: 'size' | 'move'; t: number; move?: MoveKind }[];
  /** Seconds from `t0` to the whistle. */
  duration: number;
  /** x, y for each of `players` at each 0.05 s step from `t0`. */
  frames: Float32Array;
}
