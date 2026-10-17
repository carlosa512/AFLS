/**
 * Season awards, voted the way the press votes: on the season's numbers and on how the team did.
 * Only box-score stats and standings go in, never ratings, so an award is something the user could
 * have argued for from the stat sheet. The seeded Rng only breaks exact ties.
 */
import { Rng } from './rng';
import { regularSeasonGames } from './season/standings';
import { addStats, passerRating } from './stats';
import type { League, Player, Position, StatLine } from './types';

export type AwardKey = 'mvp' | 'opoy' | 'dpoy' | 'oroy' | 'droy' | 'comeback';

export const AWARD_NAMES: Record<AwardKey, string> = {
  mvp: 'Most Valuable Player',
  opoy: 'Offensive Player of the Year',
  dpoy: 'Defensive Player of the Year',
  oroy: 'Offensive Rookie of the Year',
  droy: 'Defensive Rookie of the Year',
  comeback: 'Comeback Player of the Year',
};

export const AWARD_SHORT: Record<AwardKey, string> = { mvp: 'MVP', opoy: 'OPOY', dpoy: 'DPOY', oroy: 'OROY', droy: 'DROY', comeback: 'Comeback' };

export const AWARD_KEYS = Object.keys(AWARD_NAMES) as AwardKey[];

/** All-League team slots, like the All-Pro ballot (offense, defense, specialists). */
export const ALL_LEAGUE_SLOTS: [Position, number][] = [
  ['QB', 1], ['RB', 1], ['WR', 3], ['TE', 1], ['OL', 5],
  ['EDGE', 2], ['DT', 2], ['LB', 2], ['CB', 2], ['S', 2],
  ['K', 1], ['P', 1],
];

export interface AwardWinner {
  playerId: number;
  /** The club he played for that season (most games), or null if it can no longer be told. */
  teamId: number | null;
}

export interface SeasonAwards {
  season: number;
  /** A key is missing when nobody qualified (a first season has no comeback). */
  winners: Partial<Record<AwardKey, AwardWinner>>;
  /** First and second All-League teams, each in `ALL_LEAGUE_SLOTS` order. */
  allLeague: [AwardWinner[], AwardWinner[]];
}

const OFFENSE: ReadonlySet<Position> = new Set(['QB', 'RB', 'WR', 'TE']);
const DEFENSE: ReadonlySet<Position> = new Set(['DT', 'EDGE', 'LB', 'CB', 'S']);
/** Games a player must appear in to get votes. */
const MIN_GAMES = 10;
const v = (s: StatLine, k: keyof StatLine) => s[k] ?? 0;

/** Yards and touchdowns, the way a ballot reads them. */
export function offenseScore(s: StatLine): number {
  return (
    v(s, 'passYds') / 25 + v(s, 'passTd') * 4 - v(s, 'passInt') * 2.5 +
    v(s, 'rushYds') / 10 + v(s, 'rushTd') * 6 +
    v(s, 'recYds') / 10 + v(s, 'recTd') * 6 + v(s, 'rec') * 0.5 -
    v(s, 'fumblesLost') * 2
  );
}

/** Splash plays first (sacks, takeaways): voters crown pass rushers, not tackle totals. */
export function defenseScore(s: StatLine): number {
  return (
    v(s, 'sacks') * 5 + v(s, 'defInt') * 5.5 + v(s, 'passDef') + v(s, 'forcedFum') * 3 +
    v(s, 'fumRec') * 2 + v(s, 'tfl') * 1.5 + v(s, 'tackles') * 0.2 + v(s, 'defTd') * 6
  );
}

/** A quarterback's efficiency on top of his volume: voters reward a 110 rating over a 85 one. */
const qbBonus = (s: StatLine) => ((v(s, 'passAtt') >= 200 ? passerRating(s) : 80) - 92) * 1.2;

/** A defender's score on the offense's scale, so a comeback can be judged across the ball. */
const DEFENSE_SCALE = 2.4;

/** One position's case for the All-League team. Linemen have no stats: their team's line does (see `lineScores`). */
function positionScore(pos: Position, s: StatLine): number {
  switch (pos) {
    case 'QB':
      return offenseScore(s) + qbBonus(s);
    case 'RB':
      return v(s, 'rushYds') / 10 + v(s, 'rushTd') * 6 + v(s, 'recYds') / 10 + v(s, 'recTd') * 6 - v(s, 'fumblesLost') * 2;
    case 'WR':
    case 'TE':
      return v(s, 'recYds') / 10 + v(s, 'recTd') * 6 + v(s, 'rec') * 0.5 - v(s, 'fumblesLost') * 2;
    case 'DT':
    case 'EDGE':
      return v(s, 'sacks') * 4.5 + v(s, 'tfl') * 1.5 + v(s, 'tackles') * 0.35 + v(s, 'forcedFum') * 3 + v(s, 'fumRec') * 2 + v(s, 'defTd') * 6;
    case 'LB':
      return v(s, 'tackles') * 0.5 + v(s, 'tfl') * 1.5 + v(s, 'sacks') * 4 + v(s, 'defInt') * 5 + v(s, 'passDef') + v(s, 'forcedFum') * 3 + v(s, 'defTd') * 6;
    case 'CB':
      return v(s, 'defInt') * 6 + v(s, 'passDef') * 2 + v(s, 'tackles') * 0.25 + v(s, 'forcedFum') * 2 + v(s, 'defTd') * 6;
    case 'S':
      return v(s, 'defInt') * 6 + v(s, 'passDef') * 1.5 + v(s, 'tackles') * 0.4 + v(s, 'forcedFum') * 2 + v(s, 'defTd') * 6;
    case 'K':
      return v(s, 'fgAtt') < 15 ? 0 : v(s, 'fgMade') * 3 - (v(s, 'fgAtt') - v(s, 'fgMade')) * 4 + v(s, 'fgLong') / 10 + v(s, 'xpMade') * 0.5 - (v(s, 'xpAtt') - v(s, 'xpMade')) * 2;
    case 'P':
      return v(s, 'punts') < 30 ? 0 : (v(s, 'puntYds') / v(s, 'punts')) * 3;
    default:
      return 0;
  }
}

/** What a season meant, on one scale: offense as is, defense stretched to match. */
function impact(p: Player, s: StatLine): number {
  if (OFFENSE.has(p.position)) return offenseScore(s);
  if (DEFENSE.has(p.position)) return defenseScore(s) * DEFENSE_SCALE;
  return 0;
}

/** The league year a player was a rookie: his draft year, or for undrafted players the year he had no experience. */
export function rookieSeason(league: League, p: Player): number {
  if (p.draft) return p.draft.season;
  const seasons = Object.keys(p.stats).map(Number);
  // A retired player's experience ticked once more in the offseason he retired.
  const ref = p.retired && seasons.length ? Math.max(...seasons) + 1 : league.season;
  return ref - p.experience;
}

interface SeasonContext {
  season: number;
  /** Player id → club (most regular-season games), when the box scores are still kept. */
  teamOf: Map<number, number>;
  /** Team id → regular-season win share (ties count half). */
  winPct: Map<number, number>;
  /** Team id → how its offensive line did (0 = league average), when the box scores are kept. */
  line: Map<number, number>;
}

function seasonContext(league: League, season: number): SeasonContext {
  const games = regularSeasonGames(league, season).filter((g) => g.result);
  const counts = new Map<number, Map<number, number>>();
  const wins = new Map<number, [number, number]>();
  const team = new Map<number, { rushYds: number; rushAtt: number; sacked: number; drop: number; pts: number; g: number }>();
  for (const g of games) {
    const r = g.result!;
    for (const [id, teamId] of Object.entries(r.playerTeams)) {
      const c = counts.get(Number(id)) ?? new Map<number, number>();
      c.set(teamId, (c.get(teamId) ?? 0) + 1);
      counts.set(Number(id), c);
    }
    for (const [id, own, opp, st] of [
      [g.homeId, r.homeScore, r.awayScore, r.home],
      [g.awayId, r.awayScore, r.homeScore, r.away],
    ] as const) {
      const w = wins.get(id) ?? [0, 0];
      w[0] += own > opp ? 1 : own === opp ? 0.5 : 0;
      w[1]++;
      wins.set(id, w);
      const t = team.get(id) ?? { rushYds: 0, rushAtt: 0, sacked: 0, drop: 0, pts: 0, g: 0 };
      t.rushYds += st.rushYds;
      t.rushAtt += st.rushAtt;
      t.sacked += st.sacked;
      t.drop += st.passAtt + st.sacked;
      t.pts += own;
      t.g++;
      team.set(id, t);
    }
  }
  const teamOf = new Map<number, number>();
  for (const [id, c] of counts) teamOf.set(id, [...c].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0]);

  const winPct = new Map<number, number>();
  if (wins.size) for (const [id, [w, n]] of wins) winPct.set(id, w / n);
  else {
    // Older seasons keep only the final standings.
    const rec = league.history.find((h) => h.season === season)?.records ?? {};
    for (const [id, r] of Object.entries(rec)) winPct.set(Number(id), (r.w + r.t / 2) / Math.max(1, r.w + r.l + r.t));
  }

  // A line opens holes, keeps the quarterback clean and moves the chains.
  const line = new Map<number, number>();
  for (const [id, t] of team) {
    line.set(id, (t.rushYds / Math.max(1, t.rushAtt) - 4.3) * 25 + (0.065 - t.sacked / Math.max(1, t.drop)) * 500 + (t.pts / t.g - 22) * 1.5);
  }
  return { season, teamOf, winPct, line };
}

/** A team's line in one season, for the All-League table: yards per carry and sacks allowed (null once the box scores are gone). */
export function lineStats(league: League, season: number, teamId: number): { ypc: number; sacked: number } | null {
  let rushYds = 0;
  let rushAtt = 0;
  let sacked = 0;
  for (const g of regularSeasonGames(league, season)) {
    const st = g.homeId === teamId ? g.result!.home : g.awayId === teamId ? g.result!.away : null;
    if (!st) continue;
    rushYds += st.rushYds;
    rushAtt += st.rushAtt;
    sacked += st.sacked;
  }
  return rushAtt ? { ypc: rushYds / rushAtt, sacked } : null;
}

/** Club for a past season: the box scores if kept, else his current team if he was signed by then. */
function clubOf(ctx: SeasonContext, p: Player): number | null {
  const known = ctx.teamOf.get(p.id);
  if (known !== undefined) return known;
  if (p.teamId !== null && p.contract && p.contract.signedSeason <= ctx.season) return p.teamId;
  return null;
}

interface Candidate {
  player: Player;
  line: StatLine;
  teamId: number | null;
  winPct: number;
}

/**
 * Picks every award for a finished regular season. Pure: reads stats and standings, writes nothing.
 * `awardSeason` stores the result.
 */
export function pickAwards(league: League, season: number): SeasonAwards {
  const ctx = seasonContext(league, season);
  const candidates: Candidate[] = [];
  for (const player of Object.values(league.players)) {
    const line = player.stats[season];
    if (!line || v(line, 'gp') === 0) continue;
    const teamId = clubOf(ctx, player);
    candidates.push({ player, line, teamId, winPct: teamId === null ? 0.5 : (ctx.winPct.get(teamId) ?? 0.5) });
  }

  const tiebreak = new Map<number, number>();
  const tie = (id: number) => {
    if (!tiebreak.has(id)) tiebreak.set(id, new Rng(`${league.seed}:awards:${season}:${id}`).next());
    return tiebreak.get(id)!;
  };
  const best = (pool: Candidate[], score: (c: Candidate) => number): Candidate[] =>
    pool
      .map((c) => ({ c, s: score(c) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || tie(a.c.player.id) - tie(b.c.player.id))
      .map((x) => x.c);
  const win = (c: Candidate | undefined): AwardWinner | undefined => (c ? { playerId: c.player.id, teamId: c.teamId } : undefined);

  const regulars = candidates.filter((c) => v(c.line, 'gp') >= MIN_GAMES);
  const offense = regulars.filter((c) => OFFENSE.has(c.player.position));
  const defense = regulars.filter((c) => DEFENSE.has(c.player.position));
  const rookie = (c: Candidate) => rookieSeason(league, c.player) === season;

  const winners: SeasonAwards['winners'] = {};
  // MVP: the best player on a winner. Quarterbacks run the offense, so their efficiency counts too.
  winners.mvp = win(
    best(regulars, (c) => {
      const base = c.player.position === 'QB' ? offenseScore(c.line) * 1.35 + qbBonus(c.line) : OFFENSE.has(c.player.position) ? offenseScore(c.line) : defenseScore(c.line) * 1.9;
      return base * (0.4 + 1.2 * c.winPct);
    })[0],
  );
  // Offensive Player of the Year goes to the season that towers over its position (a back's
  // yards and a receiver's aren't the same currency), and voters spread the honors: the MVP
  // rarely takes it too.
  const group = (pos: Position) => (pos === 'TE' ? 'WR' : pos);
  const peers = new Map<Position, number>();
  for (const pos of ['QB', 'RB', 'WR'] as const) {
    const top = offense.filter((c) => group(c.player.position) === pos).map((c) => offenseScore(c.line)).sort((a, b) => b - a).slice(0, 5);
    peers.set(pos, top.reduce((a, b) => a + b, 0) / Math.max(1, top.length));
  }
  winners.opoy = win(
    best(
      offense.filter((c) => c.player.id !== winners.mvp?.playerId),
      (c) => (offenseScore(c.line) / Math.max(1, peers.get(group(c.player.position))!)) * (0.8 + 0.4 * c.winPct),
    )[0],
  );
  winners.dpoy = win(best(defense, (c) => defenseScore(c.line) * (0.85 + 0.3 * c.winPct))[0]);
  winners.oroy = win(best(offense.filter(rookie), (c) => offenseScore(c.line) * (0.9 + 0.2 * c.winPct))[0]);
  winners.droy = win(best(defense.filter(rookie), (c) => defenseScore(c.line) * (0.9 + 0.2 * c.winPct))[0]);

  // Comeback: good before, lost a season (or most of one), good again.
  winners.comeback = win(
    best(
      regulars.filter((c) => !rookie(c)),
      (c) => {
        const now = impact(c.player, c.line);
        const prevLine = c.player.stats[season - 1];
        const prev = prevLine ? impact(c.player, prevLine) : 0;
        const earlier = Object.entries(c.player.stats)
          .filter(([s]) => Number(s) < season - 1)
          .map(([, l]) => impact(c.player, l));
        const peak = Math.max(0, ...earlier);
        if (now < 150 || prev > 0.5 * now || peak < 0.75 * now) return 0;
        return (now - prev) * (0.9 + 0.2 * c.winPct);
      },
    )[0],
  );
  for (const k of AWARD_KEYS) if (!winners[k]) delete winners[k];

  // All-League: the best at each spot; no team puts more than two linemen on the ballot.
  const teams: [AwardWinner[], AwardWinner[]] = [[], []];
  const linemen = new Map<number | null, number>();
  for (const [pos, count] of ALL_LEAGUE_SLOTS) {
    const pool = (pos === 'K' || pos === 'P' ? candidates : regulars).filter((c) => c.player.position === pos);
    const ranked = best(pool, (c) => {
      if (pos === 'OL') return c.teamId === null ? 0 : 100 + (ctx.line.get(c.teamId) ?? (c.winPct - 0.5) * 40) + v(c.line, 'gp');
      return positionScore(pos, c.line) * (0.9 + 0.2 * c.winPct);
    });
    for (const squad of teams) {
      let taken = 0;
      for (const c of ranked) {
        if (taken === count) break;
        if (teams.some((t) => t.some((w) => w.playerId === c.player.id))) continue;
        if (pos === 'OL') {
          if ((linemen.get(c.teamId) ?? 0) >= 2) continue;
          linemen.set(c.teamId, (linemen.get(c.teamId) ?? 0) + 1);
        }
        squad.push(win(c)!);
        taken++;
      }
    }
  }
  return { season, winners, allLeague: teams };
}

/** Votes the season's awards and files them (once per season). */
export function awardSeason(league: League, season = league.season): SeasonAwards {
  const existing = league.awards.find((a) => a.season === season);
  if (existing) return existing;
  const awards = pickAwards(league, season);
  league.awards.push(awards);
  league.awards.sort((a, b) => a.season - b.season);
  return awards;
}

export function seasonAwards(league: League, season: number): SeasonAwards | undefined {
  return league.awards.find((a) => a.season === season);
}

// ───────── players of the week and month ─────────

export type MonthKey = 'sep' | 'oct' | 'nov' | 'dec';

/** The regular season by calendar month: weeks 1–4 are September, 14–18 December into January. */
export const MONTHS: { key: MonthKey; label: string; weeks: [number, number] }[] = [
  { key: 'sep', label: 'September', weeks: [1, 4] },
  { key: 'oct', label: 'October', weeks: [5, 8] },
  { key: 'nov', label: 'November', weeks: [9, 13] },
  { key: 'dec', label: 'December/January', weeks: [14, 18] },
];

/**
 * One season's players of the week and month. Each list holds four winners, in `HONOR_SLOTS`
 * order (first conference offense, first conference defense, then the second conference's); null
 * if no one qualified.
 * Only winners are kept: the box scores they come from are dropped a year later.
 */
export interface WeeklyAwards {
  season: number;
  weeks: Record<number, (AwardWinner | null)[]>;
  months: Partial<Record<MonthKey, (AwardWinner | null)[]>>;
}

export const HONOR_SLOTS: { conference: number; side: 'offense' | 'defense' }[] = [
  { conference: 0, side: 'offense' },
  { conference: 0, side: 'defense' },
  { conference: 1, side: 'offense' },
  { conference: 1, side: 'defense' },
];

/** How much more a quarterback's yards and touchdowns count toward a weekly or monthly honor. */
const QB_WEEKLY = 1.4;

/** The month whose last week this is, if any. */
export const monthEnding = (week: number) => MONTHS.find((m) => m.weeks[1] === week);

/**
 * Picks the best offensive and defensive player in each conference over a run of weeks: the most
 * productive line, a bit more for winning (weekly honors almost always go to winners). Pure.
 */
export function pickPeriod(league: League, season: number, weeks: [number, number]): (AwardWinner | null)[] {
  const games = regularSeasonGames(league, season).filter((g) => g.week >= weeks[0] && g.week <= weeks[1]);
  const lines = new Map<number, { line: StatLine; teamId: number; won: number; played: number }>();
  for (const g of games) {
    const r = g.result!;
    for (const [id, stat] of Object.entries(r.playerStats)) {
      const teamId = r.playerTeams[Number(id)];
      if (teamId === undefined) continue;
      const own = teamId === g.homeId ? r.homeScore : r.awayScore;
      const opp = teamId === g.homeId ? r.awayScore : r.homeScore;
      const e = lines.get(Number(id)) ?? { line: {}, teamId, won: 0, played: 0 };
      addStats(e.line, stat);
      e.teamId = teamId;
      e.won += own > opp ? 1 : own === opp ? 0.5 : 0;
      e.played++;
      lines.set(Number(id), e);
    }
  }
  // A week needs its one game; a month all but one of its games (a bye week).
  const minGames = Math.max(1, weeks[1] - weeks[0]);
  const tie = (id: number) => new Rng(`${league.seed}:honors:${season}:${weeks[0]}:${id}`).next();
  return HONOR_SLOTS.map(({ conference, side }) => {
    let best: { id: number; teamId: number; score: number } | null = null;
    for (const [id, e] of lines) {
      const p = league.players[id];
      if (!p || league.teams[e.teamId].conference !== conference || e.played < minGames) continue;
      if (!(side === 'offense' ? OFFENSE : DEFENSE).has(p.position)) continue;
      // A big passing day is the headline: quarterbacks win most offensive weekly honors.
      const base = side === 'defense' ? defenseScore(e.line) : p.position === 'QB' ? offenseScore(e.line) * QB_WEEKLY + qbBonus(e.line) * 0.5 : offenseScore(e.line);
      const score = base * (0.8 + 0.4 * (e.won / e.played));
      if (score <= 0) continue;
      if (!best || score > best.score || (score === best.score && tie(id) < tie(best.id))) best = { id, teamId: e.teamId, score };
    }
    return best ? { playerId: best.id, teamId: best.teamId } : null;
  });
}

function weeklyEntry(league: League, season: number): WeeklyAwards {
  let entry = league.weeklyAwards.find((w) => w.season === season);
  if (!entry) {
    entry = { season, weeks: {}, months: {} };
    league.weeklyAwards.push(entry);
    league.weeklyAwards.sort((a, b) => a.season - b.season);
  }
  return entry;
}

/** After a regular-season week: names its players of the week and, if a month just ended, of the month. */
export function awardWeek(league: League, week: number, season = league.season): void {
  const entry = weeklyEntry(league, season);
  entry.weeks[week] ??= pickPeriod(league, season, [week, week]);
  const month = monthEnding(week);
  if (month) entry.months[month.key] ??= pickPeriod(league, season, month.weeks);
}

/** A player's totals over a run of weeks, while the box scores are still kept (undefined after). */
export function periodLine(league: League, season: number, weeks: [number, number], playerId: number): StatLine | undefined {
  let total: StatLine | undefined;
  for (const g of regularSeasonGames(league, season)) {
    const line = g.week >= weeks[0] && g.week <= weeks[1] ? g.result!.playerStats[playerId] : undefined;
    if (line) addStats((total ??= {}), line);
  }
  return total;
}

export function weeklyAwards(league: League, season: number): WeeklyAwards | undefined {
  return league.weeklyAwards.find((w) => w.season === season);
}

export interface PlayerHonor {
  season: number;
  label: string;
}

export interface HonorBadge {
  label: string;
  /** Seasons won, newest first (a season repeats for each week or month won in it). */
  seasons: number[];
}

/** The same honor won more than once becomes one badge ("2× MVP"), in order of prestige. */
export function honorBadges(honors: PlayerHonor[]): HonorBadge[] {
  const order = [...AWARD_KEYS.map((k) => AWARD_SHORT[k]), 'All-League 1st team', 'All-League 2nd team', 'Player of the Month', 'Player of the Week'];
  const by = new Map<string, number[]>();
  for (const h of honors) by.set(h.label, [...(by.get(h.label) ?? []), h.season]);
  return [...by]
    .sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]))
    .map(([label, seasons]) => ({ label, seasons }));
}

/** Everything a player has won, newest first: awards and All-League selections, then players of the month and week. */
export function playerHonors(league: League, playerId: number): PlayerHonor[] {
  const out: PlayerHonor[] = [];
  for (const a of [...league.awards].reverse()) {
    for (const k of AWARD_KEYS) if (a.winners[k]?.playerId === playerId) out.push({ season: a.season, label: AWARD_SHORT[k] });
    a.allLeague.forEach((squad, i) => {
      if (squad.some((w) => w.playerId === playerId)) out.push({ season: a.season, label: i === 0 ? 'All-League 1st team' : 'All-League 2nd team' });
    });
  }
  for (const w of [...league.weeklyAwards].reverse()) {
    for (const winners of Object.values(w.months)) if (winners!.some((x) => x?.playerId === playerId)) out.push({ season: w.season, label: 'Player of the Month' });
    for (const winners of Object.values(w.weeks)) if (winners.some((x) => x?.playerId === playerId)) out.push({ season: w.season, label: 'Player of the Week' });
  }
  return out;
}
