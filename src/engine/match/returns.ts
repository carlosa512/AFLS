/**
 * A return's length (spec: docs/superpowers/specs/2026-11-07-a-plays-time-design.md): a kickoff's or a punt's return
 * drawn whole from the NFL's shape, most short and a long tail, so a breakaway and a touchdown are the same draw (a
 * touchdown is the return that reaches the end zone). The returner, the coverage, the coaches and the punter lean it.
 * This module draws nothing and reads no league.
 *
 * nflverse play-by-play, regular seasons (`scripts/research-situations.py`): kickoffs on the 2025 rules (touchback to
 * the 35, the game's), 2,076 returned, 25.95 yards, 40+ 4.2%, 60+ 0.9%; punts 2021–25, 4,504 returned, 9.45 yards,
 * 20+ 8.2%, 40+ 1.9%, touchdowns 0.8%.
 */

export interface ReturnFacts {
  kind: 'kickoff' | 'punt';
  /** Yards from the catch to the end zone: the return never passes it, and reaching it is the touchdown. */
  from: number;
  /** The returner's `returns` skill − 12. */
  returner: number;
  /** The kicking side's coverage: its special teamers' mean `tackling` skill against a typical unit's (`COVERAGE_TYPICAL`). */
  coverage: number;
  /** Today's coaching edge in yards: `RETURN_COACH[kind] * (receiving.stCoach − kicking.stCoach)`. */
  coach: number;
  /** The punter's habits, as today: Outkicks Coverage gives 3 yards, High Arc takes 1.5. */
  outkicks?: boolean;
  highArc?: boolean;
}

/** The return yards at 0%, 1%, …, 100% (kickoffs 2025, punts 2021–25). */
const QUANTILES: Record<ReturnFacts['kind'], readonly number[]> = {
  kickoff: [
    -1, 9, 12, 15, 15, 16, 17, 17, 18, 18, 18, 19, 19, 19, 20, 20, 20, 20, 20, 21, 21, 21, 21, 21, 21, 22, 22, 22, 22,
    22, 22, 23, 23, 23, 23, 23, 23, 23, 24, 24, 24, 24, 24, 24, 24, 24, 25, 25, 25, 25, 25, 25, 25, 25, 26, 26, 26, 26,
    26, 26, 26, 27, 27, 27, 27, 27, 27, 27, 28, 28, 28, 28, 28, 28, 29, 29, 29, 29, 29, 30, 30, 30, 30, 31, 31, 31, 31,
    32, 32, 33, 33, 34, 35, 36, 37, 38, 40, 43, 46, 56.5, 100,
  ],
  punt: [
    -10, -3, -1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 6,
    6, 6, 6, 6, 7, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 8, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 11, 11, 11, 11, 11, 11, 12, 12,
    12, 12, 13, 13, 13, 13, 13, 14, 14, 14, 15, 15, 15, 15, 16, 16, 17, 17, 18, 18, 19, 20, 21, 22, 23, 25, 29, 38, 53,
    97,
  ],
};
/** The top percent at 99.0%, 99.1%, …, 100%: where the breakaways and the touchdowns live. */
const TAIL: Record<ReturnFacts['kind'], readonly number[]> = {
  kickoff: [56.5, 58.6, 61, 66.9, 70.1, 73.9, 82.4, 88.7, 96.7, 98, 100],
  punt: [53, 55, 61, 62.5, 66, 73, 76, 82.5, 90, 94, 97],
};

/** The return at probability `u`, linear between the table's points. */
function quantile(kind: ReturnFacts['kind'], u: number): number {
  const [table, from, step] = u < 0.99 ? [QUANTILES[kind], 0, 0.01] : [TAIL[kind], 0.99, 0.001];
  const x = Math.min(table.length - 1, (u - from) / step);
  const i = Math.min(table.length - 2, Math.floor(x));
  return table[i] + (x - i) * (table[i + 1] - table[i]);
}

/**
 * The returner's and the coverage's lean on the draw, fitted to the NFL's spread between returners (about 0.6 yards a
 * return on kickoffs, 1.2 on punts beyond luck). The draw is warped, not shifted, so most of a good returner's edge
 * lands in the tail, where the quantiles spread out: he breaks one more often more than he gains a yard every time.
 */
export const RETURNER = 0.06;
export const COVERAGE = 0.1;
/** A typical kicking unit's mean `tackling` skill (96 clubs: 8.6, sd 0.5 between clubs). */
export const COVERAGE_TYPICAL = 8.6;

export function returnYards(f: ReturnFacts, u: number): number {
  const lean = RETURNER * f.returner - COVERAGE * f.coverage;
  const warped = 1 - (1 - u) ** Math.exp(lean);
  const habits = f.kind === 'punt' ? (f.outkicks ? 3 : 0) - (f.highArc ? 1.5 : 0) : 0;
  return Math.max(0, Math.min(f.from, Math.round(quantile(f.kind, warped) + f.coach + habits)));
}
