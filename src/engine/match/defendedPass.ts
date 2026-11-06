/**
 * After the throw (spec: docs/superpowers/specs/2026-11-06-picks-and-breakups-design.md): who picks it off, how often an
 * incompletion is broken up and by whom, a ball batted at the line, and how far a pick runs back. The pick's odds are the
 * engine's (rich); this decides who, from the throw's depth and the men on the field: the cover man first (his ball
 * skills made the pick likely), else a group the depth points to, a man of it by his ball skills or coverage. A lineman
 * gets there only at the line, batting it down or tipping it up. This module draws nothing and reads no league.
 *
 * Every number is nflverse play-by-play, regular seasons 2021–25 (`scripts/research-picks.py`).
 */
import { skill } from '../attributes';
import { sizeZ } from '../size';
import type { Player } from '../types';
import { bandReturn, type Bands } from './returnBands';

/** The throw's depth: behind the line, 0–9, 10–19, 20+ air yards. */
export type Band = 'behind' | 'short' | 'mid' | 'deep';
export type PassGroup = 'CB' | 'S' | 'LB' | 'DL';
/** The defense's eleven by group (the line: tackles and edges). */
export type OnField = Record<PassGroup, Player[]>;

export function depthBand(air: number): Band {
  return air < 0 ? 'behind' : air < 10 ? 'short' : air < 20 ? 'mid' : 'deep';
}

export function groupOf(p: Player): PassGroup {
  return p.position === 'CB' ? 'CB' : p.position === 'S' ? 'S' : p.position === 'LB' ? 'LB' : 'DL';
}

const ORDER: readonly PassGroup[] = ['CB', 'S', 'LB', 'DL'];

/** The group a man plays in on this snap: the lineup's list that holds him (a linebacker covering at end is the line). */
export function groupIn(onField: OnField, p: Player): PassGroup {
  return ORDER.find((g) => onField[g].includes(p)) ?? groupOf(p);
}

/** Where a pick changes hands: at the line when it's tipped there (short of the end zone), else where it was thrown. */
export function pickSpot(yardLine: number, air: number, tipped: boolean): number {
  return tipped ? Math.min(yardLine + 1, 99) : Math.min(yardLine + air, 100);
}

/**
 * Who intercepts it past the cover man, by depth: what's left of the NFL's split (n 124, 637, 651, 643: behind the line
 * CB 0.121, S 0.081, LB 0.379, the line 0.419; 0–9 0.400, 0.262, 0.309, 0.028; 10–19 0.438, 0.392, 0.164, 0.006; 20+ 0.431,
 * 0.535, 0.034, 0) once the cover man has his share (`COVER_PICKS`, of whom the engine's are mostly corners: 0.44, 0.59,
 * 0.75, 0.87 of them by depth). Behind the line the line tips it and the linebackers jump the screen; deep the safeties
 * are over the top.
 */
const PICK_GROUPS: Record<Band, Record<PassGroup, number>> = {
  behind: { CB: 0.015, S: 0.075, LB: 0.349, DL: 0.559 },
  short: { CB: 0.21, S: 0.414, LB: 0.318, DL: 0.056 },
  mid: { CB: 0.183, S: 0.631, LB: 0.175, DL: 0.011 },
  deep: { CB: 0.138, S: 0.852, LB: 0.01, DL: 0 },
};
/** The cover man's own share of the picks on his man, by depth (fitted with `PICK_GROUPS` on the NFL's split). */
export const COVER_PICKS: Record<Band, number> = { behind: 0.25, short: 0.5, mid: 0.45, deep: 0.4 };

/** Incompletions with a breakup credited, by depth, throwaways left out as this branch never sees one (FTN charting
 * 2022–25, n 2,149, 8,410, 5,505, 4,569: 0.355 of all, against 0.308 with throwaways counted). */
const BREAKUPS: Record<Band, number> = { behind: 0.456, short: 0.369, mid: 0.349, deep: 0.288 };
/**
 * Who's credited with them past the cover man, by depth: what's left of the NFL's (n 1,153, 3,941, 2,376, 1,633: behind
 * the line CB 0.071, S 0.078, LB 0.315, the line 0.536; 0–9 0.443, 0.166, 0.239, 0.153; 10–19 0.566, 0.250, 0.144, 0.040;
 * 20+ 0.658, 0.260, 0.071, 0.010) once he has his share (`COVER_BREAKS`; fitted on the engine's cover men).
 * The line's is a ball batted down at the line: a screen's often, a deep shot's hardly ever.
 */
const BREAK_GROUPS: Record<Band, Record<PassGroup, number>> = {
  behind: { CB: 0.006, S: 0.074, LB: 0.288, DL: 0.631 },
  short: { CB: 0.396, S: 0.222, LB: 0.098, DL: 0.306 },
  mid: { CB: 0.421, S: 0.433, LB: 0.079, DL: 0.089 },
  deep: { CB: 0.34, S: 0.56, LB: 0.0725, DL: 0.025 },
};
/** The cover man's own share of the breakups on his man, by depth (fitted with `BREAK_GROUPS` on the NFL's split). */
export const COVER_BREAKS: Record<Band, number> = { behind: 0.15, short: 0.5, mid: 0.55, deep: 0.6 };

/** The pick's return by depth (`returnBands.ts`): a jumped short route has nobody in front of it (pick-sixes 26.6%,
 * 18.4%), a deep pick is caught near his own goal (4.3%, 0.5%); the breakaway shares are fitted to those. */
const PICK_RETURNS: Record<Band, Bands> = {
  behind: { none: 0.22, short: 0.4, mid: 0.13, go: 0.95, tail: 4 },
  short: { none: 0.34, short: 0.22, mid: 0.13, go: 0.48, tail: 4 },
  mid: { none: 0.34, short: 0.24, mid: 0.16, go: 0.165, tail: 4 },
  deep: { none: 0.52, short: 0.13, mid: 0.14, go: 0.024, tail: 4 },
};

/** A pick credits its catcher with a pass defensed too (84% in the NFL's books). */
export const PICK_PD = 0.84;

/**
 * How hard a group's ball skills or coverage decide which of its men gets there: a pick goes to the ball hawk far more
 * than his rating's share (the league's leader picks off seven to ten a season), a breakup more evenly.
 */
export const CONTEST_POWER: Record<'ballSkills' | 'coverage', number> = { ballSkills: 4, coverage: 1 };

/** A man by weight on draw `u` in [0, 1). */
function weighted(men: Player[], weights: number[], u: number): Player {
  const total = weights.reduce((a, b) => a + b, 0);
  let at = u * total;
  for (let i = 0; i < men.length; i++) {
    if (at < weights[i]) return men[i];
    at -= weights[i];
  }
  return men[men.length - 1];
}

/**
 * A man of a group by `shares` over the groups with someone on the field (the cover man left out: his share is his own),
 * then by his `contest` within it on what's left of `u`; the line is the batter alone.
 */
function byGroup(
  shares: Record<PassGroup, number>,
  coverMan: Player,
  onField: OnField,
  batter: Player | null,
  contest: 'ballSkills' | 'coverage',
  u: number,
): Player {
  const men: Record<PassGroup, Player[]> = {
    CB: onField.CB.filter((p) => p !== coverMan),
    S: onField.S.filter((p) => p !== coverMan),
    LB: onField.LB.filter((p) => p !== coverMan),
    DL: batter && batter !== coverMan ? [batter] : [],
  };
  const groups = ORDER.filter((g) => men[g].length > 0 && shares[g] > 0);
  if (!groups.length) return coverMan;
  const total = groups.reduce((a, g) => a + shares[g], 0);
  let at = u * total;
  for (const g of groups) {
    if (at < shares[g] || g === groups[groups.length - 1]) {
      const within = Math.min(0.999999, Math.max(0, at / shares[g]));
      return weighted(
        men[g],
        men[g].map((p) => skill(p, contest) ** CONTEST_POWER[contest]),
        within,
      );
    }
    at -= shares[g];
  }
  return coverMan;
}

/** Who intercepts it: the cover man on `u1`, else a group by depth and a man of it by ball skills. */
export function pickCatcher(
  band: Band,
  coverMan: Player,
  onField: OnField,
  batter: Player | null,
  u1: number,
  u2: number,
): Player {
  if (u1 < COVER_PICKS[band]) return coverMan;
  return byGroup(PICK_GROUPS[band], coverMan, onField, batter, 'ballSkills', u2);
}

export function breakupRate(band: Band): number {
  return BREAKUPS[band];
}

/** Who's credited with a breakup: the cover man on `u1`, else a group and a man of it by coverage (the line: the batter). */
export function breakupBy(
  band: Band,
  coverMan: Player,
  onField: OnField,
  batter: Player | null,
  u1: number,
  u2: number,
): Player {
  if (u1 < COVER_BREAKS[band]) return coverMan;
  return byGroup(BREAK_GROUPS[band], coverMan, onField, batter, 'coverage', u2);
}

/** A rusher's weight to be the one in the throwing lane: tall men bat it, and the man who got the pressure is there. */
export function batterWeights(front: Player[], pressureBy: Player | null): number[] {
  return front.map((p) => Math.exp(0.5 * sizeZ(p).h) * (p === pressureBy ? 2 : 1));
}

export function pickBatter(front: Player[], pressureBy: Player | null, u: number): Player {
  return weighted(front, batterWeights(front, pressureBy), u);
}

/** How far a pick runs back on draw `u`, toward a goal line `toGoal` yards away. */
export function pickReturn(band: Band, toGoal: number, u: number): number {
  return bandReturn(PICK_RETURNS[band], toGoal, u);
}
