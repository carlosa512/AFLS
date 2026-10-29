/**
 * Who signs a letter: one of your own staff, with a link to his card, or the department's name when the chair is
 * empty. Shared by every module that writes mail, so none of them needs `inbox.ts` (which calls them all).
 */
import { ROOM_OF, teamCoaches } from './coaching';
import { teamMedics } from './medical';
import { teamStaff } from './staff';
import type { InboxMessage, League, Player } from './types';

/** A message before it's filed: `deliverMail` sets whether it's read. */
export type Draft = Omit<InboxMessage, 'read'>;
export type Sender = Pick<InboxMessage, 'from' | 'fromCard'>;

export function headCoach(league: League): Sender {
  const c = teamCoaches(league, league.userTeamId).find((x) => x.role === 'headCoach');
  return c
    ? { from: `${c.firstName} ${c.lastName}, Head coach`, fromCard: { kind: 'coach', id: c.id } }
    : { from: 'Coaching staff' };
}

export function director(league: League): Sender {
  const s = teamStaff(league, league.userTeamId).find((x) => x.role === 'director');
  return s
    ? { from: `${s.firstName} ${s.lastName}, Director of scouting`, fromCard: { kind: 'scout', id: s.id } }
    : { from: 'Scouting department' };
}

export function doctor(league: League): Sender {
  const m = teamMedics(league, league.userTeamId).find((x) => x.role === 'doctor');
  return m
    ? { from: `${m.firstName} ${m.lastName}, Head team doctor`, fromCard: { kind: 'medic', id: m.id } }
    : { from: 'Medical staff' };
}

/** The coach of his position room, or the head coach when the chair is empty. */
export function roomCoach(league: League, p: Player): Sender {
  const room = ROOM_OF[p.position];
  const c = teamCoaches(league, league.userTeamId).find((x) => x.role === 'positionCoach' && x.room === room);
  return c
    ? { from: `${c.firstName} ${c.lastName}, Position coach`, fromCard: { kind: 'coach', id: c.id } }
    : headCoach(league);
}
