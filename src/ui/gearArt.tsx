import type { ReactElement } from 'react';
import type { TeamColors } from './color';
import type { Gear, GearColor, Side, SleeveLength } from './playerGear';
import type { Figure } from './playerLook';

// The avatar's gear, drawn over his arms (`playerGear.ts` decides what he wears). Every sleeve, band and pad is the
// arm itself clipped to a band of heights, coloured, then shaded like a cylinder; the shoulder brace adds its own
// bulk, a diagonal strap and a D-ring. Heights are in the figure's box (the arm paths keep their y through every
// build), so one table fits every body.

const BLACK = '#1A1D22';
const WHITE = '#EEF1F4';
const RING = '#C9D0D8';
/** The brace's edge, a shade off its black so its bulk shows against the arm. */
const BRACE_EDGE = '#0B0D10';

/** Each piece's top and bottom on the arm. The ring crops the arm just below the three-quarter sleeve's end. */
const SLEEVE: Record<SleeveLength, [number, number]> = {
  half: [55, 79],
  threeQuarter: [55, 93],
  full: [55, 140],
  forearm: [80, 140],
};
const UNDERSHIRT: [number, number] = [55, 73.6];
const BICEPS: [number, number] = [74.6, 77.4];
const FOREARM: [number, number] = [90.4, 93.8];
const PADS: [number, number] = [77, 88.6];
const BRACE: [number, number] = [55, 74.4];
const STRAP_Y = 66.2;

type Arm = 'L' | 'R';
const armsOf = (side: Side): Arm[] => (side === 'both' ? ['L', 'R'] : side === 'left' ? ['L'] : ['R']);

/** The leftmost and rightmost x of a path's points between two heights. */
function spanOf(d: string, y0 = -Infinity, y1 = Infinity): [number, number] {
  const xs = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)]
    .map((m) => [Number(m[1]), Number(m[2])])
    .filter(([, y]) => y >= y0 && y <= y1)
    .map(([x]) => x);
  return [Math.min(...xs), Math.max(...xs)];
}

export function GearLayer({
  id,
  figure,
  gear,
  colors,
}: {
  /** A unique prefix for this avatar's clip paths and gradients. */
  id: string;
  figure: Figure;
  gear: Gear;
  colors: TeamColors;
}) {
  const paint = (c: GearColor) =>
    c === 'black' ? BLACK : c === 'white' ? WHITE : c === 'primary' ? colors.primary : colors.secondary;
  const path = (arm: Arm) => (arm === 'L' ? figure.armL : figure.armR);
  const box = { L: spanOf(figure.armL), R: spanOf(figure.armR) };
  const pieces: ReactElement[] = [];
  /** The arm between two heights in one colour, shaded across the arm; `extra` draws over it, inside the arm. */
  const piece = (key: string, arm: Arm, [y0, y1]: [number, number], fill: string, extra?: ReactElement) => {
    const [x0, x1] = box[arm];
    pieces.push(
      <g key={key} clipPath={`url(#${id}g${arm})`}>
        <rect x={x0 - 1} y={y0} width={x1 - x0 + 2} height={y1 - y0} fill={fill} />
        {extra}
        <rect x={x0 - 1} y={y0} width={x1 - x0 + 2} height={y1 - y0} fill={`url(#${id}gs${arm})`} />
      </g>,
    );
  };
  const hem = (y: number) => <rect x="-20" y={y - 1} width="140" height="1" fill="#000" fillOpacity={0.22} />;

  if (gear.sleeve) {
    const [y0, y1] = SLEEVE[gear.sleeve.length];
    for (const arm of armsOf(gear.sleeve.side))
      piece(`sleeve${arm}`, arm, [y0, y1], paint(gear.sleeve.color), y1 < 140 ? hem(y1) : undefined);
  }
  if (gear.undershirt)
    for (const arm of armsOf('both')) piece(`under${arm}`, arm, UNDERSHIRT, paint(gear.undershirt), hem(UNDERSHIRT[1]));
  if (gear.elbowPads)
    for (const arm of armsOf(gear.elbowPads.side))
      piece(
        `pads${arm}`,
        arm,
        PADS,
        paint(gear.elbowPads.color),
        <>
          <rect x="-20" y={79.6} width="140" height="1.4" fill="#FFF" fillOpacity={0.18} />
          <rect x="-20" y={85.4} width="140" height="0.9" fill="#000" fillOpacity={0.25} />
        </>,
      );
  if (gear.band)
    for (const arm of armsOf(gear.band.side))
      piece(`band${arm}`, arm, gear.band.at === 'biceps' ? BICEPS : FOREARM, paint(gear.band.color));
  if (gear.shoulderBrace) {
    const arm: Arm = gear.shoulderBrace.side === 'left' ? 'L' : 'R';
    const [x0, x1] = spanOf(path(arm), 60, 74);
    const mid = (x0 + x1) / 2;
    const out = arm === 'L' ? 1 : -1;
    const outer = arm === 'L' ? x0 : x1;
    // thicker than the arm: the arm's own outline, stroked wide in the brace's colour, cut to the brace's height
    pieces.push(
      <g key="brace" clipPath={`url(#${id}gb)`}>
        <path d={path(arm)} fill={BLACK} stroke={BRACE_EDGE} strokeWidth={2.6} strokeLinejoin="round" />
        <path d={path(arm)} fill="none" stroke={BLACK} strokeWidth={1.2} />
      </g>,
    );
    piece(
      'braceStrap',
      arm,
      BRACE,
      'transparent',
      <>
        <rect
          x="-20"
          y={STRAP_Y - 1.6}
          width="140"
          height="3.2"
          fill={paint(gear.shoulderBrace.strap)}
          transform={`rotate(${out * 14} ${mid} ${STRAP_Y})`}
        />
        <rect
          x="-20"
          y={STRAP_Y - 1.6}
          width="140"
          height="0.5"
          fill="#FFF"
          fillOpacity={0.3}
          transform={`rotate(${out * 14} ${mid} ${STRAP_Y})`}
        />
        <path
          d={`M-20 73.2 L120 73.2`}
          stroke="#FFF"
          strokeOpacity={0.45}
          strokeWidth={0.35}
          strokeDasharray="0.9 0.7"
        />
      </>,
    );
    pieces.push(
      <rect
        key="braceRing"
        x={outer + out * 1.2 - 1.3}
        y={STRAP_Y - 3.6}
        width="2.6"
        height="2.6"
        rx="0.5"
        fill="none"
        stroke={RING}
        strokeWidth={0.7}
      />,
    );
  }
  if (!pieces.length) return null;
  const shading = (arm: Arm) => (
    // light on the outside of the arm, dark where it turns in toward the body
    <linearGradient id={`${id}gs${arm}`} x1={arm === 'L' ? 0 : 1} x2={arm === 'L' ? 1 : 0} y1="0" y2="0">
      <stop offset="0" stopColor="#FFF" stopOpacity={0.12} />
      <stop offset="0.45" stopColor="#000" stopOpacity={0.05} />
      <stop offset="1" stopColor="#000" stopOpacity={0.4} />
    </linearGradient>
  );
  return (
    <g>
      <defs>
        <clipPath id={`${id}gL`}>
          <path d={figure.armL} />
        </clipPath>
        <clipPath id={`${id}gR`}>
          <path d={figure.armR} />
        </clipPath>
        <clipPath id={`${id}gb`}>
          <rect x="-20" y={BRACE[0]} width="140" height={BRACE[1] - BRACE[0]} />
        </clipPath>
        {shading('L')}
        {shading('R')}
      </defs>
      {pieces}
    </g>
  );
}
