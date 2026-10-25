/**
 * The offseason calendar. `beginOffseason` opens the new league year (cap growth, ageing,
 * the draft order); `advanceOffseason` moves one step at a time:
 *
 *   resign → free agency (day 1 … FA_DAYS) → draft → preseason (cut to 53) → regular season
 *
 * AI teams act at each step. The user's team acts through the UI, or is auto-managed by the
 * same AI when simulating straight through (`simOffseason`).
 */
import { retireChance } from '../aging';
import { coachingFor, coachWindowCloses, developCoaches, ensureCoached, noteCoachOverspend } from '../coaching';
import { beginYear, developBlock, playedShare, recordRatings, trueUp } from '../development';
import { concussionRetireChance, delegates, injuriesNewYear, injuryRetireChance, manageInjuries } from '../injuries';
import { developMedics, ensureMedical, medicalWindowCloses } from '../medical';
import { crewsNewYear } from '../officials';
import { accelerateProration, capSheet, capSpace, logTransaction, nextCap } from '../finance/cap';
import { isExpired, trimPast } from '../finance/contract';
import { playerOvr, STARTERS } from '../positions';
import { Rng } from '../rng';
import { activeRoster, syncDepthChart, teamPlayers } from '../roster';
import { quirkOffseason } from '../quirks';
import { resetScouting } from '../scouting';
import { developStaff, ensureStaffed, staffWindowCloses } from '../staff';
import { generateSchedule } from '../season/schedule';
import { bodyAs, completeMoves, learnBlock, planMoves } from '../training';
import { expireOffers, marketMoment, recheckOffers, TRADE_DEADLINE_WEEK } from '../trade';
import { divisionStandings } from '../season/standings';
import type { League, Phase, Player } from '../types';
import { POSITIONS } from '../types';
import { aiCapCompliance, aiFreeAgencyDay, aiResignWindow, aiTrainingCamp } from './ai';
import {
  aiDraftChoice,
  draftComplete,
  draftPlayer,
  finishDraft,
  generateDraftClass,
  nextPick,
  setDraftOrder,
  simDraft,
} from './draft';
import { resetContenderCache, ROSTER_MAX } from './negotiation';
import { archiveService, ensureService } from '../personnel/service';
import { personnelClock } from '../personnel/calendar';
import { settleOffseasonWaivers, syncPersonnelTime } from '../personnel/flow';
import { ensureWaivers } from '../personnel/waivers';

export const FA_DAYS = 5;

/** The new league year: cap, carryover, ageing and retirements, the draft order and class, the schedule. */
export function beginOffseason(league: League): void {
  if (league.phase !== 'complete') throw new Error('The season is not finished');
  settleOffseasonWaivers(league);
  expireOffers(league);
  resetContenderCache(league);
  const rng = new Rng(league.rngState);
  const last = league.season;
  const order = divisionStandings(league).map((d) => d.teams.map((r) => r.teamId));
  const carry = league.teams.map((t) => Math.max(0, capSheet(league, t.id).space));

  league.season++;
  // The cap's path is drawn on its own stream: on the shared one, any change in what a season draws
  // reshuffled every later cap (a revenue shock landing or not), and the offseason audit's numbers with it.
  league.caps[league.season] = nextCap(new Rng(`${league.seed}:cap:${league.season}`), league.caps[last]);
  for (const team of league.teams) {
    team.carryover = carry[team.id];
    team.postJune1Used = 0;
    team.taggedId = null;
    team.deadMoney = team.deadMoney.filter((d) => d.season >= last);
  }
  setDraftOrder(league, last);
  noteCoachOverspend(league);

  const retirees: Player[] = [];
  for (const p of Object.values(league.players)) {
    if (p.retired) continue;
    // Initialize newly generated fill-ins before calendar experience advances; service is not experience.
    archiveService(ensureService(p, last), last);
    // Each player's year runs on his own stream: tuning development never reshuffles drafts or
    // schedules, and one player's year doesn't depend on who was developed before him. His coaches
    // are the ones he finished the season with (their deals may be up, but they coached him).
    const own = new Rng(`${league.seed}:dev:${league.season}:${p.id}`);
    // Whatever of last year hadn't landed lands first; then this year is rolled and its March share released.
    trueUp(league, p);
    beginYear(league, own, p, {
      playedShare: playedShare(p, last),
      ...coachingFor(league, p.teamId, p.position),
      bodyAs: bodyAs(p),
    });
    p.age++;
    p.experience++;
    // Age and form, or a body (`injuryRetireChance`) or a head (`concussionRetireChance`) that can't take any more, in one roll.
    const body = injuryRetireChance(p, league.season);
    const head = concussionRetireChance(p, league.season);
    const worn = 1 - (1 - body) * (1 - head);
    if (own.chance(1 - (1 - retireChance(p, playerOvr(p))) * (1 - worn))) {
      if (p.teamId !== null) {
        // Retiring under contract: every remaining bonus dollar accelerates.
        accelerateProration(league, p, p.teamId, 'Retired');
        if (playerOvr(p) >= 14 || (worn > 0 && p.teamId === league.userTeamId))
          logTransaction(
            league,
            'retire',
            [p.teamId],
            `${league.teams[p.teamId].abbrev} ${p.position} ${p.firstName} ${p.lastName} retired${head > body ? ' (concussions)' : worn > 0 ? ' (injuries)' : ''}`,
          );
      }
      p.teamId = null;
      p.contract = null;
      p.retired = true;
      // A retired player keeps his record (stats, awards, injuries, draft, habits) and his last ratings for his card;
      // what only a developing player needs goes, or the save grows with every class that ages out.
      delete p.quirkBag;
      delete p.learning;
      delete p.dev;
      delete p.ratingHistory;
      retirees.push(p);
      continue;
    }
    // Deals that just ran out keep their final year (the franchise tag is priced off it) until
    // free agency opens and clears them.
    if (p.contract && !isExpired(p.contract, league.season)) trimPast(p.contract, league.season);
    recordRatings(p, league.season);
    quirkOffseason(league, p);
  }
  injuriesNewYear(league);
  resetScouting(league);
  developStaff(league);
  developCoaches(league, retirees);
  developMedics(league);
  crewsNewYear(league);

  generateDraftClass(league, rng);
  league.games = league.games.filter((g) => g.season >= last);
  // Last season's games keep their box scores and scoring plays; full replays are for the season being played.
  for (const g of league.games) if (g.result?.plays) g.result.plays = g.result.plays.filter((p) => p.scoring);
  league.games.push(...generateSchedule(league, rng, order));
  league.week = 1;
  league.phase = 'resign';
  if (league.personnel?.enabled) ensureWaivers(league);
  league.faDay = 0;
  league.negotiations = {};
  for (const team of league.teams) syncDepthChart(league, team);
  league.rngState = rng.getState();
  // The new league year opens the trade market: deals agreed over the winter, cap casualties, stars on the move.
  marketMoment(league, 'leagueYear');
}

/** Problems the user must fix before the calendar can move on (the season's weeks included). */
export function offseasonBlockers(league: League): string[] {
  const issues: string[] = [];
  const teamId = league.userTeamId;
  // A team must be under the cap every week of the season, not just at kickoff. (The playoffs pay nothing more
  // and sign nobody, so a team that got there under the cap isn't stopped there.) Restructures wait for the
  // offseason; a release frees what's left of a deal that isn't guaranteed.
  if (league.phase === 'regular' && capSpace(league, teamId) < 0) {
    const fix =
      league.week <= TRADE_DEADLINE_WEEK
        ? 'release or trade a player'
        : 'release a player (the trade deadline has passed)';
    issues.push(`You're $${(-capSpace(league, teamId) / 1000).toFixed(1)}M over the cap: ${fix} before playing on.`);
  }
  if (league.phase === 'resign' && capSpace(league, teamId) < 0)
    issues.push('Get under the cap before free agency opens: release, restructure or trade.');
  if (league.phase === 'preseason') {
    // Injured reserve doesn't count toward the 53.
    const roster = activeRoster(league, teamId);
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
  if (league.personnel?.enabled && league.phase === 'preseason' && !opts.autoUser) {
    const blockers = offseasonBlockers(league);
    if (blockers.length) throw new Error(blockers.join(' '));
  }
  if (league.phase !== 'preseason') settleOffseasonWaivers(league, !!opts.autoUser);
  // Offers you didn't answer lapse at the next calendar step.
  expireOffers(league);
  resetContenderCache(league);
  const rng = new Rng(league.rngState);
  const auto = !!opts.autoUser;
  const ai = league.teams.filter((t) => auto || t.id !== league.userTeamId);
  switch (league.phase) {
    case 'resign':
      for (const team of ai) aiResignWindow(league, team, rng);
      if (!auto) {
        // Undecided options lapse at the deadline.
        for (const p of teamPlayers(league, league.userTeamId))
          if (p.contract?.fifthYearOption === 'eligible' && p.contract.years.at(-1)!.season === league.season)
            p.contract.fifthYearOption = 'declined';
      }
      // Expiring staff and coaches are decided with the players; open chairs are filled from the markets.
      staffWindowCloses(league, { autoUser: auto });
      coachWindowCloses(league, { autoUser: auto });
      medicalWindowCloses(league, { autoUser: auto });
      openFreeAgency(league);
      // The void years that just accelerated land after the window's compliance pass: an AI team they put
      // over the cap gets under before the market opens, as the league year demands.
      for (const team of ai) if (capSpace(league, team.id) < 0) aiCapCompliance(league, team);
      league.phase = 'freeAgency';
      league.faDay = 1;
      break;
    case 'freeAgency':
      aiFreeAgencyDay(league, rng, { includeUser: auto });
      marketMoment(league, 'faDay');
      if (league.faDay < FA_DAYS) league.faDay++;
      else league.phase = 'draft';
      break;
    case 'draft':
      simDraft(league, rng, { stopAtUser: false });
      finishDraft(league);
      league.phase = 'preseason';
      // Camp opens: anyone still hurt going into week 1 can go on reserve, off the 53 (yours too, unless you manage injuries).
      for (const team of league.teams) if (delegates(league, team)) manageInjuries(league, team, rng);
      // Coaches pick the position moves they'll teach, then the spring program's learning (docs/TRAINING.md §4).
      planMoves(league);
      learnBlock(league, 'program');
      developBlock(league, 'program');
      break;
    case 'preseason':
      if (league.personnel?.enabled && personnelClock(league).cutdown) {
        settleOffseasonWaivers(league, auto);
      } else {
        // Camp's learning, then cut-down day's position changes, before any camp deal or cut sees the rosters.
        learnBlock(league, 'camp');
        developBlock(league, 'camp');
        completeMoves(league);
        // Camp: teams with surplus deal it before the cut to 53.
        marketMoment(league, 'camp');
        for (const team of ai) aiTrainingCamp(league, team, rng);
        ensureStaffed(league, { autoUser: auto });
        ensureCoached(league, { autoUser: auto });
        ensureMedical(league, { autoUser: auto });
        if (league.personnel?.enabled) {
          personnelClock(league).cutdown = true;
          break; // Give the manager the complete league-wide cutdown wire before awarding anyone.
        }
      }
      league.phase = 'regular';
      league.week = 1;
      league.faDay = 0;
      league.negotiations = {};
      for (const team of league.teams) syncDepthChart(league, team);
      break;
    default:
      throw new Error(`Not in the offseason (${league.phase})`);
  }
  // Offers filed at this step's market moment are judged again on the state you'll accept in: camp's cuts,
  // signings and the phase switch (roster limits in season) can turn a bid its own team made into a refusal.
  recheckOffers(league);
  syncPersonnelTime(league);
  league.rngState = rng.getState();
  return league.phase;
}

/** From the end of a season to week 1 of the next, with every team (yours too) run by the AI. */
export function simOffseason(league: League): void {
  if (league.phase === 'complete') beginOffseason(league);
  for (let guard = 0; guard < 256 && league.phase !== 'regular'; guard++) advanceOffseason(league, { autoUser: true });
  if (league.phase !== 'regular') throw new Error('The offseason did not reach opening week.');
}

/** Run an RNG-using step with the league's own generator, saving its state afterwards. */
function withRng<T>(league: League, fn: (rng: Rng) => T): T {
  const rng = new Rng(league.rngState);
  const out = fn(rng);
  league.rngState = rng.getState();
  return out;
}

/** Draft room controls for the user. */
export const draftNextPick = (league: League) =>
  withRng(league, (rng) => simDraft(league, rng, { stopAtUser: true, limit: 1 }));
export const draftToUserPick = (league: League) =>
  withRng(league, (rng) => simDraft(league, rng, { stopAtUser: true }));
export const draftToEnd = (league: League) => withRng(league, (rng) => simDraft(league, rng, { stopAtUser: false }));
export function draftForUser(league: League, playerId?: number): void {
  const pick = nextPick(league);
  if (!pick || pick.ownerId !== league.userTeamId) throw new Error('You are not on the clock');
  const player =
    playerId !== undefined
      ? league.players[playerId]
      : withRng(league, (rng) => aiDraftChoice(league, pick.ownerId, rng, pick.round));
  draftPlayer(league, pick, player);
}

/** Training camp shortcut: let the AI make your cuts (and sign fill-ins at the minimum). */
export const autoCutdown = (league: League) =>
  withRng(league, (rng) => aiTrainingCamp(league, league.teams[league.userTeamId], rng));

export { draftComplete };
