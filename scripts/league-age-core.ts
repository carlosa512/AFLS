/**
 * Starters' ages and their next seasons, read the NFL's way (docs/research/league-age.md): a team-season's starters are
 * its top N at each position by the season's scrimmage snaps (K and P by games), N as `STARTERS`. The NFL's figures are
 * `scripts/research-aging.py`'s; the bands are the owner's (spec 2026-11-14-league-age-design.md).
 */
import { STARTERS } from '../src/engine/positions';
import type { League, Position } from '../src/engine/types';

export type AgeGroup = 'all' | 'long' | 'short';
export type AgeBand = '21-24' | '25-26' | '27-28' | '29' | '30' | '31' | '32';
export const AGE_BANDS: AgeBand[] = ['21-24', '25-26', '27-28', '29', '30', '31', '32'];
export interface Fate {
  n: number;
  keep: number;
  play: number;
  gone: number;
}
export type Starters = Map<number, { pos: Position; age: number }>;

/** Starters 2016–25: mean age (whole years), and the shares (%) 24 or younger and 31 or older. */
export const NFL_STARTER_AGE: Record<Position | 'ALL', { mean: number; young: number; old: number }> = {
  QB: { mean: 28.02, young: 32.5, old: 28.8 },
  RB: { mean: 25.15, young: 44.7, old: 4.1 },
  WR: { mean: 25.54, young: 41.6, old: 6.2 },
  TE: { mean: 26.57, young: 30.9, old: 11.9 },
  OL: { mean: 26.75, young: 26.7, old: 12.5 },
  DT: { mean: 26.67, young: 27.1, old: 11.1 },
  EDGE: { mean: 26.48, young: 32.0, old: 11.6 },
  LB: { mean: 26.3, young: 28.8, old: 8.8 },
  CB: { mean: 25.66, young: 41.1, old: 6.0 },
  S: { mean: 26.2, young: 32.3, old: 9.3 },
  K: { mean: 28.97, young: 18.8, old: 32.6 },
  P: { mean: 28.09, young: 22.9, old: 25.1 },
  ALL: { mean: 26.48, young: 32.2, old: 11.8 },
};

const row = (xs: [number, number][]) =>
  Object.fromEntries(AGE_BANDS.map((b, i) => [b, { keep: xs[i][0], gone: xs[i][1] }])) as Record<
    AgeBand,
    { keep: number; gone: number }
  >;
/**
 * A starter's next season, 2013–24 (%): still starting, and gone (off every roster: not on a 53 or a reserve list in any
 * week, and no snaps; a man still on a roster who plays no snaps is on it, as the NFL counts him).
 */
export const NFL_NEXT: Record<AgeGroup, Record<AgeBand, { keep: number; gone: number }>> = {
  all: row([
    [68.7, 2.2],
    [64.8, 2.9],
    [63.0, 4.6],
    [60.7, 9.1],
    [54.0, 14.2],
    [52.3, 11.8],
    [59.9, 15.3],
  ]),
  long: row([
    [70.3, 2.4],
    [64.8, 2.4],
    [64.8, 5.3],
    [61.8, 8.9],
    [54.4, 15.2],
    [44.9, 15.6],
    [53.6, 26.2],
  ]),
  short: row([
    [66.3, 1.8],
    [62.6, 3.4],
    [59.0, 3.7],
    [55.4, 10.4],
    [47.3, 15.2],
    [48.1, 11.4],
    [55.2, 11.4],
  ]),
};

/** The median age a starter left for good (off every roster two seasons running), 2013–23 (informational: small samples). */
export const NFL_EXIT_AGE: Record<Position, number> = {
  QB: 37,
  RB: 28,
  WR: 29,
  TE: 31,
  OL: 30,
  DT: 29,
  EDGE: 30,
  LB: 29,
  CB: 30,
  S: 30,
  K: 33.5,
  P: 30,
};

/** The owner's fail bands (2026-11-14): years for means, points for shares. */
export const AGE_WIDTH = {
  mean: 0.75,
  meanKP: 1.5,
  share: 8,
  shareWide: 10,
  allMean: 0.4,
  allShare: 4,
  keep: 7,
  gone: 6,
  bump: 0.15,
};
/** The warn band is this share of the fail band's width. */
export const WARN = 0.6;

export function bandFor(target: number, width: number): { usual: [number, number]; normal: [number, number] } {
  return {
    usual: [target - WARN * width, target + WARN * width],
    normal: [target - width, target + width],
  };
}

const LONG: Position[] = ['TE', 'OL', 'DT'];
const SHORT: Position[] = ['RB', 'WR', 'CB', 'EDGE', 'LB', 'S'];
export function ageGroupOf(pos: Position): 'long' | 'short' | null {
  return LONG.includes(pos) ? 'long' : SHORT.includes(pos) ? 'short' : null;
}

export function ageBandOf(age: number): AgeBand | null {
  if (age < 21 || age > 32) return null;
  if (age <= 24) return '21-24';
  if (age <= 26) return '25-26';
  if (age <= 28) return '27-28';
  return String(age) as AgeBand;
}

const kicks = (pos: Position) => pos === 'K' || pos === 'P';
const count = (league: League, id: number, season: number) => {
  const p = league.players[id];
  const s = p.stats[season];
  return (kicks(p.position) ? s?.gp : s?.snaps) ?? 0;
};

/** A season's starters, read at its end: each team's top N per position by snaps (K and P by games). */
export function seasonStarters(league: League, season: number): Starters {
  const groups = new Map<string, { id: number; n: number }[]>();
  for (const p of Object.values(league.players)) {
    if (p.retired || p.teamId === null) continue;
    const n = count(league, p.id, season);
    if (n <= 0) continue;
    const k = `${p.teamId}:${p.position}`;
    (groups.get(k) ?? groups.set(k, []).get(k)!).push({ id: p.id, n });
  }
  const out: Starters = new Map();
  for (const [k, xs] of groups) {
    const pos = k.slice(k.indexOf(':') + 1) as Position;
    xs.sort((a, b) => b.n - a.n);
    for (const x of xs.slice(0, STARTERS[pos])) out.set(x.id, { pos, age: league.players[x.id].age });
  }
  return out;
}

/** Everyone who played that season: snaps, or games for K and P. */
export function playedIn(league: League, season: number): Set<number> {
  const out = new Set<number>();
  for (const p of Object.values(league.players)) if (count(league, p.id, season) > 0) out.add(p.id);
  return out;
}

/** Everyone on a team now: on its 53 or a reserve list (the practice squad isn't a roster, as the NFL counts it). */
export function rosteredNow(league: League): Set<number> {
  const out = new Set<number>();
  for (const p of Object.values(league.players)) if (!p.retired && p.teamId !== null && !p.squad) out.add(p.id);
  return out;
}

/** A starter's next season: still starting, on a roster (any time that season) but not starting, or gone. */
export function nextSeason(
  starters: Starters,
  next: Starters,
  nextRostered: Set<number>,
): Record<AgeGroup, Partial<Record<AgeBand, Fate>>> {
  const out: Record<AgeGroup, Partial<Record<AgeBand, Fate>>> = { all: {}, long: {}, short: {} };
  for (const [id, { pos, age }] of starters) {
    const band = ageBandOf(age);
    if (!band) continue;
    const kind = next.has(id) ? 'keep' : nextRostered.has(id) ? 'play' : 'gone';
    const group = ageGroupOf(pos);
    for (const g of group ? (['all', group] as const) : (['all'] as const)) {
      const f = (out[g][band] ??= { n: 0, keep: 0, play: 0, gone: 0 });
      f.n++;
      f[kind]++;
    }
  }
  return out;
}

/** Add `b`'s counts into `a`. */
export function addFates(
  a: Record<AgeGroup, Partial<Record<AgeBand, Fate>>>,
  b: Record<AgeGroup, Partial<Record<AgeBand, Fate>>>,
): void {
  for (const g of Object.keys(b) as AgeGroup[])
    for (const [band, f] of Object.entries(b[g]) as [AgeBand, Fate][]) {
      const t = (a[g][band] ??= { n: 0, keep: 0, play: 0, gone: 0 });
      t.n += f.n;
      t.keep += f.keep;
      t.play += f.play;
      t.gone += f.gone;
    }
}

/** The age of each starter who was then off every roster for two seasons. */
export function exitAges(seasons: Starters[], rostered: Set<number>[]): Partial<Record<Position, number[]>> {
  const out: Partial<Record<Position, number[]>> = {};
  for (let i = 0; i + 2 < seasons.length; i++)
    for (const [id, { pos, age }] of seasons[i])
      if (!rostered[i + 1].has(id) && !rostered[i + 2].has(id)) (out[pos] ??= []).push(age);
  return out;
}
