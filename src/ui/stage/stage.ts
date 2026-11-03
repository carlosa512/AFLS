/**
 * One play, staged for All-22: who's on the field, where they line up, the ball's path, the scripted players and the
 * steered rest, as tracks of every dot at 20 steps a second. Pure and seeded: the same play stages the same way.
 * Spec: docs/superpowers/specs/2026-10-31-all-22-view-design.md §3.
 */
import { actorsIn, defenseCallAt } from '../../engine/playActors';
import { Rng } from '../../engine/rng';
import type { DefenseCall } from '../../engine/match/coach';
import type { FieldRecord, FieldScheme, PlayLogEntry } from '../../engine/types';
import { MID, offenseSide } from './ballPath';
import type { Role } from './cast';
import { meshGap, pocketPath, pocketPlan, type PocketPlan } from './pocket';
import { HOP_PEAK } from './fumble';
import { castFor } from './cast';
import { blitzersFor, isVictory, lineUp } from './formations';
import {
  ballTrack,
  catchSpot,
  KNEEL_AT,
  passFlight,
  sample,
  script,
  stagedPath,
  throwWindow,
  type Keyframe as ScriptKey,
  type Pattern,
} from './scripts';
import { assign, conceptFor, spotOf, type ConceptId } from './concepts';
import { routeFor, routeTime, type RouteId } from './routes';
import { SPEED, steer } from './steer';
import type { Pt } from './formations';
import { habitsOf } from './habits';
import { holeAt, planRunBlocks, runCall, type RunBlocking, type RunCall } from './runBlocks';
import { COVERAGES } from '../../engine/schemes';

export const STEP = 0.05;
/** Plays where the quarterback has the ball first, and the ones where he drops back to throw. */
const HOLDERS: ReadonlySet<string> = new Set(['run', 'pass', 'incomplete', 'int', 'sack', 'scramble']);
const DROPBACKS: ReadonlySet<string> = new Set(['pass', 'incomplete', 'int', 'sack', 'scramble']);
/** A play with no path (a timeout): the line-up, held this long. */
const STILL = 0.5;
/** A flag before the snap: the line-up held long enough to see who moved (`fouls.ts`). */
const PRE_SNAP = 1.6;
/** The man in coverage's distance from the target as the ball arrives: a catch, a miss (mean, least, most), a pick. */
const SEPARATION = { catch: [4, 2.5, 6.5], miss: [2.6, 1.2, 4], pick: 0.8 } as const;
/** A key man's ring shows at his moment, never ahead of it: a ring that comes first gives the play away (who's thrown
 * to, who makes the tackle). */
const REVEAL_LEAD = 0;

export interface StagedPlay {
  /** Seconds a step. */
  dt: number;
  steps: number;
  /** Offense first, then defense. */
  ids: number[];
  /** Per id: on the side with the ball (the kicking side on a kick). */
  offense: boolean[];
  /** Per id: wears the home kit. */
  home: boolean[];
  /** steps × ids × (x, y), in field yards. */
  pos: Float32Array;
  /** steps × (x, y, h). */
  ball: Float32Array;
  /** The players the play was about: ringed and drawn on top. */
  keys: number[];
  /** Per key: seconds from the snap when his ring shows, just before his moment, so the ring never gives the play away. */
  reveal: number[];
  /** Per key: when his part is over and the ring goes (Infinity: it stays). */
  until: number[];
  /** Who has the ball at the whistle. */
  carrier: number | null;
  /** A dropback's drop and pocket (`pocket.ts`); null on anything else. */
  pocket: PocketPlan | null;
  /** A pass's concept and the target's route (`concepts.ts`, `routes.ts`); absent on anything else. */
  pattern?: { concept: ConceptId; route: RouteId };
  /** The victory formation: the quarterback, down on a knee from `t` (seconds from the snap). */
  kneel?: { id: number; t: number };
  /** A run's blocking by the call (`runBlocks.ts`): the call, the play side, the hole, the puller, who climbs, the free men. */
  run?: {
    call: RunCall;
    side: 1 | -1;
    hole: Pt;
    puller: number | null;
    climb: [number, number][];
    free: number[];
  };
  /** A fumble: when (seconds from the snap) and where the ball came out, and who recovered it. */
  loose?: { t: number; x: number; y: number; by: number };
  /** Per id: the spot he lined up at (QB, OL, WR...). */
  roles: Role[];
  /** Which way the offense (the kicking team on a kick) is going. */
  dir: 1 | -1;
  /** The play as staged ('penalty': a flag before the snap, held). */
  kind: PlayLogEntry['kind'];
  /** When the ball leaves the quarterback or the kicker (the handoff, the throw, the kick), from the snap. */
  release: number;
  /** When a pass or a kick comes down (null for anything else). */
  arrive: number | null;
  /** The defense's call on the snap, and the men its blitz sends (`blitzersFor`). */
  call: DefenseCall;
  blitz: number[];
  /** What each side runs, for the moments before the snap (`presnap.ts`). */
  schemes: { offense: FieldScheme; defense: FieldScheme };
}

/** The play as it ran: a flagged snap's own path (`PlayLogEntry.ran`), else the entry itself. */
export function asRan(e: PlayLogEntry): PlayLogEntry {
  return e.kind === 'penalty' && e.ran?.kind ? { ...e, ...e.ran } : e;
}

/** When a pass gets there: the end of its flight, the first leg that flies (a fumble's hops never do). */
const passArrives = (e: PlayLogEntry, segs: readonly { peak: number; dur: number }[]): number | null => {
  if (e.kind !== 'pass' && e.kind !== 'incomplete' && e.kind !== 'int') return null;
  const a = segs.findIndex((sg) => sg.peak > HOP_PEAK);
  return a < 0 ? null : segs.slice(0, a + 1).reduce((t, sg) => t + sg.dur, 0);
};

/** Where the ball is at `t` (seconds from the snap), off its track: a loose ball where it settles. */
const settledAt = (ball: Float32Array, t: number): Pt => {
  const k = Math.min(ball.length / 3 - 1, Math.max(0, Math.round(t / STEP)));
  return { x: ball[k * 3], y: ball[k * 3 + 1] };
};

export function stagePlay(args: {
  plays: readonly PlayLogEntry[];
  index: number;
  record: FieldRecord;
  homeId: number;
  seed: string;
  /** Where the ball is snapped across the field (`snapYFor`). */
  snapY: number;
}): StagedPlay {
  const { record, homeId } = args;
  const index = args.index;
  // A snap a flag wiped out is staged as it ran (the walk-off is the official's, between plays); a punter roughed
  // before his punt was measured gets a punt to be roughed on.
  const ran = returned(asRan(args.plays[index]));
  const e = roughedPunt(ran, homeId) ?? ran;
  // The unit and the set it lines up in: a false start on a field goal try is the kick unit's.
  const look: PlayLogEntry = e.kind === 'penalty' && /^Field goal try\./.test(e.text) ? { ...e, kind: 'fg' } : e;
  const plays = look === args.plays[index] ? args.plays : Object.assign(args.plays.slice(), { [index]: look });
  const rng = new Rng(args.seed);
  const cast = castFor(record, plays, index, homeId);
  const dir: 1 | -1 = cast.offSide === 0 ? 1 : -1;
  // The line of scrimmage: a field goal is logged from the holder's spot, seven yards behind it.
  const logged = e.from ?? (cast.offSide === 0 ? e.yardLine : 100 - e.yardLine);
  const ballX = e.kind === 'fg' ? logged + dir * 7 : logged;
  const ballY = e.kind === 'kickoff' ? MID : args.snapY;
  const off = record.scheme[cast.offSide];
  const def = record.scheme[1 - cast.offSide];
  // The defense's call on the snap (run or pass defense, a blitz: the engine's own), and who a blitz sends.
  const call = defenseCallAt(record, index);
  const blitz = blitzersFor(e, cast, call, rng);
  const start = lineUp(look, cast, off, def, ballX, ballY, dir, rng, { call, blitz });
  const who = actorsIn(e);
  const receiverAt = who.ball === undefined ? undefined : start.get(who.ball);
  // A pass's pattern: the target's route from his catch, the concept around it, everyone's assignment (own stream).
  let pattern: Pattern | undefined;
  let routeNeed = 0;
  const land = catchSpot(e, homeId, args.snapY);
  if (land && who.ball !== undefined && receiverAt) {
    const inwardOf = (p: Pt): 1 | -1 => (Math.sign(ballY - p.y) || 1) as 1 | -1;
    const roleOf = (id: number) => cast.offense.find((m) => m.id === id)?.role ?? 'WR';
    const spot = spotOf(roleOf(who.ball), receiverAt, ballY);
    const prng = new Rng(`${args.seed}:pattern`);
    const route = routeFor(
      { air: (land.x - ballX) * dir, across: (land.y - receiverAt.y) * inwardOf(receiverAt), spot },
      prng,
    );
    const concept = conceptFor({ spot, route }, off.offense, /^Designed shot:/.test(e.text), prng);
    // The play side is the target's, or for the back, the side the ball went.
    const side = Math.sign((spot === 'RB' ? land.y : receiverAt.y) - ballY) || 1;
    const others = cast.offense.filter(
      (m) => (m.role === 'WR' || m.role === 'TE' || m.role === 'RB') && m.id !== who.ball && start.has(m.id),
    );
    const men = others.map((m) => {
      const p = start.get(m.id)!;
      return { id: m.id, spot: spotOf(m.role, p, ballY), playSide: (Math.sign(p.y - ballY) || side) === side };
    });
    const everyone = [...others.map((m) => m.id), who.ball];
    pattern = {
      route,
      concept,
      assigned: assign(concept, men),
      inward: new Map(everyone.map((id) => [id, inwardOf(start.get(id)!)])),
      top: new Map(everyone.map((id) => [id, SPEED[roleOf(id)]])),
      // Open on a catch, contested on a miss, on him on a pick (NGS 2024: 3.1 yards at the target, all throws).
      separation:
        e.kind === 'pass'
          ? Math.max(SEPARATION.catch[1], Math.min(SEPARATION.catch[2], prng.normal(SEPARATION.catch[0], 0.9)))
          : e.kind === 'incomplete'
            ? Math.max(SEPARATION.miss[1], Math.min(SEPARATION.miss[2], prng.normal(SEPARATION.miss[0], 0.6)))
            : SEPARATION.pick,
    };
    // The ball can go once the route will get him there with it: his route's time at his speed, less the flight.
    const flight = passFlight(Math.hypot(land.x - (ballX - dir * 6), land.y - ballY));
    routeNeed = routeTime(route, receiverAt, land, dir, inwardOf(receiverAt), SPEED[roleOf(who.ball)]) - flight;
  }
  // A dropback: his drop and pocket (`pocket.ts`), on its own stream.
  const qbId = cast.offense.find((m) => m.role === 'QB')?.id;
  const qbStart = qbId === undefined ? undefined : start.get(qbId);
  // Play action's back: one in the backfield who can meet the quarterback at the mesh (`pocketPath`) in time.
  // (The back the ball's going to can carry out the fake too, then leak out on his route: play action to him.)
  const backId = qbStart
    ? cast.offense
        .filter((m) => m.role === 'RB' && start.has(m.id))
        .map((m) => ({ id: m.id, gap: meshGap(start.get(m.id)!, qbStart, ballX, ballY, dir) }))
        .filter((b) => b.gap <= SPEED.RB * MESH_REACH)
        .sort((a, b) => Number(a.id === who.ball) - Number(b.id === who.ball) || a.gap - b.gap)[0]?.id
    : undefined;
  let pocket: PocketPlan | null = null;
  let qbPath: ReturnType<typeof pocketPath> | undefined;
  if (e.kind && DROPBACKS.has(e.kind) && qbId !== undefined && start.has(qbId) && e.from !== undefined) {
    const qbAt = start.get(qbId)!;
    const rusherAt = who.rush === undefined ? undefined : start.get(who.rush);
    const rusherRole = who.rush === undefined ? undefined : cast.defense.find((m) => m.id === who.rush)?.role;
    pocket = pocketPlan(
      e,
      {
        gun: (ballX - qbAt.x) * dir > 3,
        scheme: off.offense,
        // The two-minute drill: no time for a fake.
        hurry: (e.quarter === 2 || e.quarter >= 4) && e.clock <= 120,
        air: e.air !== undefined && e.kind !== 'sack' && e.kind !== 'scramble' ? (e.air - e.from) * dir : null,
        rusher:
          rusherAt && rusherRole
            ? {
                role: rusherRole,
                across: Math.abs(rusherAt.y - ballY),
                depth: Math.max(0, (rusherAt.x - ballX) * dir),
                top: SPEED[rusherRole],
              }
            : undefined,
        minThrow: pattern ? Math.max(0, routeNeed) : throwWindow(e, homeId, args.snapY, receiverAt),
        blitz: call === 'blitz',
        fake: backId !== undefined,
      },
      new Rng(`${args.seed}:pocket`),
    );
    if (pocket.playAction) pocket.fakeBack = backId;
    qbPath = pocketPath(pocket, {
      ball: { x: ballX, y: ballY },
      qb: qbAt,
      dir,
      rusher: rusherAt,
      through: who.beat === undefined ? undefined : start.get(who.beat),
      back: backId === undefined ? undefined : start.get(backId),
    });
  }
  // The man who runs with the ball: the target, the man who picked it off, a scrambling quarterback, the back.
  const runner = e.kind === 'int' ? who.take : e.kind === 'scramble' ? qbId : who.ball;
  const runnerRole = [...cast.offense, ...cast.defense].find((m) => m.id === runner)?.role;
  const tacklerRole = cast.defense.find((m) => m.id === who.tackle)?.role;
  const segs = stagedPath(
    e,
    homeId,
    args.snapY,
    receiverAt,
    qbPath,
    runnerRole ? SPEED[runnerRole] + 0.3 : undefined,
    tacklerRole ? SPEED[tacklerRole] + PURSUIT : undefined,
  );
  const scripted = script(e, cast, start, segs, dir, pocket, pattern);
  const { keys, carrier, tackler, pursuer, release, catchAt, moments, until, free, loose } = scripted;
  // The habits the engine noted in play, and on a run its blocking by the call (`runBlocks.ts`), on streams of their
  // own so nothing else on the play moves.
  const habits = habitsOf(e, new Set(start.keys()));
  let runBlocks: RunBlocking | undefined;
  if (e.kind === 'run' && carrier !== null) {
    const read = runCall(e, off.offense, new Rng(`${args.seed}:run`));
    const hole = holeAt(read.call, read.side, { x: ballX, y: ballY }, dir, !!e.open?.bounce);
    const back = keys.get(carrier);
    runBlocks = planRunBlocks({
      call: read.call,
      side: read.side,
      hole,
      start,
      cast,
      dir,
      exclude: new Set([who.tackle, e.open?.broke?.by].filter((id): id is number => id !== undefined)),
      backAt: (t) => (back ? sample(back, t) : hole),
      handoff: release,
      carrier,
      habits,
      rng: new Rng(`${args.seed}:blocks`),
    });
    // The puller: behind the line to the hole and up through it at a lineman's pace, then he blocks his man.
    const pull = runBlocks.puller;
    if (pull && start.has(pull.id) && !keys.has(pull.id)) {
      const pace = SPEED.OL - 0.5;
      let t = 0;
      let from = start.get(pull.id)!;
      const legs: ScriptKey[] = [{ t: 0, x: from.x, y: from.y }];
      for (const p of pull.path) {
        t += Math.max(0.15, Math.hypot(p.x - from.x, p.y - from.y) / pace);
        legs.push({ t, x: p.x, y: p.y });
        from = p;
      }
      keys.set(pull.id, legs);
      free.set(pull.id, t);
    }
  }
  const flight = segs.find((sg) => sg.peak > 0);
  const kick = e.kind === 'kickoff' || e.kind === 'punt' ? e.kind : e.kind === 'fg' || e.kind === 'xp' ? 'fg' : null;
  const total = segs.reduce((t, s) => t + s.dur, 0) || (e.kind === 'penalty' ? PRE_SNAP : STILL);
  const steps = Math.ceil(total / STEP) + 1;
  let ball = ballTrack(segs, STEP);
  if (!segs.length) ball = new Float32Array(steps * 3).map((_, i) => (i % 3 === 0 ? ballX : i % 3 === 1 ? ballY : 0));
  // The track is one step short when the path's time lands exactly on a step: pad with its last spot.
  if (ball.length < steps * 3) {
    const padded = new Float32Array(steps * 3);
    padded.set(ball);
    for (let i = ball.length; i < padded.length; i++) padded[i] = padded[i - 3];
    ball = padded;
  }
  const qb = cast.offense.find((m) => m.role === 'QB')?.id ?? null;
  const pos = steer({
    cast,
    start,
    // The tackler runs the play down himself (`steer`), from the snap or once his own part is over (`free`); only
    // where he meets the carrier is scripted, below.
    scripted: pursuer === null || free.has(pursuer) ? keys : new Map([...keys].filter(([id]) => id !== pursuer)),
    free,
    ball,
    release,
    carrier,
    tackler,
    pursuer,
    holder: e.kind && HOLDERS.has(e.kind) ? qb : null,
    rush: who.rush ?? null,
    beat: who.beat ?? null,
    maxProtect: /^Designed shot:/.test(e.text),
    settle: scripted.settle,
    stalk: scripted.stalk,
    target: pattern ? who.ball : null,
    // A screen to the back or the tight end: the line leads it (a bubble out wide is the receivers' to block).
    screen:
      pattern?.route === 'screen' &&
      land &&
      who.ball !== undefined &&
      cast.offense.some((m) => m.id === who.ball && (m.role === 'RB' || m.role === 'TE'))
        ? land
        : null,
    arrive: passArrives(e, segs),
    separation: pattern?.separation,
    dropback: !!e.kind && DROPBACKS.has(e.kind),
    run: e.kind === 'run',
    runBlocks,
    habits,
    // Man coverage behind a blitz, as the engine plays it.
    man: !!(def.coverage && COVERAGES[def.coverage].man) || call === 'blitz',
    coverage: def.coverage,
    call,
    blitz,
    // The victory formation stands still (its token push is scripted).
    hold: !segs.length || isVictory(e),
    kick: segs.length ? kick : null,
    land: flight ? { x: flight.x1, y: flight.y1 } : null,
    catchAt: catchAt ?? Infinity,
    loose: loose ? { from: loose.t, to: loose.settle, at: settledAt(ball, loose.settle) } : undefined,
    dir,
    dt: STEP,
    steps,
    rng,
  });
  const members = [...cast.offense, ...cast.defense];
  // No earlier than he may move: the ball down on a kick, the ball out on a snap.
  const earliest = Math.ceil(
    Math.max(
      kick ? (catchAt ?? 0) : Number.isFinite(release) ? release : 0,
      pursuer !== null ? (free.get(pursuer) ?? 0) : 0,
    ) / STEP,
  );
  if (pursuer !== null) {
    const k = members.findIndex((m) => m.id === pursuer);
    closeIn(pos, members.length, k, keys.get(pursuer)!, steps, earliest, {
      carrier: carrier === null ? -1 : members.findIndex((m) => m.id === carrier),
      top: SPEED[members[k].role] + 1,
      legs: SPEED[members[k].role] + PURSUIT,
      burst: Math.min(SPRINT, SPEED[members[k].role] + PURSUIT + 1),
      kick: kick === 'kickoff',
    });
  }
  const homeSide = cast.offSide === 0;
  return {
    dt: STEP,
    steps,
    ids: members.map((m) => m.id),
    offense: members.map((_, k) => k < cast.offense.length),
    home: members.map((_, k) => k < cast.offense.length === homeSide),
    pos,
    ball: ball.subarray(0, steps * 3),
    // Featured: the men with a moment (a quarterback who only hands off is scripted, not featured).
    ...(loose ? { loose: { t: loose.t, x: loose.x, y: loose.y, by: loose.by } } : {}),
    ...(isVictory(e) && qbId !== undefined ? { kneel: { id: qbId, t: KNEEL_AT } } : {}),
    ...(runBlocks
      ? {
          run: {
            call: runBlocks.call,
            side: runBlocks.side,
            hole: runBlocks.hole,
            puller: runBlocks.puller?.id ?? null,
            climb: [...runBlocks.climb],
            free: runBlocks.free,
          },
        }
      : {}),
    pocket,
    ...(pattern ? { pattern: { concept: pattern.concept.id, route: pattern.route } } : {}),
    keys: [...moments.keys()],
    reveal: [...moments.values()].map((t) => Math.max(0, t - REVEAL_LEAD)),
    until: [...moments.keys()].map((id) => until.get(id) ?? Infinity),
    carrier,
    roles: members.map((m) => m.role),
    dir,
    kind: e.kind,
    release: Number.isFinite(release) ? release : total,
    call,
    blitz: [...blitz],
    schemes: { offense: off, defense: def },
    arrive: catchAt ?? passArrives(e, segs),
  };
}

/**
 * A return a flag moved the ball after: staged to where the return ended ("returns to the NO 18"), not the spot the
 * walk-off put the ball (that's the official's, between plays). The log gives the yard line from one team's side;
 * of the two places that could be, the one nearer the walk-off spot.
 */
export function returned(e: PlayLogEntry): PlayLogEntry {
  if ((e.kind !== 'kickoff' && e.kind !== 'punt') || e.to === undefined) return e;
  const m = /returns to the \S+ (\d+)\. PENALTY/.exec(e.text);
  if (!m) return e;
  const n = Number(m[1]);
  const to = Math.abs(n - e.to) <= Math.abs(100 - n - e.to) ? n : 100 - n;
  return { ...e, to };
}

/** A punter roughed: how far the punt would have gone, for the picture (the flag wiped it out before it was measured). */
const ROUGHED_PUNT = 42;

/**
 * A kick a flag wiped out before the log could give it a path: "T.Harrison punts. PENALTY on CLE (J.Clemons):
 * Roughing the kicker" (a punt as it would have gone), "P.Peterson 21-yard field goal is good. PENALTY on NYK" (the kick
 * from the holder's spot, as the engine logs one). The kick to stage the foul on, or undefined.
 */
function roughedPunt(e: PlayLogEntry, homeId: number): PlayLogEntry | undefined {
  if (e.kind !== 'penalty' || e.from === undefined) return undefined;
  const dir = offenseSide(e, homeId) === 0 ? 1 : -1;
  if (/punts\. PENALTY/.test(e.text)) {
    const air = Math.max(-5, Math.min(105, e.from + dir * ROUGHED_PUNT));
    return { ...e, kind: 'punt', air, to: air };
  }
  if (/field goal is (?:good|no good)\. PENALTY/.test(e.text)) {
    const posts = dir > 0 ? 110 : -10;
    return { ...e, kind: 'fg', from: e.from - dir * 7, air: posts, to: posts };
  }
  return undefined;
}

/** The tackler's top closing speed (yards a second): the last stretch into the carrier is never quicker than this. */
const CLOSE = 9.5;
/** Play action's back gets to the mesh within this long (seconds): the quarterback holds the ball out for him. */
export const MESH_REACH = 0.8;
/** In pursuit the tackler runs this much over his top speed (`steer`'s edge): as quick as he ever gets. */
const PURSUIT = 0.6;
/** A run-down planned at `top` may come out this much over his legs in a quarter-second (his drift onto the line). */
const RUN_DOWN_GIVE = 0.4;
/** Running a carrier down, the tackler's last closing second can be a sprint: never past the NFL's fastest. */
export const SPRINT = 10.5;
/** A last run into the hit longer than this would be a slide alongside the carrier: he runs him down instead. */
const LONG_CLOSE = 1.2;
/** A run-down: he stays this far behind the carrier (yards) until the last `CLOSE_IN` seconds, then closes. */
const TRAIL = 2.6;
const CLOSE_IN = 1;
/** The last stretch of a run-down, eased onto the spot the script has the hit at (seconds). */
const INTO = 0.6;
/** How quickly a man gets up to speed (yards a second, each second). */
const ACCEL = 6;

/**
 * The tackler ran the play down himself (`steer`); he meets the carrier where his script says. From the latest moment
 * he can still get there at full speed, he runs straight into the hit, so the tackle is his run and not a slide. When
 * that run would be a long one (he was beaten, or left behind by a miss), he runs the carrier down from behind instead
 * (`chaseDown`): a straight line to the tackle would have him gliding along at the carrier's side.
 */
function closeIn(
  pos: Float32Array,
  n: number,
  k: number,
  keys: readonly { t: number; x: number; y: number }[],
  steps: number,
  earliest: number,
  chase: { carrier: number; top: number; legs: number; burst: number; kick?: boolean },
) {
  const last = steps - 1;
  const end = keys[keys.length - 1];
  const at = (st: number) => ({ x: pos[(st * n + k) * 2], y: pos[(st * n + k) * 2 + 1] });
  const top = Math.min(CLOSE, chase.legs);
  const gap = (st: number) => Math.hypot(end.x - at(st).x, end.y - at(st).y);
  let from = -1;
  for (let st = last - 1; st >= Math.min(earliest, last - 1); st--) {
    const left = (last - st) * STEP;
    // Far enough out that a full-speed run covers the gap with a little room: start the run in here.
    if (left >= 0.35 && gap(st) <= top * left * 0.8) {
      from = st;
      break;
    }
  }
  // Too far to get there once he may move: he read it sooner, and left from the latest step he still makes it from
  // at full speed. Never quicker than his legs.
  // ...but never off before a kick comes down (`chase.kick`): today's kickoff rules.
  if (from < 0 && chase.kick) from = Math.min(earliest, last - 1);
  if (from < 0) {
    from = 0;
    for (let st = Math.min(earliest, last) - 1; st >= 0; st--)
      if (gap(st) <= top * (last - st) * STEP) {
        from = st;
        break;
      }
  }
  if ((last - from) * STEP > LONG_CLOSE && chase.carrier >= 0) {
    // Beside or ahead of the carrier, he takes an angle on him; well behind him, he runs him down.
    if (angleIn(pos, n, k, chase, end, Math.min(earliest, last - 1), last)) return;
    if (chaseDown(pos, n, k, chase, end, from, last)) return;
  }
  const p0 = at(from);
  for (let st = from + 1; st <= last; st++) {
    const g = (st - from) / (last - from);
    pos[(st * n + k) * 2] = p0.x + (end.x - p0.x) * g;
    pos[(st * n + k) * 2 + 1] = p0.y + (end.y - p0.y) * g;
  }
}

/** An angle tackle: he comes in from this far off the carrier's line, a little ahead of where he meets him (yards). */
const ANGLE_OFF = 3.2;
const ANGLE_AHEAD = 2.4;
/** Behind the carrier by more than this (yards, along his line) when he'd set off, it's a run-down instead. */
const BEHIND_FOR_CHASE = 2.5;

/**
 * An angle tackle: from where he is, to a spot off the carrier's line a little ahead of the hit, then into him from
 * the side, at no more than his legs; he sets off as late as that lets him (from `earliest` on, or sooner if he must).
 * False when he's well behind the carrier (a run-down), when no start gets him there, or when the angle would have him
 * at the carrier's side on the way (a run alongside is what this is for).
 */
function angleIn(
  pos: Float32Array,
  n: number,
  k: number,
  chase: { carrier: number; legs: number; kick?: boolean },
  end: Pt,
  earliest: number,
  last: number,
): boolean {
  const c = chase.carrier;
  const P = (st: number, j: number): Pt => ({ x: pos[(st * n + j) * 2], y: pos[(st * n + j) * 2 + 1] });
  const back = P(Math.max(0, last - 6), c);
  const car = P(last, c);
  const hl = Math.hypot(car.x - back.x, car.y - back.y);
  if (hl < 0.3) return false;
  const h = { x: (car.x - back.x) / hl, y: (car.y - back.y) / hl };
  // He comes from his own side of the carrier's line, as he stood when he could first move.
  const me0 = P(earliest, k);
  const behind = (P(earliest, c).x - me0.x) * h.x + (P(earliest, c).y - me0.y) * h.y;
  if (behind > BEHIND_FOR_CHASE) return false;
  const side = Math.sign(-h.y * (me0.x - car.x) + h.x * (me0.y - car.y)) || 1;
  const A = {
    x: end.x + h.x * ANGLE_AHEAD - h.y * side * ANGLE_OFF,
    y: end.y + h.y * ANGLE_AHEAD + h.x * side * ANGLE_OFF,
  };
  const cut = Math.hypot(end.x - A.x, end.y - A.y);
  const run = (st: number) => Math.hypot(A.x - P(st, k).x, A.y - P(st, k).y) + cut;
  // The latest start that gets him there: after the moment he may move if he can, sooner if he must (never on a kickoff).
  let from = -1;
  for (let st = last - 1; st >= (chase.kick ? earliest : 0); st--)
    if (run(st) <= chase.legs * 0.95 * (last - st) * STEP) {
      from = st;
      break;
    }
  if (from < 0) return false;
  const p0 = P(from, k);
  const total = run(from);
  const T = (last - from) * STEP;
  const was = pos.slice((from + 1) * n * 2, (last + 1) * n * 2);
  for (let st = from + 1; st <= last; st++) {
    const d = (total * (st - from) * STEP) / T;
    const leg1 = total - cut;
    const p =
      d <= leg1
        ? { x: p0.x + ((A.x - p0.x) * d) / (leg1 || 1), y: p0.y + ((A.y - p0.y) * d) / (leg1 || 1) }
        : { x: A.x + ((end.x - A.x) * (d - leg1)) / cut, y: A.y + ((end.y - A.y) * (d - leg1)) / cut };
    pos[(st * n + k) * 2] = p.x;
    pos[(st * n + k) * 2 + 1] = p.y;
  }
  // Not at his side on the way: within two yards of the carrier only in the last moment before the hit.
  let near = 0;
  for (let st = from + 1; st <= last; st++) {
    const a = P(st, k);
    const b = P(st, c);
    near = Math.hypot(a.x - b.x, a.y - b.y) < 2 ? near + STEP : 0;
    if (near > 1.2 && last - st > 2) {
      pos.set(was, (from + 1) * n * 2);
      return false;
    }
  }
  return true;
}

/**
 * Running the carrier down from behind, from step `from` to the tackle at `last`: he follows in the carrier's
 * footsteps, from his own pace up to the one that brings him level at the whistle (no quicker than a man can get up to
 * speed), so the carrier pulls away while he gets going and then the gap closes. He drifts off his own line onto the
 * carrier's as he comes. False when no pace he can reach catches him: the caller's straight run stands.
 */
function chaseDown(
  pos: Float32Array,
  n: number,
  k: number,
  chase: { carrier: number; top: number; legs: number; burst: number },
  end: Pt,
  from: number,
  last: number,
): boolean {
  const c = chase.carrier;
  const P = (st: number, j: number): Pt => ({ x: pos[(st * n + j) * 2], y: pos[(st * n + j) * 2 + 1] });
  // The carrier's footsteps, by the distance he's run.
  const run = new Float64Array(last + 1);
  for (let st = 1; st <= last; st++) {
    const a = P(st - 1, c);
    const b = P(st, c);
    run[st] = run[st - 1] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  const foot = (d: number): Pt => {
    const s = Math.max(0, Math.min(run[last], d));
    let st = 1;
    while (st < last && run[st] < s) st++;
    const a = P(st - 1, c);
    const b = P(st, c);
    const g = run[st] > run[st - 1] ? (s - run[st - 1]) / (run[st] - run[st - 1]) : 1;
    return { x: a.x + (b.x - a.x) * g, y: a.y + (b.y - a.y) * g };
  };
  const me = P(from, k);
  const car = P(from, c);
  const back = P(Math.max(0, from - 2), c);
  const ahead = P(Math.min(last, from + 2), c);
  const hl = Math.hypot(ahead.x - back.x, ahead.y - back.y) || 1;
  const h = { x: (ahead.x - back.x) / hl, y: (ahead.y - back.y) / hl };
  // How far behind the carrier he is along the carrier's line (in front of him: negative), and his pace along it.
  const behind = (car.x - me.x) * h.x + (car.y - me.y) * h.y;
  const was = P(Math.max(0, from - 1), k);
  const pace = Math.max(0, ((me.x - was.x) * h.x + (me.y - was.y) * h.y) / STEP);
  // Level with him (or in front) with the run still long: the carrier makes him miss. His momentum's gone (most of it:
  // as much as still lets him catch the carrier) and he's knocked a yard off the carrier's line, so the carrier pulls
  // clear before he gets going again.
  // Well in front of him and the hit between them, he comes to meet him: the caller's straight run into it. (In front
  // with the hit beyond him, a straight run would have him backing off ahead of the carrier: he gets by him instead.)
  if (behind < -2.5 && (end.x - me.x) * h.x + (end.y - me.y) * h.y < 0) return false;
  const whiffed = behind < 2.5;
  const start = run[from] - Math.max(behind, whiffed ? -0.5 : behind);
  const side = Math.sign(-h.y * (me.x - car.x) + h.x * (me.y - car.y)) || 1;
  const off = { x: me.x - foot(start).x, y: me.y - foot(start).y };
  const knock = whiffed ? { x: -h.y * side, y: h.x * side } : { x: 0, y: 0 };
  const L = (last - from) * STEP;
  const need = run[last] - 0.6 - start;
  if (need <= 0) return false;
  /** How far he goes in `t` seconds, getting from `v0` to `v` at ACCEL and holding it. */
  const gone = (v0: number, v: number, t: number) => {
    const ramp = Math.min(t, Math.abs(v - v0) / ACCEL);
    const sign = v >= v0 ? 1 : -1;
    return v0 * ramp + (sign * ACCEL * ramp * ramp) / 2 + v * (t - ramp);
  };
  // The hardest miss he can still recover from, at his own top speed if he can, a burst over it if he must.
  // Planned a little under his legs: the drift onto the carrier's line and the last step into the hit take the rest.
  const tries = (whiffed ? [0.5, 2.5, 4.5, pace] : [pace]).map((v0) => ({ v0, top: chase.legs - RUN_DOWN_GIVE }));
  const plan = tries.find(({ v0, top }) => gone(v0, top, L) >= need);
  if (!plan) return false;
  const v0 = plan.v0;
  /** The pace from `a` that covers `d` in `t` seconds (no more than `top`). */
  const paceFor = (a: number, d: number, t: number, top: number) => {
    let lo = 0;
    let hi = top;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const ramp = Math.min(t, Math.abs(mid - a) / ACCEL);
      const went = a * ramp + ((mid >= a ? 1 : -1) * ACCEL * ramp * ramp) / 2 + mid * (t - ramp);
      if (went < d) lo = mid;
      else hi = mid;
    }
    return hi;
  };
  // Two legs: a couple of yards behind him until the last second, then the burst that closes it, so the hit is a
  // run-down and not a man creeping up at his elbow. One leg when there's no time for two or the burst is beyond him.
  // The closing burst takes as long as his edge on the carrier needs to make up the trail (a second at least).
  const carrierPace = (run[last] - run[from]) / L;
  const closeIn = Math.max(CLOSE_IN, (TRAIL - 0.6) / Math.max(0.5, chase.burst - RUN_DOWN_GIVE - carrierPace));
  const T1 = L - closeIn;
  const hold = T1 > 0.5 ? run[Math.min(last, from + Math.round(T1 / STEP))] - TRAIL - start : -1;
  let v1 = paceFor(v0, need, L, plan.top);
  let v2 = v1;
  let split = L;
  if (hold > 0) {
    const a = paceFor(v0, hold, T1, plan.top);
    const reach = gone(v0, a, T1);
    const b = paceFor(a, need - reach, closeIn, chase.burst - RUN_DOWN_GIVE);
    const ramp = Math.min(closeIn, Math.abs(b - a) / ACCEL);
    const went = a * ramp + ((b >= a ? 1 : -1) * ACCEL * ramp * ramp) / 2 + b * (closeIn - ramp);
    if (Math.abs(reach - hold) < 0.3 && Math.abs(went - (need - reach)) < 0.3) [v1, v2, split] = [a, b, T1];
  }
  /** How far along the carrier's footsteps he's come `t` seconds in. */
  const along = (t: number) => {
    if (t <= split) return gone(v0, v1, t);
    const t2 = t - split;
    const ramp = Math.min(t2, Math.abs(v2 - v1) / ACCEL);
    return gone(v0, v1, split) + v1 * ramp + ((v2 >= v1 ? 1 : -1) * ACCEL * ramp * ramp) / 2 + v2 * (t2 - ramp);
  };
  // The hit: where the script has it when the run-down already takes him there; otherwise from behind, a step off the
  // carrier on his own line (sliding round to the script's side in the last moment would be a burst he hasn't got).
  const reached = foot(start + along(L));
  const carrierEnd = P(last, c);
  const toCarrier = Math.hypot(carrierEnd.x - reached.x, carrierEnd.y - reached.y) || 1;
  const hit =
    Math.hypot(end.x - reached.x, end.y - reached.y) <= 0.8
      ? end
      : {
          x: carrierEnd.x + ((reached.x - carrierEnd.x) / toCarrier) * 0.6,
          y: carrierEnd.y + ((reached.y - carrierEnd.y) / toCarrier) * 0.6,
        };
  const was0 = pos.slice((from + 1) * n * 2, (last + 1) * n * 2);
  for (let st = from + 1; st <= last; st++) {
    const t = (st - from) * STEP;
    const u = t / L;
    const f = foot(start + along(t));
    // Off his own line onto the carrier's, then into the hit where the script has it.
    const k2 = Math.min(1, t / 0.3) * (1 - u);
    // His own line fades into the carrier's early (most of it by halfway), so little is left for the hit.
    const fade = (1 - u) ** 2;
    const p = { x: f.x + off.x * fade + knock.x * k2, y: f.y + off.y * fade + knock.y * k2 };
    const g = Math.max(0, Math.min(1, (t - (L - INTO)) / INTO));
    const into = g * g * (3 - 2 * g);
    // Into the hit: the little that's left between where his own steps end and the hit eased in (not the whole way to
    // a spot the carrier hasn't reached yet, which had him there early and waiting).
    pos[(st * n + k) * 2] = p.x + (hit.x - reached.x) * into;
    pos[(st * n + k) * 2 + 1] = p.y + (hit.y - reached.y) * into;
  }
  // A run-down that comes out quicker than his legs anywhere isn't one: the caller tries it from earlier, or runs him
  // straight in.
  const w = Math.round(0.25 / STEP);
  for (let st = from + 1; st <= last; st++) {
    const a = P(st, k);
    const b = P(Math.max(0, st - w), k);
    // His legs, and in the closing burst (a run-down's last stretch) the sprint.
    const most = (split < L && st >= from + Math.round(split / STEP) ? chase.burst : chase.legs) + RUN_DOWN_GIVE;
    if (Math.hypot(a.x - b.x, a.y - b.y) > most * Math.min(w, st) * STEP) {
      pos.set(was0, (from + 1) * n * 2);
      return false;
    }
  }
  return true;
}
