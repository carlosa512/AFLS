/**
 * Height and weight: each position's bell curve (from NFL combine percentiles, see
 * `docs/superpowers/specs/2026-10-27-player-size-design.md`), the roll that draws a new player's build, and what
 * that build says against his position. `sizeZ` is the only z-score in the codebase: everything that asks "is he big
 * for a corner?" goes through it, so a table change moves every reader at once.
 */
import { clamp, Rng } from './rng';
import type { Player, Position } from './types';

/** [mean, sd] for height (inches) and weight (pounds) at each position. */
export const SIZE: Record<Position, { h: [number, number]; w: [number, number] }> = {
  QB: { h: [74.5, 2.0], w: [223, 17] },
  RB: { h: [70.5, 2.3], w: [214, 17] },
  WR: { h: [72.5, 2.7], w: [200, 19] },
  TE: { h: [76.5, 2.0], w: [255, 16] },
  // One curve for tackles and interior linemen: the depth chart sends the long ones outside.
  OL: { h: [76.75, 2.2], w: [313, 18] },
  DT: { h: [75.5, 2.3], w: [310, 19] },
  EDGE: { h: [76.5, 2.0], w: [277, 21] },
  LB: { h: [74.5, 2.0], w: [245, 16] },
  CB: { h: [72.0, 2.3], w: [195, 14] },
  S: { h: [72.5, 2.3], w: [210, 16] },
  K: { h: [72.0, 1.8], w: [200, 12] },
  P: { h: [74.5, 1.8], w: [212, 11] },
};

/** How far out a build can be: 2.5 sd keeps the 5'8" corner (about 1 in 50) and rules out the 5'2" one. */
const TAIL = 2.5;
/** How closely weight follows height within a position: tall players run heavier, with room for the lean one. */
const HEIGHT_WEIGHT = 0.5;

/** The smallest and largest build a position allows, in whole inches and pounds. */
export function sizeLimits(pos: Position): { h: [number, number]; w: [number, number] } {
  const range = ([mean, sd]: [number, number]): [number, number] => [
    Math.ceil(mean - TAIL * sd),
    Math.floor(mean + TAIL * sd),
  ];
  return { h: range(SIZE[pos].h), w: range(SIZE[pos].w) };
}

/** How many sd a build sits from the median at `pos` (his own position unless asked about another). */
export function sizeZ(
  p: Pick<Player, 'position' | 'heightIn' | 'weightLb'>,
  pos: Position = p.position,
): { h: number; w: number } {
  const { h, w } = SIZE[pos];
  return { h: (p.heightIn - h[0]) / h[1], w: (p.weightLb - w[0]) / w[1] };
}

/** Out in a tail: the builds scouts write about and the rare gem comes from. */
export function isOutlier(p: Pick<Player, 'position' | 'heightIn' | 'weightLb'>, pos?: Position): boolean {
  const z = sizeZ(p, pos);
  return Math.abs(z.h) > 1.3 || Math.abs(z.w) > 1.3;
}

/**
 * A new player's build. One Box–Muller pair gives both numbers, so a player costs the stream the same two draws the
 * old flat rolls did and everything drawn after him (names, jerseys) is unchanged.
 */
export function rollSize(rng: Rng, pos: Position): { heightIn: number; weightLb: number } {
  const u = rng.next() || Number.EPSILON;
  const theta = 2 * Math.PI * rng.next();
  const r = Math.sqrt(-2 * Math.log(u));
  const zh = r * Math.cos(theta);
  const zw = HEIGHT_WEIGHT * zh + Math.sqrt(1 - HEIGHT_WEIGHT ** 2) * r * Math.sin(theta);
  const { h, w } = SIZE[pos];
  const lim = sizeLimits(pos);
  const at = ([mean, sd]: [number, number], z: number, [lo, hi]: [number, number]) =>
    clamp(Math.round(mean + sd * clamp(z, -TAIL, TAIL)), lo, hi);
  return { heightIn: at(h, zh, lim.h), weightLb: at(w, zw, lim.w) };
}

/** The moments size decides on the field (see the spec's phase 2 table). */
export type Lever = 'contested' | 'press' | 'edgeLength' | 'leverage' | 'contact' | 'lanes';

/** Most a build is worth at one moment, in rating points: a modifier, never a gate. */
export const EDGE_CAP = 2;
/** How far apart two builds must be for the full edge: about two sd. */
const FULL_HEIGHT = 5;
const FULL_LINE_HEIGHT = 4.4;
const FULL_WEIGHT = 30;
const FULL_QB_HEIGHT = 4;

type Build = Pick<Player, 'position' | 'heightIn' | 'weightLb'>;
/** Inches or pounds over his own position's median: two medians are level whatever their positions. */
const devH = (p: Build) => p.heightIn - SIZE[p.position].h[0];
const devW = (p: Build) => p.weightLb - SIZE[p.position].w[0];
const points = (gap: number, full: number) => clamp((EDGE_CAP * gap) / full, -EDGE_CAP, EDGE_CAP);

/** The rusher's side of a pass-rush matchup: what his build (and his speed, for length) wins against the blocker. */
function rushEdge(rusher: Player, blocker: Build, lever: 'edgeLength' | 'leverage'): number {
  if (lever === 'leverage') return points(devH(blocker) - devH(rusher), FULL_LINE_HEIGHT);
  // A short-armed tackle loses to speed most: the faster the rusher, the more a missing inch costs.
  const speed = clamp((rusher.ratings.speed - 6) / 8, 0.5, 1.5);
  return points(-devH(blocker) * speed, FULL_LINE_HEIGHT);
}

/**
 * What `p`'s build is worth against `opp` at one moment, in rating points (positive helps `p`). Zero when both sit at
 * their positions' medians; the same gap the other way round is the same edge the other way. A player who plays
 * bigger than his size gives up half of what he'd lose, and gains nothing extra.
 */
export function sizeEdge(p: Player, lever: Lever, opp?: Player): number {
  let e: number;
  if (lever === 'lanes') e = points(devH(p), FULL_QB_HEIGHT);
  else if (!opp) return 0;
  else if (lever === 'contested') e = points(devH(p) - devH(opp), FULL_HEIGHT);
  else if (lever === 'press' || lever === 'contact') e = points(devW(p) - devW(opp), FULL_WEIGHT);
  else e = p.position === 'OL' ? -rushEdge(opp, p, lever) : rushEdge(p, opp, lever);
  // `+ 0` turns a median's -0 into 0.
  return (e < 0 && p.playsBig ? e / 2 : e) + 0;
}

/** The line's weight against the front's, from the offense's side: who moves whom at the point of attack. */
export function massEdge(line: readonly Build[], front: readonly Build[]): number {
  if (!line.length || !front.length) return 0;
  const mean = (ps: readonly Build[]) => ps.reduce((n, p) => n + devW(p), 0) / ps.length;
  return points(mean(line) - mean(front), FULL_WEIGHT);
}

/** How many outliers play bigger than their size. */
const GEM_RATE = 0.25;

/**
 * Whether an outlier build plays bigger than it is: drawn from the player's own stream (like his combine), so a new
 * league and a migrated save give the same answer and the league's stream never moves.
 */
export function rollGem(
  p: Pick<Player, 'id' | 'firstName' | 'lastName' | 'position' | 'heightIn' | 'weightLb'>,
): boolean {
  return isOutlier(p) && new Rng(`gem:${p.id}:${p.firstName} ${p.lastName}`).next() < GEM_RATE;
}

/**
 * What the front's builds win in the pass rush against this line, in rating points from the defense's side: each end
 * against the tackle across from him (RE on the left tackle, LE on the right; `ol` in spot order LT, LG, C, RG, RT),
 * each tackle against the guards and center. Missing players are skipped; an empty matchup is level.
 */
export function rushSizeEdge(ol: readonly Player[], edge: readonly Player[], dt: readonly Player[]): number {
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const tackles = [ol[0], ol[4]];
  const outside = edge.flatMap((e, i) => (tackles[i] ? [sizeEdge(e, 'edgeLength', tackles[i])] : []));
  const interior = ol.slice(1, 4);
  const inside = dt.flatMap((d) => interior.map((b) => sizeEdge(d, 'leverage', b)));
  return (mean(outside) + mean(inside)) / 2 + 0;
}

/** A median build at `pos` with an ordinary step: the opponent a depth-chart spot faces on a typical Sunday. */
export function typicalAt(pos: Position): Player {
  return { position: pos, heightIn: SIZE[pos].h[0], weightLb: SIZE[pos].w[0], ratings: { speed: 12 } } as Player;
}
