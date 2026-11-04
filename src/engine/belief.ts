/**
 * Backing the staff (L4, docs/superpowers/specs/2026-11-04-backing-the-staff-design.md): each room's belief in whoever
 * runs its side of the ball (its coordinator, or the head coach covering an empty chair), a hidden number in −1…1 read
 * only in words. Bad games wear it down, a Locker-Room Lawyer louder; good games, streaks and meetings move it; it
 * drifts back toward the middle. The staff edge on Sunday reads it (`staffEdge.ts`).
 */
import { sideCoach, teamCoaches } from './coaching';
import { personalityOf, trueCharacter } from './personality';
import type { CoachRoom, Coach, League, Player } from './types';

export const BELIEF = {
  drift: 0.975,
  badGame: -0.06,
  goodGame: 0.03,
  loseStreak: -0.04,
  winStreak: 0.02,
  /** A lawyer who's a voice in the room makes a bad game's drop this many times as big; sour, half again. */
  lawyer: 3,
  sour: 1.5,
  /** A meeting: by the share of the room's weight that took it well, and that bristled. */
  lands: 0.04,
  bristles: 0.08,
  /** A notice kept or broken. */
  kept: 0.15,
  broken: -0.15,
  /** Past this after a bad game, the position coach says so (before the room reads in doubt). */
  warn: -0.1,
};

export type BeliefRead = 'believes' | 'steady' | 'doubts' | 'lost';
export type SideRole = 'offCoord' | 'defCoord';

export const SIDE_ROOMS: Record<SideRole, readonly CoachRoom[]> = {
  offCoord: ['QB', 'RB', 'WR', 'OL'],
  defCoord: ['DL', 'LB', 'DB'],
};
export const sideRoleOf = (room: CoachRoom): SideRole => (SIDE_ROOMS.offCoord.includes(room) ? 'offCoord' : 'defCoord');

const round = (v: number) => Math.round(v * 10000) / 10000;

export const beliefOf = (c: Coach | null | undefined, room: CoachRoom): number => c?.belief?.[room] ?? 0;

/** The same thresholds as a head coach's word (`credibilityRead`). */
export function beliefRead(v: number): BeliefRead {
  if (v >= 0.4) return 'believes';
  if (v <= -0.5) return 'lost';
  if (v <= -0.2) return 'doubts';
  return 'steady';
}

export function shiftBelief(c: Coach, room: CoachRoom, by: number): void {
  const v = round(Math.max(-1, Math.min(1, beliefOf(c, room) + by)));
  c.belief = { ...c.belief, [room]: v };
}

/** A man taking a side, or leaving one: every room starts in the middle with him. */
export function startCoordinator(c: Coach): void {
  delete c.belief;
}

/** A head coach's cover of a side ending: his rooms there forget him. */
export function dropSide(c: Coach, role: SideRole): void {
  if (!c.belief) return;
  for (const room of SIDE_ROOMS[role]) delete c.belief[room];
  if (!Object.keys(c.belief).length) delete c.belief;
}

/** Who runs this room's side of the ball: the coordinator, the head coach covering, or nobody. */
export const runnerOf = (league: League, teamId: number, room: CoachRoom): Coach | null =>
  sideCoach(teamCoaches(league, teamId), sideRoleOf(room));

export const isLawyer = (p: Player): boolean => personalityOf(trueCharacter(p)) === 'Locker-Room Lawyer';
