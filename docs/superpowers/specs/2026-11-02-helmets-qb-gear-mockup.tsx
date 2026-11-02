/** @jsxRuntime automatic */
/** @jsxImportSource react */
/**
 * Reference only, not built (outside tsconfig's `include`): the mockup source behind
 * `2026-11-02-helmets-qb-gear-design.md`, as of round 11. Every shell path, detail, decal spot and fit number in the
 * spec is here. Rebuild the page from the repo root:
 *   npx tsx docs/superpowers/specs/2026-11-02-helmets-qb-gear-mockup.tsx out.html
 *
 * Its keys are the mockups' working names, taken from the helmets each shell was drawn from; the game uses the spec's:
 *   axiom → modern, axiomLite → modernSmooth, f7 → plated, veng → classic, zero2 → pod, zero2t → podWide,
 *   ridge → ridgeback, oldmod → retro. (f7r5, f7r6, vengR5 and vengR6 are earlier plates; xr and facet were dropped.)
 * Leftovers from earlier rounds the spec doesn't use: the round-1 shell (`r1`), hair (`HairLayer`), round 5's hook masks
 * and round 6's hanging strap ends (`legacy`, `tails`).
 */
// Throwaway, round 2: an Axiom-style shell, hair under the helmet, the QB sleeve's pad turned out onto the elbow, the
// wristband's card turned out and moved up. Drawn on the real avatar figure. Not game code.
import { writeFileSync } from 'node:fs';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { GearLayer } from '../../../src/ui/gearArt';
import { contrast, kitFor, readableOn, shade, tint } from '../../../src/ui/color';
import { buildOf, playerLook, type Figure } from '../../../src/ui/playerLook';
import type { Gear } from '../../../src/engine/types';

const SKIN = '#3E4A59';
const PLATE_EM = 0.52;
const VENT = '#101215';

type Pos = 'QB' | 'RB' | 'WR' | 'TE' | 'OL' | 'DT' | 'EDGE' | 'LB' | 'CB' | 'S' | 'K' | 'P';
interface Guy {
  id: number;
  position: Pos;
  heightIn: number;
  weightLb: number;
  jersey: number;
  lastName: string;
  gear: Gear;
}
interface Colors {
  primary: string;
  secondary: string;
}
type Cage = 'none' | 'qb' | 'skill' | 'hybrid' | 'line' | 'kicker';
/** Round 1's classic shell, kept for comparison; the Axiom-style shell at two levels of detail. */
type Model =
  | 'axiom'
  | 'axiomLite'
  | 'f7'
  | 'f7r5'
  | 'f7r6'
  | 'veng'
  | 'vengR5'
  | 'vengR6'
  | 'xr'
  | 'zero2'
  | 'zero2t'
  | 'ridge'
  | 'facet'
  | 'oldmod';
interface Helmet {
  model: Model;
  shell: string;
  finish: 'gloss' | 'matte' | 'metal';
  stripe: 'none' | 'single' | 'double' | 'triple';
  a?: string;
  b?: string;
  number?: { ink: string; trim: string };
  bumper: string;
  cage: Cage;
  mask: string;
  /** Size against round 2's shell (1), scaled about the middle of the head. */
  scale?: number;
  /** Round 5's look: black clips at the sides and hook-shaped mask bars. */
  legacy?: boolean;
  /** Round 6's hanging strap ends instead of the clips. */
  tails?: boolean;
  /** Flag decals on the lower back, left to right: the US flag, then a Pathway player's country. */
  flags?: string[];
  /** The green dot: the helmet with the coach's radio (the quarterback, the defence's play-caller). */
  dot?: boolean;
  /** The chin strap's colour (its loose ends hang off the sides). */
  strap?: string;
  /** Also draw the chin strap running down to the chin, behind the neck. */
  chin?: boolean;
  /** How far it sits lower (+) or higher (-) on his head, in the figure's units. */
  lift?: number;
}
type HairStyle = 'locs' | 'longLocs' | 'braids' | 'flow' | 'ponytail' | 'curls';
interface Hair {
  style: HairStyle;
  color: string;
  tips?: string;
}
type SleeveKind = 'hex' | 'elbow';
interface QbSleeve {
  kind: SleeveKind;
  color: string;
  pad: string;
  /** Where the pad sits around the arm: 0 straight at us, 90 on the outer edge (degrees). */
  turn: number;
}
interface Wrist {
  band: string;
  trim: string;
  /** The band's top and bottom on the arm. */
  y: [number, number];
  /** Where the card's centre sits around the arm: 0 straight at us, -90 the outer edge (degrees); null = round 1's flat card. */
  turn: number | null;
}
interface Opts {
  guy: Guy;
  colors: Colors;
  size: number;
  away?: boolean;
  helmet?: Helmet;
  hair?: Hair;
  qb?: QbSleeve;
  wrist?: Wrist;
  view?: string;
  px?: number;
}

let uid = 0;
function spanOf(d: string, y0 = -Infinity, y1 = Infinity): [number, number] {
  const xs = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)]
    .map((m) => [Number(m[1]), Number(m[2])])
    .filter(([, y]) => y >= y0 && y <= y1)
    .map(([x]) => x);
  return [Math.min(...xs), Math.max(...xs)];
}
const mirrorD = (d: string) =>
  d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `${+(100 - Number(x)).toFixed(2)} ${y}`);
const rad = (deg: number) => (deg * Math.PI) / 180;

// ---------- helmet models ----------
// Each shell is drawn from a rear product photo of the real helmet (or mixes their parts), all in the same box so the
// locked size and neck hold for every model. Inside the shell's clip: stripes, then the model's vents and ledges.
interface ModelDef {
  shell: string;
  details?: (c: string) => ReactElement;
  /** A plate on the lower back: dark rubber, or the design's bumper colour; drawn over the shell's edge or inside it. */
  plate?: { d: string; tone: 'dark' | 'bumper'; inside?: boolean };
  /** A raised badge holding the number (Xenith's nameplate spot). */
  badge?: string;
  stripeEnd: number;
  number: { y: number; size: number; on: 'shell' | 'plate' | 'badge' };
  clips: { x: number; y: number; w: number; h: number }[];
  gloss: string;
  /** The lowest point of the back, before scaling: the fit puts this where the neck rule says. */
  bottom: number;
  /** Wider for linemen (the Trench shell). */
  widen?: number;
  rim?: string;
}
const DARK_PLATE = '#17191d';
const GLOSS = 'M38.2 18 C39.6 13.2 43 9.8 47 8.9';
const CLIPS_STD = [
  { x: 31.4, y: 21.4, w: 2.4, h: 3.6 },
  { x: 31.6, y: 33.6, w: 2.2, h: 3.2 },
];
const pair = (d: string) => [d, mirrorD(d)];
const vents = (ds: string[]) => (
  <>
    {ds.flatMap(pair).map((d) => (
      <path key={d} d={d} fill={VENT} fillOpacity={0.88} stroke="#fff" strokeOpacity={0.16} strokeWidth={0.3} />
    ))}
  </>
);
// rounded ends from curves, not arcs, so `mirrorD` can flip every point
const slot = (x: number, y0: number, y1: number, w = 1.15) => {
  const [l, rr, h] = [x - w / 2, x + w / 2, w / 2];
  return `M${l} ${y0 + h} C${l} ${y0 - h * 0.3} ${rr} ${y0 - h * 0.3} ${rr} ${y0 + h} L${rr} ${y1 - h} C${rr} ${y1 + h * 0.3} ${l} ${y1 + h * 0.3} ${l} ${y1 - h} Z`;
};
const ledge = (c: string, d: string) => (
  <>
    <path d={d} stroke={shade(c, 0.55)} strokeWidth={0.7} fill="none" />
    <path d={d} transform="translate(0 -0.6)" stroke="#fff" strokeOpacity={0.28} strokeWidth={0.45} fill="none" />
  </>
);
// Zero2's dot vents: a small oval cluster low on each side
const DOT_ROWS: [number, number[]][] = [
  [20.6, [37.6, 38.8]],
  [21.9, [36.8, 38, 39.2]],
  [23.2, [37.4, 38.6, 39.8]],
  [24.5, [36.8, 38, 39.2]],
  [25.8, [37.4, 38.6]],
  [27.1, [37.8]],
];
const dots = (dx = 0) => (
  <>
    {DOT_ROWS.flatMap(([y, xs]) =>
      xs
        .flatMap((x) => [x + dx, 100 - x - dx])
        .map((x) => <circle key={`${x},${y}`} cx={x} cy={y} r={0.38} fill={VENT} />),
    )}
  </>
);
const AX_POCKET = 'M37.6 28.4 C39.2 27.9 41.4 27.9 42.8 28.3 L42.4 31.4 C40.8 31.9 38.9 31.6 38 31 Z';
const AX_SLITS = ['M43.4 9.6 L44.6 10.8 L37.6 21.2 L35.6 20.2 Z', 'M44.2 19 L46.1 19.4 L44 27.7 L42.1 27.2 Z'];
const AX_SHELL =
  'M50 6.4 C57.4 6.4 62.4 9.8 64.6 15.2 C66.2 19.2 67 24 67.1 29.4 C67.2 33.6 67 37.2 66.4 39.6 C64 40.8 58 41.2 50 41.2 C42 41.2 36 40.8 33.6 39.6 C33 37.2 32.8 33.6 32.9 29.4 C33 24 33.8 19.2 35.4 15.2 C37.6 9.8 42.6 6.4 50 6.4 Z';
const AX_BUMPER = 'M37.4 39.1 C43 40.3 57 40.3 62.6 39.1 L62.2 41.5 C56.6 43.1 43.4 43.1 37.8 41.5 Z';
const AX_LEDGE = 'M42.3 27.3 C46 28.1 54 28.1 57.7 27.3';
const AX_RECESS = 'M42.3 27.3 C46 28.1 54 28.1 57.7 27.3 L57.5 29.2 C54 30 46 30 42.5 29.2 Z';
const VG_SHELL =
  'M50 7 C59.6 7 66.4 13 66.8 22 C67 28.2 66.8 33.6 66 38 C65.8 39.6 65 40.8 63.6 41.2 C57 42.2 43 42.2 36.4 41.2 C35 40.8 34.2 39.6 34 38 C33.2 33.6 33 28.2 33.2 22 C33.6 13 40.4 7 50 7 Z';
const Z2_SHELL =
  'M50 6.4 C58.8 6.4 64.8 11 66.4 17.6 C67.2 21.4 67.2 27 66.8 31.6 C66.4 35.6 65.4 38.6 63.8 40.6 C59 41.8 41 41.8 36.2 40.6 C34.6 38.6 33.6 35.6 33.2 31.6 C32.8 27 32.8 21.4 33.6 17.6 C35.2 11 41.2 6.4 50 6.4 Z';
const Z2_PLATE = 'M41.8 34 L58.2 34 L59.4 35.2 L57.4 41.9 L42.6 41.9 L40.6 35.2 Z';
const XR_SHELF = (c: string) => (
  <>
    <rect x="30" y="20.6" width="40" height="3.8" fill="#000" fillOpacity={0.1} />
    <path d="M30 20.6 L70 20.6" stroke="#fff" strokeOpacity={0.4} strokeWidth={0.5} />
    <path d="M30 24.5 L70 24.5" stroke={shade(c, 0.55)} strokeWidth={0.7} />
  </>
);

const MODELS = {
  axiom: {
    shell: AX_SHELL,
    details: (c) => (
      <>
        <path d={AX_RECESS} fill="#000" fillOpacity={0.2} />
        {ledge(c, AX_LEDGE)}
        {vents([...AX_SLITS, AX_POCKET])}
        <circle cx="50" cy="7.9" r="0.55" fill={VENT} />
      </>
    ),
    plate: { d: AX_BUMPER, tone: 'bumper' },
    stripeEnd: 27.4,
    number: { y: 34.6, size: 6.6, on: 'shell' },
    clips: CLIPS_STD,
    gloss: GLOSS,
    bottom: 42.8,
  },
  axiomLite: {
    shell: AX_SHELL,
    details: (c) => (
      <>
        <path d={AX_RECESS} fill="#000" fillOpacity={0.2} />
        {ledge(c, AX_LEDGE)}
        {vents([AX_POCKET])}
      </>
    ),
    plate: { d: AX_BUMPER, tone: 'bumper' },
    stripeEnd: 27.4,
    number: { y: 34.6, size: 6.6, on: 'shell' },
    clips: CLIPS_STD,
    gloss: GLOSS,
    bottom: 42.8,
  },
  // Schutt F7: a round dome, three pairs of vertical slots, and a big dark plate across the lower back
  f7: {
    shell:
      'M50 6.6 C59.4 6.6 66 12.4 67 20.8 C67.6 26 67.4 31.6 66.4 35.8 C65.6 38.8 63.6 40.8 60.6 41.4 C55 42 45 42 39.4 41.4 C36.4 40.8 34.4 38.8 33.6 35.8 C32.6 31.6 32.4 26 33 20.8 C34 12.4 40.6 6.6 50 6.6 Z',
    details: () => <>{vents([slot(43, 9.2, 13.8), slot(42.2, 18.4, 24.8), slot(35.8, 20, 26.4, 1.05)])}</>,
    plate: { d: 'M30 32.6 C40 31.8 60 31.8 70 32.6 L70 46 L30 46 Z', tone: 'dark', inside: true },
    stripeEnd: 32.2,
    number: { y: 36.4, size: 5.8, on: 'plate' },
    clips: [
      { x: 31.2, y: 21.2, w: 2.4, h: 3.6 },
      { x: 31.6, y: 33, w: 2.2, h: 3.2 },
    ],
    gloss: GLOSS,
    bottom: 42,
  },
  // Schutt Vengeance: the classic round shell, two holes on the centreline, a ledge across the back, a dark bumper
  veng: {
    shell: VG_SHELL,
    details: (c) => (
      <>
        <path
          d="M33.4 28.2 C42 30.4 58 30.4 66.6 28.2 L66.6 30.2 C58 32.4 42 32.4 33.4 30.2 Z"
          fill="#000"
          fillOpacity={0.14}
        />
        {ledge(c, 'M33.4 28.2 C42 30.4 58 30.4 66.6 28.2')}
        {pair('M39.8 10.4 C37.8 13.2 36.6 16.8 36.2 20.8').map((d) => (
          <path key={d} d={d} stroke={shade(c, 0.3)} strokeOpacity={0.6} strokeWidth={0.4} fill="none" />
        ))}
        <circle cx="50" cy="9.2" r="0.62" fill={VENT} />
        <circle cx="50" cy="12.2" r="0.5" fill={VENT} />
      </>
    ),
    plate: { d: 'M38.6 35.4 C44 34.6 56 34.6 61.4 35.4 L61 41.4 C55 42.6 45 42.6 39 41.4 Z', tone: 'dark' },
    stripeEnd: 28.4,
    number: { y: 38.4, size: 5.2, on: 'plate' },
    clips: CLIPS_STD,
    gloss: 'M38.4 19.4 C39.4 14 43.6 10.4 48.4 9.8',
    bottom: 42.6,
  },
  // Xenith Shadow XR: boxy and faceted, a flat crown, a raised shelf, angled slots above and below it, a badge
  xr: {
    shell:
      'M50 7 C58.6 7 64.8 8.4 66.4 13 C67.4 16 67.6 20.4 67.4 24.4 L68.2 28.4 C68.4 33 68 37.4 67 40.4 C61 41.8 39 41.8 33 40.4 C32 37.4 31.6 33 31.8 28.4 L32.6 24.4 C32.4 20.4 32.6 16 33.6 13 C35.2 8.4 41.4 7 50 7 Z',
    details: (c) => (
      <>
        {XR_SHELF(c)}
        <path d="M30 30.8 L70 30.8" stroke={shade(c, 0.4)} strokeOpacity={0.6} strokeWidth={0.4} />
        {vents(['M40 9.4 L41.3 10 L37.6 17.4 L36.3 16.8 Z', 'M40.6 25.2 L42 25.6 L38.2 31.6 L36.8 31 Z'])}
      </>
    ),
    badge: 'M41.4 32.6 L58.6 32.6 L58.6 36.8 L41.4 36.8 Z',
    stripeEnd: 20.6,
    number: { y: 34.75, size: 3.8, on: 'badge' },
    clips: [
      { x: 30.6, y: 21.2, w: 2.4, h: 3.6 },
      { x: 30.2, y: 33.6, w: 2.2, h: 3.2 },
    ],
    gloss: 'M37 15.6 C37.4 11.6 40.6 9 45.4 8.4',
    bottom: 41.8,
    rim: 'M33 40.4 C39 41.8 61 41.8 67 40.4',
  },
  // Vicis Zero2: smooth and tall, soft seams, dot vents low on each side, a dark trapezoid plate
  zero2: {
    shell: Z2_SHELL,
    details: (c) => (
      <>
        {pair('M44.4 7.4 C43.4 14 43.2 24 44 33.4').map((d) => (
          <path key={d} d={d} stroke={shade(c, 0.28)} strokeOpacity={0.55} strokeWidth={0.45} fill="none" />
        ))}
        {dots()}
        {vents(['M34.6 13.6 L35.6 13.2 L35.4 17.4 L34.4 17.6 Z'])}
      </>
    ),
    plate: { d: Z2_PLATE, tone: 'dark' },
    stripeEnd: 34,
    number: { y: 37.9, size: 4.8, on: 'plate' },
    clips: CLIPS_STD,
    gloss: GLOSS,
    bottom: 41.9,
  },
  // Vicis Zero2 Trench: the lineman's version, wider and squarer
  zero2t: {
    shell:
      'M50 6.6 C59.4 6.6 65.4 10.6 66.8 17.4 C67.6 21.4 67.6 27 67.2 31.8 C66.8 35.8 66 38.8 64.4 40.8 C59.4 42 40.6 42 35.6 40.8 C34 38.8 33.2 35.8 32.8 31.8 C32.4 27 32.4 21.4 33.2 17.4 C34.6 10.6 40.6 6.6 50 6.6 Z',
    details: (c) => (
      <>
        {pair('M44 7.6 C43 14 42.8 24 43.6 33.4').map((d) => (
          <path key={d} d={d} stroke={shade(c, 0.28)} strokeOpacity={0.55} strokeWidth={0.45} fill="none" />
        ))}
        {dots(-0.6)}
      </>
    ),
    plate: { d: 'M40.8 33.6 L59.2 33.6 L60.6 35 L58.4 42.1 L41.6 42.1 L39.4 35 Z', tone: 'dark' },
    stripeEnd: 33.6,
    number: { y: 37.8, size: 5, on: 'plate' },
    clips: CLIPS_STD,
    gloss: GLOSS,
    bottom: 42.1,
    widen: 1.06,
  },
  // Ours: the Axiom's shape with a raised spine down the middle, the ledge and pockets, no slits
  ridge: {
    shell: AX_SHELL,
    details: (c) => (
      <>
        <path d={AX_RECESS} fill="#000" fillOpacity={0.2} />
        {ledge(c, AX_LEDGE)}
        <path d="M48.3 6 L51.7 6 L51.7 27.6 L48.3 27.6 Z" fill="#fff" fillOpacity={0.14} />
        <path d="M48.3 6 L48.3 27.6" stroke="#fff" strokeOpacity={0.45} strokeWidth={0.4} />
        <path d="M51.7 6 L51.7 27.6" stroke={shade(c, 0.5)} strokeWidth={0.5} />
        {vents([AX_POCKET, 'M40.8 12.4 L42 12.8 L39.4 19.6 L38.2 19.2 Z'])}
      </>
    ),
    plate: { d: AX_BUMPER, tone: 'bumper' },
    stripeEnd: 27.4,
    number: { y: 34.6, size: 6.6, on: 'shell' },
    clips: CLIPS_STD,
    gloss: GLOSS,
    bottom: 42.8,
  },
  // Ours: the Zero2's smooth shape with the Xenith's shelf and lower slots, and a dark plate carrying the number
  facet: {
    shell: Z2_SHELL,
    details: (c) => (
      <>
        {XR_SHELF(c)}
        {vents(['M40.6 25.2 L42 25.6 L38.6 31 L37.2 30.4 Z'])}
      </>
    ),
    plate: { d: Z2_PLATE, tone: 'dark' },
    stripeEnd: 20.6,
    number: { y: 37.9, size: 4.8, on: 'plate' },
    clips: CLIPS_STD,
    gloss: GLOSS,
    bottom: 41.9,
  },
  // Ours: the Vengeance's round classic shape, the Axiom's chevron slits, and a bumper in the design's colour
  oldmod: {
    shell: VG_SHELL,
    details: () => <>{vents([AX_SLITS[0]])}</>,
    plate: { d: 'M37.6 39 C43 40.2 57 40.2 62.4 39 L62 41.6 C56.6 43 43.4 43 38 41.6 Z', tone: 'bumper' },
    stripeEnd: 30.4,
    number: { y: 34.6, size: 6.4, on: 'shell' },
    clips: CLIPS_STD,
    gloss: 'M38.4 19.4 C39.4 14 43.6 10.4 48.4 9.8',
    bottom: 42.8,
  },
};

(MODELS as Record<string, ModelDef>).f7r5 = MODELS.f7;
(MODELS as Record<string, ModelDef>).vengR5 = MODELS.veng;
// thinner black plates (round 6): the F7's starts lower, the Vengeance's bumper is shallower
(MODELS as Record<string, ModelDef>).f7r6 = {
  ...MODELS.f7,
  plate: { d: 'M30 35.4 C40 34.8 60 34.8 70 35.4 L70 46 L30 46 Z', tone: 'dark', inside: true },
  stripeEnd: 35,
  number: { y: 38.6, size: 4.6, on: 'plate' },
};
(MODELS as Record<string, ModelDef>).vengR6 = {
  ...MODELS.veng,
  plate: { d: 'M38.6 37 C44 36.3 56 36.3 61.4 37 L61 41.4 C55 42.6 45 42.6 39 41.4 Z', tone: 'dark' },
  number: { y: 39.5, size: 3.9, on: 'plate' },
};

// round 7: halfway between round 5's plates and round 6's thin ones
(MODELS as Record<string, ModelDef>).f7 = {
  ...MODELS.f7r5,
  plate: { d: 'M30 34 C40 33.3 60 33.3 70 34 L70 46 L30 46 Z', tone: 'dark', inside: true },
  stripeEnd: 33.6,
  number: { y: 37.8, size: 5.2, on: 'plate' },
};
(MODELS as Record<string, ModelDef>).veng = {
  ...MODELS.vengR5,
  plate: { d: 'M38.6 36.2 C44 35.4 56 35.4 61.4 36.2 L61 41.4 C55 42.6 45 42.6 39 41.4 Z', tone: 'dark' },
  number: { y: 38.9, size: 4.5, on: 'plate' },
};

// Flags stack (the US flag on top) in a box left of the number, `fy` its top; the green dot sits low in the middle of the
// shell: above the number where the number is on the shell, just above the plate where a plate fills the bottom.
const DECALS: Record<string, { fx: number; fy: number; dx: number; dy: number }> = {
  axiom: { fx: 38, fy: 32, dx: 50, dy: 29.5 },
  axiomLite: { fx: 38, fy: 32, dx: 50, dy: 29.5 },
  ridge: { fx: 38, fy: 32, dx: 50, dy: 29.5 },
  oldmod: { fx: 38.2, fy: 32, dx: 50, dy: 30 },
  f7: { fx: 38.2, fy: 28.4, dx: 50, dy: 31 },
  veng: { fx: 38.6, fy: 29.7, dx: 50, dy: 33.5 },
  zero2: { fx: 38.6, fy: 29.2, dx: 50, dy: 31.5 },
  zero2t: { fx: 38.2, fy: 28.8, dx: 50, dy: 31.1 },
};
const FLAG_W = 3.4;
const FLAG_H = 2.25;
const FLAG_GAP = 0.35;
/** Flags drawn simply enough to read at a few pixels: the US flag and the 15 Pathway countries. */
function Flag({ code, x, y }: { code: string; x: number; y: number }) {
  const w = FLAG_W;
  const h = FLAG_H;
  const R = (fx: number, fy: number, fw: number, fh: number, fill: string, k: string) => (
    <rect key={k} x={x + fx * w} y={y + fy * h} width={fw * w} height={fh * h} fill={fill} />
  );
  const vert = (a: string, b: string, c: string) => [
    R(0, 0, 1 / 3, 1, a, 'a'),
    R(1 / 3, 0, 1 / 3, 1, b, 'b'),
    R(2 / 3, 0, 1 / 3, 1, c, 'c'),
  ];
  const horiz = (a: string, b: string, c: string) => [
    R(0, 0, 1, 1 / 3, a, 'a'),
    R(0, 1 / 3, 1, 1 / 3, b, 'b'),
    R(0, 2 / 3, 1, 1 / 3, c, 'c'),
  ];
  const nordic = (bg: string, cross: string) => [
    R(0, 0, 1, 1, bg, 'bg'),
    R(0.3, 0, 0.14, 1, cross, 'v'),
    R(0, 0.42, 1, 0.16, cross, 'h'),
  ];
  const ukCanton = (fx: number, fw: number, fh: number) => [
    R(fx, 0, fw, fh, '#012169', 'cb'),
    R(fx + fw * 0.42, 0, fw * 0.16, fh, '#fff', 'cw1'),
    R(fx, fh * 0.4, fw, fh * 0.2, '#fff', 'cw2'),
    R(fx + fw * 0.46, 0, fw * 0.08, fh, '#C8102E', 'cr1'),
    R(fx, fh * 0.45, fw, fh * 0.1, '#C8102E', 'cr2'),
  ];
  const dot = (cx: number, cy: number, r: number, fill: string, k = 'dot') => (
    <circle key={k} cx={x + cx * w} cy={y + cy * h} r={r} fill={fill} />
  );
  const parts: Record<string, ReactElement[]> = {
    US: [
      ...[0, 1, 2, 3, 4].map((i) => R(0, i / 5, 1, 1 / 5, i % 2 ? '#fff' : '#B22234', `s${i}`)),
      R(0, 0, 0.42, 0.6, '#3C3B6E', 'canton'),
    ],
    JP: [R(0, 0, 1, 1, '#fff', 'bg'), dot(0.5, 0.5, 0.5, '#BC002D')],
    DE: horiz('#000', '#DD0000', '#FFCE00'),
    GB: ukCanton(0, 1, 1),
    AU: [
      R(0, 0, 1, 1, '#012169', 'bg'),
      ...ukCanton(0, 0.5, 0.5),
      dot(0.25, 0.78, 0.18, '#fff', 'st'),
      dot(0.75, 0.5, 0.14, '#fff', 'st2'),
    ],
    NZ: [
      R(0, 0, 1, 1, '#012169', 'bg'),
      ...ukCanton(0, 0.5, 0.5),
      dot(0.74, 0.35, 0.15, '#C8102E', 'st'),
      dot(0.74, 0.75, 0.15, '#C8102E', 'st2'),
    ],
    NG: vert('#008751', '#fff', '#008751'),
    MX: [...vert('#006847', '#fff', '#CE1126'), dot(0.5, 0.5, 0.2, '#8C6A3A')],
    FR: vert('#0055A4', '#fff', '#EF4135'),
    AT: horiz('#ED2939', '#fff', '#ED2939'),
    IT: vert('#009246', '#fff', '#CE2B37'),
    BR: [
      R(0, 0, 1, 1, '#009C3B', 'bg'),
      <path
        key="d"
        d={`M${x + w * 0.5} ${y + h * 0.12} L${x + w * 0.92} ${y + h * 0.5} L${x + w * 0.5} ${y + h * 0.88} L${x + w * 0.08} ${y + h * 0.5} Z`}
        fill="#FFDF00"
      />,
      dot(0.5, 0.5, 0.42, '#002776'),
    ],
    GH: [...horiz('#CE1126', '#FCD116', '#006B3F'), dot(0.5, 0.5, 0.22, '#000')],
    CA: [
      R(0, 0, 0.25, 1, '#D80621', 'l'),
      R(0.25, 0, 0.5, 1, '#fff', 'm'),
      R(0.75, 0, 0.25, 1, '#D80621', 'r'),
      dot(0.5, 0.5, 0.34, '#D80621'),
    ],
    IE: vert('#169B62', '#fff', '#FF883E'),
    SE: nordic('#006AA7', '#FECC00'),
  };
  return (
    <g>
      {parts[code]}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={0.18} />
      <rect x={x} y={y} width={w} height={h * 0.35} fill="#fff" fillOpacity={0.18} />
    </g>
  );
}
function Decals({ h }: { h: Helmet }) {
  const at = DECALS[h.model] ?? DECALS.axiom;
  return (
    <g>
      {(h.flags ?? []).map((code, i, all) => (
        <Flag
          key={code}
          code={code}
          x={at.fx}
          y={at.fy + (all.length === 1 ? (FLAG_H + FLAG_GAP) / 2 : 0) + i * (FLAG_H + FLAG_GAP)}
        />
      ))}
      {h.dot && (
        <g>
          <circle
            cx={at.dx}
            cy={at.dy}
            r={1.05}
            fill="#22B14C"
            stroke="#0F172A"
            strokeOpacity={0.5}
            strokeWidth={0.3}
          />
          <circle cx={at.dx - 0.35} cy={at.dy - 0.35} r={0.35} fill="#fff" fillOpacity={0.45} />
        </g>
      )}
    </g>
  );
}

// the facemask's lower bars, just past the shell's bottom corners (left side; mirrored)
const CAGES: Record<Exclude<Cage, 'none'>, { d: string[]; w: number }> = {
  qb: { d: ['M33.4 36.6 C32 37.8 31.7 39.8 32.6 41.2 C33.2 42.2 34.3 42.6 35.6 42.6'], w: 1.05 },
  skill: { d: ['M33.6 37.6 C32.4 38.6 32.3 40.2 33.1 41.4 C33.7 42.2 34.6 42.5 35.6 42.5'], w: 1.05 },
  line: {
    d: ['M33.6 34.6 C31.2 35.8 30.4 38.4 31.2 40.8 C31.8 42.4 33.4 43.4 35.4 43.6', 'M30.9 38.2 L33.4 38.4'],
    w: 1.25,
  },
  kicker: { d: ['M33.8 38.6 C33 39.4 33 40.6 33.9 41.4'], w: 0.75 },
  hybrid: { d: ['M33.6 34.6 C31.2 35.8 30.4 38.4 31.2 40.8 C31.8 42.4 33.4 43.4 35.4 43.6'], w: 1.15 },
};

// From behind, the facemask shows only at its lower corners: a bar drops out from under the shell's bottom corner and
// turns forward to the chin, out of sight behind the neck. Drawn before the neck, so the neck hides the rest.
const MASK: Record<Exclude<Cage, 'none'>, { d: string; w: number }[]> = {
  qb: [{ d: 'M34.8 37.4 C34.5 40.4 35.1 42.5 37 43.7 C38.6 44.7 40.8 44.9 43.2 44.9', w: 1.15 }],
  skill: [{ d: 'M35 38 C34.8 40.6 35.4 42.4 37.2 43.5 C38.8 44.4 40.8 44.6 43.2 44.6', w: 1.1 }],
  line: [
    { d: 'M34.2 35.6 C33.6 39 34.2 42.2 36.4 44 C38.4 45.4 41 45.8 43.6 45.8', w: 1.25 },
    { d: 'M36.4 37.6 C36.2 40 36.8 41.6 38.2 42.4 C39.6 43.1 41.4 43.2 43.4 43.2', w: 1.05 },
    { d: 'M34.9 41.6 L37.3 40.8', w: 0.9 },
  ],
  kicker: [{ d: 'M35.2 38.6 C35.2 40.6 35.8 41.8 37.4 42.6 C38.8 43.2 40.6 43.3 42.6 43.3', w: 0.8 }],
  hybrid: [
    { d: 'M34.5 36.4 C34 39.6 34.6 42.2 36.6 43.8 C38.4 45 40.8 45.3 43.4 45.3', w: 1.2 },
    { d: 'M36.8 39 C36.8 40.6 37.3 41.7 38.6 42.3 C39.8 42.8 41.4 42.9 43.2 42.9', w: 0.95 },
  ],
};
const CHIN = 'M33.8 34.4 C35 38.4 37.6 41.8 41.6 43.6';
function CageLayer({ h }: { h: Helmet }) {
  if (h.legacy || h.cage === 'none') return null;
  const m = MODELS[h.model];
  const bars = MASK[h.cage].flatMap((b) => [b, { ...b, d: mirrorD(b.d) }]);
  const strap = h.strap ?? '#E9EDF1';
  return (
    <g transform={m.widen ? `translate(50 0) scale(${m.widen} 1) translate(-50 0)` : undefined}>
      {h.chin &&
        [CHIN, mirrorD(CHIN)].map((d) => (
          <g key={d}>
            <path d={d} stroke="#000" strokeOpacity={0.3} strokeWidth={1.3} fill="none" strokeLinecap="round" />
            <path d={d} stroke={strap} strokeWidth={0.8} fill="none" strokeLinecap="round" />
          </g>
        ))}
      {bars.map((b, i) => (
        <path
          key={`o${i}`}
          d={b.d}
          stroke="#000"
          strokeOpacity={0.45}
          strokeWidth={b.w + 0.7}
          fill="none"
          strokeLinecap="round"
        />
      ))}
      {bars.map((b, i) => (
        <path key={`b${i}`} d={b.d} stroke={h.mask} strokeWidth={b.w} fill="none" strokeLinecap="round" />
      ))}
      {bars.map((b, i) => (
        <path
          key={`h${i}`}
          d={b.d}
          transform="translate(-0.25 -0.25)"
          stroke="#fff"
          strokeOpacity={0.3}
          strokeWidth={b.w * 0.3}
          fill="none"
          strokeLinecap="round"
        />
      ))}
    </g>
  );
}
// The chin strap's loose ends: a buckle at each snap on the side of the shell and the spare strap hanging from it,
// just past the shell's edge (left side; mirrored). Drawn behind the shell, so only the edge of each shows.
// they hang almost straight down under their own weight, with flat ends
const TAILS = [
  { buckle: { x: 31.3, y: 21.4, w: 1.9, h: 2 }, d: 'M32.1 23.2 C31.9 24.6 31.8 26 31.9 27.4' },
  { buckle: { x: 31.4, y: 32.8, w: 1.9, h: 2 }, d: 'M32.2 34.6 C32 36.4 31.8 38.2 31.9 40.4' },
];

function HelmetLayer({ id, h, num }: { id: string; h: Helmet; num: number }) {
  const m = MODELS[h.model];
  const c = h.shell;
  const grad =
    h.finish === 'metal' ? (
      <linearGradient id={`${id}hs`} x1="32" x2="68" y1="0" y2="0" gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={shade(c, 0.4)} />
        <stop offset="0.22" stopColor={tint(c, 0.3)} />
        <stop offset="0.42" stopColor={c} />
        <stop offset="0.6" stopColor={tint(c, 0.55)} />
        <stop offset="0.8" stopColor={shade(c, 0.12)} />
        <stop offset="1" stopColor={shade(c, 0.45)} />
      </linearGradient>
    ) : (
      <radialGradient id={`${id}hs`} cx="45" cy="15" r={h.finish === 'gloss' ? 31 : 36} gradientUnits="userSpaceOnUse">
        <stop offset="0" stopColor={tint(c, h.finish === 'gloss' ? 0.32 : 0.14)} />
        <stop offset="0.5" stopColor={c} />
        <stop offset="1" stopColor={shade(c, h.finish === 'gloss' ? 0.42 : 0.28)} />
      </radialGradient>
    );
  const end =
    h.number && m.number.on === 'shell'
      ? m.stripeEnd
      : m.plate?.inside || m.badge
        ? m.stripeEnd
        : Math.max(m.stripeEnd, 45);
  const stripes: ReactElement[] = [];
  const bar = (x0: number, x1: number, fill: string, k: string) =>
    stripes.push(<rect key={k} x={x0} y={0} width={x1 - x0} height={end} fill={fill} />);
  if (h.stripe === 'single') bar(47.2, 52.8, h.a!, 's');
  if (h.stripe === 'double') {
    bar(45.6, 48.2, h.a!, 'l');
    bar(51.8, 54.4, h.a!, 'r');
  }
  if (h.stripe === 'triple') {
    bar(44.6, 45.9, h.b!, 'l');
    bar(47, 53, h.a!, 'm');
    bar(54.1, 55.4, h.b!, 'r');
  }
  const cage = h.cage === 'none' ? null : CAGES[h.cage];
  const cagePaths = cage ? [...cage.d, ...cage.d.map(mirrorD)] : [];
  const plateFill = m.plate?.tone === 'dark' ? DARK_PLATE : h.bumper;
  const numberText = (fill: string, stroke: string, sw: number) =>
    h.number && (
      <text
        x="50"
        y={m.number.y}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={m.number.size}
        fontWeight={900}
        fill={fill}
        stroke={stroke}
        strokeWidth={sw}
        paintOrder="stroke"
        transform="translate(-7.5 0) scale(1.15 1)"
      >
        {num}
      </text>
    );
  // a number on dark rubber is white with the design's accent as trim; on a badge, whatever reads on the badge
  const onPlate = numberText('#ffffff', h.a ?? DARK_PLATE, 0.45);
  const onBadge = numberText(readableOn(h.bumper, '#121915'), 'none', 0);
  const plate = m.plate && (
    <g>
      <defs>
        <linearGradient id={`${id}bp`} x1="0" x2="0" y1="32" y2="43" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(plateFill, 0.15)} />
          <stop offset="1" stopColor={shade(plateFill, 0.3)} />
        </linearGradient>
      </defs>
      <path d={m.plate.d} fill={`url(#${id}bp)`} />
      {m.plate.tone === 'dark' && (
        <path d={m.plate.d} fill="none" stroke="#fff" strokeOpacity={0.12} strokeWidth={0.4} />
      )}
      {!m.plate.inside && (
        <path
          d={m.plate.d}
          fill="none"
          stroke="#0F172A"
          strokeOpacity={0.35}
          strokeWidth={0.6}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {m.number.on === 'plate' && onPlate}
    </g>
  );
  return (
    <g transform={m.widen ? `translate(50 0) scale(${m.widen} 1) translate(-50 0)` : undefined}>
      <defs>
        {grad}
        <linearGradient id={`${id}hu`} x1="0" x2="0" y1="22" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.3} />
        </linearGradient>
        <clipPath id={`${id}hc`}>
          <path d={m.shell} />
        </clipPath>
      </defs>
      <ellipse cx="50" cy={m.bottom - 0.2} rx="9.6" ry="2" fill="#000" fillOpacity={0.3} />
      {h.legacy &&
        cagePaths.map((d, i) => (
          <path
            key={`co${i}`}
            d={d}
            stroke="#000"
            strokeOpacity={0.4}
            strokeWidth={cage!.w + 0.7}
            fill="none"
            strokeLinecap="round"
          />
        ))}
      {h.legacy &&
        cagePaths.map((d, i) => (
          <path key={`c${i}`} d={d} stroke={h.mask} strokeWidth={cage!.w} fill="none" strokeLinecap="round" />
        ))}
      {h.tails &&
        TAILS.flatMap((t, i) =>
          [false, true].map((flip) => (
            <g key={`tail${i}${flip}`} transform={flip ? 'translate(100 0) scale(-1 1)' : undefined}>
              <path d={t.d} stroke="#000" strokeOpacity={0.35} strokeWidth={1.55} fill="none" strokeLinecap="butt" />
              <path d={t.d} stroke={h.strap ?? '#E9EDF1'} strokeWidth={1.15} fill="none" strokeLinecap="butt" />
              <path
                d={t.d}
                transform="translate(0.3 0)"
                stroke="#000"
                strokeOpacity={0.18}
                strokeWidth={0.35}
                fill="none"
              />
              <rect {...t.buckle} rx={0.4} fill="#2a2e34" />
              <rect
                x={t.buckle.x + 0.3}
                y={t.buckle.y + 0.4}
                width={t.buckle.w - 0.6}
                height={0.35}
                fill="#fff"
                fillOpacity={0.35}
              />
            </g>
          )),
        )}
      {!h.tails &&
        m.clips.flatMap((k, i) =>
          [k.x, 100 - k.x - k.w].map((x, s) => (
            <g key={`clip${i}${s}`}>
              <rect x={x} y={k.y} width={k.w} height={k.h} rx={0.7} fill="#16181c" />
              <rect
                x={s === 0 ? x - 0.2 : x + k.w - 0.5}
                y={k.y + 0.6}
                width={0.7}
                height={k.h - 1.2}
                rx={0.3}
                fill="#e9edf1"
              />
            </g>
          )),
        )}
      <path d={m.shell} fill={`url(#${id}hs)`} />
      <g clipPath={`url(#${id}hc)`}>
        {stripes}
        {h.finish !== 'matte' && (
          <>
            <path
              d={m.gloss}
              stroke="#fff"
              strokeOpacity={h.finish === 'metal' || contrast(c, '#000000') < 2.4 ? 0.72 : 0.6}
              strokeWidth={1.5}
              strokeLinecap="round"
              fill="none"
            />
            <path
              d="M62 14.8 C63.4 17 64.2 19.6 64.4 22"
              stroke="#fff"
              strokeOpacity={0.22}
              strokeWidth={0.9}
              strokeLinecap="round"
              fill="none"
            />
          </>
        )}
        {m.details?.(c)}
        {/* a dark shell gets a rim of light around its edge, or it melts into a dark jersey */}
        {contrast(c, '#000000') < 2.4 && (
          <path d={m.shell} fill="none" stroke={tint(c, 0.6)} strokeOpacity={0.55} strokeWidth={1.3} />
        )}
        {m.number.on === 'shell' && numberText(h.number?.ink ?? '#fff', h.number?.trim ?? '#000', 0.6)}
        <rect x="30" y="0" width="40" height="46" fill={`url(#${id}hu)`} />
        {m.plate?.inside && plate}
      </g>
      {m.badge && (
        <g>
          <path d={m.badge} fill={h.bumper} />
          <path d={m.badge} fill="none" stroke="#000" strokeOpacity={0.45} strokeWidth={0.45} />
          <path d="M41.6 32.9 L58.4 32.9" stroke="#fff" strokeOpacity={0.5} strokeWidth={0.35} />
          {onBadge}
        </g>
      )}
      {m.plate && !m.plate.inside && plate}
      {m.rim && <path d={m.rim} stroke="#15181d" strokeWidth={0.9} fill="none" strokeLinecap="round" />}
      <Decals h={h} />
      <path
        d={m.shell}
        fill="none"
        stroke="#0F172A"
        strokeOpacity={0.35}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
    </g>
  );
}

// ---------- hair, hanging out from under the helmet ----------
function HairLayer({ id, hair }: { id: string; hair: Hair }) {
  const col = hair.color;
  const hi = tint(col, 0.3);
  const out: ReactElement[] = [];
  // one strand: from under the helmet's back edge, splaying out a little as it falls
  const strand = (x: number, end: number, splay: number, k: string, w: number, texture: 'twist' | 'braid') => {
    const x1 = 50 + (x - 50) * splay;
    const d = `M${x} 39.6 C${50 + (x - 50) * 1.05} ${39.6 + (end - 39.6) * 0.35} ${50 + (x - 50) * (splay - 0.08)} ${39.6 + (end - 39.6) * 0.7} ${x1} ${end}`;
    out.push(
      <g key={k}>
        <path
          d={d}
          transform="translate(0.45 0.6)"
          stroke="#000"
          strokeOpacity={0.22}
          strokeWidth={w}
          strokeLinecap="round"
          fill="none"
        />
        <path d={d} stroke={col} strokeWidth={w} strokeLinecap="round" fill="none" />
        {hair.tips && (
          <path
            d={d}
            stroke={hair.tips}
            strokeWidth={w}
            strokeLinecap="round"
            fill="none"
            clipPath={`url(#${id}tip)`}
          />
        )}
        <path
          d={d}
          transform={`translate(${-w * 0.2} 0)`}
          stroke={hi}
          strokeOpacity={0.75}
          strokeWidth={w * 0.28}
          strokeDasharray={texture === 'twist' ? '1 0.8' : '0.55 0.45'}
          fill="none"
        />
        {texture === 'braid' && <circle cx={x1} cy={end + 0.3} r={0.62} fill={hair.tips ?? '#d9b45a'} />}
      </g>,
    );
  };
  const spread = (n: number, from: number, to: number) =>
    Array.from({ length: n }, (_, i) => from + ((to - from) * i) / (n - 1));
  const jitter = (i: number, amount: number) => (((i * 37) % 7) / 6 - 0.5) * amount;
  if (hair.style === 'locs')
    spread(9, 41.2, 58.8).forEach((x, i) => strand(x, 49 + jitter(i, 2.2), 1.28, `l${i}`, 2.2, 'twist'));
  if (hair.style === 'longLocs')
    spread(11, 40.6, 59.4).forEach((x, i) => strand(x, 60.5 + jitter(i, 3.6), 1.42, `L${i}`, 2.1, 'twist'));
  if (hair.style === 'braids')
    spread(15, 40.8, 59.2).forEach((x, i) => strand(x, 54.6 + jitter(i, 2.4), 1.32, `b${i}`, 1.15, 'braid'));
  if (hair.style === 'flow') {
    const mass =
      'M38.8 40 C38 44.6 36.4 48.6 34.2 51.8 C33.4 53.2 34.6 54.4 36.2 53.6 C37.4 55 39.4 54.8 40.4 53.2 C41.8 55.2 44.2 55 45.2 53.4 C46.6 55.4 49 55.2 50 53.6 C51 55.2 53.4 55.4 54.8 53.4 C55.8 55 58.2 55.2 59.6 53.2 C60.6 54.8 62.6 55 63.8 53.6 C65.4 54.4 66.6 53.2 65.8 51.8 C63.6 48.6 62 44.6 61.2 40 Z';
    out.push(
      <g key="flow">
        <defs>
          <linearGradient id={`${id}fl`} x1="0" x2="0" y1="39" y2="53" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={shade(col, 0.45)} />
            <stop offset="0.55" stopColor={col} />
            <stop offset="1" stopColor={tint(col, 0.18)} />
          </linearGradient>
        </defs>
        <path d={mass} transform="translate(0.5 0.7)" fill="#000" fillOpacity={0.22} />
        <path d={mass} fill={`url(#${id}fl)`} />
        {spread(13, 39.8, 60.2).map((x, i) => (
          <path
            key={i}
            d={`M${x} 40.6 C${50 + (x - 50) * 1.02 + 0.8} 44.2 ${50 + (x - 50) * 1.2 - 0.8} 48.4 ${50 + (x - 50) * 1.36} ${52.6 + jitter(i, 1.2)}`}
            stroke={i % 3 === 0 ? tint(col, 0.45) : i % 3 === 1 ? shade(col, 0.35) : hi}
            strokeOpacity={0.75}
            strokeWidth={i % 3 === 0 ? 0.55 : 0.4}
            strokeLinecap="round"
            fill="none"
          />
        ))}
      </g>,
    );
  }
  if (hair.style === 'ponytail') {
    const tail =
      'M46.4 40.6 C45.2 45 44.8 50 46 54.6 C46.8 57.8 48.4 60.4 50.6 61.2 C52 59.8 53.2 57.4 53.8 54.4 C55 50 55 45 53.6 40.6 Z';
    out.push(
      <g key="pony">
        <path d={tail} transform="translate(0.5 0.7)" fill="#000" fillOpacity={0.22} />
        <path d={tail} fill={col} />
        {[47.6, 48.9, 50.2, 51.5, 52.6].map((x, i) => (
          <path
            key={x}
            d={`M${x} 44.6 C${x - 0.9} 49 ${x - 0.6} 54 ${50.4 + (x - 50) * 0.45} 60`}
            stroke={i % 2 ? shade(col, 0.35) : hi}
            strokeOpacity={0.75}
            strokeWidth={0.42}
            strokeLinecap="round"
            fill="none"
          />
        ))}
        <rect x="46.3" y="42.4" width="7.4" height="1.7" rx="0.7" fill="#16181c" />
      </g>,
    );
  }
  if (hair.style === 'curls') {
    const curls: [number, number, number][] = [];
    // curls spill out under the bumper, over the neck and onto the collar
    spread(9, 40.2, 59.8).forEach((x, i) => curls.push([x, 42.4 + jitter(i, 0.8), 1.85]));
    spread(8, 41.4, 58.6).forEach((x, i) => curls.push([x, 44.8 + jitter(i + 3, 0.9), 1.65]));
    spread(5, 44.2, 55.8).forEach((x, i) => curls.push([x, 46.8 + jitter(i + 5, 0.8), 1.35]));
    out.push(
      <g key="curls">
        <ellipse cx="50.3" cy="45.2" rx="9.8" ry="3.4" fill="#000" fillOpacity={0.2} />
        <ellipse cx="50" cy="44.4" rx="9.6" ry="3.3" fill={shade(col, 0.2)} />
        {curls.map(([x, y, r], i) => (
          <g key={i}>
            <circle cx={x + 0.3} cy={y + 0.45} r={r} fill="#000" fillOpacity={0.2} />
            <circle cx={x} cy={y} r={r} fill={col} />
            <path
              d={`M${x - r * 0.6} ${y} A${r * 0.6} ${r * 0.6} 0 0 1 ${x + r * 0.35} ${y - r * 0.5}`}
              stroke={tint(col, 0.4)}
              strokeOpacity={0.9}
              strokeWidth={0.42}
              fill="none"
            />
          </g>
        ))}
      </g>,
    );
  }
  return (
    <g>
      <defs>
        <clipPath id={`${id}tip`}>
          <rect x="0" y={hair.style === 'longLocs' ? 54.5 : 46.6} width="100" height="40" />
        </clipPath>
      </defs>
      {out}
    </g>
  );
}

// ---------- the QB's padded sleeve: the arm as a cylinder, so a pad turned toward the outer edge squeezes there ----------
function hexPattern(id: string, cell: string, gap: string, squeeze: number) {
  const r = 1.32;
  const hex = (cx: number, cy: number) =>
    [
      [cx, cy - r],
      [cx + 0.866 * r, cy - r / 2],
      [cx + 0.866 * r, cy + r / 2],
      [cx, cy + r],
      [cx - 0.866 * r, cy + r / 2],
      [cx - 0.866 * r, cy - r / 2],
    ]
      .map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`)
      .join(' ');
  return (
    <pattern id={id} width="2.6" height="4.5" patternUnits="userSpaceOnUse" patternTransform={`scale(${squeeze} 1)`}>
      <rect width="2.6" height="4.5" fill={gap} />
      {[
        [1.3, 1.1],
        [0, 3.35],
        [2.6, 3.35],
        [1.3, 5.6],
        [0, -1.15],
        [2.6, -1.15],
      ].map(([x, y]) => (
        <polygon key={`${x},${y}`} points={hex(x, y)} fill={cell} />
      ))}
    </pattern>
  );
}
function shadingGrad(id: string, arm: 'L' | 'R') {
  return (
    <linearGradient id={id} x1={arm === 'L' ? 0 : 1} x2={arm === 'L' ? 1 : 0} y1="0" y2="0">
      <stop offset="0" stopColor="#FFF" stopOpacity={0.12} />
      <stop offset="0.45" stopColor="#000" stopOpacity={0.05} />
      <stop offset="1" stopColor="#000" stopOpacity={0.4} />
    </linearGradient>
  );
}
/** A band around the arm seen from a little above: its edges sag in the middle. */
const bandPath = (x0: number, x1: number, y0: number, y1: number, sag: number) =>
  `M${x0} ${y0} Q${(x0 + x1) / 2} ${y0 + sag * 2} ${x1} ${y0} L${x1} ${y1} Q${(x0 + x1) / 2} ${y1 + sag * 2} ${x0} ${y1} Z`;

function QbSleeveLayer({ id, f, s }: { id: string; f: Figure; s: QbSleeve }) {
  const arm = f.armR;
  const [x0, x1] = spanOf(arm);
  const W = x1 - x0;
  // the elbow's cross-section: the outer edge is +x on the right arm
  const [e0, e1] = spanOf(arm, 80, 88);
  const cx = (e0 + e1) / 2 - 0.4;
  const R = (e1 - e0) / 2 - 0.3;
  const half = 38;
  const a = Math.max(-89, s.turn - half);
  const b = Math.min(100, s.turn + half);
  const px0 = cx + R * Math.sin(rad(a));
  const px1 = b >= 90 ? x1 + 2 : cx + R * Math.sin(rad(b));
  const squeeze = Math.max(0.45, Math.cos(rad(s.turn)));
  const [y0, y1] = s.kind === 'hex' ? [55, 140] : [71.5, 97];
  const padBox = { x: px0, y: 76.6, width: px1 - px0, height: 14.8, rx: 3 };
  const cell = tint(s.pad, 0.12);
  return (
    <g>
      <defs>
        <clipPath id={`${id}qa`}>
          <path d={arm} />
        </clipPath>
        {hexPattern(`${id}hx`, cell, shade(cell, 0.5), squeeze)}
        {shadingGrad(`${id}qs`, 'R')}
        <linearGradient id={`${id}pe`} x1={px0} x2={px1} y1="0" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity={0.14} />
          <stop offset="0.6" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.3} />
        </linearGradient>
      </defs>
      <g clipPath={`url(#${id}qa)`}>
        <rect x={x0 - 1} y={y0} width={W + 2} height={y1 - y0} fill={s.color} />
        <rect {...padBox} fill={`url(#${id}hx)`} />
        <rect {...padBox} fill={`url(#${id}pe)`} />
        <rect {...padBox} fill="none" stroke="#000" strokeOpacity={0.4} strokeWidth={0.45} />
        {/* the pad is thick: its edge toward us catches the light */}
        <path
          d={`M${px0 + 0.5} 79 L${px0 + 0.5} 89`}
          stroke="#fff"
          strokeOpacity={0.22}
          strokeWidth={0.5}
          strokeLinecap="round"
        />
        {y1 < 140 && <path d={bandPath(x0 - 1, x1 + 1, y1 - 0.6, y1 + 0.6, 0.3)} fill="#000" fillOpacity={0.25} />}
        {y0 > 60 && <path d={bandPath(x0 - 1, x1 + 1, y0 + 0.2, y0 + 1.4, 0.3)} fill="#000" fillOpacity={0.25} />}
        <rect x={x0 - 1} y={y0} width={W + 2} height={y1 - y0} fill={`url(#${id}qs)`} />
      </g>
    </g>
  );
}

// ---------- play-call wristband on the left wrist; the card faces out, where he turns his wrist to read it ----------
function WristLayer({ id, f, w, primary }: { id: string; f: Figure; w: Wrist; primary: string }) {
  const arm = f.armL;
  const [y0, y1] = w.y;
  const [x0, x1] = spanOf(arm, y0 - 2, y1 + 2);
  const W = x1 - x0;
  const cx = (x0 + x1) / 2 + 0.3;
  const R = W / 2 - 0.4;
  const sag = 0.35;
  // the card's left and right edges in degrees around the arm (negative = toward the outer edge, the left)
  const [a, b] = w.turn === null ? [-62, 62] : [Math.max(-100, w.turn - 44), w.turn + 44];
  const X = (deg: number) => (deg <= -90 ? x0 - 2 : cx + R * Math.sin(rad(deg)));
  const win = { x0: X(a), x1: X(b), y0: y0 + 1.5, y1: y1 - 1.5 };
  const rows = Math.floor((win.y1 - win.y0 - 1) / 1.35);
  const cols = [1 / 3, 2 / 3].map((t) => X(a + (b - a) * t));
  const cellColors = ['#ffcf1f', '#e05a4f', '#4f9be0', '#5fbf7a'];
  // the colour cells sit at the card's inner (readable) edge of each row
  const cellX0 = X(a + (b - a) * 0.04);
  const cellX1 = X(a + (b - a) * 0.2);
  return (
    <g>
      <defs>
        <clipPath id={`${id}wa`}>
          <path d={arm} />
        </clipPath>
        <clipPath id={`${id}wc`}>
          <path d={bandPath(win.x0, win.x1, win.y0, win.y1, sag)} />
        </clipPath>
        {shadingGrad(`${id}ws`, 'L')}
      </defs>
      <g clipPath={`url(#${id}wa)`}>
        <path d={bandPath(x0 - 1, x1 + 1, y0, y1, sag)} fill={w.band} />
        <path d={bandPath(x0 - 1, x1 + 1, y0, y0 + 0.7, sag)} fill={w.trim} />
        <path d={bandPath(x0 - 1, x1 + 1, y1 - 0.7, y1, sag)} fill={w.trim} />
        <path d={bandPath(win.x0, win.x1, win.y0, win.y1, sag)} fill="#EEF2F5" />
        <g clipPath={`url(#${id}wc)`}>
          <rect x={win.x0 - 2} y={win.y0 - 1} width={win.x1 - win.x0 + 4} height={1.9} fill={primary} />
          {Array.from({ length: rows }, (_, i) => {
            const y = win.y0 + 1.5 + i * 1.35;
            return (
              <g key={i}>
                <path
                  d={`M${win.x0} ${y} Q${(win.x0 + win.x1) / 2} ${y + sag * 2} ${win.x1} ${y}`}
                  stroke="#8b97a3"
                  strokeWidth={0.18}
                  fill="none"
                />
                {i % 2 === 0 && (
                  <rect
                    x={Math.min(cellX0, cellX1)}
                    y={y + 0.2}
                    width={Math.abs(cellX1 - cellX0)}
                    height={1}
                    fill={cellColors[(i / 2) % cellColors.length]}
                  />
                )}
              </g>
            );
          })}
          {cols.map((x) => (
            <path key={x} d={`M${x} ${win.y0 + 1} L${x} ${win.y1 + 1}`} stroke="#8b97a3" strokeWidth={0.18} />
          ))}
          <path
            d={`M${win.x0 + (win.x1 - win.x0) * 0.25} ${win.y1} L${win.x0 + (win.x1 - win.x0) * 0.7} ${win.y0 + 1}`}
            stroke="#fff"
            strokeOpacity={0.7}
            strokeWidth={0.7}
            strokeLinecap="round"
          />
        </g>
        <path
          d={bandPath(win.x0, win.x1, win.y0, win.y1, sag)}
          fill="none"
          stroke="#000"
          strokeOpacity={0.45}
          strokeWidth={0.35}
        />
        <rect x={x0 - 1} y={y0 - 1} width={W + 2} height={y1 - y0 + 2} fill={`url(#${id}ws)`} />
      </g>
    </g>
  );
}

// ---------- the avatar (PlayerAvatar, copied, with the mockup layers) ----------
function MockAvatar(o: Opts) {
  const id = `m${uid++}`;
  const url = (part: string) => `url(#${id}${part})`;
  const { guy, colors, size } = o;
  const { primary } = colors;
  const kit = kitFor(colors, !!o.away);
  const { jersey, ink, trim, accent } = kit;
  const look = playerLook(guy as never, size);
  const { figure: f, head, transform } = look;
  const gear = size >= 32 ? guy.gear : null;
  const plate = guy.lastName.toUpperCase();
  const plateSize = Math.min(9.5, f.plateMax / (plate.length * PLATE_EM));
  const numberX = 1.15 * f.numberWidth;
  const px = o.px ?? size;
  return (
    <svg width={px} height={px} viewBox={o.view ?? '0 0 100 100'} fontFamily="var(--font-display)" aria-hidden="true">
      <defs>
        <clipPath id={`${id}c`}>
          <circle cx="50" cy="50" r="45" />
        </clipPath>
        <radialGradient id={`${id}bg`} cx="50" cy="38" r="56" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(primary, 0.82)} />
          <stop offset="1" stopColor={tint(primary, 0.5)} />
        </radialGradient>
        <radialGradient id={`${id}sk`} cx="44" cy="20" r="34" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(SKIN, 0.18)} />
          <stop offset="1" stopColor={shade(SKIN, 0.35)} />
        </radialGradient>
        <radialGradient id={`${id}arm`} cx="0.45" cy="0.3" r="0.75">
          <stop offset="0" stopColor={tint(SKIN, 0.16)} />
          <stop offset="1" stopColor={shade(SKIN, 0.4)} />
        </radialGradient>
        <linearGradient id={`${id}j`} x1="0" y1="44" x2="0" y2="100" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(jersey, 0.14)} />
          <stop offset="1" stopColor={shade(jersey, 0.22)} />
        </linearGradient>
        {f.pants && (
          <linearGradient
            id={`${id}p`}
            x1={50 - f.pants.halfWidth}
            y1="0"
            x2={50 + f.pants.halfWidth}
            y2="0"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0" stopColor={shade(kit.pants, 0.32)} />
            <stop offset="0.24" stopColor={tint(kit.pants, 0.12)} />
            <stop offset="0.5" stopColor={shade(kit.pants, 0.16)} />
            <stop offset="0.76" stopColor={tint(kit.pants, 0.12)} />
            <stop offset="1" stopColor={shade(kit.pants, 0.32)} />
          </linearGradient>
        )}
      </defs>
      <circle cx="50" cy="50" r="45" fill={url('bg')} />
      <g clipPath={url('c')}>
        <g transform={transform}>
          <path d={f.armL} fill={url('arm')} />
          <path d={f.armR} fill={url('arm')} />
          {gear && <GearLayer id={id} figure={f} gear={gear} colors={colors} />}
          {o.qb && <QbSleeveLayer id={`${id}q`} f={f} s={o.qb} />}
          {o.wrist && <WristLayer id={`${id}w`} f={f} w={o.wrist} primary={primary} />}
          {o.helmet && (
            <g
              transform={`translate(0 ${o.helmet.lift ?? 0}) translate(50 26) scale(${o.helmet.scale ?? 1}) translate(-50 -26)`}
            >
              <CageLayer h={o.helmet} />
            </g>
          )}
          <path d={f.neck} fill={url('sk')} />
          <path d={f.neckSides} fill="#000" fillOpacity={0.08} />
          <path d={f.neckShade} fill="#000" fillOpacity={0.16} />
          {!o.helmet && (
            <>
              <path d={head.ears} fill={url('sk')} />
              <path d={head.d} fill={url('sk')} />
            </>
          )}
          <path
            d={f.jersey}
            fill={url('j')}
            stroke="#0F172A"
            strokeOpacity={0.35}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <ellipse cx="50" cy={f.shadow.cy} rx={f.shadow.rx} ry="2.4" fill="#000" fillOpacity={0.16} />
          <path d={f.padShelf} fill="#000" fillOpacity={0.1} />
          <path d={f.folds} fill="#000" fillOpacity={0.14} />
          {f.pants && (
            <>
              <path
                d={f.pants.pants}
                fill={url('p')}
                stroke="#0F172A"
                strokeOpacity={0.35}
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
              <path d={f.pants.stripes} fill={kit.stripe} />
              <path d={f.pants.stripesThin} fill={kit.stripeThin} />
              <path d={f.pants.seam} stroke="#000" strokeOpacity={0.18} strokeWidth={0.6} />
              <path d={f.pants.belt} fill={kit.belt} />
              <path d={f.pants.tuck} fill={url('j')} />
              <path d={f.pants.tuck} fill="#000" fillOpacity={0.12} />
            </>
          )}
          <path
            d={f.padGloss}
            stroke="#FFFFFF"
            strokeOpacity={0.35}
            strokeWidth={1.3}
            strokeLinecap="round"
            fill="none"
          />
          <path d={f.sleeveShadow} fill="#000" fillOpacity={0.28} />
          <path d={f.collar} stroke={ink} strokeWidth={2.4} fill="none" />
          {size >= 32 && (
            <>
              <path d={f.bandsUpper} stroke={ink} strokeWidth={2} fill="none" />
              <path d={f.bandsLower} stroke={accent} strokeWidth={2} fill="none" />
              <text
                x="50"
                y="78"
                transform={`translate(${+(50 * (1 - numberX)).toFixed(2)} 0) scale(${+numberX.toFixed(3)} 1)`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={32}
                fontWeight={900}
                fill={ink}
                stroke={trim}
                strokeWidth={1.4}
                paintOrder="stroke"
                strokeLinejoin="round"
              >
                {guy.jersey}
              </text>
            </>
          )}
          {size >= 96 && (
            <text
              x="50"
              y="56.2"
              textAnchor="middle"
              dominantBaseline="central"
              fontSize={plateSize}
              fontWeight={800}
              letterSpacing={0.3}
              fill={ink}
              textLength={plate.length * PLATE_EM * plateSize}
              lengthAdjust="spacingAndGlyphs"
            >
              {plate}
            </text>
          )}
          {/* hair over the jersey (long locs cover the nameplate, as they do), the helmet over the hair */}
          {o.hair && o.helmet && <HairLayer id={`${id}hr`} hair={o.hair} />}
          {o.helmet && (
            <g
              transform={`translate(0 ${o.helmet.lift ?? 0}) translate(50 26) scale(${o.helmet.scale ?? 1}) translate(-50 -26)`}
            >
              <HelmetLayer id={`${id}h`} h={o.helmet} num={guy.jersey} />
            </g>
          )}
        </g>
      </g>
      <circle cx="50" cy="50" r="46.5" fill="none" stroke={shade(primary, 0.35)} strokeWidth={5} />
      <circle cx="50" cy="50" r="43.6" fill="none" stroke={tint(primary, 0.45)} strokeWidth={0.6} strokeOpacity={0.8} />
    </svg>
  );
}
const svg = (o: Opts) => renderToStaticMarkup(<MockAvatar {...o} />);
const STYLE = String.raw`<style>
/* Layout: the app's press-box console, a mockup board of option cards per gear piece. Tokens copied from src/styles.css. */
:root {
  --bg: #eff2ee; --surface: #ffffff; --surface-2: #e5eae4; --ink: #121915; --muted: #5a675f; --line: #d3dbd3;
  --marker: #ffcf1f; --marker-ink: #251e00;
  --font-display: 'Big Shoulders Display', 'Arial Narrow', 'Roboto Condensed', sans-serif;
  --font-body: 'Atkinson Hyperlegible', system-ui, -apple-system, 'Segoe UI', sans-serif;
  --font-data: 'IBM Plex Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
  --radius: 10px;
}
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) {
  --bg: #0d1210; --surface: #141b17; --surface-2: #1b241f; --ink: #e5ebe6; --muted: #93a198; --line: #29342e;
  --marker: #ffd43b; --marker-ink: #1f1900; color-scheme: dark } }
:root[data-theme="dark"] {
  --bg: #0d1210; --surface: #141b17; --surface-2: #1b241f; --ink: #e5ebe6; --muted: #93a198; --line: #29342e;
  --marker: #ffd43b; --marker-ink: #1f1900; color-scheme: dark }
body { background: var(--bg); color: var(--ink); font: 400 15px/1.5 var(--font-body); }
main { max-width: 1180px; margin: 0 auto; padding-block: 28px 64px;
  padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px));
  display: grid; gap: 40px; }
h1, h2, h3 { font-family: var(--font-display); font-weight: 900; letter-spacing: 0.01em; margin: 0; text-wrap: balance; line-height: 1.05; }
h1 { font-size: 2.6rem; text-transform: uppercase; }
h2 { font-size: 1.9rem; text-transform: uppercase; }
h3 { font-size: 1.25rem; text-transform: uppercase; color: var(--muted); }
p { margin: 0; max-width: 68ch; }
.lede { display: grid; gap: 10px; }
.lede p { color: var(--muted); }
.eyebrow { font: 600 0.75rem/1 var(--font-data); text-transform: uppercase; letter-spacing: 0.08em; color: var(--muted); }
section { display: grid; gap: 18px; }
.head { display: grid; gap: 6px; }
.grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 14px; }
.grid.two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.grid.four { grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (max-width: 960px) { .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 620px) { .grid, .grid.two, .grid.four { grid-template-columns: minmax(0, 1fr); } }
.opt { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; display: grid; gap: 12px; align-content: start; }
.opt.pick, .row.pick { border-color: var(--marker); box-shadow: inset 0 0 0 1px var(--marker); }
.pics { display: flex; gap: 12px; align-items: end; flex-wrap: wrap; }
.big svg { display: block; }
.zoom { display: grid; gap: 4px; justify-items: center; }
.zoom svg { display: block; background: var(--surface-2); border-radius: 8px; }
.zoom span, .sz span { font: 400 0.7rem/1 var(--font-data); color: var(--muted); }
figcaption, .rowhead { display: grid; grid-template-columns: auto 1fr auto; gap: 4px 8px; align-items: baseline; }
figcaption b, .rowhead b { font-weight: 700; }
.tag { font: 600 0.8rem/1 var(--font-data); background: var(--surface-2); padding: 4px 6px; border-radius: 4px; }
.chip { font: 600 0.7rem/1 var(--font-data); text-transform: uppercase; letter-spacing: 0.06em; background: var(--marker); color: var(--marker-ink); padding: 4px 6px; border-radius: 4px; }
.note { grid-column: 1 / -1; color: var(--muted); font-size: 0.9rem; }
.rows { display: grid; gap: 10px; }
.row { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 14px; display: grid; grid-template-columns: minmax(0, 200px) minmax(0, 1fr); gap: 16px; align-items: center; }
.rowpics { display: flex; gap: 14px; align-items: end; flex-wrap: wrap; }
.rowpics .gap { width: 10px; }
@media (max-width: 760px) { .row { grid-template-columns: minmax(0, 1fr); } }
.strip { display: flex; gap: 22px; align-items: end; flex-wrap: wrap; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 16px; }
.sz { display: grid; gap: 6px; justify-items: center; }
.sz svg { display: block; }
.strip .label { font-weight: 700; align-self: center; min-width: 120px; }
.changes { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; }
.decide { background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px 20px; display: grid; gap: 12px; }
.decide ol { margin: 0; padding-left: 1.3em; display: grid; gap: 8px; }
.decide li { max-width: 80ch; }
.lineup { gap: 12px; }
.league { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 960px) { .league { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .league { grid-template-columns: minmax(0, 1fr); } }
.mini { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; display: flex; gap: 12px; align-items: center; }
.mini svg { display: block; flex: none; }
.mini figcaption { display: grid; gap: 2px; grid-template-columns: 1fr; }
.mini figcaption span { color: var(--muted); font-size: 0.85rem; } .from { color: var(--ink); font-weight: 700; } .muted { color: var(--muted); }
</style>`;
// ---------- cast ----------
const KC: Colors = { primary: '#e31837', secondary: '#ffb81c' };
const GREY = '#9AA3AD';
const BLK = '#1A1D22';
const WHT = '#F2F4F6';
const SCALE = 0.85; // Z3
const NECK = { base: 38.8, k: 0.5 }; // N2
type Design = Omit<Helmet, 'scale' | 'lift' | 'cage'>;
/** The mask by position: one bar for skill players, two for the middle of the field, the full cage up front. */
const cageFor = (g: Guy): Cage =>
  ['OL', 'DT'].includes(g.position)
    ? 'line'
    : ['LB', 'EDGE', 'TE'].includes(g.position)
      ? 'hybrid'
      : g.position === 'K' || g.position === 'P'
        ? 'kicker'
        : g.position === 'QB'
          ? 'qb'
          : 'skill';
const fitted = (g: Guy, h: Design): Helmet => {
  const bottom = 26 + (MODELS[h.model].bottom - 26) * SCALE;
  const target = NECK.base - NECK.k * Math.max(0, buildOf(g.weightLb).traps);
  return { flags: ['US'], ...h, cage: cageFor(g), scale: SCALE, lift: +(target - bottom).toFixed(2) };
};
const KC_D: Design = {
  model: 'axiom',
  shell: '#e31837',
  finish: 'gloss',
  stripe: 'triple',
  a: '#ffb81c',
  b: '#ffffff',
  number: { ink: '#ffffff', trim: '#7a0d1d' },
  bumper: '#f2f4f6',
  mask: WHT,
};
const HV = (g: Guy) => (['OL', 'DT'].includes(g.position) ? '34 8.5 32 32' : '34 7 32 32');
const WEIGHT: Record<string, number> = {
  QB: 225,
  WR: 196,
  OL: 315,
  LB: 242,
  RB: 214,
  CB: 190,
  EDGE: 266,
  TE: 252,
  S: 205,
  DT: 305,
  K: 190,
};
const HEIGHT: Record<string, number> = {
  QB: 75,
  WR: 73,
  OL: 77,
  LB: 74,
  RB: 70,
  CB: 71,
  EDGE: 76,
  TE: 77,
  S: 72,
  DT: 75,
  K: 72,
};
const guy = (id: number, position: Pos, jersey: number, lastName: string): Guy => ({
  id,
  position,
  heightIn: HEIGHT[position],
  weightLb: WEIGHT[position],
  jersey,
  lastName,
  gear: {},
});
const QB = guy(1015, 'QB', 12, 'Caldwell');
const card = (tag: string, title: string, note: string, pics: string, pick = false) => `
<figure class="opt${pick ? ' pick' : ''}">
  <div class="pics">${pics}</div>
  <figcaption><span class="tag">${tag}</span><b>${title}</b>${pick ? '<span class="chip">My pick</span>' : ''}<span class="note">${note}</span></figcaption>
</figure>`;
const closeup = (o: Opts, px: number, label: string) =>
  `<div class="zoom">${svg({ ...o, px, view: HV(o.guy) })}<span>${label}</span></div>`;

const zoom = (o: Opts, px: number, label: string) =>
  `<div class="zoom">${svg({ ...o, size: 128, px, view: HV(o.guy) })}<span>${label}</span></div>`;
const both = (o: Opts) => `<div class="big">${svg(o)}</div>${zoom(o, 176, 'close-up')}`;

const D = (
  shell: string,
  finish: Helmet['finish'],
  stripe: Helmet['stripe'],
  a: string | undefined,
  b: string | undefined,
  num: [string, string] | null,
  bumper: string,
  mask: string,
  model: Model = 'axiom',
): Design => ({
  model,
  shell,
  finish,
  stripe,
  a,
  b,
  number: num ? { ink: num[0], trim: num[1] } : undefined,
  bumper,
  mask,
});
const PATHWAY: [string, string][] = [
  ['DE', 'Germany'],
  ['GB', 'United Kingdom'],
  ['AU', 'Australia'],
  ['NG', 'Nigeria'],
  ['MX', 'Mexico'],
  ['FR', 'France'],
  ['AT', 'Austria'],
  ['IT', 'Italy'],
  ['BR', 'Brazil'],
  ['JP', 'Japan'],
  ['GH', 'Ghana'],
  ['NZ', 'New Zealand'],
  ['CA', 'Canada'],
  ['IE', 'Ireland'],
  ['SE', 'Sweden'],
];
const flagPair = (code: string) =>
  renderToStaticMarkup(
    <svg width={56} height={80} viewBox="-0.3 -0.3 4 5.45" aria-hidden="true">
      <Flag code="US" x={0} y={0} />
      <Flag code={code} x={0} y={FLAG_H + FLAG_GAP} />
    </svg>,
  );
const flagStrip = PATHWAY.map(([c, n]) => `<div class="sz">${flagPair(c)}<span>${n}</span></div>`).join('');

// ---------- 1. the dot, a bit higher ----------
const BEFORE: Record<string, number> = { axiom: 30.4, f7: 31.9, zero2: 32.4, veng: 34.4 };
const withDy = (model: string, dy: number, f: () => string) => {
  const was = DECALS[model].dy;
  DECALS[model].dy = dy;
  const out = f();
  DECALS[model].dy = was;
  return out;
};
const dotQB = (model: Model): Opts => ({
  guy: QB,
  colors: KC,
  size: 128,
  helmet: { ...fitted(QB, { ...KC_D, model }), dot: true },
});
const dotPairs = (['axiom', 'f7', 'zero2', 'veng'] as Model[])
  .map((m) => {
    const before = withDy(m, BEFORE[m], () => zoom(dotQB(m), 112, 'before'));
    const after = zoom(dotQB(m), 112, 'now');
    return `<figure class="club"><div class="dotpair">${before}${after}</div><figcaption><b>${({ axiom: 'Modern', f7: 'Plated', zero2: 'Pod', veng: 'Classic' } as Record<string, string>)[m]}</b></figcaption></figure>`;
  })
  .join('');

// ---------- 2. the gear editor ----------
// our own names for the shells; the real helmets they were drawn from stay out of the game
const HELMETS: [Model, string, string][] = [
  ['axiom', 'Modern', 'Vent slits, a ledge with two pockets, a bumper plate.'],
  ['axiomLite', 'Modern, smooth', 'The same shell with the ledge and pockets only.'],
  ['f7', 'Plated', 'Vertical slots and a dark plate across the lower back.'],
  ['veng', 'Classic', 'Round, two holes on top, a ledge, a dark bumper.'],
  ['zero2', 'Pod', 'Smooth and tall, dot vents, a dark plate.'],
  ['zero2t', 'Pod, wide', 'The lineman’s version: wider and squarer.'],
  ['ridge', 'Ridgeback', 'Ours: a raised spine down the middle.'],
  ['oldmod', 'Retro', 'Ours: the classic shape with modern slits.'],
];
const S1b: QbSleeve = { kind: 'hex', color: '#1A1D22', pad: '#3a4048', turn: 62 };
const edQB = (model: Model): Opts => ({
  guy: QB,
  colors: KC,
  size: 128,
  helmet: { ...fitted(QB, { ...KC_D, model }), dot: true },
  qb: S1b,
  wrist: { band: '#EEF1F4', trim: '#EEF1F4', y: [92, 104.6], turn: -75 },
});
const previews = HELMETS.map(
  ([m], i) =>
    `<div class="preview" data-model="${m}"${i === 0 ? '' : ' hidden'}><div class="big">${svg(edQB(m))}</div>${zoom(edQB(m), 176, 'helmet')}</div>`,
).join('');
const opt = (pairs: [string, string][], selected = '') =>
  pairs.map(([v, t]) => `<option value="${v}"${v === selected ? ' selected' : ''}>${t}</option>`).join('');
const colours: [string, string][] = [
  ['black', 'Black'],
  ['white', 'White'],
  ['primary', 'Team colour'],
  ['secondary', 'Second colour'],
];
const editor = `<div class="editor">
  <div>${previews}</div>
  <fieldset class="gear-edit">
    <legend class="eyebrow">Gear</legend>
    <div class="gear-edit-row new">
      <label><span class="eyebrow">Helmet<span class="newtag">new</span></span><select id="helmet-pick">${opt(
        HELMETS.map(([m, n]) => [m, n]),
        'axiom',
      )}</select></label>
    </div>
    <div class="gear-edit-row">
      <label><span class="eyebrow">Sleeve</span><select id="sleeve-pick">${opt(
        [
          ['none', 'None'],
          ['undershirt', 'Undershirt'],
          ['full', 'Full'],
          ['threeQuarter', 'Three-quarter'],
          ['half', 'Half'],
          ['forearm', 'Forearm'],
          ['shooter', 'Shooter'],
          ['padded', 'Padded (new)'],
          ['paddedElbow', 'Padded elbow (new)'],
        ],
        'padded',
      )}</select></label>
      <label><span class="eyebrow">Arm</span><select id="sleeve-arm">${opt(
        [
          ['right', 'Right arm'],
          ['left', 'Left arm'],
          ['both', 'Both arms'],
        ],
        'right',
      )}</select></label>
      <label><span class="eyebrow">Colour</span><select id="sleeve-colour">${opt(colours, 'black')}</select></label>
    </div>
    <div class="gear-edit-row new">
      <label><span class="eyebrow">Wristband<span class="newtag">new</span></span><select id="wrist-pick">${opt(
        [
          ['none', 'None'],
          ['left', 'Left wrist'],
          ['right', 'Right wrist'],
        ],
        'left',
      )}</select></label>
      <label><span class="eyebrow">Colour</span><select id="wrist-colour">${opt(colours, 'white')}</select></label>
    </div>
    <div class="gear-edit-row">
      <label><span class="eyebrow">Band</span><select id="band-pick">${opt(
        [
          ['none', 'None'],
          ['biceps', 'Biceps'],
          ['forearm', 'Forearm'],
        ],
        'none',
      )}</select></label>
    </div>
    <div class="gear-edit-row">
      <label><span class="eyebrow">Elbow pads</span><select id="pads-pick">${opt(
        [
          ['none', 'None'],
          ['on', 'On'],
        ],
        'none',
      )}</select></label>
      <label><span class="eyebrow">Shoulder brace</span><select id="brace-pick">${opt(
        [
          ['none', 'None'],
          ['left', 'Left shoulder'],
          ['right', 'Right shoulder'],
        ],
        'none',
      )}</select></label>
    </div>
    <div class="reset"><button type="button" id="reset-gear">Back to his own</button><span>Your pick.</span></div>
  </fieldset>
</div>`;
const nameCards = HELMETS.map(
  ([m, n, what]) =>
    `<figure class="club"><div class="pics">${zoom(edQB(m), 104, '')}</div><figcaption><b>${n}</b><span>${what}</span></figcaption></figure>`,
).join('');

// ---------- page ----------
const page = `<title>Helmet &amp; QB Gear Mockups</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Atkinson+Hyperlegible:wght@400;700&family=Big+Shoulders+Display:wght@700;800;900&family=IBM+Plex+Mono:wght@400;600&display=swap">
__STYLE__
<main>
  <header class="lede">
    <span class="eyebrow">AFLS · avatar mockups · round 11 · nothing here is in the game yet</span>
    <h1>Helmet &amp; QB gear</h1>
    <p>The 32-club board from last round stands (it's in this page's version history). This round:</p>
    <ul class="changes">
      <li>The green dot a bit higher, clear of the number.</li>
      <li>The helmet in the gear editor (the pencil on a player's card), with our own names for the shells.</li>
      <li>Alternate helmets held for the alternate jerseys and throwbacks pass.</li>
    </ul>
  </header>

  <section>
    <div class="head"><span class="eyebrow">1 · Decals</span><h2>The dot, a bit higher</h2>
    <p>About one dot-width higher on every shell, so there's a clear gap above the number (or above the plate).</p></div>
    <div class="clubs">${dotPairs}</div>
  </section>

  <section>
    <div class="head"><span class="eyebrow">2 · Your pick</span><h2>The gear editor</h2>
    <p>A mockup of the card's pencil editor with the new rows marked. The Helmet list works here: pick one to see him in it. The other rows are only for show. Like the rest of the editor, anything goes whatever his position, and “Back to his own” returns him to the shell the game picked.</p></div>
    ${editor}
  </section>

  <section>
    <div class="head"><h3>The shells, by our names</h3>
    <p>Descriptive names only. The makers' names and model names they were drawn from stay out of the game.</p></div>
    <div class="names">${nameCards}</div>
  </section>
</main>
<script>
(() => {
  const pick = document.getElementById('helmet-pick');
  const show = () => document.querySelectorAll('.preview').forEach((el) => { el.hidden = el.dataset.model !== pick.value; });
  pick.addEventListener('change', show);
  document.getElementById('reset-gear').addEventListener('click', () => { pick.value = 'axiom'; show(); });
  show();
})();
</script>
`.replace(
  '__STYLE__',
  STYLE.replace(
    '</style>',
    `.division { display: grid; gap: 10px; }
.clubs { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1000px) { .clubs { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .clubs { grid-template-columns: minmax(0, 1fr); } }
.club { margin: 0; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 12px; display: grid; gap: 10px; }
.club .pics { gap: 10px; }
.club figcaption { display: grid; gap: 2px; grid-template-columns: 1fr; }
.club figcaption span { color: var(--muted); font-size: 0.85rem; }
.club .small { font: 400 0.72rem/1.3 var(--font-data); }
.decide p { color: var(--muted); }

.flags { gap: 18px 22px; }
.alts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
@media (max-width: 1000px) { .alts { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .alts { grid-template-columns: minmax(0, 1fr); } }
.note b { color: var(--ink); }
.dotpair { display: flex; gap: 10px; }
.editor { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 20px; align-items: start; background: var(--surface); border: 1px solid var(--line); border-radius: var(--radius); padding: 18px; }
@media (max-width: 760px) { .editor { grid-template-columns: minmax(0, 1fr); } }
.preview { display: flex; gap: 12px; align-items: end; }
.preview[hidden] { display: none !important; }
.gear-edit { display: grid; gap: 12px; margin: 0; padding: 0; border: 0; min-width: 0; }
.gear-edit legend { padding: 0; margin-bottom: 6px; }
.gear-edit-row { display: flex; flex-wrap: wrap; gap: 10px; }
.gear-edit-row label { display: grid; gap: 4px; min-width: 150px; }
.gear-edit-row.new { background: color-mix(in srgb, var(--marker) 18%, transparent); border-radius: 8px; padding: 8px; margin: -8px; }
.gear-edit select { font: inherit; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); color: var(--ink); }
.newtag { font: 600 0.65rem/1 var(--font-data); text-transform: uppercase; letter-spacing: 0.06em; background: var(--marker); color: var(--marker-ink); padding: 3px 5px; border-radius: 4px; margin-left: 6px; }
.reset { display: flex; gap: 10px; align-items: center; color: var(--muted); font-size: 0.85rem; }
.reset button { font: inherit; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: transparent; color: var(--ink); }
.names { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
@media (max-width: 1000px) { .names { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .names { grid-template-columns: minmax(0, 1fr); } }
</style>`,
  ),
);
writeFileSync(process.argv[2], page);
console.log('wrote', process.argv[2], (page.length / 1024).toFixed(0), 'KB');
