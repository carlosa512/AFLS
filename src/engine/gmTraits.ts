/** Management tendencies shared by opening incumbents and promoted scouting directors. */
import { clamp, Rng } from './rng';
import type { GmTraits } from './types';

const GM_ARCHETYPES: GmTraits[] = [
  {
    archetype: 'Cap Magician',
    winNow: 0.7,
    capAggression: 0.9,
    pickChart: 'analytics',
    futureDiscount: 0.2,
    loyalty: 0.8,
    stubbornness: 0.3,
  },
  {
    archetype: 'All-In',
    winNow: 0.95,
    capAggression: 0.7,
    pickChart: 'johnson',
    futureDiscount: 0.38,
    loyalty: 0.4,
    stubbornness: 0.2,
  },
  {
    archetype: 'Draft and Develop',
    winNow: 0.35,
    capAggression: 0.2,
    pickChart: 'analytics',
    futureDiscount: 0.18,
    loyalty: 0.6,
    stubbornness: 0.5,
  },
  {
    archetype: 'Can-Kicker',
    winNow: 0.75,
    capAggression: 0.85,
    pickChart: 'johnson',
    futureDiscount: 0.3,
    loyalty: 0.5,
    stubbornness: 0.3,
  },
  {
    archetype: 'Hard-Liner',
    winNow: 0.55,
    capAggression: 0.3,
    pickChart: 'johnson',
    futureDiscount: 0.3,
    loyalty: 0.2,
    stubbornness: 0.9,
  },
  {
    archetype: 'Pick Hoarder',
    winNow: 0.2,
    capAggression: 0.2,
    pickChart: 'analytics',
    futureDiscount: 0.15,
    loyalty: 0.3,
    stubbornness: 0.6,
  },
  {
    archetype: 'Balanced',
    winNow: 0.5,
    capAggression: 0.5,
    pickChart: 'johnson',
    futureDiscount: 0.25,
    loyalty: 0.5,
    stubbornness: 0.5,
  },
  {
    archetype: 'Market Mover',
    winNow: 0.65,
    capAggression: 0.75,
    pickChart: 'analytics',
    futureDiscount: 0.22,
    loyalty: 0.35,
    stubbornness: 0.35,
  },
  {
    archetype: 'Core Keeper',
    winNow: 0.55,
    capAggression: 0.35,
    pickChart: 'analytics',
    futureDiscount: 0.22,
    loyalty: 0.8,
    stubbornness: 0.5,
  },
  {
    archetype: 'Slow Mover',
    winNow: 0.45,
    capAggression: 0.3,
    pickChart: 'johnson',
    futureDiscount: 0.28,
    loyalty: 0.65,
    stubbornness: 0.7,
  },
];

/** A GM's appetite for dealing, by archetype: deal-makers call, hard-liners sit tight. */
export const ARCHETYPE_ACTIVITY: Record<string, number> = {
  'All-In': 0.85,
  'Market Mover': 0.9,
  'Pick Hoarder': 0.7,
  'Cap Magician': 0.6,
  'Can-Kicker': 0.6,
  Balanced: 0.5,
  'Core Keeper': 0.45,
  'Draft and Develop': 0.4,
  'Hard-Liner': 0.25,
  'Slow Mover': 0.2,
};

export function generateGm(rng: Rng): GmTraits {
  const a = rng.pick(GM_ARCHETYPES);
  const j = (v: number) => Math.round(clamp(v + rng.normal(0, 0.08), 0, 1) * 100) / 100;
  return {
    ...a,
    winNow: j(a.winNow),
    capAggression: j(a.capAggression),
    loyalty: j(a.loyalty),
    stubbornness: j(a.stubbornness),
    futureDiscount: clamp(j(a.futureDiscount), 0.15, 0.4),
  };
}

/**
 * How much a GM marks an undersized prospect down (0: he trusts the tape; near 1: he wants measurables). Drawn from
 * his own stream in this league's world, so it follows the person between jobs without being stored, differs from one
 * world to the next, and moved no other draw.
 */
export function sizeBias(seed: string, gmId: number): number {
  return new Rng(`${seed}:size-bias:${gmId}`).next();
}
