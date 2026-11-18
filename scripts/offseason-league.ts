/**
 * One more league for the offseason audit's cap-space drift check (`scripts/offseason.ts`): play `seasons` seasons on
 * a seed the way the audit plays its own and report each kickoff's cap space. The audit runs a few of these in their
 * own processes beside its league and pools every team's space, season by season.
 */
import { capSheet } from '../src/engine/finance/cap';
import { createLeague } from '../src/engine/generate';
import { simToEndOfSeason } from '../src/engine/league';
import { beginOffseason } from '../src/engine/offseason';
import { playToKickoff, type SeasonFlow } from './cap-books-core';
import { chairSnap, newHeadCoaches, type HcOrigin } from './carousel';
import { faMeasures, kickoffStarters, outOfFootball, windowStart, type FaMeasures } from './free-agency-core';

export interface CapRun {
  seed: string;
  /** Each kickoff's cap space, every team's as a share of that year's cap (%). */
  space: number[][];
  /** The run's new head coaches, by where they came from (the carousel's retread share is pooled over leagues). */
  hcFrom: Record<HcOrigin, number>;
  /** Each season's market at kickoff and its starters out of football (%), for the pooled market lines. */
  market: FaMeasures[];
  out: number[];
  /** Every kickoff's cap-books measures (`cap-books-core.ts`), through the drift seasons. */
  flows: SeasonFlow[];
}

const seed = process.env.OFFSEASON_SEED!;
const seasons = Number(process.env.OFFSEASON_SEASONS);
// The cap books' drift lines read ten seasons (2026-11-18); everything else reads the audit's own `seasons`.
const played = Math.max(seasons, Number(process.env.OFFSEASON_DRIFT_SEASONS ?? 0));
const flows: SeasonFlow[] = [];
const league = createLeague({ seed, personnel: true });
const space: number[][] = [];
const hcFrom: Record<HcOrigin, number> = { retread: 0, coordinator: 0, other: 0 };
// Kickoff to kickoff, as the audit's own league counts them: an in-season firing's interim is a change too.
let before = chairSnap(league);
const market: FaMeasures[] = [];
const out: number[] = [];
let lastStarters = kickoffStarters(league);
for (let s = 0; s < played; s++) {
  simToEndOfSeason(league);
  beginOffseason(league);
  const start = windowStart(league);
  flows.push(playToKickoff(league));
  if (s < seasons) {
    market.push(faMeasures(start, league));
    out.push(outOfFootball(league, lastStarters));
    const hired = newHeadCoaches(league, before);
    for (const k of Object.keys(hcFrom) as HcOrigin[]) hcFrom[k] += hired[k];
  }
  lastStarters = kickoffStarters(league);
  before = chairSnap(league);
  space.push(
    league.teams.map((t) => {
      const sheet = capSheet(league, t.id);
      return (100 * sheet.space) / sheet.cap;
    }),
  );
}
process.send!({ seed, space, hcFrom, market, out, flows } satisfies CapRun);
