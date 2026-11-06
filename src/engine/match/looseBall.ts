/**
 * The loose ball (spec: docs/superpowers/specs/2026-11-06-fumble-recoveries-design.md): once it's out, who gets it, who
 * on the defense is credited, and how far he runs it back. The situation decides who wins the ball (the NFL's recovery
 * rate doesn't carry from year to year: it's mostly luck); ratings decide nothing here. Recovered at the spot: a ball out
 * of bounds stays the offense's and is folded into the shares. This module draws nothing and reads no league.
 *
 * Every number is nflverse play-by-play, regular seasons 2021–25 (`scripts/research-fumbles.py`).
 */
import type { Player } from '../types';
import type { ContactKind } from './fumbleOdds';

export type LooseKind = ContactKind | 'sack';
/** Who on the defense: the secondary, the linebackers, the line (an edge rusher counts with the line). */
export type Group = 'DB' | 'LB' | 'DL';

/** The defense's share of fumbles, a ball a defender forced against one the carrier lost himself (n: 485/548 runs,
 * 583/79 catches, 747/63 sacks; a scramble's own, four in five seasons, takes a sack's). */
const RECOVERS: Record<LooseKind, { forced: number; own: number }> = {
  run: { forced: 0.6, own: 0.25 },
  catch: { forced: 0.54, own: 0.18 },
  scramble: { forced: 0.48, own: 0.35 },
  sack: { forced: 0.52, own: 0.35 },
};

export function defenseRecovers(kind: LooseKind, forced: boolean): number {
  return RECOVERS[kind][forced ? 'forced' : 'own'];
}

/** The man who forced it falls on it himself (the share of the defense's recoveries). */
export const FORCER_RECOVERS: Record<LooseKind, number> = { run: 0.1, catch: 0.13, scramble: 0.07, sack: 0.12 };

/** The rest by group (n: 383 runs, 288 catches, 28 scrambles, 358 sacks): a catch's ball downfield among the DBs, a
 * strip-sack's in the backfield among the linemen. */
const GROUPS: Record<LooseKind, Record<Group, number>> = {
  run: { DB: 0.38, LB: 0.2, DL: 0.42 },
  catch: { DB: 0.58, LB: 0.18, DL: 0.24 },
  scramble: { DB: 0.5, LB: 0.11, DL: 0.39 },
  sack: { DB: 0.13, LB: 0.16, DL: 0.71 },
};

export function recovererGroup(kind: LooseKind): Record<Group, number> {
  return GROUPS[kind];
}

const ORDER: readonly Group[] = ['DB', 'LB', 'DL'];
const without = (men: Player[], p: Player) => (men.includes(p) ? men.filter((m) => m !== p) : men);

/**
 * Who on the defense is credited: the man who forced it first (`u1`), else a group by `u2` over the play's split among
 * the groups with men on the field, and a man of that group evenly (where `u2` falls inside the group's share).
 */
export function pickRecoverer(
  kind: LooseKind,
  forcer: Player | null,
  onField: Record<Group, Player[]>,
  u1: number,
  u2: number,
): Player {
  if (forcer && u1 < FORCER_RECOVERS[kind]) return forcer;
  // Past his own share he's one of the rest no more: his share is all of his.
  if (forcer)
    onField = { DB: without(onField.DB, forcer), LB: without(onField.LB, forcer), DL: without(onField.DL, forcer) };
  const groups = ORDER.filter((g) => onField[g].length > 0);
  const total = groups.reduce((a, g) => a + GROUPS[kind][g], 0);
  let at = u2 * total;
  for (const g of groups) {
    const w = GROUPS[kind][g];
    if (at < w || g === groups[groups.length - 1]) {
      const men = onField[g];
      return men[Math.min(men.length - 1, Math.floor((Math.max(0, at) / w) * men.length))];
    }
    at -= w;
  }
  // Nobody on the field at all can't happen in a game; the forcer is still a defender.
  return forcer!;
}

/** Returns by group: shares of none (zero or less), 1–9, 10–19 and 20+ yards; of the 20+, the share that goes the
 * distance (a fumble run back has nobody in front of it: most of the NFL's long ones score), and the mean of the rest
 * past 20 (DB n 420: mean 6.7, 20+ 12%, touchdowns 8.1%; LB n 200: 4.2, 6%, 6.0%; D-line n 573: 2.7, 5%, 6.3%). */
const RETURNS: Record<Group, { none: number; short: number; mid: number; go: number; tail: number }> = {
  DB: { none: 0.64, short: 0.17, mid: 0.08, go: 0.64, tail: 4 },
  LB: { none: 0.69, short: 0.16, mid: 0.1, go: 0.72, tail: 4 },
  DL: { none: 0.8, short: 0.12, mid: 0.03, go: 0.64, tail: 4 },
};

/** How far he runs it back on draw `u`, never past the goal line `toGoal` yards away: reaching it is the touchdown. */
export function returnYards(group: Group, toGoal: number, u: number): number {
  const r = RETURNS[group];
  let y: number;
  if (u < r.none) y = 0;
  else if (u < r.none + r.short) y = 1 + Math.floor(((u - r.none) / r.short) * 9);
  else if (u < r.none + r.short + r.mid) y = 10 + Math.floor(((u - r.none - r.short) / r.mid) * 10);
  else {
    const f = (u - r.none - r.short - r.mid) / (1 - r.none - r.short - r.mid);
    y = f < r.go ? toGoal : Math.round(20 - r.tail * Math.log(Math.max(1e-9, 1 - (f - r.go) / (1 - r.go))));
  }
  return Math.min(y, Math.max(0, toGoal));
}
