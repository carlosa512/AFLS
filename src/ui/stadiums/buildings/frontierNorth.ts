/** Frontier North (Minnesota is among the five agreed). Drawn plainly: real stadiums first. */
import { BRICK, STEEL } from '../land/kit';
import type { Building } from '../types';

export const FRONTIER_NORTH: Record<string, Building> = {
  // A pale concrete bowl on the lake shore: a park and a road before it, a harbor of small boats behind.
  CHI: {
    id: 'CHI',
    rim: { kind: 'flat', h: 24.6 },
    seat: '#101c33',
    wall: '#b9b6ab',
    ground: '#6f8a5c',
    features: [],
    setting: { kind: 'lake', docks: false },
  },
  // A brick box under a flat steel roof, in the middle of town.
  DET: {
    id: 'DET',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#0a3a5c',
    wall: '#7d4636',
    windows: '#cfe6f2',
    ground: '#7a7f83',
    roof: {
      kind: 'slab',
      profile: { kind: 'flat', h: 37, crown: 1, fall: 1.5 },
      th: 4.4,
      skin: '#6f7a82',
      section: '#c9ced2',
      rib: 'rgba(30,36,42,.5)',
    },
    features: [],
    setting: { kind: 'downtown', palette: [...BRICK, ...STEEL], streetTrees: false },
  },
  // One tall, unbroken bowl in brick and green, in a small town: houses on its doorstep, trees in every yard.
  GB: {
    id: 'GB',
    decks: [
      { d0: 0, d1: 20, y0: 1.1, y1: 10.6, rows: 20, face: 1.1 },
      { d0: 19, d1: 33, y0: 13.4, y1: 22.4, rows: 14, face: 1.9 },
    ],
    rim: { kind: 'flat', h: 25 },
    seat: '#15301f',
    wall: '#8a4b3a',
    ground: '#6a8358',
    features: [],
    setting: { kind: 'suburb', trees: 'round', canal: false },
  },
};
