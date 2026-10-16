/**
 * End-of-game audit: simulate many games and flag late-game decisions that a real coach
 * would never make (a trailing team letting the clock die in bounds, kneeling while behind…).
 *
 *   npm run endings            # 1500 games
 *   npm run endings -- 5000 -v # more games, print each flagged ending
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import type { PlayLogEntry } from '../src/engine/types';

const n = Number(process.argv[2] ?? 1500);
const verbose = process.argv.includes('-v');
const league = createLeague({ seed: 'endings' });
const flags: Record<string, number> = {};
const examples: Record<string, string[]> = {};

const flag = (key: string, plays: PlayLogEntry[], i: number) => {
  flags[key] = (flags[key] ?? 0) + 1;
  if ((examples[key] ??= []).length < 3 || verbose) {
    examples[key].push(plays.slice(Math.max(0, i - 4), i + 2).map((p) => `   Q${p.quarter} ${p.clock}s ${p.down ? `${p.down}&${p.distance} @${p.yardLine}` : ''} [${p.homeScore}-${p.awayScore}] ${p.text}`).join('\n'));
  }
};

for (let i = 0; i < n; i++) {
  const game = league.games[i % league.games.length];
  const r = simulateGame(league, game, { keepPlays: true, seed: `end-${i}` });
  const plays = r.plays!;
  plays.forEach((p, j) => {
    if (!p.down || p.quarter < 4) return;
    const offIsHome = p.offense === game.homeId;
    // Logged scores are after the play; the decision was made on the score before it.
    const prev = plays[j - 1] ?? { homeScore: 0, awayScore: 0 };
    const diff = offIsHome ? prev.homeScore - prev.awayScore : prev.awayScore - prev.homeScore;
    const next = plays[j + 1];
    const lastSnapOfHalf = !next || next.quarter !== p.quarter || (next.quarter === 4 && next.clock === 0 && !next.down);
    // The trailing (or tied, in range) offense's final snap of regulation was an ordinary run.
    if (p.quarter === 4 && lastSnapOfHalf && diff < 0 && p.kind === 'run') flag('trailing team ends game on a run', plays, j);
    if (p.quarter === 4 && lastSnapOfHalf && diff < 0 && p.kind === 'kneel') flag('trailing team kneels at the end', plays, j);
    if (diff < 0 && p.kind === 'kneel') flag('trailing team kneels', plays, j);
    if (p.quarter === 4 && diff < 0 && diff >= -3 && lastSnapOfHalf && /field goal/.test(p.text) === false && 100 - p.yardLine <= 35)
      flag('trailing by ≤3 in FG range, last snap not a FG', plays, j);
    if (p.quarter === 4 && diff > 0 && diff <= 8 && p.down === 4 && /punts/.test(p.text) && p.clock <= 8) flag('one-score leader punts with ≤8s left', plays, j);
    if (p.quarter === 4 && diff > 0 && p.kind === 'pass' && p.clock <= 120 && /incomplete/.test(p.text)) flag('leader throws incompletion in last 2:00', plays, j);
  });
}

console.log(`${n} games`);
for (const [k, v] of Object.entries(flags).sort((a, b) => b[1] - a[1])) {
  console.log(`\n${k}: ${v}`);
  for (const ex of examples[k]) console.log(ex + '\n   ---');
}
