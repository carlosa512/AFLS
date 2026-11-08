/**
 * Who has done enough for a rate to count (spec: docs/superpowers/specs/2026-11-08-rate-stat-qualification-design.md):
 * the one table every place that ranks a rate reads (the Leaders and Records boards, the Stats table's sorts, the
 * awards, the rookie report). A season asks a minimum per **team** game, the games his club has played, so a backup who
 * dressed once and went 2-for-2 never leads; a career asks a total and 64 games. Below the minimum a man keeps every
 * number on every screen: he just can't lead. Draws nothing.
 *
 * Passing, rushing and receiving are the NFL's (Pro-Football-Reference's leaderboard minimums). No NFL source was found
 * for kicking, punting and returns: those are the game's own, the per-game numbers the Stats table already used (the
 * owner's call).
 */
import type { StatScope } from './stats';
import type { League, Player, StatLine } from './types';

export type RateKey = 'passing' | 'rushing' | 'receiving' | 'kicking' | 'punting' | 'kickReturns' | 'puntReturns';

export interface Rate {
  key: RateKey;
  /** What the rate is earned on. */
  volume: (s: StatLine) => number;
  /** The season's minimum, per team game. */
  perGame: number;
  /** The career's minimum. */
  career: number;
  /** The volume's word on a screen. */
  unit: string;
}

const rate = (key: RateKey, volume: (s: StatLine) => number, perGame: number, career: number, unit: string): Rate => ({
  key,
  volume,
  perGame,
  career,
  unit,
});

export const RATES: Record<RateKey, Rate> = {
  passing: rate('passing', (s) => s.passAtt ?? 0, 14, 1500, 'att.'),
  rushing: rate('rushing', (s) => s.rushAtt ?? 0, 6.25, 750, 'carries'),
  receiving: rate('receiving', (s) => s.rec ?? 0, 1.875, 200, 'catches'),
  kicking: rate('kicking', (s) => s.fgAtt ?? 0, 1, 100, 'FGA'),
  punting: rate('punting', (s) => s.punts ?? 0, 2, 250, 'punts'),
  kickReturns: rate('kickReturns', (s) => s.krAtt ?? 0, 1, 75, 'returns'),
  puntReturns: rate('puntReturns', (s) => s.prAtt ?? 0, 1, 75, 'returns'),
};

/** A career rate also asks this many games played (PFR's rule for career rate leaders). */
export const CAREER_GAMES = 64;
/** A regular season's games: what a man with no club is measured against. */
const SEASON_GAMES = 17;

/**
 * The regular-season games his club has played in `season`: the club he finished it with, else his club now; a man
 * with neither, or a season whose schedule the league no longer keeps, is measured against a full season.
 */
export function teamGames(league: League, player: Player, season: number): number {
  const club = player.statTeams?.[season]?.at(-1) ?? player.teamId;
  if (club === null || club === undefined) return SEASON_GAMES;
  let scheduled = 0;
  let n = 0;
  for (const g of league.games)
    if (g.season === season && !g.playoffRound && (g.homeId === club || g.awayId === club)) {
      scheduled++;
      if (g.result) n++;
    }
  // An old season's schedule is gone from the league (only the last two are kept): it was played in full.
  return scheduled ? n : SEASON_GAMES;
}

/**
 * Whether `line` has done enough for `rate` to count in `scope` (a season, or the career). `fullSeason` measures a
 * season against all of its games, played or not: the all-time Records, where a season under way would otherwise let a
 * one-game line stand beside whole seasons.
 */
export function qualifies(
  league: League,
  player: Player,
  line: StatLine,
  scope: StatScope,
  rate: Rate,
  opts: { fullSeason?: boolean } = {},
): boolean {
  const volume = rate.volume(line);
  if (volume <= 0) return false;
  if (scope === 'career') return volume >= rate.career && (line.gp ?? 0) >= CAREER_GAMES;
  return volume >= rate.perGame * (opts.fullSeason ? SEASON_GAMES : teamGames(league, player, scope));
}

/**
 * How far toward a season's minimum `line` has come, 0…1: where a rate weighs in a score (the awards' quarterback term)
 * rather than ranks, it counts in step with the volume, so one more attempt never swings it.
 */
export function minimumShare(league: League, player: Player, line: StatLine, season: number, rate: Rate): number {
  return shareOf(rate.volume(line), rate.perGame * teamGames(league, player, season));
}

/** The same over a stretch of games he played. */
export function periodShare(line: StatLine, games: number, rate: Rate): number {
  return shareOf(rate.volume(line), rate.perGame * games);
}

const shareOf = (volume: number, needed: number) => (volume <= 0 ? 0 : needed <= 0 ? 1 : Math.min(1, volume / needed));

/** A stretch of games (a week's or a month's honors): the per-game minimum for each game he played in it. */
export function periodQualifies(line: StatLine, games: number, rate: Rate): boolean {
  const volume = rate.volume(line);
  return volume > 0 && volume >= rate.perGame * games;
}

/** The minimum as a screen says it. */
export function minimumText(rate: Rate, scope: StatScope): string {
  return scope === 'career'
    ? `${rate.career.toLocaleString('en-US')} ${rate.unit} career`
    : `${rate.perGame} ${rate.unit} per team game`;
}
