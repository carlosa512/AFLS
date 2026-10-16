/**
 * The offseason calendar. `beginOffseason` opens the new league year (cap growth, ageing,
 * the draft order); `advanceOffseason` moves one step at a time:
 *
 *   resign → free agency (day 1 … FA_DAYS) → draft → preseason (cut to 53) → regular season
 *
 * AI teams act at each step. The user's team acts through the UI, or is auto-managed by the
 * same AI when simulating straight through (`simOffseason`).
 */
import { developPlayer, recordRatings } from '../development';
import { accelerateProration, capSheet, capSpace, logTransaction, nextCap } from '../finance/cap';
import { isExpired, trimPast } from '../finance/contract';
import { playerOvr, STARTERS } from '../positions';
import { Rng } from '../rng';
import { syncDepthChart, teamPlayers } from '../roster';
import { resetScouting } from '../scouting';
import { generateSchedule } from '../season/schedule';
import { divisionStandings } from '../season/standings';
import type { League, Phase, Player } from '../types';
import { POSITIONS } from '../types';
import { aiFreeAgencyDay, aiResignWindow, aiTrainingCamp } from './ai';
import { aiDraftChoice, draftComplete, draftPlayer, finishDraft, generateDraftClass, nextPick, setDraftOrder, simDraft } from './draft';
import { resetContenderCache, ROSTER_MAX } from './negotiation';

export const FA_DAYS = 5;

function retires(rng: Rng, p: Player): boolean {
  const ovr = playerOvr(p);
  if (p.teamId === null) return p.age >= 31 || ovr < 8 ? rng.chance(0.6) : rng.chance(0.2);
  return p.age >= 37 || (p.age >= 31 && ovr < 8 && rng.chance(0.5)) || (p.age >= 34 && rng.chance(0.35));
}

/** The new league year: cap, carryover, ageing and retirements, the draft order and class, the schedule. */
export function beginOffseason(league: League): void {
  if (league.phase !== 'complete') throw new Error('The season is not finished');
  resetContenderCache(league);
  const rng = new Rng(league.rngState);
  const last = league.season;
  const order = divisionStandings(league).map((d) => d.teams.map((r) => r.teamId));
  const carry = league.teams.map((t) => Math.max(0, capSheet(league, t.id).space));

  league.season++;
  league.caps[league.season] = nextCap(rng, league.caps[last]);
  for (const team of league.teams) {
    team.carryover = carry[team.id];
    team.postJune1Used = 0;
    team.taggedId = null;
    team.deadMoney = team.deadMoney.filter((d) => d.season >= last);
  }
  setDraftOrder(league, last);

  for (const p of Object.values(league.players)) {
    if (p.retired) continue;
    developPlayer(rng, p);
    p.age++;
    p.experience++;
    if (retires(rng, p)) {
      if (p.teamId !== null) {
        // Retiring under contract: every remaining bonus dollar accelerates.
        accelerateProration(league, p, p.teamId, 'Retired');
        if (playerOvr(p) >= 14) logTransaction(league, 'retire', [p.teamId], `${league.teams[p.teamId].abbrev} ${p.position} ${p.firstName} ${p.lastName} retired`);
      }
      p.teamId = null;
      p.contract = null;
      p.retired = true;
      continue;
    }
    // Deals that just ran out keep their final year (the franchise tag is priced off it) until
    // free agency opens and clears them.
    if (p.contract && !isExpired(p.contract, league.season)) trimPast(p.contract, league.season);
    recordRatings(p, league.season);
  }
  resetScouting(league);

  generateDraftClass(league, rng);
  league.games = league.games.filter((g) => g.season >= last);
  league.games.push(...generateSchedule(league, rng, order));
  league.week = 1;
  league.phase = 'resign';
  league.faDay = 0;
  league.negotiations = {};
  for (const team of league.teams) syncDepthChart(league, team);
  league.rngState = rng.getState();
}

/** Problems the user must fix before the calendar can move on. */
export function offseasonBlockers(league: League): string[] {
  const issues: string[] = [];
  const teamId = league.userTeamId;
  if (league.phase === 'resign' && capSpace(league, teamId) < 0) issues.push('Get under the cap before free agency opens: release, restructure or trade.');
  if (league.phase === 'preseason') {
    const roster = teamPlayers(league, teamId);
    if (roster.length > ROSTER_MAX) issues.push(`Cut down to ${ROSTER_MAX} players (you have ${roster.length}).`);
    for (const pos of POSITIONS) {
      const n = roster.filter((p) => p.position === pos).length;
      if (n < STARTERS[pos]) issues.push(`You need at least ${STARTERS[pos]} ${pos} (you have ${n}).`);
    }
    if (capSpace(league, teamId) < 0) issues.push('Get under the cap before the season starts.');
  }
  return issues;
}

/** Contracts that ran out and weren't re-signed: their void years accelerate and the players hit the market. */
function openFreeAgency(league: League): void {
  for (const p of Object.values(league.players)) {
    if (p.teamId === null || !p.contract || !isExpired(p.contract, league.season)) continue;
    accelerateProration(league, p, p.teamId);
    p.teamId = null;
    p.contract = null;
  }
  for (const team of league.teams) syncDepthChart(league, team);
  league.negotiations = {};
}

/** Move the offseason one step. With `autoUser`, the user's team is run by the AI too. */
export function advanceOffseason(league: League, opts: { autoUser?: boolean } = {}): Phase {
  resetContenderCache(league);
  const rng = new Rng(league.rngState);
  const auto = !!opts.autoUser;
  const ai = league.teams.filter((t) => auto || t.id !== league.userTeamId);
  switch (league.phase) {
    case 'resign':
      for (const team of ai) aiResignWindow(league, team, rng);
      if (!auto) {
        // Undecided options lapse at the deadline.
        for (const p of teamPlayers(league, league.userTeamId)) if (p.contract?.fifthYearOption === 'eligible' && p.contract.years.at(-1)!.season === league.season) p.contract.fifthYearOption = 'declined';
      }
      openFreeAgency(league);
      league.phase = 'freeAgency';
      league.faDay = 1;
      break;
    case 'freeAgency':
      aiFreeAgencyDay(league, rng, { includeUser: auto });
      if (league.faDay < FA_DAYS) league.faDay++;
      else league.phase = 'draft';
      break;
    case 'draft':
      simDraft(league, rng, { stopAtUser: false });
      finishDraft(league);
      league.phase = 'preseason';
      break;
    case 'preseason':
      for (const team of ai) aiTrainingCamp(league, team, rng);
      league.phase = 'regular';
      league.week = 1;
      league.faDay = 0;
      league.negotiations = {};
      for (const team of league.teams) syncDepthChart(league, team);
      break;
    default:
      throw new Error(`Not in the offseason (${league.phase})`);
  }
  league.rngState = rng.getState();
  return league.phase;
}

/** From the end of a season to week 1 of the next, with every team (yours too) run by the AI. */
export function simOffseason(league: League): void {
  if (league.phase === 'complete') beginOffseason(league);
  for (let guard = 0; guard < 20 && league.phase !== 'regular'; guard++) advanceOffseason(league, { autoUser: true });
}

/** Run an RNG-using step with the league's own generator, saving its state afterwards. */
function withRng<T>(league: League, fn: (rng: Rng) => T): T {
  const rng = new Rng(league.rngState);
  const out = fn(rng);
  league.rngState = rng.getState();
  return out;
}

/** Draft room controls for the user. */
export const draftToUserPick = (league: League) => withRng(league, (rng) => simDraft(league, rng, { stopAtUser: true }));
export const draftToEnd = (league: League) => withRng(league, (rng) => simDraft(league, rng, { stopAtUser: false }));
export function draftForUser(league: League, playerId?: number): void {
  const pick = nextPick(league);
  if (!pick || pick.ownerId !== league.userTeamId) throw new Error('You are not on the clock');
  const player = playerId !== undefined ? league.players[playerId] : withRng(league, (rng) => aiDraftChoice(league, pick.ownerId, rng, pick.round));
  draftPlayer(league, pick, player);
}

/** Training camp shortcut: let the AI make your cuts (and sign fill-ins at the minimum). */
export const autoCutdown = (league: League) => withRng(league, (rng) => aiTrainingCamp(league, league.teams[league.userTeamId], rng));

export { draftComplete };
