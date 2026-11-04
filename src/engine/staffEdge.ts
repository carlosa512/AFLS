/**
 * Coaches on Sunday (L4, docs/superpowers/specs/2026-11-04-backing-the-staff-design.md §1; MVP #11): each room's staff
 * edge in rating points, its side's coach (the coordinator, or the head coach covering) up to ±0.5 and the head coach
 * up to ±0.25, each from his quality and how far the room believes in him. Centred on the league each week, so its
 * totals hold; `buildLineup` adds it to the knocks beside chemistry. Nothing stored, nothing drawn.
 */
import { beliefOf, sideRoleOf, type SideRole } from './belief';
import { CHEM_ROOMS, type ChemRoom } from './chemistry';
import { coachValue } from './coachRatings';
import { chairHolder, coordinatorOf, COVER_COST, coveringHeadCoach, teamCoaches, TYPICAL, VACANT } from './coaching';
import { credibilityOf } from './meetings/credibility';
import { moraleClock } from './morale';
import { clamp } from './rng';
import type { League } from './types';

export const STAFF = {
  /** A side's coach at his best with his rooms behind him, and the head coach for every room, in rating points. */
  // The owner's call (2026-11-04): at ±0.5 and ±0.25 the win spread ran 3.63 against the NFL's 3.0–3.4, and at ±0.3
  // and ±0.15 3.46 over 30 seasons.
  coord: 0.2,
  head: 0.1,
  /** How the two halves weigh inside each part: his quality, and the room's belief in him. */
  quality: 0.6,
  belief: 0.4,
  /** This far from a typical coach's value is the whole quality half. */
  span: 3,
};
const CAP = STAFF.coord + STAFF.head;

/** Every room's staff edge held at zero (`SimOptions.staff`, `buildLineup`): for tests that read something else. */
export const NO_STAFF: Readonly<Record<ChemRoom, number>> = { QB: 0, RB: 0, WR: 0, OL: 0, DL: 0, LB: 0, DB: 0 };

export const quality = (value: number): number => clamp((value - TYPICAL) / STAFF.span, -1, 1);

/** What runs a side is worth: its coordinator, a head coach covering it (with a whole team to run too), or nobody. */
export function sideValue(league: League, teamId: number, role: SideRole): number {
  const coaches = teamCoaches(league, teamId);
  const coord = coordinatorOf(coaches, role);
  if (coord) return coachValue(coord);
  const hc = coveringHeadCoach(coaches, role);
  return hc ? Math.max(VACANT, coachValue(hc) - COVER_COST) : VACANT;
}

export interface StaffEdge {
  teamId: number;
  unit: ChemRoom;
  /** The side's coach's part, ±`STAFF.coord`, before centring. */
  coord: number;
  /** The head coach's part, ±`STAFF.head`, before centring. */
  head: number;
  /** Centred on the league, ±0.75. */
  edge: number;
}

function raw(league: League, teamId: number, unit: ChemRoom): { coord: number; head: number } {
  const coaches = teamCoaches(league, teamId);
  const role = sideRoleOf(unit);
  const runner = coordinatorOf(coaches, role) ?? coveringHeadCoach(coaches, role);
  const coord =
    STAFF.coord *
    clamp(STAFF.quality * quality(sideValue(league, teamId, role)) + STAFF.belief * beliefOf(runner, unit), -1, 1);
  const hc = chairHolder(coaches, { role: 'headCoach' });
  const head =
    STAFF.head *
    clamp(STAFF.quality * quality(hc ? coachValue(hc) : VACANT) + STAFF.belief * (hc ? credibilityOf(hc) : 0), -1, 1);
  return { coord, head };
}

/** The week's read: each room's raw parts and the league's mean per room. Dropped with chemistry's (`freshStaff`). */
interface Week {
  key: string;
  parts: Map<string, { coord: number; head: number }>;
  centre: Map<ChemRoom, number>;
}
const weeks = new WeakMap<League, Week>();

const weekKey = (league: League) =>
  [league.season, league.phase, league.week, league.moraleAt ?? moraleClock(league)].join(':');

/** Forget the week's read: game day's first lineup reads the staffs and beliefs as they stand. */
export function freshStaff(league: League): void {
  weeks.delete(league);
}

function week(league: League): Week {
  const key = weekKey(league);
  const hit = weeks.get(league);
  if (hit?.key === key) return hit;
  const parts = new Map<string, { coord: number; head: number }>();
  const centre = new Map<ChemRoom, number>();
  for (const unit of CHEM_ROOMS) {
    let sum = 0;
    for (const t of league.teams) {
      const p = raw(league, t.id, unit);
      parts.set(`${t.id}:${unit}`, p);
      sum += p.coord + p.head;
    }
    centre.set(unit, sum / Math.max(1, league.teams.length));
  }
  const w: Week = { key, parts, centre };
  weeks.set(league, w);
  return w;
}

/** One room's staff edge this week (null for a club that isn't in the league). */
export function staffEdgeOf(league: League, teamId: number, unit: ChemRoom): StaffEdge | null {
  if (!league.teams[teamId]) return null;
  const w = week(league);
  const p = w.parts.get(`${teamId}:${unit}`) ?? raw(league, teamId, unit);
  const edge = clamp(p.coord + p.head - (w.centre.get(unit) ?? 0), -CAP, CAP);
  return { teamId, unit, coord: p.coord, head: p.head, edge };
}

/** Every club's rooms this week, keyed `${teamId}:${unit}`. */
export function staffWeek(league: League): Map<string, StaffEdge> {
  const out = new Map<string, StaffEdge>();
  for (const t of league.teams)
    for (const unit of CHEM_ROOMS) {
      const e = staffEdgeOf(league, t.id, unit);
      if (e) out.set(`${t.id}:${unit}`, e);
    }
  return out;
}
