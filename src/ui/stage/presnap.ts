/**
 * The seconds before the snap, as the dots show them. Nobody stands still waiting for the ball: the line sinks into its
 * stance, a receiver goes in motion (more for the offenses built on it: about half of NFL snaps have some), and the
 * defense answers by its front and coverage. A man in man coverage travels with the motion, a zone bumps over; safeties
 * show one shell and rotate to another at the snap (about a third of snaps are disguised, more on passing downs);
 * linebackers walk up to show a blitz and bail, or creep up late to time a real one; corners show press and bail; an
 * offside man jumps on the count.
 *
 * Everything ends where the play begins (`StagedPlay.pos` at the snap), so the play itself is untouched. Pure and
 * seeded: the same snap, the same look. Presentation only: the engine plays the snap; this only stages the moments
 * before it.
 */
import type { DefenseCall } from '../../engine/match/coach';
import type { PlayLogEntry } from '../../engine/types';
import { Rng } from '../../engine/rng';
import type { OffSchemeId } from '../../engine/schemes';
import { FIELD_W } from './ballPath';
import type { Pt } from './formations';
import type { StagedPlay } from './stage';

/** One stretch of a man's movement before the snap: it starts `at` seconds before the snap and takes `dur`. */
export interface Leg {
  at: number;
  dur: number;
  to: Pt;
  /** A bend behind the line (yards, at the middle of the leg): an orbit or a cross behind the quarterback. */
  arc?: number;
}

/** A man who moves before the snap: he sets at `set` when the jog brings him in, then runs his legs in order. */
export interface PreMove {
  id: number;
  set: Pt;
  legs: Leg[];
}

export interface Presnap {
  /** Seconds at the line before the snap, everyone in: the time all this takes. */
  line: number;
  moves: PreMove[];
  /**
   * When the quarterback barks (seconds before the snap): to send the motion, for the ball, and twice on a hard count.
   * Drawn as a ripple from him; nobody else's calls are drawn.
   */
  barks: number[];
  /** What the snap shows, for tests and the curious: the motion's kind, the defense's look. */
  shows: string[];
}

/** How often each offense moves before the snap (the league's around 55%; the motion offenses three in four). */
const MOTION: Record<OffSchemeId, number> = {
  wideZone: 0.74,
  westCoast: 0.68,
  proStyle: 0.56,
  power: 0.52,
  spreadOption: 0.5,
  vertical: 0.42,
  airRaid: 0.4,
};
const MOTION_LEAGUE = 0.55;
/** Coverages that disguise most (two-high shells rolling down), and the fronts that love simulated pressure. */
const DISGUISE = { quarters: 0.4, cover2: 0.35, cover3: 0.3, cover1: 0.25 } as const;
const SHOW_BLITZ = { fireZone: 0.35, threeFour: 0.25, nickel: 0.2, fourThree: 0.12, wide9: 0.1 } as const;
const CREEP = { fireZone: 0.6, threeFour: 0.4, nickel: 0.4, fourThree: 0.3, wide9: 0.3 } as const;
const SLIDE = { fourThree: 0.25, threeFour: 0.3, wide9: 0.15, fireZone: 0.3, nickel: 0.2 } as const;
const PRESS_BAIL = 0.3;
/** The quickest a man moves before the snap, on average over a leg (yards a second; his top speed half again). */
const PRE_PACE = 6.5;
const AUDIBLE = 0.1;
/** How often the quarterback tries a hard count (nobody jumps, unless the flag says someone did). */
const HARD_COUNT = 0.08;
/** His barks: the snap a moment before the ball moves; a hard count's two, a beat apart, well before it. */
const SNAP_BARK = 0.12;
const HARD_BARKS = [1.15, 0.95];

const SCRIMMAGE: ReadonlySet<string> = new Set(['run', 'pass', 'incomplete', 'int', 'sack', 'scramble']);

export function presnapPlan(args: {
  staged: StagedPlay & { fouls?: readonly { id: number | null; at: number }[] };
  e: PlayLogEntry;
  /** A no-huddle snap: little time at the line, little motion. */
  hurry: boolean;
  seed: string;
}): Presnap {
  const { staged: s, e, hurry } = args;
  const none: Presnap = { line: 0, moves: [], barks: [], shows: [] };
  if (!s.kind || !SCRIMMAGE.has(s.kind)) return none;
  const rng = new Rng(`${args.seed}:presnap`);
  const n = s.ids.length;
  const dir = s.dir;
  const ball = { x: s.ball[0], y: s.ball[1] };
  const snap = (k: number): Pt => ({ x: s.pos[k * 2], y: s.pos[k * 2 + 1] });
  const all = s.ids.map((_, k) => k);
  const off = all.filter((k) => s.offense[k]);
  const def = all.filter((k) => !s.offense[k]);
  const role = (k: number) => s.roles[k];
  const depth = (p: Pt) => (p.x - ball.x) * dir;
  const across = (p: Pt) => (p.y - ball.y) * dir;
  const clampY = (y: number) => Math.max(2, Math.min(FIELD_W - 2, y));
  const call: DefenseCall = s.call;
  const passingDown = (e.down >= 3 && e.distance >= 6) || (e.down === 2 && e.distance >= 9);
  const shortYardage = e.distance <= 2;

  const moves = new Map<number, PreMove>();
  const shows: string[] = [];
  const move = (k: number, set: Pt, legs: Leg[]) => {
    if (moves.has(k)) return false;
    // Never set on top of anyone else's spot, before the snap or at it.
    for (let j = 0; j < n; j++) {
      if (j === k) continue;
      const other = moves.get(j)?.set ?? snap(j);
      if (Math.hypot(other.x - set.x, other.y - set.y) < 1.1) return false;
    }
    const at = { x: set.x, y: clampY(set.y) };
    // No leg quicker than a man moves before the snap: a long one starts earlier, ending when it would have.
    let from = at;
    const paced = legs.map((l) => {
      const need = (Math.hypot(l.to.x - from.x, l.to.y - from.y) + Math.abs(l.arc ?? 0)) / PRE_PACE;
      from = l.to;
      return need > l.dur ? { ...l, at: l.at - l.dur + need, dur: need } : l;
    });
    moves.set(k, { id: s.ids[k], set: at, legs: paced });
    return true;
  };

  const qb = off.find((k) => role(k) === 'QB') ?? -1;
  const line = off.filter((k) => role(k) === 'OL');
  const lbs = def.filter((k) => role(k) === 'LB');
  const blitz = new Set(s.blitz.map((id) => s.ids.indexOf(id)));

  // The offense at the line: the line sinks into its stance.
  for (const k of line) {
    const p = snap(k);
    move(k, { x: p.x - dir * 0.35, y: p.y }, [{ at: 0.85, dur: 0.3, to: p }]);
  }

  // Every snap the quarterback calls for the ball. A hard count is two barks before it with no ball: nobody moves,
  // unless the flag says a defender jumped (he sets on his side of the line and goes on the second bark).
  const barks = [SNAP_BARK];
  const offside = (s.fouls ?? []).find((f) => f.id !== null && f.at < 0.3 && !s.offense[s.ids.indexOf(f.id)]);
  if (offside || (!hurry && rng.next() < HARD_COUNT)) {
    barks.push(...HARD_BARKS);
    shows.push('hard count');
    if (offside) {
      const k = s.ids.indexOf(offside.id!);
      const p = snap(k);
      // He's across the line at the snap (`fouls.ts`).
      if (move(k, { x: p.x + dir * 0.9, y: p.y }, [{ at: HARD_BARKS[1], dur: 0.2, to: p }]))
        shows.push('jumps the count');
    }
  }

  // An audible: the back flips to the other side of the quarterback.
  const back = off.find((k) => role(k) === 'RB');
  if (!hurry && back !== undefined && qb >= 0 && rng.next() < AUDIBLE) {
    const p = snap(back);
    const q = snap(qb);
    if (Math.abs(p.y - q.y) > 1 && Math.abs(p.x - q.x) < 1.5) {
      if (move(back, { x: p.x, y: q.y - (p.y - q.y) }, [{ at: 1.9, dur: 0.7, to: p, arc: -1.2 }]))
        shows.push('audible');
    }
  }

  // Motion, by the offense's habits: a jet across at the snap, an orbit behind the quarterback, a short shift, a tight
  // end crossing the formation, or two men shifting at once. A receiver carrying a run is always a jet sweep.
  const runner = s.carrier === null ? -1 : s.ids.indexOf(s.carrier);
  const jetSweep = s.kind === 'run' && runner >= 0 && role(runner) === 'WR';
  const rate = (s.schemes.offense.offense ? MOTION[s.schemes.offense.offense] : MOTION_LEAGUE) * (hurry ? 0.3 : 1);
  let motionLeg: { k: number; leg: Leg; set: Pt } | null = null;
  if (jetSweep || rng.next() < rate) {
    const movers = off.filter((k) => role(k) === 'WR' || role(k) === 'TE');
    const k = jetSweep ? runner : movers[Math.floor(rng.next() * movers.length)];
    if (k !== undefined) {
      const p = snap(k);
      const out = Math.sign(p.y - ball.y) || 1;
      const kind = jetSweep
        ? 'jet'
        : role(k) === 'TE'
          ? rng.next() < 0.5
            ? 'cross'
            : 'shift'
          : (['jet', 'orbit', 'shift', 'shift', 'two'] as const)[Math.floor(rng.next() * 5)];
      let set: Pt;
      let leg: Leg;
      if (kind === 'jet' || kind === 'orbit') {
        // From the far side of the formation, across behind the line; a jet is still running at the snap.
        set = { x: p.x, y: clampY(ball.y - (p.y - ball.y) * 0.8) };
        const dur = Math.max(0.9, Math.min(2.2, Math.abs(set.y - p.y) / (kind === 'jet' ? 8.5 : 6)));
        leg = { at: kind === 'jet' ? dur : dur + 0.5, dur, to: p, arc: kind === 'jet' ? -1.5 : -4 };
      } else if (kind === 'cross') {
        // The tight end crosses the formation to the other end of the line.
        set = { x: p.x, y: clampY(ball.y - (p.y - ball.y)) };
        leg = { at: 1.9, dur: 1.0, to: p, arc: -1.2 };
      } else {
        // A few yards in or out, then set.
        set = { x: p.x, y: clampY(p.y + out * (rng.next() < 0.5 ? 5 : -4)) };
        leg = { at: 1.7, dur: 0.75, to: p };
      }
      if (move(k, set, [leg])) {
        // As paced when he was given it (`move`): the man covering him, and the bark that sends him, go by it.
        const sentLeg = moves.get(k)!.legs[0];
        motionLeg = { k, leg: sentLeg, set };
        // He sends the motion: a bark (a leg kick, a clap) as it starts.
        barks.push(sentLeg.at);
        shows.push(kind === 'two' ? 'shift' : kind);
        // Two men shifting at once: a second receiver or the tight end resets beside the first.
        if (kind === 'two') {
          const other = movers.find((j) => j !== k && !moves.has(j));
          if (other !== undefined) {
            const q = snap(other);
            move(other, { x: q.x, y: clampY(q.y + out * 4) }, [{ at: leg.at, dur: leg.dur, to: q }]);
          }
        }
      }
    }
  }

  // The defense, by its coverage and front and the down. Man (Cover 1, or behind any blitz): the defender over the
  // motion man travels with him. Zone: the nearest two bump over a step or two, and a back calls it out.
  const coverage = s.schemes.defense.coverage;
  const front = s.schemes.defense.front;
  const man = coverage === 'cover1' || call === 'blitz';
  if (motionLeg) {
    const { k, leg, set } = motionLeg;
    const to = snap(k);
    const shiftY = set.y - to.y;
    const near = def
      .filter((j) => role(j) === 'CB' || role(j) === 'S' || role(j) === 'LB')
      .sort((a, b) => Math.hypot(snap(a).x - to.x, snap(a).y - to.y) - Math.hypot(snap(b).x - to.x, snap(b).y - to.y));
    if (man && near.length) {
      const j = near[0];
      const q = snap(j);
      if (move(j, { x: q.x, y: clampY(q.y + shiftY) }, [{ at: leg.at, dur: leg.dur, to: q }]))
        shows.push('man travels');
    } else {
      for (const j of near.slice(0, 2)) {
        const q = snap(j);
        move(j, { x: q.x, y: clampY(q.y + Math.sign(shiftY) * 1.5) }, [{ at: leg.at - 0.2, dur: 0.6, to: q }]);
      }
      if (near.length) shows.push('zone bumps');
    }
  }

  // The front slides a gap before the snap.
  if (front && !hurry && rng.next() < SLIDE[front]) {
    const slide = rng.next() < 0.5 ? 1.4 : -1.4;
    let slid = false;
    for (const j of def.filter((x) => role(x) === 'DT' || role(x) === 'EDGE')) {
      const q = snap(j);
      slid = move(j, { x: q.x, y: q.y + slide }, [{ at: 1.3, dur: 0.45, to: q }]) || slid;
    }
    if (slid) shows.push('front slides');
  }

  // Blitzers: a disguised blitz creeps up late from where linebackers and safeties usually stand, timing the snap.
  if (call === 'blitz' && front && rng.next() < CREEP[front]) {
    let crept = false;
    for (const j of blitz) {
      if (j < 0) continue;
      const q = snap(j);
      const from = role(j) === 'S' ? 11 : 4.5;
      crept =
        move(j, { x: ball.x + dir * from, y: q.y + (role(j) === 'S' ? Math.sign(q.y - ball.y) * 2 : 0) }, [
          { at: 1.4, dur: 1.05, to: q },
        ]) || crept;
    }
    if (crept) shows.push('creeper');
  } else if (call !== 'blitz' && front && passingDown && rng.next() < SHOW_BLITZ[front]) {
    // Simulated pressure: linebackers walk up into the gaps to show a blitz, then bail as the ball is snapped.
    let shown = false;
    for (const j of lbs.slice(0, 2)) {
      const q = snap(j);
      shown =
        move(j, { x: ball.x + dir * 1.4, y: ball.y + (across(q) > 0 ? 1.2 : -1.2) * dir }, [
          { at: 0.65, dur: 0.65, to: q },
        ]) || shown;
    }
    if (shown) shows.push('shows blitz');
  }

  // The shell: shown one way, rotated at the snap. Single-high at the snap shows two deep; two-high shows one down.
  const disguise =
    (coverage ? DISGUISE[coverage] : 0.3) * (passingDown ? 1.4 : shortYardage ? 0.5 : 1) * (hurry ? 0.5 : 1);
  const safeties = def.filter((j) => role(j) === 'S' && !moves.has(j));
  if (safeties.length === 2 && rng.next() < disguise) {
    const [a, b] = safeties.map((j) => ({ j, p: snap(j) }));
    const deep = (x: { p: Pt }) => depth(x.p);
    const high = deep(a) > deep(b) ? a : b;
    const low = high === a ? b : a;
    let rolled = false;
    if (deep(low) < 9) {
      // One high at the snap: the low one shows two-high, deep on his side, and rotates down.
      const side = Math.sign(across(low.p)) || 1;
      rolled = move(low.j, { x: ball.x + dir * 12, y: ball.y + dir * side * 9 }, [{ at: 0.75, dur: 0.75, to: low.p }]);
      if (rolled) shows.push('rotates to one high');
    } else {
      // Two high at the snap: one shows down in the box and bails to his half.
      const side = Math.sign(across(low.p)) || 1;
      rolled = move(low.j, { x: ball.x + dir * 6.5, y: ball.y + dir * side * 4 }, [{ at: 0.8, dur: 0.8, to: low.p }]);
      if (rolled) shows.push('rotates to two high');
    }
  }

  // Corners show press and bail to their zone as the ball is snapped.
  if (!man && (coverage === 'cover3' || coverage === 'quarters') && rng.next() < PRESS_BAIL) {
    let bailed = false;
    for (const j of def.filter((x) => role(x) === 'CB').slice(0, 2)) {
      const q = snap(j);
      if (depth(q) < 4) continue;
      bailed = move(j, { x: ball.x + dir * 1.2, y: q.y }, [{ at: 0.6, dur: 0.6, to: q }]) || bailed;
    }
    if (bailed) shows.push('press bail');
  }

  // Time enough for all of it, and a beat at the line besides.
  const latest = Math.max(0, ...[...moves.values()].flatMap((m) => m.legs.map((l) => l.at)), ...barks);
  const lineTime = Math.min(hurry ? 2 : 4.2, Math.max(hurry ? 0.9 : 1.9, latest + 0.3));
  return { line: lineTime, moves: [...moves.values()], barks: barks.filter((b) => b <= lineTime), shows };
}

/** Where a man who moves before the snap is, `before` seconds before it, given where he started his first leg. */
export function preMoveAt(m: PreMove, before: number, dir: 1 | -1, start: Pt = m.set): Pt {
  let at = start;
  for (const leg of m.legs) {
    if (before >= leg.at) return at;
    const u = Math.min(1, (leg.at - before) / leg.dur);
    if (u < 1) {
      const e = u * u * (3 - 2 * u);
      const arc = (leg.arc ?? 0) * Math.sin(Math.PI * u);
      return { x: at.x + (leg.to.x - at.x) * e + dir * arc, y: at.y + (leg.to.y - at.y) * e };
    }
    at = leg.to;
  }
  return at;
}
