/**
 * One more league for the offseason audit's cap-space drift check (`scripts/offseason.ts`): play `seasons` seasons on
 * a seed the way the audit plays its own and report each kickoff's cap space. The audit runs a few of these in their
 * own processes beside its league and pools every team's space, season by season.
 */
import { capSheet } from '../src/engine/finance/cap';
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';

export interface CapRun {
  seed: string;
  /** Each kickoff's cap space, every team's as a share of that year's cap (%). */
  space: number[][];
}

const seed = process.env.OFFSEASON_SEED!;
const seasons = Number(process.env.OFFSEASON_SEASONS);
const league = createLeague({ seed, personnel: true });
const space: number[][] = [];
for (let s = 0; s < seasons; s++) {
  simToEndOfSeason(league);
  beginOffseason(league);
  while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
  space.push(
    league.teams.map((t) => {
      const sheet = capSheet(league, t.id);
      return (100 * sheet.space) / sheet.cap;
    }),
  );
}
process.send!({ seed, space } satisfies CapRun);
