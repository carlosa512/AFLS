/** The NFL ranges `npm run sim` holds the league to; `npm run parity` holds the spatial engine's rebuilt numbers to them. */
// Approximate recent NFL per-team-game averages.
export const TARGETS: Record<string, [number, number]> = {
  points: [21.5, 23.5],
  plays: [61, 65],
  totalYds: [315, 345],
  passAtt: [32, 35],
  cmpPct: [63, 66.5],
  passYdsGross: [215, 235],
  ypa: [6.7, 7.3],
  sacks: [2.1, 2.6],
  rushAtt: [26, 29],
  ypc: [4.1, 4.5],
  passTd: [1.3, 1.6],
  rushTd: [0.8, 1.0],
  int: [0.65, 0.85],
  fumblesLost: [0.35, 0.55],
  firstDowns: [18.5, 20.5],
  thirdDownPct: [37, 41],
  // Drives that snap a play at the 20 or inside, and the share of them that end in a touchdown, counted the way the
  // engine counts them from nflverse's play-by-play: 3.30, 3.62, 3.45, 3.25, 3.25 and 3.39 trips a team-game in
  // 2019–24 (2020, the year without crowds, the outlier), 54.7–60.8% of them touchdowns. TeamRankings' 3.2 (2025)
  // counts differently.
  redZoneTrips: [3.2, 3.5],
  redZonePct: [50, 60],
  fgAtt: [1.6, 2.0],
  // Fourth-down tries a team-game (NFL 2023: 1.47, 2024: 1.40; UW–Madison's season recaps).
  fourthAtt: [1.3, 1.6],
  fgPct: [83, 88],
  punts: [3.6, 4.4],
  penalties: [5.5, 7],
  // Flags the other side declined, and flags that offset (NFL 2023–25: 0.87 and about 0.27 per team-game
  // across every foul; the five the engine calls so far draw about 0.55 declines, its inflated line fouls
  // a little more until the rest are modeled; see docs/PENALTIES.md).
  declined: [0.45, 1],
  offsetting: [0.05, 0.4],
  // Personal fouls by the defense on scrimmage plays (NFL 2023–25: about 0.6 per team-game once kicks
  // and the offense's share are set aside), and roughing the passer alone (0.17).
  personal: [0.45, 0.8],
  roughing: [0.12, 0.22],
  // Special-teams flags the engine calls (blocks on returns, kickoff misses and alignment, kick-catch
  // interference, fouls on the punter): NFL 2023–25 special teams drew 0.88 per team-game in all, about
  // 0.6 of it these kinds.
  special: [0.45, 0.8],
  homeWinPct: [53, 57],
  otPct: [4, 7],
  tiePct: [0, 0.6],
};
