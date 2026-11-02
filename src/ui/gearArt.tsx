import type { ReactElement } from 'react';
import { shade, tint, type TeamColors } from './color';
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
  shooter: [71, 140],
  // the quarterback's padded sleeves: a full one, and a short one around the elbow (the pad is drawn over either)
  padded: [55, 140],
  paddedElbow: [71.5, 97],
};
const UNDERSHIRT: [number, number] = [55, 73.6];
const BICEPS: [number, number] = [74.6, 77.4];
const FOREARM: [number, number] = [90.4, 93.8];
const PADS: [number, number] = [77, 88.6];
const BRACE: [number, number] = [55, 74.4];
const STRAP_Y = 66.2;

type Arm = 'L' | 'R';

const rad = (deg: number) => (deg * Math.PI) / 180;
/** A band around the arm seen from a little above: its top and bottom edges sag in the middle. */
const bandPath = (x0: number, x1: number, y0: number, y1: number, sag: number) =>
  `M${x0} ${y0} Q${(x0 + x1) / 2} ${y0 + sag * 2} ${x1} ${y0} L${x1} ${y1} Q${(x0 + x1) / 2} ${y1 + sag * 2} ${x0} ${y1} Z`;

/**
 * The padded sleeve's pad: over the point of the elbow, which hangs a little toward the outside of the arm. The arm is
 * read as a cylinder (its width at the elbow), the pad centred `PAD_TURN` degrees round toward the outside, so it
 * squeezes and wraps the edge as it turns away from us; mirrored on the left arm.
 */
const PAD: [number, number] = [76.6, 91.4];
const PAD_TURN = 62;
const PAD_HALF = 38;
/** The play-call wristband, a little above the wrist so more of it stays inside the ring, its card turned out. */
const WRISTBAND: [number, number] = [92, 104.6];
const CARD_TURN = 75;
const CARD_HALF = 44;
const CARD = '#EEF2F5';
const CARD_CELLS = ['#ffcf1f', '#e05a4f', '#4f9be0', '#5fbf7a'];

/** A honeycomb pattern, squeezed across the arm where the pad turns away. */
function hexPattern(id: string, cell: string, squeeze: number) {
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
  const centres = [
    [1.3, 1.1],
    [0, 3.35],
    [2.6, 3.35],
    [1.3, 5.6],
    [0, -1.15],
    [2.6, -1.15],
  ];
  return (
    <pattern id={id} width="2.6" height="4.5" patternUnits="userSpaceOnUse" patternTransform={`scale(${squeeze} 1)`}>
      <rect width="2.6" height="4.5" fill={shade(cell, 0.5)} />
      {centres.map(([x, y]) => (
        <polygon key={`${x},${y}`} points={hex(x, y)} fill={cell} />
      ))}
    </pattern>
  );
}
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
  /** The arm as a cylinder at some height: its middle, radius, and which way is outside (+1 right arm, −1 left). */
  const cylinder = (arm: Arm, y0: number, y1: number, inset: number) => {
    const [x0, x1] = spanOf(path(arm), y0, y1);
    return { x0, x1, cx: (x0 + x1) / 2, r: (x1 - x0) / 2 - inset, out: arm === 'R' ? 1 : -1 };
  };
  /** The honeycomb pad over the elbow, a shade of the sleeve, turned toward the outside of the arm. */
  const pad = (arm: Arm, color: GearColor) => {
    const c = cylinder(arm, 80, 88, 0.3);
    const at = (deg: number) =>
      deg >= 90 ? (c.out > 0 ? c.x1 : c.x0) + 2 * c.out : c.cx + c.out * c.r * Math.sin(rad(deg));
    const [a, b] = [at(Math.max(-89, PAD_TURN - PAD_HALF)), at(PAD_TURN + PAD_HALF)];
    const base = color === 'black' ? '#3a4048' : color === 'white' ? '#c9d0d7' : shade(paint(color), 0.3);
    const box = { x: Math.min(a, b), y: PAD[0], width: Math.abs(b - a), height: PAD[1] - PAD[0], rx: 3 };
    const inner = c.out > 0 ? box.x + 0.5 : box.x + box.width - 0.5;
    return (
      <>
        <defs>
          {hexPattern(`${id}hx${arm}`, tint(base, 0.12), Math.max(0.45, Math.cos(rad(PAD_TURN))))}
          <linearGradient id={`${id}pe${arm}`} x1={c.out > 0 ? 0 : 1} x2={c.out > 0 ? 1 : 0} y1="0" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity={0.14} />
            <stop offset="0.6" stopColor="#000" stopOpacity={0} />
            <stop offset="1" stopColor="#000" stopOpacity={0.3} />
          </linearGradient>
        </defs>
        <rect {...box} fill={`url(#${id}hx${arm})`} />
        <rect {...box} fill={`url(#${id}pe${arm})`} />
        <rect {...box} fill="none" stroke="#000" strokeOpacity={0.4} strokeWidth={0.45} />
        {/* the pad is thick: its edge toward us catches the light */}
        <path
          d={`M${inner} 79 L${inner} 89`}
          stroke="#fff"
          strokeOpacity={0.22}
          strokeWidth={0.5}
          strokeLinecap="round"
        />
      </>
    );
  };
  /** The play card behind the band's clear window, turned toward the outside of the wrist, where he flips it up. */
  const card = (arm: Arm) => {
    const [y0, y1] = WRISTBAND;
    const c = cylinder(arm, y0 - 2, y1 + 2, 0.4);
    const sag = 0.35;
    const centre = c.out * CARD_TURN;
    const at = (deg: number) => (deg <= -90 ? c.x0 - 2 : deg >= 90 ? c.x1 + 2 : c.cx + c.r * Math.sin(rad(deg)));
    const [l, r] = [at(centre - CARD_HALF), at(centre + CARD_HALF)];
    const win = { x0: Math.min(l, r), x1: Math.max(l, r), y0: y0 + 1.5, y1: y1 - 1.5 };
    const rows = Math.floor((win.y1 - win.y0 - 1) / 1.35);
    const cols = [1 / 3, 2 / 3].map((t) => at(centre - CARD_HALF + 2 * CARD_HALF * t));
    // the colour cells sit at the card's readable edge, the one toward us
    const cellA = at(centre - c.out * CARD_HALF * 0.92);
    const cellB = at(centre - c.out * CARD_HALF * 0.6);
    const window = bandPath(win.x0, win.x1, win.y0, win.y1, sag);
    return (
      <>
        <defs>
          <clipPath id={`${id}wc`}>
            <path d={window} />
          </clipPath>
        </defs>
        <path d={window} fill={CARD} />
        <g clipPath={`url(#${id}wc)`}>
          <rect x={win.x0 - 2} y={win.y0 - 1} width={win.x1 - win.x0 + 4} height={1.9} fill={colors.primary} />
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
                    x={Math.min(cellA, cellB)}
                    y={y + 0.2}
                    width={Math.abs(cellB - cellA)}
                    height={1}
                    fill={CARD_CELLS[(i / 2) % CARD_CELLS.length]}
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
        <path d={window} fill="none" stroke="#000" strokeOpacity={0.45} strokeWidth={0.35} />
      </>
    );
  };

  if (gear.sleeve) {
    const [y0, y1] = SLEEVE[gear.sleeve.length];
    const padded = gear.sleeve.length === 'padded' || gear.sleeve.length === 'paddedElbow';
    for (const arm of armsOf(gear.sleeve.side))
      piece(
        `sleeve${arm}`,
        arm,
        [y0, y1],
        paint(gear.sleeve.color),
        padded ? (
          <>
            {y1 < 140 && hem(y1)}
            {y0 > 60 && hem(y0 + 1)}
            {pad(arm, gear.sleeve.color)}
          </>
        ) : // a cuff where a sleeve ends on the arm: below a short one, above one that starts partway down
        y1 < 140 ? (
          hem(y1)
        ) : y0 > 60 ? (
          hem(y0 + 1)
        ) : undefined,
      );
  }
  if (gear.wristband) {
    const arm: Arm = gear.wristband.side === 'left' ? 'L' : 'R';
    piece('wristband', arm, WRISTBAND, paint(gear.wristband.color), card(arm));
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
