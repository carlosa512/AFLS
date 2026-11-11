/** Liberty South. Drawn plainly, after the owner's note (Nov 11): real stadiums first, the club in the materials. */
import { BRICK, STEEL } from '../land/kit';
import type { Building } from '../types';

export const LIBERTY_SOUTH: Record<string, Building> = {
  // A pale, nearly flat roof ribbed with steel, open in one long slot over the field; pale concrete walls and deep red
  // seats set it apart from Indianapolis's brick and navy. Out of town.
  HOU: {
    id: 'HOU',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#4a1320',
    wall: '#c9ccd0',
    windows: '#9fc3d6',
    face: '#0b2230',
    ground: '#7d8f6a',
    roof: {
      kind: 'slab',
      profile: { kind: 'flat', h: 40, crown: 0.6, fall: 1.5 },
      th: 5,
      skin: '#eef0f1',
      section: '#f4f5f5',
      rib: 'rgba(60,72,84,.7)',
      web: 'rgba(60,72,84,.85)',
      edge: '#56606b',
      opening: { x0: -58, x1: 58, z1: 64 },
      leaves: { xi: 60, xo: 118, yi: 1.6, yo: 1.6, th: 1.6, z1: 66, skin: '#dfe3e6' },
    },
    features: [],
    setting: { kind: 'suburb', trees: 'round', canal: false },
  },
  // A brick fieldhouse under a peaked roof whose two halves slide down the slopes. In town.
  IND: {
    id: 'IND',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#0c2444',
    wall: '#8a4b3a',
    windows: '#cfe6f2',
    ground: '#7a7f83',
    roof: {
      kind: 'slab',
      profile: { kind: 'flat', h: 36, crown: 9, fall: 2 },
      th: 3.6,
      skin: '#8f989f',
      section: '#d9dcdf',
      edge: '#c7ced3',
      opening: { x0: -40, x1: 40, z1: 68 },
      leaves: { xi: 42, xo: 104, yi: 2, yo: 2, th: 2, z1: 70, skin: '#7f8b94' },
    },
    features: [],
    setting: { kind: 'downtown', palette: [...BRICK, ...STEEL], streetTrees: false },
  },
  // A low, wide-open bowl with its corners open to the air. On the river, by a bridge.
  JAX: {
    id: 'JAX',
    decks: [
      { d0: 0, d1: 16, y0: 1.1, y1: 7.4, rows: 16, face: 1.1 },
      { d0: 15, d1: 27, y0: 10, y1: 16.8, rows: 12, face: 1.7 },
    ],
    rim: { kind: 'flat', h: 19 },
    openCorners: true,
    seat: '#0b3a42',
    wall: '#e9ece8',
    face: '#f4f4f0',
    ground: '#7f9a6a',
    features: [],
    setting: { kind: 'river', bridges: 1, boat: false, trees: 'palm' },
  },
  // A plain concrete bowl on the river bank, with a bridge to the city across the water.
  TEN: {
    id: 'TEN',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#0c2340',
    wall: '#9a9d98',
    ground: '#6f8560',
    features: [],
    setting: { kind: 'river', bridges: 1, boat: false, city: true },
  },
};
