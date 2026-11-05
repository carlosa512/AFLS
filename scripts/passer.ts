/**
 * `npm run passer [-- games]`: the passer's choices against the NFL's, fast. Plays AI games (no field) across as many
 * leagues as it takes and judges the buckets, throwaways from outside the pocket, grounding and the spread between
 * passers (`passer-core.ts`). Run it after changing `match/pocketChoice.ts` or the dropback in `match/gameSim.ts`;
 * `npm run sim` judges the same lines.
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { groundingLines, judgePasser, newPasserTally, passerSpread, tapDropback } from './passer-core';
import { printLine } from './sideline-core';

const GAMES = Number(process.argv[2] ?? 200);
const tally = newPasserTally();
const t0 = Date.now();
// As many leagues as the games asked for (a league's regular season is 272 games).
let played = 0;
for (let k = 0; played < GAMES; k++) {
  const seed = `passer-${k}`;
  const league = createLeague({ seed });
  for (const g of league.games.filter((g) => !g.playoffRound)) {
    if (played++ >= GAMES) break;
    simulateGame(league, g, {
      seed: `passer:${seed}:${g.id}`,
      dropbackTap: (tap) => tapDropback(tally, tap, `${k}:${tap.qb}`),
    });
  }
}
const games = Math.min(played, GAMES);
console.log(
  `The passer's choices against FTN and NGS 2023–25 (${games} AI games, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`,
);
let misses = 0;
for (const l of [...judgePasser(tally), ...groundingLines(tally, games), ...passerSpread(tally)])
  if (!printLine(l)) misses++;
console.log(`\n${misses} line(s) outside range`);
if (misses) process.exitCode = 1;
