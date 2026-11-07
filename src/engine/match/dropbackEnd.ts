/**
 * How a play ends (spec: docs/superpowers/specs/2026-11-07-dropback-endings-design.md): how many yards a sack costs, and
 * whether a scrambler who stays in bounds slides or fights for it, and why. The sack's shape is the NFL's (in the pocket
 * and after he'd left it); the situation and the man lean it. The slide's share is held at the league's 40% (the owner's
 * call: no data records slides); who slides and when leans on the sticks, the clock, the chase, his habits and his makeup.
 * This module draws nothing and reads no league.
 *
 * Every number is nflverse play-by-play 2021–25 and FTN charting 2022–25 (`scripts/research-dropback.py`).
 */
import type { QuirkId } from '../quirks';
import type { DefenseCall } from './coach';

export interface SackFacts {
  down: number;
  toGo: number;
  /** Yards from his own goal line: the loss never passes it (reaching it is a safety). */
  yardLine: number;
  call: DefenseCall;
  qb: { pocketPresence: number; scrambling: number; has(q: QuirkId): boolean };
}

/** Shares of a sack's loss at 0, 1, …, 14 and 15+ yards (n 4,100 in the pocket; 1,208 after he'd left it). */
const SACK_LOSS: Record<'pocket' | 'out', readonly number[]> = {
  pocket: [
    0.0398, 0.0246, 0.0317, 0.0415, 0.0602, 0.0871, 0.1063, 0.1473, 0.1571, 0.1224, 0.0788, 0.0437, 0.022, 0.0146,
    0.0076, 0.0154,
  ],
  out: [
    0.1714, 0.1043, 0.0935, 0.0762, 0.0629, 0.0621, 0.0555, 0.0629, 0.0555, 0.0596, 0.0505, 0.0389, 0.0356, 0.024,
    0.0157, 0.0315,
  ],
};
/** The league's mean loss (6.66) against each down's: deeper drops on passing downs (n 1,842, 1,876, 2,641, 193). */
const DOWN_SHIFT: Record<number, number> = { 1: -0.56, 2: -0.27, 3: 0.5, 4: 1.17 };
/** 3rd and 8 or more: 7.43 against 3rd down's 7.16. */
const LONG_THIRD = 0.3;
/** The rush his call sends: a coverage call reads as three rushers (5.68), base as four (6.41), a blitz as five or more (7.05). */
const CALL_SHIFT: Record<DefenseCall, number> = { passD: -0.7, base: 0, runD: 0, blitz: 0.65 };
/** Per pocket-presence point over 12: he feels it and gives less ground (the NFL's spread between men: about 0.6 yards). */
const PRESENCE = -0.08;
const MUDDY = 0.6;
/** Backed up: from his own 11–20 (6.28) and his own 10 in (5.09, then 2.0 inside the 5, where the goal line caps it). */
const BACKED: { at: number; shift: number }[] = [
  { at: 10, shift: -1.0 },
  { at: 20, shift: -0.4 },
];

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/** Of the NFL's sacks 22.8% come after he'd left the pocket (FTN 2022–25, n 5,308): more for a man with legs. */
const ESCAPE_BASE = logit(0.228);
const ESCAPE_LEGS = 0.12;
const ESCAPE_BAILS = 0.6;

export function escapeOdds(f: SackFacts): number {
  return logistic(ESCAPE_BASE + ESCAPE_LEGS * (f.qb.scrambling - 12) + (f.qb.has('bailsEarly') ? ESCAPE_BAILS : 0));
}

/**
 * The loss on draw `u`: the NFL's shape (in the pocket or after he'd left it) with the situation and the man shifting
 * it. A sack at the line costs nothing whatever the shift; nothing passes his goal line.
 */
export function sackLoss(f: SackFacts, escaped: boolean, u: number): number {
  const table = SACK_LOSS[escaped ? 'out' : 'pocket'];
  let at = u * table.reduce((a, b) => a + b, 0);
  let k = 0;
  while (k < table.length - 1 && at >= table[k]) at -= table[k++];
  if (k === 0) return 0;
  // Where the draw falls inside its yard: the shift moves the loss smoothly, not a yard at a time.
  const within = Math.min(0.999, Math.max(0, at / table[k]));
  let shift = (DOWN_SHIFT[Math.min(4, Math.max(1, f.down))] ?? 0) + CALL_SHIFT[f.call];
  if (f.down === 3 && f.toGo >= 8) shift += LONG_THIRD;
  shift += PRESENCE * (f.qb.pocketPresence - 12);
  if (f.qb.has('muddyPockets')) shift += MUDDY;
  const backed = BACKED.find((b) => f.yardLine <= b.at);
  if (backed) shift += backed.shift;
  const loss = Math.round(k - 0.5 + within + shift);
  return Math.max(0, Math.min(f.yardLine, loss));
}

export interface SlideFacts {
  down: number;
  toGo: number;
  /** His gain on the scramble. */
  gained: number;
  scoreDiff: number;
  /** The 4th quarter, 5:00 or less. */
  late: boolean;
  /** Yards to the end zone after the gain. */
  toGoal: number;
  qb: {
    scrambling: number;
    /** `sizeZ(p).w`. */
    weightZ: number;
    /** `temperamentOf(p)`: high is calm. */
    temperament: number;
    poise: number;
    age: number;
    concussions: number;
    energy: number;
    /** Injuries this season and last, capped at 3 (as the sideline call reads it). */
    hurt: number;
    has(q: QuirkId): boolean;
  };
  chaser: { tackling: number; has(q: QuirkId): boolean };
}

export type SlideReason = 'firstDown' | 'clock' | 'hit';

/** Fitted so the league slides on 40% of in-bounds scrambles (the owner's call). */
export const SLIDE_BASE = -0.55;
/** A slider touched down: the toucher has the tackle (the NFL credits one on 93.2% of in-bounds scrambles). */
export const TOUCHED = 0.89;

const firstDownIn = (f: SlideFacts) => f.gained >= f.toGo;

/** What leans him to the slide, by reason (each term ≥ 0), and what leans him to fight for it (each ≤ 0). */
function leans(f: SlideFacts) {
  const { qb, chaser } = f;
  const firstDown = firstDownIn(f) ? 0.8 : 0;
  const clock = f.late && f.scoreDiff > 0 ? 0.7 : 0;
  const hit =
    Math.max(0, 0.04 * (chaser.tackling - 12)) +
    (chaser.has('thumper') ? 0.3 : 0) +
    (qb.energy < 60 ? 0.3 : 0) +
    0.15 * qb.hurt +
    0.25 * Math.min(3, qb.concussions) +
    Math.max(0, 0.04 * (qb.temperament - 10.5)) +
    0.05 * Math.max(0, qb.age - 28) +
    (qb.has('bailsEarly') ? 0.4 : 0) +
    (qb.has('seesGhosts') ? 0.3 : 0);
  const fight =
    (f.late && f.scoreDiff < 0 ? -0.8 : 0) +
    (f.down >= 3 && !firstDownIn(f) ? -1.0 : 0) +
    (f.toGoal <= 5 ? -0.8 : 0) +
    Math.min(0, 0.04 * (chaser.tackling - 12)) +
    Math.min(0, 0.04 * (qb.temperament - 10.5)) +
    -0.08 * (qb.scrambling - 12) +
    -0.2 * qb.weightZ +
    (qb.has('gunslinger') ? -0.4 : 0);
  return { firstDown, clock, hit, fight };
}

export function slideOdds(f: SlideFacts): number {
  const l = leans(f);
  return logistic(SLIDE_BASE + l.firstDown + l.clock + l.hit + l.fight);
}

/** Why he slid: the strongest of the three, ties to the first down, then the clock; the hit when nothing else says. */
export function slideReason(f: SlideFacts): SlideReason {
  const l = leans(f);
  if (l.firstDown > 0 && l.firstDown >= l.clock && l.firstDown >= l.hit) return 'firstDown';
  if (l.clock > 0 && l.clock >= l.hit) return 'clock';
  return 'hit';
}

/** He fights for every yard: short of the sticks on 3rd or 4th down, or on 2nd with a short fuse (6 or under). */
export function fightsForIt(f: SlideFacts): boolean {
  if (firstDownIn(f)) return false;
  return f.down >= 3 || (f.down === 2 && f.qb.temperament <= 6);
}
