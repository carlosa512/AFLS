/** Colour sums for the painter: all on `#rrggbb`. */
const parts = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const two = (n: number) =>
  Math.round(Math.max(0, Math.min(255, n)))
    .toString(16)
    .padStart(2, '0');

/** How light a colour is, 0 to 1. */
export const lum = (hex: string): number => {
  const [r, g, b] = parts(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
/** `a` moved `t` of the way to `b`. */
export const mix = (a: string, b: string, t: number): string => {
  const A = parts(a);
  const B = parts(b);
  return '#' + A.map((v, i) => two(v + (B[i] - v) * t)).join('');
};
/** A colour in more or less light: `k` under 1 darkens it. */
export const shade = (hex: string, k: number): string =>
  '#' +
  parts(hex)
    .map((v) => two(v * k))
    .join('');
/** A colour too dark to see against a stand, moved toward grey. */
export const lift = (hex: string): string => (lum(hex) < 0.16 ? mix(hex, '#9aa3a8', 0.55) : hex);
