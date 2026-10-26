import { formPracticeSquads } from './squadMarket';
import { settleSquadPayroll } from './payroll';
import { capSpace } from '../finance/cap';
import { gameDayProblem, lockGameDayLists } from './gameDay';
import { nextElevationEvent, planAIElevations, settleElevationEvents } from './elevations';
import { serviceRoster } from './service';
import { activeRoster } from '../roster';
import type { Game, League } from '../types';
import { submitAIClaims } from './ai';
import { elevationDeadline, gameTime, managementTime, personnelClock, personnelTime } from './calendar';
import { ensureWaivers, resolveWaiverBatch } from './waivers';

export function nextWaiverDeadline(league: League): number | undefined {
  const pending = league.personnel?.waivers?.pending;
  return pending?.length ? Math.min(...pending.map((e) => e.deadline)) : undefined;
}

/** Background resolution never signs/cuts for the user unless a submitted claim authorized the cut. */
export function advancePersonnelTo(league: League, minute: number, autoUser = false): void {
  if (!league.personnel?.enabled) return;
  ensureWaivers(league);
  const clock = personnelClock(league);
  let guard = 0;
  while (true) {
    const upcoming = ['regular', 'playoffs'].includes(league.phase)
      ? league.games.filter((g) => g.season === league.season && !g.result && !g.personnel?.elevationsFiled)
      : [];
    const dressing = ['regular', 'playoffs'].includes(league.phase)
      ? league.games.filter((g) => g.season === league.season && !g.result && !g.personnel?.lists)
      : [];
    const deadlines = [
      nextWaiverDeadline(league),
      nextElevationEvent(league),
      ...upcoming.map(elevationDeadline),
      ...dressing.map((g) => gameTime(g) - 90),
    ].filter((n): n is number => n !== undefined && n <= minute);
    if (!deadlines.length) break;
    if (++guard > 512) throw new Error('Personnel events did not settle.');
    const deadline = Math.min(...deadlines);
    settleElevationEvents(league, deadline); // returns precede other business at the same instant
    if (nextWaiverDeadline(league) === deadline) {
      submitAIClaims(league, deadline, autoUser);
      resolveWaiverBatch(league, deadline);
    }
    clock.minute = Math.max(clock.minute, deadline);
    for (const g of upcoming.filter((g) => elevationDeadline(g) === deadline)) {
      planAIElevations(league, g, autoUser);
      (g.personnel ??= { plans: {} }).elevationsFiled = true;
    }
    settleElevationEvents(league, deadline);
    for (const g of dressing.filter((g) => gameTime(g) - 90 === deadline)) lockGameDayLists(league, g);
  }
  clock.minute = Math.max(clock.minute, minute);
  settleSquadPayroll(league);
}

export function nextDeadlineBlocker(league: League): string | null {
  const deadline = nextWaiverDeadline(league);
  if (deadline === undefined) return 'No waivers are pending.';
  const nextGame = league.games
    .filter((g) => g.season === league.season && !g.result)
    .sort((a, b) => gameTime(a) - gameTime(b))[0];
  if (['regular', 'playoffs'].includes(league.phase) && nextGame && gameTime(nextGame) < deadline)
    return 'Play the earlier games before advancing to this personnel deadline.';
  return null;
}

export function advanceNextPersonnelEvent(league: League, autoUser = false): void {
  const problem = nextDeadlineBlocker(league);
  if (problem) throw new Error(problem);
  advancePersonnelTo(league, nextWaiverDeadline(league)!, autoUser);
  if (nextWaiverDeadline(league) === undefined) formPracticeSquads(league, autoUser);
}

export function settleOffseasonWaivers(league: League, autoUser = false): void {
  if (!league.personnel?.enabled) return;
  let guard = 0;
  while (nextWaiverDeadline(league) !== undefined) {
    if (++guard > 256) throw new Error('Cutdown claims did not settle.');
    advancePersonnelTo(league, nextWaiverDeadline(league)!, autoUser);
  }
}

export function preparePersonnelGame(league: League, game: Game): void {
  if (!league.personnel?.enabled || game.result || (game.serviceRoster && game.personnel?.lists)) return;
  if (!['regular', 'playoffs'].includes(league.phase)) throw new Error('Finish cutdowns before playing.');
  if (game.season !== league.season) throw new Error('This game belongs to another season.');
  if (gameTime(game) < personnelTime(league)) throw new Error('This game precedes the current personnel clock.');
  const earlier = league.games.some((g) => g.season === game.season && !g.result && gameTime(g) < gameTime(game));
  if (earlier) throw new Error('Play the earlier games before preparing this kickoff.');
  advancePersonnelTo(league, gameTime(game));
  for (const id of [game.homeId, game.awayId]) {
    if (activeRoster(league, id).length > 53)
      throw new Error(`${league.teams[id].abbrev} must cut down to 53 before kickoff.`);
    if (capSpace(league, id) < 0) throw new Error(`${league.teams[id].abbrev} must get under the cap before kickoff.`);
  }
  lockGameDayLists(league, game);
  for (const id of [game.homeId, game.awayId]) {
    const issue = gameDayProblem(league, game, id);
    if (issue) throw new Error(issue);
  }
  game.serviceRoster = serviceRoster(league, game);
}

/** Keep the clock aligned when calendar phases advance, without replaying earlier notices. */
export function syncPersonnelTime(league: League): void {
  if (league.personnel?.enabled) {
    advancePersonnelTo(league, Math.max(personnelTime(league), managementTime(league)));
    if (league.phase === 'regular') formPracticeSquads(league);
  }
}
