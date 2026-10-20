/**
 * Where a player can play, and how well away from his own position. Two things live here, so the roster,
 * the lineup and the training code can all read them without importing each other:
 *
 * - the moves coaches will teach (`CONVERSIONS`; the plans themselves are in `training.ts`);
 * - the knock a player takes lining up out of position (`knockFor`): a broad cut to every skill the match
 *   engine reads for him while he's there (`skill`'s overlay in `attributes.ts`), on top of his ratings
 *   simply suiting the job less. A position from his own room (a safety at corner, an end inside) costs
 *   half, one he's partway through learning costs less as he learns, one he played before a quarter, and
 *   a versatile player (the hidden Versatility trait, `knockMult`) shrugs off more of it.
 */
import { overall } from './positions';
import { knockMult } from './traits';
import type { Player, Position } from './types';

export interface Conversion {
  from: Position;
  to: Position;
  /** A: a natural move, usually ready the camp after it starts. B: real retraining, about a year longer. */
  tier: 'A' | 'B';
  /** Learning-weeks to be ready, at a typical pace (a year holds about 22: program 9, camp 4.5, season 9). */
  weeks: number;
  /** Ages a plan can start at: a speed position is for young legs, an aging move for veterans too. */
  ages: [number, number];
  /** Learned with live contact: spring work (no pads under the CBA) teaches it at half speed. */
  contact?: true;
}

/**
 * Six directed moves to start, from the gap and aging tables in docs/TRAINING.md §1: an aging corner
 * becomes a safety, an edge rusher a linebacker or an interior lineman, safeties and linebackers trade
 * places, a young safety moves to corner. Every other pair is refused. Weeks are tuning targets for the
 * training check still to come (docs/TRAINING.md); the next pairs (LB→EDGE, TE→OL, RB→WR) wait on it.
 */
export const CONVERSIONS: readonly Conversion[] = [
  { from: 'CB', to: 'S', tier: 'A', weeks: 8, ages: [21, 36] },
  { from: 'S', to: 'LB', tier: 'A', weeks: 11, ages: [21, 32] },
  { from: 'LB', to: 'S', tier: 'A', weeks: 12, ages: [21, 34] },
  { from: 'EDGE', to: 'LB', tier: 'B', weeks: 22, ages: [21, 34] },
  { from: 'EDGE', to: 'DT', tier: 'B', weeks: 24, ages: [21, 34], contact: true },
  { from: 'S', to: 'CB', tier: 'B', weeks: 22, ages: [21, 25] },
];

export const conversionOf = (from: Position, to: Position): Conversion | undefined =>
  CONVERSIONS.find((c) => c.from === from && c.to === to);
/** Positions the coaches could teach a player, whatever his age. */
export const targetsFor = (p: Pick<Player, 'position'>): Position[] =>
  CONVERSIONS.filter((c) => c.from === p.position).map((c) => c.to);

// ───────── playing out of position ─────────

/** Rating points a player loses on every skill at a position that isn't his, before the discounts below. */
export const OUT_OF_POSITION_KNOCK = 2.5;

/** Rooms that share the same calls and coaching: moving within one is half the shock. */
const ROOM: Record<Position, string> = {
  QB: 'QB',
  RB: 'RB',
  WR: 'WR',
  TE: 'WR',
  OL: 'OL',
  DT: 'DL',
  EDGE: 'DL',
  LB: 'LB',
  CB: 'DB',
  S: 'DB',
  K: 'K',
  P: 'K',
};

/** What lining up at `slot` costs him on every skill, in rating points (0 at his own position). */
export function knockFor(p: Player, slot: Position): number {
  if (p.position === slot) return 0;
  let k = OUT_OF_POSITION_KNOCK * knockMult(p.traits);
  if (ROOM[p.position] === ROOM[slot]) k *= 0.5;
  if ((p.moves ?? []).some((m) => m.from === slot)) k *= 0.25;
  else {
    // Learning it: the knock fades as he learns (a trade ends the plan, and its head start).
    const l = p.learning;
    const c = l && l.to === slot && l.teamId === p.teamId ? conversionOf(p.position, slot) : undefined;
    if (c) k *= 1 - Math.min(1, l!.done / c.weeks);
  }
  return Math.round(k * 100) / 100;
}

/** His overall at a slot, knock included: what he's worth lined up there. */
export const slotOvr = (p: Player, slot: Position) => overall(p.ratings, slot) - knockFor(p, slot);

/** The knock in words, for screens: none, small or big (the number stays with the engine). */
export function knockWord(k: number): 'none' | 'small' | 'big' {
  return k <= 0 ? 'none' : k < OUT_OF_POSITION_KNOCK * 0.6 ? 'small' : 'big';
}
