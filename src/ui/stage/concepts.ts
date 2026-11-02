/**
 * Passing concepts: the pattern a pass play runs, every receiver's route fitting around the target's. A concept is a
 * route for each spot on the play side (the target's) and on the backside, leaned on by the offenses built on it.
 * The target's route comes first (it fits his catch, `routeFor`); the pick favours concepts that have it at his spot,
 * and he runs it whatever the pick. Spec: docs/superpowers/specs/2026-11-02-all-22-passing-game-design.md §3.
 */
import type { Rng } from '../../engine/rng';
import type { OffSchemeId } from '../../engine/schemes';
import { FIELD_W } from './ballPath';
import type { Pt } from './formations';
import { ROUTES, type RouteId, type Spot } from './routes';

export type ConceptId =
  | 'smash'
  | 'flood'
  | 'mesh'
  | 'fourVerts'
  | 'curlFlat'
  | 'slantFlat'
  | 'stick'
  | 'dagger'
  | 'quick'
  | 'outs'
  | 'wheel'
  | 'screen'
  | 'shot';

/** A route, or a receiver who blocks (a screen's other men; the line's help on a shot). */
export type Assignment = RouteId | 'block';

export interface Concept {
  id: ConceptId;
  /** The target's side, by spot. */
  play: Partial<Record<Spot, Assignment>>;
  /** The other side. */
  back: Partial<Record<Spot, Assignment>>;
}

interface Entry extends Concept {
  lean: readonly OffSchemeId[];
}

const BOOK: readonly Entry[] = [
  {
    id: 'smash',
    play: { WIDE: 'hitch', SLOT: 'corner', TE: 'corner', RB: 'flat' },
    back: { WIDE: 'dig', SLOT: 'seam', TE: 'seam' },
    lean: ['proStyle', 'westCoast'],
  },
  {
    id: 'flood',
    play: { WIDE: 'go', SLOT: 'out', TE: 'out', RB: 'flat' },
    back: { WIDE: 'post', SLOT: 'dig', TE: 'dig' },
    lean: ['proStyle', 'vertical'],
  },
  {
    id: 'mesh',
    play: { WIDE: 'go', SLOT: 'drag', TE: 'stick', RB: 'flat' },
    back: { WIDE: 'corner', SLOT: 'drag', TE: 'drag' },
    lean: ['airRaid'],
  },
  {
    id: 'fourVerts',
    play: { WIDE: 'go', SLOT: 'seam', TE: 'seam', RB: 'stick' },
    back: { WIDE: 'go', SLOT: 'seam', TE: 'seam' },
    lean: ['airRaid', 'vertical'],
  },
  {
    id: 'curlFlat',
    play: { WIDE: 'curl', SLOT: 'flat', TE: 'flat', RB: 'flat' },
    back: { WIDE: 'curl', SLOT: 'hitch', TE: 'stick' },
    lean: ['westCoast', 'power'],
  },
  {
    id: 'slantFlat',
    play: { WIDE: 'slant', SLOT: 'flat', TE: 'flat', RB: 'swing' },
    back: { WIDE: 'slant', SLOT: 'slant', TE: 'drag' },
    lean: ['westCoast', 'spreadOption'],
  },
  {
    id: 'stick',
    play: { WIDE: 'go', SLOT: 'stick', TE: 'stick', RB: 'flat' },
    back: { WIDE: 'slant', SLOT: 'hitch', TE: 'stick' },
    lean: ['westCoast', 'spreadOption'],
  },
  {
    id: 'dagger',
    play: { WIDE: 'dig', SLOT: 'seam', TE: 'cross', RB: 'stick' },
    back: { WIDE: 'post', SLOT: 'dig', TE: 'cross' },
    lean: ['vertical', 'proStyle'],
  },
  {
    id: 'quick',
    play: { WIDE: 'quickOut', SLOT: 'quickOut', TE: 'flat', RB: 'swing' },
    back: { WIDE: 'slant', SLOT: 'hitch', TE: 'stick' },
    lean: [],
  },
  {
    id: 'outs',
    play: { WIDE: 'comeback', SLOT: 'out', TE: 'out', RB: 'flat' },
    back: { WIDE: 'curl', SLOT: 'hitch', TE: 'stick' },
    lean: [],
  },
  {
    id: 'wheel',
    play: { WIDE: 'post', SLOT: 'wheel', TE: 'seam', RB: 'wheel' },
    back: { WIDE: 'dig', SLOT: 'drag', TE: 'drag' },
    lean: [],
  },
  {
    id: 'screen',
    play: { WIDE: 'block', SLOT: 'block', TE: 'block', RB: 'screen' },
    back: { WIDE: 'go', SLOT: 'hitch', TE: 'stick' },
    lean: ['spreadOption', 'westCoast'],
  },
  {
    id: 'shot',
    play: { WIDE: 'go', SLOT: 'post', TE: 'block', RB: 'block' },
    back: { WIDE: 'post', SLOT: 'go', TE: 'block' },
    lean: ['vertical'],
  },
];

/** How much more often an offense calls the concepts it's built on. */
const LEAN = 2.5;

/**
 * The concept for a target running `route` from `spot`: a designed shot is a shot; otherwise one with his route at his
 * spot on the play side where there is one, leaned by the scheme. He runs his route whatever the pick.
 */
export function conceptFor(
  target: { spot: Spot; route: RouteId },
  scheme: OffSchemeId | undefined,
  designedShot: boolean,
  rng: Rng,
): Concept {
  const weight = (c: Entry) => 1 + (scheme && c.lean.includes(scheme) ? LEAN : 0);
  const pool = designedShot
    ? BOOK.filter((c) => c.id === 'shot')
    : BOOK.filter((c) => c.id !== 'shot' && c.play[target.spot] === target.route);
  const pick = rng.weighted(pool.length ? pool : BOOK.filter((c) => c.id !== 'shot'), weight);
  return { id: pick.id, play: { ...pick.play, [target.spot]: target.route }, back: pick.back };
}

/** Where he lined up, read off his spot: split wide, inside him in the slot, a tight end, the back. */
export function spotOf(role: string, at: Pt, ballY: number): Spot {
  if (role === 'TE') return 'TE';
  if (role === 'RB') return 'RB';
  return Math.abs(at.y - ballY) >= 15 ? 'WIDE' : 'SLOT';
}

/** A second man at one spot on one side (trips, two tight ends) runs this instead, so they don't run one route twice. */
const SECOND: Record<Spot, Assignment> = { WIDE: 'curl', SLOT: 'drag', TE: 'flat', RB: 'flat' };

/** Each receiver's assignment in a concept, by his spot and side; a second man at a spot gets `SECOND`. */
export function assign(
  concept: Concept,
  men: readonly { id: number; spot: Spot; playSide: boolean }[],
): Map<number, Assignment | undefined> {
  const taken = new Set<string>();
  const out = new Map<number, Assignment | undefined>();
  for (const m of men) {
    const key = `${m.playSide}:${m.spot}`;
    const route = (m.playSide ? concept.play : concept.back)[m.spot];
    out.set(m.id, taken.has(key) ? (route === undefined ? undefined : SECOND[m.spot]) : route);
    taken.add(key);
  }
  return out;
}

/**
 * Across the field from his line, toward the middle, where a route ends when nobody throws to him (yards; negative:
 * toward the sideline). The depth is the route's NFL average.
 */
const ENDS_ACROSS: Record<RouteId, number> = {
  screen: -1,
  swing: -5,
  flat: -6,
  quickOut: -4,
  drag: 12,
  hitch: 0,
  slant: 5,
  stick: -1,
  curl: 1,
  out: -6,
  cross: 15,
  comeback: -2,
  dig: 8,
  wheel: -4,
  corner: -7,
  post: 6,
  go: -1,
  seam: 0,
};

/** Where a decoy's route ends: its NFL depth past the line, across by its way, inside the field. */
export function decoyEnd(route: RouteId, from: Pt, lineX: number, dir: 1 | -1, inward: 1 | -1): Pt {
  const depth = Math.max(-2, ROUTES[route].mean);
  return {
    // Short of the end line: a deep route from near the goal ends at the back of the end zone.
    x: Math.max(-9, Math.min(109, lineX + dir * depth)),
    y: Math.max(1.5, Math.min(FIELD_W - 1.5, from.y + inward * ENDS_ACROSS[route])),
  };
}
