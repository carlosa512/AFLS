/** Liberty East (Buffalo is among the five agreed). */
import type { Building } from '../types';

export const LIBERTY_EAST: Record<string, Building> = {
  // Fin blades: shade blades ring a bowl whose corners are open to the sea breeze. Out of town, among palms.
  MIA: {
    id: 'MIA',
    rim: { kind: 'flat', h: 23.8 },
    openCorners: true,
    seat: '#0e3a3f',
    wall: '#e9ece8',
    face: '#f4f4f0',
    ground: '#7f9a6a',
    features: [{ kind: 'fins', skin: '#f4f4f0' }],
    setting: { kind: 'suburb', trees: 'palm', canal: true },
  },
  // Flagship: a ship of the line. Three masts over a stern gallery of lit windows; the rail rises to bow and stern.
  NE: {
    id: 'NE',
    rim: { kind: 'saddle', h: 23.4, rise: 4.5 },
    seat: '#0f2238',
    wall: '#8a6238',
    windows: '#e8dcae',
    ground: '#62794f',
    features: [{ kind: 'masts', x: [-38, 0, 38] }],
    setting: { kind: 'outOfTown', trees: 'round', sheds: false, shops: true },
  },
  // The Keep: a castle. A battlement rim and four square towers with banners. On the marshes, by the highway.
  NYK: {
    id: 'NYK',
    rim: { kind: 'battlements', h: 23.8, step: 1.5 },
    seat: '#0f3a2c',
    wall: '#a39c8c',
    ground: '#7d8a5c',
    features: [{ kind: 'towers', x: [-54, -20, 14, 48] }],
    setting: { kind: 'marsh', highway: true },
  },
};
