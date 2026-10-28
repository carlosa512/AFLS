/**
 * Coaching trees (docs/superpowers/specs/2026-10-28-personality-relationships-design.md §4, the research in
 * docs/research/coaching-trees.md). A coach is linked to a man he worked under only after three seasons together: on
 * his staff while he was head coach, or as a position coach under his side's coordinator. That's stricter than the
 * press, which counts a single season, on purpose: trees should be rare and earned. Everything is worked out from
 * `Coach.career` (and `pastUnder`, the founding trees' pre-league years); nothing about a tree is stored.
 */
import { ROOM_OF } from './coaching';
import type { Coach, CoachRoom, CoachSeason, League, Position } from './types';

export const LINK_SEASONS = 3;

/** He worked `seasons` seasons under `mentorId`, who was his head coach (or his side's coordinator). */
export interface Link {
  mentorId: number;
  seasons: number;
  as: 'headCoach' | 'coordinator';
  /** The last season they worked together (pre-league years count as before the league began). */
  last: number;
}

const OFFENSE_ROOMS: ReadonlySet<CoachRoom> = new Set(
  (Object.entries(ROOM_OF) as [Position, CoachRoom | null][])
    .filter(([pos, room]) => room && ['QB', 'RB', 'WR', 'TE', 'OL'].includes(pos))
    .map(([, room]) => room!),
);

const everyone = (league: League): Coach[] => [
  ...Object.values(league.coaches),
  ...Object.values(league.retiredCoaches),
];
const weeks = (r: CoachSeason) => (r.record ? r.record.throughWeek - r.record.fromWeek + 1 : 18);

interface Index {
  links: Map<number, Link[]>;
}
const cache = new WeakMap<League, { key: string; index: Index }>();

/** Who held a chair on a club in a season: the man with the most weeks in it (an interim season goes to the longer). */
function holders(league: League): Map<string, Coach> {
  const best = new Map<string, { c: Coach; w: number }>();
  for (const c of everyone(league))
    for (const r of c.career ?? []) {
      if (r.role !== 'headCoach' && r.role !== 'offCoord' && r.role !== 'defCoord') continue;
      const key = `${r.season}:${r.teamId}:${r.role}`;
      const w = weeks(r);
      const had = best.get(key);
      if (!had || w > had.w) best.set(key, { c, w });
    }
  return new Map([...best].map(([k, v]) => [k, v.c]));
}

function build(league: League): Index {
  const held = holders(league);
  const links = new Map<number, Link[]>();
  for (const c of everyone(league)) {
    const tally = new Map<number, Link>();
    const add = (mentorId: number, as: Link['as'], season: number, n = 1) => {
      if (mentorId === c.id) return;
      const t = tally.get(mentorId) ?? { mentorId, seasons: 0, as, last: season };
      t.seasons += n;
      t.last = Math.max(t.last, season);
      if (as === 'headCoach') t.as = 'headCoach';
      tally.set(mentorId, t);
    };
    for (const r of c.career ?? []) {
      if (r.role === 'headCoach') continue;
      const hc = held.get(`${r.season}:${r.teamId}:headCoach`);
      if (hc) add(hc.id, 'headCoach', r.season);
      if (r.role === 'positionCoach' && r.room) {
        const side = OFFENSE_ROOMS.has(r.room) ? 'offCoord' : 'defCoord';
        const coord = held.get(`${r.season}:${r.teamId}:${side}`);
        if (coord) add(coord.id, 'coordinator', r.season);
      }
    }
    for (const u of c.pastUnder ?? []) add(u.coachId, 'headCoach', -Infinity, u.seasons);
    const kept = [...tally.values()].filter((t) => t.seasons >= LINK_SEASONS);
    if (kept.length) links.set(c.id, kept);
  }
  return { links };
}

/** The tree index for the league as it is now (careers only change at hires and season's end). */
function index(league: League): Index {
  const key = `${league.season}:${league.phase}:${league.week}:${Object.keys(league.coaches).length}:${Object.keys(league.retiredCoaches).length}`;
  const hit = cache.get(league);
  if (hit?.key === key) return hit.index;
  const fresh = build(league);
  cache.set(league, { key, index: fresh });
  return fresh;
}

const coachById = (league: League, id: number): Coach | undefined => league.coaches[id] ?? league.retiredCoaches[id];

/** The men a coach is linked to: three seasons or more under each. */
export const linksOf = (league: League, coachId: number): Link[] => index(league).links.get(coachId) ?? [];

/** His main branch: the head coach he served longest under (the more recent one if two are level). */
export function mainMentor(league: League, coachId: number): Coach | undefined {
  const best = linksOf(league, coachId)
    .filter((k) => k.as === 'headCoach')
    .sort((a, b) => b.seasons - a.seasons || b.last - a.last)[0];
  return best && coachById(league, best.mentorId);
}

/** Everyone linked to `mentorId`. */
export function disciplesOf(league: League, mentorId: number): Coach[] {
  const out: Coach[] = [];
  for (const [id, links] of index(league).links)
    if (links.some((k) => k.mentorId === mentorId)) {
      const c = coachById(league, id);
      if (c) out.push(c);
    }
  return out.sort((a, b) => a.id - b.id);
}
