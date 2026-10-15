import type { Game, League, PlayoffRound } from '../types';
import { REGULAR_SEASON_WEEKS } from './schedule';
import { computeRecords, conferenceSeeds } from './standings';

export const PLAYOFF_ROUNDS: PlayoffRound[] = ['WC', 'DIV', 'CONF', 'FINAL'];
export const ROUND_NAMES: Record<PlayoffRound, string> = {
  WC: 'Wild Card',
  DIV: 'Divisional Round',
  CONF: 'Conference Championship',
  FINAL: 'Championship Game',
};

export const roundWeek = (round: PlayoffRound) => REGULAR_SEASON_WEEKS + 1 + PLAYOFF_ROUNDS.indexOf(round);

export function playoffGames(league: League, round?: PlayoffRound, season = league.season): Game[] {
  return league.games.filter((g) => g.season === season && g.playoffRound && (!round || g.playoffRound === round));
}

export function winnerOf(game: Game): number | null {
  const r = game.result;
  if (!r || r.homeScore === r.awayScore) return null;
  return r.homeScore > r.awayScore ? game.homeId : game.awayId;
}

function makeGame(league: League, round: PlayoffRound, homeId: number, awayId: number, neutral = false): Game {
  return { id: league.nextGameId++, season: league.season, week: roundWeek(round), homeId, awayId, playoffRound: round, ...(neutral ? { neutral } : {}) };
}

export function allSeeds(league: League, season = league.season): number[][] {
  const records = computeRecords(league, season);
  return league.conferences.map((_, c) => conferenceSeeds(league, c, records));
}

/** Create the next playoff round's games. Returns false when the season is decided. */
export function scheduleNextRound(league: League): boolean {
  const seeds = allSeeds(league);
  const seedOf = (id: number) => seeds.flat().indexOf(id) % 7;
  const existing = playoffGames(league);
  const lastRound = [...PLAYOFF_ROUNDS].reverse().find((r) => existing.some((g) => g.playoffRound === r));

  const confOf = (id: number) => league.teams[id].conference;
  const winners = (round: PlayoffRound) => playoffGames(league, round).map((g) => winnerOf(g)!);
  // Higher seed (lower number) hosts.
  const host = (a: number, b: number): [number, number] => (seedOf(a) <= seedOf(b) ? [a, b] : [b, a]);

  if (!lastRound) {
    for (const s of seeds) {
      for (const [hi, lo] of [[1, 6], [2, 5], [3, 4]]) league.games.push(makeGame(league, 'WC', s[hi], s[lo]));
    }
    return true;
  }
  if (lastRound === 'WC') {
    seeds.forEach((s, c) => {
      const alive = [s[0], ...winners('WC').filter((id) => confOf(id) === c)].sort((a, b) => seedOf(a) - seedOf(b));
      // Top seed plays the lowest remaining seed.
      league.games.push(makeGame(league, 'DIV', ...host(alive[0], alive[3])));
      league.games.push(makeGame(league, 'DIV', ...host(alive[1], alive[2])));
    });
    return true;
  }
  if (lastRound === 'DIV') {
    league.conferences.forEach((_, c) => {
      const [a, b] = winners('DIV').filter((id) => confOf(id) === c);
      league.games.push(makeGame(league, 'CONF', ...host(a, b)));
    });
    return true;
  }
  if (lastRound === 'CONF') {
    const [a, b] = winners('CONF').sort((x, y) => confOf(x) - confOf(y));
    const [home, away] = league.season % 2 === 0 ? [a, b] : [b, a];
    league.games.push(makeGame(league, 'FINAL', home, away, true));
    return true;
  }
  return false;
}
