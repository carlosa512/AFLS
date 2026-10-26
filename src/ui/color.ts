/** Colour helpers for "#RRGGBB" strings: WCAG 2.x contrast, blends, and the jersey kits avatars draw. */
const LIGHT = '#F8FAFC';
const DARK = '#0F172A';
/** WCAG's bar for text under 24px: the avatar's number is that small in every list it appears in. */
const MIN_CONTRAST = 4.5;

const channels = (hex: string) => {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
};

const linear = (hex: string) =>
  channels(hex).map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });

function luminance(hex: string): number {
  const [r, g, b] = linear(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** `preferred` if it reads on `bg`, otherwise light or dark, whichever reads better. */
export function readableOn(bg: string, preferred: string): string {
  if (contrast(bg, preferred) >= MIN_CONTRAST) return preferred;
  return contrast(bg, LIGHT) >= contrast(bg, DARK) ? LIGHT : DARK;
}

/** Black or white text on a team colour (chips and banners). */
export const inkOn = (hex: string) => (luminance(hex) > 0.4 ? '#121915' : '#ffffff');

/** Blend a toward b; t = 0 gives a, t = 1 gives b. */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [channels(a), channels(b)];
  return (
    '#' +
    x
      .map((v, i) =>
        Math.round(v + (y[i] - v) * t)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

export const tint = (hex: string, t: number) => mix(hex, '#FFFFFF', t);
export const shade = (hex: string, t: number) => mix(hex, DARK, t);

/** A team-coloured badge with readable initials: the colour itself, or a shade darker when neither ink reads on it. */
export function badgeOn(hex: string): { bg: string; ink: string } {
  for (let t = 0; t < 1; t += 0.1) {
    const bg = t ? shade(hex, t) : hex;
    const ink = readableOn(bg, '#ffffff');
    if (contrast(bg, ink) >= MIN_CONTRAST) return { bg, ink };
  }
  return { bg: DARK, ink: LIGHT };
}

export interface TeamColors {
  primary: string;
  secondary: string;
}

export interface Kit {
  jersey: string;
  /** Number, nameplate, collar and the upper sleeve band. */
  ink: string;
  /** The number's outline, like tackle twill. */
  trim: string;
  /** The lower sleeve band: the team's other colour, even when it can't carry the number. */
  accent: string;
}

/**
 * Home is the primary jersey lettered in the secondary; away is white lettered in the primary. Lettering
 * that doesn't read swaps to light or dark, and the colour it replaced stays on as the twill and a stripe.
 */
export function kitFor({ primary, secondary }: TeamColors, away = false): Kit {
  const jersey = away ? '#FFFFFF' : primary;
  const ink = readableOn(jersey, away ? primary : secondary);
  const trim = secondary !== ink && contrast(ink, secondary) >= 3 ? secondary : shade(jersey, 0.45);
  return { jersey, ink, trim, accent: secondary };
}
