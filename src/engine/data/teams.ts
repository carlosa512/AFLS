/**
 * Default fictional league structure. All names are original so the game
 * ships without licensing; players can replace this data with a mod file.
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
  { name: 'Liberty North', conference: 0 },
  { name: 'Liberty East', conference: 0 },
  { name: 'Liberty South', conference: 0 },
  { name: 'Liberty Central', conference: 0 },
  { name: 'Frontier North', conference: 1 },
  { name: 'Frontier South', conference: 1 },
  { name: 'Frontier Mountain', conference: 1 },
  { name: 'Frontier Pacific', conference: 1 },
];

/** 32 teams, four per division in DIVISIONS order. */
export const TEAM_SEEDS: TeamSeed[] = [
  // Liberty North
  { city: 'Boston', name: 'Admirals', abbrev: 'BOS', colors: ['#0b2a5b', '#c9a227'] },
  { city: 'New York', name: 'Knights', abbrev: 'NYK', colors: ['#1d1d1f', '#8a8d91'] },
  { city: 'Philadelphia', name: 'Founders', abbrev: 'PHI', colors: ['#5a1f2b', '#e8d5a8'] },
  { city: 'Pittsburgh', name: 'Forge', abbrev: 'PIT', colors: ['#2b2b2b', '#e36414'] },
  // Liberty East
  { city: 'Baltimore', name: 'Clippers', abbrev: 'BAL', colors: ['#14365d', '#e4572e'] },
  { city: 'Washington', name: 'Sentinels', abbrev: 'WAS', colors: ['#2e3a59', '#b31b1b'] },
  { city: 'Charlotte', name: 'Monarchs', abbrev: 'CHA', colors: ['#3d1a6e', '#38b2ac'] },
  { city: 'Raleigh', name: 'Oaks', abbrev: 'RAL', colors: ['#1f4d2b', '#c4a35a'] },
  // Liberty South
  { city: 'Atlanta', name: 'Firebirds', abbrev: 'ATL', colors: ['#b3261e', '#f2a541'] },
  { city: 'Miami', name: 'Barracudas', abbrev: 'MIA', colors: ['#00838f', '#ff7f50'] },
  { city: 'Orlando', name: 'Comets', abbrev: 'ORL', colors: ['#1b3a8c', '#ffd23f'] },
  { city: 'Nashville', name: 'Outlaws', abbrev: 'NSH', colors: ['#3b2a20', '#d4a017'] },
  // Liberty Central
  { city: 'Cleveland', name: 'Hammers', abbrev: 'CLE', colors: ['#4a2511', '#f08a24'] },
  { city: 'Detroit', name: 'Gears', abbrev: 'DET', colors: ['#2f4858', '#86bbd8'] },
  { city: 'Columbus', name: 'Explorers', abbrev: 'CLB', colors: ['#8b0000', '#a7a9ac'] },
  { city: 'Indianapolis', name: 'Racers', abbrev: 'IND', colors: ['#111111', '#e10600'] },
  // Frontier North
  { city: 'Chicago', name: 'Blizzard', abbrev: 'CHI', colors: ['#0d2240', '#9cc3e6'] },
  { city: 'Minneapolis', name: 'Lumberjacks', abbrev: 'MIN', colors: ['#234d20', '#c0392b'] },
  { city: 'Milwaukee', name: 'Thunder', abbrev: 'MIL', colors: ['#2c2a6b', '#f4c430'] },
  { city: 'St. Louis', name: 'Archers', abbrev: 'STL', colors: ['#002f6c', '#d22630'] },
  // Frontier South
  { city: 'Dallas', name: 'Marshals', abbrev: 'DAL', colors: ['#1c2841', '#c5b358'] },
  { city: 'Houston', name: 'Wildcatters', abbrev: 'HOU', colors: ['#3a0f0f', '#e5a823'] },
  { city: 'San Antonio', name: 'Lancers', abbrev: 'SAN', colors: ['#2d2d2d', '#00a19a'] },
  { city: 'New Orleans', name: 'Krewe', abbrev: 'NOL', colors: ['#4b2e83', '#2bb24c'] },
  // Frontier Mountain
  { city: 'Denver', name: 'Summit', abbrev: 'DEN', colors: ['#16324f', '#e87722'] },
  { city: 'Phoenix', name: 'Scorpions', abbrev: 'PHX', colors: ['#7a1e1e', '#f2c14e'] },
  { city: 'Las Vegas', name: 'Mirage', abbrev: 'LV', colors: ['#141414', '#d4af37'] },
  { city: 'Salt Lake', name: 'Pioneers', abbrev: 'SLC', colors: ['#1e3d59', '#f5f0e1'] },
  // Frontier Pacific
  { city: 'Los Angeles', name: 'Condors', abbrev: 'LA', colors: ['#2a1a5e', '#f7b801'] },
  { city: 'San Francisco', name: 'Fog', abbrev: 'SF', colors: ['#3c4f5c', '#f26a4f'] },
  { city: 'Seattle', name: 'Squall', abbrev: 'SEA', colors: ['#0e3b43', '#7ac74f'] },
  { city: 'Portland', name: 'Cascades', abbrev: 'POR', colors: ['#1b4332', '#95d5b2'] },
];
