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

/** Who intercepts it, by depth (n 124, 637, 651, 643): behind the line the line tips it and the linebackers jump the
 * screen; deep the safeties are over the top. */
const PICK_GROUPS: Record<Band, Record<PassGroup, number>> = {
  behind: { CB: 0.121, S: 0.081, LB: 0.379, DL: 0.419 },
  short: { CB: 0.4, S: 0.262, LB: 0.309, DL: 0.028 },
  mid: { CB: 0.438, S: 0.392, LB: 0.164, DL: 0.006 },
  deep: { CB: 0.431, S: 0.535, LB: 0.034, DL: 0 },
};
/** The cover man's own share of the picks on his man, by depth (fitted so the groups land on `PICK_GROUPS`). */
export const COVER_PICKS: Record<Band, number> = { behind: 0.5, short: 0.6, mid: 0.6, deep: 0.5 };

/** Incompletions with a breakup credited, by depth (n 3,234, 12,496, 7,835, 5,998). */
const BREAKUPS: Record<Band, number> = { behind: 0.357, short: 0.315, mid: 0.304, deep: 0.273 };
/** Who's credited with them (n 9,103): the line's share is a ball batted down at the line. */
const BREAK_GROUPS: Record<PassGroup, number> = { CB: 0.467, S: 0.194, LB: 0.193, DL: 0.146 };
/** The cover man's own share of the breakups on his man, by depth (fitted so the groups land on `BREAK_GROUPS`). */
export const COVER_BREAKS: Record<Band, number> = { behind: 0.55, short: 0.55, mid: 0.55, deep: 0.55 };

/** The pick's return by depth (`returnBands.ts`): a jumped short route has nobody in front of it (pick-sixes 26.6%,
 * 18.4%), a deep pick is caught near his own goal (4.3%, 0.5%); the breakaway shares are fitted to those. */
const PICK_RETURNS: Record<Band, Bands> = {
  behind: { none: 0.22, short: 0.4, mid: 0.13, go: 0.6, tail: 4 },
  short: { none: 0.34, short: 0.22, mid: 0.13, go: 0.6, tail: 4 },
  mid: { none: 0.34, short: 0.24, mid: 0.16, go: 0.6, tail: 4 },
  deep: { none: 0.52, short: 0.13, mid: 0.14, go: 0.6, tail: 4 },
};

/** A pick credits its catcher with a pass defensed too (84% in the NFL's books). */
export const PICK_PD = 0.84;

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
        men[g].map((p) => skill(p, contest)),
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
  return byGroup(BREAK_GROUPS, coverMan, onField, batter, 'coverage', u2);
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
