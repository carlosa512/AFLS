import type { League, Player, StatKey, StatLine } from './types';

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
  { key: 'tackles', label: 'Tackles', stat: (s) => s.tackles ?? 0 },
  { key: 'defInt', label: 'Interceptions', stat: (s) => s.defInt ?? 0 },
  { key: 'fgMade', label: 'Field goals', stat: (s) => s.fgMade ?? 0 },
];

export function leaders(league: League, category: LeaderCategory, limit = 10, season = league.season): LeaderRow[] {
  const rows: LeaderRow[] = [];
  for (const player of Object.values(league.players)) {
    const line = player.stats[season];
    if (!line) continue;
    if (category.qualifies && !category.qualifies(line)) continue;
    const value = category.stat(line);
    if (value > 0) rows.push({ player, value, line });
  }
  return rows.sort((a, b) => b.value - a.value).slice(0, limit);
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
