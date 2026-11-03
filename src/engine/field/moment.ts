/**
 * The moment of possession, blind to what came after: everything the approach may read (the situation, where the ball
 * was snapped and where it's caught or comes down, who it's about, the defense's call, the line's state) and nothing
 * else. The engine builds one at the moment; the replay rebuilds the same from the play log (`momentOf`).
 */
import type { DefenseCall } from '../match/coach';
import { actorsIn, defenseCallAt, packActors } from '../playActors';
import type { FieldRecord, PlayLogEntry } from '../types';
import { asRan } from './stage';
import type { FieldKind } from './types';

/** What a spatial play's log entry keeps that a replay can't read anywhere else (`PlayLogEntry.field`). */
export interface FieldFacts {
  /** Where the ball was snapped across the field (`MID` on a kickoff). */
  y: number;
  /** A run's line state: its roll in sd from the league's mean carry. */
  z?: number;
  /** The front is tired (a long drive, the hurry-up). */
  tired?: 1;
  /** The clock wants him out of bounds (the hurry-up), or in (milking it). */
  out?: 1;
  stay?: 1;
  /** A return's special-teams coaching edge, in rating points. */
  edge?: number;
}

export interface FieldMoment {
  kind: FieldKind;
  kick?: 'kickoff' | 'punt';
  /** The play's index in the game's log: its stream is `${seed}:field:${index}`. */
  index: number;
  /** The team with the ball at the snap (the kicking team on a kick), as the log names it. */
  offense: number;
  quarter: number;
  clock: number;
  down: number;
  distance: number;
  yardLine: number;
  /** Field x at the snap (the tee on a kickoff), and of the catch or where the kick comes down. */
  from: number;
  air?: number;
  lane: number;
  /** The back or the target (a return's man is the cast's returner). */
  ball?: number;
  cover?: number;
  rush?: number;
  beat?: number;
  call: DefenseCall;
  shot?: 1;
  bounce?: 1;
  facts: FieldFacts;
}

const KINDS: Partial<Record<NonNullable<PlayLogEntry['kind']>, FieldKind>> = {
  run: 'run',
  pass: 'catch',
  kickoff: 'return',
  punt: 'return',
};

/**
 * The entry the stager reads for the approach: the moment and nothing past it. Its `to` is the moment of possession
 * itself (a run a few yards on along its lane, a catch where it's made, a kick where it comes down), never the result.
 */
export function momentEntry(m: FieldMoment, homeId: number): PlayLogEntry {
  const kind: PlayLogEntry['kind'] = m.kind === 'run' ? 'run' : m.kind === 'catch' ? 'pass' : m.kick!;
  const dir = m.offense === homeId ? 1 : -1;
  const to = m.kind === 'run' ? m.from + dir * RUN_ON : (m.air ?? m.from);
  const who = packActors({ ball: m.ball, cover: m.cover, rush: m.rush, beat: m.beat });
  return {
    quarter: m.quarter,
    clock: m.clock,
    offense: m.offense,
    down: m.down,
    distance: m.distance,
    yardLine: m.yardLine,
    text: m.shot ? 'Designed shot: ' : '',
    homeScore: 0,
    awayScore: 0,
    kind,
    from: m.from,
    ...(m.air !== undefined ? { air: m.air } : {}),
    to,
    lane: m.lane,
    ...(who ? { who } : {}),
    ...(m.bounce ? { open: { bounce: 1 } } : {}),
  };
}

/** How far on a run's blind entry goes (yards): past the line, so the stager presses the hole as on a carry. */
const RUN_ON = 8;

/** The moment a logged spatial play started from, or null for a play the field didn't play. */
export function momentOf(e0: PlayLogEntry, record: FieldRecord, index: number, _homeId: number): FieldMoment | null {
  const e = asRan(e0);
  const facts = e.field ?? e0.field;
  const kind = e.kind && KINDS[e.kind];
  if (!facts || !kind || e.from === undefined) return null;
  const who = actorsIn(e);
  const m: FieldMoment = {
    kind,
    index,
    offense: e.offense,
    quarter: e.quarter,
    clock: e.clock,
    down: e.down,
    distance: e.distance,
    yardLine: e.yardLine,
    from: e.from,
    lane: e.lane ?? 0,
    call: defenseCallAt(record, index),
    facts,
  };
  if (kind === 'return') m.kick = e.kind as 'kickoff' | 'punt';
  if (e.air !== undefined) m.air = e.air;
  if (kind !== 'return' && who.ball !== undefined) m.ball = who.ball;
  if (kind === 'catch') {
    if (who.cover !== undefined) m.cover = who.cover;
    if (who.rush !== undefined) m.rush = who.rush;
    if (who.beat !== undefined) m.beat = who.beat;
  }
  if (/^Designed shot:/.test(e.text)) m.shot = 1;
  if (e.open?.bounce) m.bounce = 1;
  return m;
}
