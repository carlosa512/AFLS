/**
 * Relationships: who a player gets on with, who he doesn't, and how he feels about the clubs he has played for
 * (docs/superpowers/specs/2026-10-28-personality-relationships-design.md §3). Rapport with a coach, homecomings and
 * grudges are worked out from history whenever they're needed; friendships and feuds are stored, three at most per
 * player. They lean on habits and contracts, and the match engine never reads them.
 */
import { ROOM_OF } from './coaching';
import { seasonRole } from './scouting';
import { positionIn } from './training';
import type { Coach, Departure, League, Player, Position, Tie } from './types';

const MAX_LEFT = 3;
export const MAX_TIES = 3;

// ───────── how he left ─────────

/** He left `teamId` (cut, traded, or walked as a free agent): one entry per club per season, the newest three kept. */
export function noteDeparture(league: League, p: Player, teamId: number, how: Departure['how']): void {
  const left = (p.left ??= []);
  if (!left.some((d) => d.teamId === teamId && d.season === league.season))
    left.push({ teamId, season: league.season, how });
  if (left.length > MAX_LEFT) left.splice(0, left.length - MAX_LEFT);
  // Leaving the club is leaving the room: his feuds there are over.
  for (const t of [...(p.ties ?? [])]) if (t.kind === 'feud') endTie(league, p, t.with);
}

// ───────── ties ─────────

/** Same club, same position: the men competing for the same snaps. */
export const sameRoom = (a: Player, b: Player) =>
  a.teamId !== null && a.teamId === b.teamId && a.position === b.position;

/** End whatever tie two players have, on both sides. */
export function endTie(league: League, a: Player, withId: number): void {
  const b = league.players[withId];
  a.ties = a.ties?.filter((t) => t.with !== withId);
  if (!a.ties?.length) delete a.ties;
  if (b) {
    b.ties = b.ties?.filter((t) => t.with !== a.id);
    if (!b.ties?.length) delete b.ties;
  }
}

/**
 * Tie two players, on both sides. A feud replaces a friendship between the same two; nobody holds more than three.
 * False when there was no room.
 */
export function addTie(league: League, a: Player, b: Player, kind: Tie['kind'], why?: Tie['why']): boolean {
  if (a.id === b.id) return false;
  const existing = a.ties?.find((t) => t.with === b.id);
  if (existing?.kind === kind) return false;
  if (existing) endTie(league, a, b.id);
  if ((a.ties?.length ?? 0) >= MAX_TIES || (b.ties?.length ?? 0) >= MAX_TIES) return false;
  const tie = (other: Player): Tie => ({ kind, with: other.id, since: league.season, ...(why ? { why } : {}) });
  (a.ties ??= []).push(tie(b));
  (b.ties ??= []).push(tie(a));
  return true;
}

/** A position move or a trade can take a man out of the room: his feuds with anyone no longer in it end. */
export function endFeudsOutsideRoom(league: League, p: Player): void {
  for (const t of [...(p.ties ?? [])]) {
    const q = league.players[t.with];
    if (t.kind === 'feud' && (!q || !sameRoom(p, q))) endTie(league, p, t.with);
  }
}

// ───────── coaches and clubs: worked out from history ─────────

const OFFENSE: ReadonlySet<Position> = new Set(['QB', 'RB', 'WR', 'TE', 'OL']);
const KICKERS: ReadonlySet<Position> = new Set(['K', 'P']);

/** Was `c` his head coach, his side's coordinator or his room's position coach in `season`? */
export function coachedBy(_league: League, p: Player, c: Coach, season: number): boolean {
  const clubs = p.statTeams?.[season] ?? [];
  if (!clubs.length) return false;
  const pos = positionIn(p, season);
  return (c.career ?? []).some(
    (r) =>
      r.season === season &&
      clubs.includes(r.teamId) &&
      (r.role === 'headCoach' ||
        (r.role === 'offCoord' && OFFENSE.has(pos)) ||
        (r.role === 'defCoord' && !OFFENSE.has(pos) && !KICKERS.has(pos)) ||
        (r.role === 'stCoord' && KICKERS.has(pos)) ||
        (r.role === 'positionCoach' && r.room === ROOM_OF[pos])),
  );
}

const headCoachOf = (c: Coach, teamId: number, season: number) =>
  (c.career ?? []).some((r) => r.season === season && r.teamId === teamId && r.role === 'headCoach');

const played = (league: League, p: Player, season: number) => {
  const role = seasonRole(league, p, season)?.role;
  return role === 'starter' || role === 'rotation';
};

/**
 * How a player feels about a coach, from their seasons together. Sour if the coach ran a club that cut or traded him,
 * or benched him (a starter one year, a backup the next, healthy); good after two or more seasons under him in which he
 * played; otherwise nothing. Never stored: worked out from careers whenever it's needed.
 */
export function rapport(league: League, p: Player, c: Coach): 'good' | 'sour' | null {
  for (const d of p.left ?? [])
    if (d.how !== 'walked' && (headCoachOf(c, d.teamId, d.season) || headCoachOf(c, d.teamId, d.season - 1)))
      return 'sour';
  const seasons = Object.keys(p.statTeams ?? {})
    .map(Number)
    .filter((s) => coachedBy(league, p, c, s));
  for (const s of seasons) {
    const before = seasonRole(league, p, s - 1)?.role;
    const now = seasonRole(league, p, s);
    if (before === 'starter' && now?.role === 'backup' && (p.stats[s]?.gp ?? 0) >= 10) return 'sour';
  }
  return seasons.filter((s) => played(league, p, s)).length >= 2 ? 'good' : null;
}

/** Seasons a grudge lasts. */
export const GRUDGE_SEASONS = 3;

/**
 * How he feels about a club he left: a grudge for three seasons if it cut or traded him; home if he walked away after
 * playing there (a starter or a rotation player in his last season). Null for anywhere else.
 */
export function clubFeeling(league: League, p: Player, teamId: number): 'home' | 'grudge' | null {
  const d = [...(p.left ?? [])].reverse().find((x) => x.teamId === teamId);
  if (!d) return null;
  if (d.how !== 'walked') return league.season - d.season <= GRUDGE_SEASONS ? 'grudge' : null;
  return played(league, p, d.season - 1) ? 'home' : null;
}
