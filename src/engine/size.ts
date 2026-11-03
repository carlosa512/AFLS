/**
 * Height and weight: each position's bell curve (from NFL combine percentiles, see
 * `docs/superpowers/specs/2026-10-27-player-size-design.md`), the roll that draws a new player's build, and what
 * that build says against his position. `sizeZ` is the only z-score in the codebase: everything that asks "is he big
 * for a corner?" goes through it, so a table change moves every reader at once.
 */
import { clamp, Rng } from './rng';
import type { Player, Position } from './types';

/**
 * [mean, sd] for height (inches) and weight (pounds) at each position, and `r`, how closely weight follows height
 * there. Fitted to real active rosters, 2020–24 (`docs/research/player-size-rosters.md`): a 53 runs tighter than the
 * combine, and the link varies by position (a nose tackle's weight barely follows his height, a receiver's does).
 */
export const SIZE: Record<Position, { h: [number, number]; w: [number, number]; r: number }> = {
  QB: { h: [74.7, 1.8], w: [221, 10], r: 0.62 },
  RB: { h: [71.0, 1.9], w: [217, 18], r: 0.65 },
  WR: { h: [72.5, 2.4], w: [199, 15], r: 0.74 },
  TE: { h: [76.6, 1.3], w: [250, 10], r: 0.38 },
  // One curve for tackles and interior linemen: the depth chart sends the long ones outside.
  OL: { h: [76.9, 1.5], w: [314, 14], r: 0.31 },
  DT: { h: [75.3, 1.5], w: [309, 18], r: 0.01 },
  EDGE: { h: [75.4, 1.6], w: [259, 22], r: 0.5 },
  LB: { h: [73.5, 1.3], w: [234, 9], r: 0.1 },
  CB: { h: [71.8, 1.6], w: [193, 9], r: 0.47 },
  S: { h: [72.1, 1.5], w: [204, 8], r: 0.44 },
  K: { h: [72.0, 2.1], w: [195, 16], r: 0.53 },
  P: { h: [74.2, 2.0], w: [211, 17], r: 0.48 },
};

/** The founding league's bounds: the real rosters' extremes over the same five seasons, in inches and pounds. */
export const BOUNDS: Record<Position, { h: [number, number]; w: [number, number] }> = {
  QB: { h: [70, 79], w: [194, 245] },
  RB: { h: [66, 76], w: [176, 311] },
  WR: { h: [66, 78], w: [153, 247] },
  TE: { h: [72, 80], w: [215, 285] },
  OL: { h: [73, 81], w: [260, 380] },
  DT: { h: [71, 80], w: [252, 379] },
  EDGE: { h: [71, 80], w: [205, 342] },
  LB: { h: [70, 77], w: [209, 260] },
  CB: { h: [68, 77], w: [158, 218] },
  S: { h: [68, 76], w: [178, 225] },
  K: { h: [67, 77], w: [156, 232] },
  P: { h: [70, 78], w: [176, 250] },
};

/**
 * Real rosters' heights, inch by inch (`docs/research/player-size-rosters.md`): `[shortest, counts]`, the players at
 * each inch from the shortest up, five seasons pooled. Real rosters thin out at the ends faster than a bell curve does
 * and lean one way (13 corners a season at 5'9", one at 5'8"), so heights are drawn from these shares, not a curve:
 * on a curve a 25-season league ran 5.8 receivers a season at 6'6" against a real 0.8. One gap inside a range (no tight
 * end listed at 6'1") is filled with a single player: a quirk of five seasons, not a height the league can't have.
 */
export const HEIGHTS: Record<Position, [number, readonly number[]]> = {
  QB: [70, [6, 8, 7, 63, 67, 69, 54, 30, 20, 1]],
  RB: [66, [6, 9, 30, 73, 111, 110, 105, 71, 29, 21, 2]],
  WR: [66, [3, 6, 47, 54, 70, 80, 121, 154, 134, 70, 76, 22, 4]],
  TE: [72, [4, 1, 25, 70, 142, 137, 94, 21, 8]],
  OL: [73, [13, 46, 171, 304, 332, 260, 81, 65, 7]],
  DT: [71, [2, 18, 48, 95, 186, 146, 70, 19, 13, 3]],
  EDGE: [71, [5, 49, 69, 140, 282, 222, 186, 65, 26, 4]],
  LB: [70, [2, 32, 106, 140, 172, 93, 22, 11]],
  CB: [68, [5, 66, 114, 158, 179, 138, 83, 30, 5, 1]],
  S: [68, [4, 22, 65, 143, 159, 140, 63, 28, 14]],
  K: [67, [2, 5, 10, 22, 22, 39, 24, 16, 8, 5, 6]],
  P: [70, [3, 13, 16, 30, 33, 17, 22, 27, 1]],
};

/** The share of real rosters' players at `pos` who stand `inch` tall (0 past the real range). */
export function heightShare(pos: Position, inch: number): number {
  const [lo, counts] = HEIGHTS[pos];
  const n = counts[inch - lo] ?? 0;
  return n / counts.reduce((a, b) => a + b, 0);
}

/**
 * The arrival tier's inch past each real extreme, as a share of the end inch it sits beside: a sliver, so the rare
 * build turns up about once a decade at a position. At 0.2 a long run carried 3.6 linebackers a season past the real
 * 6'5" (their top inch is a crowded one, so its sliver ran large), against the check's 1.5.
 */
export const ARRIVAL_SLICE = 0.1;

/** A tier's heights as `[inch, weight]` pairs, shortest first: the real shares, and for arrivals a sliver past each end. */
function heightTable(pos: Position, tier: SizeTier): [number, number][] {
  const [lo, counts] = HEIGHTS[pos];
  const rows: [number, number][] = counts.map((n, i) => [lo + i, n]);
  if (tier === 'arrival') {
    rows.unshift([lo - ARRIVAL_STEP.h, ARRIVAL_SLICE * counts[0]]);
    rows.push([lo + counts.length - 1 + ARRIVAL_STEP.h, ARRIVAL_SLICE * counts[counts.length - 1]]);
  }
  return rows;
}

/**
 * A height from the uniform `u`, and where inside its inch `u` fell (0–1): the inch by the tier's shares, the place
 * inside it so weight can follow height smoothly rather than in whole-inch steps.
 */
function drawHeight(u: number, pos: Position, tier: SizeTier): { inch: number; within: number } {
  const rows = heightTable(pos, tier);
  const total = rows.reduce((a, [, n]) => a + n, 0);
  let at = u * total;
  for (const [inch, n] of rows) {
    if (at < n) return { inch, within: at / n };
    at -= n;
  }
  return { inch: rows[rows.length - 1][0], within: 1 };
}

/**
 * How much further out a player who arrives after the league is built may be: draft classes, the Pathway, squad and
 * depth signings. One inch of height, where the rare build comes from (`ARRIVAL_SLICE`); no weight past the real
 * extremes, since a weight curve's tails ran past them for 0.4-2.3% of arrivals at most positions, more players past
 * the real range in a long run than the real rosters ever carried.
 */
export const ARRIVAL_STEP = { h: 1, w: 0 };

/** Founding players (`createLeague`) or everyone after them. */
export type SizeTier = 'founding' | 'arrival';

/** The smallest and largest build a position allows in a tier, in whole inches and pounds. */
export function sizeLimits(pos: Position, tier: SizeTier = 'arrival'): { h: [number, number]; w: [number, number] } {
  const { h, w } = BOUNDS[pos];
  if (tier === 'founding') return { h: [...h], w: [...w] };
  return {
    h: [h[0] - ARRIVAL_STEP.h, h[1] + ARRIVAL_STEP.h],
    w: [w[0] - ARRIVAL_STEP.w, w[1] + ARRIVAL_STEP.w],
  };
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

/** The standard normal CDF (Abramowitz–Stegun 7.1.26 erf, accurate to about 1e-7). */
function normCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const erf =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** The standard normal's inverse CDF (Acklam's rational approximation, accurate to about 1e-9). */
function normInv(p: number): number {
  const a = [
    -39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239,
  ];
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572];
  const c = [
    -0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968,
    2.938163982698783,
  ];
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416];
  const lo = 0.02425;
  if (p < lo) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  if (p > 1 - lo) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return (
      -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
    );
  }
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  );
}

/**
 * A z-score from the uniform `u`, on a normal (`mean`, `sd`) cut off at whole-number bounds: the bounds widen by half a
 * unit so rounding lands inside, and the draw is mapped into that window's slice of the CDF rather than clamped onto
 * a bound, so no bound collects the tail past it.
 */
function truncated(u: number, mean: number, sd: number, [lo, hi]: [number, number]): number {
  const a = normCdf((lo - 0.5 - mean) / sd);
  const b = normCdf((hi + 0.5 - mean) / sd);
  const p = clamp(a + u * (b - a), Number.EPSILON, 1 - Number.EPSILON);
  return normInv(p);
}

/**
 * A new player's build: height from his position's real shares, then weight from the curve given that height, cut off
 * at the tier's bounds. Two draws, as the old roll cost, so everything drawn after him (names, jerseys) keeps its place
 * in the stream.
 */
export function rollSize(rng: Rng, pos: Position, tier: SizeTier = 'arrival'): { heightIn: number; weightLb: number } {
  const u1 = rng.next();
  const u2 = rng.next();
  const { h, w, r } = SIZE[pos];
  const lim = sizeLimits(pos, tier);
  const { inch, within } = drawHeight(u1, pos, tier);
  const zh = (inch - 0.5 + within - h[0]) / h[1];
  const wMean = w[0] + r * w[1] * zh;
  const wSd = w[1] * Math.sqrt(1 - r * r);
  const zw = truncated(u2, wMean, wSd, lim.w);
  return { heightIn: inch, weightLb: clamp(Math.round(wMean + wSd * zw), lim.w[0], lim.w[1]) };
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

/**
 * The rusher's side of a pass-rush matchup. Inside, the shorter man wins the leverage; outside, a short tackle gives
 * up the corner (the rusher's speed is already in his rush, so length is the tackle's build alone).
 */
function rushEdge(rusher: Build, blocker: Build, lever: 'edgeLength' | 'leverage'): number {
  if (lever === 'leverage') return points(devH(blocker) - devH(rusher), FULL_LINE_HEIGHT);
  return points(-devH(blocker), FULL_LINE_HEIGHT);
}

/**
 * What `p`'s build is worth against `opp` at one moment, in rating points (positive helps `p`). Zero when both sit at
 * their positions' medians; the same gap the other way round is the same edge the other way. A player who plays
 * bigger than his size, on either side, gives up half of what he'd lose, and gains nothing extra. In the pass rush
 * `p` is the rusher and `opp` the blocker.
 */
export function sizeEdge(p: Player, lever: Lever, opp?: Player): number {
  let e: number;
  if (lever === 'lanes') e = points(devH(p), FULL_QB_HEIGHT);
  else if (!opp) return 0;
  else if (lever === 'contested') e = points(devH(p) - devH(opp), FULL_HEIGHT);
  else if (lever === 'press' || lever === 'contact') e = points(devW(p) - devW(opp), FULL_WEIGHT);
  else e = rushEdge(p, opp, lever);
  if (e < 0 && p.playsBig) e /= 2;
  else if (e > 0 && opp?.playsBig) e /= 2;
  // `+ 0` turns a median's -0 into 0.
  return e + 0;
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

/** How far out (sd) an old flat roll's standing may land: the pre-real-rosters tail, kept for that one move. */
const OLD_SAVE_TAIL = 2.5;

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
    return clamp(Math.round(mean + sd * clamp(z, -OLD_SAVE_TAIL, OLD_SAVE_TAIL)), a, b);
  };
  p.heightIn = move(p.heightIn, hMin, hMax, SIZE[p.position].h, lim.h);
  p.weightLb = move(p.weightLb, wMin, wMax, SIZE[p.position].w, lim.w);
}
