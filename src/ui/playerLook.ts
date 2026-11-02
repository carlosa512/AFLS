import { clamp } from '../engine/rng';
import { sizeZ } from '../engine/size';
import type { Player } from '../engine/types';
import { pick } from './staffLook';

// What a player's avatar looks like: the figure's paths, his build (from his weight), his head (picked once from
// his id) and, on the card, his height against his position. Only what the card already shows: no ratings.
// Each choice below was picked from rendered options (`docs/AVATARS.md`); don't undo one without a reason.

// Paths share one 100x100 box. The player faces straight away from the viewer.
// Football cues: tall, wide pads that overhang the arms; the pads lift the collar, so the head sits low.
const EARS =
  'M62.1 23.8 C65 23.2 66.1 26 65.6 29.3 C65.2 32.2 63.6 33.5 62.3 33.1 Z M37.9 23.8 C35 23.2 33.9 26 34.4 29.3 C34.8 32.2 36.4 33.5 37.7 33.1 Z';
const NECK = 'M41.6 34 C41.8 39.6 41 43.8 38 47.8 L62 47.8 C59 43.8 58.2 39.6 58.4 34 Z';
// thick neck, as wide as the jaw; soft shade under the skull and down each side
const NECK_SIDES =
  'M41.8 37 C42 40.6 41.4 44 38.8 47.6 L41.4 47.6 C42.8 44 43 40.6 42.8 37 Z M58.2 37 C58 40.6 58.6 44 61.2 47.6 L58.6 47.6 C57.2 44 57 40.6 57.2 37 Z';
const NECK_SHADE = 'M42 39.2 C46.6 42 53.4 42 58 39.2 L57.9 41.6 C53.4 43.8 46.6 43.8 42.1 41.6 Z';
// Two outlines of the left arm with the same commands, so a build can sit anywhere between them (`blend`): a smooth
// tube, and a muscled arm (triceps, a pinch at the elbow, the forearm). Both tuck under the pads, keep the same inner
// edge (`ARM_INNER`), run straight down, and end in a wrist and a hand at the hip: stretched past the ring instead,
// the forearm ran on with no end. The old single arm bowed out and tapered to a point.
const ARM_TUBE =
  'M9.6 60.6 C9 65.6 8.8 70.4 8.8 75.4 C8.9 77.2 9.1 78.9 9.3 80.6 C9.5 83.2 9.7 85.8 9.9 88.4 C10.3 92.2 10.6 96.2 11 100 C11.4 103 12.4 105.6 13.4 107.6 C13.6 110.6 14.2 114.4 16 116.2 C17.8 117.8 20.6 117.6 21.8 115.6 C22.6 113.6 22.4 110.6 21.8 107.8 C21.8 105 22.2 102.4 22.6 100 C22.2 96 21.8 92.4 21.6 88.6 C21.6 86 21.7 83.2 21.8 80.6 C22 77.6 22.4 74.6 23 71.8 C23.6 69.6 24.4 67.6 25.4 65.6 Z';
const ARM_MUSCLED =
  'M9.8 60.6 C6.2 64 5.6 70.4 7.2 75.4 C8.4 77.8 9.8 78.8 9.8 80.6 C9.4 82.6 8.4 85 8.8 88.4 C9.6 92.6 11.4 96.4 12.4 100 C12.8 103 13.4 105.6 13.8 107.6 C13.8 110.6 14.4 114.4 16.2 116.2 C18 117.8 20.8 117.6 22 115.6 C22.8 113.6 22.4 110.6 21.8 107.8 C21.6 105 22 102.4 22.4 100 C22 96.4 21.2 92.6 21.2 88.6 C21.2 85.2 22.8 82.8 23 80.6 C23 77.6 22.4 74.6 22.8 71.8 C23.4 69.2 24.4 67.4 25.4 65.6 Z';
/** The plain figure's arm, part way to muscled (the solid build's). */
const PLAIN_ARM = 0.4;
// the arm sits in shade under each pad's overhang
const SLEEVE_SHADOW =
  'M93.4 57.8 C90 59.8 84 60.6 78 60.2 L77.2 64.8 C83.6 65.2 89.6 63.8 92.4 61.4 Z M6.6 57.8 C10 59.8 16 60.6 22 60.2 L22.8 64.8 C16.4 65.2 10.4 63.8 7.6 61.4 Z';
// pads: a tall shelf whose outer edges stick out past the arms
const JERSEY =
  'M40.6 44.6 C44 47.8 56 47.8 59.4 44.6 C62.4 44.4 65.6 42.4 70 42 L82 42.2 C90 42.6 93.6 46.6 93.8 51.4 L93.8 57.8 C90 59.8 84 60.6 78 60.2 C77.4 64 77 66 76.6 68 C75.6 78 74.8 88 74 100 L26 100 C25.2 88 24.4 78 23.4 68 C23 66 22.6 64 22 60.2 C16 60.6 10 59.8 6.2 57.8 L6.2 51.4 C6.4 46.6 10 42.6 18 42.2 L30 42 C34.4 42.4 37.6 44.4 40.6 44.6 Z';
const COLLAR = 'M40.6 44.6 C44 47.8 56 47.8 59.4 44.6';
const PAD_GLOSS = 'M69.4 43.4 C75 42.4 83.4 42.6 89 44.6 M30.6 43.4 C25 42.4 16.6 42.6 11 44.6';
// two bands on each pad's outer face, the classic NFL sleeve stripe
const BANDS_UPPER = 'M79.8 53.4 C85.2 54.4 90.6 53.8 93.4 52 M20.2 53.4 C14.8 54.4 9.4 53.8 6.6 52';
const BANDS_LOWER = 'M79.6 56.6 C85 57.6 90.4 57 93.4 55.2 M20.4 56.6 C15 57.6 9.6 57 6.6 55.2';
// the jersey hangs off the bottom edge of the shoulder pads' back plate
const PAD_SHELF = 'M20 60.4 C34 64.6 66 64.6 80 60.4 L80 63.6 C66 67.8 34 67.8 20 63.6 Z';
const FOLDS =
  'M76.6 68 C74.6 78 73.6 88 74 100 L68 100 C69 88 71 78 76.6 68 Z M23.4 68 C25.4 78 26.4 88 26 100 L32 100 C31 88 29 78 23.4 68 Z';

export interface HeadShape {
  d: string;
  ears: string;
}
/** Three outlines from behind, picked once per player: today's blocky head, a wide round one, a long one. */
export const PLAYER_HEADS: readonly HeadShape[] = [
  {
    d: 'M50 10.4 C57.5 10.4 61.9 13.9 62.3 20.5 L62.5 32.4 C62.4 35.7 61.2 38.1 58.6 39.5 L57 40.3 L43 40.3 L41.4 39.5 C38.8 38.1 37.6 35.7 37.5 32.4 L37.7 20.5 C38.1 13.9 42.5 10.4 50 10.4 Z',
    ears: EARS,
  },
  {
    d: 'M50 11.4 C59.6 11.4 64.2 16.8 64.2 24.8 C64.2 32.2 61.6 37.6 57.4 40.2 L42.6 40.2 C38.4 37.6 35.8 32.2 35.8 24.8 C35.8 16.8 40.4 11.4 50 11.4 Z',
    ears: 'M63.6 23.8 C66.5 23.2 67.6 26 67.1 29.3 C66.7 32.2 65.1 33.5 63.8 33.1 Z M36.4 23.8 C33.5 23.2 32.4 26 32.9 29.3 C33.3 32.2 34.9 33.5 36.2 33.1 Z',
  },
  {
    d: 'M50 9.2 C56.4 9.2 60.2 12.6 60.4 19.2 L60.6 33.8 C60.4 37.6 58.6 39.8 55.4 40.6 L44.6 40.6 C41.4 39.8 39.6 37.6 39.4 33.8 L39.6 19.2 C39.8 12.6 43.6 9.2 50 9.2 Z',
    ears: 'M60.2 23.8 C63.1 23.2 64.2 26 63.7 29.3 C63.3 32.2 61.7 33.5 60.4 33.1 Z M39.8 23.8 C36.9 23.2 35.8 26 36.3 29.3 C36.7 32.2 38.3 33.5 39.6 33.1 Z',
  },
];

export type BuildName = 'lean' | 'athletic' | 'solid' | 'big' | 'heavy';
export interface Build {
  name: BuildName;
  /** This build runs up to (not including) this weight, in pounds. */
  under: number;
  /** How much wider the neck runs into the pads. */
  neck: number;
  /** How far the shoulder line rises toward the collar: heavier men carry their pads higher. */
  traps: number;
  /** How far his arm runs from the smooth tube (0) to the muscled one (1). */
  arm: number;
  /** The body's width at each height, as [y, scale] knots (linear between): pads, chest, belly, waist. */
  knots: readonly (readonly [number, number])[];
}
/**
 * Five builds by real weight, the same ruler for every position, so a 212 lb corner is drawn like a safety.
 * Every build has a waist, so even the heaviest reads as a man and not a wall; the light ones taper only a little,
 * or a receiver looks pinched. Heavier builds carry more muscle in the arm.
 */
export const BUILDS: readonly Build[] = [
  {
    name: 'lean',
    under: 205,
    neck: 0.88,
    traps: -0.6,
    arm: 0.25,
    knots: [
      [42, 0.83],
      [60, 0.83],
      [72, 0.81],
      [80, 0.8],
      [94, 0.79],
    ],
  },
  {
    name: 'athletic',
    under: 230,
    neck: 0.94,
    traps: 0,
    arm: 0.325,
    knots: [
      [42, 0.9],
      [60, 0.9],
      [72, 0.89],
      [80, 0.88],
      [94, 0.86],
    ],
  },
  {
    name: 'solid',
    under: 265,
    neck: 1,
    traps: 1,
    arm: 0.4,
    knots: [
      [42, 0.97],
      [60, 0.97],
      [72, 0.97],
      [80, 0.97],
      [94, 0.92],
    ],
  },
  {
    name: 'big',
    under: 295,
    neck: 1.08,
    traps: 2,
    arm: 0.475,
    knots: [
      [42, 1.03],
      [60, 1.03],
      [72, 1.07],
      [80, 1.08],
      [94, 1],
    ],
  },
  {
    name: 'heavy',
    under: Infinity,
    neck: 1.16,
    traps: 3,
    arm: 0.55,
    knots: [
      [42, 1.08],
      [60, 1.08],
      [72, 1.14],
      [80, 1.16],
      [94, 1.06],
    ],
  },
];

/** From this size an avatar shows his build and head (where the number appears); below it, everyone is alike. */
export const BUILD_MIN_PX = 32;
/** From this size (the card) he also stands taller or shorter. */
export const HEIGHT_MIN_PX = 96;
/**
 * A built figure is zoomed out about the collar, so the wide builds show their width inside the ring and the ring
 * crops the arm below the elbow, where its shape shows; then moved up, so the head sits near the top and the pants
 * show at the bottom.
 */
const ZOOM = 0.79;
const DROP = -4;
/**
 * The middle of the pants' waistband, at the hips, well under the number (the jersey runs long before it tucks in:
 * a belt just under the number read as slacks), and how far its sides lift above that, as the back of a waistband
 * curves.
 */
const PANTS_TOP = 104;
const PANTS_DIP = 4;
/** How much bigger he's drawn per sd of height over his position's median, from his feet, and how far it goes. */
const GROW_PER_SD = 0.026;
const GROW_SD_MAX = 2.5;
/** Arms keep a little more than today's gap at the waist, and the forearms swing out a touch (picked: "B"). */
const ARM_GAP = 1.3;
const ARM_SWING = 2;
/** How much of the body's width below the chest the arms follow: all of it bowed them out around a heavy man's belly. */
const ARM_FOLLOW = 0.3;
/** The plain figure's widest nameplate, in viewBox units. */
export const NAMEPLATE_MAX = 40;

export function buildOf(weightLb: number): Build {
  return BUILDS.find((b) => weightLb < b.under) ?? BUILDS[BUILDS.length - 1];
}

/** His head, for life: picked from his id (one id space covers players and prospects). */
export function headOf(player: Pick<Player, 'id'>): number {
  return pick(String(player.id), 'head', PLAYER_HEADS.length);
}

/** How much bigger (or smaller) he's drawn for his height against his position: 1 at the median. */
export function growOf(player: Pick<Player, 'position' | 'heightIn' | 'weightLb'>): number {
  return 1 + clamp(sizeZ(player).h, -GROW_SD_MAX, GROW_SD_MAX) * GROW_PER_SD;
}

type Knots = readonly (readonly [number, number])[];
function at(knots: Knots, y: number): number {
  if (y <= knots[0][0]) return knots[0][1];
  for (let i = 1; i < knots.length; i++) {
    const [y1, s1] = knots[i];
    const [y0, s0] = knots[i - 1];
    if (y <= y1) return s0 + ((s1 - s0) * (y - y0)) / (y1 - y0);
  }
  return knots[knots.length - 1][1];
}

/** Rewrites every point of a path made of absolute M, C, L and Z commands (all the figure uses). */
function warp(d: string, f: (x: number, y: number) => [number, number]): string {
  return d
    .replace(/([MCLZ])([^MCLZ]*)/g, (_, cmd: string, args: string) => {
      const n = args.trim() ? args.trim().split(/\s+/).map(Number) : [];
      const points: string[] = [];
      for (let i = 0; i < n.length; i += 2) {
        const [x, y] = f(n[i], n[i + 1]);
        points.push(`${+x.toFixed(2)} ${+y.toFixed(2)}`);
      }
      return points.length ? `${cmd}${points.join(' ')} ` : `${cmd} `;
    })
    .trim();
}

/** `a` part way to `b` (0 to 1): two paths with the same commands, each number mixed. */
function blend(a: string, b: string, t: number): string {
  const to = b.match(/-?\d+(\.\d+)?/g)!.map(Number);
  let i = 0;
  return a.replace(/-?\d+(\.\d+)?/g, (n) => {
    const v = Number(n) + (to[i++] - Number(n)) * t;
    return String(+v.toFixed(2));
  });
}
const armOf = (t: number) => blend(ARM_TUBE, ARM_MUSCLED, t);
const mirror = (d: string) => warp(d, (x, y) => [100 - x, y]);

// The paths stop at y 100. Zoomed out, or drawn shorter, that edge would show inside the circle, so it runs on.
const foot = (y: number) => (y >= 99.9 ? 120 : y);

/** Pads, jersey and shadows: the body's width at each height, the shoulder line rising toward the collar. */
const bodyAt =
  (b: Build) =>
  (x: number, y: number): [number, number] => {
    const d = Math.abs(x - 50);
    const traps = y < 50 ? b.traps * Math.max(0, 1 - Math.max(0, d - 10) / 25) : 0;
    return [50 + (x - 50) * at(b.knots, y), foot(y) - traps];
  };
/** The neck widens toward its base: a heavy man's neck runs straight into his traps. */
const neckAt =
  (b: Build) =>
  (x: number, y: number): [number, number] => {
    const s = 1 + (b.neck - 1) * Math.min(1, clamp((y - 34) / 12, 0, 1) * 0.6 + 0.4);
    return [50 + (x - 50) * s, y];
  };
// the jersey's side and the arm's inner edge, as distance from the middle, on the plain figure
const TORSO_EDGE: Knots = [
  [60, 28],
  [68, 26.6],
  [78, 25.5],
  [88, 24.7],
  [100, 24],
];
const ARM_INNER: Knots = [
  [65.6, 24.6],
  [70, 26],
  [76, 28.2],
  [82, 28.4],
  [88, 28.4],
  [94, 28],
  [100, 27.4],
];
/**
 * Arms ride the jersey's side in or out (mostly the chest's width: `ARM_FOLLOW`), keep their gap to it, and thicken
 * only a little (skinny arms read wrong).
 */
const armAt =
  (b: Build) =>
  (x: number, y: number): [number, number] => {
    const chest = at(b.knots, 60);
    const s = chest + (at(b.knots, y) - chest) * ARM_FOLLOW;
    const thick = 1 + (s - 1) * 0.35;
    const side = at(TORSO_EDGE, y);
    const inner = at(ARM_INNER, y);
    const out = (ARM_GAP - 1) * Math.max(0, inner - side) + (ARM_SWING * Math.max(0, y - 62)) / 38;
    const d = side * s + (inner - side) + out + (Math.abs(x - 50) - inner) * thick;
    // the arm ends in a hand, so it isn't stretched past the ring like the jersey
    return [50 + Math.sign(x - 50) * d, y];
  };

/**
 * Football pants from behind: a thin belt half hidden under the jersey's tuck, tight over the seat and the thigh
 * pads, two stripes down each side and a seam down the middle. Drawn to the build's width at the hips.
 */
function pantsOf(b: Build): Pants {
  const T = PANTS_TOP;
  const B = T + 30;
  const k = at(b.knots, 100);
  const L = (d: number) => 50 - d;
  const R = (d: number) => 50 + d;
  const pants = `M${L(24.2)} ${T} C40 ${T + 1.2} 60 ${T + 1.2} ${R(24.2)} ${T} C${R(25.6)} ${T + 3} ${R(26.8)} ${T + 6} ${R(27)} ${T + 10} L${R(26.6)} ${B} L${L(26.6)} ${B} L${L(27)} ${T + 10} C${L(26.8)} ${T + 6} ${L(25.6)} ${T + 3} ${L(24.2)} ${T} Z`;
  const belt = `M${L(24.3)} ${T - 0.6} C40 ${T + 0.6} 60 ${T + 0.6} ${R(24.3)} ${T - 0.6} L${R(24.5)} ${T + 1.2} C60 ${T + 2.4} 40 ${T + 2.4} ${L(24.5)} ${T + 1.2} Z`;
  // the jersey's tail, bloused a little over the belt, with a soft wavy hem
  const tuck = `M${L(24.2)} ${T - 3} C40 ${T - 1.6} 60 ${T - 1.6} ${R(24.2)} ${T - 3} L${R(24.6)} ${T - 0.2} C${R(20)} ${T + 1} 68 ${T + 0.4} 64 ${T + 1} C59 ${T + 1.7} 55 ${T + 0.7} 50 ${T + 1.2} C45 ${T + 0.7} 41 ${T + 1.7} 36 ${T + 1} C32 ${T + 0.4} ${L(20)} ${T + 1} ${L(24.6)} ${T - 0.2} Z`;
  const stripe = (sgn: number, a: number, w: number) => {
    const o = (d: number) => 50 + sgn * d;
    return `M${o(24.4 - a)} ${T + 1.6} C${o(25.6 - a)} ${T + 3.6} ${o(26.6 - a)} ${T + 6.4} ${o(26.8 - a)} ${T + 10} L${o(26.4 - a)} ${B} L${o(26.4 - a - w)} ${B} L${o(26.8 - a - w)} ${T + 10} C${o(26.6 - a - w)} ${T + 6.4} ${o(25.6 - a - w)} ${T + 3.6} ${o(24.4 - a - w)} ${T + 1.6} Z`;
  };
  // the waistband's sides lift (its middle stays at the hips), across the belt, the tuck, the stripes and the pants'
  // top edge; then everything is drawn to his width at the hips
  const dy = (x: number) => PANTS_DIP * (Math.max(0, 1 - ((x - 50) / 24.6) ** 2) - 1);
  const draw = (d: string, band: boolean) =>
    warp(d, (x, y) => [50 + (x - 50) * k, band || y <= T + 1.5 ? y + dy(x) : y]);
  return {
    pants: draw(pants, false),
    belt: draw(belt, true),
    tuck: draw(tuck, true),
    stripes: `${draw(stripe(-1, 0.3, 1.3), true)} ${draw(stripe(1, 0.3, 1.3), true)}`,
    stripesThin: `${draw(stripe(-1, 1.9, 0.8), true)} ${draw(stripe(1, 1.9, 0.8), true)}`,
    seam: draw(`M50 ${T + 1.4} L50 ${B}`, false),
    halfWidth: 27 * k,
  };
}

export interface Pants {
  pants: string;
  belt: string;
  tuck: string;
  stripes: string;
  stripesThin: string;
  seam: string;
  /** How far the pants reach either side of the middle, for their shading. */
  halfWidth: number;
}

export interface Figure {
  armL: string;
  armR: string;
  neck: string;
  neckSides: string;
  neckShade: string;
  jersey: string;
  padShelf: string;
  folds: string;
  padGloss: string;
  sleeveShadow: string;
  collar: string;
  bandsUpper: string;
  bandsLower: string;
  /** The head's shadow below the collar. */
  shadow: { cy: number; rx: number };
  /** How much of the number's usual width fits his back (the number keeps its height). */
  numberWidth: number;
  /** The widest his nameplate may run, in viewBox units. */
  plateMax: number;
  /** Below the ring on the plain figure, so only built figures wear them. */
  pants: Pants | null;
}

const PLAIN_ARM_L = armOf(PLAIN_ARM);
const PLAIN: Figure = {
  armL: PLAIN_ARM_L,
  armR: mirror(PLAIN_ARM_L),
  neck: NECK,
  neckSides: NECK_SIDES,
  neckShade: NECK_SHADE,
  jersey: JERSEY,
  padShelf: PAD_SHELF,
  folds: FOLDS,
  padGloss: PAD_GLOSS,
  sleeveShadow: SLEEVE_SHADOW,
  collar: COLLAR,
  bandsUpper: BANDS_UPPER,
  bandsLower: BANDS_LOWER,
  shadow: { cy: 48.6, rx: 11 },
  numberWidth: 1,
  plateMax: NAMEPLATE_MAX,
  pants: null,
};

function figureOf(b: Build): Figure {
  const body = (d: string) => warp(d, bodyAt(b));
  const neck = (d: string) => warp(d, neckAt(b));
  const arm = (d: string) => warp(d, armAt(b));
  const armL = armOf(b.arm);
  return {
    armL: arm(armL),
    armR: arm(mirror(armL)),
    neck: neck(NECK),
    neckSides: neck(NECK_SIDES),
    neckShade: neck(NECK_SHADE),
    jersey: body(JERSEY),
    padShelf: body(PAD_SHELF),
    folds: body(FOLDS),
    padGloss: body(PAD_GLOSS),
    sleeveShadow: body(SLEEVE_SHADOW),
    collar: body(COLLAR),
    bandsUpper: body(BANDS_UPPER),
    bandsLower: body(BANDS_LOWER),
    shadow: { cy: 48.6 - b.traps * 0.6, rx: 11 * b.neck },
    numberWidth: Math.min(1, at(b.knots, 78) / 0.9),
    plateMax: NAMEPLATE_MAX * Math.min(1, at(b.knots, 56)),
    pants: pantsOf(b),
  };
}
const FIGURES = new Map(BUILDS.map((b) => [b.name, figureOf(b)]));

export interface PlayerLook {
  /** Null in lists: today's plain figure. */
  build: BuildName | null;
  figure: Figure;
  head: HeadShape;
  /** The SVG transform for the figure (zoom and height), or undefined for the plain figure. */
  transform?: string;
}

/** How `player` is drawn at `size`: plain in lists, his build and head from 32px, his height too on the card. */
export function playerLook(
  player: Pick<Player, 'id' | 'position' | 'heightIn' | 'weightLb'>,
  size: number,
): PlayerLook {
  if (size < BUILD_MIN_PX) return { build: null, figure: PLAIN, head: PLAYER_HEADS[0] };
  const build = buildOf(player.weightLb);
  const grow = size >= HEIGHT_MIN_PX ? growOf(player) : 1;
  const girth = 1 / Math.sqrt(grow);
  return {
    build: build.name,
    figure: FIGURES.get(build.name)!,
    head: PLAYER_HEADS[headOf(player)],
    // moved up; height (and the girth that goes with it) from his feet, so the number never drops out of the ring;
    // then the zoom about the collar
    transform: `translate(0 ${DROP}) translate(50 100) scale(${+girth.toFixed(4)} ${+grow.toFixed(4)}) translate(-50 -100) translate(50 40) scale(${ZOOM}) translate(-50 -40)`,
  };
}
