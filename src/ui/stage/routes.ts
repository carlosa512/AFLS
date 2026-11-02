/**
 * Routes, as All-22 runs them: which route a receiver ran to make his catch (by where it was caught, how deep and
 * which way from where he lined up), and the route itself, a stem, a plant and a break that bring him to the catch as
 * the ball does. Pure: the same catch, the same route. Spec: docs/superpowers/specs/2026-11-02-all-22-passing-game-
 * design.md §3 and §6 (the NFL's air yards and times by route, 2022).
 */
import type { Rng } from '../../engine/rng';
import { FIELD_W } from './ballPath';
import type { Pt } from './formations';
import type { Keyframe } from './scripts';

export type RouteId =
  | 'screen'
  | 'swing'
  | 'flat'
  | 'quickOut'
  | 'drag'
  | 'hitch'
  | 'slant'
  | 'stick'
  | 'curl'
  | 'out'
  | 'cross'
  | 'comeback'
  | 'dig'
  | 'wheel'
  | 'corner'
  | 'post'
  | 'go'
  | 'seam';

/** Where he lined up: split wide, in the slot, a tight end on the line, or the back. */
export type Spot = 'WIDE' | 'SLOT' | 'TE' | 'RB';

/** Which way the route takes him from his line: toward the middle, toward the sideline, or up it. */
type Way = 'in' | 'out' | 'line';

interface RouteShape {
  /** The NFL's average air yards at the target on it (nflverse 2022; ours where it has none). */
  mean: number;
  /** The air yards it's thrown at. */
  air: readonly [number, number];
  way: readonly Way[];
  spots: readonly Spot[];
  /** He settles at the catch spot if he gets there early (a sit route), rather than running on through it. */
  sits?: true;
}

export const ROUTES: Record<RouteId, RouteShape> = {
  screen: { mean: -2.8, air: [-10, 0], way: ['in', 'out', 'line'], spots: ['WIDE', 'SLOT', 'TE', 'RB'], sits: true },
  swing: { mean: -0.5, air: [-6, 3], way: ['out', 'line'], spots: ['RB'], sits: true },
  flat: { mean: -0.5, air: [-3, 4], way: ['out', 'line'], spots: ['RB', 'TE', 'SLOT'], sits: true },
  quickOut: { mean: 3, air: [0, 6], way: ['out'], spots: ['WIDE', 'SLOT'], sits: true },
  drag: { mean: 3, air: [0, 7], way: ['in'], spots: ['WIDE', 'SLOT', 'TE', 'RB'] },
  hitch: { mean: 5, air: [2, 9], way: ['line'], spots: ['WIDE', 'SLOT', 'TE'], sits: true },
  slant: { mean: 6.1, air: [3, 10], way: ['in'], spots: ['WIDE', 'SLOT'] },
  stick: { mean: 6, air: [4, 8], way: ['line', 'out'], spots: ['TE', 'SLOT', 'RB'], sits: true },
  curl: { mean: 7.4, air: [5, 14], way: ['line', 'in'], spots: ['WIDE', 'SLOT', 'TE'], sits: true },
  out: { mean: 7.3, air: [3, 15], way: ['out'], spots: ['WIDE', 'SLOT', 'TE'], sits: true },
  cross: { mean: 6.9, air: [3, 18], way: ['in'], spots: ['SLOT', 'TE', 'WIDE'] },
  comeback: { mean: 13, air: [10, 18], way: ['out', 'line'], spots: ['WIDE'], sits: true },
  dig: { mean: 10.6, air: [8, 18], way: ['in'], spots: ['WIDE', 'SLOT', 'TE'] },
  wheel: { mean: 13.8, air: [5, 30], way: ['out', 'line'], spots: ['RB', 'SLOT'] },
  corner: { mean: 21.3, air: [12, 40], way: ['out'], spots: ['WIDE', 'SLOT', 'TE'] },
  post: { mean: 21, air: [12, 60], way: ['in'], spots: ['WIDE', 'SLOT', 'TE'] },
  go: { mean: 23.4, air: [12, 70], way: ['line', 'out'], spots: ['WIDE'] },
  seam: { mean: 20, air: [10, 50], way: ['line'], spots: ['SLOT', 'TE'] },
};

const IDS = Object.keys(ROUTES) as RouteId[];
/** How much a catch's depth leans the pick toward the route that's usually thrown there: tighter short, looser deep. */
const LEAN = (air: number) => (air < 12 ? 3.5 : 8);
/** The route his spot runs to a depth none of its others reach. */
const fallback = (air: number, spot: Spot): RouteId =>
  air < 0
    ? spot === 'RB'
      ? 'swing'
      : 'screen'
    : air < 10
      ? spot === 'RB'
        ? 'stick'
        : 'curl'
      : spot === 'RB'
        ? 'wheel'
        : spot === 'WIDE'
          ? 'go'
          : 'seam';

/** Further than this across from his line, the catch went in or out; nearer, he ran up his line. */
const ACROSS = 2.5;

const wayOf = (across: number): Way => (across > ACROSS ? 'in' : across < -ACROSS ? 'out' : 'line');

/**
 * The route for a catch `air` yards past the line, `across` yards toward the middle from where he lined up (negative:
 * toward the sideline), from his spot: the routes that go there, leaning on the one whose NFL average is nearest.
 */
export function routeFor(c: { air: number; across: number; spot: Spot }, rng: Rng): RouteId {
  const way = wayOf(c.across);
  const fits = (id: RouteId, strict: boolean) => {
    const r = ROUTES[id];
    return r.spots.includes(c.spot) && c.air >= r.air[0] && c.air <= r.air[1] && (!strict || r.way.includes(way));
  };
  let pool = IDS.filter((id) => fits(id, true));
  // Nothing his spot runs goes exactly there (a back's catch 20 yards across): the nearest that goes that deep.
  if (!pool.length) pool = IDS.filter((id) => fits(id, false));
  if (!pool.length) pool = [fallback(c.air, c.spot)];
  return rng.weighted(pool, (id) => Math.exp(-((c.air - ROUTES[id].mean) ** 2) / (2 * LEAN(c.air) ** 2)) + 1e-6);
}

/** A route's spots from where he lines up to the catch: his stem, the break, the catch. `in` points to the middle. */
function shape(route: RouteId, from: Pt, to: Pt, dir: 1 | -1, inward: 1 | -1): Pt[] {
  const up = (p: Pt, d: number, across = 0): Pt => ({ x: p.x + dir * d, y: p.y + inward * across });
  const depth = (to.x - from.x) * dir;
  const at = (d: number, y = from.y): Pt => ({ x: from.x + dir * d, y });
  switch (route) {
    case 'screen':
    case 'swing':
      // A step back or out to the catch, behind the line: no stem.
      return [to];
    case 'flat':
      return [up(from, Math.max(0.5, Math.min(1.5, depth)), 0), to];
    case 'quickOut':
    case 'out':
      // Up his line to the catch's depth, plant, and square out to it.
      return [at(Math.max(1.5, depth)), to];
    case 'drag':
    case 'cross':
      // A shallow release, then across, rising to the catch.
      return [at(Math.max(1, Math.min(depth, 2)), from.y + inward * Math.min(3, Math.abs(to.y - from.y) * 0.3)), to];
    case 'dig':
      return [at(Math.max(5, depth)), to];
    case 'slant':
      return [at(Math.max(1, Math.min(2, depth - 1))), to];
    case 'hitch':
    case 'stick':
      // Up a yard past the catch, then back to it.
      return [at(depth + 1, to.y), to];
    case 'curl':
      return [at(depth + 2, from.y + (to.y - from.y) * 0.5), to];
    case 'comeback':
      return [at(depth + 3, from.y + (to.y - from.y) * 0.3), to];
    case 'wheel':
      // Out to the flat, then turned up the sideline.
      return [up(from, 1, -inward * 4), at(Math.min(depth, 8), to.y), to];
    case 'corner':
    case 'post': {
      // A stem up his line, then the break at about 45 degrees to the catch.
      const lateral = Math.abs(to.y - from.y);
      return [at(Math.max(5, Math.min(12, depth - lateral))), to];
    }
    case 'go':
    case 'seam':
      // A release, then up the field, leaning to where the ball is put.
      return [at(Math.min(depth, 5), from.y + (to.y - from.y) * 0.15), to];
  }
}

/** The plant: this far either side of a break he's slower (the stem eases into it, the break comes out of it). */
const PLANT = 0.6;
/** How much longer a yard takes through a plant than at his pace, and while getting up to speed off the line. */
const PLANT_COST = 1.8;
const START = 2;
const START_COST = 1.6;
/** The slowest he runs a route, and his pace when he has time to spare. */
export const MIN_PACE = 5.5;

/** A path's length, each yard weighted by how long it takes: the start, then each plant. */
function effort(points: readonly Pt[]): number {
  let e = 0;
  let run = 0;
  for (let i = 1; i < points.length; i++) {
    const l = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    const startPart = Math.max(0, Math.min(l, START - run));
    const plants = (i > 1 ? Math.min(PLANT, l) : 0) + (i < points.length - 1 ? Math.min(PLANT, l) : 0);
    e +=
      startPart * START_COST +
      Math.max(0, Math.min(plants, l - startPart)) * PLANT_COST +
      Math.max(0, l - startPart - plants);
    run += l;
  }
  return e;
}

/** The time he needs to run a route at `pace` (yards a second): how soon the ball can be thrown for him to make it. */
export function routeTime(route: RouteId, from: Pt, to: Pt, dir: 1 | -1, inward: 1 | -1, pace: number): number {
  return effort([from, ...shape(route, from, to, dir, inward)]) / pace;
}

/**
 * The route as keyframes from the snap: he leaves his spot, runs his stem, plants and breaks, and reaches `to` at
 * `arrive`. With time to spare, a sit route gets there at his pace (at least `MIN_PACE`) and settles; any other eases
 * off to arrive with the ball. Never faster than `top` when `arrive` gives him the time (`routeTime`). Keyframes
 * either side of each break make the slowdown through it show.
 */
export function routeKeys(
  route: RouteId,
  from: Pt,
  to: Pt,
  arrive: number,
  dir: 1 | -1,
  inward: 1 | -1,
  top: number,
): Keyframe[] {
  const pts = [from, ...shape(route, from, to, dir, inward)].map((p) => ({
    x: p.x,
    y: Math.max(0.5, Math.min(FIELD_W - 0.5, p.y)),
  }));
  const need = effort(pts);
  const pace = Math.max(MIN_PACE, Math.min(top, need / Math.max(0.1, arrive)));
  // At his pace he gets there at `done`: early on a route he has time for. A sit route settles at the spot; any other
  // eases off to arrive with the ball.
  const done = Math.min(arrive, need / pace);
  const scale = ROUTES[route].sits ? done : arrive;
  const keys: Keyframe[] = [];
  let e = 0;
  let run = 0;
  const push = (p: Pt) => keys.push({ t: (e / need) * scale, x: p.x, y: p.y });
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    const along = (d: number): Pt => ({ x: a.x + ((b.x - a.x) * d) / (l || 1), y: a.y + ((b.y - a.y) * d) / (l || 1) });
    // Off the line: up to speed over the first couple of yards.
    const startPart = Math.max(0, Math.min(l, START - run));
    if (startPart > 0.01 && startPart < l - 0.01) {
      e += startPart * START_COST;
      push(along(startPart));
    } else e += startPart * START_COST;
    let d = startPart;
    // Out of the last break.
    if (i > 1 && l - d > PLANT) {
      e += PLANT * PLANT_COST;
      d += PLANT;
      push(along(d));
    }
    // Into the next break.
    const tail = i < pts.length - 1 ? Math.min(PLANT, l - d) : 0;
    e += l - d - tail;
    if (tail > 0) push(along(l - tail));
    e += tail * PLANT_COST;
    push(b);
    run += l;
  }
  if (keys.length) keys[keys.length - 1] = { ...keys[keys.length - 1], t: scale };
  if (scale < arrive) keys.push({ t: arrive, x: to.x, y: to.y });
  return keys.filter((k, i) => k.t > 0 && (i === 0 || k.t > keys[i - 1].t + 1e-6));
}
