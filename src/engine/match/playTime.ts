/**
 * A play's time and the half's last possession (spec: docs/superpowers/specs/2026-11-07-a-plays-time-design.md): how
 * many seconds a play takes from what happened on it, and whether a team with the ball late in the 2nd quarter kneels or
 * tries for points. This module draws nothing and reads no league.
 *
 * Every number is nflverse play-by-play 2021–25, regular seasons (`scripts/research-situations.py`), timed on plays after
 * which the clock stopped, so the time to the next snap is the play's own.
 */

export type PlayTimeKind = 'incomplete' | 'catch' | 'run' | 'scramble' | 'return' | 'punt' | 'fairCatch' | 'kickoff';

export interface PlayTimeFacts {
  kind: PlayTimeKind;
  /** The play's yards: the gain, or a return's length. */
  yards: number;
  /** An incompletion's air yards. */
  air?: number;
  outOfBounds?: boolean;
}

type Anchors = readonly (readonly [at: number, seconds: number])[];

/** Incompletions by air yards: behind the line 3.97, 0–9 4.36, 10–19 4.96, 20+ 5.73 (n 29,377). */
const INCOMPLETE: Anchors = [
  [-3, 3.97],
  [4.5, 4.36],
  [14.5, 4.96],
  [30, 5.73],
];
/** Each bucket (under 5, 5–9, 10–19, 20–39, 40+) at its plays' mean yards. */
const at = (yards: number[], s: number[]): Anchors => s.map((v, i) => [yards[i], v] as const);
/** Timed on touchdowns (in bounds the clock runs on): catches n 3,844, runs n 2,258 (a short run is a goal-line plunge). */
const CATCH = at([2.5, 6.8, 13.8, 27.5, 56.3], [4.15, 4.63, 5.34, 6.26, 9.25]);
const RUN = at([1.8, 6.5, 13.8, 27.4, 57.7], [3.65, 4.77, 5.81, 7.05, 9.55]);
/** Out of bounds in the late windows: the trip to the sideline (catches n 2,636, runs n 277, scrambles left out). */
const CATCH_OUT = at([2.6, 6.9, 13.5, 26.5, 46.3], [5.2, 4.93, 5.5, 6.31, 8.1]);
const RUN_OUT = at([1.1, 6.7, 13.0, 26.6, 52.2], [4.92, 5.78, 5.56, 6.85, 8.2]);

/** Linear between the anchors, flat past the ends. */
function along(a: Anchors, x: number): number {
  if (x <= a[0][0]) return a[0][1];
  for (let i = 1; i < a.length; i++)
    if (x <= a[i][0]) return a[i - 1][1] + ((x - a[i - 1][0]) / (a[i][0] - a[i - 1][0])) * (a[i][1] - a[i - 1][1]);
  return a[a.length - 1][1];
}

/** The NFL's mean time for what happened, unrounded. */
export function meanSeconds(f: PlayTimeFacts): number {
  switch (f.kind) {
    case 'incomplete':
      return along(INCOMPLETE, f.air ?? 0);
    case 'catch':
      return along(f.outOfBounds ? CATCH_OUT : CATCH, f.yards);
    case 'run':
      return along(f.outOfBounds ? RUN_OUT : RUN, f.yards);
    // Not measured (the clock runs after a scramble): today's 6.5 at a typical scramble, longer the farther he goes.
    case 'scramble':
      return Math.max(4.5, 6.5 + 0.1 * (f.yards - 7));
    // A pick or a loose ball run back: the throw or the hit before it, then a run of its length.
    case 'return':
      return along(RUN, f.yards) + 2;
    // A returned punt runs from the snap (10.91 at the NFL's 9.5-yard return, n 3,256); a fair catch 6.94 (n 2,709).
    case 'punt':
      return 10.91 + 0.1 * (f.yards - 9.5);
    case 'fairCatch':
      return 6.94;
    // A returned kickoff runs from the catch: 5.74 at the NFL's 26-yard return (n 4,950).
    case 'kickoff':
      return 5.74 + 0.08 * (f.yards - 26);
  }
}

/** The NFL's spread about the mean: an incompletion's p10 and p90 sit about two seconds either side. */
const SPREAD = 5;

/** Whole seconds on draw `u`, at least one. */
export function playSeconds(f: PlayTimeFacts, u: number): number {
  return Math.max(1, Math.round(meanSeconds(f) + SPREAD * (u - 0.5)));
}

export interface HalfFacts {
  /** Seconds left in the half. */
  clock: number;
  yardLine: number;
  /** The offense's timeouts. */
  timeouts: number;
  /** The head coach's fourth-down appetite, −1…1 (`Situation.fourthDown`). */
  appetite: number;
}

/**
 * The NFL's drives that start with 75 seconds or less in the half (n 1,481): kneel 64% at 20 seconds or less, 9% at
 * 21–40, 1% at 41–60; each timeout makes a try likelier; from his own 36–50 rarely, past midfield never; the score
 * barely matters. A logistic fit inside his own 50.
 */
const HALF_BASE = 4.716;
const HALF_CLOCK = -0.216;
const HALF_TIMEOUT = -0.351;
const HALF_SPOT = -3.484;
/**
 * An aggressive head coach tries more, a cautious one kneels: about five points at 30 seconds. The NFL shows no spread
 * between coaches beyond luck (sd 0.111 against 0.127), so this is flavor, kept small (the owner's call).
 */
const HALF_APPETITE = 0.6;

export function kneelOdds(f: HalfFacts): number {
  if (f.yardLine >= 50) return 0;
  const x =
    HALF_BASE +
    HALF_CLOCK * f.clock +
    HALF_TIMEOUT * f.timeouts +
    (f.yardLine > 35 ? HALF_SPOT : 0) -
    HALF_APPETITE * f.appetite;
  return 1 / (1 + Math.exp(-x));
}
