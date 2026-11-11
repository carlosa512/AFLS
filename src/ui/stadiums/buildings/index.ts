/**
 * Every club's building, by abbreviation, and the ones the game has coming, by the season they open. A league the
 * list does not know (a mod's abbreviations) plays in one plain bowl in its own colours.
 */
import type { RoofType } from '../../../engine/data/stadiums';
import { lift, lum, mix } from '../colour';
import type { Building } from '../types';
import { AGREED } from './agreed';
import { FRONTIER_EAST } from './frontierEast';
import { FRONTIER_NORTH } from './frontierNorth';
import { FRONTIER_SOUTH } from './frontierSouth';
import { FRONTIER_WEST } from './frontierWest';
import { LIBERTY_EAST } from './libertyEast';
import { LIBERTY_NORTH } from './libertyNorth';
import { LIBERTY_SOUTH } from './libertySouth';
import { LIBERTY_WEST } from './libertyWest';

/** One entry a file of buildings: a new division is one more line here. */
const FILES: Record<string, Building>[] = [
  AGREED,
  LIBERTY_EAST,
  LIBERTY_NORTH,
  LIBERTY_SOUTH,
  LIBERTY_WEST,
  FRONTIER_EAST,
  FRONTIER_NORTH,
  FRONTIER_SOUTH,
  FRONTIER_WEST,
  // next division
];
export const BUILDINGS: Record<string, Building> = Object.assign({}, ...FILES);
export const LATER: Record<string, { season: number; building: Building }[]> = {};

export function plainBowl(colors: [string, string]): Building {
  const seat = lum(colors[0]) < 0.12 ? mix(colors[0], '#3a4650', 0.6) : mix(colors[0], '#101418', 0.7);
  return {
    id: 'plain',
    rim: { kind: 'flat', h: 23.8 },
    seat,
    chair: mix(seat, '#93a3b3', 0.4),
    wall: '#8d9296',
    face: lift(colors[1]),
    ground: '#6b7a62',
    features: [],
    setting: { kind: 'outOfTown', trees: 'round', sheds: false },
  };
}

/** The building a club plays in during a season: its later one once that has opened. */
export function buildingFor(abbrev: string, season: number, colors: [string, string]): Building {
  const later = (LATER[abbrev] ?? []).filter((l) => l.season <= season).pop();
  return later?.building ?? BUILDINGS[abbrev] ?? plainBowl(colors);
}

/** What kind of roof a building has, in the game's words. */
export function roofKindOf(b: Building): RoofType {
  if (b.roof?.kind !== 'slab') return 'outdoors';
  return b.roof.opening ? 'retractable' : 'dome';
}
