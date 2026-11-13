/**
 * Two saves for reviewing screens before and after a change (`npm run screens -- --save …`).
 *
 *   npm run review-saves -- --out <dir>
 *
 * Builds a new career the way New Game does (`startCareer` in `ui/screens/NewGame.tsx`, not imported: it pulls the
 * browser store), plays six weeks and writes `week7.json`, then steps the calendar as the Continue button would (the
 * AI making your offseason calls) until the draft and writes `draft.json`. The seed is fixed, so a review's "before"
 * and "after" shots show the same league.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLeague } from '../src/engine/generate';
import { deliverMail } from '../src/engine/inbox';
import { playWeek } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import type { League } from '../src/engine/types';

const args = process.argv.slice(2);
const i = args.indexOf('--out');
if (i < 0 || !args[i + 1]) {
  console.error('Usage: npm run review-saves -- --out <dir>');
  process.exit(2);
}
const out = resolve(args[i + 1]);
mkdirSync(out, { recursive: true });

const league: League = createLeague({
  seed: 'uireview',
  userTeamId: 9,
  inheritStaff: true,
  personnel: true,
  spatialField: true,
});
deliverMail(league);

const write = (name: string) => {
  writeFileSync(join(out, name), JSON.stringify(league));
  console.log(`${name}  ${league.season} ${league.phase}, week ${league.week}`);
};

for (let w = 0; w < 6; w++) {
  playWeek(league);
  deliverMail(league);
}
write('week7.json');

for (let n = 0; n < 80 && league.phase !== 'draft'; n++) {
  if (league.phase === 'regular' || league.phase === 'playoffs') playWeek(league);
  else if (league.phase === 'complete') beginOffseason(league);
  else advanceOffseason(league, { autoUser: true });
  deliverMail(league);
}
if (league.phase !== 'draft') {
  console.error(`Never reached the draft (stopped at ${league.phase}).`);
  process.exit(1);
}
write('draft.json');
