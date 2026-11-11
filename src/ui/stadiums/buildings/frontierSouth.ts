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
  // A horseshoe in coral stone, open at one end to the bay, with a shade roof over the back rows.
  TB: {
    id: 'TB',
    rim: { kind: 'flat', h: 27 },
    openEnd: 'right',
    seat: '#4a0e10',
    wall: '#c98f73',
    face: '#34302b',
    ground: '#86996b',
    roof: { kind: 'canopy', d0: 21, d1: 34, y0: 26, y1: 28.4, skin: '#ece4d6' },
    features: [],
    setting: { kind: 'lake', docks: false },
  },
};
