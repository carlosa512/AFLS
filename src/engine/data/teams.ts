/**
 * Default league: the 32 real NFL markets and divisional alignment, with
 * original nicknames and conference names so the game ships without licensed
 * marks. Colours follow each market's real club, so a city still looks like
 * itself (colours alone aren't a mark). Players can replace this data with a mod file.
 */
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
  { city: 'Buffalo', name: 'Blizzard', abbrev: 'BUF', colors: ['#00338d', '#c60c30'], revenue: 585 },
  { city: 'Miami', name: 'Barracudas', abbrev: 'MIA', colors: ['#008e97', '#fc4c02'], revenue: 656 },
  { city: 'New England', name: 'Admirals', abbrev: 'NE', colors: ['#002244', '#c60c30'], revenue: 762 },
  { city: 'New York', name: 'Knights', abbrev: 'NYK', colors: ['#125740', '#ffffff'], revenue: 663 },
  // Liberty North
  { city: 'Baltimore', name: 'Clippers', abbrev: 'BAL', colors: ['#241773', '#9e7c0c'], revenue: 621 },
  { city: 'Cincinnati', name: 'Steamers', abbrev: 'CIN', colors: ['#fb4f14', '#000000'], revenue: 573 },
  { city: 'Cleveland', name: 'Hammers', abbrev: 'CLE', colors: ['#311d00', '#ff3c00'], revenue: 685 },
  { city: 'Pittsburgh', name: 'Forge', abbrev: 'PIT', colors: ['#101820', '#ffb612'], revenue: 619 },
  // Liberty South
  { city: 'Houston', name: 'Wildcatters', abbrev: 'HOU', colors: ['#03202f', '#a71930'], revenue: 687 },
  { city: 'Indianapolis', name: 'Racers', abbrev: 'IND', colors: ['#002c5f', '#a2aaad'], revenue: 593 },
  { city: 'Jacksonville', name: 'Tarpons', abbrev: 'JAX', colors: ['#006778', '#d7a22a'], revenue: 522 },
  { city: 'Tennessee', name: 'Outlaws', abbrev: 'TEN', colors: ['#0c2340', '#4b92db'], revenue: 582 },
  // Liberty West
  { city: 'Denver', name: 'Summit', abbrev: 'DEN', colors: ['#fb4f14', '#002244'], revenue: 645 },
  { city: 'Kansas City', name: 'Marshals', abbrev: 'KC', colors: ['#e31837', '#ffb81c'], revenue: 610 },
  { city: 'Las Vegas', name: 'Mirage', abbrev: 'LV', colors: ['#000000', '#a5acaf'], revenue: 832 },
  { city: 'Los Angeles', name: 'Condors', abbrev: 'LAC', colors: ['#0080c6', '#ffc20e'], revenue: 593 },
  // Frontier East
  { city: 'Dallas', name: 'Stampede', abbrev: 'DAL', colors: ['#003594', '#869397'], revenue: 1234 },
  { city: 'New York', name: 'Empire', abbrev: 'NYE', colors: ['#0b2265', '#a71930'], revenue: 707 },
  { city: 'Philadelphia', name: 'Founders', abbrev: 'PHI', colors: ['#004c54', '#a5acaf'], revenue: 688 },
  { city: 'Washington', name: 'Sentinels', abbrev: 'WAS', colors: ['#5a1414', '#ffb612'], revenue: 644 },
  // Frontier North
  { city: 'Chicago', name: 'Gale', abbrev: 'CHI', colors: ['#0b162a', '#c83803'], revenue: 629 },
  { city: 'Detroit', name: 'Gears', abbrev: 'DET', colors: ['#0076b6', '#b0b7bc'], revenue: 585 },
  { city: 'Green Bay', name: 'Lumberjacks', abbrev: 'GB', colors: ['#203731', '#ffb612'], revenue: 719 },
  { city: 'Minnesota', name: 'Voyageurs', abbrev: 'MIN', colors: ['#4f2683', '#ffc62f'], revenue: 609 },
  // Frontier South
  { city: 'Atlanta', name: 'Firebirds', abbrev: 'ATL', colors: ['#a71930', '#000000'], revenue: 612 },
  { city: 'Carolina', name: 'Monarchs', abbrev: 'CAR', colors: ['#0085ca', '#101820'], revenue: 588 },
  { city: 'New Orleans', name: 'Krewe', abbrev: 'NO', colors: ['#101820', '#d3bc8d'], revenue: 607 },
  { city: 'Tampa Bay', name: 'Corsairs', abbrev: 'TB', colors: ['#d50a0a', '#34302b'], revenue: 629 },
  // Frontier West
  { city: 'Arizona', name: 'Scorpions', abbrev: 'ARI', colors: ['#97233f', '#000000'], revenue: 571 },
  { city: 'Los Angeles', name: 'Stars', abbrev: 'LAS', colors: ['#003594', '#ffd100'], revenue: 764 },
  { city: 'San Francisco', name: 'Fog', abbrev: 'SF', colors: ['#aa0000', '#b3995d'], revenue: 723 },
  { city: 'Seattle', name: 'Squall', abbrev: 'SEA', colors: ['#002244', '#69be28'], revenue: 624 },
];

/** Nicknames we must never ship (licensed marks), used by tests to guard mod-free defaults. */
export const RESERVED_NICKNAMES = [
  'Bears', 'Bengals', 'Bills', 'Broncos', 'Browns', 'Buccaneers', 'Cardinals', 'Chargers', 'Chiefs', 'Colts',
  'Commanders', 'Cowboys', 'Dolphins', 'Eagles', 'Falcons', '49ers', 'Giants', 'Jaguars', 'Jets', 'Lions',
  'Packers', 'Panthers', 'Patriots', 'Raiders', 'Rams', 'Ravens', 'Saints', 'Seahawks', 'Steelers', 'Texans',
  'Titans', 'Vikings', 'Oilers', 'Redskins',
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
