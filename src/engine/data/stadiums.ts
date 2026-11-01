/**
 * Where each market plays: its roof, the climate outside it, and announced stadium changes. Keyed by
 * team abbreviation, so a mod league with other abbreviations simply plays indoors (no weather).
 */
export type RoofType = 'dome' | 'retractable' | 'outdoors';

/** A retractable roof opens only when the short-range forecast sits inside these. */
export interface RoofPolicy {
  minF: number;
  maxF: number;
  maxWind: number;
}

export interface Stadium {
  roof: RoofType;
  /** Key into CLIMATE (outdoor and retractable roofs). */
  climate?: string;
  /** Share of the open-air wind that reaches the field, for a canopy or bowl that blocks it. */
  windShelter?: number;
  /** Retractable roofs; DEFAULT_ROOF_POLICY otherwise. */
  policy?: RoofPolicy;
  /** Thin air: kicks carry, and visitors tire sooner. */
  altitudeFt?: number;
  /** A new or rebuilt stadium, from that league year on. */
  changes?: { season: number; roof: RoofType; windShelter?: number }[];
  /** The playing surface (2026): how All-22 paints the field. Nothing in the sim reads it. Turf when left out. */
  surface?: Surface;
}

export type Surface = 'grass' | 'turf';

/** No published thresholds for ARI, DAL and ATL: open in mild, calm, dry weather. */
export const DEFAULT_ROOF_POLICY: RoofPolicy = { minF: 60, maxF: 80, maxWind: 15 };

export const STADIUMS: Record<string, Stadium> = {
  BUF: { roof: 'outdoors', climate: 'BUF', windShelter: 0.75, surface: 'grass' }, // the new stadium's canopy cuts field-level wind
  MIA: { roof: 'outdoors', climate: 'MIA', surface: 'grass' },
  NE: { roof: 'outdoors', climate: 'NE' },
  NYK: { roof: 'outdoors', climate: 'NY' },
  BAL: { roof: 'outdoors', climate: 'BAL', surface: 'grass' },
  CIN: { roof: 'outdoors', climate: 'CIN' },
  CLE: { roof: 'outdoors', climate: 'CLE', changes: [{ season: 2029, roof: 'dome' }], surface: 'grass' },
  PIT: { roof: 'outdoors', climate: 'PIT', surface: 'grass' },
  // Opens only around 50–80°F with no real rain threat.
  HOU: { roof: 'retractable', climate: 'HOU', policy: { minF: 50, maxF: 80, maxWind: 20 } },
  // Must close at 40°F, 40 mph gusts or nearby precipitation.
  IND: { roof: 'retractable', climate: 'IND', policy: { minF: 41, maxF: 100, maxWind: 28 } },
  // shortcut: the 2027 season in Orlando during construction keeps Jacksonville's climate; add Orlando if it shows.
  JAX: {
    roof: 'outdoors',
    climate: 'JAX',
    changes: [{ season: 2028, roof: 'outdoors', windShelter: 0.85 }],
    surface: 'grass',
  },
  TEN: { roof: 'outdoors', climate: 'TEN', changes: [{ season: 2027, roof: 'dome' }] },
  DEN: { roof: 'outdoors', climate: 'DEN', altitudeFt: 5280, surface: 'grass' },
  KC: { roof: 'outdoors', climate: 'KC', changes: [{ season: 2031, roof: 'dome' }], surface: 'grass' },
  LV: { roof: 'dome', surface: 'grass' },
  LAC: { roof: 'dome' },
  DAL: { roof: 'retractable', climate: 'DAL' },
  NYE: { roof: 'outdoors', climate: 'NY' },
  PHI: { roof: 'outdoors', climate: 'PHI', surface: 'grass' },
  WAS: { roof: 'outdoors', climate: 'WAS', changes: [{ season: 2030, roof: 'dome' }], surface: 'grass' },
  CHI: { roof: 'outdoors', climate: 'CHI', surface: 'grass' },
  DET: { roof: 'dome' },
  GB: { roof: 'outdoors', climate: 'GB', surface: 'grass' },
  MIN: { roof: 'dome' },
  ATL: { roof: 'retractable', climate: 'ATL' },
  CAR: { roof: 'outdoors', climate: 'CAR', surface: 'grass' },
  NO: { roof: 'dome' },
  TB: { roof: 'outdoors', climate: 'TB', surface: 'grass' },
  ARI: { roof: 'retractable', climate: 'ARI', surface: 'grass' },
  LAS: { roof: 'dome' },
  SF: { roof: 'outdoors', climate: 'SF', surface: 'grass' },
  SEA: { roof: 'outdoors', climate: 'SEA' },
};

/** Hours behind US Eastern time, by market (missing: Eastern). The schedule keeps western hosts out of the 1:00 window. */
export const ZONES: Record<string, number> = {
  HOU: -1,
  KC: -1,
  DAL: -1,
  CHI: -1,
  GB: -1,
  MIN: -1,
  NO: -1,
  TEN: -1,
  DEN: -2,
  ARI: -2,
  LV: -3,
  LAC: -3,
  LAS: -3,
  SF: -3,
  SEA: -3,
};

/** Where weather systems travel together: one storm front can soak every city in a region the same week. */
export const REGIONS: Record<string, string> = {
  BUF: 'Northeast',
  NE: 'Northeast',
  NY: 'Northeast',
  CLE: 'Great Lakes',
  PIT: 'Great Lakes',
  CHI: 'Great Lakes',
  GB: 'Great Lakes',
  IND: 'Great Lakes',
  CIN: 'Great Lakes',
  PHI: 'Mid-Atlantic',
  BAL: 'Mid-Atlantic',
  WAS: 'Mid-Atlantic',
  CAR: 'Mid-Atlantic',
  ATL: 'Southeast',
  JAX: 'Southeast',
  TB: 'Southeast',
  MIA: 'Southeast',
  TEN: 'Southeast',
  KC: 'Plains',
  DEN: 'Plains',
  DAL: 'Plains',
  HOU: 'Plains',
  SEA: 'West',
  SF: 'West',
  ARI: 'West',
};

/** One climate month: mean daily high and low (°F), days with measurable precipitation, snowfall (in), mean wind (mph). */
export type ClimateMonth = [hi: number, lo: number, wetDays: number, snowIn: number, windMph: number];

/**
 * NOAA 1991–2020 normals at the airport nearest each stadium, September through January (Chicago is
 * Midway, Foxborough uses Providence, the Meadowlands Newark, Santa Clara San Jose), as published in
 * Wikipedia's NOAA tables and NWS normals pages. Single-source: Charlotte's wet days and snow, and
 * San Jose. Wind is NOAA's airport average (period of record, via Current Results); Newark's and San
 * Jose's are approximate.
 */
export const CLIMATE: Record<string, ClimateMonth[]> = {
  BUF: [
    [72.3, 54.5, 10.9, 0, 10.2],
    [59.6, 43.9, 14.1, 0.9, 11.1],
    [47.8, 34.2, 14.4, 7.8, 12.4],
    [37.2, 25.6, 17.7, 25.3, 13.1],
    [32.1, 19, 19.2, 26.7, 13.9],
  ],
  CLE: [
    [75.6, 57.1, 10.1, 0, 8.9],
    [63.7, 46.5, 12.1, 0.1, 9.9],
    [51.3, 36.7, 13.1, 4.5, 11.7],
    [40.4, 28.2, 15.6, 12.2, 12],
    [35.8, 22.3, 17.7, 18.4, 12.2],
  ],
  PIT: [
    [75.1, 54.8, 9.8, 0, 7.3],
    [63.1, 43.7, 11.1, 0.4, 8.3],
    [50.9, 34.3, 12, 2.4, 9.4],
    [40.6, 26.7, 14.6, 7.7, 10.1],
    [36.3, 21.4, 16.8, 13.3, 10.4],
  ],
  GB: [
    [71.7, 50.2, 9.7, 0, 9],
    [58, 39.5, 10.4, 0.3, 10],
    [43.5, 28.9, 9.6, 3.1, 11],
    [31.1, 18, 10.5, 13.1, 10.7],
    [25.5, 11.1, 10.8, 14.3, 11],
  ],
  CHI: [
    [76.5, 59.2, 8.4, 0, 8.9],
    [63.7, 46.8, 10.8, 0.1, 10],
    [49.6, 35.2, 10.2, 1.5, 11.1],
    [37.7, 25.3, 10.8, 7.9, 11],
    [32.8, 19.5, 11.5, 12.5, 11.6],
  ],
  NE: [
    [74.8, 56.5, 9.1, 0, 9.2],
    [63.8, 45.1, 10.2, 0.2, 9.5],
    [53.2, 35.8, 9.6, 1, 10.1],
    [43.4, 27.6, 11.9, 7.6, 10.5],
    [38.3, 22.1, 11.2, 10.3, 10.9],
  ],
  NY: [
    [77.7, 60.7, 8.7, 0, 8.6],
    [66, 49, 9.4, 0.2, 9],
    [54.9, 39, 8.8, 0.6, 9.8],
    [44.8, 31.2, 11.1, 5.4, 10.4],
    [40, 25.5, 10.6, 9.1, 10.9],
  ],
  PHI: [
    [78.9, 60.9, 9.3, 0, 8.3],
    [67.2, 49.2, 9.1, 0, 8.8],
    [55.9, 38.8, 8.6, 0.2, 9.6],
    [46, 31.2, 11, 3.5, 10],
    [41.3, 26, 11, 7.1, 10.3],
  ],
  BAL: [
    [79.7, 58.8, 9.1, 0, 7.6],
    [68.3, 46.5, 8.6, 0, 7.9],
    [57.3, 36.5, 8.5, 0.1, 8.6],
    [47.5, 29.6, 10.3, 2.5, 8.8],
    [43.2, 25.4, 10.1, 6.4, 9.1],
  ],
  WAS: [
    [80.7, 64.1, 8.7, 0, 8.3],
    [69.4, 52.2, 8.3, 0, 8.7],
    [58.2, 41.6, 8.4, 0.1, 9.4],
    [48.8, 34.5, 10.1, 1.7, 9.6],
    [44.8, 30.1, 9.7, 4.9, 10],
  ],
  CIN: [
    [78.9, 57.3, 9.5, 0, 7.4],
    [66.7, 45.7, 10, 0.2, 8.1],
    [53.8, 35, 11, 0.8, 9.7],
    [43.3, 27.9, 12.8, 4.1, 10],
    [39.6, 23.1, 13.4, 7.7, 10.4],
  ],
  IND: [
    [78.2, 57.4, 7.9, 0, 7.9],
    [65.6, 45.5, 8.9, 0.1, 8.9],
    [51.8, 34.9, 10.2, 0.8, 10.5],
    [40.4, 26.2, 11.8, 6.4, 10.5],
    [36.1, 20.9, 12.3, 8.8, 10.9],
  ],
  KC: [
    [79.2, 58.3, 9.2, 0, 9.4],
    [67.2, 46, 8.4, 0.1, 10.5],
    [53.5, 33.6, 6.3, 1, 11.2],
    [42.3, 23.9, 5.5, 3.4, 10.9],
    [38.4, 19.5, 6.8, 4.9, 11.1],
  ],
  DEN: [
    [79.6, 50, 6, 0.8, 8],
    [65.3, 37, 5.3, 3.9, 7.8],
    [52.9, 26, 4.6, 7.3, 8.3],
    [44, 18.4, 4.4, 6.6, 8.4],
    [44.6, 18.7, 4.4, 6.4, 8.7],
  ],
  TEN: [
    [84.4, 61.8, 7.8, 0, 6.5],
    [73.5, 49.9, 8.4, 0, 6.8],
    [61.4, 39.2, 9, 0.1, 8.3],
    [52.2, 33.3, 11.4, 0.4, 8.9],
    [49.1, 30.1, 10.8, 2, 9.1],
  ],
  CAR: [
    [82.6, 62.6, 7.7, 0, 6.6],
    [73.2, 50.4, 7.1, 0, 6.7],
    [62.8, 39.7, 8.1, 0.1, 6.9],
    [54.8, 34.5, 9.6, 0.4, 7.3],
    [52.2, 31.8, 10.3, 1.6, 7.8],
  ],
  ATL: [
    [83.9, 65.9, 7.3, 0, 8.1],
    [74.4, 54.9, 6.8, 0, 8.5],
    [64.1, 44.2, 7.9, 0, 9.1],
    [56.2, 38.4, 10.7, 0.4, 9.8],
    [54, 35.6, 11.1, 1, 10.4],
  ],
  JAX: [
    [87.1, 70, 12.4, 0, 7.5],
    [80.8, 61.1, 8, 0, 7.7],
    [73.2, 51.3, 6.6, 0, 7.6],
    [67.5, 45.8, 7.7, 0, 7.6],
    [65.5, 42.4, 7.7, 0, 8.1],
  ],
  TB: [
    [90.2, 75.3, 12.8, 0, 7.5],
    [85.6, 69.2, 7.2, 0, 8.3],
    [78.9, 60.7, 4.6, 0, 8.2],
    [73.9, 55.9, 6, 0, 8.3],
    [71.3, 52.8, 7.1, 0, 8.6],
  ],
  MIA: [
    [89, 76.9, 18.1, 0, 8.1],
    [85.9, 74.2, 13.8, 0, 9.2],
    [81.3, 68.3, 8.6, 0, 9.7],
    [78.2, 64.3, 8, 0, 9.1],
    [76.2, 61, 7.7, 0, 9.5],
  ],
  DAL: [
    [88.6, 68.5, 5.6, 0, 9.3],
    [78.4, 57.1, 7.2, 0, 9.7],
    [66.6, 46.2, 6.5, 0, 10.7],
    [57.9, 38.3, 6.9, 0.2, 10.8],
    [56.5, 36.1, 7, 0.1, 11],
  ],
  HOU: [
    [90.4, 70.6, 8.4, 0, 6.5],
    [82.8, 60.9, 7.7, 0, 6.9],
    [72.6, 51.5, 7.6, 0, 7.6],
    [65.3, 45.6, 9.6, 0.1, 7.7],
    [63.8, 43.7, 10, 0, 8.1],
  ],
  ARI: [
    [100.4, 78.1, 2.5, 0, 6.3],
    [89.2, 65.6, 2.2, 0, 5.8],
    [76.5, 53.7, 2.2, 0, 5.3],
    [66.2, 45.3, 4, 0, 5.1],
    [67.6, 46, 3.8, 0, 5.3],
  ],
  SEA: [
    [71.6, 53.6, 8.3, 0, 8],
    [60.5, 47, 14.3, 0, 8.3],
    [52.1, 40.9, 18.4, 0.2, 9],
    [47, 37.1, 18.4, 1.7, 9.6],
    [48, 37.7, 18.7, 1.8, 9.5],
  ],
  SF: [
    [80.7, 57.2, 0.9, 0, 6.5],
    [75.8, 52.7, 2.7, 0, 5.7],
    [66.1, 45.7, 6.9, 0, 5],
    [59.5, 41.7, 10.7, 0, 4.8],
    [59.8, 41.8, 10.2, 0, 5],
  ],
};
