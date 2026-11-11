/** Liberty West (Denver is among the five agreed). Drawn plainly: real stadiums first. */
import type { Building } from '../types';

export const LIBERTY_WEST: Record<string, Building> = {
  // A big brick bowl whose rim climbs toward each end, alone among car parks beside a highway.
  KC: {
    id: 'KC',
    rim: { kind: 'saddle', h: 23.6, rise: 5 },
    seat: '#5c1220',
    wall: '#8a4b3a',
    ground: '#7d9063',
    features: [],
    setting: { kind: 'outOfTown', trees: 'round', sheds: false, highway: true },
  },
  // A low sandstone drum under a pale, gently arched roof, with a band of glass. On the desert's edge.
  LV: {
    id: 'LV',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#1d1f22',
    wall: '#c4a57a',
    windows: '#9fc3d6',
    face: '#a5acaf',
    ground: '#c9a97c',
    roof: {
      kind: 'slab',
      profile: { kind: 'canoe', ends: 34, rise: 6, back: 30 },
      th: 3.2,
      skin: '#e3ded2',
      section: '#f1ede2',
    },
    features: [],
    setting: { kind: 'desert', palms: true },
  },
  // A white roof with a ridge down its middle over walls of glass. In a suburb, among palms.
  LAC: {
    id: 'LAC',
    rim: { kind: 'flat', h: 23.8 },
    seat: '#0a3b5c',
    wall: '#dfe6ea',
    windows: '#7fb4cf',
    ground: '#8a9a6c',
    roof: {
      kind: 'slab',
      profile: { kind: 'flat', h: 35, crown: 8, fall: 2 },
      th: 3,
      skin: '#f2f4f4',
      section: '#ffffff',
      rib: 'rgba(90,110,125,.5)',
    },
    features: [],
    setting: { kind: 'suburb', trees: 'palm', canal: false },
  },
};
