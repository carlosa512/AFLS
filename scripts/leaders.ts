/** Season-leader targets shared by `npm run sim` (fresh leagues) and `npm run careers` (aged ones). */
import type { League, Position, StatKey } from '../src/engine/types';

/**
 * The top of the league, not just its averages: a league can sit on NFL means while one back runs
 * for 2,500 yards. Ranges come from the NFL's 2010–2024 regular-season leaders (Pro Football
 * Reference), with the 16-game seasons (2010–2020) scaled to this league's 17: `first` and `fifth`
 * bound the average #1 and #5 over the seasons simulated. `ceiling` is the single-season record:
 * all-time for yards, receptions and sacks (rushing 2,105, passing 5,477, receiving 1,964, 149
 * catches, 22.5 sacks), the best since 2010 for touchdowns and interceptions (55 passing, 18
 * receiving, 18 rushing in 16 games, so 19 over 17; 11 picks). A leader past it may happen, but
 * rarely: about one season in fifteen (see `overRecordAllowed`).
 */
export const LEADER_TARGETS: {
  key: StatKey;
  label: string;
  first: [number, number];
  fifth: [number, number];
  ceiling: number;
  pos?: Position;
}[] = [
  { key: 'passYds', label: 'passing yds', first: [4750, 5350], fifth: [4300, 4800], ceiling: 5477 },
  { key: 'passTd', label: 'passing TD', first: [37, 48], fifth: [28, 35], ceiling: 55 },
  { key: 'rushYds', label: 'rushing yds', first: [1550, 1900], fifth: [1150, 1400], ceiling: 2105 },
  // Quarterbacks: Lamar Jackson's 1,206 (2019) is the record; a typical leader runs for about 800.
  { key: 'rushYds', label: 'QB rushing yds', pos: 'QB', first: [650, 1000], fifth: [400, 650], ceiling: 1206 },
  { key: 'rushTd', label: 'rushing TD', first: [13.5, 19], fifth: [10, 13], ceiling: 19 },
  { key: 'recYds', label: 'receiving yds', first: [1550, 1900], fifth: [1300, 1500], ceiling: 1964 },
  { key: 'rec', label: 'receptions', first: [117, 146], fifth: [100, 117], ceiling: 149 },
  { key: 'recTd', label: 'receiving TD', first: [13, 18], fifth: [9.5, 12.5], ceiling: 18 },
  { key: 'sacks', label: 'sacks', first: [15.5, 21.5], fifth: [12.5, 15.5], ceiling: 22.5 },
  { key: 'defInt', label: 'interceptions', first: [7, 10.5], fifth: [5, 6.5], ceiling: 11 },
];

/**
 * Seasons a leader may pass the record in `seasons` played: one in fifteen, plus one standard
 * deviation of luck (a league that's right on the NFL's rate still has unlucky stretches).
 */
export const overRecordAllowed = (seasons: number) => Math.round(seasons / 15 + Math.sqrt(seasons / 15));

/** Each target's top five in one season, by label. */
export function seasonTops(league: League, season: number): Record<string, number[]> {
  const players = Object.values(league.players);
  return Object.fromEntries(
    LEADER_TARGETS.map(({ key, label, pos }) => [
      label,
      players
        .filter((p) => !pos || p.position === pos)
        .map((p) => p.stats[season]?.[key] ?? 0)
        .sort((a, b) => b - a)
        .slice(0, 5),
    ]),
  );
}
