/**
 * Team seasons come from league history; people carry the results earned in each role. Legacy career
 * entries without exact service results still look up the team's season, preserving older saves.
 */
import { PLAYOFF_ROUNDS, ROUND_NAMES } from './season/playoffs';
import type { Coach, CoachRole, GeneralManager, League, SeasonSummary, ServiceRecord } from './types';

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
  return {
    season: summary.season,
    teamId,
    regular: { ...regular },
    playoffs: po ? { w: po.w, l: po.l } : null,
    finish,
    champion,
  };
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
  const trips = new Set<number>();
  const championships = new Set<number>();
  for (const s of seasons) {
    regular.w += s.regular.w;
    regular.l += s.regular.l;
    regular.t += s.regular.t;
    if (s.playoffs) {
      playoffs.w += s.playoffs.w;
      playoffs.l += s.playoffs.l;
      trips.add(s.season);
    } else if (s.champion || s.finish === 'Lost the title game') trips.add(s.season);
    if (s.champion) championships.add(s.season);
  }
  return { seasons, regular, playoffs, playoffTrips: trips.size, titles: championships.size };
}

function serviceSeasonRecord(league: League, season: number, teamId: number, record: ServiceRecord): TeamSeasonRecord {
  const po = record.playoffs;
  const summary = league.history.find((s) => s.season === season);
  let finish = 'Season in progress';
  if (record.champion) finish = 'Won the title';
  else if (po?.l) finish = po.round === 'FINAL' ? 'Lost the title game' : `Lost in the ${ROUND_NAMES[po.round]}`;
  else if (po) finish = 'Playoff appearance';
  else if (summary) finish = summary.playoffs?.[teamId] ? 'No playoff games in this role' : 'Missed the playoffs';
  return {
    season,
    teamId,
    regular: { ...record.regular },
    playoffs: po ? { w: po.w, l: po.l } : null,
    finish,
    champion: record.champion,
  };
}

/** The persistent person's actual service, including split seasons and former teams. */
export function gmRecord(league: League, gm: GeneralManager = league.gms[league.userGmId]): CareerRecord {
  const seasons: TeamSeasonRecord[] = [];
  for (const s of gm.career) {
    const summary = league.history.find((h) => h.season === s.season);
    const rec = s.record
      ? serviceSeasonRecord(league, s.season, s.teamId, s.record)
      : summary && teamSeasonRecord(summary, s.teamId);
    if (rec) seasons.push(rec);
  }
  return total(seasons.sort((a, b) => b.season - a.season));
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
    const rec = cs.record
      ? serviceSeasonRecord(league, cs.season, cs.teamId, cs.record)
      : summary && teamSeasonRecord(summary, cs.teamId);
    if (rec) seasons.push({ ...rec, role: cs.role, ...(cs.room ? { room: cs.room } : {}) });
  }
  return total(seasons.sort((a, b) => b.season - a.season));
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
