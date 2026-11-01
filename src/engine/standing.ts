/**
 * Who the room listens to (docs/superpowers/specs/2026-11-01-locker-room-voices-design.md). A man's weight is how far
 * his word carries: his leadership, whether he plays, how long he's been around and here, and what he's won. Weight
 * makes him a leader, a voice, or one of the quiet majority; how he sounds (he stirs, he steadies) is his makeup.
 * Units are the position coaches' rooms plus the specialists. Nothing here is stored: it is all worked out on the
 * spot from what the league already holds, and nothing here draws from a random stream.
 *
 * `morale.ts` and this module import each other: each uses the other's exports only inside function bodies.
 */
import { ROOM_OF } from './coaching';
import { leadFactor } from './mentoring';
import { actualRole, isCaptain, type MoraleContext } from './morale';
import { starters } from './roster';
import { seasonRole } from './scouting';
import { temperamentOf, TRAIT_MEAN } from './traits';
import type { CoachRoom, League, Player, Position } from './types';

export type Unit = CoachRoom | 'ST';
/** Spelled out, not spread from `COACH_ROOMS`: a top-level read of another module breaks on an import cycle. */
export const UNITS: readonly Unit[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB', 'ST'];
export type Side = 'offense' | 'defense' | 'specialTeams';

export const unitOf = (pos: Position): Unit => ROOM_OF[pos] ?? 'ST';
export const sideOf = (unit: Unit): Side =>
  unit === 'ST' ? 'specialTeams' : unit === 'DL' || unit === 'LB' || unit === 'DB' ? 'defense' : 'offense';

export type Tier = 'leader' | 'voice';
export type Sound = 'stirs' | 'steadies';

/** Weight at which the room goes to him, and at which his word carries. */
export const LEADER_AT = 1.25;
export const VOICE_AT = 0.85;

const TRAIT_SD = 3.5;
const z = (v: number) => (v - TRAIT_MEAN) / TRAIT_SD;

/** Everyone with a season award or an All-League team since `season`. */
export function honouredSince(league: League, season: number): Set<number> {
  const out = new Set<number>();
  for (const a of league.awards ?? []) {
    if (a.season < season) continue;
    for (const w of Object.values(a.winners)) if (w) out.add(w.playerId);
    for (const team of a.allLeague) for (const w of team) out.add(w.playerId);
  }
  return out;
}

/**
 * Years in the league: a rookie's word counts for little, a four-year man's in full, a long-time veteran's a little
 * more. A newcomer to the club has to earn the room first.
 */
export function seniority(experience: number, newcomer: boolean): number {
  const years = experience <= 4 ? 0.6 + 0.1 * Math.max(0, experience) : Math.min(1.15, 1 + 0.0375 * (experience - 4));
  return years * (newcomer ? 0.8 : 1);
}

/** In his first league year at this club: no earlier season with it, and not one of its own draft picks. */
export function isNewcomer(league: League, p: Player): boolean {
  if (p.teamId === null) return false;
  if (p.draft?.teamId === p.teamId) return false;
  for (const [season, teams] of Object.entries(p.statTeams ?? {}))
    if (Number(season) < league.season && teams.includes(p.teamId)) return false;
  return true;
}

const FIELD: Record<number, number> = { 2: 1, 1: 0.7, 0: 0.4 };
const ROLE_STEP = { starter: 2, rotation: 1, backup: 0 } as const;

/** How far his word carries in the room. True traits, as mentoring reads them; a screen only ever sees words. */
export function weightOf(league: League, p: Player, ctx: MoraleContext): number {
  if (p.teamId === null) return 0;
  // The role morale's grievance reads; hurt in season (null), last season's role.
  const last = seasonRole(league, p, ctx.season - 1);
  const role = actualRole(league, p, ctx) ?? (last ? ROLE_STEP[last.role] : 0);
  let stature = ctx.honoured.has(p.id) ? 1.2 : 1;
  if (p.position === 'QB' && starters(league, league.teams[p.teamId], 'QB')[0]?.id === p.id) stature *= 1.15;
  return leadFactor(p.traits.leads) * FIELD[role] * seniority(p.experience, isNewcomer(league, p)) * stature;
}

/** A captain always leads; otherwise his weight decides. */
export function tierOf(league: League, p: Player, weight: number): Tier | null {
  if (isCaptain(league, p)) return 'leader';
  return weight >= LEADER_AT ? 'leader' : weight >= VOICE_AT ? 'voice' : null;
}

/** How his mood travels: a man who stirs says it out loud; a calm leader keeps a bad week to himself. */
export function soundOf(p: Player): Sound | null {
  if (z(p.traits.controversy) >= 1) return 'stirs';
  if (z(p.traits.leads) >= 1 && z(temperamentOf(p)) >= 0.5) return 'steadies';
  return null;
}
