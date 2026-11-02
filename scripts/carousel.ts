/**
 * The coaching carousel as the offseason audit reads it (`scripts/offseason.ts`, and its extra leagues in
 * `offseason-league.ts`): who sits in every chair at kickoff, and where a new head coach came from.
 */
import { CHAIRS, chairHolder, teamCoaches } from '../src/engine/coaching';
import type { League, Team } from '../src/engine/types';

export const chairKey = (ch: (typeof CHAIRS)[number]) => `${ch.role}${ch.room ?? ''}`;

/** Who sits in every chair at kickoff, by team: the carousel is read off two of these. */
export const chairSnap = (l: League) =>
  new Map(
    l.teams.map((t) => [
      t.id,
      new Map(CHAIRS.map((ch) => [chairKey(ch), chairHolder(teamCoaches(l, t.id), ch)?.id ?? -1])),
    ]),
  );

export type HcOrigin = 'retread' | 'coordinator' | 'other';

/** Where a club's new head coach came from: a former head coach, a coordinator, or anywhere else. */
export function hcOrigin(league: League, t: Team, id: number): HcOrigin {
  const career = (league.coaches[id]?.career ?? []).filter((cs) => cs.season < league.season);
  // Keeping last season's internal interim is a promotion, not rehiring a former head coach.
  const retainedInterim = career.some(
    (cs) =>
      cs.role === 'headCoach' &&
      cs.teamId === t.id &&
      cs.season === league.season - 1 &&
      (cs.record?.fromWeek ?? 1) > 1,
  );
  const past = retainedInterim
    ? career.filter((cs) => cs.season !== league.season - 1 || cs.role !== 'headCoach')
    : career;
  if (past.some((cs) => cs.role === 'headCoach')) return 'retread';
  if (past.at(-1)?.role === 'offCoord' || past.at(-1)?.role === 'defCoord') return 'coordinator';
  return 'other';
}

/** The new head coaches since `before`, by where they came from. */
export function newHeadCoaches(league: League, before: ReturnType<typeof chairSnap>): Record<HcOrigin, number> {
  const out = { retread: 0, coordinator: 0, other: 0 };
  const key = chairKey(CHAIRS.find((ch) => ch.role === 'headCoach')!);
  const now = chairSnap(league);
  for (const t of league.teams) {
    const id = now.get(t.id)!.get(key)!;
    if (id !== before.get(t.id)!.get(key)) out[hcOrigin(league, t, id)]++;
  }
  return out;
}
