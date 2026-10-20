/**
 * Officiating crews audit (docs/OFFICIALS.md). Plays regular seasons and checks:
 *
 * 1. Baseline: each game is also replayed with a league-average crew (same seed, same rosters), and
 *    the league's flags per game stay within 5% of that: crews move games, not the league.
 * 2. Spread: the busiest crew's flags per game over the quietest's, one season, lands at 1.3–1.7×
 *    (the NFL's 2018 crews: 20.4 against 13.1). Sixteen games a crew leave a lot to luck (one season
 *    swings about ±0.15 on its own), so the check is the leagues' average and each one is shown.
 * 3. Rotation: every crew works about the same number of games, and none works two in a week.
 * 4. Tendencies: the crews average 10–11 on each one, and still do after years of offseason drift,
 *    without spreading apart or bunching up.
 *
 *   npm run crews          # 4 leagues, one season each
 *   npm run crews -- 8
 */
import { createLeague } from '../src/engine/generate';
import { gamesInWeek, playWeek } from '../src/engine/league';
import { simulateGame } from '../src/engine/match/gameSim';
import { crewsNewYear, crewTable, refName } from '../src/engine/officials';
import { syncDepthChart } from '../src/engine/roster';
import type { League } from '../src/engine/types';

const LEAGUES = Number(process.argv[2] ?? 4);

let misses = 0;
const check = (label: string, value: number, [lo, hi]: [number, number], digits = 2) => {
  const ok = value >= lo && value <= hi;
  if (!ok) misses++;
  console.log(
    `${label.padEnd(36)} ${value.toFixed(digits).padStart(8)}   ${lo}–${hi}${ok ? '' : value < lo ? '  ▼ LOW' : '  ▲ HIGH'}`,
  );
};

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const TENDENCIES = ['flagVolume', 'holding', 'coverage', 'qbProtection'] as const;
const tendencyMeans = (league: League) => TENDENCIES.map((t) => mean(league.crews.map((c) => c[t])));

const total = { flags: 0, base: 0, games: 0 };
const ratios: number[] = [];
const worked: number[] = [];
let doubled = 0;

for (let i = 0; i < LEAGUES; i++) {
  const league = createLeague({ seed: `crews-${i}` });
  let neutral = 0;
  let neutralGames = 0;
  while (league.phase === 'regular') {
    for (const g of gamesInWeek(league)) {
      syncDepthChart(league, league.teams[g.homeId]);
      syncDepthChart(league, league.teams[g.awayId]);
      const r = simulateGame(league, g, { crew: null });
      neutral += r.home.penalties + r.away.penalties;
      neutralGames++;
    }
    playWeek(league);
  }
  const played = league.games.filter((g) => g.season === league.season && g.result && !g.playoffRound);
  const flags = played.reduce((sum, g) => sum + g.result!.home.penalties + g.result!.away.penalties, 0);
  total.flags += flags;
  total.base += neutral;
  total.games += played.length;

  const { rows } = crewTable(league, league.season);
  const sorted = [...rows].sort((a, b) => b.perGame.flags - a.perGame.flags);
  const [busiest, quietest] = [sorted[0], sorted[sorted.length - 1]];
  ratios.push(busiest.perGame.flags / quietest.perGame.flags);
  worked.push(...rows.map((r) => r.games));
  // One crew in two games of a week would mean the rotation broke.
  if (new Set(played.map((g) => `${g.week}:${g.result!.crewId}`)).size !== played.length) doubled++;

  console.log(
    `League ${i + 1}: ${(flags / played.length).toFixed(2)} flags/g (${(neutral / neutralGames).toFixed(2)} with a league-average crew)`,
  );
  console.log(`  busiest  ${refName(busiest.crew).padEnd(16)} ${busiest.perGame.flags.toFixed(1)} flags/g`);
  console.log(
    `  quietest ${refName(quietest.crew).padEnd(16)} ${quietest.perGame.flags.toFixed(1)} flags/g   ×${ratios[i].toFixed(2)}`,
  );
  tendencyMeans(league).forEach((m, t) => check(`  mean ${TENDENCIES[t]}`, m, [10, 11]));
}

console.log(`\n── ${LEAGUES} leagues, ${total.games} games ──`);
check('flags/g vs league-average crew %', (100 * (total.flags - total.base)) / total.base, [-5, 5], 1);
check('busiest ÷ quietest crew', mean(ratios), [1.3, 1.7]);
check('fewest games worked by a crew', Math.min(...worked), [15, 17], 0);
check('most games worked by a crew', Math.max(...worked), [15, 17], 0);
check('crews in two games of a week', doubled, [0, 0], 0);

// Thirty offseasons of drift in ten leagues: still centred, and spread about like new leagues.
const spread = (l: League) => mean(TENDENCIES.map((t) => Math.sqrt(mean(l.crews.map((c) => (c[t] - 10.5) ** 2)))));
const drift = { before: 0, after: 0, off: 0 };
for (let i = 0; i < 10; i++) {
  const league = createLeague({ seed: `crews-drift-${i}` });
  drift.before += spread(league);
  for (let y = 0; y < 30; y++) {
    league.season++;
    crewsNewYear(league);
  }
  drift.after += spread(league);
  if (tendencyMeans(league).some((m) => m < 10 || m > 11)) drift.off++;
}
console.log(`\n── 30 offseasons of drift, 10 leagues ──`);
check('leagues off centre', drift.off, [0, 0], 0);
check('spread (SD) vs new leagues', drift.after / drift.before, [0.85, 1.15]);

console.log(`\n${misses} number(s) outside target range`);
process.exit(misses ? 1 : 0);
