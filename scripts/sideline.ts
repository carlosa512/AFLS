/**
 * `npm run sideline [-- games]`: out of bounds against the NFL's, fast. Plays AI games (no field) across as many leagues as it takes and
 * judges the buckets, the clock gaps and the spread between players (`sideline-core.ts`). Run it after changing
 * `match/sideline.ts` or the out-of-bounds code in `match/gameSim.ts`; `npm run sim` judges the same lines.
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { judgeSideline, newSidelineTally, printLine, spreadLines, tallyGame } from './sideline-core';

const GAMES = Number(process.argv[2] ?? 200);
const tally = newSidelineTally();
let spread = null as ReturnType<typeof spreadLines> | null;
const t0 = Date.now();
// As many leagues as the games asked for (a league's regular season is 272 games).
let played = 0;
for (let k = 0; played < GAMES; k++) {
  const seed = `sideline-${k}`;
  const league = createLeague({ seed });
  spread ??= spreadLines(league);
  for (const g of league.games.filter((g) => !g.playoffRound)) {
    if (played++ >= GAMES) break;
    const r = simulateGame(league, g, { keepPlays: true, seed: `sideline:${seed}:${g.id}` });
    tallyGame(tally, r.plays!, g.homeId);
  }
}
console.log(`Out of bounds against nflverse 2021–25 (${GAMES} AI games, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
let misses = 0;
for (const l of [...judgeSideline(tally), ...spread!]) if (!printLine(l)) misses++;
console.log(`\n${misses} line(s) outside range`);
if (misses) process.exitCode = 1;
