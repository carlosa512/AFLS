/** Frontier South (Atlanta is among the five agreed). Drawn plainly: real stadiums first. */
import { PALE, STEEL } from '../land/kit';
import type { Building } from '../types';

export const FRONTIER_SOUTH: Record<string, Building> = {
  // A dark stone bowl at the edge of downtown, the towers standing close behind it.
  CAR: {
    id: 'CAR',
    rim: { kind: 'flat', h: 24.4 },
    seat: '#0b2f47',
    wall: '#4a4f55',
    ground: '#7a7f83',
    features: [],
    setting: { kind: 'town', height: 'high', palette: [...STEEL, ...PALE], lots: true },
  },
  // A broad drum in bronze under a pale, shallow dome, among the towers.
  NO: {
    id: 'NO',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#1b1d20',
    wall: '#8a7350',
    windows: '#e8dcae',
    face: '#d3bc8d',
    ground: '#7a7f83',
    roof: {
      kind: 'slab',
      profile: { kind: 'canoe', ends: 33, rise: 8, back: 30 },
      th: 3.6,
      skin: '#c9c6bb',
      section: '#e9e6dc',
    },
    features: [],
    setting: { kind: 'downtown', palette: [...PALE, ...STEEL], streetTrees: true },
  },
  // A wide white bowl with its corners open, on flat ground among car parks and palms.
  TB: {
    id: 'TB',
    rim: { kind: 'flat', h: 23.8 },
    openCorners: true,
    seat: '#3a1012',
    wall: '#e4e0d6',
    ground: '#86996b',
    features: [],
    setting: { kind: 'suburb', trees: 'palm', canal: false },
  },
};
