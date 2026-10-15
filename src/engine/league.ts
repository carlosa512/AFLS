/**
 * Season orchestration: playing weeks, moving into the playoffs, crowning a
 * champion, and rolling the league into the next season.
 */
import { generatePlayer, marketValue, MIN_SALARY } from './generate';
import { simulateGame } from './match/gameSim';
import { playerOvr, ROSTER_TEMPLATE } from './positions';
import { clamp, Rng } from './rng';
import { syncDepthChart, teamPlayers } from './roster';
import { playoffGames, scheduleNextRound, winnerOf } from './season/playoffs';
import { generateSchedule, REGULAR_SEASON_WEEKS } from './season/schedule';
import { computeRecords, divisionStandings } from './season/standings';
import type { Game, League, Player, StatLine } from './types';
import { ATTRIBUTES, MAX_STATS, POSITIONS } from './types';

export function gamesInWeek(league: League, week = league.week): Game[] {
  return league.games.filter((g) => g.season === league.season && g.week === week);
}

export function userGame(league: League, week = league.week): Game | undefined {
  return gamesInWeek(league, week).find((g) => g.homeId === league.userTeamId || g.awayId === league.userTeamId);
}

function addStats(target: StatLine, source: StatLine) {
  for (const [key, value] of Object.entries(source) as [keyof StatLine, number][]) {
    target[key] = MAX_STATS.has(key) ? Math.max(target[key] ?? 0, value) : (target[key] ?? 0) + value;
  }
}

/** Keep full play-by-play only for the user's games and the most recent week. */
function prunePlayLogs(league: League) {
  for (const g of league.games) {
    if (!g.result?.plays || g.week >= league.week - 1) continue;
    if (g.homeId === league.userTeamId || g.awayId === league.userTeamId) continue;
    g.result.plays = g.result.plays.filter((p) => p.scoring);
  }
}

export function playGame(league: League, game: Game): void {
  syncDepthChart(league, league.teams[game.homeId]);
  syncDepthChart(league, league.teams[game.awayId]);
  game.result = simulateGame(league, game, { keepPlays: true, playoff: !!game.playoffRound });
  if (game.playoffRound) return; // Season stat totals are regular season only.
  for (const [id, line] of Object.entries(game.result.playerStats)) {
    const player = league.players[Number(id)];
    if (player) addStats((player.stats[game.season] ??= {}), line);
  }
}

/** Play every game in the current week, then advance the calendar. Returns the games played. */
export function playWeek(league: League): Game[] {
  if (league.phase === 'complete') return [];
  const games = gamesInWeek(league).filter((g) => !g.result);
  for (const g of games) playGame(league, g);
  league.week++;

  if (league.phase === 'regular' && league.week > REGULAR_SEASON_WEEKS) {
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

/**
 * Placeholder offseason until the draft, free agency and development systems
 * land: players age and develop, veterans retire, contracts tick down, and
 * generated rookies refill each roster.
 */
export function startNextSeason(league: League): void {
  if (league.phase !== 'complete') throw new Error('Season is not finished');
  const rng = new Rng(league.rngState);

  // Next season's schedule depends on this season's division finishes.
  const order = divisionStandings(league).map((d) => d.teams.map((r) => r.teamId));

  for (const player of Object.values(league.players)) {
    if (player.teamId === null) continue;
    developPlayer(rng, player);
    player.age++;
    player.experience++;
    player.contract.years--;
    const ovr = playerOvr(player);
    const retires = player.age >= 37 || (player.age >= 31 && ovr < 8 && rng.chance(0.5)) || (player.age >= 34 && rng.chance(0.35));
    if (retires) {
      player.teamId = null;
      continue;
    }
    if (player.contract.years <= 0) {
      // Auto re-sign at market value until free agency exists.
      player.contract = { salary: Math.round(Math.max(MIN_SALARY, marketValue(player.position, ovr) * rng.float(0.8, 1.1))), years: rng.int(1, 4) };
    }
  }

  for (const team of league.teams) {
    const roster = teamPlayers(league, team.id);
    const jerseysUsed = new Set(roster.map((p) => p.jersey));
    for (const pos of POSITIONS) {
      const have = roster.filter((p) => p.position === pos).length;
      for (let i = have; i < ROSTER_TEMPLATE[pos]; i++) {
        const rookie = generatePlayer(rng, {
          id: league.nextPlayerId++,
          position: pos,
          quality: clamp(rng.normal(8.5, 2.2), 4, 16),
          age: rng.int(21, 23),
          teamId: team.id,
          jerseysUsed,
        });
        rookie.experience = 0;
        rookie.contract = { salary: MIN_SALARY + rng.int(0, 1500), years: 4 };
        league.players[rookie.id] = rookie;
      }
    }
    syncDepthChart(league, team);
  }

  league.season++;
  league.week = 1;
  league.phase = 'regular';
  league.games = league.games.filter((g) => g.season >= league.season - 1);
  league.games.push(...generateSchedule(league, rng, order));
  league.rngState = rng.getState();
}

/** Simple age curve: growth toward potential while young, decline after the prime. */
function developPlayer(rng: Rng, player: Player) {
  const age = player.age;
  const peakEnd = { RB: 27, WR: 29, CB: 28, S: 29, LB: 29, EDGE: 29, DT: 30, TE: 30, OL: 31, QB: 33, K: 35, P: 35 }[player.position];
  const ovr = playerOvr(player);
  let delta: number;
  if (age < 26) delta = Math.max(0, player.potential - ovr) * rng.float(0.15, 0.5);
  else if (age <= peakEnd) delta = rng.normal(0, 0.4);
  else delta = -rng.float(0.3, 1.4) * (1 + (age - peakEnd) * 0.25);
  for (const attr of ATTRIBUTES) {
    const physical = attr === 'speed' || attr === 'agility' || attr === 'strength';
    // Physical tools fade faster than mental ones.
    const d = delta < 0 ? delta * (physical ? 1.4 : attr === 'awareness' ? 0.3 : 1) : delta * (attr === 'awareness' ? 1.2 : 1);
    player.ratings[attr] = Math.round(clamp(player.ratings[attr] + d + rng.normal(0, 0.35), 1, 20));
  }
}
