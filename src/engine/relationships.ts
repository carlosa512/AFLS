/**
 * Relationships: who a player gets on with, who he doesn't, and how he feels about the clubs he has played for
 * (docs/superpowers/specs/2026-10-28-personality-relationships-design.md §3). Rapport with a coach, homecomings and
 * grudges are worked out from history whenever they're needed; friendships and feuds are stored, three at most per
 * player. They lean on habits and contracts, and the match engine never reads them.
 */
import type { Departure, League, Player, Tie } from './types';

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
