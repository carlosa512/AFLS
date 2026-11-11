/** Liberty North (Cincinnati is among the five agreed). */
import type { Building } from '../types';

export const LIBERTY_NORTH: Record<string, Building> = {
  // Clipper rig: raked masts with their sails furled, held by rigging, over a brick bowl open at one end to the harbor.
  BAL: {
    id: 'BAL',
    rim: { kind: 'flat', h: 23.8 },
    openEnd: 'right',
    seat: '#1c1436',
    wall: '#8a4b3a',
    ground: '#7a7f83',
    features: [{ kind: 'masts', x: [-44, -16, 12], rake: 3, rigging: true, bare: true }],
    setting: { kind: 'harbor' },
  },
  // Mill yard: a sawtooth factory roofline, and a gantry crane that carries the lights. On the lake, among the docks.
  CLE: {
    id: 'CLE',
    rim: { kind: 'sawtooth', h: 23.6, rise: 4.2, every: 14 },
    seat: '#2a1a0c',
    wall: '#8a4b3a',
    ground: '#7a7f83',
    features: [{ kind: 'gantry', col: '#d98a1f' }],
    setting: { kind: 'lake', docks: true },
  },
  // Blast furnace: furnace stacks burning at each end of the far side, and a yellow truss round the club deck.
  PIT: {
    id: 'PIT',
    rim: { kind: 'flat', h: 24.2 },
    seat: '#1a1d22',
    wall: '#3a3f45',
    face: '#2b2f34',
    ground: '#7a7f83',
    features: [
      { kind: 'stacks', x: [-52, -44, 40, 48], cap: '#ff7a1e', body: '#2b2d31', glow: true },
      { kind: 'truss', col: '#ffb612' },
    ],
    setting: { kind: 'confluence' },
  },
};
