/** The five buildings the game has coming (`STADIUMS[abbrev].changes`), each from the season it opens. Drawn plainly. */
import type { Building } from '../types';

export const LATER_BUILDINGS: Record<string, { season: number; building: Building }[]> = {
  // Tennessee moves indoors: glass walls under a pale, gently arched roof, still on the river facing the city.
  TEN: [
    {
      season: 2027,
      building: {
        id: 'TEN:2027',
        rim: { kind: 'flat', h: 23.8 },
        seat: '#0c2340',
        wall: '#cfd6da',
        windows: '#7fb4cf',
        ground: '#6f8560',
        roof: {
          kind: 'slab',
          profile: { kind: 'canoe', ends: 34, rise: 7, back: 30 },
          th: 3.4,
          skin: '#e9ecec',
          section: '#f6f7f7',
        },
        features: [],
        setting: { kind: 'river', bridges: 1, boat: false, city: true },
      },
    },
  ],
  // Jacksonville rebuilt: the corners closed, and a silver shade roof over the back rows all the way round.
  JAX: [
    {
      season: 2028,
      building: {
        id: 'JAX:2028',
        rim: { kind: 'flat', h: 27 },
        seat: '#0b3a42',
        wall: '#e9ece8',
        face: '#f4f4f0',
        ground: '#7f9a6a',
        roof: { kind: 'canopy', d0: 20, d1: 34, y0: 26, y1: 28.6, skin: '#c9d1d6' },
        features: [],
        setting: { kind: 'river', bridges: 1, boat: false, trees: 'palm' },
      },
    },
  ],
  // Cleveland under a roof: the same brick, a flat dark steel roof, still among the docks.
  CLE: [
    {
      season: 2029,
      building: {
        id: 'CLE:2029',
        rim: { kind: 'flat', h: 23.8 },
        seat: '#2a1a0c',
        wall: '#8a4b3a',
        windows: '#e8dcae',
        ground: '#7a7f83',
        roof: {
          kind: 'slab',
          profile: { kind: 'flat', h: 37, crown: 1.5, fall: 1.5 },
          th: 4.2,
          skin: '#4a5158',
          section: '#b9bfc4',
          rib: 'rgba(200,210,220,.25)',
        },
        features: [],
        setting: { kind: 'lake', docks: true },
      },
    },
  ],
  // Washington under a roof: stone walls and a pale, nearly flat roof, among the woods.
  WAS: [
    {
      season: 2030,
      building: {
        id: 'WAS:2030',
        rim: { kind: 'flat', h: 23.8 },
        seat: '#3c0f10',
        wall: '#a39c8c',
        windows: '#e8dcae',
        ground: '#62794f',
        roof: {
          kind: 'slab',
          profile: { kind: 'flat', h: 37.5, crown: 3, fall: 2 },
          th: 3.8,
          skin: '#dcd8cc',
          section: '#f1eee6',
        },
        features: [],
        setting: { kind: 'outOfTown', trees: 'round', sheds: false },
      },
    },
  ],
  // Kansas City under a roof: the brick kept, a white arched roof over it, by the highway.
  KC: [
    {
      season: 2031,
      building: {
        id: 'KC:2031',
        rim: { kind: 'flat', h: 23.8 },
        seat: '#5c1220',
        wall: '#8a4b3a',
        windows: '#e8dcae',
        ground: '#7d9063',
        roof: {
          kind: 'slab',
          profile: { kind: 'canoe', ends: 33, rise: 10, back: 30 },
          th: 3.6,
          skin: '#eef0ee',
          section: '#ffffff',
          rib: 'rgba(120,130,138,.45)',
        },
        features: [],
        setting: { kind: 'outOfTown', trees: 'round', sheds: false, highway: true },
      },
    },
  ],
};
