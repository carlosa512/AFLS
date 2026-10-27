/**
 * Height and weight: each position's bell curve (from NFL combine percentiles, see
 * `docs/superpowers/specs/2026-10-27-player-size-design.md`), the roll that draws a new player's build, and what
 * that build says against his position. `sizeZ` is the only z-score in the codebase: everything that asks "is he big
 * for a corner?" goes through it, so a table change moves every reader at once.
 */
import { clamp, type Rng } from './rng';
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

/**
 * The flat ranges builds were rolled from before 0.2.2 (`[minH, maxH, minW, maxW]`, every value equally likely). Kept
 * only to move an older save's players onto the curves (`toCurve`).
 */
export const FLAT_BODY: Record<Position, [number, number, number, number]> = {
  QB: [72, 78, 205, 245],
  RB: [67, 73, 190, 235],
  WR: [69, 77, 175, 225],
  TE: [75, 79, 240, 265],
  OL: [75, 80, 295, 340],
  DT: [73, 78, 290, 335],
  EDGE: [74, 79, 245, 280],
  LB: [72, 76, 225, 255],
  CB: [69, 74, 180, 205],
  S: [70, 75, 195, 220],
  K: [69, 75, 180, 220],
  P: [72, 77, 195, 230],
};

/**
 * An older save's player, moved from his flat roll to the same standing on his position's curve: how far up the flat
 * range he sat becomes as many sd from the median, so every player keeps his rank and the league is centred on the
 * medians the matchup edges are measured from. His hidden traits and combine are stored, so nothing else moves.
 */
export function toCurve(p: Player): void {
  const [hMin, hMax, wMin, wMax] = FLAT_BODY[p.position];
  const lim = sizeLimits(p.position);
  const move = (x: number, lo: number, hi: number, [mean, sd]: [number, number], [a, b]: [number, number]) => {
    // A whole-number uniform roll: its mean and its spread.
    const z = (x - (lo + hi) / 2) / Math.sqrt(((hi - lo + 1) ** 2 - 1) / 12);
    return clamp(Math.round(mean + sd * clamp(z, -TAIL, TAIL)), a, b);
  };
  p.heightIn = move(p.heightIn, hMin, hMax, SIZE[p.position].h, lim.h);
  p.weightLb = move(p.weightLb, wMin, wMax, SIZE[p.position].w, lim.w);
}
