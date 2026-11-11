/**
 * Who turns up: a ground fills by how its club is doing (the standings anyone can see), emptier high up, at the ends
 * and by section. Flavour only: nothing in the sim reads it.
 */
import type { Post } from './bowl';
import { lift } from './colour';

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

/** What people wear: the club's two colours (one too dark to see is lifted), white, grey and a skin tone. */
export const crowdPalette = (colors: [string, string]): string[] => [
  lift(colors[0]),
  lift(colors[1]),
  '#f1f1ee',
  '#8b9399',
  '#d6b28a',
];
