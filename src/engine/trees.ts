/**
 * Coaching trees (docs/superpowers/specs/2026-10-28-personality-relationships-design.md §4, the research in
 * docs/research/coaching-trees.md). A coach is linked to a man he worked under only after three seasons together: on
 * his staff while he was head coach, or as a position coach under his side's coordinator. That's stricter than the
 * press, which counts a single season, on purpose: trees should be rare and earned. Everything is worked out from
 * `Coach.career` (and `pastUnder`, the founding trees' pre-league years); nothing about a tree is stored.
 */
import { newIdentity } from './identity';
import { coachRecord, winPct } from './records';
import { Rng } from './rng';
import type { Coach, CoachRole, CoachRoom, CoachSeason, League } from './types';

export const LINK_SEASONS = 3;

/** He worked `seasons` seasons under `mentorId`, who was his head coach (or his side's coordinator). */
export interface Link {
  mentorId: number;
  seasons: number;
  as: 'headCoach' | 'coordinator';
  /** The last season they worked together (pre-league years count as before the league began). */
  last: number;
}

// The rooms on offense (`ROOM_OF` in coaching.ts; spelled out here because coaching.ts reads this module).
const OFFENSE_ROOMS: ReadonlySet<CoachRoom> = new Set<CoachRoom>(['QB', 'RB', 'WR', 'OL']);

const everyone = (league: League): Coach[] => [
  ...Object.values(league.coaches),
  ...Object.values(league.retiredCoaches),
];
const weeks = (r: CoachSeason) => (r.record ? r.record.throughWeek - r.record.fromWeek + 1 : 18);

interface Index {
  links: Map<number, Link[]>;
  /** The same links read the other way: each mentor's men. */
  disciples: Map<number, number[]>;
  /** Only the men who worked under him while he was a head coach: the ones a tree is made of. */
  headMen: Map<number, number[]>;
  /** The seasons each root was a winner (`winningSeasons`), until his head-coach seasons change. */
  winners: Map<number, { seasons: number; winning: Set<number> | 'always' }>;
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
  const headMen = new Map<number, number[]>();
  for (const [id, ls] of links)
    for (const k of ls) {
      disciples.set(k.mentorId, [...(disciples.get(k.mentorId) ?? []), id]);
      if (k.as === 'headCoach') headMen.set(k.mentorId, [...(headMen.get(k.mentorId) ?? []), id]);
    }
  return { links, disciples, headMen, winners: new Map() };
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

/**
 * A head coach's own men (three seasons on his staff while he ran it) who went on to run a club: after their years
 * under him, so a former head coach who later served as his coordinator isn't his disciple.
 */
function headDisciples(league: League, rootId: number): Coach[] {
  return (index(league).headMen.get(rootId) ?? [])
    .map((id) => coachById(league, id))
    .filter((c): c is Coach => {
      if (!c) return false;
      const last = linksOf(league, c.id).find((k) => k.mentorId === rootId)?.last ?? -Infinity;
      // Running a club now counts as after, even before the season has credited him a game.
      return headSeasons(c).some((r) => r.season > last) || (isActiveHead(c) && league.season > last);
    })
    .sort((a, b) => a.id - b.id);
}

/** A head coach's own men, whether or not they ran a club: a tree's branches run through them. */
const headMen = (league: League, rootId: number): Coach[] =>
  (index(league).headMen.get(rootId) ?? []).map((id) => coachById(league, id)).filter((c): c is Coach => !!c);

/** The seasons a disciple ran a club after his years under `rootId` (a founding disciple's current job counts). */
function seasonsInCharge(league: League, c: Coach, rootId: number): number[] {
  const last = linksOf(league, c.id).find((k) => k.mentorId === rootId)?.last ?? -Infinity;
  const seasons = headSeasons(c)
    .filter((r) => r.season > last)
    .map((r) => r.season);
  if (isActiveHead(c) && !seasons.includes(league.season)) seasons.push(league.season);
  // Established only: his second season in charge or later (a first-year man fired in a year makes nobody a tree).
  const ran = new Set(seasons);
  const established = seasons.filter((x) => ran.has(x - 1));
  // A founding disciple was already established in his club before the league began.
  if (last === -Infinity && isActiveHead(c)) established.push(-Infinity, league.season);
  return established;
}

/** The season his tree was born (two of his men in charge at once), or null if it hasn't been. */
/** A tree grows from a winner: .500 or better over three seasons or more as a head coach. */
export const WINNER = { seasons: 3, share: 0.5 };
/** Seasons two of his men must run clubs side by side, both established, while he is a winner. */
export const SIDE_BY_SIDE = 2;

/**
 * The seasons by which he was a winner as a head coach, his record up to and including each (his team's record
 * stands in for an old season kept without his own), or 'always' for a founding root, who won before the league
 * began. Real trees grow from winners (Walsh, Parcells, Reid, Shanahan); a losing coach whose assistants get jobs is a
 * good teacher, not a tree.
 */
function winningSeasons(league: League, rootId: number): Set<number> | 'always' {
  const idx = index(league);
  const root = coachById(league, rootId);
  const rows = (root?.career ?? []).filter((r) => r.role === 'headCoach').length;
  const hit = idx.winners.get(rootId);
  if (hit && hit.seasons === rows) return hit.winning;
  let winning: Set<number> | 'always' = new Set();
  const founding = (idx.headMen.get(rootId) ?? []).some(
    (id) => linksOf(league, id).find((k) => k.mentorId === rootId)?.last === -Infinity,
  );
  if (founding) winning = 'always';
  else if (root) {
    const seasons = [...coachRecord(league, root, ['headCoach']).seasons].sort((a, b) => a.season - b.season);
    const r = { w: 0, l: 0, t: 0 };
    const counted = new Set<number>();
    for (const x of seasons) {
      r.w += x.regular.w;
      r.l += x.regular.l;
      r.t += x.regular.t;
      counted.add(x.season);
      if (counted.size >= WINNER.seasons && winPct(r) >= WINNER.share) winning.add(x.season);
    }
  }
  idx.winners.set(rootId, { seasons: rows, winning });
  return winning;
}

/** Whether he was a winner as of `season`: his record through the last season he was a head coach by then. */
function winnerAsOf(league: League, rootId: number, season: number): boolean {
  const winning = winningSeasons(league, rootId);
  if (winning === 'always') return true;
  const root = coachById(league, rootId);
  const last = Math.max(
    -Infinity,
    ...(root?.career ?? []).filter((r) => r.role === 'headCoach' && r.season <= season).map((r) => r.season),
  );
  return winning.has(last);
}

/** The seasons two or more of his men ran clubs at once, both established, oldest first. */
function sideBySide(league: League, coachId: number): number[] {
  const count = new Map<number, number>();
  for (const d of headDisciples(league, coachId))
    for (const s of new Set(seasonsInCharge(league, d, coachId))) count.set(s, (count.get(s) ?? 0) + 1);
  return [...count]
    .filter(([, n]) => n >= 2)
    .map(([s]) => s)
    .sort((a, b) => a - b);
}

/**
 * The season his tree was born, or null if it hasn't been: the second season two of his men ran clubs side by side,
 * both established, while he was a winner. One passing season of two disciples in charge isn't a tree; a run is.
 */
export function treeBornSeason(league: League, coachId: number): number | null {
  const seasons = sideBySide(league, coachId).filter((s) => winnerAsOf(league, coachId, s));
  if (seasons.length < SIDE_BY_SIDE) return null;
  // A founding tree's men were already side by side before the league began: it was born then, not this season.
  return seasons[0] === -Infinity ? -Infinity : seasons[SIDE_BY_SIDE - 1];
}

/**
 * He has a tree once two of his men have run clubs side by side for two seasons while he was a winner, as the press
 * recognizes one: a man whose assistants run clubs one after another, or who never won himself, is a good teacher,
 * not a tree.
 */
export const hasTree = (league: League, coachId: number): boolean => treeBornSeason(league, coachId) !== null;

/** Everyone in a tree below its root, branches included, each once (odd histories can loop). */
function descendants(league: League, rootId: number): Coach[] {
  const seen = new Set([rootId]);
  const out: Coach[] = [];
  const queue = [rootId];
  while (queue.length) {
    for (const d of headMen(league, queue.shift()!))
      if (!seen.has(d.id)) {
        seen.add(d.id);
        out.push(d);
        queue.push(d.id);
      }
  }
  return out;
}

export function treeOf(league: League, rootId: number): Tree | null {
  if (!hasTree(league, rootId)) return null;
  const disciples = headDisciples(league, rootId);
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

// ───────── the first trees ─────────

/**
 * A new league starts with a few trees, as the NFL always has some: three or four founding roots, one or two of them
 * retired legends, each with two of today's head coaches and a few coordinators or position coaches who worked under
 * him before the league began. That history goes in `Coach.pastUnder`, never in a career row, so nobody's record
 * counts it. On its own stream, and only once (an upgraded save gets what a new league from its seed would).
 */
export function seedFoundingTrees(league: League): void {
  const all = Object.values(league.coaches);
  if (all.some((c) => c.pastUnder?.length)) return;
  const rng = new Rng(`${league.seed}:trees:init`);
  const heads = all.filter(isActiveHead).sort((a, b) => a.id - b.id);
  const staff = all
    .filter((c) => c.teamId !== null && (c.role === 'offCoord' || c.role === 'defCoord' || c.role === 'positionCoach'))
    .sort((a, b) => a.id - b.id);
  const roots = rng.int(3, 4);
  const legends = rng.int(1, 2);
  const used = new Set<number>();
  const take = <T extends Coach>(pool: T[], n: number, ok: (c: T) => boolean = () => true): T[] => {
    const free = pool.filter((c) => !used.has(c.id) && ok(c));
    const out: T[] = [];
    while (out.length < n && free.length) {
      const c = free.splice(rng.int(0, free.length - 1), 1)[0];
      used.add(c.id);
      out.push(c);
    }
    return out;
  };
  const founders: Coach[] = take(heads, roots - legends, (c) => c.age >= 55);
  while (founders.length < roots) {
    const { firstName, lastName } = newIdentity(rng, { kind: 'coach', role: 'headCoach' });
    const legend: Coach = {
      id: league.nextCoachId++,
      firstName,
      lastName,
      role: 'headCoach',
      age: rng.int(66, 80),
      youth: rng.int(12, 17),
      veterans: rng.int(12, 17),
      teamId: null,
      contract: null,
    };
    league.retiredCoaches[legend.id] = legend;
    founders.push(legend);
  }
  for (const root of founders) {
    for (const d of take(heads, 2))
      (d.pastUnder ??= []).push({
        coachId: root.id,
        role: rng.chance(0.5) ? 'offCoord' : 'defCoord',
        seasons: rng.int(3, 6),
      });
    for (const d of take(staff, rng.int(1, 3)))
      (d.pastUnder ??= []).push({ coachId: root.id, role: d.role, seasons: rng.int(3, 6) });
  }
}

// ───────── the carousel ─────────

/** A new head coach keeps his own men more often (added to the chance in `cleanHouse`). */
export const TREE_KEEP = 0.25;
/** Hiring scores are lower-is-better: a man linked to the hiring head coach scores this much better. */
export const TREE_PULL = 0.3;
/** Head-coach searches: a hot tree's disciples score better, a withering one's worse. */
export const TREE_STANDING: Record<TreeStanding, number> = { hot: -0.15, steady: -0.05, withering: 0.4, faded: 0 };
/** The chance a new coordinator runs his main mentor's scheme instead of his own. */
export const TREE_SCHEME = 0.5;

const linked = (league: League, c: Coach, mentor: Coach) => linksOf(league, c.id).some((k) => k.mentorId === mentor.id);

/** What `cleanHouse` adds to the chance a new head coach keeps a man: his own men stay more often. */
export const keepBonus = (league: League, hc: Coach, c: Coach) => (linked(league, c, hc) ? TREE_KEEP : 0);

/**
 * What a candidate's tree adds to a hiring score (lower is better): a head coach reaches for his own people, and a
 * head-coach search leans on the standing of the tree a candidate comes from.
 */
export function treeLean(league: League, hc: Coach | null, c: Coach, role: CoachRole): number {
  let lean = hc && linked(league, c, hc) ? -TREE_PULL : 0;
  if (role === 'headCoach') {
    const tree = treeFor(league, c.id);
    if (tree) lean += TREE_STANDING[standingOf(league, tree)];
  }
  return lean;
}

/** A new coordinator's scheme: his main mentor's about half the time (a pure roll of the seed and his id). */
export function inheritedScheme(league: League, c: Coach, role: CoachRole): Coach['scheme'] | undefined {
  if (role !== 'offCoord' && role !== 'defCoord') return undefined;
  const m = mainMentor(league, c.id);
  if (!m?.scheme || !new Rng(`${league.seed}:treeScheme:${c.id}:${role}`).chance(TREE_SCHEME)) return undefined;
  if (role === 'offCoord') return m.scheme.offense ? { offense: m.scheme.offense } : undefined;
  return m.scheme.front ? { front: m.scheme.front, coverage: m.scheme.coverage } : undefined;
}
