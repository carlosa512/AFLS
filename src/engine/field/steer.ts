/**
 * Everyone the script leaves alone, steered step by step toward a goal set by his role: linemen engage, receivers run
 * decoy routes, zone defenders sink and break on the ball, man defenders mirror, and everyone chases once the ball is
 * out. Worked out once when a play loads, at a fixed step, on its own seeded stream: the same play always moves the
 * same way, at any playback speed.
 */
import type { Rng } from '../rng';
import type { DefenseCall } from '../match/coach';
import type { CoverageId } from '../schemes';
import { FIELD_W, MID } from './geometry';
import type { Cast, CastMember } from './cast';
import { SPEED } from './speed';
import { has, type Habits } from './habits';
import type { RunBlocking } from './runBlocks';
import type { Pt } from './formations';
import { BEAT_ACROSS, sample, type Keyframe } from './keys';

export { SPEED } from './speed';
/** Yards a second gained or shed in a second. */
const ACCEL = 6;
/** Men closer than this push apart, a little each step (a shove, not a jolt). */
const ROOM = 1;
const ROOM_PUSH = 0.12;
/** A run's first steps by the call last this long (seconds from the snap) before the blocks take over. */
const FIRST_STEP = 0.5;
/** Where a steered man may aim, end line to end line (yards), short of the edge he's kept inside so he can pull up. */
const GOAL_X: readonly [number, number] = [-9, 109];
/** No one moves further than this in a step (yards: 11 a second), however he's pushed or knocked off. */
const MAX_STEP = 0.55;
/** A push can take a man this far past his own top speed (yards a second): a shove, never a sprint he hasn't got. */
const LEGS_OVER = 0.3;
/** On a run nobody gets within this of the back (yards) until he's this far past the line: the crease. */
const CREASE = 2;
const CREASE_PAST = 2.5;
/** A pursuer on a run who'd get to the ball early flows there no slower than this (yards a second). */
const FLOW_PACE = 2.5;
/** The return's wall takes the men in coverage this close to the return's lane (yards). */
const WALL_LANE = 6;
/** A slipped man goes to the side the carrier slips him to unless that's this much further (yards) than the nearest. */
const SLIP_GIVE = 0.15;
/** How close a chaser may come to the man with the ball before the scripted tackler gets there. */
const RING = 1.2;
/** A chaser who gets there first whiffs: this long (seconds) at this share of his speed, finding his feet. */
const WHIFF = 1;
const STUMBLE = 0.35;
/** A man going down after a miss sheds his speed this quickly (yards a second, each second): a dive, not a freeze. */
const FALL = 12;
/** A chaser this close and level with a running carrier (not ahead of him) lunges at him, and misses. */
const LUNGE = 2;
/** However he's pushed, no chaser is ever closer than this to the man with the ball before the tackler. */
const FLOOR = 1.01;
const WOBBLE = 0.2;
/** The tackler aims this many seconds ahead of the carrier, and runs this much over his top speed: he makes the play. */
const LEAD = 0.35;
const PURSUIT = 0.6;
/** A missed tackle: how long he takes to recover, and how fast he's moving while he does. */
const MISS = 1.1;
const MISSED = 1;
/** Within this many yards of the carrier the tackler sheds his block and attacks him, running through the hit. */
const CLOSING = 8;
/** Pursuit lanes, yards either side of the carrier's line: the chase fans out. */
const LANES = [0, -2.5, 2.5, -5, 5, -1.2, 1.2, -3.8, 3.8, -6, 6];
/**
 * The pass set, yards behind the ball: each lineman meets his man a yard in front of him, between him and the
 * quarterback, and gives ground only so far (tackles deepest, the center least: the cup), and slowly after that.
 */
const SET_DEPTH = { tackle: 1.8, guard: 1.2, center: 0.9 } as const;
const SET_TIME = 0.6;
/** A screen's line sells the pass set this long, then releases. */
const SCREEN_RELEASE = 0.75;
/** A man defender trails his receiver's moves by this many steps (a fifth of a second): a beat late out of a break. */
const MAN_LAG = 4;
/** Further than this from his man after his kick, a lineman looks for the nearest rusher to help on. */
const HELP = 2.5;
/** When he reads it: a step or two into his kick. */
const HELP_READ = 0.3;
const GIVE = 0.4;
/**
 * The pocket while he has the ball: no rusher but the one the engine named (scripted) comes within this of him for
 * the first second and a half; then it closes in slowly, to a step and a half.
 */
const POCKET_EDGE = 3;
const POCKET_HOLDS = 1.5;
const POCKET_GIVE = 0.5;
const POCKET_LATE = 1.6;
/** However close a held-off man is, he's eased back this far a step at most (yards; a walk). */
const HELD_OFF = 0.1;

export interface SteerArgs {
  cast: Cast;
  start: ReadonlyMap<number, Pt>;
  scripted: ReadonlyMap<number, Keyframe[]>;
  /**
   * Scripted men who play on from a moment (seconds from the snap): the cover man beaten on a catch is scripted to
   * the catch and runs the rest himself, so he chases from where he was rather than sliding along with the receiver.
   */
  free?: ReadonlyMap<number, number>;
  /** The ball, x, y, h per step (`ballTrack`). */
  ball: Float32Array;
  /** The throw or handoff, in seconds: the defense reads it from then. */
  release: number;
  /** Who has the ball at the whistle, and who tackles him. */
  carrier: number | null;
  tackler: number | null;
  /** The tackler, if he's steered: he runs the carrier down (`Scripted.pursuer`). */
  pursuer: number | null;
  /** The ball holder before the release (the quarterback), whom chasers also keep off. */
  holder: number | null;
  /** The rusher the engine named and the blocker it says he beat: that block is the one that loses. */
  rush?: number | null;
  beat?: number | null;
  /** A designed shot: the tight end and the back stay in to block. */
  maxProtect?: boolean;
  /** Decoys let go where their routes end: they settle there until the ball's out (`Scripted.settle`). */
  settle?: ReadonlyMap<number, Pt>;
  /** A screen's other receivers: they block the nearest defensive back, as on a run. */
  stalk?: ReadonlySet<number>;
  /** A screen to the back or the tight end: where it's caught; the line releases to lead it after its set. */
  screen?: Pt | null;
  /**
   * A throw: its target, when the ball gets to him, and the play's separation there. Until it does, nobody steered is
   * nearer him than that (the man the engine says covered him is scripted to it), and no one else man-marks him.
   */
  target?: number | null;
  arrive?: number | null;
  separation?: number;
  man: boolean;
  /** The coordinator's coverage (its zone landmarks), the defense's call on the snap, and the men a blitz sends. */
  coverage?: CoverageId | null;
  call?: DefenseCall;
  blitz?: ReadonlySet<number>;
  /** A dropback: the back blocks or runs a checkdown, the line pass-protects. */
  dropback: boolean;
  /** A handoff: the line drives its men off the ball, receivers stalk-block. */
  run: boolean;
  /** A run's blocking by the call (`runBlocks.ts`): first steps, who blocks whom, who climbs, the free men. */
  runBlocks?: RunBlocking;
  /** The habits the engine noted in play (`habits.ts`), by man: the film shows them in how he moves. */
  habits?: Habits;
  /** No play to run (a flag before the snap, a timeout): everyone holds his spot. */
  hold: boolean;
  /** A kick, and where and when it comes down. */
  kick: 'kickoff' | 'punt' | 'fg' | null;
  land: Pt | null;
  catchAt: number;
  /** A fumble: from when the ball comes out to when it settles, and where; the nearest from each side go for it. */
  loose?: { from: number; to: number; at: Pt };
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
  /** Where each man was a step ago: the carrier's heading. */
  const lastX = new Float64Array(n);
  const lastY = new Float64Array(n);
  members.forEach((m, k) => {
    const p = a.start.get(m.id)!;
    px[k] = lastX[k] = p.x;
    py[k] = lastY[k] = p.y;
  });
  const steered = members.map((m) => !a.scripted.has(m.id));
  /** The side of the carrier a chaser was knocked to (−1, 1; 0: not near him), and until when he's stumbling. */
  const ringSide = new Int8Array(n);
  const whiffed = new Float64Array(n);
  /** When each scripted man is let go (Infinity: never). */
  const freeAt = members.map((m) => (a.scripted.has(m.id) ? (a.free?.get(m.id) ?? Infinity) : 0));
  const index = new Map(members.map((m, k) => [m.id, k]));
  /** The man who makes the tackle, and the path of the man he tackles. */
  const pk = a.pursuer === null ? -1 : (index.get(a.pursuer) ?? -1);
  const carrierPath = a.carrier === null ? undefined : a.scripted.get(a.carrier);
  const carrierIdx = a.carrier === null ? -1 : (index.get(a.carrier) ?? -1);
  const total = (a.steps - 1) * a.dt;
  /** Where the carrier goes down. */
  const carrierEnd = carrierPath ? carrierPath[carrierPath.length - 1] : { x: 0, y: 0 };
  /** Until when the tackler is recovering from a miss: he got there too soon, and the carrier made him miss. */
  let missUntil = -1;
  const ballY0 = a.ball[1];
  /** Which way across the field the play goes (from the offense's start to where the ball ends): the flow. */
  // The play side across the field: the run's blocking says (straight up the middle, where it ended can't), else where
  // the ball ended up.
  const side = a.run && a.runBlocks ? a.dir * a.runBlocks.side : Math.sign(a.ball[(a.steps - 1) * 3 + 1] - ballY0) || 1;
  const ballX0 = a.ball[0];
  /** The target of a throw (his index), whom the defense leaves open by the play's separation until the ball's there. */
  const openTo = a.target == null ? -1 : (index.get(a.target) ?? -1);
  /** The men who go for a loose ball: picked once, as they stand when it comes out (`nearestTo`). */
  let convergers: Set<number> | null = null;
  /** The `per` steered men of each side nearest a spot. */
  const nearestTo = (p: Pt, per: number) => {
    const by = (k: number) => Math.hypot(px[k] - p.x, py[k] - p.y);
    const side = (o: boolean) =>
      members
        .map((_, k) => k)
        .filter((k) => steered[k] && offense[k] === o)
        .sort((i, j) => by(i) - by(j))
        .slice(0, per);
    return new Set([...side(true), ...side(false)]);
  };
  /** A point `d` yards from `p` toward `q`. */
  const toward = (p: Pt, q: Pt, d: number): Pt => {
    const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
    return { x: p.x + ((q.x - p.x) / len) * d, y: p.y + ((q.y - p.y) / len) * d };
  };

  // Decoy routes for receivers not in the play, man assignments for corners.
  const routes = new Map<number, Route>();
  const receivers = members.filter((m, k) => offense[k] && (m.role === 'WR' || m.role === 'TE'));
  // Max protect keeps the tight end in, and so does the engine naming him as the block the rush beat.
  const keptIn = (m: CastMember) =>
    !a.scripted.has(m.id) && ((a.maxProtect && m.role === 'TE') || (a.dropback && m.id === a.beat));
  for (const m of receivers) if (!keptIn(m)) routes.set(m.id, decoy(a.start.get(m.id)!, a.dir, a.rng, ballY0));
  // A decoy's route is scripted: once it ends, he holds where it took him.
  for (const [id, p] of a.settle ?? []) routes.set(id, [p]);
  // On a dropback the back stays in to block or leaks out to the flat: a coin per play (max protect: he stays).
  const checkdowns = new Set<number>();
  if (a.dropback && !a.maxProtect)
    for (const m of members.filter((x, k) => offense[k] && x.role === 'RB')) {
      // A back on a route of his own (the pattern's) is out of the protection.
      if (a.settle?.has(m.id)) checkdowns.add(m.id);
      if (a.rng.next() < 0.5 || m.id === a.beat || a.settle?.has(m.id)) continue;
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
    const free = new Set(receivers.filter((m) => m.id !== a.target).map((m) => m.id));
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
  const blockable = (k: number) => !a.run || (steered[k] && k !== pk);
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
  /** Linemen who come off a double-team to a linebacker on a run, and (from the run's blocking) whom they climb to. */
  const climbs: number[] = [];
  const climbTo = new Map<number, number>();
  /** Power's pulling guard and the man he's after (`RunBlocking.puller`, `on`). */
  const pullerIdx = a.runBlocks?.puller ? (index.get(a.runBlocks.puller.id) ?? -1) : -1;
  const pullerTarget = a.runBlocks?.puller ? a.runBlocks.on.get(a.runBlocks.puller.id) : undefined;
  const pullerMan = pullerTarget === undefined ? -1 : (index.get(pullerTarget) ?? -1);
  /** A run's free men (`RunBlocking.free`): they pursue a step late. */
  const lateMen = new Set(
    (a.run ? (a.runBlocks?.free ?? []) : []).map((id) => index.get(id)).filter((k) => k !== undefined),
  );
  /** A linebacker who can't get off blocks (`stuckOnBlocks`), and the blocker who has him. */
  const stuckTo = new Map<number, number>();
  /** A gap-shooting linebacker on a run, from the snap until just after the handoff: he beats the first hands. */
  const shooting = (k: number, t: number) =>
    a.run &&
    !offense[k] &&
    members[k].role === 'LB' &&
    has(a.habits, members[k].id, 'gapShooter') &&
    t < a.release + 0.6;
  /** A screen to the back or tight end: the three linemen nearest its side release to lead it, in order out. */
  const screenLead = new Map<number, number>();
  if (a.screen) {
    const side = Math.sign(a.screen.y - ballY0) || 1;
    [...linemen]
      .sort((i, j) => (py[j] - py[i]) * side)
      .slice(0, 3)
      .forEach((k, i) => screenLead.set(k, i));
  }
  /** Each lineman's pass set (the cup): how deep he may give ground to, yards behind the ball, before the rush pushes. */
  const setDepth = new Map<number, number>();
  if (a.dropback) {
    const order = [...linemen].sort((i, j) => py[i] - py[j]);
    order.forEach((k, i) => {
      const tackle = i === 0 || i === order.length - 1;
      const center = order.length % 2 === 1 && i === (order.length - 1) / 2;
      setDepth.set(k, tackle ? SET_DEPTH.tackle : center ? SET_DEPTH.center : SET_DEPTH.guard);
    });
  }
  if (a.dropback || a.run) {
    const open = new Set(linemen);
    // The engine says who beat whom: that's his block, whoever the nearest man would have been.
    const rushK = a.rush == null ? -1 : (index.get(a.rush) ?? -1);
    const beatK = a.beat == null ? -1 : (index.get(a.beat) ?? -1);
    if (a.dropback && rushK >= 0 && beatK >= 0 && steered[beatK] && Math.abs(py[beatK] - py[rushK]) <= BEAT_ACROSS) {
      assign(beatK, rushK);
      open.delete(beatK);
    }
    const plan = a.run ? a.runBlocks : undefined;
    if (plan) {
      // The run's blocking by the call: who blocks whom, and the double-teamers who climb.
      for (const [b, d] of plan.on) {
        const bk = index.get(b);
        const dk = index.get(d);
        if (bk !== undefined && dk !== undefined && blockable(dk)) {
          assign(bk, dk);
          open.delete(bk);
        }
      }
      for (const [b, lb] of plan.climb) {
        const bk = index.get(b);
        const lk = index.get(lb);
        if (bk !== undefined && lk !== undefined) climbTo.set(bk, lk);
      }
      open.clear();
    }
    for (const d of [...front].sort((i, j) => py[i] - py[j])) {
      if (blockers.has(d)) continue;
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
    if (a.run && backers.length) climbs.push(...[...open].filter((b) => blockOn.has(b)), ...climbTo.keys());
    if (a.maxProtect)
      for (const k of all)
        if (offense[k] && steered[k] && members[k].role === 'TE') {
          const d = pick(front, k);
          if (d >= 0) assign(k, d);
        }
    // A screen's other receivers stalk the nearest defensive back.
    for (const id of a.stalk ?? []) {
      const k = index.get(id);
      if (k === undefined || !steered[k]) continue;
      const d = pick(dbs, k);
      if (d >= 0) assign(k, d);
    }
    if (a.run)
      for (const k of all)
        if (offense[k] && steered[k] && !blockOn.has(k) && (members[k].role === 'WR' || members[k].role === 'TE')) {
          const d = pick(dbs, k);
          if (d >= 0) assign(k, d);
        }
  }

  const climbed = new Set<number>();

  // Special teams: who does what, from where they line up.
  const kickerIdx = all.find((k) => offense[k] && (members[k].role === 'K' || members[k].role === 'P')) ?? -1;
  const holderIdx = all.find((k) => offense[k] && members[k].role === 'P') ?? -1;
  const retIdx = all.find((k) => !offense[k] && members[k].role === 'RET') ?? -1;
  const gunner = (k: number) => a.kick === 'punt' && offense[k] && Math.abs(py[k] - ballY0) > 12;
  const isGunner = all.map(gunner);
  // The punt rush: the men on the line inside the box (the jammers out wide over the gunners are on the line too).
  const rusherAt = all.map((k) => !offense[k] && Math.abs(px[k] - ballX0) < 3 && Math.abs(py[k] - ballY0) < 10);
  const landX = a.land?.x ?? ballX0 + a.dir * 40;
  const landY = a.land?.y ?? ballY0;
  /** Between `from` and `to`, a yard off `from`: a blocker's spot. */
  const between = (from: number, to: number): Pt => {
    const dx = px[to] - px[from];
    const dy = py[to] - py[from];
    const d = Math.hypot(dx, dy) || 1;
    return { x: px[from] + (dx / d) * 1, y: py[from] + (dy / d) * 1 };
  };
  const nearestOf = (k: number, pool: (j: number) => boolean): number => {
    let best = -1;
    let d = Infinity;
    for (let j = 0; j < n; j++) {
      if (!pool(j)) continue;
      const dd = Math.hypot(px[j] - px[k], py[j] - py[k]);
      if (dd < d) [d, best] = [dd, j];
    }
    return best;
  };
  /** A jammer on gunner `g`: a yard upfield of him, a yard to the side he lined up on. */
  const jam = (g: number, s0: Pt): Pt => {
    const gs = a.start.get(members[g].id)!;
    return { x: px[g] + a.dir * 1, y: py[g] + (Math.sign(s0.y - gs.y) || 1) };
  };
  /** The return's wall: blocker → the cover man he takes, set as the ball comes down (`buildWall`). */
  let wall: Map<number, number> | undefined;
  function buildWall(): Map<number, number> {
    const out = new Map<number, number>();
    const end = { x: a.ball[(a.steps - 1) * 3], y: a.ball[(a.steps - 1) * 3 + 1] };
    const r = { x: px[retIdx], y: py[retIdx] };
    const lx = end.x - r.x;
    const ly = end.y - r.y;
    const ll = Math.hypot(lx, ly) || 1;
    /** How far a man is from the lane, the returner to where the return ends. */
    const offLane = (j: number) => {
      const g = Math.max(0, Math.min(1, ((px[j] - r.x) * lx + (py[j] - r.y) * ly) / (ll * ll)));
      return Math.hypot(px[j] - (r.x + lx * g), py[j] - (r.y + ly * g));
    };
    const threats = all
      .filter((j) => offense[j] && j !== kickerIdx && offLane(j) <= WALL_LANE)
      .sort((p, q) => Math.hypot(px[p] - r.x, py[p] - r.y) - Math.hypot(px[q] - r.x, py[q] - r.y));
    const blockers = new Set(all.filter((j) => !offense[j] && j !== retIdx && steered[j]));
    for (const c of threats) {
      let best = -1;
      let d = Infinity;
      for (const b of blockers) {
        const dd = Math.hypot(px[b] - px[c], py[b] - py[c]);
        if (dd < d) [d, best] = [dd, b];
      }
      if (best < 0) break;
      out.set(best, c);
      blockers.delete(best);
    }
    return out;
  }
  function kickGoal(k: number, t: number): Pt {
    const s0 = a.start.get(members[k].id)!;
    const here = { x: px[k], y: py[k] };
    const caught = t >= a.catchAt;
    if (offense[k]) {
      // A kicker let go of his script (a return touchdown's last angle) chases the returner from there.
      if (k === kickerIdx && caught && a.kick !== 'fg' && retIdx >= 0 && a.carrier !== null)
        return { x: px[retIdx], y: py[retIdx] };
      if (k === kickerIdx || k === holderIdx) return here;
      if (a.kick === 'fg') {
        // Protection: hold the line, square to the nearest rusher.
        const r = nearestOf(k, (j) => !offense[j]);
        return r < 0 ? s0 : { x: s0.x - a.dir * 0.3, y: s0.y + Math.max(-0.8, Math.min(0.8, py[r] - s0.y)) };
      }
      if (a.kick === 'punt' && !isGunner[k] && t < a.release) {
        // Punt protection: between the nearest rusher and the punter until the ball is away.
        const r = nearestOf(k, (j) => !offense[j] && rusherAt[j]);
        return r < 0 || kickerIdx < 0 ? here : between(r, kickerIdx);
      }
      if (a.kick === 'kickoff') {
        // Set a yard off the receiving 40 until the ball comes down; then onto the returner, or pull up on a touchback.
        if (!caught) return s0;
        return a.carrier === null || retIdx < 0 ? { x: s0.x + a.dir * 6, y: s0.y } : { x: px[retIdx], y: py[retIdx] };
      }
      if (caught && retIdx >= 0) return { x: px[retIdx], y: py[retIdx] };
      // Down the field in his lane, squeezing toward where the ball comes down.
      return { x: landX, y: s0.y + (landY - s0.y) * 0.35 };
    }
    if (k === retIdx) return here;
    if (a.kick === 'fg') return t < a.release && holderIdx >= 0 ? { x: px[holderIdx], y: py[holderIdx] } : here;
    if (a.kick === 'punt' && t < a.release) {
      if (rusherAt[k] && kickerIdx >= 0) return { x: px[kickerIdx], y: py[kickerIdx] };
      const g = nearestOf(k, (j) => isGunner[j]);
      // A jammer rides the gunner down the field, on his own side of him: two of them make a vise.
      if (g >= 0 && Math.abs(py[k] - ballY0) > 10) return jam(g, s0);
    }
    // A kickoff's setup zone holds until the ball comes down; on a touchback it stays put.
    if (a.kick === 'kickoff' && (!caught || a.carrier === null)) return s0;
    if (!caught) {
      const g = a.kick === 'punt' ? nearestOf(k, (j) => isGunner[j]) : -1;
      if (g >= 0 && Math.abs(s0.y - ballY0) > 10) return jam(g, s0);
      // Fall back toward the returner and set up the return.
      return { x: s0.x + (landX - s0.x) * 0.55, y: s0.y + (landY - s0.y) * 0.3 };
    }
    // The return: the wall. Each blocker takes a man in coverage within 6 yards of the return's lane (the nearest to
    // the returner first, each to the blocker nearest him); the rest get between the nearest man and the returner.
    if (!wall && retIdx >= 0) wall = buildWall();
    const mine = wall?.get(k);
    const c = mine ?? nearestOf(k, (j) => offense[j] && j !== kickerIdx);
    return c < 0 || retIdx < 0 ? here : between(c, retIdx);
  }
  /** Everyone who blocks on this play: the line, a back staying in, receivers stalking on a run. */
  // (Never the man with the ball: a back carrying it on a run blocks nobody, and a defender on him isn't held.)
  const blockerIdx = all.filter(
    (k) =>
      offense[k] &&
      k !== carrierIdx &&
      (members[k].role === 'OL' || (members[k].role === 'RB' && !checkdowns.has(members[k].id)) || blockOn.has(k)),
  );

  const ballAt = (step: number): Pt => {
    const s = Math.max(0, Math.min(a.steps - 1, step));
    return { x: a.ball[s * 3], y: a.ball[s * 3 + 1] };
  };
  /**
   * Where a chaser can meet the ball: the first spot on its path (over the next two seconds) he can reach by the time
   * it gets there at `speed`; a ball in the air is met where it comes down. One who can't get there in time runs for
   * where it will be in two seconds, the angle to the sideline or the pylon. A man in front of the carrier comes to
   * meet him; aiming further ahead would only have him back away in front of him, running with the play.
   */
  /** How long the last `meet` gave him to get there (seconds; Infinity when he can't make it). */
  let meetIn = Infinity;
  const meet = (k: number, step: number, speed: number): Pt => {
    const ahead = Math.round(2 / a.dt);
    // On a run he meets the back past the crease (`CREASE_PAST`), not in the backfield: the spots short of it are
    // passed over, looking as far on as it takes.
    const crease = a.run && !offense[k];
    const far = crease ? a.steps - step : ahead;
    let past: Pt | undefined;
    for (let j = 1; j <= far; j++) {
      const s = Math.min(a.steps - 1, step + j);
      if (a.ball[s * 3 + 2] > 0.5) continue;
      const b = ballAt(s);
      if (crease && (b.x - ballX0) * a.dir < CREASE_PAST && s < a.steps - 1) continue;
      past ??= b;
      if (Math.hypot(b.x - px[k], b.y - py[k]) <= speed * j * a.dt) {
        meetIn = j * a.dt;
        return b;
      }
    }
    meetIn = Infinity;
    return past ?? ballAt(step + ahead);
  };
  /** The middle linebacker: the one lined up nearest the ball (in a Tampa 2 he carries the seam). */
  const mike = members
    .filter((m, k) => !offense[k] && m.role === 'LB')
    .sort((p, q) => Math.abs(a.start.get(p.id)!.y - ballY0) - Math.abs(a.start.get(q.id)!.y - ballY0))[0]?.id;
  /**
   * Where a man in zone drops to, by the coverage his coordinator plays: Tampa 2's corners squat in the flats under two
   * deep halves with the middle linebacker carrying the seam; Cover 3's corners bail to the deep thirds over a single
   * high safety, the other safety in the curl; Quarters' corners and safeties split the deep field four ways; behind
   * man (Cover 1, a blitz), a safety deep in the middle and one robbing underneath. Deeper on a pass-defense call.
   */
  const zoneSpot = (m: CastMember, s0: Pt): Pt => {
    const deeper = a.call === 'passD' ? 2 : 0;
    const side = Math.sign(s0.y - ballY0) || 1;
    const at = (depth: number, y: number): Pt => ({
      x: ballX0 + a.dir * (depth + deeper),
      y: Math.max(2, Math.min(FIELD_W - 2, y)),
    });
    const outside = m.role === 'CB' && m.slot <= 1;
    const coverage = a.man ? 'man' : a.coverage;
    switch (coverage) {
      case 'cover2':
        if (outside) return at(5, s0.y);
        if (m.role === 'S') return at(18, MID + side * 11);
        if (m.role === 'LB' && m.id === mike) return at(13, ballY0);
        return at(8, ballY0 + side * 7);
      case 'cover3':
        if (outside) return at(15, s0.y < MID ? 9 : FIELD_W - 9);
        if (m.role === 'S') return m.slot === 0 ? at(17, MID) : at(7, s0.y);
        return at(8, ballY0 + side * 6);
      case 'quarters':
        if (outside) return at(13, s0.y < MID ? 7 : FIELD_W - 7);
        if (m.role === 'S') return at(14, MID + side * 7);
        return at(7, ballY0 + side * 7);
      case 'man':
        if (m.role === 'S') return m.slot === 0 ? at(16, MID) : at(9, ballY0);
        return at(6, ballY0 + side * 4);
      default:
        return at(m.role === 'LB' ? 8 : m.role === 'S' ? 16 : 12, s0.y);
    }
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
    // A scripted man let go runs on from there, at the pace his script had him going.
    for (let k = 0; k < n; k++)
      if (!steered[k] && t >= freeAt[k] && step > 0) {
        steered[k] = true;
        // (From his last two steps on film: by now the step's start and the last step are the same spot.)
        const b = Math.max(0, step - 2);
        vx[k] = (out[((step - 1) * n + k) * 2] - out[(b * n + k) * 2]) / ((step - 1 - b || 1) * a.dt);
        vy[k] = (out[((step - 1) * n + k) * 2 + 1] - out[(b * n + k) * 2 + 1]) / ((step - 1 - b || 1) * a.dt);
      }
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
        /** Below 1 for a man out of the play, easing off. */
        let beaten = 1;
        /** On a run, the pace that gets him to where he meets the ball as it gets there (no sooner: he'd stand). */
        let onTime = Infinity;
        // A combo block's second man comes off the double a second after the handoff and climbs to a linebacker.
        const climbAt = a.release + (has(a.habits, m.id, 'secondLevel') ? 0.6 : 1);
        if (climbs.includes(k) && t > climbAt && !climbed.has(k)) {
          const lb = climbTo.get(k) ?? pick(backers, k);
          if (lb >= 0) {
            blockOn.set(k, lb);
            blockers.set(lb, [...(blockers.get(lb) ?? []), k]);
          }
          climbed.add(k);
        }
        const on = blockOn.get(k);
        if (
          offense[k] &&
          on !== undefined &&
          (m.role === 'OL' ||
            (a.run && t > 0.4) ||
            (!!a.stalk?.has(m.id) && t > 0.4) ||
            (a.maxProtect && m.role === 'TE') ||
            (a.dropback && m.id === a.beat && m.role !== 'RB')) &&
          (!(a.dropback && released) || !!a.stalk?.has(m.id) || screenLead.has(k))
        ) {
          const leads = screenLead.get(k);
          if (leads !== undefined && t >= SCREEN_RELEASE && a.screen) {
            // A screen: the set sold, he's off downfield to lead the catch, the rush let go past him.
            goal = {
              x: ballX0 + a.dir * (2 + leads * 2.5),
              y: a.screen.y + Math.sign(a.screen.y - ballY0) * (leads - 1) * 2,
            };
          } else if (a.dropback && hk >= 0 && !a.stalk?.has(m.id)) {
            // Pass set: kick to his spot in the cup, then a yard in front of his man, between him and the quarterback,
            // giving ground slowly. A man who doesn't come (he drops into coverage, or someone else has him): help on
            // the nearest rusher instead.
            let man = on;
            // (The block the engine says lost stays on its man until he's beaten.)
            if (t >= HELP_READ && k !== index.get(a.beat ?? -1) && Math.hypot(px[on] - px[k], py[on] - py[k]) > HELP) {
              const j = nearestOf(k, (x) => !offense[x] && (members[x].role === 'DT' || members[x].role === 'EDGE'));
              if (j >= 0 && Math.hypot(px[j] - px[k], py[j] - py[k]) < Math.hypot(px[on] - px[k], py[on] - py[k]))
                man = j;
            }
            const dx = px[hk] - px[man];
            const dy = py[hk] - py[man];
            const d = Math.hypot(dx, dy) || 1;
            goal = { x: px[man] + (dx / d) * 1.0, y: py[man] + (dy / d) * 1.0 };
            // Never across the line before the ball's out: a lineman downfield on a pass is a foul (a screen's are
            // fine: it's caught behind the line).
            if ((goal.x - ballX0) * a.dir > -0.5) goal = { x: ballX0 - a.dir * 0.5, y: goal.y };
            // The cup: he gives ground only slowly, never deeper than his set and what the rush has pushed him.
            const set = setDepth.get(k);
            if (set !== undefined) {
              const deepest = set + 0.5 + GIVE * Math.max(0, t - SET_TIME);
              if ((ballX0 - goal.x) * a.dir > deepest) goal = { x: ballX0 - a.dir * deepest, y: goal.y };
            }
            // Beaten: his man is past him, closer to the quarterback than he is. He turns and is out of the play.
            if (k === index.get(a.beat ?? -1) && on === index.get(a.rush ?? -1)) {
              const mine = Math.hypot(px[hk] - px[k], py[hk] - py[k]);
              if (Math.hypot(dx, dy) < mine) {
                goal = { x: px[k], y: py[k] };
                beaten = 0.5;
              }
            }
          } else {
            // Drive block: square up on his man's near side, push, and work him toward the play side. A second-level
            // blocker who's climbed takes the angle that seals his linebacker off the hole, between the two.
            const hole = a.runBlocks?.hole;
            if (hole && climbed.has(k) && has(a.habits, m.id, 'secondLevel')) {
              const dx = hole.x - px[on];
              const dy = hole.y - py[on];
              const d = Math.hypot(dx, dy) || 1;
              goal = { x: px[on] + (dx / d) * 1.2, y: py[on] + (dy / d) * 1.2 };
            } else {
              // A zone block flows along the line with the play, working his man across, not straight back.
              const zone = a.run && a.runBlocks && a.runBlocks.call !== 'power';
              goal = zone
                ? { x: px[on] - a.dir * 0.7, y: py[on] + side * 0.9 }
                : { x: px[on] - a.dir * 0.9, y: py[on] + side * 0.8 };
            }
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
          if (released && t > a.release + (a.run ? 0.1 : 0.25)) {
            // Pursuit: an angle on where the ball is going, further ahead the further off it he is, so the chase
            // spreads out across the field instead of piling onto the carrier's back.
            const d = Math.hypot(chase.x - px[k], chase.y - py[k]);
            const aim = meet(k, step, SPEED[m.role] * 0.9);
            if (a.run && k !== pk && Number.isFinite(meetIn))
              onTime = Math.hypot(aim.x - px[k], aim.y - py[k]) / meetIn;
            // Once a man has the ball on the ground: how far past this chaser he is. A chaser he's gone by has lost his
            // angle; he can only run after him from behind, and a breakaway runs away from him.
            const now = ballAt(step);
            const carried =
              !a.kick &&
              carrierIdx >= 0 &&
              offense[carrierIdx] &&
              a.ball[step * 3 + 2] < 0.5 &&
              Math.abs(now.x - px[carrierIdx]) < 1;
            const past = carried ? (now.x - px[k]) * a.dir : 0;
            // Each takes his own angle (a lane of his own, wider the further off he is), not one file behind him; a
            // chaser left behind gives his lane up and runs straight after him.
            const lane = LANES[k % LANES.length] * Math.min(1, d / 12) * Math.max(0, 1 - Math.max(0, past - 1) / 3);
            goal = { x: aim.x, y: aim.y + lane };
            // The run's free man (nobody could block him, and he isn't the engine's tackler): his angle arrives a
            // step late, two yards behind where the carrier's headed, so he's there at the end but never first.
            if (lateMen.has(k) && carrierIdx >= 0) {
              const hx = px[carrierIdx] - lastX[carrierIdx];
              const hy = py[carrierIdx] - lastY[carrierIdx];
              const hl = Math.hypot(hx, hy);
              // Until the back is through the line he comes at the back's heels, never waiting in front of him.
              const through = (px[carrierIdx] - ballX0) * a.dir >= CREASE_PAST;
              if (hl > 0.05) {
                const from = through ? aim : { x: px[carrierIdx], y: py[carrierIdx] };
                goal = { x: from.x - (hx / hl) * 2, y: from.y - (hy / hl) * 2 };
                if (!through) onTime = Infinity;
              }
            }
            // Beaten: he loses ground, more the further behind he is, so the chase thins out behind the play rather
            // than running alongside it. A big man well beaten eases right off.
            if (past > 1) beaten = Math.max(0.8, 0.95 - (past - 1) * 0.03);
            if ((m.role === 'DT' || m.role === 'EDGE') && past > 8) beaten = 0.7;
            if (k === pk) beaten = 1;
          } else if (a.blitz?.has(m.id))
            // Sent: after the quarterback, or into the backfield after the ball on a run.
            goal = hk >= 0 ? { x: px[hk], y: py[hk] } : ballAt(step);
          else if (a.run && t > 0.3 && (m.role === 'LB' || m.role === 'S'))
            // Reading run on the mesh: step up and flow with the play before the ball is even handed off.
            goal = { x: s0.x - a.dir * (m.role === 'LB' ? 1.5 : 3), y: s0.y + side * 2.5 };
          else if (m.role === 'DT' || m.role === 'EDGE') goal = hk >= 0 ? { x: px[hk], y: py[hk] } : ballAt(step);
          else if (mark !== undefined) {
            // Man: on his receiver's hip and a step deeper, a beat behind him: where he was a moment ago, so a break
            // gets a step on him before he turns and closes.
            const q = index.get(mark)!;
            const back = Math.max(0, step - MAN_LAG);
            const was =
              step > MAN_LAG ? { x: out[(back * n + q) * 2], y: out[(back * n + q) * 2 + 1] } : { x: px[q], y: py[q] };
            goal = { x: was.x + a.dir * 1.5, y: was.y };
          } else goal = zoneSpot(m, s0);
        }
        // The run's blocking: each lineman's first step by the call, before he takes on his man.
        const first = a.run ? a.runBlocks?.steps.get(m.id) : undefined;
        if (first && t < FIRST_STEP) goal = first;
        // The pulling guard's man (the end he kicks out, the linebacker he leads up on) comes to meet him while he's on
        // his way, squeezing down to take him on, rather than waiting on his spot for the back.
        if (a.run && released && k === pullerMan && pullerIdx >= 0 && !steered[pullerIdx])
          goal = { x: px[pullerIdx], y: py[pullerIdx] };
        // A linebacker's habits, the film's way of showing them: a gap-shooter shoots his gap, a scraper flows over the
        // top, slow flow waits to see it, a misread goes the wrong way first.
        if (a.run && !offense[k] && k !== pk && m.role === 'LB' && a.habits?.has(m.id)) {
          // (Playing his habit, he isn't paced to where pursuit would meet the back.)
          onTime = Infinity;
          const r = a.release;
          if (has(a.habits, m.id, 'slowFlow') && t < r + 0.4) goal = { x: px[k], y: py[k] };
          else if (has(a.habits, m.id, 'misreadsKeys') && t < r + 0.4) goal = { x: s0.x, y: s0.y - side * 1.5 };
          else if (shooting(k, t)) goal = { x: ballX0 - a.dir * 2, y: s0.y };
          else if (has(a.habits, m.id, 'scraper') && t > 0.3 && t < r + 0.8) goal = { x: s0.x, y: s0.y + side * 5 };
        }
        if (a.kick) goal = kickGoal(k, t);
        // The tackler reads it, takes his angle and closes: aimed where the carrier is going, not where he is.
        const pursuing =
          k === pk && !!carrierPath && (a.kick ? t >= a.catchAt : released && t > a.release + (a.run ? 0.1 : 0.25));
        // Once the ball is on the ground with the carrier, he takes the angle that meets him; till then, and coming
        // straight at him with the hit between them, a step ahead of him: into him, at speed.
        if (pursuing) {
          const carried =
            a.ball[step * 3 + 2] < 0.5 && carrierIdx >= 0 && Math.abs(a.ball[step * 3] - px[carrierIdx]) < 1;
          const hx = px[carrierIdx] - lastX[carrierIdx];
          const hy = py[carrierIdx] - lastY[carrierIdx];
          const facing =
            carried &&
            (px[k] - px[carrierIdx]) * hx + (py[k] - py[carrierIdx]) * hy > 0 &&
            (carrierEnd.x - px[k]) * hx + (carrierEnd.y - py[k]) * hy < 0;
          goal = carried && !facing ? meet(k, step, SPEED[m.role] + PURSUIT) : sample(carrierPath!, t + LEAD);
        }
        // Engaged: a blocked man only leans into his block, slowly toward the ball on a dropback, driven back on a run.
        let top = (SPEED[m.role] + (k === pk ? PURSUIT : 0)) * beaten * (t < whiffed[k] ? STUMBLE : 1);
        // A run still developing (a back pressing the hole): he flows to his spot on time, never early to stand there.
        if (Number.isFinite(onTime)) top = Math.min(top, Math.max(FLOW_PACE, onTime * 1.15));
        /** The tackler, clear of the blocks and closing: within a few yards of the carrier. */
        const closing =
          pursuing && carrierIdx >= 0 && Math.hypot(px[carrierIdx] - px[k], py[carrierIdx] - py[k]) < CLOSING;
        if (pursuing && carrierIdx >= 0) {
          // On him with the play still well short of where it ends: the carrier makes him miss. He overruns, finds
          // his feet, and comes again from behind.
          if (t < missUntil) {
            goal = { x: px[k] + vx[k], y: py[k] + vy[k] };
            top = MISSED;
          } else if (
            Math.hypot(px[carrierIdx] - px[k], py[carrierIdx] - py[k]) < 1.6 &&
            Math.hypot(px[carrierIdx] - carrierEnd.x, py[carrierIdx] - carrierEnd.y) > 6 &&
            total - t > 1.2
          )
            missUntil = t + MISS;
        }
        if (a.kick && k !== pk) {
          // The rush is held up by the protection until the kick; after the catch the coverage fights through blocks.
          const opp = (j: number) => offense[j] !== offense[k] && steered[j] && members[j].role !== 'RET';
          const near = all.some((j) => opp(j) && Math.hypot(px[j] - px[k], py[j] - py[k]) < 1.6);
          if (!offense[k] && a.kick !== 'kickoff' && t < a.release + 0.2 && near) top = 1.2;
          if (offense[k] && t >= a.catchAt && near) top = 2;
          const v = Math.hypot(vx[k], vy[k]);
          if (v > top) {
            vx[k] *= top / v;
            vy[k] *= top / v;
          }
        }
        if (!offense[k] && k !== pk) {
          // Held by whoever is on him (the matchups only aim the blockers): any blocker within reach. A blitzer comes
          // through the gaps the line's men leave: only the back picking him up, or a man assigned to him, holds him.
          const sent = !!a.blitz?.has(m.id);
          const holding =
            (a.dropback || a.run) &&
            blockerIdx.some(
              (b) =>
                (!sent || members[b].role === 'RB' || blockOn.get(b) === k) &&
                Math.hypot(px[b] - px[k], py[b] - py[k]) < 1.6,
            );
          // Once a blocker has a man who can't get off blocks, he stays blocked; a gap-shooter beats the first hands.
          const stuck = a.run && has(a.habits, m.id, 'stuckOnBlocks');
          // On a run the blocks hold until the back is through the line (he presses it for the best part of two seconds
          // after the handoff), not a set second: let go sooner, the whole front would converge on him in the hole.
          const through = carrierIdx >= 0 && (px[carrierIdx] - ballX0) * a.dir >= CREASE_PAST;
          const live = stuck || (a.dropback ? t < a.release + 0.3 : a.run && (t < a.release + 1 || !through));
          // A scraper flows through the traffic: hands on him don't stop him while he does.
          const scraping = a.run && has(a.habits, m.id, 'scraper') && t < a.release + 0.8;
          if (holding && live && !shooting(k, t) && !scraping && !stuckTo.has(k)) {
            top = a.dropback ? 1.2 : 1;
            // Contact takes his momentum: a blocked man stops, then leans into it.
            const v = Math.hypot(vx[k], vy[k]);
            if (v > top) {
              vx[k] *= top / v;
              vy[k] *= top / v;
            }
            if (a.run) goal = { x: px[k] + a.dir * 1, y: py[k] + side * 0.6 };
          }
          // He can't get off blocks: the first lineman, tight end or back (not the carrier) to get hands on him has
          // him, and he's latched a step in front of that man wherever he goes.
          if (stuck && !stuckTo.has(k) && t >= a.release) {
            const b = all.find(
              (j) =>
                offense[j] &&
                j !== carrierIdx &&
                (members[j].role === 'OL' || members[j].role === 'TE' || members[j].role === 'RB') &&
                Math.hypot(px[j] - px[k], py[j] - py[k]) < 1.6,
            );
            if (b !== undefined) stuckTo.set(k, b);
          }
          const latched = stuckTo.get(k);
          if (stuck && latched !== undefined) {
            // He goes where his blocker takes him: a yard off him on the side he's on, led by where the blocker's
            // headed so he doesn't trail.
            const rx = px[k] - px[latched];
            const ry = py[k] - py[latched];
            const rl = Math.hypot(rx, ry) || 1;
            const bvx = (px[latched] - lastX[latched]) / a.dt;
            const bvy = (py[latched] - lastY[latched]) / a.dt;
            goal = { x: px[latched] + (rx / rl) * 1 + bvx * 0.25, y: py[latched] + (ry / rl) * 1 + bvy * 0.25 };
            top = SPEED[m.role];
          }
        }
        // Steer: toward the goal at top speed, easing off inside a yard, within the acceleration limit.
        // A throw in the air: nobody but the man the engine says covered him (scripted) aims nearer the target than the
        // play's separation until the ball gets there; they close on the catch.
        if (!offense[k] && openTo >= 0 && a.separation !== undefined && a.arrive != null && t < a.arrive) {
          const tx = px[openTo];
          const ty = py[openTo];
          const gd = Math.hypot(goal.x - tx, goal.y - ty);
          if (gd < a.separation) {
            const ux = gd > 0 ? (goal.x - tx) / gd : Math.sign(px[k] - tx) || 1;
            const uy = gd > 0 ? (goal.y - ty) / gd : 0;
            goal = { x: tx + ux * a.separation, y: ty + uy * a.separation };
          }
        }
        // A loose ball: the nearest two of each side go for it, pulling up a step and a half short (the man who
        // recovers it is scripted to get there).
        if (a.loose && t >= a.loose.from && t < a.loose.to) {
          if (!convergers) convergers = nearestTo(a.loose.at, 2);
          if (convergers.has(k)) goal = toward(a.loose.at, { x: px[k], y: py[k] }, 1.5);
        }
        // Just made to miss: he isn't after the carrier for that moment, he's carried on the way he was going while he
        // goes down (aimed at the carrier, he'd run in place against him).
        if (t < whiffed[k] && k !== pk && Math.hypot(vx[k], vy[k]) > 0.5) goal = { x: px[k] + vx[k], y: py[k] + vy[k] };
        // Never aim past the end lines or the sidelines (a deep zone near the goal line, a chase to the back of the end
        // zone): a goal out there runs him into the edge of the field and stops him dead on it.
        goal = {
          x: Math.max(GOAL_X[0], Math.min(GOAL_X[1], goal.x)),
          y: Math.max(-0.5, Math.min(FIELD_W + 0.5, goal.y)),
        };
        const gx = goal.x - px[k];
        const gy = goal.y - py[k];
        const dist = Math.hypot(gx, gy);
        // Braking in time to stop on his spot (no quicker than he can pull up, `ACCEL`), not a dead stop at it; except
        // the tackler closing on the carrier, who runs through the hit.
        const speed =
          closing && t >= missUntil ? top : Math.min(top, Math.sqrt(2 * ACCEL * dist), top * Math.max(dist, 0.6) * 4);
        const wx = dist > 0 ? (gx / dist) * speed : 0;
        const wy = (dist > 0 ? (gy / dist) * speed : 0) + (a.rng.next() * 2 - 1) * WOBBLE;
        const dvx = wx - vx[k];
        const dvy = wy - vy[k];
        const dv = Math.hypot(dvx, dvy);
        // A man who's just missed goes down: he sheds his speed quicker than a runner pulls up.
        const cap = (t < whiffed[k] ? FALL : ACCEL) * a.dt;
        const f = dv > cap ? cap / dv : 1;
        vx[k] += dvx * f;
        vy[k] += dvy * f;
        px[k] += vx[k] * a.dt;
        py[k] += vy[k] * a.dt;
      }
      // Room to move: steered men push off anyone closer than a yard (a gap-shooter slips between the blockers).
      for (let k = 0; k < n; k++) {
        if (!steered[k]) continue;
        const slips = shooting(k, t);
        for (let j = 0; j < n; j++) {
          if (j === k || (slips && offense[j]) || (offense[k] && shooting(j, t))) continue;
          const dx = px[k] - px[j];
          const dy = py[k] - py[j];
          const d = Math.hypot(dx, dy);
          if (d > 0 && d < ROOM) {
            const push = Math.min(ROOM_PUSH, (ROOM - d) * (steered[j] ? 0.5 : 1));
            px[k] += (dx / d) * push;
            py[k] += (dy / d) * push;
            // A defender bumped by a scripted man (a receiver releasing past a pressed corner) takes the bump into his
            // own stride and gathers himself, rather than being moved a step and stopping dead.
            if (
              !offense[k] &&
              !steered[j] &&
              offense[j] &&
              a.dropback &&
              (members[j].role === 'WR' || members[j].role === 'TE' || members[j].role === 'RB') &&
              (members[k].role === 'CB' || members[k].role === 'S' || members[k].role === 'LB')
            ) {
              vx[k] += ((dx / d) * push) / a.dt;
              vy[k] += ((dy / d) * push) / a.dt;
            }
          }
        }
      }
      // Stay near the field; the ring below may push a chaser a step further out, never in.
      for (let k = 0; k < n; k++)
        if (steered[k]) {
          py[k] = Math.max(-1, Math.min(FIELD_W + 1, py[k]));
          px[k] = Math.max(-10.5, Math.min(110.5, px[k]));
        }
      // The pocket holds while he has the ball: only the rusher the engine named gets to him (he's scripted); the rest
      // are held off, the protection giving ground late in a long down.
      if (a.dropback && !released && hk >= 0) {
        const edge =
          t <= POCKET_HOLDS ? POCKET_EDGE : Math.max(POCKET_LATE, POCKET_EDGE - POCKET_GIVE * (t - POCKET_HOLDS));
        for (let k = 0; k < n; k++) {
          if (!steered[k] || offense[k] || k === pk) continue;
          const dx = px[k] - px[hk];
          const dy = py[k] - py[hk];
          const d = Math.hypot(dx, dy);
          if (d < edge && d > 0) {
            // Held off firmly while the pocket holds; once it gives, eased back a step's worth at most (a quarterback
            // climbing into a held man doesn't fling him off).
            const out = t <= POCKET_HOLDS ? edge - d : Math.min(edge - d, HELD_OFF);
            px[k] += (dx / d) * out;
            py[k] += (dy / d) * out;
          }
        }
      }
      // Open by the play's separation until the ball gets there: the nearest man to him is the one the engine named.
      const tk = a.target == null ? -1 : (index.get(a.target) ?? -1);
      if (tk >= 0 && a.separation !== undefined && a.arrive != null && t < a.arrive)
        for (let k = 0; k < n; k++) {
          // The tackler too: he closes once the ball's there.
          if (!steered[k] || offense[k]) continue;
          const dx = px[k] - px[tk];
          const dy = py[k] - py[tk];
          const d = Math.hypot(dx, dy);
          if (d < a.separation && d > 0) {
            const out = Math.min(a.separation - d, HELD_OFF);
            px[k] += (dx / d) * out;
            py[k] += (dy / d) * out;
          }
        }
      // The tackle is the scripted tackler's: chasers hold a ring around the quarterback and the man who ends up with
      // the ball, the whole play.
      const ck = a.carrier === null ? -1 : (index.get(a.carrier) ?? -1);
      // A run, until the back is a step past the line: the hole is open, so nobody's on him in the backfield (the
      // tackler included: a run stuffed there is his to make, at the end). Blocked men are driven off the crease, the
      // rest wait on him a couple of yards off, each no quicker than his legs.
      if (a.run && released && ck >= 0 && (px[ck] - ballX0) * a.dir < CREASE_PAST)
        for (let k = 0; k < n; k++) {
          if (!steered[k] || offense[k] || stuckTo.has(k)) continue;
          const dx = px[k] - px[ck];
          const dy = py[k] - py[ck];
          const d = Math.hypot(dx, dy);
          if (d >= CREASE || d === 0) continue;
          const out = Math.min(CREASE - d, (SPEED[members[k].role] + LEGS_OVER) * a.dt);
          px[k] += (dx / d) * out;
          py[k] += (dy / d) * out;
        }
      for (const r of new Set([hk, ck])) {
        if (r < 0) continue;
        for (let k = 0; k < n; k++) {
          // (A man stuck on a block is blocked, not lunging at the carrier.)
          if (!steered[k] || k === pk || offense[k] === offense[r] || stuckTo.has(k)) continue;
          const dx = px[k] - px[r];
          const dy = py[k] - py[r];
          const d = Math.hypot(dx, dy);
          // A man who's just missed is going down where he is: the carrier runs on past him (the floor below still
          // keeps him a yard off), not held at the ring and carried along at the carrier's side.
          if (d < RING && t < whiffed[k]) continue;
          if (d < RING) {
            // He's there too soon (the tackle is the tackler's): he whiffs. Knocked off to the side the carrier is
            // passing him on, not shoved along in front of him, and his momentum gone, so he falls off the play.
            const mx = px[r] - lastX[r];
            const my = py[r] - lastY[r];
            const m = Math.hypot(mx, my);
            let ux = d > 0 ? dx / d : a.dir;
            let uy = d > 0 ? dy / d : 0;
            // Only while he's really running (4 yards a second and up): as he slows into the tackle his heading
            // wavers, and a side picked from it would flip frame to frame. Then the chaser simply holds the ring.
            const running = m > 4 * a.dt;
            if (running) {
              // The side he's knocked to stays his while he's near: picked afresh each step, a man straight in front
              // would flip from one side of the carrier to the other.
              if (!ringSide[k]) ringSide[k] = Math.sign(-my * dx + mx * dy) || 1;
              const side = ringSide[k];
              ux = (-my / m) * side;
              uy = (mx / m) * side;
            }
            // He missed: his momentum carries him on past as he goes down (braking hard, `FALL`), the carrier slipping
            // him to the side (the floor below), and the play goes on without him for a moment. A carrier slowing into
            // the tackle is the tackler's: the chaser holds the ring.
            if (running) whiffed[k] = t + WHIFF;
            else {
              px[k] = px[r] + ux * RING;
              py[k] = py[r] + uy * RING;
            }
          } else if (
            d < LUNGE &&
            t >= whiffed[k] &&
            r === ck &&
            Math.hypot(px[r] - lastX[r], py[r] - lastY[r]) > 6 * a.dt
          ) {
            // Level with him and close, running with the play: he lunges and misses. No escort at the carrier's elbow.
            const mx = px[r] - lastX[r];
            const my = py[r] - lastY[r];
            if (((px[r] - px[k]) * mx + (py[r] - py[k]) * my) / Math.hypot(mx, my) > -1) whiffed[k] = t + WHIFF;
          } else if (d > RING * 2) ringSide[k] = 0;
        }
      }
      // However he was pushed or knocked off, a man covers no more ground in a step than his own legs can: a lineman
      // never moves like a corner, whatever the room around him asks.
      for (let k = 0; k < n; k++) {
        if (!steered[k]) continue;
        const dx = px[k] - lastX[k];
        const dy = py[k] - lastY[k];
        const d = Math.hypot(dx, dy);
        const most = Math.min(MAX_STEP, (SPEED[members[k].role] + (k === pk ? PURSUIT : 0) + LEGS_OVER) * a.dt);
        if (d > most) {
          px[k] = lastX[k] + (dx / d) * most;
          py[k] = lastY[k] + (dy / d) * most;
        }
      }
      // ...and nobody but the tackler gets his hands on the man with the ball (the quarterback until it's out, then
      // the carrier; a receiver still on his route is covered as close as his man can get): the least step out to a
      // yard off him.
      for (const r of [hk]) {
        if (r < 0) continue;
        for (let k = 0; k < n; k++) {
          if (!steered[k] || k === pk || offense[k] === offense[r]) continue;
          const dx = px[k] - px[r];
          const dy = py[k] - py[r];
          const d = Math.hypot(dx, dy);
          if (d < FLOOR && d > 0) {
            const mx = px[r] - lastX[r];
            const my = py[r] - lastY[r];
            const ml = Math.hypot(mx, my);
            if (t < whiffed[k] && ml > 0) {
              // Made to miss: the carrier slips him, so he's out of the way to the side, his run carrying on past
              // (pushed back the way he came, he'd stop dead against the carrier).
              const hx = mx / ml;
              const hy = my / ml;
              const along = dx * hx + dy * hy;
              const across = -dx * hy + dy * hx;
              const side = Math.sign(across) || 1;
              const out = Math.sqrt(Math.max(0, FLOOR * FLOOR - along * along));
              const slip = { x: px[r] + hx * along - hy * side * out, y: py[r] + hy * along + hx * side * out };
              // A slip, not a throw: while the carrier's heading swings (a spin, a hard cut) the slip's spot swings round
              // him with it, so he takes whichever spot a yard off is the shorter step from where he was.
              const lx = lastX[k] - px[r];
              const ly = lastY[k] - py[r];
              const ld = Math.hypot(lx, ly);
              const near = ld > 0 ? { x: px[r] + (lx / ld) * FLOOR, y: py[r] + (ly / ld) * FLOOR } : slip;
              const far = (q: { x: number; y: number }) => Math.hypot(q.x - lastX[k], q.y - lastY[k]);
              const to = far(slip) <= far(near) + SLIP_GIVE ? slip : near;
              px[k] = to.x;
              py[k] = to.y;
            } else {
              // Out to the floor on the side he came from: the least step there is (out from where the step left him
              // would drag him round the carrier, quicker than he runs).
              const lx = lastX[k] - px[r];
              const ly = lastY[k] - py[r];
              const ld = Math.hypot(lx, ly);
              const [ux, uy] = ld > 0 ? [lx / ld, ly / ld] : [dx / d, dy / d];
              px[k] = px[r] + ux * FLOOR;
              py[k] = py[r] + uy * FLOOR;
            }
          }
        }
      }
    }
    for (let k = 0; k < n; k++) {
      out[(step * n + k) * 2] = px[k];
      out[(step * n + k) * 2 + 1] = py[k];
      lastX[k] = px[k];
      lastY[k] = py[k];
    }
  }
  return out;
}
