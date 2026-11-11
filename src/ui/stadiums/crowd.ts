/**
 * Who turns up: a ground fills by how its club is doing (the standings anyone can see), emptier high up, at the ends
 * and by section. Flavour only: nothing in the sim reads it.
 */
import type { Post } from './bowl';
import { lift, lum, mix } from './colour';

export type Turnout = 'winning' | 'even' | 'losing';
/** The share of seats taken at each level. */
export const FILL: Record<Turnout, number> = { winning: 0.97, even: 0.8, losing: 0.52 };
/** A club's first home games of a season are never drawn below Even: hope sells tickets. */
const EARLY_HOME_GAMES = 3;

/** The level for a home game, from the club's record coming in. A playoff game is full; no record yet is Even. */
export function turnoutOf(
  record: { w: number; l: number; t: number },
  homeGamesBefore: number,
  playoff: boolean,
): Turnout {
  if (playoff) return 'winning';
  const games = record.w + record.l + record.t;
  if (!games) return 'even';
  const pct = (record.w + record.t / 2) / games;
  if (pct >= 0.6) return 'winning';
  if (pct >= 0.4 || homeGamesBefore < EARLY_HOME_GAMES) return 'even';
  return 'losing';
}

/** How each deck leans against the ground's turnout: the lower deck fills first, the upper last. */
const DECK_LEAN = [0.16, 0.08, -0.12];
/**
 * A section's own turnout: the ground's, leaned by its deck, by whether it is along the far side or at an end, and by
 * the section's own luck (`lean`, −0.5 to 0.5). The emptier the ground, the further sections spread.
 */
export function sectionFill(fill: number, deck: number, part: Post['part'], lean: number): number {
  const place = (DECK_LEAN[deck] ?? -0.12) + (part === 'F' ? 0.03 : -0.05);
  return Math.max(0.03, Math.min(0.985, fill + (place + lean * 0.3) * (1 - fill) * 1.7));
}

/**
 * What people wear: the club's two colours (one too dark to see is lifted), white, grey and a skin tone. On a themed
 * night (`theme`: the jersey the club wears that game, its colour rush or blackout) four in five wear that one colour.
 * Always five places, in the order a seat's draw picks from.
 */
/** A colour with no hue to speak of: black, grey, white. */
const vividless = (hex: string): boolean => {
  const n = parseInt(hex.slice(1), 16);
  const c = [n >> 16, (n >> 8) & 255, n & 255];
  return Math.max(...c) - Math.min(...c) < 24;
};

export function crowdPalette(colors: [string, string], theme?: string): string[] {
  const own = lift(colors[0]);
  if (!theme) return [own, lift(colors[1]), '#f1f1ee', '#8b9399', '#d6b28a'];
  const pale = lum(theme) > 0.7;
  // a dark jersey is lifted until a stand full of it reads as a crowd; a blackout to charcoal, which is as dark as that gets
  const one =
    lum(theme) < 0.14 && vividless(theme) ? '#3d424b' : lum(theme) < 0.25 ? mix(theme, '#ffffff', 0.4) : theme;
  return [one, one, mix(one, pale ? '#c9ccd0' : '#ffffff', 0.25), pale ? own : '#f1f1ee', '#d6b28a'];
}
