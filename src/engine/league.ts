import { moraleWeek } from './morale';
import { mentoringWeek } from './mentoring';
import { coachQuirksWeek, recordCoachEvidence } from './coachQuirks';
import { coachTeachingWeek, updateCoachAdvice } from './coachDecisions';
/**
 * Season orchestration: playing weeks, moving into the playoffs, crowning a
 * champion, and rolling the league into the next season.
 */
import { awardSeason, awardWeek } from './awards';
import { leadershipWeek } from './leadership';
import { withLeagueAi } from './employment';
import { simulateGame, startGame, type LiveGame } from './match/gameSim';
import { developWeek } from './development';
import { applyInjury, injuryWeek } from './injuries';
import { simOffseason } from './offseason';
import { quirkWeek, recordForm } from './quirks';
import { expireOffers, marketMoment, recheckOffers, weekMoment } from './trade';
import { syncDepthChart, teamPlayers, isAvailable } from './roster';
import { flexWeek } from './season/flex';
import { trainingWeek } from './training';
import { playoffGames, scheduleNextRound, winnerOf } from './season/playoffs';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { settleFinished } from './ceiling';
import { computeRecords } from './season/standings';
import { addStats } from './stats';
import { captureManagement, creditManagement } from './service';
import { teamCoaches } from './coaching';
import { playoffSummary } from './records';
import { recordGameService, serviceRoster } from './personnel/service';
import { gameTime } from './personnel/calendar';
import { finishPersonnelGame, preparePersonnelGame, syncPersonnel } from './personnel/flow';
import type { Game, GameResult, League, Player } from './types';

export function gamesInWeek(league: League, week = league.week): Game[] {
  return league.games.filter((g) => g.season === league.season && g.week === week);
}

export function userGame(league: League, week = league.week): Game | undefined {
  return gamesInWeek(league, week).find((g) => g.homeId === league.userTeamId || g.awayId === league.userTeamId);
}

/**
 * The trade market after the week's games, up to deadline day after week 9 (never with the user
 * unasked). It draws from its own stream, like injuries and weather (`trade/market.ts`).
 */
function aiTrades(league: League) {
  marketMoment(league, weekMoment(league));
}

/** Keep full play-by-play only for the user's games and the most recent week (a new league year trims the rest, `beginOffseason`). */
function prunePlayLogs(league: League) {
  for (const g of league.games) {
    if (!g.result?.plays || g.week >= league.week - 1) continue;
    if (g.homeId === league.userTeamId || g.awayId === league.userTeamId) continue;
    g.result.plays = g.result.plays.filter((p) => p.scoring);
    delete g.result.field;
  }
}

function prepareGame(league: League, game: Game) {
  preparePersonnelGame(league, game);
  syncDepthChart(league, league.teams[game.homeId]);
  syncDepthChart(league, league.teams[game.awayId]);
  if (!game.result) game.serviceRoster ??= serviceRoster(league, game);
}

/** Store a finished game's result, apply what it did to bodies, and credit regular-season stats. */
export function recordResult(league: League, game: Game, result: GameResult): void {
  if (game.result) return;
  if (league.personnel?.enabled && !game.serviceRoster) throw new Error('Prepare the game before recording a result.');
  recordGameService(league, game);
  finishPersonnelGame(league, game);
  // Condition and diagnoses are carried by the players, not the game record.
  const { condition, diagnoses, ...kept } = result;
  game.result = kept;
  creditManagement(league, game);
  for (const [id, c] of Object.entries(condition ?? {})) {
    const p = league.players[Number(id)];
    if (p && c < (p.condition ?? 100)) p.condition = c;
  }
  for (const { playerId } of result.injuries ?? []) {
    const p = league.players[playerId];
    const hurt = diagnoses?.[playerId];
    if (p && hurt) applyInjury(league, p, hurt.injury, hurt.scar);
  }
  // Form and the marbles a game drops in a player's bag (playoffs too: a big game leaves a mark).
  for (const [id, line] of Object.entries(result.playerStats)) {
    const player = league.players[Number(id)];
    if (player) recordForm(league, player, game.week, line, result.form?.[Number(id)]);
  }
  recordCoachEvidence(league, result.coaching);
  if (game.playoffRound) return; // Season stat totals are regular season only.
  for (const [id, line] of Object.entries(result.playerStats)) {
    const player = league.players[Number(id)];
    if (!player) continue;
    const teamId = result.playerTeams[Number(id)] ?? player.teamId;
    if (teamId !== null && teamId !== undefined) creditTeam(player, game.season, teamId);
    addStats((player.stats[game.season] ??= {}), line);
    const split = player.splitStats?.[game.season];
    if (split && teamId !== null && teamId !== undefined) addStats((split[teamId] ??= {}), line);
  }
}

/**
 * Notes which team a player's stats were earned for. The first time a season is split between teams,
 * everything so far belongs to the earlier team: that becomes its line, and each team keeps its own from then on.
 */
function creditTeam(player: Player, season: number, teamId: number) {
  const teams = ((player.statTeams ??= {})[season] ??= []);
  if (teams.includes(teamId)) return;
  if (teams.length && !player.splitStats?.[season]) {
    (player.splitStats ??= {})[season] = { [teams[teams.length - 1]]: { ...(player.stats[season] ?? {}) } };
  }
  teams.push(teamId);
}

export function playGame(league: League, game: Game): void {
  if (game.result) return;
  playEarlierGames(league, game);
  captureManagement(league, game);
  prepareGame(league, game);
  recordResult(
    league,
    game,
    simulateGame(league, game, {
      keepPlays: true,
      playoff: !!game.playoffRound,
      ...(league.simulationSalt ? { seed: `${league.seed}:${league.simulationSalt}:${game.season}:${game.id}` } : {}),
    }),
  );
}

/** Begin a game to be watched play by play; finish it with recordResult, then playWeek. */
export function startLiveGame(league: League, game: Game): LiveGame {
  if (game.result) throw new Error('This game has already been played.');
  playEarlierGames(league, game);
  captureManagement(league, game);
  prepareGame(league, game);
  return startGame(league, game, {
    playoff: !!game.playoffRound,
    ...(league.simulationSalt ? { seed: `${league.seed}:${league.simulationSalt}:${game.season}:${game.id}` } : {}),
  });
}

/** A Sunday live game cannot resolve Friday waivers before an unplayed Thursday game. */
function playEarlierGames(league: League, game: Game): void {
  if (!league.personnel?.enabled) return;
  const earlier = league.games
    .filter((g) => g.season === game.season && !g.result && gameTime(g) < gameTime(game))
    .sort((a, b) => gameTime(a) - gameTime(b) || a.id - b.id);
  for (const g of earlier) playGame(league, g);
}

/** Play every game in the current week, then advance the calendar. Returns the games played. */
export function playWeek(league: League): Game[] {
  return withLeagueAi(league, () => playWeekControlled(league));
}
function playWeekControlled(league: League): Game[] {
  if (league.phase === 'complete') return [];
  // Offers you didn't answer lapse when you play on.
  expireOffers(league);
  const weekPlayed = league.phase;
  const games = gamesInWeek(league).filter((g) => !g.result);
  if (league.personnel?.enabled) games.sort((a, b) => gameTime(a) - gameTime(b) || a.id - b.id);
  for (const g of games) playGame(league, g);
  injuryWeek(league);
  coachQuirksWeek(league);
  if (league.phase === 'regular')
    for (const team of league.teams) {
      const staff = teamCoaches(league, team.id);
      const available = teamPlayers(league, team.id).filter(isAvailable);
      coachTeachingWeek(league, staff, available);
      updateCoachAdvice(league, team, staff, available);
    }
  if (league.phase === 'regular') {
    awardWeek(league, league.week);
    aiTrades(league);
    quirkWeek(league);
    trainingWeek(league);
    mentoringWeek(league);
    // The week's share of each player's year lands, more for a man who played (the user's live game included).
    developWeek(league, gamesInWeek(league));
  }
  // Moods move after the week's games and moves (morale draws nothing, so it can't shift what follows).
  if (league.phase === 'regular' || league.phase === 'playoffs') moraleWeek(league);
  league.week++;
  leadershipWeek(league);
  // The league moves the games worth watching into prime time, on the NFL's notice.
  if (league.phase === 'regular') flexWeek(league);
  // What's on the desk was judged before the week moved: judge it again in the state you'd accept in.
  if (weekPlayed === 'regular') recheckOffers(league);

  if (league.phase === 'regular' && league.week > REGULAR_SEASON_WEEKS) {
    awardSeason(league);
    league.phase = 'playoffs';
    scheduleNextRound(league);
  } else if (league.phase === 'playoffs') {
    if (!scheduleNextRound(league)) finishSeason(league);
  }
  // Whoever's season just ended has his ceiling settled (out of the playoffs at week 18, then each round's losers).
  settleFinished(league);
  prunePlayLogs(league);
  syncPersonnel(league);
  return games;
}

function finishSeason(league: League) {
  const final = playoffGames(league, 'FINAL')[0];
  const championId = winnerOf(final)!;
  const records = computeRecords(league);
  league.history.push({
    season: league.season,
    championId,
    runnerUpId: championId === final.homeId ? final.awayId : final.homeId,
    records: Object.fromEntries([...records].map(([id, r]) => [id, { w: r.w, l: r.l, t: r.t }])),
    playoffs: playoffSummary(league, league.season),
  });
  league.phase = 'complete';
}

export function simToEndOfRegularSeason(league: League, stopForJob = false) {
  const appointment = league.gms[league.userGmId]?.appointments.length;
  const team = league.gms[league.userGmId]?.teamId;
  while (league.phase === 'regular') {
    playWeek(league);
    if (
      stopForJob &&
      (league.gms[league.userGmId]?.teamId !== team || league.gms[league.userGmId]?.appointments.length !== appointment)
    )
      break;
  }
}

export function simToEndOfSeason(league: League) {
  while (league.phase !== 'complete') playWeek(league);
}

export function champion(league: League, season = league.season) {
  return league.history.find((h) => h.season === season);
}

/** From a finished season straight to week 1 of the next, with the AI running every team. */
export function startNextSeason(league: League): void {
  simOffseason(league);
}
