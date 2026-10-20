/**
 * Season orchestration: playing weeks, moving into the playoffs, crowning a
 * champion, and rolling the league into the next season.
 */
import { awardSeason, awardWeek } from './awards';
import { simulateGame, startGame, type LiveGame } from './match/gameSim';
import { applyInjury, injuryWeek } from './injuries';
import { simOffseason } from './offseason';
import { quirkWeek, recordForm } from './quirks';
import { expireOffers, marketMoment, weekMoment } from './trade';
import { syncDepthChart } from './roster';
import { flexWeek } from './season/flex';
import { playoffGames, scheduleNextRound, winnerOf } from './season/playoffs';
import { REGULAR_SEASON_WEEKS } from './season/schedule';
import { computeRecords } from './season/standings';
import { addStats } from './stats';
import { recordCoachSeasons } from './coaching';
import { playoffSummary } from './records';
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

/** Store a finished game's result, apply what it did to bodies, and credit regular-season stats. */
export function recordResult(league: League, game: Game, result: GameResult): void {
  if (game.result) return;
  // Condition and diagnoses are carried by the players, not the game record.
  const { condition, diagnoses, ...kept } = result;
  game.result = kept;
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
  // Offers you didn't answer lapse when you play on.
  expireOffers(league);
  const games = gamesInWeek(league).filter((g) => !g.result);
  for (const g of games) playGame(league, g);
  injuryWeek(league);
  if (league.phase === 'regular') {
    awardWeek(league, league.week);
    aiTrades(league);
    quirkWeek(league);
  }
  league.week++;
  // The league moves the games worth watching into prime time, on the NFL's notice.
  if (league.phase === 'regular') flexWeek(league);

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
    playoffs: playoffSummary(league, league.season),
  });
  recordCoachSeasons(league);
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
