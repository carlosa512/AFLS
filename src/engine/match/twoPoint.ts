/**
 * The two-point try (spec: docs/superpowers/specs/2026-11-07-a-plays-time-design.md): whether a team goes for two after
 * a touchdown, and whether it runs or throws. The try itself is a real snap from the 2 (`gameSim.ts`). This module draws
 * nothing and reads no league.
 *
 * Every number is nflverse play-by-play 2021–25, regular seasons (`scripts/research-situations.py`): 9.8% of 6,779 tries
 * went for two, 4.6% in quarters 1–3 and 22.3% in the 4th and overtime; 47.5% were good (runs 56.4%, passes 44.0%).
 */

export interface TwoPointFacts {
  quarter: number;
  /** Seconds left in the quarter. */
  clock: number;
  overtime: boolean;
  /** The scorer's margin after the touchdown, before the try. */
  scoreDiff: number;
  /** The head coach's fourth-down appetite, −1…1. */
  appetite: number;
  /** The play-caller's lean toward the pass, −1…1. */
  passLean: number;
  /** The quarterback's `scrambling` skill. */
  qbScrambling: number;
}

/** Where the NFL always goes, late: to tie (−2, −10 after a field goal), to lead by 3 or 7 (+1, +5), or down 5. */
const SURE = new Set([-10, -5, -2, 1, 5]);

export function sureTwo(f: Pick<TwoPointFacts, 'quarter' | 'clock' | 'overtime' | 'scoreDiff'>): boolean {
  if (f.quarter < 4 && !f.overtime) return false;
  return SURE.has(f.scoreDiff) || (f.scoreDiff === -1 && f.clock <= 60 && !f.overtime);
}

/** Quarters 1–3, by the margin after the touchdown (n ≥ 30 each). */
const EARLY: Record<number, number> = {
  [-11]: 0.05,
  [-8]: 0.07,
  [-7]: 0.02,
  [-5]: 0.42,
  [-2]: 0.57,
  2: 0.03,
  5: 0.35,
  7: 0.06,
  9: 0.02,
  10: 0.02,
  12: 0.17,
  19: 0.22,
};
/** The 4th quarter and overtime, the judgment calls (the sure ones are 1). */
const LATE: Record<number, number> = {
  [-15]: 0.1,
  [-11]: 0.12,
  [-9]: 0.41,
  [-8]: 0.37,
  [-6]: 0.05,
  [-1]: 0.16,
  2: 0.03,
  9: 0.02,
  10: 0.12,
};
/** Every other margin: about one try in a hundred early, two late. */
const ELSEWHERE = { early: 0.01, late: 0.02 };
/** How far a full-strength appetite moves a judgment call's log-odds. */
const TWO_APPETITE = 0.4;

const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

export function twoPointOdds(f: TwoPointFacts): number {
  if (sureTwo(f)) return 1;
  const late = f.quarter >= 4 || f.overtime;
  const p = (late ? LATE : EARLY)[f.scoreDiff] ?? ELSEWHERE[late ? 'late' : 'early'];
  return logistic(logit(p) + TWO_APPETITE * f.appetite);
}

/** The NFL ran on 28.4% of its tries (n 663). */
const RUN_SHARE = 0.284;

export function runShare(f: TwoPointFacts): number {
  return logistic(logit(RUN_SHARE) - 0.8 * f.passLean + 0.1 * (f.qbScrambling - 12));
}

/** Yards added to a run's mean on a try, so runs from the 2 are good as often as the NFL's (fitted). */
export const TRY_RUN = 0;
/** A multiplier on a pass's completion odds on a try, so passes from the 2 are good as often as the NFL's (fitted). */
export const TRY_PASS = 0.92;
/** A turnover on a try returned for two (the NFL: 26 defensive twos, 3.9% of tries; fitted). */
export const DEF_TWO = 0.5;
