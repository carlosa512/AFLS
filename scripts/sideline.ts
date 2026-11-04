/**
 * `npm run sideline [-- games]`: out of bounds against the NFL's, fast. Plays AI games (no field) in two leagues and
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
for (const seed of ['sideline-a', 'sideline-b']) {
  const league = createLeague({ seed });
  spread ??= spreadLines(league);
  const games = league.games.filter((g) => !g.playoffRound).slice(0, Math.ceil(GAMES / 2));
  for (const g of games) {
    const r = simulateGame(league, g, { keepPlays: true, seed: `sideline:${seed}:${g.id}` });
    tallyGame(tally, r.plays!, g.homeId);
  }
}
console.log(`Out of bounds against nflverse 2021–25 (${GAMES} AI games, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`);
let misses = 0;
for (const l of [...judgeSideline(tally), ...spread!]) if (!printLine(l)) misses++;
console.log(`\n${misses} line(s) outside range`);
if (misses) process.exitCode = 1;
