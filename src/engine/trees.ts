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
  /** The same links read the other way: each mentor's men. */
  disciples: Map<number, number[]>;
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
  const disciples = new Map<number, number[]>();
  for (const [id, ls] of links)
    for (const k of ls) disciples.set(k.mentorId, [...(disciples.get(k.mentorId) ?? []), id]);
  return { links, disciples };
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
  return (index(league).disciples.get(mentorId) ?? [])
    .map((id) => coachById(league, id))
    .filter((c): c is Coach => !!c)
    .sort((a, b) => a.id - b.id);
}

// ───────── trees ─────────

export type TreeStanding = 'hot' | 'steady' | 'withering' | 'faded';

export interface Tree {
  rootId: number;
  /** His linked men who became head coaches. */
  disciples: number[];
  /** Disciples with trees of their own. */
  branches: number[];
  /** Head coaches in the league now from anywhere in the tree, branches included (the root himself aside). */
  activeHeadCoaches: number[];
}

/** Hot on a .550 run over three seasons; withering on .450 or worse over five with two or more fired; faded after four bare. */
export const HOT = { seasons: 3, share: 0.55 };
export const WITHERING = { seasons: 5, share: 0.45, fired: 2 };
export const FADED_SEASONS = 4;

const headSeasons = (c: Coach) => (c.career ?? []).filter((r) => r.role === 'headCoach');
const isActiveHead = (c: Coach) => c.role === 'headCoach' && c.teamId !== null;
const becameHead = (c: Coach) => isActiveHead(c) || headSeasons(c).length > 0;

const headDisciples = (league: League, rootId: number) => disciplesOf(league, rootId).filter(becameHead);

/** Two of his men have become head coaches: he has a tree. */
export const hasTree = (league: League, coachId: number) => headDisciples(league, coachId).length >= 2;

/** Everyone in a tree below its root, branches included, each once (odd histories can loop). */
function descendants(league: League, rootId: number): Coach[] {
  const seen = new Set([rootId]);
  const out: Coach[] = [];
  const queue = [rootId];
  while (queue.length) {
    for (const d of disciplesOf(league, queue.shift()!))
      if (!seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
        queue.push(d.id);
      }
  }
  return out;
}

export function treeOf(league: League, rootId: number): Tree | null {
  const disciples = headDisciples(league, rootId);
  if (disciples.length < 2) return null;
  return {
    rootId,
    disciples: disciples.map((d) => d.id),
    branches: disciples.filter((d) => hasTree(league, d.id)).map((d) => d.id),
    activeHeadCoaches: descendants(league, rootId)
      .filter(isActiveHead)
      .map((d) => d.id),
  };
}

/**
 * The trees alive now (two or more active head coaches), each counted once: a live tree inside another live tree's
 * branches is part of that one (the press called Shanahan and McVay one tree).
 */
export function liveTrees(league: League): Tree[] {
  const roots = everyone(league).filter((c) => hasTree(league, c.id));
  const live = roots.map((c) => treeOf(league, c.id)!).filter((t) => t.activeHeadCoaches.length >= 2);
  const inside = new Set<number>();
  for (const t of live) for (const d of descendants(league, t.rootId)) inside.add(d.id);
  return live.filter((t) => !inside.has(t.rootId));
}

/** The nearest tree a coach belongs to: up his main branch until someone has one. */
export function treeFor(league: League, coachId: number): Tree | null {
  const seen = new Set<number>();
  let at = mainMentor(league, coachId);
  while (at && !seen.has(at.id)) {
    seen.add(at.id);
    if (hasTree(league, at.id)) return treeOf(league, at.id);
    at = mainMentor(league, at.id);
  }
  return null;
}

/** How a tree is doing, from its head coaches' results (spec §4.6). */
export function standingOf(league: League, tree: Tree): TreeStanding {
  const now = league.season;
  const men = descendants(league, tree.rootId);
  const rows = men.flatMap((c) => headSeasons(c).map((r) => ({ c, r })));
  const lastHead = Math.max(-Infinity, ...rows.map((x) => x.r.season));
  if (!men.some(isActiveHead) && lastHead <= now - FADED_SEASONS) return 'faded';
  const share = (from: number) => {
    let w = 0;
    let games = 0;
    for (const { r } of rows)
      if (r.season >= from && r.season < now && r.record) {
        const g = r.record.regular;
        w += g.w + 0.5 * g.t;
        games += g.w + g.l + g.t;
      }
    return games ? w / games : null;
  };
  const hot = share(now - HOT.seasons);
  if (hot !== null && hot >= HOT.share) return 'hot';
  // Fired: his last season in a head coach's chair was a losing one, in the window, and he isn't in one now.
  const fired = men.filter((c) => {
    if (isActiveHead(c)) return false;
    const last = headSeasons(c).sort((a, b) => b.season - a.season)[0];
    const g = last?.record?.regular;
    return !!last && last.season >= now - WITHERING.seasons && !!g && g.w < g.l;
  }).length;
  const cold = share(now - WITHERING.seasons);
  if (cold !== null && cold <= WITHERING.share && fired >= WITHERING.fired) return 'withering';
  return 'steady';
}
