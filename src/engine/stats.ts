import type { League, Player, StatKey, StatLine } from './types';
import { qualifies, RATES, type RateKey } from './qualify';
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
  /** A rate: only men who've done enough for it in the scope are ranked (`qualify.ts`). */
  rate?: RateKey;
}

const ratio =
  (a: keyof StatLine, b: keyof StatLine, scale = 1) =>
  (s: StatLine) =>
    (s[b] ?? 0) ? ((s[a] ?? 0) / s[b]!) * scale : 0;
const oneDecimal = (v: number) => v.toFixed(1);
const percent = (v: number) => `${v.toFixed(1)}%`;

export const LEADER_CATEGORIES: LeaderCategory[] = [
  { key: 'passYds', label: 'Passing yards', stat: (s) => s.passYds ?? 0 },
  { key: 'passTd', label: 'Passing TD', stat: (s) => s.passTd ?? 0 },
  {
    key: 'rating',
    label: 'Passer rating',
    stat: passerRating,
    format: (v) => v.toFixed(1),
    rate: 'passing',
  },
  { key: 'cmpPct', label: 'Completion %', stat: ratio('passCmp', 'passAtt', 100), format: percent, rate: 'passing' },
  { key: 'ypa', label: 'Yards per attempt', stat: ratio('passYds', 'passAtt'), format: oneDecimal, rate: 'passing' },
  { key: 'rushYds', label: 'Rushing yards', stat: (s) => s.rushYds ?? 0 },
  { key: 'rushTd', label: 'Rushing TD', stat: (s) => s.rushTd ?? 0 },
  { key: 'ypc', label: 'Yards per carry', stat: ratio('rushYds', 'rushAtt'), format: oneDecimal, rate: 'rushing' },
  { key: 'recYds', label: 'Receiving yards', stat: (s) => s.recYds ?? 0 },
  { key: 'rec', label: 'Receptions', stat: (s) => s.rec ?? 0 },
  { key: 'recTd', label: 'Receiving TD', stat: (s) => s.recTd ?? 0 },
  { key: 'ypr', label: 'Yards per catch', stat: ratio('recYds', 'rec'), format: oneDecimal, rate: 'receiving' },
  { key: 'sacks', label: 'Sacks', stat: (s) => s.sacks ?? 0 },
  { key: 'pressures', label: 'Pressures', stat: (s) => s.pressures ?? 0 },
  { key: 'tackles', label: 'Tackles', stat: (s) => s.tackles ?? 0 },
  { key: 'defInt', label: 'Interceptions', stat: (s) => s.defInt ?? 0 },
  { key: 'fgMade', label: 'Field goals', stat: (s) => s.fgMade ?? 0 },
  { key: 'fgPct', label: 'Field goal %', stat: ratio('fgMade', 'fgAtt', 100), format: percent, rate: 'kicking' },
  { key: 'puntAvg', label: 'Punt average', stat: ratio('puntYds', 'punts'), format: oneDecimal, rate: 'punting' },
];

export function leaders(
  league: League,
  category: LeaderCategory,
  limit = 10,
  scope: StatScope = league.season,
): LeaderRow[] {
  const rows: LeaderRow[] = [];
  for (const player of Object.values(league.players)) {
    const line = statLine(player, scope);
    if (!line) continue;
    if (category.rate && !qualifies(league, player, line, scope, RATES[category.rate])) continue;
    const value = category.stat(line);
    if (value > 0) rows.push({ player, value, line });
  }
  return rows.sort((a, b) => b.value - a.value || a.player.id - b.player.id).slice(0, limit);
}

export interface RecordRow extends LeaderRow {
  season: number;
}

/** The best single seasons ever recorded in a category. */
export function seasonRecords(league: League, category: LeaderCategory, limit = 10): RecordRow[] {
  const rows: RecordRow[] = [];
  for (const player of Object.values(league.players)) {
    for (const [season, line] of Object.entries(player.stats)) {
      // Against a whole season, the one under way too: the all-time best are whole seasons.
      if (category.rate && !qualifies(league, player, line, Number(season), RATES[category.rate], { fullSeason: true }))
        continue;
      const value = category.stat(line);
      if (value > 0) rows.push({ player, value, line, season: Number(season) });
    }
  }
  return rows.sort((a, b) => b.value - a.value || a.season - b.season || a.player.id - b.player.id).slice(0, limit);
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

export interface Rec {
  w: number;
  l: number;
  t: number;
}

/** A team's regular season from its box scores: what it scored, gained and turned over, what it gave up, and its splits. */
export interface TeamSeasonLine {
  games: number;
  pointsFor: number;
  pointsAgainst: number;
  yards: number;
  yardsAllowed: number;
  /** Its own turnovers, and the other side's. */
  giveaways: number;
  takeaways: number;
  thirdDownAtt: number;
  thirdDownConv: number;
  /** Times its defense sacked the quarterback. */
  sacks: number;
  home: Rec;
  road: Rec;
  division: Rec;
}

const emptyLine = (): TeamSeasonLine => ({
  games: 0,
  pointsFor: 0,
  pointsAgainst: 0,
  yards: 0,
  yardsAllowed: 0,
  giveaways: 0,
  takeaways: 0,
  thirdDownAtt: 0,
  thirdDownConv: 0,
  sacks: 0,
  home: { w: 0, l: 0, t: 0 },
  road: { w: 0, l: 0, t: 0 },
  division: { w: 0, l: 0, t: 0 },
});

/** Every team's regular-season line, summed from the box scores (kept for the last two seasons). */
export function teamSeasonStats(league: League, season = league.season): Map<number, TeamSeasonLine> {
  const out = new Map(league.teams.map((t) => [t.id, emptyLine()]));
  for (const g of league.games) {
    if (g.season !== season || g.playoffRound || !g.result) continue;
    const r = g.result;
    const sameDivision = league.teams[g.homeId].division === league.teams[g.awayId].division;
    for (const home of [true, false]) {
      const line = out.get(home ? g.homeId : g.awayId)!;
      const [us, them] = home ? [r.homeScore, r.awayScore] : [r.awayScore, r.homeScore];
      const [ours, theirs] = home ? [r.home, r.away] : [r.away, r.home];
      line.games++;
      line.pointsFor += us;
      line.pointsAgainst += them;
      line.yards += ours.totalYds;
      line.yardsAllowed += theirs.totalYds;
      line.giveaways += ours.turnovers;
      line.takeaways += theirs.turnovers;
      line.thirdDownAtt += ours.thirdDownAtt;
      line.thirdDownConv += ours.thirdDownConv;
      line.sacks += theirs.sacked;
      const result = us > them ? 'w' : us < them ? 'l' : 't';
      for (const split of [home ? line.home : line.road, ...(sameDivision ? [line.division] : [])]) split[result]++;
    }
  }
  return out;
}
