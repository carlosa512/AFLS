/** The five buildings the owner agreed in look (Nov 11): the pattern for the rest. */
import { BRICK, PALE, STEEL } from '../land/kit';
import type { Building } from '../types';

export const AGREED: Record<string, Building> = {
  // Ridgeline: the rim cut into peaks. In town.
  DEN: {
    id: 'DEN',
    rim: { kind: 'peaks', h: 23.6, rise: 6.5, every: 15 },
    seat: '#16283a',
    wall: '#a39c8c',
    ground: '#7a7f83',
    features: [],
    setting: { kind: 'town', height: 'mid', palette: [...BRICK, ...STEEL], lots: true },
  },
  // Storm porch: a roof over the back rows, glass behind it. Out of town.
  BUF: {
    id: 'BUF',
    rim: { kind: 'flat', h: 27.2 },
    seat: '#172846',
    wall: '#bcd9e6',
    wallGlass: true,
    ground: '#6b7a62',
    roof: { kind: 'canopy', d0: 22, d1: 34, y0: 26.4, y1: 28.4, skin: '#f1f4f6' },
    features: [],
    setting: { kind: 'outOfTown', trees: 'pine', sheds: true },
  },
  // Riverboat: white decks, twin stacks, a paddlewheel in the open end. On the river.
  CIN: {
    id: 'CIN',
    rim: { kind: 'flat', h: 23.8 },
    openEnd: 'left',
    seat: '#33383d',
    wall: '#e4e2da',
    face: '#f2f0e8',
    ground: '#667f58',
    features: [{ kind: 'wheel' }, { kind: 'stacks', x: [24, 33], cap: '#fb4f14' }],
    setting: { kind: 'river', bridges: 2, boat: true },
  },
  // Canoe hull: the roof an upturned canoe. In town, among towers.
  MIN: {
    id: 'MIN',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#2a1a3d',
    wall: '#8a6238',
    windows: '#cfe6f2',
    ground: '#80857f',
    roof: {
      kind: 'slab',
      profile: { kind: 'canoe', ends: 33, rise: 13, back: 29.5 },
      th: 3.4,
      skin: '#dccfae',
      section: '#f3ecd8',
      rib: 'rgba(122,90,52,.75)',
      web: 'rgba(122,90,52,.8)',
    },
    features: [],
    setting: { kind: 'downtown', palette: [...STEEL, ...PALE], streetTrees: false, glass: '#31506a' },
  },
  // Wings up: a roof with an opening and two leaves lifted like wings. In town.
  ATL: {
    id: 'ATL',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#231416',
    wall: '#2a2d31',
    windows: '#f3d37a',
    ground: '#80857f',
    roof: {
      kind: 'slab',
      profile: { kind: 'flat', h: 38.5, crown: 2.5, fall: 3 },
      th: 3.6,
      skin: '#33373c',
      section: '#c9ccd0',
      edge: '#ff7a3c',
      opening: { x0: -44, x1: 44, z1: 70 },
      leaves: { xi: 48, xo: 118, yi: 13, yo: 3.4, th: 2.2, z1: 72, skin: '#454a50' },
    },
    features: [],
    setting: { kind: 'downtown', palette: [...PALE, ...BRICK], streetTrees: true },
  },
};
