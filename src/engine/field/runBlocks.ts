/**
 * Blocking by the call on a run (spec: docs/superpowers/specs/2026-11-02-all-22-open-field-design.md §2): the call
 * read off the run (outside zone, inside zone, power), the hole the back presses, and who blocks whom: the line's
 * first steps, each man's block, the double teams that climb to a linebacker, a pulling guard, the edge sealed or
 * kicked out, and the free man picked up by whoever can get to him first. The engine's tackler and the man the
 * engine says missed are never blocked (they make their plays). `steer.ts` plays it out.
 */
import type { Rng } from '../rng';
import type { OffSchemeId } from '../schemes';
import type { PlayLogEntry } from '../types';
import { FIELD_W } from './geometry';
import type { Cast } from './cast';
import type { Pt } from './formations';
import { has, type Habits } from './habits';
import { SPEED } from './speed';

export type RunCall = 'outsideZone' | 'insideZone' | 'power';

/** How far across from the ball (yards, toward the play side) the back presses, by the call. */
const ACROSS: Record<RunCall, number> = { insideZone: 1.5, power: 4, outsideZone: 7 };
/** An inside run that's power rather than zone: for a power team, and for everyone else. */
const POWER_INSIDE = { power: 0.6, other: 0.25 };
/** On power, how often a back or tight end kicks out the end (the puller then leads up to a linebacker). */
const KICK_OUT = 0.4;
/** A zone step: across toward the play side and up (yards). A down block's step inside. */
const ZONE_ACROSS = 1.2;
const ZONE_UP = 0.4;
const DOWN = 0.8;
/** A pancake hunter drives his man this much further (yards). */
const PANCAKE = 1.5;
/** The puller: this deep behind the line on his way across, and this far up through the hole. */
const PULL_DEPTH = 1.5;
const THROUGH = 3;
/** A soft puller pulls into traffic: he stops this far short of the hole. */
const SOFT_SHORT = 1;

export interface RunBlocking {
  call: RunCall;
  /** The play side, from the offense's view (+1: toward `ballY + dir`). */
  side: 1 | -1;
  /** Where the back presses, at the line. */
  hole: Pt;
  /** Each lineman's first step (the puller's: back off the line). */
  steps: Map<number, Pt>;
  /** Blocker → the man he blocks. */
  on: Map<number, number>;
  /** Double-teamer → the linebacker he climbs to, about a second after the handoff. */
  climb: Map<number, number>;
  /** Power's pulling guard and his path: behind the line to the hole, then up through it. */
  puller: { id: number; path: Pt[] } | null;
  /** Unblocked defenders who could reach the hole before the back, nobody able to get to them first. */
  free: number[];
}

/** The call on a run, read off how the engine logged it, and the play side (from the offense's view). */
export function runCall(e: PlayLogEntry, scheme: OffSchemeId | undefined, rng: Rng): { call: RunCall; side: 1 | -1 } {
  // Both draws always taken, so the read never shifts what comes after it.
  const coin = rng.next();
  const lean = rng.next();
  const side: 1 | -1 = Math.sign(e.lane ?? 0) === -1 ? -1 : Math.sign(e.lane ?? 0) === 1 ? 1 : coin < 0.5 ? 1 : -1;
  const zoneTeam = scheme === 'wideZone';
  let call: RunCall;
  if (e.open?.bounce) call = 'insideZone';
  else if (/ rush (left|right) end\b/.test(` ${e.text}`)) call = 'outsideZone';
  else if (/ rush (left|right) tackle\b/.test(` ${e.text}`)) call = zoneTeam ? 'insideZone' : 'power';
  else
    call = !zoneTeam && lean < (scheme === 'power' ? POWER_INSIDE.power : POWER_INSIDE.other) ? 'power' : 'insideZone';
  return { call, side };
}

/** Where the back presses: at the line, across toward the play side by the call (a bounce ends at the edge). */
export function holeAt(call: RunCall, side: 1 | -1, ball: Pt, dir: 1 | -1, bounce: boolean): Pt {
  const across = bounce ? ACROSS.outsideZone : ACROSS[call];
  return { x: ball.x, y: Math.max(1, Math.min(FIELD_W - 1, ball.y + dir * side * across)) };
}

export function planRunBlocks(args: {
  call: RunCall;
  side: 1 | -1;
  hole: Pt;
  start: ReadonlyMap<number, Pt>;
  cast: Cast;
  dir: 1 | -1;
  /** The engine's tackler and the man it says missed: nobody blocks them. */
  exclude: ReadonlySet<number>;
  /** Where the back is `t` seconds after the snap, and when he takes the handoff. */
  backAt: (t: number) => Pt;
  handoff: number;
  /** The carrier, who blocks nobody. */
  carrier?: number;
  habits?: Habits;
  rng: Rng;
}): RunBlocking {
  const { call, side, hole, start, cast, dir, exclude, habits } = args;
  // The play side on the field: +1 toward higher y.
  const fs = dir * side;
  const at = (id: number) => start.get(id)!;
  const onField = (id: number) => start.has(id);
  const across = (id: number) => at(id).y * fs;
  const kickOut = args.rng.next() < KICK_OUT;

  const line = cast.offense.filter((m) => m.role === 'OL' && onField(m.id)).sort((a, b) => across(a.id) - across(b.id));
  const front = cast.defense.filter(
    (m) => (m.role === 'DT' || m.role === 'EDGE') && onField(m.id) && !exclude.has(m.id),
  );
  const backers = cast.defense.filter((m) => m.role === 'LB' && onField(m.id) && !exclude.has(m.id));
  const steps = new Map<number, Pt>();
  const on = new Map<number, number>();
  const climb = new Map<number, number>();
  const taken = new Set<number>();
  const block = (b: number, d: number) => {
    on.set(b, d);
    taken.add(d);
  };
  const nearest = (from: Pt, pool: readonly { id: number }[], ok: (id: number) => boolean = () => true) => {
    let best: number | undefined;
    let gap = Infinity;
    for (const m of pool) {
      if (!ok(m.id)) continue;
      const d = Math.hypot(at(m.id).x - from.x, at(m.id).y - from.y);
      if (d < gap) [gap, best] = [d, m.id];
    }
    return best;
  };
  // The play-side end: the edge the seal or the kick-out takes.
  const edge = front.filter((m) => m.role === 'EDGE').sort((a, b) => across(b.id) - across(a.id))[0]?.id;

  // Power: the backside guard pulls (the second man in from the backside end of the line).
  const pullerId = call === 'power' && line.length >= 4 ? line[1].id : undefined;
  let puller: RunBlocking['puller'] = null;
  if (pullerId !== undefined) {
    const s = at(pullerId);
    const soft = has(habits, pullerId, 'pullsSoft');
    const behind = (y: number): Pt => ({ x: hole.x - dir * PULL_DEPTH, y });
    const path = soft
      ? [behind(s.y), behind(hole.y - fs * SOFT_SHORT)]
      : [behind(s.y), behind(hole.y), { x: hole.x, y: hole.y }, { x: hole.x + dir * THROUGH, y: hole.y }];
    puller = { id: pullerId, path };
    steps.set(pullerId, behind(s.y));
  }

  // The edge first: sealed inside by the tight end (or the slot) on outside zone; kicked out on some power calls.
  const ends = cast.offense
    .filter((m) => (m.role === 'TE' || m.role === 'WR' || m.role === 'RB') && onField(m.id) && m.id !== args.carrier)
    .sort((a, b) => across(b.id) - across(a.id));
  if (edge !== undefined && call === 'outsideZone') {
    const sealer = ends.find((m) => m.role === 'TE') ?? ends.find((m) => m.role === 'WR');
    if (sealer) block(sealer.id, edge);
  } else if (edge !== undefined && call === 'power' && kickOut) {
    const kicker = ends.find((m) => m.role === 'RB') ?? ends.find((m) => m.role === 'TE');
    if (kicker) block(kicker.id, edge);
  }

  // The line, from the play side back: a zone step and the man in his play-side gap, or a down block inside.
  const spare: number[] = [];
  for (const m of [...line].reverse()) {
    if (m.id === pullerId) continue;
    const s = at(m.id);
    const drive = has(habits, m.id, 'pancakePreacher') ? PANCAKE : 0;
    const gap = (id: number) => (at(id).y - s.y) * fs;
    const d =
      nearest(
        s,
        front,
        (id) =>
          !taken.has(id) &&
          (call === 'power' ? gap(id) <= 1 : gap(id) >= -1) &&
          Math.abs(gap(id)) < (call === 'power' ? 4 : 3),
      ) ??
      // (On zone, a man on his backside is the next man's, in that man's play-side gap: he doubles or climbs instead.)
      (call === 'power' ? nearest(s, front, (id) => !taken.has(id) && Math.abs(gap(id)) < 3) : undefined);
    if (d !== undefined) block(m.id, d);
    else spare.push(m.id);
    // The first step: a down block's step inside on power; on zone a reach step toward the play side, far enough to
    // get to his man's play-side shoulder.
    const reach = d === undefined ? ZONE_ACROSS : Math.max(ZONE_ACROSS, gap(d) + 0.5);
    steps.set(
      m.id,
      call === 'power'
        ? { x: s.x + dir * (ZONE_UP + drive), y: s.y - fs * DOWN }
        : { x: s.x + dir * (ZONE_UP + drive), y: s.y + fs * reach },
    );
  }
  // Spare linemen double the nearest man up front, then climb to a linebacker.
  for (const b of spare) {
    const d = nearest(at(b), front);
    if (d !== undefined) on.set(b, d);
    const lb = nearest(at(b), backers, (id) => !taken.has(id));
    if (lb !== undefined) {
      climb.set(b, lb);
      taken.add(lb);
    }
  }
  // The puller: leads up to a linebacker after a kick-out, else kicks out the end himself; a soft one takes the
  // first man he meets short of the hole.
  if (puller) {
    const end = puller.path[puller.path.length - 1];
    const target = has(habits, puller.id, 'pullsSoft')
      ? (nearest(end, [...front, ...backers], (id) => !taken.has(id)) ?? nearest(end, [...front, ...backers]))
      : kickOut || edge === undefined || taken.has(edge)
        ? nearest(end, backers, (id) => !taken.has(id))
        : edge;
    if (target !== undefined) block(puller.id, target);
  }

  // The free man: anyone left who could get to the hole before the back is picked up by whoever can get to him first.
  let tHole = args.handoff + 1.6;
  for (let t = args.handoff; t < args.handoff + 4; t += 0.05) {
    const b = args.backAt(t);
    if (Math.hypot(b.x - hole.x, b.y - hole.y) <= 0.25) {
      tHole = t;
      break;
    }
  }
  const helpers = cast.offense.filter(
    (m) => m.role !== 'QB' && m.role !== 'OL' && onField(m.id) && m.id !== args.carrier && !on.has(m.id),
  );
  const free: number[] = [];
  for (const m of cast.defense) {
    if (!onField(m.id) || exclude.has(m.id) || taken.has(m.id)) continue;
    const s = at(m.id);
    const there = Math.hypot(s.x - hole.x, s.y - hole.y) / SPEED[m.role];
    if (there >= tHole + 0.3) continue;
    const helper = helpers
      .filter((h) => !on.has(h.id) && Math.hypot(at(h.id).x - s.x, at(h.id).y - s.y) / SPEED[h.role] < there)
      .sort(
        (a, b) => Math.hypot(at(a.id).x - s.x, at(a.id).y - s.y) - Math.hypot(at(b.id).x - s.x, at(b.id).y - s.y),
      )[0];
    if (helper) block(helper.id, m.id);
    else free.push(m.id);
  }
  return { call, side, hole, steps, on, climb, puller, free };
}
