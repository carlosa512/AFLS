import type { ReactElement } from 'react';
import type { HelmetDesign, HelmetModel } from '../engine/types';
import { shade, tint } from './color';
import { Flag, FLAG_GAP, FLAG_H } from './flags';
import { HELMET_NECK_PER_TRAP, HELMET_NECK_Y, HELMET_SCALE, isDarkShell, type FlagCode, type MaskKind } from './helmet';

// The avatar's helmet from behind (`helmet.ts` decides who wears which). Each shell was drawn from a rear photo of a
// real helmet, or mixes their parts, all in one box so one size and fit hold for every shell: the paths share the
// figure's 100-unit box, the helmet scaled about the middle of the head (50, 26). Inside the shell's clip go the club's
// stripes, then the shell's vents and ledges; a plate or bumper and the decals go on top. The mockups behind every
// number are in docs/superpowers/specs/2026-11-02-helmets-qb-gear-mockup.tsx.

const VENT = '#101215';
const DARK_PLATE = '#17191d';
const CLIP = '#16181c';
const GLOSS = 'M38.2 18 C39.6 13.2 43 9.8 47 8.9';
const GLOSS_ROUND = 'M38.4 19.4 C39.4 14 43.6 10.4 48.4 9.8';

/** A path flipped left to right about the middle (paths are M, L, C and Z only, so every pair is a point). */
const mirror = (d: string) => d.replace(/(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => `${+(100 - Number(x)).toFixed(2)} ${y}`);
const pair = (d: string) => [d, mirror(d)];

interface Clip {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Shell {
  shell: string;
  details: (c: string) => ReactElement;
  /** A plate on the lower back: dark rubber or the design's bumper colour; `inside` sits within the shell's edge. */
  plate: { d: string; tone: 'dark' | 'bumper'; inside?: boolean };
  /** Where the stripe stops when the number is on the shell (or the plate is inside it). */
  stripeEnd: number;
  number: { y: number; size: number; on: 'shell' | 'plate' };
  clips: Clip[];
  gloss: string;
  /** The back's lowest point, before scaling: the fit puts it where the neck rule says. */
  bottom: number;
  /** Wider, for linemen. */
  widen?: number;
  /** The decals: the flags' box (left, top), the green dot's height. */
  decals: { fx: number; fy: number; dy: number };
}

const vents = (ds: string[]) => (
  <>
    {ds.flatMap(pair).map((d) => (
      <path key={d} d={d} fill={VENT} fillOpacity={0.88} stroke="#fff" strokeOpacity={0.16} strokeWidth={0.3} />
    ))}
  </>
);
/** A vertical slot with rounded ends, from curves (not arcs) so `mirror` can flip every point. */
const slot = (x: number, y0: number, y1: number, w = 1.15) => {
  const [l, r, h] = [x - w / 2, x + w / 2, w / 2];
  return `M${l} ${y0 + h} C${l} ${y0 - h * 0.3} ${r} ${y0 - h * 0.3} ${r} ${y0 + h} L${r} ${y1 - h} C${r} ${y1 + h * 0.3} ${l} ${y1 + h * 0.3} ${l} ${y1 - h} Z`;
};
const ledge = (c: string, d: string) => (
  <>
    <path d={d} stroke={shade(c, 0.55)} strokeWidth={0.7} fill="none" />
    <path d={d} transform="translate(0 -0.6)" stroke="#fff" strokeOpacity={0.28} strokeWidth={0.45} fill="none" />
  </>
);
const seams = (c: string, d: string) =>
  pair(d).map((x) => (
    <path key={x} d={x} stroke={shade(c, 0.28)} strokeOpacity={0.55} strokeWidth={0.45} fill="none" />
  ));
// the pod's dot vents: a small oval cluster low on each side
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

const MODERN_SHELL =
  'M50 6.4 C57.4 6.4 62.4 9.8 64.6 15.2 C66.2 19.2 67 24 67.1 29.4 C67.2 33.6 67 37.2 66.4 39.6 C64 40.8 58 41.2 50 41.2 C42 41.2 36 40.8 33.6 39.6 C33 37.2 32.8 33.6 32.9 29.4 C33 24 33.8 19.2 35.4 15.2 C37.6 9.8 42.6 6.4 50 6.4 Z';
const MODERN_BUMPER = 'M37.4 39.1 C43 40.3 57 40.3 62.6 39.1 L62.2 41.5 C56.6 43.1 43.4 43.1 37.8 41.5 Z';
const MODERN_LEDGE = 'M42.3 27.3 C46 28.1 54 28.1 57.7 27.3';
const MODERN_RECESS = 'M42.3 27.3 C46 28.1 54 28.1 57.7 27.3 L57.5 29.2 C54 30 46 30 42.5 29.2 Z';
const POCKET = 'M37.6 28.4 C39.2 27.9 41.4 27.9 42.8 28.3 L42.4 31.4 C40.8 31.9 38.9 31.6 38 31 Z';
// wide slots: the upper pair starts near the crown and runs out and down
const SLITS = ['M43.4 9.6 L44.6 10.8 L37.6 21.2 L35.6 20.2 Z', 'M44.2 19 L46.1 19.4 L44 27.7 L42.1 27.2 Z'];
const CLASSIC_SHELL =
  'M50 7 C59.6 7 66.4 13 66.8 22 C67 28.2 66.8 33.6 66 38 C65.8 39.6 65 40.8 63.6 41.2 C57 42.2 43 42.2 36.4 41.2 C35 40.8 34.2 39.6 34 38 C33.2 33.6 33 28.2 33.2 22 C33.6 13 40.4 7 50 7 Z';
const POD_SHELL =
  'M50 6.4 C58.8 6.4 64.8 11 66.4 17.6 C67.2 21.4 67.2 27 66.8 31.6 C66.4 35.6 65.4 38.6 63.8 40.6 C59 41.8 41 41.8 36.2 40.6 C34.6 38.6 33.6 35.6 33.2 31.6 C32.8 27 32.8 21.4 33.6 17.6 C35.2 11 41.2 6.4 50 6.4 Z';
const POD_PLATE = 'M41.8 34 L58.2 34 L59.4 35.2 L57.4 41.9 L42.6 41.9 L40.6 35.2 Z';
const CLIPS: Clip[] = [
  { x: 31.4, y: 21.4, w: 2.4, h: 3.6 },
  { x: 31.6, y: 33.6, w: 2.2, h: 3.2 },
];
const MODERN_DECALS = { fx: 38, fy: 32, dy: 29.5 };

export const SHELLS: Record<HelmetModel, Shell> = {
  modern: {
    shell: MODERN_SHELL,
    details: (c) => (
      <>
        <path d={MODERN_RECESS} fill="#000" fillOpacity={0.2} />
        {ledge(c, MODERN_LEDGE)}
        {vents([...SLITS, POCKET])}
        <circle cx="50" cy="7.9" r="0.55" fill={VENT} />
      </>
    ),
    plate: { d: MODERN_BUMPER, tone: 'bumper' },
    stripeEnd: 27.4,
    number: { y: 34.6, size: 6.6, on: 'shell' },
    clips: CLIPS,
    gloss: GLOSS,
    bottom: 42.8,
    decals: MODERN_DECALS,
  },
  modernSmooth: {
    shell: MODERN_SHELL,
    details: (c) => (
      <>
        <path d={MODERN_RECESS} fill="#000" fillOpacity={0.2} />
        {ledge(c, MODERN_LEDGE)}
        {vents([POCKET])}
      </>
    ),
    plate: { d: MODERN_BUMPER, tone: 'bumper' },
    stripeEnd: 27.4,
    number: { y: 34.6, size: 6.6, on: 'shell' },
    clips: CLIPS,
    gloss: GLOSS,
    bottom: 42.8,
    decals: MODERN_DECALS,
  },
  // a round dome, three pairs of vertical slots, and a dark plate across the lower back that carries the number
  plated: {
    shell:
      'M50 6.6 C59.4 6.6 66 12.4 67 20.8 C67.6 26 67.4 31.6 66.4 35.8 C65.6 38.8 63.6 40.8 60.6 41.4 C55 42 45 42 39.4 41.4 C36.4 40.8 34.4 38.8 33.6 35.8 C32.6 31.6 32.4 26 33 20.8 C34 12.4 40.6 6.6 50 6.6 Z',
    details: () => vents([slot(43, 9.2, 13.8), slot(42.2, 18.4, 24.8), slot(35.8, 20, 26.4, 1.05)]),
    plate: { d: 'M30 34 C40 33.3 60 33.3 70 34 L70 46 L30 46 Z', tone: 'dark', inside: true },
    stripeEnd: 33.6,
    number: { y: 37.8, size: 5.2, on: 'plate' },
    clips: [
      { x: 31.2, y: 21.2, w: 2.4, h: 3.6 },
      { x: 31.6, y: 33, w: 2.2, h: 3.2 },
    ],
    gloss: GLOSS,
    bottom: 42,
    decals: { fx: 38.2, fy: 28.4, dy: 31 },
  },
  // round, two holes on the centreline, a ledge across the back, a dark bumper with the number
  classic: {
    shell: CLASSIC_SHELL,
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
    plate: { d: 'M38.6 36.2 C44 35.4 56 35.4 61.4 36.2 L61 41.4 C55 42.6 45 42.6 39 41.4 Z', tone: 'dark' },
    stripeEnd: 28.4,
    number: { y: 38.9, size: 4.5, on: 'plate' },
    clips: CLIPS,
    gloss: GLOSS_ROUND,
    bottom: 42.6,
    decals: { fx: 38.6, fy: 29.7, dy: 33.5 },
  },
  // smooth and tall, soft seams, dot vents low on each side, a dark trapezoid plate
  pod: {
    shell: POD_SHELL,
    details: (c) => (
      <>
        {seams(c, 'M44.4 7.4 C43.4 14 43.2 24 44 33.4')}
        {dots()}
        {vents(['M34.6 13.6 L35.6 13.2 L35.4 17.4 L34.4 17.6 Z'])}
      </>
    ),
    plate: { d: POD_PLATE, tone: 'dark' },
    stripeEnd: 34,
    number: { y: 37.9, size: 4.8, on: 'plate' },
    clips: CLIPS,
    gloss: GLOSS,
    bottom: 41.9,
    decals: { fx: 38.6, fy: 29.2, dy: 31.5 },
  },
  // the lineman's version: wider and squarer
  podWide: {
    shell:
      'M50 6.6 C59.4 6.6 65.4 10.6 66.8 17.4 C67.6 21.4 67.6 27 67.2 31.8 C66.8 35.8 66 38.8 64.4 40.8 C59.4 42 40.6 42 35.6 40.8 C34 38.8 33.2 35.8 32.8 31.8 C32.4 27 32.4 21.4 33.2 17.4 C34.6 10.6 40.6 6.6 50 6.6 Z',
    details: (c) => (
      <>
        {seams(c, 'M44 7.6 C43 14 42.8 24 43.6 33.4')}
        {dots(-0.6)}
      </>
    ),
    plate: { d: 'M40.8 33.6 L59.2 33.6 L60.6 35 L58.4 42.1 L41.6 42.1 L39.4 35 Z', tone: 'dark' },
    stripeEnd: 33.6,
    number: { y: 37.8, size: 5, on: 'plate' },
    clips: CLIPS,
    gloss: GLOSS,
    bottom: 42.1,
    widen: 1.06,
    decals: { fx: 38.2, fy: 28.8, dy: 31.1 },
  },
  // ours: the modern shape with a raised spine down the middle instead of the slits
  ridgeback: {
    shell: MODERN_SHELL,
    details: (c) => (
      <>
        <path d={MODERN_RECESS} fill="#000" fillOpacity={0.2} />
        {ledge(c, MODERN_LEDGE)}
        <path d="M48.3 6 L51.7 6 L51.7 27.6 L48.3 27.6 Z" fill="#fff" fillOpacity={0.14} />
        <path d="M48.3 6 L48.3 27.6" stroke="#fff" strokeOpacity={0.45} strokeWidth={0.4} />
        <path d="M51.7 6 L51.7 27.6" stroke={shade(c, 0.5)} strokeWidth={0.5} />
        {vents([POCKET, 'M40.8 12.4 L42 12.8 L39.4 19.6 L38.2 19.2 Z'])}
      </>
    ),
    plate: { d: MODERN_BUMPER, tone: 'bumper' },
    stripeEnd: 27.4,
    number: { y: 34.6, size: 6.6, on: 'shell' },
    clips: CLIPS,
    gloss: GLOSS,
    bottom: 42.8,
    decals: MODERN_DECALS,
  },
  // ours: the classic round shape with the modern upper slits and a bumper in the design's colour
  retro: {
    shell: CLASSIC_SHELL,
    details: () => vents([SLITS[0]]),
    plate: { d: 'M37.6 39 C43 40.2 57 40.2 62.4 39 L62 41.6 C56.6 43 43.4 43 38 41.6 Z', tone: 'bumper' },
    stripeEnd: 30.4,
    number: { y: 34.6, size: 6.4, on: 'shell' },
    clips: CLIPS,
    gloss: GLOSS_ROUND,
    bottom: 42.8,
    decals: { fx: 38.2, fy: 32, dy: 30 },
  },
};

/** How far the helmet moves so its lowest point sits at the neck rule's height for his build (null: the plain figure). */
export function helmetLift(model: HelmetModel, traps: number | null): number {
  const target = HELMET_NECK_Y - HELMET_NECK_PER_TRAP * Math.max(0, traps ?? 0);
  return +(target - (26 + (SHELLS[model].bottom - 26) * HELMET_SCALE)).toFixed(3);
}
/** The helmet's place on the figure: scaled about the middle of the head, then set on the neck. */
export const helmetTransform = (model: HelmetModel, traps: number | null) =>
  `translate(0 ${helmetLift(model, traps)}) translate(50 26) scale(${HELMET_SCALE}) translate(-50 -26)`;
const widenOf = (model: HelmetModel) => {
  const w = SHELLS[model].widen;
  return w ? `translate(50 0) scale(${w} 1) translate(-50 0)` : undefined;
};

// From behind, the facemask shows only at its lower corners: a bar drops out from under the shell's bottom corner and
// turns forward to the chin, out of sight behind the neck (left side; mirrored).
const MASK: Record<MaskKind, { d: string; w: number }[]> = {
  qb: [{ d: 'M34.8 37.4 C34.5 40.4 35.1 42.5 37 43.7 C38.6 44.7 40.8 44.9 43.2 44.9', w: 1.15 }],
  skill: [{ d: 'M35 38 C34.8 40.6 35.4 42.4 37.2 43.5 C38.8 44.4 40.8 44.6 43.2 44.6', w: 1.1 }],
  hybrid: [
    { d: 'M34.5 36.4 C34 39.6 34.6 42.2 36.6 43.8 C38.4 45 40.8 45.3 43.4 45.3', w: 1.2 },
    { d: 'M36.8 39 C36.8 40.6 37.3 41.7 38.6 42.3 C39.8 42.8 41.4 42.9 43.2 42.9', w: 0.95 },
  ],
  line: [
    { d: 'M34.2 35.6 C33.6 39 34.2 42.2 36.4 44 C38.4 45.4 41 45.8 43.6 45.8', w: 1.25 },
    { d: 'M36.4 37.6 C36.2 40 36.8 41.6 38.2 42.4 C39.6 43.1 41.4 43.2 43.4 43.2', w: 1.05 },
    { d: 'M34.9 41.6 L37.3 40.8', w: 0.9 },
  ],
  kicker: [{ d: 'M35.2 38.6 C35.2 40.6 35.8 41.8 37.4 42.6 C38.8 43.2 40.6 43.3 42.6 43.3', w: 0.8 }],
};

/** The facemask's lower corners, drawn before the neck so the neck hides the rest of the cage. */
export function MaskLayer({ model, mask, color }: { model: HelmetModel; mask: MaskKind; color: string }) {
  const bars = MASK[mask].flatMap((b) => [b, { ...b, d: mirror(b.d) }]);
  return (
    <g transform={widenOf(model)}>
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
        <path key={`b${i}`} d={b.d} stroke={color} strokeWidth={b.w} fill="none" strokeLinecap="round" />
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

/**
 * The helmet from behind in the club's design. `detail` (from 32px) adds the vents, clips and number; `decals` (from
 * 56px) the stacked flags and the green dot.
 */
export function HelmetLayer({
  id,
  model,
  design: h,
  number,
  detail,
  decals,
}: {
  /** A unique prefix for this avatar's clip paths and gradients. */
  id: string;
  model: HelmetModel;
  design: HelmetDesign;
  number: number;
  detail: boolean;
  decals: { flags: FlagCode[]; dot: boolean } | null;
}) {
  const m = SHELLS[model];
  const c = h.shell;
  const dark = isDarkShell(c);
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
  // the stripe stops where a number on the shell (or a plate inside it) begins; otherwise it runs under the bumper
  const numberOnShell = detail && h.number && m.number.on === 'shell';
  const end = numberOnShell || m.plate.inside ? m.stripeEnd : 45;
  const stripes: ReactElement[] = [];
  const bar = (x0: number, x1: number, fill: string | undefined, k: string) =>
    fill && stripes.push(<rect key={k} x={x0} y={0} width={x1 - x0} height={end} fill={fill} />);
  if (h.stripe === 'single') bar(47.2, 52.8, h.stripeA, 's');
  if (h.stripe === 'double') {
    bar(45.6, 48.2, h.stripeA, 'l');
    bar(51.8, 54.4, h.stripeA, 'r');
  }
  if (h.stripe === 'triple') {
    bar(44.6, 45.9, h.stripeB, 'l');
    bar(47, 53, h.stripeA, 'm');
    bar(54.1, 55.4, h.stripeB, 'r');
  }
  const numberText = (fill: string, stroke: string, strokeWidth: number) => (
    <text
      x="50"
      y={m.number.y}
      textAnchor="middle"
      dominantBaseline="central"
      fontSize={m.number.size}
      fontWeight={900}
      fill={fill}
      stroke={stroke}
      strokeWidth={strokeWidth}
      paintOrder="stroke"
      transform="translate(-7.5 0) scale(1.15 1)"
    >
      {number}
    </text>
  );
  const plateFill = m.plate.tone === 'dark' ? DARK_PLATE : h.bumper;
  const plate = (
    <g>
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
      {/* a number on dark rubber is white, outlined in the stripe's colour */}
      {detail && h.number && m.number.on === 'plate' && numberText('#ffffff', h.stripeA ?? DARK_PLATE, 0.45)}
    </g>
  );
  const flags = decals?.flags ?? [];
  return (
    <g className="helmet" transform={widenOf(model)}>
      <defs>
        {grad}
        <linearGradient id={`${id}hu`} x1="0" x2="0" y1="22" y2="42" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#000" stopOpacity={0} />
          <stop offset="1" stopColor="#000" stopOpacity={0.3} />
        </linearGradient>
        <linearGradient id={`${id}bp`} x1="0" x2="0" y1="32" y2="43" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={tint(plateFill, 0.15)} />
          <stop offset="1" stopColor={shade(plateFill, 0.3)} />
        </linearGradient>
        <clipPath id={`${id}hc`}>
          <path d={m.shell} />
        </clipPath>
      </defs>
      {/* the helmet's shadow on the neck */}
      <ellipse cx="50" cy={m.bottom - 0.2} rx="9.6" ry="2" fill="#000" fillOpacity={0.3} />
      {/* the chin strap's clips stick out past the shell at two heights: a black clip, a white tip */}
      {detail &&
        m.clips.flatMap((k, i) =>
          [k.x, 100 - k.x - k.w].map((x, s) => (
            <g key={`clip${i}${s}`}>
              <rect x={x} y={k.y} width={k.w} height={k.h} rx={0.7} fill={CLIP} />
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
              strokeOpacity={h.finish === 'metal' || dark ? 0.72 : 0.6}
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
        {detail && m.details(c)}
        {/* a dark shell gets a rim of light around its edge, or it melts into a dark jersey */}
        {dark && <path d={m.shell} fill="none" stroke={tint(c, 0.6)} strokeOpacity={0.55} strokeWidth={1.3} />}
        {numberOnShell && numberText(h.number!.ink, h.number!.trim, 0.6)}
        <rect x="30" y="0" width="40" height="46" fill={`url(#${id}hu)`} />
        {m.plate.inside && plate}
      </g>
      {!m.plate.inside && plate}
      {/* the soft outline every avatar part gets, so a white shell stays off a pale backdrop */}
      <path
        d={m.shell}
        fill="none"
        stroke="#0F172A"
        strokeOpacity={0.35}
        strokeWidth={1}
        vectorEffect="non-scaling-stroke"
      />
      {decals && (
        <g>
          {flags.map((code, i) => (
            <Flag
              key={code}
              code={code}
              x={m.decals.fx}
              y={m.decals.fy + (flags.length === 1 ? (FLAG_H + FLAG_GAP) / 2 : 0) + i * (FLAG_H + FLAG_GAP)}
            />
          ))}
          {decals.dot && (
            <g>
              <circle
                cx={50}
                cy={m.decals.dy}
                r={1.05}
                fill="#22B14C"
                stroke="#0F172A"
                strokeOpacity={0.5}
                strokeWidth={0.3}
              />
              <circle cx={49.65} cy={m.decals.dy - 0.35} r={0.35} fill="#fff" fillOpacity={0.45} />
            </g>
          )}
        </g>
      )}
    </g>
  );
}
