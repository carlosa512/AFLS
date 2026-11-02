/**
 * Engine calibration: simulate full regular seasons and compare league-wide
 * per-team-game averages against real NFL benchmarks.
 *
 *   npm run sim            # 3 seasons
 *   npm run sim -- 10      # 10 seasons
 */
import { callerStyle, teamScheme } from '../src/engine/coaching';
import { createLeague } from '../src/engine/generate';
import { gamesInWeek, playWeek } from '../src/engine/league';
import { simulateGame } from '../src/engine/match/gameSim';
import { teamRatings } from '../src/engine/roster';
import { REGULAR_SEASON_WEEKS } from '../src/engine/season/schedule';
import { regularSeasonGames } from '../src/engine/season/standings';
import { FOUL_KINDS, FOULS } from '../src/engine/penalties';
import type { GameResult, League, TeamGameStats } from '../src/engine/types';
import { LEADER_TARGETS, overRecordAllowed, seasonTops } from './leaders';

const seasons = Number(process.argv[2] ?? 3);

// Approximate recent NFL per-team-game averages.
const TARGETS: Record<string, [number, number]> = {
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

/**
 * Injuries per team over a 17-game regular season, against the NFL's injury surveillance and
 * return-to-play studies (sources: docs/INJURIES.md). Only time-loss injuries count (a week or more),
 * except concussions, which count whether or not he misses a game (as the NFL counts them): 59% do.
 */
const INJURY_TARGETS: Record<string, [number, number]> = {
  'in games / team-game': [1.0, 1.6],
  'practice share %': [15, 30],
  'per team-season': [20, 36],
  'weeks missed / team': [55, 130],
  'concussions / team': [2, 5],
  'concussions 0 games %': [33, 50],
  'torn ACLs / team': [0.6, 1.5],
  'hamstrings / team': [3.5, 7],
};

/**
 * NFL passing by depth of target (nflverse play-by-play, 2019–24 regular seasons, every throw with its air yards):
 * share of throws, completion %, yards an attempt, interception %, yards after the catch.
 */
const PASS_DEPTH_NFL = {
  behind: { share: 16.6, cmp: 81, ypa: 4.7, int: 0.8, yac: 9.1 },
  '0–9': { share: 50.9, cmp: 70, ypa: 5.8, int: 1.4, yac: 4.2 },
  '10–19': { share: 20.9, cmp: 54.9, ypa: 9.6, int: 3.4, yac: 3.7 },
  '20+': { share: 11.6, cmp: 36.2, ypa: 12.2, int: 6.3, yac: 5.6 },
} as const;
type DepthBand = keyof typeof PASS_DEPTH_NFL;
// The shape judged: average air yards a throw (nflverse 7.9; 7.7 in 2024) and the shares by depth.
const DEPTH_TARGETS: Record<string, [number, number]> = {
  'average air yards': [7.4, 8.3],
  'short share %': [65, 70],
  '10–19 share %': [19, 23],
  '20+ share %': [10.5, 13],
};
const depthTally = Object.fromEntries(
  (Object.keys(PASS_DEPTH_NFL) as DepthBand[]).map((b) => [b, { att: 0, cmp: 0, yds: 0, int: 0, yac: 0, air: 0 }]),
) as Record<DepthBand, { att: number; cmp: number; yds: number; int: number; yac: number; air: number }>;

// How much team strength decides, against the betting line (nflverse, 2015–24 regular seasons: favourites win 66.4%
// straight up, a final margin sits 12.8 either side of the line, team wins spread with an SD of 3.09). Strength is both
// teams' overall before each week's games, injuries in, as a line reads it.
const PARITY_TARGETS: Record<string, [number, number]> = {
  // Who wins, as a line reads it (owner's call, 2026-10-31): the margin it predicts runs larger than the line's 6.0
  // (shown below), about a point more in a mismatch, while who wins matches.
  'favourite wins %': [64, 69],
  'margin spread around strength': [12.3, 13.3],
  'win spread (SD)': [3.0, 3.4],
};
const inj: Record<string, number> = {};
const injAdd = (k: string, v = 1) => (inj[k] = (inj[k] ?? 0) + v);
const bySeverity: Record<string, number> = {};
const byPosition: Record<string, { hurt: number; players: number }> = {};

/** Each season's top five, per stat. */
const tops: Record<string, number[][]> = {};

const sum: Record<string, number> = {};
const add = (k: string, v: number) => (sum[k] = (sum[k] ?? 0) + v);
let teamGames = 0;
let games = 0;
let homeWins = 0;
let ot = 0;
let ties = 0;
let favoriteWins = 0;
/** Team-seasons with 30 or more rushing touchdowns (NFL: 3 of 160 in 2021–25, 8 of 861 since 1999; the most since 1999 is 32). */
let rushTd30 = 0;
let decided = 0;
/** Each game's rating gap (home less away, at kickoff) and home margin, for how much strength decides. */
const gaps: [number, number][] = [];
/** Total points in games under a roof and in the open air (NFL: indoor games score almost 4 more). */
const byRoof = { indoor: [0, 0], outdoor: [0, 0] };
const winsByStrength: { rating: number; wins: number }[] = [];
/** Play-calling style at work: pass share and fourth-down tries by the play-callers' leanings. */
const byStyle: Record<string, { plays: number; passes: number; fourth: number; games: number }> = {};
const tally = (key: string, t: TeamGameStats) => {
  const b = (byStyle[key] ??= { plays: 0, passes: 0, fourth: 0, games: 0 });
  b.plays += t.passAtt + t.sacked + t.rushAtt;
  b.passes += t.passAtt + t.sacked;
  b.fourth += t.fourthDownAtt;
  b.games++;
};
/** Schemes at work: what each offense gains and each front and coverage allows, per team-game. */
const byScheme: Record<
  string,
  {
    games: number;
    pts: number;
    plays: number;
    passes: number;
    yds: number;
    passAtt: number;
    passYds: number;
    rushAtt: number;
    rushYds: number;
    sacks: number;
  }
> = {};
const schemeTally = (key: string, t: TeamGameStats, pts: number) => {
  const b = (byScheme[key] ??= {
    games: 0,
    pts: 0,
    plays: 0,
    passes: 0,
    yds: 0,
    passAtt: 0,
    passYds: 0,
    rushAtt: 0,
    rushYds: 0,
    sacks: 0,
  });
  b.games++;
  b.pts += pts;
  b.plays += t.plays;
  b.passes += t.passAtt + t.sacked;
  b.yds += t.totalYds;
  b.passAtt += t.passAtt;
  b.passYds += t.passYds;
  b.rushAtt += t.rushAtt;
  b.rushYds += t.rushYds;
  b.sacks += t.sacked;
};
const lean = (v: number) => (v >= 0.35 ? 'high' : v <= -0.35 ? 'low' : 'mid');

/** The league's advanced numbers (`analytics.ts`), both sides of every game. */
const adv = { plays: 0, epa: 0, success: 0, explosive: 0, dropbacks: 0, passEpa: 0, rushes: 0, rushEpa: 0 };

function sampleDepth(league: League) {
  const untouched = JSON.stringify(league);
  for (const g of gamesInWeek(league)) {
    const r = simulateGame(league, g, { keepPlays: true });
    for (const p of r.plays ?? []) {
      // A throw away has no target (nflverse leaves its air yards blank too); a throw caught at the line logs no air.
      if (p.kind !== 'pass' && p.kind !== 'incomplete' && p.kind !== 'int') continue;
      if (p.from === undefined || p.text.includes('throws it away')) continue;
      // In the offense's own yards (0–100): a touchdown's animation runs into the end zone, its gain stops at the line.
      const own = (x: number) => (p.offense === g.homeId ? x : 100 - x);
      const air = own(p.air ?? p.from) - own(p.from);
      const t = depthTally[air < 0 ? 'behind' : air < 10 ? '0–9' : air < 20 ? '10–19' : '20+'];
      t.att++;
      t.air += air;
      if (p.kind === 'int') t.int++;
      if (p.kind === 'pass') {
        const gain = Math.min(own(p.to!), 100) - own(p.from);
        t.cmp++;
        t.yds += gain;
        // A catch in the end zone stops at the line: nflverse records no yards after it.
        t.yac += Math.max(0, gain - air);
      }
    }
  }
  if (JSON.stringify(league) !== untouched) throw new Error('the depth sample changed the league');
}

const t0 = Date.now();
for (let s = 0; s < seasons; s++) {
  const league = createLeague({ seed: `calibrate-${s}` });
  const ratings = new Map(league.teams.map((t) => [t.id, teamRatings(league, t).overall]));
  // Strength as a line reads it: both teams' overall before each week's games, injuries in.
  const gameGap = new Map<number, number>();
  while (league.phase === 'regular') {
    // Passing by depth from weeks 1 and 10 replayed with their play logs before they're played for real (week 10's
    // injuries in: backups throw and catch about a tenth of the passes). A replay only reads the league, and the
    // sample must not change the season: the league is compared before and after.
    if (league.week === 1 || league.week === 10) sampleDepth(league);
    const week = new Map(league.teams.map((t) => [t.id, teamRatings(league, t).overall]));
    for (const g of gamesInWeek(league)) gameGap.set(g.id, week.get(g.homeId)! - week.get(g.awayId)!);
    playWeek(league);
  }
  const wins = new Map<number, number>();
  for (const g of regularSeasonGames(league)) {
    const r = g.result as GameResult;
    games++;
    for (const a of [r.home.adv, r.away.adv])
      if (a) {
        adv.plays += a.plays;
        adv.epa += a.epa;
        adv.success += a.success;
        adv.explosive += a.explosive;
        adv.dropbacks += a.dropbacks;
        adv.passEpa += a.passEpa;
        adv.rushes += a.rushes;
        adv.rushEpa += a.rushEpa;
      }
    const roof = byRoof[r.weather?.roof === 'dome' || r.weather?.roof === 'closed' ? 'indoor' : 'outdoor'];
    roof[0] += r.homeScore + r.awayScore;
    roof[1]++;
    if (r.overtime) ot++;
    gaps.push([gameGap.get(g.id)!, r.homeScore - r.awayScore]);
    if (r.homeScore === r.awayScore) ties++;
    else {
      if (r.homeScore > r.awayScore) homeWins++;
      const winner = r.homeScore > r.awayScore ? g.homeId : g.awayId;
      wins.set(winner, (wins.get(winner) ?? 0) + 1);
      const fav = gameGap.get(g.id)! >= 0 ? g.homeId : g.awayId;
      decided++;
      if (winner === fav) favoriteWins++;
    }
    const pairs: [TeamGameStats, number][] = [
      [r.home, r.homeScore],
      [r.away, r.awayScore],
    ];
    for (const [id, t, pts, oppId] of [
      [g.homeId, r.home, r.homeScore, g.awayId],
      [g.awayId, r.away, r.awayScore, g.homeId],
    ] as const) {
      const off = teamScheme(league, id);
      const def = teamScheme(league, oppId);
      schemeTally(`off:${off.offense.label}`, t, pts);
      schemeTally(`front:${def.front.label}`, t, pts);
      schemeTally(`cov:${def.coverage?.label ?? 'none'}`, t, pts);
      const style = callerStyle(league, id);
      tally(`pass:${lean(style.passLean)}`, t);
      tally(`fourth:${lean(style.fourthDown)}`, t);
    }
    for (const [t, pts] of pairs) {
      teamGames++;
      add('points', pts);
      add('plays', t.plays);
      add('totalYds', t.totalYds);
      add('passAtt', t.passAtt);
      add('passCmp', t.passCmp);
      add('passYdsNet', t.passYds);
      add('sacks', t.sacked);
      add('rushAtt', t.rushAtt);
      add('rushYds', t.rushYds);
      add('turnovers', t.turnovers);
      add('firstDowns', t.firstDowns);
      add('thirdAtt', t.thirdDownAtt);
      add('thirdConv', t.thirdDownConv);
      add('redZoneAtt', t.redZoneAtt);
      add('fourthAtt', t.fourthDownAtt);
      add('redZoneTd', t.redZoneTd);
      add('penalties', t.penalties);
      add(
        'declined',
        Object.values(t.declined ?? {}).reduce((a, b) => a + b, 0),
      );
      add(
        'offsetting',
        Object.values(t.offset ?? {}).reduce((a, b) => a + b, 0),
      );
      add(
        'personal',
        FOUL_KINDS.filter((f) => FOULS[f].personal).reduce((a, f) => a + (t.flags?.[f] ?? 0), 0),
      );
      add('roughing', t.flags?.roughingPasser ?? 0);
      add(
        'special',
        FOUL_KINDS.filter((f) => FOULS[f].special).reduce((a, f) => a + (t.flags?.[f] ?? 0), 0),
      );
      add('top', t.top);
    }
    for (const line of Object.values(r.playerStats)) {
      add('passTd', line.passTd ?? 0);
      add('rushTd', line.rushTd ?? 0);
      add('int', line.passInt ?? 0);
      add('fumblesLost', line.fumblesLost ?? 0);
      add('fgAtt', line.fgAtt ?? 0);
      add('fgMade', line.fgMade ?? 0);
      add('punts', line.punts ?? 0);
      add('sackYds', line.sackYds ?? 0);
    }
  }
  const rushTds = new Map<number, number>();
  for (const g of regularSeasonGames(league))
    for (const [id, line] of Object.entries(g.result!.playerStats)) {
      const team = g.result!.playerTeams[Number(id)];
      rushTds.set(team, (rushTds.get(team) ?? 0) + (line.rushTd ?? 0));
    }
  rushTd30 += [...rushTds.values()].filter((n) => n >= 30).length;
  for (const [key, top] of Object.entries(seasonTops(league, league.season))) (tops[key] ??= []).push(top);
  for (const g of regularSeasonGames(league)) injAdd('game', g.result?.injuries?.length ?? 0);
  for (const p of Object.values(league.players)) {
    if (p.teamId !== null) (byPosition[p.position] ??= { hurt: 0, players: 0 }).players++;
    for (const r of p.injuries ?? []) {
      if (r.season !== league.season || r.week > REGULAR_SEASON_WEEKS) continue;
      injAdd('all');
      injAdd('weeks', Math.min(r.weeks, REGULAR_SEASON_WEEKS - r.week));
      injAdd(r.type);
      if (r.type === 'concussion' && r.weeks === 0) injAdd('concussion:none');
      bySeverity[r.severity] = (bySeverity[r.severity] ?? 0) + 1;
      (byPosition[p.position] ??= { hurt: 0, players: 0 }).hurt++;
    }
  }
  injAdd(
    'irReturns',
    league.teams.reduce((n, t) => n + (t.irReturns?.[league.season] ?? 0), 0),
  );
  injAdd('irNow', Object.values(league.players).filter((p) => p.ir).length);
  for (const t of league.teams) winsByStrength.push({ rating: ratings.get(t.id)!, wins: wins.get(t.id) ?? 0 });
}

const per = (k: string) => (sum[k] ?? 0) / teamGames;
const results: Record<string, number> = {
  points: per('points'),
  plays: per('plays'),
  totalYds: per('totalYds'),
  passAtt: per('passAtt'),
  cmpPct: (100 * sum.passCmp) / sum.passAtt,
  passYdsGross: per('passYdsNet') + per('sackYds'),
  ypa: (sum.passYdsNet + sum.sackYds) / sum.passAtt,
  sacks: per('sacks'),
  rushAtt: per('rushAtt'),
  ypc: sum.rushYds / sum.rushAtt,
  passTd: per('passTd'),
  rushTd: per('rushTd'),
  int: per('int'),
  fumblesLost: per('fumblesLost'),
  firstDowns: per('firstDowns'),
  thirdDownPct: (100 * sum.thirdConv) / sum.thirdAtt,
  redZoneTrips: per('redZoneAtt'),
  redZonePct: (100 * sum.redZoneTd) / sum.redZoneAtt,
  fgAtt: per('fgAtt'),
  fourthAtt: per('fourthAtt'),
  fgPct: (100 * sum.fgMade) / sum.fgAtt,
  punts: per('punts'),
  penalties: per('penalties'),
  declined: per('declined'),
  offsetting: per('offsetting'),
  personal: per('personal'),
  roughing: per('roughing'),
  special: per('special'),
  homeWinPct: (100 * homeWins) / (games - ties),
  otPct: (100 * ot) / games,
  tiePct: (100 * ties) / games,
};

console.log(`\n${seasons} seasons, ${games} games, ${((Date.now() - t0) / 1000).toFixed(1)}s\n`);
console.log('stat'.padEnd(14), 'sim'.padStart(8), '  NFL range');
let misses = 0;
for (const [k, v] of Object.entries(results)) {
  const [lo, hi] = TARGETS[k];
  const ok = v >= lo && v <= hi;
  if (!ok) misses++;
  console.log(k.padEnd(14), v.toFixed(2).padStart(8), `  ${lo}–${hi}`, ok ? '' : v < lo ? '  ▼ LOW' : '  ▲ HIGH');
}
console.log(`\nTime of possession check: ${(per('top') / 60).toFixed(1)} min per team-game (target 30)`);
console.log(
  `Indoor games score ${(byRoof.indoor[0] / byRoof.indoor[1] - byRoof.outdoor[0] / byRoof.outdoor[1]).toFixed(1)} more points than outdoor ones (NFL ≈ 4)`,
);
winsByStrength.sort((a, b) => b.rating - a.rating);
const q = Math.floor(winsByStrength.length / 4);
const avgWins = (arr: typeof winsByStrength) => (arr.reduce((s, x) => s + x.wins, 0) / arr.length).toFixed(1);
console.log(
  `Avg wins by rating quartile (best→worst): ${[0, 1, 2, 3].map((i) => avgWins(winsByStrength.slice(i * q, (i + 1) * q))).join(' / ')}`,
);
console.log(
  `Team-seasons with 30+ rushing TDs (informational): ${rushTd30} of ${seasons * 32} (NFL 2021–25: 3 of 160)`,
);
const show = (kind: 'pass' | 'fourth', label: (b: (typeof byStyle)[string]) => string) =>
  (['low', 'mid', 'high'] as const)
    .map((k) => (byStyle[`${kind}:${k}`] ? `${k} ${label(byStyle[`${kind}:${k}`])}` : `${k} n/a`))
    .join(' · ');
console.log(
  `Play-caller style (informational): pass share by pass lean ${show('pass', (b) => `${((100 * b.passes) / b.plays).toFixed(1)}%`)}`,
);
console.log(
  `  fourth-down tries per game by head coach's appetite ${show('fourth', (b) => (b.fourth / b.games).toFixed(2))}`,
);

console.log('\nSeason leaders: average of each rank, and the best season seen');
console.log(
  'stat'.padEnd(14),
  ...['#1', '#2', '#3', '#4', '#5', 'best'].map((h) => h.padStart(7)),
  '  NFL #1 / #5 / record',
);
const maxOver = overRecordAllowed(seasons);
for (const { label, first, fifth, ceiling } of LEADER_TARGETS) {
  const rows = tops[label];
  const rank = (i: number) => rows.reduce((s, r) => s + (r[i] ?? 0), 0) / rows.length;
  const best = Math.max(...rows.map((r) => r[0]));
  const over = rows.filter((r) => r[0] > ceiling).length;
  const flags = [
    rank(0) < first[0] ? '#1 ▼ LOW' : rank(0) > first[1] ? '#1 ▲ HIGH' : '',
    rank(4) < fifth[0] ? '#5 ▼ LOW' : rank(4) > fifth[1] ? '#5 ▲ HIGH' : '',
  ].filter(Boolean);
  misses += flags.length;
  // Seasons past the record are a warning, not a miss: allowing one in ten seasons, a league right on
  // the NFL's rate of one in fifteen still shows two about one run in seven, so the count is mostly luck.
  // The average #1 and #5 above are what's judged.
  if (over > maxOver) flags.push(`⚠ ${over} seasons past the record (warning only)`);
  const fmt = (v: number) => (v < 100 ? v.toFixed(1) : Math.round(v).toString()).padStart(7);
  console.log(
    label.padEnd(14),
    ...[0, 1, 2, 3, 4].map((i) => fmt(rank(i))),
    fmt(best),
    `  ${first.join('–')} / ${fifth.join('–')} / ${ceiling}`,
    flags.join('  '),
  );
}

const teamSeasons = seasons * 32;
const injuryResults: Record<string, number> = {
  'in games / team-game': inj.game / teamGames,
  'practice share %': (100 * (inj.all - inj.game)) / inj.all,
  'per team-season': inj.all / teamSeasons,
  'weeks missed / team': inj.weeks / teamSeasons,
  'concussions / team': (inj.concussion ?? 0) / teamSeasons,
  'concussions 0 games %': (100 * (inj['concussion:none'] ?? 0)) / (inj.concussion ?? 1),
  'torn ACLs / team': (inj.acl ?? 0) / teamSeasons,
  'hamstrings / team': (inj.hamstring ?? 0) / teamSeasons,
};
console.log('\nInjuries (time-loss, regular season)');
console.log('stat'.padEnd(22), 'sim'.padStart(8), '  NFL range');
for (const [k, v] of Object.entries(injuryResults)) {
  const [lo, hi] = INJURY_TARGETS[k];
  const ok = v >= lo && v <= hi;
  if (!ok) misses++;
  console.log(k.padEnd(22), v.toFixed(2).padStart(8), `  ${lo}–${hi}`, ok ? '' : v < lo ? '  ▼ LOW' : '  ▲ HIGH');
}
const sevTotal = Object.values(bySeverity).reduce((a, b) => a + b, 0);
console.log(
  `Severity (informational): ${Object.entries(bySeverity)
    .map(([k, v]) => `${k} ${((100 * v) / sevTotal).toFixed(0)}%`)
    .join(' · ')}`,
);
console.log(
  `Injured reserve (informational): ${(inj.irNow / teamSeasons).toFixed(1)} per team still on it after week 18, ${(inj.irReturns / teamSeasons).toFixed(1)} brought back`,
);
console.log(
  `Injuries per rostered player-season by position (informational): ${Object.entries(byPosition)
    .map(([pos, b]) => `${pos} ${(b.hurt / b.players).toFixed(2)}`)
    .join(' · ')}`,
);

// Parity: margin against rating gap by least squares; the residual is the game's own randomness.
const meanOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const gx = meanOf(gaps.map(([x]) => x));
const gy = meanOf(gaps.map(([, y]) => y));
const slope = gaps.reduce((t, [x, y]) => t + (x - gx) * (y - gy), 0) / gaps.reduce((t, [x]) => t + (x - gx) ** 2, 0);
const residual = Math.sqrt(meanOf(gaps.map(([x, y]) => (y - gy - slope * (x - gx)) ** 2)));
const meanWins = meanOf(winsByStrength.map((x) => x.wins));
const gapSd = Math.sqrt(meanOf(gaps.map(([x]) => (x - gx) ** 2)));
const parityResults: Record<string, number> = {
  'favourite wins %': (100 * favoriteWins) / decided,
  'margin spread around strength': residual,
  'win spread (SD)': Math.sqrt(meanOf(winsByStrength.map((x) => (x.wins - meanWins) ** 2))),
};
console.log('\nParity');
console.log('stat'.padEnd(30), 'sim'.padStart(8), '  NFL range');
for (const [k, v] of Object.entries(parityResults)) {
  const [lo, hi] = PARITY_TARGETS[k];
  const ok = v >= lo && v <= hi;
  if (!ok) misses++;
  console.log(k.padEnd(30), v.toFixed(2).padStart(8), `  ${lo}–${hi}`, ok ? '' : v < lo ? '  ▼ LOW' : '  ▲ HIGH');
}
console.log(
  `Margin strength predicts: SD ${(slope * gapSd).toFixed(2)} (the line's 6.0), ${slope.toFixed(1)} points per rating point (informational)`,
);

const bands = Object.keys(PASS_DEPTH_NFL) as DepthBand[];
const throws = bands.reduce((n, b) => n + depthTally[b].att, 0);
const shareOf = (...bs: DepthBand[]) => (100 * bs.reduce((n, b) => n + depthTally[b].att, 0)) / throws;
const depthResults: Record<string, number> = {
  'average air yards': bands.reduce((n, b) => n + depthTally[b].air, 0) / throws,
  'short share %': shareOf('behind', '0–9'),
  '10–19 share %': shareOf('10–19'),
  '20+ share %': shareOf('20+'),
};
console.log(`\nPassing by depth (weeks 1 and 10 replayed, ${throws} throws; NFL from nflverse 2019–24)`);
console.log('stat'.padEnd(30), 'sim'.padStart(8), '  NFL range');
for (const [k, v] of Object.entries(depthResults)) {
  const [lo, hi] = DEPTH_TARGETS[k];
  const ok = v >= lo && v <= hi;
  if (!ok) misses++;
  console.log(k.padEnd(30), v.toFixed(2).padStart(8), `  ${lo}–${hi}`, ok ? '' : v < lo ? '  ▼ LOW' : '  ▲ HIGH');
}
console.log('band (informational)   share      cmp%     Y/A     INT%   YAC/catch   (sim / NFL)');
for (const b of bands) {
  const t = depthTally[b];
  const nfl = PASS_DEPTH_NFL[b];
  const pair = (sim: number, real: number, d = 1) => `${sim.toFixed(d).padStart(5)}/${real.toFixed(d).padEnd(5)}`;
  console.log(
    b.padEnd(22),
    pair((100 * t.att) / throws, nfl.share),
    pair((100 * t.cmp) / t.att, nfl.cmp),
    pair(t.yds / t.att, nfl.ypa),
    pair((100 * t.int) / t.att, nfl.int),
    pair(t.yac / Math.max(1, t.cmp), nfl.yac),
  );
}

console.log(`\n${misses} stat(s) outside target range`);
// The tables below are informational; a stat outside its range fails the run (and CI).
if (misses) process.exitCode = 1;

// What the Gazette writes about: a measure of play, not play itself, so it warns rather than fails.
console.log("\nAdvanced numbers (warnings only): the Gazette's measures against the NFL's");
const ADV: [string, number, number, number][] = [
  ['EPA per play', adv.epa / adv.plays, -0.05, 0.05],
  ['EPA per dropback', adv.passEpa / adv.dropbacks, 0, 0.12],
  ['EPA per rush', adv.rushEpa / adv.rushes, -0.15, -0.02],
  ['success rate', adv.success / adv.plays, 0.42, 0.48],
  ['explosive rate', adv.explosive / adv.plays, 0.07, 0.11],
];
for (const [k, v, lo, hi] of ADV)
  console.log(k.padEnd(18), v.toFixed(3).padStart(8), `  ${lo}–${hi}`, v < lo || v > hi ? '  ⚠' : '');

console.log('\nSchemes (informational, per team-game): offense gains, defense allows');
console.log(
  'scheme'.padEnd(22),
  'games'.padStart(6),
  'pts'.padStart(6),
  'yds'.padStart(6),
  'pass%'.padStart(6),
  'ypa'.padStart(6),
  'ypc'.padStart(6),
  'sacks'.padStart(6),
);
for (const [key, b] of Object.entries(byScheme).sort()) {
  const f = (v: number, d = 1) => v.toFixed(d).padStart(6);
  console.log(
    key.padEnd(22),
    String(b.games).padStart(6),
    f(b.pts / b.games),
    f(b.yds / b.games, 0),
    f((100 * b.passes) / b.plays),
    f(b.passYds / b.passAtt, 2),
    f(b.rushYds / b.rushAtt, 2),
    f(b.sacks / b.games, 2),
  );
}
