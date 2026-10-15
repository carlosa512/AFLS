/**
 * Default league: the 32 real NFL markets and divisional alignment, with
 * original nicknames, colours and conference names so the game ships without
 * licensed marks. Players can replace this data with a mod file.
 */
export interface TeamSeed {
  city: string;
  name: string;
  abbrev: string;
  colors: [string, string];
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
  { city: 'Buffalo', name: 'Blizzard', abbrev: 'BUF', colors: ['#0d2240', '#9cc3e6'] },
  { city: 'Miami', name: 'Barracudas', abbrev: 'MIA', colors: ['#00838f', '#ff7f50'] },
  { city: 'New England', name: 'Admirals', abbrev: 'NE', colors: ['#0b2a5b', '#c9a227'] },
  { city: 'New York', name: 'Knights', abbrev: 'NYK', colors: ['#1d1d1f', '#8a8d91'] },
  // Liberty North
  { city: 'Baltimore', name: 'Clippers', abbrev: 'BAL', colors: ['#14365d', '#e4572e'] },
  { city: 'Cincinnati', name: 'Steamers', abbrev: 'CIN', colors: ['#3a1f14', '#e8a33d'] },
  { city: 'Cleveland', name: 'Hammers', abbrev: 'CLE', colors: ['#4a2511', '#f08a24'] },
  { city: 'Pittsburgh', name: 'Forge', abbrev: 'PIT', colors: ['#2b2b2b', '#e36414'] },
  // Liberty South
  { city: 'Houston', name: 'Wildcatters', abbrev: 'HOU', colors: ['#3a0f0f', '#e5a823'] },
  { city: 'Indianapolis', name: 'Racers', abbrev: 'IND', colors: ['#111111', '#e10600'] },
  { city: 'Jacksonville', name: 'Tarpons', abbrev: 'JAX', colors: ['#005f73', '#94d2bd'] },
  { city: 'Tennessee', name: 'Outlaws', abbrev: 'TEN', colors: ['#3b2a20', '#d4a017'] },
  // Liberty West
  { city: 'Denver', name: 'Summit', abbrev: 'DEN', colors: ['#16324f', '#e87722'] },
  { city: 'Kansas City', name: 'Marshals', abbrev: 'KC', colors: ['#1c2841', '#c5b358'] },
  { city: 'Las Vegas', name: 'Mirage', abbrev: 'LV', colors: ['#141414', '#d4af37'] },
  { city: 'Los Angeles', name: 'Condors', abbrev: 'LAC', colors: ['#2a1a5e', '#f7b801'] },
  // Frontier East
  { city: 'Dallas', name: 'Stampede', abbrev: 'DAL', colors: ['#24324a', '#b8c4d6'] },
  { city: 'New York', name: 'Empire', abbrev: 'NYE', colors: ['#1b2f6b', '#d64545'] },
  { city: 'Philadelphia', name: 'Founders', abbrev: 'PHI', colors: ['#5a1f2b', '#e8d5a8'] },
  { city: 'Washington', name: 'Sentinels', abbrev: 'WAS', colors: ['#2e3a59', '#b31b1b'] },
  // Frontier North
  { city: 'Chicago', name: 'Gale', abbrev: 'CHI', colors: ['#002f6c', '#d22630'] },
  { city: 'Detroit', name: 'Gears', abbrev: 'DET', colors: ['#2f4858', '#86bbd8'] },
  { city: 'Green Bay', name: 'Lumberjacks', abbrev: 'GB', colors: ['#234d20', '#c0392b'] },
  { city: 'Minnesota', name: 'Voyageurs', abbrev: 'MIN', colors: ['#2c2a6b', '#f4c430'] },
  // Frontier South
  { city: 'Atlanta', name: 'Firebirds', abbrev: 'ATL', colors: ['#b3261e', '#f2a541'] },
  { city: 'Carolina', name: 'Monarchs', abbrev: 'CAR', colors: ['#3d1a6e', '#38b2ac'] },
  { city: 'New Orleans', name: 'Krewe', abbrev: 'NO', colors: ['#4b2e83', '#2bb24c'] },
  { city: 'Tampa Bay', name: 'Corsairs', abbrev: 'TB', colors: ['#7a1e1e', '#9aa5b1'] },
  // Frontier West
  { city: 'Arizona', name: 'Scorpions', abbrev: 'ARI', colors: ['#8c2f1b', '#f2c14e'] },
  { city: 'Los Angeles', name: 'Stars', abbrev: 'LAS', colors: ['#1e3d59', '#f5c518'] },
  { city: 'San Francisco', name: 'Fog', abbrev: 'SF', colors: ['#3c4f5c', '#f26a4f'] },
  { city: 'Seattle', name: 'Squall', abbrev: 'SEA', colors: ['#0e3b43', '#7ac74f'] },
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
