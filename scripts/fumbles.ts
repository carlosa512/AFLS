/**
 * `npm run fumbles [-- games]`: contact fumbles, strip-sacks and who gets the loose ball against the NFL's, fast. Plays AI games (no field) across as many leagues
 * as it takes and judges the buckets, the forced share and the spread between backs (`fumbles-core.ts`). Run it after
 * changing `match/fumbleOdds.ts` or the fumble rolls in `match/gameSim.ts`; `npm run sim` judges the buckets.
 */
import { createLeague } from '../src/engine/generate';
import { simulateGame } from '../src/engine/match/gameSim';
import {
  carrierSpread,
  judgeFumbles,
  judgeRecoveries,
  judgeStrips,
  newFumbleTally,
  tapContact,
  tapStrip,
} from './fumbles-core';
import { printLine } from './sideline-core';

const GAMES = Number(process.argv[2] ?? 200);
const tally = newFumbleTally();
const t0 = Date.now();
// As many leagues as the games asked for (a league's regular season is 272 games).
let played = 0;
for (let k = 0; played < GAMES; k++) {
  const seed = `fumbles-${k}`;
  const league = createLeague({ seed });
  for (const g of league.games.filter((g) => !g.playoffRound)) {
    if (played++ >= GAMES) break;
    simulateGame(league, g, {
      seed: `fumbles:${seed}:${g.id}`,
      contactTap: (tap) => tapContact(tally, tap, `${k}:${tap.carrier}`),
      stripTap: (tap) => tapStrip(tally, tap),
    });
  }
}
const games = Math.min(played, GAMES);
console.log(
  `Contact fumbles against nflverse 2021–25 (${games} AI games, ${((Date.now() - t0) / 1000).toFixed(0)} s)\n`,
);
let misses = 0;
for (const l of [...judgeFumbles(tally), ...carrierSpread(tally), ...judgeStrips(tally), ...judgeRecoveries(tally)])
  if (!printLine(l)) misses++;
console.log(`\n${misses} line(s) outside range`);
if (misses) process.exitCode = 1;
