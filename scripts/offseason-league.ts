/**
 * One more league for the offseason audit's cap-space drift check (`scripts/offseason.ts`): play `seasons` seasons on
 * a seed the way the audit plays its own and report each kickoff's cap space. The audit runs a few of these in their
 * own processes beside its league and pools every team's space, season by season.
 */
import { capSheet } from '../src/engine/finance/cap';
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { advanceOffseason, beginOffseason } from '../src/engine/offseason';
import { chairSnap, newHeadCoaches, type HcOrigin } from './carousel';

export interface CapRun {
  seed: string;
  /** Each kickoff's cap space, every team's as a share of that year's cap (%). */
  space: number[][];
  /** The run's new head coaches, by where they came from (the carousel's retread share is pooled over leagues). */
  hcFrom: Record<HcOrigin, number>;
}

const seed = process.env.OFFSEASON_SEED!;
const seasons = Number(process.env.OFFSEASON_SEASONS);
const league = createLeague({ seed, personnel: true });
const space: number[][] = [];
const hcFrom: Record<HcOrigin, number> = { retread: 0, coordinator: 0, other: 0 };
// Kickoff to kickoff, as the audit's own league counts them: an in-season firing's interim is a change too.
let before = chairSnap(league);
for (let s = 0; s < seasons; s++) {
  simToEndOfSeason(league);
  beginOffseason(league);
  while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
  const hired = newHeadCoaches(league, before);
  for (const k of Object.keys(hcFrom) as HcOrigin[]) hcFrom[k] += hired[k];
  before = chairSnap(league);
  space.push(
    league.teams.map((t) => {
      const sheet = capSheet(league, t.id);
      return (100 * sheet.space) / sheet.cap;
    }),
  );
}
process.send!({ seed, space, hcFrom } satisfies CapRun);
