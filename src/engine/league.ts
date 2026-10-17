/**
 * Season orchestration: playing weeks, moving into the playoffs, crowning a
 * champion, and rolling the league into the next season.
 */
import { awardSeason } from './awards';
import { simulateGame, startGame, type LiveGame } from './match/gameSim';
import { simOffseason } from './offseason';
import { Rng } from './rng';
import { aiTradeWeek } from './trade';
import { syncDepthChart } from './roster';
import { playoffGames, scheduleNextRound, winnerOf } from './season/playoffs';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { computeRecords } from './season/standings';
import { addStats } from './stats';
import type { Game, GameResult, League } from './types';

export function gamesInWeek(league: League, week = league.week): Game[] {
  return league.games.filter((g) => g.season === league.season && g.week === week);
}

export function userGame(league: League, week = league.week): Game | undefined {
  return gamesInWeek(league, week).find((g) => g.homeId === league.userTeamId || g.awayId === league.userTeamId);
}

/** Contenders and rebuilders deal with each other before the deadline (never with the user unasked). */
function aiTrades(league: League) {
  const rng = new Rng(league.rngState);
  aiTradeWeek(league, rng);
  league.rngState = rng.getState();
}

/** Keep full play-by-play only for the user's games and the most recent week. */
function prunePlayLogs(league: League) {
  for (const g of league.games) {
    if (!g.result?.plays || g.week >= league.week - 1) continue;
    if (g.homeId === league.userTeamId || g.awayId === league.userTeamId) continue;
    g.result.plays = g.result.plays.filter((p) => p.scoring);
  }
}

function prepareGame(league: League, game: Game) {
  syncDepthChart(league, league.teams[game.homeId]);
  syncDepthChart(league, league.teams[game.awayId]);
}

/** Store a finished game's result and credit regular-season stats. */
export function recordResult(league: League, game: Game, result: GameResult): void {
  if (game.result) return;
  game.result = result;
  if (game.playoffRound) return; // Season stat totals are regular season only.
  for (const [id, line] of Object.entries(result.playerStats)) {
    const player = league.players[Number(id)];
    if (player) addStats((player.stats[game.season] ??= {}), line);
  }
}

export function playGame(league: League, game: Game): void {
  prepareGame(league, game);
  recordResult(league, game, simulateGame(league, game, { keepPlays: true, playoff: !!game.playoffRound }));
}

/** Begin a game to be watched play by play; finish it with recordResult, then playWeek. */
export function startLiveGame(league: League, game: Game): LiveGame {
  prepareGame(league, game);
  return startGame(league, game, { playoff: !!game.playoffRound });
}

/** Play every game in the current week, then advance the calendar. Returns the games played. */
export function playWeek(league: League): Game[] {
  if (league.phase === 'complete') return [];
  const games = gamesInWeek(league).filter((g) => !g.result);
  for (const g of games) playGame(league, g);
  if (league.phase === 'regular') aiTrades(league);
  league.week++;

  if (league.phase === 'regular' && league.week > REGULAR_SEASON_WEEKS) {
    awardSeason(league);
    league.phase = 'playoffs';
    scheduleNextRound(league);
  } else if (league.phase === 'playoffs') {
    if (!scheduleNextRound(league)) finishSeason(league);
  }
  prunePlayLogs(league);
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
  });
  league.phase = 'complete';
}

export function simToEndOfRegularSeason(league: League) {
  while (league.phase === 'regular') playWeek(league);
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
