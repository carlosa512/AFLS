/** Frontier West. Drawn plainly: real stadiums first. */
import { PALE, STEEL } from '../land/kit';
import type { Building } from '../types';

export const FRONTIER_WEST: Record<string, Building> = {
  // Earth-coloured walls under a white roof that opens across the middle. On the desert's edge.
  ARI: {
    id: 'ARI',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#4a1220',
    wall: '#b98a62',
    windows: '#e8dcae',
    ground: '#c9a97c',
    roof: {
      kind: 'slab',
      profile: { kind: 'flat', h: 38, crown: 4, fall: 2 },
      th: 3.8,
      skin: '#eceae4',
      section: '#f6f4ee',
      edge: '#a39c8c',
      opening: { x0: -46, x1: 46, z1: 70 },
      leaves: { xi: 48, xo: 108, yi: 2, yo: 2, th: 1.8, z1: 72, skin: '#dcd9d0' },
    },
    features: [],
    setting: { kind: 'desert', palms: true },
  },
  // A dark slate roof, low and nearly flat, over pale walls. In a suburb.
  LAS: {
    id: 'LAS',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#0b2a5c',
    wall: '#d9d4c6',
    windows: '#7fb4cf',
    ground: '#8a9a6c',
    roof: {
      kind: 'slab',
      profile: { kind: 'flat', h: 36.5, crown: 2, fall: 2 },
      th: 4,
      skin: '#3f4650',
      section: '#aab1b8',
      rib: 'rgba(200,210,220,.3)',
    },
    features: [],
    setting: { kind: 'suburb', trees: 'palm', canal: false },
  },
  // A plain open bowl in red and pale concrete, in an office park of low buildings.
  SF: {
    id: 'SF',
    rim: { kind: 'flat', h: 24 },
    seat: '#4a0d0d',
    wall: '#c9c4b6',
    ground: '#8a9668',
    features: [],
    setting: { kind: 'town', height: 'low', palette: [...PALE, ...STEEL], lots: true },
  },
  // A steel bowl under a deep roof that covers most of the upper deck, against the rain. By the rail yards and docks.
  SEA: {
    id: 'SEA',
    rim: { kind: 'flat', h: 27.4 },
    seat: '#0c2238',
    wall: '#56606b',
    ground: '#7a7f83',
    roof: { kind: 'canopy', d0: 19, d1: 34, y0: 26.2, y1: 29, skin: '#b9c2c8' },
    features: [],
    setting: { kind: 'harbor' },
  },
};
