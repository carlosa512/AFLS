import type { League, Player, StatKey, StatLine } from './types';
import { MAX_STATS } from './types';

/** One season's regular-season totals, or a whole career's. */
export type StatScope = number | 'career';

/** Adds one stat line into another: counts sum, longest plays keep the max. */
export function addStats(target: StatLine, source: StatLine) {
  for (const [key, value] of Object.entries(source) as [keyof StatLine, number][]) {
    target[key] = MAX_STATS.has(key) ? Math.max(target[key] ?? 0, value) : (target[key] ?? 0) + value;
  }
}

/** A player's regular-season totals across every season he played. */
export function careerLine(p: Player): StatLine {
  const total: StatLine = {};
  for (const line of Object.values(p.stats)) addStats(total, line);
  return total;
}

export function statLine(p: Player, scope: StatScope): StatLine | undefined {
  if (scope !== 'career') return p.stats[scope];
  return Object.keys(p.stats).length ? careerLine(p) : undefined;
}

/** Seasons with any recorded stats, newest first. Players are never deleted, so this reaches back to the first season. */
export function statSeasons(league: League): number[] {
  const seasons = new Set<number>();
  for (const p of Object.values(league.players)) for (const s of Object.keys(p.stats)) seasons.add(Number(s));
  return [...seasons].sort((a, b) => b - a);
}

/** NFL passer rating (0–158.3). */
export function passerRating(s: StatLine): number {
  const att = s.passAtt ?? 0;
  if (!att) return 0;
  const c = (v: number) => Math.max(0, Math.min(2.375, v));
  const a = c(((s.passCmp ?? 0) / att - 0.3) * 5);
  const b = c(((s.passYds ?? 0) / att - 3) * 0.25);
  const t = c(((s.passTd ?? 0) / att) * 20);
  const i = c(2.375 - ((s.passInt ?? 0) / att) * 25);
  return ((a + b + t + i) / 6) * 100;
}

export interface LeaderRow {
  player: Player;
  value: number;
  line: StatLine;
}

export interface LeaderCategory {
  key: string;
  label: string;
  stat: (s: StatLine) => number;
  format?: (v: number) => string;
  /** Minimum qualifier, e.g. attempts. */
  qualifies?: (s: StatLine) => boolean;
}

export const LEADER_CATEGORIES: LeaderCategory[] = [
  { key: 'passYds', label: 'Passing yards', stat: (s) => s.passYds ?? 0 },
  { key: 'passTd', label: 'Passing TD', stat: (s) => s.passTd ?? 0 },
  { key: 'rating', label: 'Passer rating', stat: passerRating, format: (v) => v.toFixed(1), qualifies: (s) => (s.passAtt ?? 0) >= 14 * (s.gp ?? 0) && (s.passAtt ?? 0) > 0 },
  { key: 'rushYds', label: 'Rushing yards', stat: (s) => s.rushYds ?? 0 },
  { key: 'rushTd', label: 'Rushing TD', stat: (s) => s.rushTd ?? 0 },
  { key: 'recYds', label: 'Receiving yards', stat: (s) => s.recYds ?? 0 },
  { key: 'rec', label: 'Receptions', stat: (s) => s.rec ?? 0 },
  { key: 'recTd', label: 'Receiving TD', stat: (s) => s.recTd ?? 0 },
  { key: 'sacks', label: 'Sacks', stat: (s) => s.sacks ?? 0 },
  { key: 'pressures', label: 'Pressures', stat: (s) => s.pressures ?? 0 },
  { key: 'tackles', label: 'Tackles', stat: (s) => s.tackles ?? 0 },
  { key: 'defInt', label: 'Interceptions', stat: (s) => s.defInt ?? 0 },
  { key: 'fgMade', label: 'Field goals', stat: (s) => s.fgMade ?? 0 },
];

export function leaders(league: League, category: LeaderCategory, limit = 10, scope: StatScope = league.season): LeaderRow[] {
  const rows: LeaderRow[] = [];
  for (const player of Object.values(league.players)) {
    const line = statLine(player, scope);
    if (!line) continue;
    if (category.qualifies && !category.qualifies(line)) continue;
    const value = category.stat(line);
    if (value > 0) rows.push({ player, value, line });
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, limit);
}

export interface RecordRow extends LeaderRow {
  season: number;
}

/** The best single seasons ever recorded in a category. */
export function seasonRecords(league: League, category: LeaderCategory, limit = 10): RecordRow[] {
  const rows: RecordRow[] = [];
  for (const player of Object.values(league.players)) {
    for (const [season, line] of Object.entries(player.stats)) {
      if (category.qualifies && !category.qualifies(line)) continue;
      const value = category.stat(line);
      if (value > 0) rows.push({ player, value, line, season: Number(season) });
    }
  }
  return rows.sort((a, b) => b.value - a.value || a.season - b.season).slice(0, limit);
}

/** Team's leader in a stat this season (players currently on the team). */
export function teamLeader(league: League, teamId: number, key: StatKey, season = league.season): LeaderRow | null {
  let best: LeaderRow | null = null;
  for (const player of Object.values(league.players)) {
    if (player.teamId !== teamId) continue;
    const line = player.stats[season];
    const value = line?.[key] ?? 0;
    if (line && value > 0 && (!best || value > best.value)) best = { player, value, line };
  }
  return best;
}
