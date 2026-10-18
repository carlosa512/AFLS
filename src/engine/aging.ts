/**
 * How careers age at each position: the one table that development, retirement, contract asks,
 * trade values and the scouts' reports all read, so a 30-year-old back looks old to everyone.
 *
 * Physical tools go first, technique holds through the prime, the mental game lasts longest
 * (`AgingFamily`). Real studies disagree on exact peaks, so each curve is a range shaped per
 * player by his durability (`bodyShift`). Ranges and sources: docs/research/
 * attributes-development-scouting-roadmap.md; `npm run careers` checks the results against them.
 */
import type { AgingFamily } from './attributes';
import { ATTRIBUTE_INFO } from './attributes';
import { clamp } from './rng';
import { bodyShift } from './traits';
import type { Attribute, Player, Position, Traits } from './types';

export interface AgingCurve {
  /**
   * Technique's turning point for a typical body: development past this age starts to cut it, so
   * the first drop shows in the ratings he carries two seasons later.
   */
  peakEnd: number;
  /** Years earlier his physical tools start to fade. */
  physicalLead: number;
  /** How steep the decline is once it starts (1 = typical). */
  slope: number;
  /** Ratings that age with another family at this position (a quarterback's arm holds like his technique). */
  family?: Partial<Record<Attribute, AgingFamily>>;
}

/**
 * Backs peak earliest and fall hardest (−25% production from 28 to 29); receivers and corners peak
 * 25–28; linemen, tight ends and specialists hold long plateaus. A quarterback's legs fade from his
 * late 20s while his arm, accuracy and reads carry him into his mid-30s, so a pocket passer lasts
 * and a runner doesn't, with no archetype needed.
 */
export const AGING: Record<Position, AgingCurve> = {
  RB: { peakEnd: 27, physicalLead: 1, slope: 1.15 },
  WR: { peakEnd: 29, physicalLead: 1, slope: 1 },
  CB: { peakEnd: 28, physicalLead: 1, slope: 1 },
  S: { peakEnd: 29, physicalLead: 1, slope: 1 },
  LB: { peakEnd: 29, physicalLead: 1, slope: 1 },
  EDGE: { peakEnd: 29, physicalLead: 1, slope: 1 },
  DT: { peakEnd: 30, physicalLead: 0, slope: 1 },
  TE: { peakEnd: 31, physicalLead: 0, slope: 0.8 },
  OL: { peakEnd: 31, physicalLead: 0, slope: 0.9 },
  QB: { peakEnd: 34, physicalLead: 5, slope: 0.65, family: { throwPower: 'technical' } },
  K: { peakEnd: 34, physicalLead: 0, slope: 0.6 },
  P: { peakEnd: 34, physicalLead: 0, slope: 0.6 },
};

/** Last age of the prime at each position, for a typical body. */
export const PEAK_END = Object.fromEntries(Object.entries(AGING).map(([pos, c]) => [pos, c.peakEnd])) as Record<Position, number>;

/** The mental game keeps growing this many years past the technical prime. */
const MENTAL_LAG = 3;

/** How a rating ages at a position. */
export const agingFamily = (position: Position, attr: Attribute): AgingFamily => AGING[position].family?.[attr] ?? ATTRIBUTE_INFO[attr].aging;

/** Last age before this family of ratings starts to decline, for a player with these traits. */
export function declineOnset(position: Position, family: AgingFamily, traits?: Pick<Traits, 'durability'>): number {
  const c = AGING[position];
  const shift = traits ? bodyShift(traits) : 0;
  return c.peakEnd + shift + (family === 'physical' ? -c.physicalLead : family === 'mental' ? MENTAL_LAG : 0);
}

/**
 * How many years later (+) or earlier (−) than a typical player a position ages, for contract asks,
 * contract lengths and trade values. Calendar age only: those are public judgments.
 */
export const ageShift = (position: Position) => clamp(AGING[position].peakEnd - 29, -2, 4);

/**
 * Chance a player retires this offseason (his age has just ticked over). Players under contract
 * hang on until their body tells them otherwise; unsigned veterans and washed-up players walk away.
 */
export function retireChance(p: Player, ovr: number): number {
  const over = p.age - (AGING[p.position].peakEnd + bodyShift(p.traits));
  if (p.teamId === null) return over >= 2 || ovr < 8 ? 0.6 : 0.2;
  if (over >= 8) return 1;
  const hazard = over >= 2 ? 0.06 * (over - 1) : 0;
  return ovr < 8 && over >= 2 ? Math.max(hazard, 0.5) : hazard;
}
