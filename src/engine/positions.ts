import type { Attribute, Player, Position, Ratings } from './types';
import { ATTRIBUTES } from './types';

export const POSITION_NAMES: Record<Position, string> = {
  QB: 'Quarterback',
  RB: 'Running Back',
  WR: 'Wide Receiver',
  TE: 'Tight End',
  OL: 'Offensive Line',
  DT: 'Defensive Tackle',
  EDGE: 'Edge Rusher',
  LB: 'Linebacker',
  CB: 'Cornerback',
  S: 'Safety',
  K: 'Kicker',
  P: 'Punter',
};

/** Attribute weights that define a player's overall rating at each position. */
export const OVR_WEIGHTS: Record<Position, Partial<Record<Attribute, number>>> = {
  QB: { throwAccShort: 3, throwAccDeep: 2.5, awareness: 3, throwPower: 1.5, agility: 0.5, speed: 0.5 },
  RB: { elusiveness: 2.5, speed: 2, agility: 2, carrying: 1.5, strength: 1, catching: 0.75, awareness: 0.75, passBlock: 0.5 },
  WR: { catching: 2.5, routeRunning: 2.5, speed: 2.5, agility: 1.5, elusiveness: 0.75, awareness: 0.75 },
  TE: { catching: 2, routeRunning: 1.5, runBlock: 1.5, passBlock: 1, strength: 1, speed: 1, awareness: 0.5 },
  OL: { passBlock: 3, runBlock: 3, strength: 2, awareness: 1, agility: 0.5 },
  DT: { runStop: 3, strength: 2.5, passRush: 2, tackling: 1, awareness: 0.5, agility: 0.5 },
  EDGE: { passRush: 3, runStop: 1.5, speed: 1.5, strength: 1.5, agility: 1, tackling: 1 },
  LB: { tackling: 2.5, runStop: 2, awareness: 2, coverage: 1.5, speed: 1.5, passRush: 0.5 },
  CB: { coverage: 3, speed: 2.5, agility: 1.5, catching: 1, awareness: 1, tackling: 0.5 },
  S: { coverage: 2.5, awareness: 2, tackling: 1.5, speed: 1.5, catching: 0.75, runStop: 0.5 },
  K: { kickAccuracy: 3, kickPower: 2 },
  P: { kickPower: 3, kickAccuracy: 2 },
};

/**
 * Generation profile: each attribute's offset from the player's quality level.
 * Attributes not listed are "off-position" and rolled low.
 */
export const ATTRIBUTE_PROFILES: Record<Position, Partial<Record<Attribute, number>>> = {
  QB: { throwAccShort: 0, throwAccDeep: -0.5, awareness: 0, throwPower: 0, agility: -3, speed: -4, strength: -4, carrying: -3, elusiveness: -5 },
  RB: { elusiveness: 0, speed: 0, agility: 0, carrying: 0, strength: -2, catching: -3, awareness: -2, passBlock: -4, routeRunning: -5 },
  WR: { catching: 0, routeRunning: 0, speed: 0, agility: 0, elusiveness: -2, awareness: -2, strength: -5, carrying: -3, runBlock: -7 },
  TE: { catching: -0.5, routeRunning: -1, runBlock: 0, passBlock: -1, strength: -1, speed: -2, agility: -3, awareness: -2, carrying: -4, elusiveness: -6 },
  OL: { passBlock: 0, runBlock: 0, strength: 0, awareness: -1, agility: -3, speed: -8 },
  DT: { runStop: 0, strength: 0, passRush: -1, tackling: -1, awareness: -2, agility: -4, speed: -6 },
  EDGE: { passRush: 0, runStop: -1, speed: -1, strength: -1, agility: -1, tackling: -1, awareness: -2, coverage: -7 },
  LB: { tackling: 0, runStop: 0, awareness: 0, coverage: -1, speed: -1, passRush: -3, strength: -2, agility: -2, catching: -6 },
  CB: { coverage: 0, speed: 0, agility: 0, catching: -2, awareness: -1, tackling: -3, strength: -6, runStop: -6 },
  S: { coverage: 0, awareness: 0, tackling: -0.5, speed: -1, catching: -2, runStop: -2, agility: -1.5, strength: -4 },
  K: { kickAccuracy: 0, kickPower: 0 },
  P: { kickPower: 0, kickAccuracy: 0 },
};

/** 53-man roster composition used when generating teams. */
export const ROSTER_TEMPLATE: Record<Position, number> = {
  QB: 3,
  RB: 4,
  WR: 6,
  TE: 3,
  OL: 9,
  DT: 5,
  EDGE: 5,
  LB: 6,
  CB: 6,
  S: 4,
  K: 1,
  P: 1,
};

/** Number of starters at each position in the base 11-personnel / nickel look. */
export const STARTERS: Record<Position, number> = {
  QB: 1,
  RB: 1,
  WR: 3,
  TE: 1,
  OL: 5,
  DT: 2,
  EDGE: 2,
  LB: 2,
  CB: 3,
  S: 2,
  K: 1,
  P: 1,
};

/** Height (inches) and weight (lbs) ranges per position: [hMin, hMax, wMin, wMax]. */
export const BODY: Record<Position, [number, number, number, number]> = {
  QB: [72, 78, 205, 245],
  RB: [67, 73, 190, 235],
  WR: [69, 77, 175, 225],
  TE: [75, 79, 240, 265],
  OL: [75, 80, 295, 340],
  DT: [73, 78, 290, 335],
  EDGE: [74, 79, 245, 280],
  LB: [72, 76, 225, 255],
  CB: [69, 74, 180, 205],
  S: [70, 75, 195, 220],
  K: [69, 75, 180, 220],
  P: [72, 77, 195, 230],
};

/** Market-value multiplier by position (QB = 1). Drives contract demands. */
export const POSITION_VALUE: Record<Position, number> = {
  QB: 1,
  EDGE: 0.62,
  WR: 0.6,
  OL: 0.48,
  CB: 0.46,
  DT: 0.45,
  S: 0.32,
  LB: 0.32,
  TE: 0.32,
  RB: 0.27,
  K: 0.1,
  P: 0.08,
};

/** Typical jersey number ranges. */
export const JERSEY_RANGES: Record<Position, [number, number][]> = {
  QB: [[1, 19]],
  RB: [[20, 39], [0, 9]],
  WR: [[10, 19], [80, 89], [0, 9]],
  TE: [[80, 89], [40, 49]],
  OL: [[60, 79]],
  DT: [[90, 99], [50, 79]],
  EDGE: [[90, 99], [40, 59]],
  LB: [[40, 59], [0, 9]],
  CB: [[20, 39], [0, 9]],
  S: [[20, 49], [0, 9]],
  K: [[1, 19]],
  P: [[1, 19]],
};

export function overall(ratings: Ratings, position: Position): number {
  const weights = OVR_WEIGHTS[position];
  let sum = 0;
  let total = 0;
  for (const attr of ATTRIBUTES) {
    const w = weights[attr];
    if (w) {
      sum += ratings[attr] * w;
      total += w;
    }
  }
  return sum / total;
}

export function playerOvr(player: Player): number {
  return overall(player.ratings, player.position);
}
