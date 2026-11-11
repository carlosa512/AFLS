/** Frontier East. Drawn plainly: real stadiums first. */
import type { Building } from '../types';

export const FRONTIER_EAST: Record<string, Building> = {
  // A long arched roof in silver over walls of glass, open down the middle. In a suburb.
  DAL: {
    id: 'DAL',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#0b2a5c',
    wall: '#c3ccd3',
    windows: '#6fa6c8',
    ground: '#8a9a6c',
    roof: {
      kind: 'slab',
      profile: { kind: 'flat', h: 37, crown: 6, fall: 2 },
      th: 3.8,
      skin: '#c9d1d6',
      section: '#eef1f2',
      edge: '#8d99a2',
      opening: { x0: -36, x1: 36, z1: 72 },
      leaves: { xi: 38, xo: 96, yi: 2, yo: 2, th: 1.8, z1: 74, skin: '#b3bdc4' },
    },
    features: [],
    setting: { kind: 'suburb', trees: 'round', canal: false },
  },
  // A grey concrete and aluminium bowl on the marshes, without ornament.
  NYE: {
    id: 'NYE',
    rim: { kind: 'flat', h: 24.4 },
    seat: '#0b2265',
    wall: '#9aa1a6',
    ground: '#7d8a5c',
    features: [],
    setting: { kind: 'marsh', highway: false },
  },
  // A steel bowl with a roof over the back rows, beyond its car parks the streets of houses.
  PHI: {
    id: 'PHI',
    rim: { kind: 'flat', h: 26.8 },
    seat: '#0d3f45',
    wall: '#5d6a70',
    ground: '#7a7f83',
    roof: { kind: 'canopy', d0: 24, d1: 34, y0: 26, y1: 28, skin: '#dfe3e3' },
    features: [],
    setting: { kind: 'suburb', trees: 'round', canal: false },
  },
  // A plain bowl in burgundy and stone, out among the woods.
  WAS: {
    id: 'WAS',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#3c0f10',
    wall: '#a39c8c',
    ground: '#62794f',
    features: [],
    setting: { kind: 'outOfTown', trees: 'round', sheds: false },
  },
};
