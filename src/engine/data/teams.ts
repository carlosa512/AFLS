/**
 * Default league: the 32 real NFL markets and divisional alignment, with
 * original nicknames and conference names so the game ships without licensed
 * marks. Colours follow each market's real club, so a city still looks like
 * itself (colours alone aren't a mark). Players can replace this data with a mod file.
 */

import type { HelmetDesign } from '../types';

export interface TeamSeed {
  city: string;
  name: string;
  abbrev: string;
  colors: [string, string];
  /**
   * The market's yearly revenue, $M: the real club's (Forbes, "The NFL's Most Valuable Teams 2025", the 2024
   * season). It sets how much the owner spends on his staffs (`ownerBudgets` in staff.ts); a mod can leave it out.
   */
  revenue?: number;
  /**
   * The real franchise's regular-season win share over the last ten seasons, 2015–2024 (ties count half;
   * nflverse game results, the Raiders, Chargers and Rams following their franchises). It tilts the opening
   * roster's talent (`generate.ts`), so a new league starts with the real league's pecking order; a mod can
   * leave it out for a random start.
   */
  winPct?: number;
  /** The club's helmet (the same home and away); a mod can leave it out for the fallback built from `colors`. */
  helmet?: HelmetDesign;
}

const WHITE = '#F2F4F6';
const GREY_MASK = '#9AA3AD';
const BLACK_MASK = '#1A1D22';
/** One club's helmet, in the order of the spec's table: shell, finish, stripe (A, B), number (ink, trim), bumper, mask. */
function helmet(
  shell: string,
  finish: HelmetDesign['finish'],
  stripe: HelmetDesign['stripe'],
  stripeA: string | undefined,
  stripeB: string | undefined,
  number: [string, string] | null,
  bumper: string,
  mask: string,
): HelmetDesign {
  const d: HelmetDesign = { shell, finish, stripe, bumper, mask };
  if (stripeA) d.stripeA = stripeA;
  if (stripeB) d.stripeB = stripeB;
  if (number) d.number = { ink: number[0], trim: number[1] };
  return d;
}

export const CONFERENCES = [
  { name: 'Liberty Conference', abbrev: 'LC' },
  { name: 'Frontier Conference', abbrev: 'FC' },
];

/** Division names, in order; each has four teams in TEAM_SEEDS below. */
export const DIVISIONS = [
  { name: 'Liberty East', conference: 0 },
  { name: 'Liberty North', conference: 0 },
  { name: 'Liberty South', conference: 0 },
  { name: 'Liberty West', conference: 0 },
  { name: 'Frontier East', conference: 1 },
  { name: 'Frontier North', conference: 1 },
  { name: 'Frontier South', conference: 1 },
  { name: 'Frontier West', conference: 1 },
];

/** 32 teams, four per division in DIVISIONS order. */
export const TEAM_SEEDS: TeamSeed[] = [
  // Liberty East
  {
    city: 'Buffalo',
    name: 'Blizzard',
    abbrev: 'BUF',
    colors: ['#00338d', '#c60c30'],
    revenue: 585,
    winPct: 0.62,
    helmet: helmet(WHITE, 'gloss', 'triple', '#c60c30', '#00338d', ['#00338d', '#ffffff'], '#00338d', GREY_MASK),
  },
  {
    city: 'Miami',
    name: 'Barracudas',
    abbrev: 'MIA',
    colors: ['#008e97', '#fc4c02'],
    revenue: 656,
    winPct: 0.494,
    helmet: helmet(WHITE, 'gloss', 'triple', '#008e97', '#fc4c02', ['#008e97', '#ffffff'], '#008e97', '#008e97'),
  },
  {
    city: 'New England',
    name: 'Admirals',
    abbrev: 'NE',
    colors: ['#002244', '#c60c30'],
    revenue: 762,
    winPct: 0.579,
    helmet: helmet('#a9b2ba', 'metal', 'triple', '#002244', '#c60c30', ['#002244', '#ffffff'], '#002244', GREY_MASK),
  },
  {
    city: 'New York',
    name: 'Knights',
    abbrev: 'NYK',
    colors: ['#125740', '#ffffff'],
    revenue: 663,
    winPct: 0.341,
    helmet: helmet('#125740', 'gloss', 'double', '#ffffff', undefined, ['#ffffff', '#0b3a2a'], '#ffffff', WHITE),
  },
  // Liberty North
  {
    city: 'Baltimore',
    name: 'Clippers',
    abbrev: 'BAL',
    colors: ['#241773', '#9e7c0c'],
    revenue: 621,
    winPct: 0.61,
    helmet: helmet('#241773', 'gloss', 'triple', '#c9a227', '#ffffff', ['#ffffff', '#241773'], '#c9a227', BLACK_MASK),
  },
  {
    city: 'Cincinnati',
    name: 'Steamers',
    abbrev: 'CIN',
    colors: ['#fb4f14', '#000000'],
    revenue: 573,
    winPct: 0.479,
    helmet: helmet('#fb4f14', 'gloss', 'triple', '#000000', '#ffffff', ['#000000', '#ffffff'], BLACK_MASK, BLACK_MASK),
  },
  {
    city: 'Cleveland',
    name: 'Hammers',
    abbrev: 'CLE',
    colors: ['#311d00', '#ff3c00'],
    revenue: 685,
    winPct: 0.351,
    helmet: helmet('#ff3c00', 'gloss', 'triple', '#311d00', '#ffffff', null, '#311d00', GREY_MASK),
  },
  {
    city: 'Pittsburgh',
    name: 'Forge',
    abbrev: 'PIT',
    colors: ['#101820', '#ffb612'],
    revenue: 619,
    winPct: 0.622,
    helmet: helmet('#101820', 'gloss', 'single', '#ffb612', undefined, ['#ffb612', '#000000'], '#ffb612', BLACK_MASK),
  },
  // Liberty South
  {
    city: 'Houston',
    name: 'Wildcatters',
    abbrev: 'HOU',
    colors: ['#03202f', '#a71930'],
    revenue: 687,
    winPct: 0.454,
    helmet: helmet('#03202f', 'gloss', 'triple', '#a71930', '#ffffff', ['#ffffff', '#a71930'], '#a71930', GREY_MASK),
  },
  {
    city: 'Indianapolis',
    name: 'Racers',
    abbrev: 'IND',
    colors: ['#002c5f', '#a2aaad'],
    revenue: 593,
    winPct: 0.479,
    helmet: helmet(WHITE, 'gloss', 'double', '#002c5f', undefined, ['#002c5f', '#ffffff'], '#002c5f', GREY_MASK),
  },
  {
    city: 'Jacksonville',
    name: 'Tarpons',
    abbrev: 'JAX',
    colors: ['#006778', '#d7a22a'],
    revenue: 522,
    winPct: 0.335,
    helmet: helmet('#006778', 'gloss', 'triple', '#d7a22a', '#ffffff', ['#d7a22a', '#003b45'], '#d7a22a', BLACK_MASK),
  },
  {
    city: 'Tennessee',
    name: 'Outlaws',
    abbrev: 'TEN',
    colors: ['#0c2340', '#4b92db'],
    revenue: 582,
    winPct: 0.476,
    helmet: helmet('#0c2340', 'gloss', 'triple', '#4b92db', '#ffffff', ['#ffffff', '#4b92db'], '#4b92db', GREY_MASK),
  },
  // Liberty West
  {
    city: 'Denver',
    name: 'Summit',
    abbrev: 'DEN',
    colors: ['#fb4f14', '#002244'],
    revenue: 645,
    winPct: 0.451,
    helmet: helmet('#002244', 'gloss', 'triple', '#fb4f14', '#ffffff', ['#fb4f14', '#ffffff'], '#fb4f14', BLACK_MASK),
  },
  {
    city: 'Kansas City',
    name: 'Marshals',
    abbrev: 'KC',
    colors: ['#e31837', '#ffb81c'],
    revenue: 610,
    winPct: 0.75,
    helmet: helmet('#e31837', 'gloss', 'triple', '#ffb81c', '#ffffff', ['#ffffff', '#7a0d1d'], '#f2f4f6', WHITE),
  },
  {
    city: 'Las Vegas',
    name: 'Mirage',
    abbrev: 'LV',
    colors: ['#000000', '#a5acaf'],
    revenue: 832,
    winPct: 0.439,
    helmet: helmet('#a9b2ba', 'metal', 'single', '#000000', undefined, ['#000000', '#ffffff'], BLACK_MASK, BLACK_MASK),
  },
  {
    city: 'Los Angeles',
    name: 'Condors',
    abbrev: 'LAC',
    colors: ['#0080c6', '#ffc20e'],
    revenue: 593,
    winPct: 0.47,
    helmet: helmet('#0080c6', 'gloss', 'triple', '#ffc20e', '#ffffff', ['#ffc20e', '#00476f'], '#ffc20e', '#ffc20e'),
  },
  // Frontier East
  {
    city: 'Dallas',
    name: 'Stampede',
    abbrev: 'DAL',
    colors: ['#003594', '#869397'],
    revenue: 1234,
    winPct: 0.567,
    helmet: helmet('#a9b2ba', 'metal', 'triple', '#003594', '#ffffff', ['#003594', '#ffffff'], '#003594', '#003594'),
  },
  {
    city: 'New York',
    name: 'Empire',
    abbrev: 'NYE',
    colors: ['#0b2265', '#a71930'],
    revenue: 707,
    winPct: 0.351,
    helmet: helmet('#0b2265', 'gloss', 'triple', '#a71930', '#ffffff', ['#ffffff', '#a71930'], '#a71930', GREY_MASK),
  },
  {
    city: 'Philadelphia',
    name: 'Founders',
    abbrev: 'PHI',
    colors: ['#004c54', '#a5acaf'],
    revenue: 688,
    winPct: 0.595,
    helmet: helmet('#004c54', 'gloss', 'triple', '#c4ccd0', '#ffffff', ['#e8ecee', '#001f22'], '#c4ccd0', BLACK_MASK),
  },
  {
    city: 'Washington',
    name: 'Sentinels',
    abbrev: 'WAS',
    colors: ['#5a1414', '#ffb612'],
    revenue: 644,
    winPct: 0.445,
    helmet: helmet('#5a1414', 'gloss', 'triple', '#ffb612', '#ffffff', ['#ffb612', '#2d0a0a'], '#ffb612', '#ffb612'),
  },
  // Frontier North
  {
    city: 'Chicago',
    name: 'Gale',
    abbrev: 'CHI',
    colors: ['#0b162a', '#c83803'],
    revenue: 629,
    winPct: 0.384,
    helmet: helmet('#0b162a', 'gloss', 'triple', '#c83803', '#ffffff', ['#ffffff', '#c83803'], '#c83803', GREY_MASK),
  },
  {
    city: 'Detroit',
    name: 'Gears',
    abbrev: 'DET',
    colors: ['#0076b6', '#b0b7bc'],
    revenue: 585,
    winPct: 0.482,
    helmet: helmet('#b0b7bc', 'metal', 'triple', '#0076b6', '#ffffff', ['#0076b6', '#ffffff'], '#0076b6', '#0076b6'),
  },
  {
    city: 'Green Bay',
    name: 'Lumberjacks',
    abbrev: 'GB',
    colors: ['#203731', '#ffb612'],
    revenue: 719,
    winPct: 0.613,
    helmet: helmet('#ffb612', 'gloss', 'triple', '#203731', '#ffffff', null, '#203731', '#203731'),
  },
  {
    city: 'Minnesota',
    name: 'Voyageurs',
    abbrev: 'MIN',
    colors: ['#4f2683', '#ffc62f'],
    revenue: 609,
    winPct: 0.607,
    helmet: helmet('#4f2683', 'gloss', 'triple', '#ffc62f', '#ffffff', ['#ffc62f', '#2a1146'], '#ffc62f', BLACK_MASK),
  },
  // Frontier South
  {
    city: 'Atlanta',
    name: 'Firebirds',
    abbrev: 'ATL',
    colors: ['#a71930', '#000000'],
    revenue: 612,
    winPct: 0.463,
    helmet: helmet('#141619', 'gloss', 'triple', '#a71930', '#ffffff', ['#a71930', '#ffffff'], '#a71930', BLACK_MASK),
  },
  {
    city: 'Carolina',
    name: 'Monarchs',
    abbrev: 'CAR',
    colors: ['#0085ca', '#101820'],
    revenue: 588,
    winPct: 0.415,
    helmet: helmet('#a9b2ba', 'metal', 'triple', '#0085ca', '#101820', ['#101820', '#ffffff'], '#0085ca', BLACK_MASK),
  },
  {
    city: 'New Orleans',
    name: 'Krewe',
    abbrev: 'NO',
    colors: ['#101820', '#d3bc8d'],
    revenue: 607,
    winPct: 0.567,
    helmet: helmet('#d3bc8d', 'metal', 'triple', '#101820', '#ffffff', ['#101820', '#ffffff'], '#101820', BLACK_MASK),
  },
  {
    city: 'Tampa Bay',
    name: 'Corsairs',
    abbrev: 'TB',
    colors: ['#d50a0a', '#34302b'],
    revenue: 629,
    winPct: 0.506,
    helmet: helmet('#6e6a63', 'metal', 'triple', '#d50a0a', '#ffffff', ['#d50a0a', '#ffffff'], '#d50a0a', '#34302b'),
  },
  // Frontier West
  {
    city: 'Arizona',
    name: 'Scorpions',
    abbrev: 'ARI',
    colors: ['#97233f', '#000000'],
    revenue: 571,
    winPct: 0.439,
    helmet: helmet(WHITE, 'gloss', 'triple', '#97233f', '#000000', ['#97233f', '#ffffff'], '#97233f', BLACK_MASK),
  },
  {
    city: 'Los Angeles',
    name: 'Stars',
    abbrev: 'LAS',
    colors: ['#003594', '#ffd100'],
    revenue: 764,
    winPct: 0.555,
    helmet: helmet('#003594', 'gloss', 'triple', '#ffd100', '#ffffff', ['#ffd100', '#001a4d'], '#ffd100', '#ffd100'),
  },
  {
    city: 'San Francisco',
    name: 'Fog',
    abbrev: 'SF',
    colors: ['#aa0000', '#b3995d'],
    revenue: 723,
    winPct: 0.47,
    helmet: helmet('#b3995d', 'metal', 'triple', '#aa0000', '#ffffff', ['#aa0000', '#ffffff'], '#aa0000', '#aa0000'),
  },
  {
    city: 'Seattle',
    name: 'Squall',
    abbrev: 'SEA',
    colors: ['#002244', '#69be28'],
    revenue: 624,
    winPct: 0.595,
    helmet: helmet('#002244', 'gloss', 'triple', '#69be28', '#a5acaf', ['#ffffff', '#69be28'], '#69be28', GREY_MASK),
  },
];

/** Nicknames we must never ship (licensed marks), used by tests to guard mod-free defaults. */
export const RESERVED_NICKNAMES = [
  'Bears',
  'Bengals',
  'Bills',
  'Broncos',
  'Browns',
  'Buccaneers',
  'Cardinals',
  'Chargers',
  'Chiefs',
  'Colts',
  'Commanders',
  'Cowboys',
  'Dolphins',
  'Eagles',
  'Falcons',
  '49ers',
  'Giants',
  'Jaguars',
  'Jets',
  'Lions',
  'Packers',
  'Panthers',
  'Patriots',
  'Raiders',
  'Rams',
  'Ravens',
  'Saints',
  'Seahawks',
  'Steelers',
  'Texans',
  'Titans',
  'Vikings',
  'Oilers',
  'Redskins',
];

/** Old default team names (before real markets) → used to migrate existing saves in place. */
export const LEGACY_FIRST_TEAM = { city: 'Boston', name: 'Admirals' };

/** Default colours before they followed the real clubs (by abbrev), so old saves pick up the new ones unless a mod changed them. */
export const LEGACY_COLORS: Record<string, [string, string]> = {
  BUF: ['#0d2240', '#9cc3e6'],
  MIA: ['#00838f', '#ff7f50'],
  NE: ['#0b2a5b', '#c9a227'],
  NYK: ['#1d1d1f', '#8a8d91'],
  BAL: ['#14365d', '#e4572e'],
  CIN: ['#3a1f14', '#e8a33d'],
  CLE: ['#4a2511', '#f08a24'],
  PIT: ['#2b2b2b', '#e36414'],
  HOU: ['#3a0f0f', '#e5a823'],
  IND: ['#111111', '#e10600'],
  JAX: ['#005f73', '#94d2bd'],
  TEN: ['#3b2a20', '#d4a017'],
  DEN: ['#16324f', '#e87722'],
  KC: ['#1c2841', '#c5b358'],
  LV: ['#141414', '#d4af37'],
  LAC: ['#2a1a5e', '#f7b801'],
  DAL: ['#24324a', '#b8c4d6'],
  NYE: ['#1b2f6b', '#d64545'],
  PHI: ['#5a1f2b', '#e8d5a8'],
  WAS: ['#2e3a59', '#b31b1b'],
  CHI: ['#002f6c', '#d22630'],
  DET: ['#2f4858', '#86bbd8'],
  GB: ['#234d20', '#c0392b'],
  MIN: ['#2c2a6b', '#f4c430'],
  ATL: ['#b3261e', '#f2a541'],
  CAR: ['#3d1a6e', '#38b2ac'],
  NO: ['#4b2e83', '#2bb24c'],
  TB: ['#7a1e1e', '#9aa5b1'],
  ARI: ['#8c2f1b', '#f2c14e'],
  LAS: ['#1e3d59', '#f5c518'],
  SF: ['#3c4f5c', '#f26a4f'],
  SEA: ['#0e3b43', '#7ac74f'],
};
