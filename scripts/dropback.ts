/**
 * `npm run dropback [-- games]`: how plays end against the NFL's, fast. Plays AI games (no field) across as many leagues
 * as it takes and judges a sack's loss, how often he'd left the pocket and tacklers credited on scrambles in bounds, and
 * reports the slide share and each ending's reason (`dropback-core.ts`). Run it after changing `match/dropbackEnd.ts`,
 * `stepReason` in `match/sideline.ts` or the sack and scramble endings in `match/gameSim.ts`; `npm run sim` judges the
 * same lines.
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { judgeEndings, newEndingTally, tapEnding } from './dropback-core';
import { printLine } from './sideline-core';

const GAMES = Number(process.argv[2] ?? 200);
const tally = newEndingTally();
const t0 = Date.now();
let played = 0;
for (let k = 0; played < GAMES; k++) {
  const seed = `dropback-${k}`;
  const league = createLeague({ seed });
  for (const g of league.games.filter((g) => !g.playoffRound)) {
    if (played++ >= GAMES) break;
    simulateGame(league, g, { seed: `dropback:${seed}:${g.id}`, endingTap: (tap) => tapEnding(tally, tap) });
  }
}
console.log(
  `How plays end against nflverse 2021–25 (${Math.min(played, GAMES)} AI games, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`,
);
let misses = 0;
for (const l of judgeEndings(tally)) if (!printLine(l)) misses++;
console.log(`\n${misses} line(s) outside range`);
if (misses) process.exitCode = 1;
