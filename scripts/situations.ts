/**
 * `npm run situations [-- games]`: a play's time, the half's last possession, two-point tries and returns against the
 * NFL's, fast. Plays AI games (no field) across as many leagues as it takes and judges them (`situations-core.ts`). Run
 * it after changing `match/playTime.ts`, `match/twoPoint.ts`, `match/returns.ts` or the play times, the half, the try or
 * the returns in `match/gameSim.ts`; `npm run sim` judges the same lines.
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { judgeSituations, newSituationTally, tapSituation } from './situations-core';
import { printLine } from './sideline-core';

const GAMES = Number(process.argv[2] ?? 200);
const tally = newSituationTally();
const t0 = Date.now();
let played = 0;
for (let k = 0; played < GAMES; k++) {
  const seed = `situations-${k}`;
  const league = createLeague({ seed });
  for (const g of league.games.filter((g) => !g.playoffRound)) {
    if (played++ >= GAMES) break;
    simulateGame(league, g, { seed: `situations:${seed}:${g.id}`, situationTap: (tap) => tapSituation(tally, tap) });
  }
}
console.log(
  `A play's time, the half, two-point tries and returns against nflverse 2021–25 (${Math.min(played, GAMES)} AI games, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`,
);
let misses = 0;
for (const l of judgeSituations(tally)) if (!printLine(l)) misses++;
console.log(`\n${misses} line(s) outside range`);
if (misses) process.exitCode = 1;
