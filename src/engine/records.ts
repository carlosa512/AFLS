/**
 * Win–loss records over time: a team's season, a coach's career and the user's run as GM. Nothing here
 * is stored twice: seasons come from `league.history`, so a coach's record is just the seasons he finished
 * on a staff (`Coach.career`) looked up there.
 */
import { PLAYOFF_ROUNDS, ROUND_NAMES } from './season/playoffs';
import type { Coach, CoachRole, League, SeasonSummary } from './types';

export interface Record3 {
  w: number;
  l: number;
  t: number;
}

export interface TeamSeasonRecord {
  season: number;
  teamId: number;
  /** Regular season. */
  regular: Record3;
  /** Playoff wins and losses; null when the team missed the playoffs (or an older save doesn't know). */
  playoffs: { w: number; l: number } | null;
  /** "Won the title", "Lost the title game", "Lost in the Divisional Round", "Missed the playoffs", or "" when unknown. */
  finish: string;
  champion: boolean;
}

export function teamSeasonRecord(summary: SeasonSummary, teamId: number): TeamSeasonRecord | null {
  const regular = summary.records[teamId];
  if (!regular) return null;
  const champion = summary.championId === teamId;
  const po = summary.playoffs?.[teamId];
  let finish = '';
  if (champion) finish = 'Won the title';
  else if (summary.runnerUpId === teamId) finish = 'Lost the title game';
  else if (po) finish = `Lost in the ${ROUND_NAMES[po.round]}`;
  else if (summary.playoffs) finish = 'Missed the playoffs';
  return { season: summary.season, teamId, regular: { ...regular }, playoffs: po ? { w: po.w, l: po.l } : null, finish, champion };
}

export interface CareerRecord<T extends TeamSeasonRecord = TeamSeasonRecord> {
  seasons: T[];
  regular: Record3;
  playoffs: { w: number; l: number };
  /** Seasons that reached the playoffs (only counted where the save knows). */
  playoffTrips: number;
  titles: number;
}

function total<T extends TeamSeasonRecord>(seasons: T[]): CareerRecord<T> {
  const regular = { w: 0, l: 0, t: 0 };
  const playoffs = { w: 0, l: 0 };
  let playoffTrips = 0;
  let titles = 0;
  for (const s of seasons) {
    regular.w += s.regular.w;
    regular.l += s.regular.l;
    regular.t += s.regular.t;
    if (s.playoffs) {
      playoffs.w += s.playoffs.w;
      playoffs.l += s.playoffs.l;
      playoffTrips++;
    } else if (s.champion || s.finish === 'Lost the title game') playoffTrips++;
    if (s.champion) titles++;
  }
  return { seasons, regular, playoffs, playoffTrips, titles };
}

/** The user's record as general manager: every finished season of the user's team, newest first. */
export function gmRecord(league: League): CareerRecord {
  const seasons = league.history.map((h) => teamSeasonRecord(h, league.userTeamId)).filter((s): s is TeamSeasonRecord => !!s);
  return total(seasons.reverse());
}

export interface CoachCareerSeason extends TeamSeasonRecord {
  role: CoachRole;
  room?: Coach['room'];
}

/**
 * A coach's seasons, newest first, each with his team's record. `roles` narrows the total, e.g. to the
 * seasons he was a head coach: a head coach's record is the one people quote.
 */
export function coachRecord(league: League, c: Coach, roles?: readonly CoachRole[]): CareerRecord<CoachCareerSeason> {
  const bySeason = new Map(league.history.map((h) => [h.season, h]));
  const seasons: CoachCareerSeason[] = [];
  for (const cs of c.career ?? []) {
    if (roles && !roles.includes(cs.role)) continue;
    const summary = bySeason.get(cs.season);
    const rec = summary && teamSeasonRecord(summary, cs.teamId);
    if (rec) seasons.push({ ...rec, role: cs.role, ...(cs.room ? { room: cs.room } : {}) });
  }
  return total(seasons.reverse());
}

export const formatRecord = (r: Record3) => `${r.w}–${r.l}${r.t ? `–${r.t}` : ''}`;

export function winPct(r: Record3): number {
  const games = r.w + r.l + r.t;
  return games ? (r.w + r.t / 2) / games : 0;
}

/** Playoff summary of a finished season: each playoff team's record and the furthest round it played. */
export function playoffSummary(league: League, season: number): SeasonSummary['playoffs'] {
  const out: NonNullable<SeasonSummary['playoffs']> = {};
  for (const g of league.games) {
    if (g.season !== season || !g.playoffRound || !g.result) continue;
    const { homeScore, awayScore } = g.result;
    for (const [id, won] of [
      [g.homeId, homeScore > awayScore],
      [g.awayId, awayScore > homeScore],
    ] as const) {
      const row = (out[id] ??= { w: 0, l: 0, round: g.playoffRound });
      if (won) row.w++;
      else row.l++;
      if (PLAYOFF_ROUNDS.indexOf(g.playoffRound) > PLAYOFF_ROUNDS.indexOf(row.round)) row.round = g.playoffRound;
    }
  }
  return out;
}
