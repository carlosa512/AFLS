/** What a building is, as data: the painter reads one of these a club. */
import type { Rng } from '../../engine/rng';
import type { Deck } from './bowl';
import type { Pen } from './pen';

/** How the game has the ground just now: the light, what is falling, a roof's state and how full it is. */
export interface Look {
  night: boolean;
  precip: 'none' | 'rain' | 'snow' | 'mixed';
  /** `none` outdoors and where the weather names no roof (a dome is then whole). */
  roof: 'none' | 'open' | 'closed';
  /** The share of seats taken (`FILL` in `crowd.ts`). */
  fill: number;
}

/** The top of the back wall along the bowl, in yards up. */
export type Rim = { kind: 'flat'; h: number } | { kind: 'peaks'; h: number; rise: number; every: number };

/** An open-air roof over the back rows: from `d0` to `d1` yards behind the wall, rising from `y0` to `y1`. */
export interface Canopy {
  kind: 'canopy';
  d0: number;
  d1: number;
  y0: number;
  y1: number;
  skin: string;
}
/** How a slab's top runs: nearly flat, or rising to the middle like an upturned canoe. */
export type Profile =
  | { kind: 'flat'; h: number; crown: number; fall: number }
  | { kind: 'canoe'; ends: number; rise: number; back: number };
/** A roof over the whole building, cut where the near side is cut. One that opens has an opening and two leaves. */
export interface Slab {
  kind: 'slab';
  profile: Profile;
  th: number;
  skin: string;
  section: string;
  rib?: string;
  web?: string;
  edge?: string;
  opening?: { x0: number; x1: number; z1: number };
  leaves?: { xi: number; xo: number; yi: number; yo: number; th: number; z1: number; skin: string };
}

/** The land outside. */
export type SettingUse =
  | { kind: 'none' }
  | { kind: 'town'; height: 'low' | 'mid' | 'high'; palette: string[]; lots: boolean }
  | { kind: 'outOfTown'; trees: 'pine' | 'round'; sheds: boolean }
  | { kind: 'river'; bridges: number; boat: boolean }
  | { kind: 'downtown'; palette: string[]; streetTrees: boolean; glass?: string };

/** Things on a building the painter knows how to draw in space. */
export type FeatureUse = { kind: 'stacks'; x: number[]; cap: string } | { kind: 'wheel' };

export interface Building {
  id: string;
  decks?: Deck[];
  rim: Rim;
  /** A horseshoe: this end has only its lower deck. */
  openEnd?: 'left' | 'right';
  seat: string;
  chair?: string;
  wall: string;
  /** The back wall is glass: the land shows through it. */
  wallGlass?: boolean;
  /** Windows in the back wall, in this colour by day. */
  windows?: string;
  face?: string;
  plaza?: string;
  ground: string;
  /** Drawn under snow whatever the day (a cold-weather ground's picture). */
  winter?: boolean;
  roof?: Canopy | Slab;
  features: FeatureUse[];
  setting: SettingUse;
}

/** What every part of the painter is handed. */
export interface Scene {
  pen: Pen;
  /** The land's draws. */
  rng: Rng;
  look: Look;
  colors: [string, string];
  /** Snow lies: it is falling, or the building is a winter one. */
  snowy: boolean;
  /** A colour in this scene's light: `k` is how lit the surface is; night darkens everything. */
  tone(hex: string, k?: number): string;
  /** A colour that makes its own light (a lamp, a lit window): night leaves it alone. */
  lamp(hex: string): string;
}
