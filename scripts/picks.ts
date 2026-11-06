/**
 * `npm run picks [-- games]`: picks and breakups against the NFL's, fast. Plays AI games (no field) across as many leagues
 * as it takes and judges who picks it off and breaks it up by depth, and the pick's return (`picks-core.ts`). Run it
 * after changing `match/defendedPass.ts` or the pick and incompletion branches in `match/gameSim.ts`; `npm run sim`
 * judges the same lines.
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import { judgePicks, newPickTally, tapDefended } from './picks-core';
import { printLine } from './sideline-core';

const GAMES = Number(process.argv[2] ?? 200);
const tally = newPickTally();
const t0 = Date.now();
let played = 0;
for (let k = 0; played < GAMES; k++) {
  const seed = `picks-${k}`;
  const league = createLeague({ seed });
  for (const g of league.games.filter((g) => !g.playoffRound)) {
    if (played++ >= GAMES) break;
    simulateGame(league, g, { seed: `picks:${seed}:${g.id}`, defendedTap: (tap) => tapDefended(tally, tap) });
  }
}
console.log(
  `Picks and breakups against nflverse 2021–25 (${Math.min(played, GAMES)} AI games, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`,
);
let misses = 0;
for (const l of judgePicks(tally)) if (!printLine(l)) misses++;
console.log(`\n${misses} line(s) outside range`);
if (misses) process.exitCode = 1;
