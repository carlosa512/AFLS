/**
 * Everyone the script leaves alone, steered step by step toward a goal set by his role: linemen engage, receivers run
 * decoy routes, zone defenders sink and break on the ball, man defenders mirror, and everyone chases once the ball is
 * out. Worked out once when a play loads, at a fixed step, on its own seeded stream: the same play always moves the
 * same way, at any playback speed.
 */
import type { Rng } from '../../engine/rng';
import { FIELD_W } from './ballPath';
import type { Cast, CastMember, Role } from './cast';
import type { Pt } from './formations';
import { sample, type Keyframe } from './scripts';

/** Top speeds in yards a second, roughly the NFL's tracking data. */
const SPEED: Record<Role, number> = {
  CB: 9,
  S: 9,
  WR: 9,
  RET: 9,
  LB: 8.5,
  RB: 8.5,
  ST: 8.5,
  TE: 8,
  QB: 8,
  DT: 7.5,
  EDGE: 7.5,
  K: 7,
  P: 7,
  OL: 6.5,
};
/** Yards a second gained or shed in a second. */
const ACCEL = 6;
/** Men closer than this push apart. */
const ROOM = 1;
/** How close a chaser may come to the man with the ball before the scripted tackler gets there. */
const RING = 1.2;
const WOBBLE = 0.2;

export interface SteerArgs {
  cast: Cast;
  start: ReadonlyMap<number, Pt>;
  scripted: ReadonlyMap<number, Keyframe[]>;
  /** The ball, x, y, h per step (`ballTrack`). */
  ball: Float32Array;
  /** The throw or handoff, in seconds: the defense reads it from then. */
  release: number;
  /** Who has the ball at the whistle, and who tackles him. */
  carrier: number | null;
  tackler: number | null;
  /** The ball holder before the release (the quarterback), whom chasers also keep off. */
  holder: number | null;
  man: boolean;
  /** A dropback: the back blocks or runs a checkdown, the line pass-protects. */
  dropback: boolean;
  /** A handoff: the line drives its men off the ball, receivers stalk-block. */
  run: boolean;
  /** Kicks in this pass: everyone holds his spot while the ball flies. */
  hold: boolean;
  dir: 1 | -1;
  dt: number;
  steps: number;
  rng: Rng;
}

type Route = Pt[];

/** One of four decoy routes from a receiver's spot: go, out, curl or slant, in field coordinates. */
function decoy(p: Pt, dir: 1 | -1, rng: Rng, ballY: number): Route {
  const inside = p.y < ballY ? 1 : -1;
  const up = (d: number, a = 0): Pt => ({ x: p.x + dir * d, y: p.y + a });
  switch (Math.floor(rng.next() * 4)) {
    case 0:
      return [up(18)];
    case 1:
      return [up(6), up(6, -inside * 8)];
    case 2:
      return [up(11), up(9)];
    default:
      return [up(3), up(9, inside * 7)];
  }
}

export function steer(a: SteerArgs): Float32Array {
  const members: CastMember[] = [...a.cast.offense, ...a.cast.defense];
  const n = members.length;
  const offense = members.map((_, k) => k < a.cast.offense.length);
  const out = new Float32Array(a.steps * n * 2);
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const vx = new Float64Array(n);
  const vy = new Float64Array(n);
  members.forEach((m, k) => {
    const p = a.start.get(m.id)!;
    px[k] = p.x;
    py[k] = p.y;
  });
  const steered = members.map((m) => !a.scripted.has(m.id));
  const index = new Map(members.map((m, k) => [m.id, k]));
  const ballY0 = a.ball[1];
  /** Which way across the field the play goes (from the offense's start to where the ball ends): the flow. */
  const side = Math.sign(a.ball[(a.steps - 1) * 3 + 1] - ballY0) || 1;
  const ballX0 = a.ball[0];

  // Decoy routes for receivers not in the play, man assignments for corners.
  const routes = new Map<number, Route>();
  const receivers = members.filter((m, k) => offense[k] && (m.role === 'WR' || m.role === 'TE'));
  for (const m of receivers) routes.set(m.id, decoy(a.start.get(m.id)!, a.dir, a.rng, ballY0));
  // On a dropback the back stays in to block or leaks out to the flat: a coin per play.
  const checkdowns = new Set<number>();
  if (a.dropback)
    for (const m of members.filter((x, k) => offense[k] && x.role === 'RB')) {
      if (a.rng.next() < 0.5) continue;
      const p = a.start.get(m.id)!;
      const side = p.y < ballY0 ? -1 : 1;
      routes.set(m.id, [
        { x: p.x + a.dir * 1, y: p.y + side * 4 },
        { x: p.x + a.dir * 5, y: p.y + side * 11 },
      ]);
      checkdowns.add(m.id);
    }
  const marks = new Map<number, number>();
  if (a.man) {
    const free = new Set(receivers.map((m) => m.id));
    for (const m of members.filter((x, k) => !offense[k] && x.role === 'CB')) {
      const p = a.start.get(m.id)!;
      let best: number | undefined;
      let d = Infinity;
      for (const id of free) {
        const q = a.start.get(id)!;
        const dd = Math.hypot(p.x - q.x, p.y - q.y);
        if (dd < d) [d, best] = [dd, id];
      }
      if (best !== undefined) {
        marks.set(m.id, best);
        free.delete(best);
      }
    }
  }

  // The matchups at the snap: each man up front gets the lineman nearest him across the field; spare linemen help on
  // a dropback or climb to a linebacker on a run. On a run the receivers stalk the nearest defensive back.
  const all = members.map((_, k) => k);
  const pick = (pool: number[], k: number) => {
    let best = -1;
    let d = Infinity;
    for (const j of pool) {
      const dd = Math.abs(py[j] - py[k]) + 0.3 * Math.abs(px[j] - px[k]);
      if (dd < d) [d, best] = [dd, j];
    }
    return best;
  };
  const linemen = all.filter((k) => offense[k] && members[k].role === 'OL');
  // On a run the scripted tackler has already shed his block (that's how he makes the play): the line takes the rest.
  const blockable = (k: number) => !a.run || steered[k];
  const front = all.filter(
    (k) => !offense[k] && blockable(k) && (members[k].role === 'DT' || members[k].role === 'EDGE'),
  );
  const backers = all.filter((k) => !offense[k] && blockable(k) && members[k].role === 'LB');
  const dbs = all.filter((k) => !offense[k] && (members[k].role === 'CB' || members[k].role === 'S'));
  /** Blocker index → the man he's on; defender index → the blockers on him. */
  const blockOn = new Map<number, number>();
  const blockers = new Map<number, number[]>();
  const assign = (b: number, d: number) => {
    blockOn.set(b, d);
    blockers.set(d, [...(blockers.get(d) ?? []), b]);
  };
  /** Linemen who come off a double-team to a linebacker on a run. */
  const climbs: number[] = [];
  if (a.dropback || a.run) {
    const open = new Set(linemen);
    for (const d of [...front].sort((i, j) => py[i] - py[j])) {
      const b = pick([...open], d);
      if (b < 0) break;
      assign(b, d);
      open.delete(b);
    }
    // Spare linemen double the nearest man up front (a combo block on a run, climbing to a linebacker later).
    for (const b of open) {
      const d = pick(front.length ? front : backers, b);
      if (d >= 0) assign(b, d);
    }
    if (a.run && backers.length) climbs.push(...[...open].filter((b) => blockOn.has(b)));
    if (a.run)
      for (const k of all)
        if (offense[k] && steered[k] && (members[k].role === 'WR' || members[k].role === 'TE')) {
          const d = pick(dbs, k);
          if (d >= 0) assign(k, d);
        }
  }

  const climbed = new Set<number>();
  /** Everyone who blocks on this play: the line, a back staying in, receivers stalking on a run. */
  const blockerIdx = all.filter(
    (k) =>
      offense[k] &&
      (members[k].role === 'OL' || (members[k].role === 'RB' && !checkdowns.has(members[k].id)) || blockOn.has(k)),
  );

  const ballAt = (step: number): Pt => {
    const s = Math.max(0, Math.min(a.steps - 1, step));
    return { x: a.ball[s * 3], y: a.ball[s * 3 + 1] };
  };
  /** The nearest man on the other side. */
  const nearest = (k: number): number => {
    let best = -1;
    let d = Infinity;
    for (let j = 0; j < n; j++) {
      if (offense[j] === offense[k]) continue;
      const dd = Math.hypot(px[j] - px[k], py[j] - py[k]);
      if (dd < d) [d, best] = [dd, j];
    }
    return best;
  };

  for (let step = 0; step < a.steps; step++) {
    const t = step * a.dt;
    const released = t >= a.release;
    // Scripted men are where their script says.
    for (let k = 0; k < n; k++)
      if (!steered[k]) {
        const p = sample(a.scripted.get(members[k].id)!, t);
        px[k] = p.x;
        py[k] = p.y;
      }
    if (step > 0 && !a.hold) {
      const chase = ballAt(step + 10);
      const holder = released ? a.carrier : a.holder;
      const hk = holder === null ? -1 : (index.get(holder) ?? -1);
      for (let k = 0; k < n; k++) {
        if (!steered[k]) continue;
        const m = members[k];
        const s0 = a.start.get(m.id)!;
        let goal: Pt = s0;
        // A combo block's second man comes off the double a second after the handoff and climbs to a linebacker.
        if (climbs.includes(k) && t > a.release + 1 && !climbed.has(k)) {
          const lb = pick(backers, k);
          if (lb >= 0) {
            blockOn.set(k, lb);
            blockers.set(lb, [...(blockers.get(lb) ?? []), k]);
          }
          climbed.add(k);
        }
        const on = blockOn.get(k);
        if (offense[k] && on !== undefined && (m.role === 'OL' || (a.run && t > 0.4)) && !(a.dropback && released)) {
          if (a.dropback && hk >= 0) {
            // Pass set: a yard in front of his man, between him and the quarterback.
            const dx = px[hk] - px[on];
            const dy = py[hk] - py[on];
            const d = Math.hypot(dx, dy) || 1;
            goal = { x: px[on] + (dx / d) * 1.0, y: py[on] + (dy / d) * 1.0 };
          } else {
            // Drive block: square up on his man's near side, push, and work him toward the play side.
            goal = { x: px[on] - a.dir * 0.9, y: py[on] + side * 0.8 };
          }
        } else if (offense[k]) {
          if (a.dropback && released && (m.role === 'OL' || (m.role === 'RB' && !checkdowns.has(m.id)))) {
            // The ball's out: blockers hold where the block left them.
            goal = { x: px[k], y: py[k] };
          } else if (m.role === 'RB' && a.dropback && !checkdowns.has(m.id) && hk >= 0) {
            // Pass protection: step up two and a half yards off the quarterback, into the nearest rusher's path.
            const j = nearest(k);
            const qx = px[hk];
            const qy = py[hk];
            const rx = j < 0 ? qx + a.dir * 3 : px[j];
            const ry = j < 0 ? qy : py[j];
            const d = Math.hypot(rx - qx, ry - qy) || 1;
            goal = { x: qx + ((rx - qx) / d) * 2.5, y: qy + ((ry - qy) / d) * 2.5 };
          } else if (m.role === 'OL' || (m.role === 'RB' && !checkdowns.has(m.id))) {
            // Engage the nearest defender a step in front of where he lined up.
            const j = nearest(k);
            goal =
              j < 0
                ? s0
                : { x: s0.x + Math.max(-1.5, Math.min(1.5, px[j] - s0.x)) * 0.5, y: s0.y + (py[j] - s0.y) * 0.3 };
            if (released && a.release > 0 && hk >= 0 && members[hk].role !== 'QB')
              goal = { x: s0.x + a.dir * 2, y: s0.y };
          } else {
            const route = routes.get(m.id);
            const leg = route ? route[Math.min(route.length - 1, Math.floor(t / 1.2))] : s0;
            goal =
              released && a.carrier !== null && a.carrier !== m.id && t > a.release + 0.6
                ? { x: px[k] + a.dir * 2, y: py[k] }
                : leg;
          }
        } else {
          const mark = marks.get(m.id);
          if (released && t > a.release + (a.run ? 0.1 : 0.25)) goal = chase;
          else if (a.run && t > 0.3 && (m.role === 'LB' || m.role === 'S'))
            // Reading run on the mesh: step up and flow with the play before the ball is even handed off.
            goal = { x: s0.x - a.dir * (m.role === 'LB' ? 1.5 : 3), y: s0.y + side * 2.5 };
          else if (m.role === 'DT' || m.role === 'EDGE') goal = hk >= 0 ? { x: px[hk], y: py[hk] } : ballAt(step);
          else if (mark !== undefined) {
            const q = index.get(mark)!;
            goal = { x: px[q] + a.dir * 1.5, y: py[q] };
          } else {
            const depth = m.role === 'LB' ? 8 : m.role === 'S' ? 16 : 12;
            goal = { x: ballX0 + a.dir * depth, y: s0.y };
          }
        }
        // Engaged: a blocked man only leans into his block, slowly toward the ball on a dropback, driven back on a run.
        let top = SPEED[m.role];
        if (!offense[k]) {
          // Held by whoever is on him (the matchups only aim the blockers): any blocker within reach.
          const holding =
            (a.dropback || a.run) && blockerIdx.some((b) => Math.hypot(px[b] - px[k], py[b] - py[k]) < 1.6);
          const live = a.dropback ? t < a.release + 0.3 : a.run && t < a.release + 1;
          if (holding && live) {
            top = a.dropback ? 1.2 : 1;
            // Contact takes his momentum: a blocked man stops, then leans into it.
            const v = Math.hypot(vx[k], vy[k]);
            if (v > top) {
              vx[k] *= top / v;
              vy[k] *= top / v;
            }
            if (a.run) goal = { x: px[k] + a.dir * 1, y: py[k] + side * 0.6 };
          }
        }
        // Steer: toward the goal at top speed, easing off inside a yard, within the acceleration limit.
        const gx = goal.x - px[k];
        const gy = goal.y - py[k];
        const dist = Math.hypot(gx, gy);
        const speed = top * Math.min(1, dist);
        const wx = dist > 0 ? (gx / dist) * speed : 0;
        const wy = (dist > 0 ? (gy / dist) * speed : 0) + (a.rng.next() * 2 - 1) * WOBBLE;
        const dvx = wx - vx[k];
        const dvy = wy - vy[k];
        const dv = Math.hypot(dvx, dvy);
        const cap = ACCEL * a.dt;
        const f = dv > cap ? cap / dv : 1;
        vx[k] += dvx * f;
        vy[k] += dvy * f;
        px[k] += vx[k] * a.dt;
        py[k] += vy[k] * a.dt;
      }
      // Room to move: steered men push off anyone closer than a yard.
      for (let k = 0; k < n; k++) {
        if (!steered[k]) continue;
        for (let j = 0; j < n; j++) {
          if (j === k) continue;
          const dx = px[k] - px[j];
          const dy = py[k] - py[j];
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < ROOM) {
            const push = (ROOM - d) * (steered[j] ? 0.5 : 1);
            px[k] += (dx / d) * push;
            py[k] += (dy / d) * push;
          }
        }
      }
      // Stay near the field; the ring below may push a chaser a step further out, never in.
      for (let k = 0; k < n; k++)
        if (steered[k]) {
          py[k] = Math.max(-1, Math.min(FIELD_W + 1, py[k]));
          px[k] = Math.max(-10.5, Math.min(110.5, px[k]));
        }
      // The tackle is the scripted tackler's: chasers hold a ring around the quarterback and the man who ends up with
      // the ball, the whole play.
      const ck = a.carrier === null ? -1 : (index.get(a.carrier) ?? -1);
      for (const r of new Set([hk, ck])) {
        if (r < 0) continue;
        for (let k = 0; k < n; k++) {
          if (!steered[k] || offense[k] === offense[r]) continue;
          const dx = px[k] - px[r];
          const dy = py[k] - py[r];
          const d = Math.hypot(dx, dy);
          if (d < RING) {
            const ux = d > 0 ? dx / d : a.dir;
            const uy = d > 0 ? dy / d : 0;
            px[k] = px[r] + ux * RING;
            py[k] = py[r] + uy * RING;
          }
        }
      }
    }
    for (let k = 0; k < n; k++) {
      out[(step * n + k) * 2] = px[k];
      out[(step * n + k) * 2 + 1] = py[k];
    }
  }
  return out;
}
