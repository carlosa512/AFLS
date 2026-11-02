import type { ReactElement } from 'react';
import type { FlagCode } from './helmet';

// The flag decals on the back of the helmet: the US flag and the International Pathway's 15 countries, drawn simply
// enough to read at a few pixels (stripes and blocks, a disc for an emblem). Sizes are in the figure's units.

export const FLAG_W = 3.4;
export const FLAG_H = 2.25;
/** The gap between two stacked flags. */
export const FLAG_GAP = 0.35;

export function Flag({ code, x, y }: { code: FlagCode; x: number; y: number }) {
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
  const dot = (cx: number, cy: number, r: number, fill: string, k = 'dot') => (
    <circle key={k} cx={x + cx * w} cy={y + cy * h} r={r} fill={fill} />
  );
  /** The Union flag, in a canton or whole: blue, a white cross and a red one. */
  const union = (fw: number, fh: number) => [
    R(0, 0, fw, fh, '#012169', 'ub'),
    R(fw * 0.42, 0, fw * 0.16, fh, '#fff', 'uw1'),
    R(0, fh * 0.4, fw, fh * 0.2, '#fff', 'uw2'),
    R(fw * 0.46, 0, fw * 0.08, fh, '#C8102E', 'ur1'),
    R(0, fh * 0.45, fw, fh * 0.1, '#C8102E', 'ur2'),
  ];
  const parts: Record<FlagCode, ReactElement[]> = {
    US: [
      ...[0, 1, 2, 3, 4].map((i) => R(0, i / 5, 1, 1 / 5, i % 2 ? '#fff' : '#B22234', `s${i}`)),
      R(0, 0, 0.42, 0.6, '#3C3B6E', 'canton'),
    ],
    JP: [R(0, 0, 1, 1, '#fff', 'bg'), dot(0.5, 0.5, 0.5, '#BC002D')],
    DE: horiz('#000', '#DD0000', '#FFCE00'),
    GB: union(1, 1),
    AU: [
      R(0, 0, 1, 1, '#012169', 'bg'),
      ...union(0.5, 0.5),
      dot(0.25, 0.78, 0.18, '#fff', 'st'),
      dot(0.75, 0.5, 0.14, '#fff', 'st2'),
    ],
    NZ: [
      R(0, 0, 1, 1, '#012169', 'bg'),
      ...union(0.5, 0.5),
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
    SE: [R(0, 0, 1, 1, '#006AA7', 'bg'), R(0.3, 0, 0.14, 1, '#FECC00', 'v'), R(0, 0.42, 1, 0.16, '#FECC00', 'h')],
  };
  return (
    <g>
      {parts[code]}
      <rect x={x} y={y} width={w} height={h} fill="none" stroke="#000" strokeOpacity={0.35} strokeWidth={0.18} />
      {/* a decal's sheen */}
      <rect x={x} y={y} width={w} height={h * 0.35} fill="#fff" fillOpacity={0.18} />
    </g>
  );
}
