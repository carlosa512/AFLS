import { formPracticeSquads } from './squadMarket';
import { settleSquadPayroll } from './payroll';
import { capSpace } from '../finance/cap';
import { gameDayProblem, lockGameDayLists } from './gameDay';
import { fileGameElevations, planAIElevations, revertElevations } from './elevations';
import { serviceRoster } from './service';
import { activeRoster } from '../roster';
import type { Game, League } from '../types';
import { submitAIClaims } from './ai';
import { gameTime, personnelClock } from './calendar';
import { ensureWaivers, resolveWaiverBatch } from './waivers';
import { lockProtections, resolvePoaching, submitAIPoachOffers } from './poaching';
import type { WaiverResult } from './types';

export const waiversPending = (league: League): boolean => !!league.personnel?.waivers?.pending.length;

/**
 * Close the open batch and resolve everything posted before it, by priority. AI clubs claim against that one
 * world; cuts its awards cause join the next batch. Never signs or cuts for the user beyond a submitted claim.
 */
export function settleWaivers(league: League, autoUser = false): WaiverResult[] {
  if (!league.personnel?.enabled || !waiversPending(league)) return [];
  const state = ensureWaivers(league);
  const closing = state.batch;
  submitAIClaims(league, closing, autoUser);
  const results = resolveWaiverBatch(league, closing);
  settleSquadPayroll(league);
  return results;
}

/** The week's one settle point, before its first kickoff. Later releases wait for next week. */
export function settleWeek(league: League): void {
  if (!league.personnel?.enabled) return;
  const clock = personnelClock(league);
  if (clock.settledWeek === league.week) return;
  settleWaivers(league);
  if (league.phase === 'regular') {
    lockProtections(league);
    submitAIPoachOffers(league);
    resolvePoaching(league);
  }
  clock.settledWeek = league.week;
}

/** Offseason steps settle until the wire is empty: cutdown churn resolves without extra choices. */
export function settleOffseasonWaivers(league: League, autoUser = false): void {
  if (!league.personnel?.enabled) return;
  for (let guard = 0; waiversPending(league); guard++) {
    if (guard >= 256) throw new Error('Cutdown claims did not settle.');
    settleWaivers(league, autoUser);
  }
}

/** File a game's call-ups: AI clubs plan theirs, then every plan is rechecked once. */
export function fileElevations(league: League, game: Game, autoUser = false): void {
  if (game.personnel?.elevationsFiled) return;
  planAIElevations(league, game, autoUser);
  fileGameElevations(league, game);
  (game.personnel ??= { plans: {} }).elevationsFiled = true;
}

export function preparePersonnelGame(league: League, game: Game): void {
  if (!league.personnel?.enabled || game.result || (game.serviceRoster && game.personnel?.lists)) return;
  if (!['regular', 'playoffs'].includes(league.phase)) throw new Error('Finish cutdowns before playing.');
  if (game.season !== league.season) throw new Error('This game belongs to another season.');
  const earlier = league.games.some((g) => g.season === game.season && !g.result && gameTime(g) < gameTime(game));
  if (earlier) throw new Error('Play the earlier games before preparing this kickoff.');
  settleWeek(league);
  // Refuse an illegal roster before filing anything, so the fix can still change this game's call-ups.
  for (const id of [game.homeId, game.awayId]) {
    if (activeRoster(league, id).length > 53)
      throw new Error(`${league.teams[id].abbrev} must cut down to 53 before kickoff.`);
    if (capSpace(league, id) < 0) throw new Error(`${league.teams[id].abbrev} must get under the cap before kickoff.`);
  }
  fileElevations(league, game);
  lockGameDayLists(league, game);
  for (const id of [game.homeId, game.awayId]) {
    const issue = gameDayProblem(league, game, id);
    if (issue) throw new Error(issue);
  }
  game.serviceRoster = serviceRoster(league, game);
}

/** After a game: its call-ups go back to the practice squad. */
export function finishPersonnelGame(league: League, game: Game): void {
  if (league.personnel?.enabled) revertElevations(league, game);
}

/** After each week and calendar step: pay the squads and, in season, fill open squad places. */
export function syncPersonnel(league: League): void {
  if (!league.personnel?.enabled) return;
  settleSquadPayroll(league);
  if (league.phase === 'regular') formPracticeSquads(league);
}
