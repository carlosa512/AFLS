/**
 * Each club's read of each free agent, kept across free agency's passes (the days, the draft's pass, camp's last calls):
 * worked out again for every club on every pass, it was about a seventh of a multi-season league, though it rarely
 * changes between passes. An entry carries a stamp of everything the read uses (the man's game, age, ceiling, traits,
 * injuries and snaps; the club's knowledge of him and its scouts); a different stamp reads him again. The club's win-now
 * lean is not in it: that moves as the club signs, and is laid on fresh (`leanOutlook`). Kept beside the league, never
 * in it, so a reloaded save reads the same.
 */
import { filmScale } from '../origin';
import { outlookRead, type OutlookRead } from '../outlook';
import { isProspect, knowledge } from '../scouting';
import { teamStaff } from '../staff';
import { ATTRIBUTES, type League, type Player } from '../types';

/** Off in the test that proves the cache changes nothing. */
export const faReadCache = { on: true };

/** One league year's reads (a new year starts the store again, so last spring's free agents don't linger). */
const kept = new WeakMap<League, { season: number; reads: Map<number, { stamp: string; read: OutlookRead }> }>();

/** What the read uses of the man, as of now. */
function playerStamp(league: League, p: Player): string {
  const s = league.season;
  const gp = [s - 2, s - 1, s].map((y) => (p.stats[y] ? p.stats[y].gp : -1));
  return [
    s,
    p.teamId,
    p.position,
    p.age,
    p.experience,
    p.cflSeasons ?? 0,
    filmScale(p),
    isProspect(p) ? 1 : 0,
    p.potential,
    p.ceilingShifts?.[s] ?? '',
    ATTRIBUTES.map((a) => p.ratings[a]).join(','),
    JSON.stringify(p.traits),
    JSON.stringify(p.shifts ?? {}),
    JSON.stringify(p.personality),
    JSON.stringify(p.injuries ?? []),
    gp.join(','),
  ].join('|');
}

/** Who reads him for the club: its scouts and director, with what they rate. */
function staffStamp(league: League, teamId: number): string {
  return teamStaff(league, teamId)
    .map((x) => `${x.id},${x.role},${x.focus ?? ''},${x.evaluation},${x.projection}`)
    .join(';');
}

/** One pass's reader: each man's and each club's stamp worked out once in the pass, each read kept across passes. */
export function faReads(league: League): (teamId: number, p: Player) => OutlookRead {
  if (!faReadCache.on) return (teamId, p) => outlookRead(league, teamId, p);
  let year = kept.get(league);
  if (!year || year.season !== league.season) kept.set(league, (year = { season: league.season, reads: new Map() }));
  const store = year.reads;
  const players = new Map<number, string>();
  const staffs = new Map<number, string>();
  return (teamId, p) => {
    let ps = players.get(p.id);
    if (ps === undefined) players.set(p.id, (ps = playerStamp(league, p)));
    let ss = staffs.get(teamId);
    if (ss === undefined) staffs.set(teamId, (ss = staffStamp(league, teamId)));
    const stamp = `${ps}#${ss}#${knowledge(league, teamId, p)}`;
    const key = p.id * 64 + teamId;
    const hit = store.get(key);
    if (hit && hit.stamp === stamp) return hit.read;
    const read = outlookRead(league, teamId, p);
    store.set(key, { stamp, read });
    return read;
  };
}
