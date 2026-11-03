/**
 * The open field (spec: docs/superpowers/specs/2026-11-03-spatial-open-field-design.md §2): every man steps 20 times a
 * second from the moment the carrier has the ball in space to the whistle. The carrier reads the field, blockers take
 * the men in his way, defenders take their angles and shed their blocks, and a defender who gets within reach makes a
 * play on him. Pure and seeded: the same start and stream give the same frames.
 */
import type { Rng } from '../rng';
import { bodyOf, hasHabit, stepBody, type Body } from './body';
import { angleSpread, chaseWant, shedOdds } from './chase';
import { contest, type Contact } from './contest';
import { FIELD_W, MID } from './geometry';
import { readField, type Reader } from './read';
import {
  BLOCK_DELAY,
  BRAKE,
  KNOBS,
  DOWN_FOR,
  FALL,
  JUMP_READ,
  MAX_FIELD,
  REACH,
  READ_EVERY,
  RECONTEST,
  STEP,
} from './tuning';
import type { FieldResult, FieldStart } from './types';

/** How long the film runs on past a touchdown or a man going out of bounds, and past a pile settling (seconds). */
const COAST = { touchdown: 0.5, out: 0.4, tackle: 0.2 };
/** A blocker downfield takes men this close to the carrier's line (yards), and engages at this distance. */
const BLOCK_LANE = 6;
const ENGAGE = 1;
/** Where a blocker holds his man from (yards), and how fast the pair drifts away from the ball. */
const HOLD_GAP = 0.9;
const DRIVE = 1;
/** An escort trails the carrier from this far, at this share of his speed. */
const ESCORT = 6;
/** Linemen climb to the second level this long after possession (a `secondLevel` man at once). */
const CLIMB = 0.5;
/** A blocker whose man got off him looks for another after this long. */
const REGROUP = 1;
/** A man in a block or a pile is shielded from the carrier's read this close to his path to the carrier (yards). */
const SHIELD = 1.2;
/** Steps a defender reads the carrier's velocity over. */
const SMOOTH = 6;
/** At his spot: within this many yards of it the next man to him has the tackle. */
const ANCHOR = 1;
/** Past his spot by this much with nobody on him, he goes down; a man this close takes him. */
const PAST = 0.5;
const ANCHOR_REACH = 3;
/** A man credited short of the goal line goes down this far short of it (yards). */
const GOAL_SHORT = 0.3;
/** An outside run stretches the edge for this long (seconds) before he reads purely for ground. */
const STRETCH_T = 1;
/** After a catch he gathers this long (seconds) before he reads the field. */
const GATHER = 0.2;
/** Room for a move: no other defender this close (yards). */
const ROOM = 2;

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

export function runField(start: FieldStart, rng: Rng): FieldResult {
  const P = start.players;
  const n = P.length;
  const B: Body[] = P.map((p) => bodyOf(p, start.tired, p.id === start.carrier));
  const ci = P.findIndex((p) => p.id === start.carrier);
  const dir = start.dir;
  const goalX = dir === 1 ? 100 : 0;
  const index = new Map(P.map((p, i) => [p.id, i]));
  const defense = P.map((p) => p.side === 1);

  // Blocks: each man's partner (-1: none), when a blocked man may first get off, and where he's held from.
  const partner = new Int16Array(n).fill(-1);
  const holdUntil = new Float64Array(n);
  const offX = new Float64Array(n);
  const offY = new Float64Array(n);
  const regroupAt = new Float64Array(n);
  const engage = (b: number, d: number, hold: number) => {
    partner[b] = d;
    partner[d] = b;
    holdUntil[d] = hold;
    const g = dist(B[d], B[b]) || 1;
    offX[d] = ((B[d].x - B[b].x) / g) * HOLD_GAP;
    offY[d] = ((B[d].y - B[b].y) / g) * HOLD_GAP;
    // They meet: the collision takes both men's momentum into one (a block stops a man running through it).
    const vx = (B[b].vx + B[d].vx) / 2;
    const vy = (B[b].vy + B[d].vy) / 2;
    B[b].vx = B[d].vx = vx;
    B[b].vy = B[d].vy = vy;
  };
  for (const blk of start.blocks) {
    const b = index.get(blk.blocker);
    const d = index.get(blk.defender);
    if (b === undefined || d === undefined || b === ci || defense[b] || !defense[d]) continue;
    if (partner[b] >= 0 || partner[d] >= 0) continue;
    engage(b, d, blk.holdFor);
  }

  const noContest = new Float64Array(n);
  /** Who has had his one try at him short of the credited spot (call H). */
  const tried = new Uint8Array(n);
  // Men a clean hole holds a beat (`FieldStart.late`): flat-footed until then.
  const lateUntil = new Float64Array(n);
  for (const l of start.late ?? []) {
    const i = index.get(l.id);
    if (i !== undefined) lateUntil[i] = l.until;
  }
  const q = new Float64Array(n).fill(1);
  const target = new Int16Array(n).fill(-1);
  const hist: { x: number; y: number }[] = [];
  const frames: number[] = [];
  const record = () => {
    for (const b of B) frames.push(b.x, b.y);
  };
  record();
  hist.push({ x: B[ci].x, y: B[ci].y });

  // A catch: he gathers a beat before he reads the field (a slasher turns upfield at once), and soft hands catch a short
  // ball in stride.
  const caught = start.kind === 'catch';
  if (caught && hasHabit(P[ci], 'softHands') && (B[ci].x - start.yardLine) * dir < 10) {
    const v = Math.hypot(B[ci].vx, B[ci].vy);
    const k = v > 0.1 ? (v + 1) / v : 1;
    B[ci].vx = v > 0.1 ? B[ci].vx * k : dir;
    B[ci].vy *= k;
  }
  let want = { vx: B[ci].vx, vy: B[ci].vy };
  let nextRead = caught && !hasHabit(P[ci], 'yacSlasher') ? GATHER : 0;
  let nextAim = 0;
  const every = hasHabit(P[ci], 'jumpCutter') ? JUMP_READ : READ_EVERY;
  const misses: FieldResult['misses'] = [];

  let phase = 'live' as 'live' | 'pile' | 'over';
  let touchdown = false;
  let outOfBounds = false;
  let tackler = -1;
  let whistle = 0;
  let coastUntil = 0;
  let spotX = 0;
  let pileBrake = 0;
  let move = null as Contact['program'];
  /** Today's spot (call H): he plays to it. */
  const spot = start.target;
  /** Past his spot with nobody on him: going down. */
  let sliding = false;
  let moveUntil = 0;

  /** Who can still make a play, and how late, as the carrier reads it. */
  const reader = (t: number): Reader => {
    const chasers: Reader['chasers'] = [];
    for (let i = 0; i < n; i++) {
      if (!defense[i]) continue;
      const d = B[i];
      let late = d.react + Math.max(0, lateUntil[i] - t);
      if (t < d.downUntil) late += d.downUntil - t;
      if (partner[i] >= 0) late += BLOCK_DELAY + Math.max(0, holdUntil[i] - t);
      else if (shielded(i)) late += BLOCK_DELAY;
      chasers.push({ x: d.x, y: d.y, top: d.top, late });
    }
    return {
      chasers,
      dir,
      goalX,
      // Playing to today's spot he stays in bounds to it: the engine keeps today's out-of-bounds call.
      clock: start.target ? { outOfBounds: false, stayIn: true } : start.clock,
      reads: P[ci].s.reads,
      eastWest: start.kind === 'catch' && hasHabit(P[ci], 'runsEastWest'),
      averse: hasHabit(P[ci], 'contactAverse'),
      prev: heading(),
      ...(start.stretch && t < STRETCH_T ? { stretch: start.stretch } : {}),
    };
  };
  /** The carrier's heading now, or none when he's barely moving. */
  const heading = () => {
    const v = Math.hypot(want.vx, want.vy);
    return v > 0.5 ? { x: want.vx / v, y: want.vy / v } : undefined;
  };
  /** A teammate of the carrier stands on this defender's way to him. */
  const shielded = (i: number) => {
    const c = B[ci];
    const d = B[i];
    const lx = c.x - d.x;
    const ly = c.y - d.y;
    const len2 = lx * lx + ly * ly || 1;
    for (let j = 0; j < n; j++) {
      if (defense[j] || j === ci) continue;
      const m = B[j];
      const k = ((m.x - d.x) * lx + (m.y - d.y) * ly) / len2;
      if (k <= 0 || k >= 1) continue;
      if (Math.hypot(d.x + lx * k - m.x, d.y + ly * k - m.y) < SHIELD) return true;
    }
    return false;
  };

  for (let s = 1; ; s++) {
    const t = (s - 1) * STEP;
    const c = B[ci];
    if (phase === 'live') {
      // The carrier: his read, or the move he's in the middle of.
      if (move && t < moveUntil) want = move.want;
      else {
        move = null;
        if (t >= nextRead) {
          want = readField(c, reader(t), rng);
          nextRead = t + every;
        }
      }
      // Defenders re-aim on the same beat, each with this read's angle error.
      if (t >= nextAim) {
        for (let i = 0; i < n; i++) if (defense[i]) q[i] = rng.normal(1, angleSpread(P[i].s.pursuit) * alley(i));
        // Blockers downfield pick their men.
        for (let i = 0; i < n; i++) if (!defense[i] && i !== ci) target[i] = pickTarget(i, t);
        nextAim = t + READ_EVERY;
      }
    }
    // Everyone else moves.
    for (let i = 0; i < n; i++) {
      if (i === ci) continue;
      const b = B[i];
      const was = { x: b.x, y: b.y };
      if (phase === 'pile' && i === tackler) {
        stepBody(b, { vx: (c.x + offX[i] - b.x) / STEP, vy: (c.y + offY[i] - b.y) / STEP }, STEP, pileBrake);
      } else if (phase !== 'live') stepBody(b, { vx: 0, vy: 0 }, STEP, t < b.downUntil ? FALL : BRAKE);
      else if (defense[i]) moveDefender(i, t, s);
      else moveTeammate(i, t);
      keepOnField(b, was);
    }
    // The carrier.
    if (phase === 'pile') stepBody(c, { vx: 0, vy: 0 }, STEP, pileBrake);
    else if (phase === 'over' && touchdown) stepBody(c, { vx: c.vx, vy: c.vy }, STEP);
    else if (phase === 'over') stepBody(c, { vx: 0, vy: 0 }, STEP);
    else if (sliding) stepBody(c, { vx: 0, vy: 0 }, STEP, FALL);
    else stepBody(c, want, STEP);
    record();
    hist.push({ x: c.x, y: c.y });
    const now = s * STEP;

    if (phase === 'live') {
      if (spot && !spot.touchdown && (c.x - goalX) * dir >= -GOAL_SHORT) {
        // Credited short of the goal line: he goes down at it, the nearest man on him.
        c.x = goalX - dir * GOAL_SHORT;
        c.vx = c.vy = 0;
        tackler = nearestDefender();
        spotX = c.x;
        end(now, COAST.tackle);
      } else if ((c.x - goalX) * dir >= 0) {
        touchdown = true;
        spotX = goalX;
        end(now, COAST.touchdown);
      } else if (c.y < 0 || c.y > FIELD_W) {
        outOfBounds = true;
        spotX = c.x;
        end(now, COAST.out);
      } else contact(now);
      // Reaching his spot with nobody on him: he goes down in time to stop at it (a man close by takes him), and the
      // first man to him has the tackle (`contact`).
      if (phase === 'live' && spot && !spot.touchdown && !sliding) {
        const v = Math.hypot(c.vx, c.vy);
        if (left() <= (v * v) / (2 * FALL) + PAST) {
          const d = nearestFree(ANCHOR_REACH, now);
          if (d >= 0 && left() <= PAST) tackleBy(d, Math.max(0, left()), v);
          else if (d < 0) sliding = true;
        }
      }
      if (phase === 'live' && now >= MAX_FIELD) {
        // Never meant to happen (the tests hold it): the nearest defender has him.
        tackler = nearestDefender();
        spotX = c.x;
        end(now, 0);
      }
    } else if (phase === 'pile' && Math.hypot(c.vx, c.vy) < 0.2) {
      spotX = c.x;
      end(now, COAST.tackle);
    }
    if (phase === 'over' && now >= coastUntil - 1e-9) break;
  }

  return {
    yards: (spotX - start.yardLine) * dir,
    tackler: tackler >= 0 ? P[tackler].id : null,
    touchdown,
    outOfBounds,
    misses,
    duration: whistle,
    frames: Float32Array.from(frames),
  };

  /** Yards he has left to his credited spot (negative: past it). */
  function left(): number {
    return spot ? (spot.x - B[ci].x) * dir : Infinity;
  }

  /** The nearest defender free to make a play within `reach` yards of him, or -1. */
  function nearestFree(reach: number, now: number): number {
    let best = -1;
    let bd = reach;
    for (let i = 0; i < n; i++) {
      if (!defense[i] || partner[i] >= 0 || now < B[i].downUntil) continue;
      const g = dist(B[i], B[ci]);
      if (g <= bd) [best, bd] = [i, g];
    }
    return best;
  }

  /** Defender `d` brings him down, the pile carrying `on` yards at the speed he had. */
  function tackleBy(d: number, on: number, sp: number) {
    tackler = d;
    phase = 'pile';
    const g = dist(B[d], B[ci]) || 1;
    offX[d] = ((B[d].x - B[ci].x) / g) * 0.6;
    offY[d] = ((B[d].y - B[ci].y) / g) * 0.6;
    // He carries the pile on `on` yards, slowing evenly to a stop.
    pileBrake = Math.max(FALL, (sp * sp) / (2 * Math.max(0.3, on)));
  }

  function end(now: number, coast: number) {
    phase = 'over';
    whistle = now;
    coastUntil = now + coast;
  }

  function nearestDefender(): number {
    let best = -1;
    let bd = Infinity;
    for (let i = 0; i < n; i++) if (defense[i] && dist(B[i], B[ci]) < bd) [best, bd] = [i, dist(B[i], B[ci])];
    return best;
  }

  /** A defensive back who crashes the alley reads a run outside the tackles sharper (`alleyCrusher`). */
  function alley(i: number): number {
    return hasHabit(P[i], 'alleyCrusher') && Math.abs(B[ci].y - MID) > 4 ? 0.6 : 1;
  }

  function moveDefender(i: number, t: number, s: number) {
    const d = B[i];
    if (t < d.downUntil) return stepBody(d, { vx: 0, vy: 0 }, STEP, FALL);
    if (t < lateUntil[i]) return stepBody(d, { vx: 0, vy: 0 }, STEP);
    const b = partner[i];
    if (b >= 0) {
      const mult = (hasHabit(P[i], 'unblockable') ? 1.5 : 1) * (hasHabit(P[i], 'stuckOnBlocks') ? 0.5 : 1);
      const gassed = start.tired && hasHabit(P[i], 'gassed') ? 0.7 : 1;
      if (t >= holdUntil[i] && rng.chance(shedOdds(P[i].s.shed, P[b].s.block, STEP, mult * gassed))) {
        partner[i] = -1;
        partner[b] = -1;
        regroupAt[b] = t + REGROUP;
      } else {
        const hx = B[b].x + offX[i];
        const hy = B[b].y + offY[i];
        return stepBody(d, { vx: (hx - d.x) / STEP, vy: (hy - d.y) / STEP }, STEP);
      }
    }
    // Close in he's keyed on the man and reacts on reflex: half his read's delay.
    const near = dist(d, B[ci]) < 4 ? 0.5 : 1;
    const lag = Math.min(hist.length - 1, Math.round((d.react * near) / STEP));
    const k = hist.length - 1 - lag;
    const seen = hist[k];
    // His velocity as the defender saw it, over the last few tenths: a lean isn't a cut.
    const back = Math.min(k, SMOOTH);
    const before = hist[k - back];
    const vx = back > 0 ? (seen.x - before.x) / (back * STEP) : B[ci].vx;
    const vy = back > 0 ? (seen.y - before.y) / (back * STEP) : B[ci].vy;
    const role = P[i].role;
    const behind = (B[ci].x - d.x) * dir > 10;
    stepBody(
      d,
      chaseWant(d, {
        seen,
        vx,
        vy,
        q: q[i],
        deep: role === 'CB' || role === 'S',
        dir,
        eased: behind && !hasHabit(P[i], 'highMotor'),
        react: lag * STEP,
      }),
      STEP,
    );
    void s;
  }

  function pickTarget(i: number, t: number): number {
    if (partner[i] >= 0 || t < regroupAt[i]) return -1;
    if (P[i].role === 'OL' && t < CLIMB && !hasHabit(P[i], 'secondLevel')) return -1;
    const c = B[ci];
    const sp = Math.hypot(c.vx, c.vy);
    const hx = sp > 0.5 ? c.vx / sp : dir;
    const hy = sp > 0.5 ? c.vy / sp : 0;
    let best = -1;
    let bd = Infinity;
    for (let j = 0; j < n; j++) {
      if (!defense[j] || partner[j] >= 0 || t < B[j].downUntil) continue;
      if ((B[j].x - c.x) * dir < -1) continue;
      const rx = B[j].x - c.x;
      const ry = B[j].y - c.y;
      if (Math.abs(-rx * hy + ry * hx) > BLOCK_LANE) continue;
      let taken = false;
      for (let k = 0; k < n; k++) if (k !== i && target[k] === j) taken = true;
      if (taken) continue;
      const dd = dist(B[i], B[j]);
      if (dd < bd) [best, bd] = [j, dd];
    }
    return best;
  }

  function moveTeammate(i: number, t: number) {
    const b = B[i];
    const c = B[ci];
    const d = partner[i];
    if (d >= 0) {
      const away = dist(B[d], c) || 1;
      return stepBody(b, { vx: ((B[d].x - c.x) / away) * DRIVE, vy: ((B[d].y - c.y) / away) * DRIVE }, STEP);
    }
    const j = target[i];
    if (j >= 0 && partner[j] < 0 && t >= B[j].downUntil) {
      if (dist(b, B[j]) <= ENGAGE) {
        // A return team's block holds a beat (its own wall); a scrimmage block downfield can be shed at once.
        engage(i, j, start.kind === 'return' ? t + KNOBS.retHold : t);
        return stepBody(b, { vx: 0, vy: 0 }, STEP);
      }
      const g = dist(B[j], c) || 1;
      const ax = B[j].x + ((c.x - B[j].x) / g) * ENGAGE;
      const ay = B[j].y + ((c.y - B[j].y) / g) * ENGAGE;
      const u = dist({ x: ax, y: ay }, b) || 1;
      return stepBody(b, { vx: ((ax - b.x) / u) * b.top, vy: ((ay - b.y) / u) * b.top }, STEP);
    }
    const g = dist(c, b);
    if (g > ESCORT)
      return stepBody(b, { vx: ((c.x - b.x) / g) * 0.7 * b.top, vy: ((c.y - b.y) / g) * 0.7 * b.top }, STEP);
    stepBody(b, { vx: 0, vy: 0 }, STEP);
  }

  /**
   * Nobody but the carrier leaves the field: a step that would take a man over a line stops on it, and a man the
   * approach left over one (a route run past the end line) can't go further out but walks back on his own legs.
   */
  function keepOnField(b: Body, was: { x: number; y: number }) {
    const wall = (v: number, prev: number, lo: number, hi: number): [number, boolean] => {
      if (v >= lo && v <= hi) return [v, false];
      if (prev >= lo && prev <= hi) return [v < lo ? lo : hi, true];
      // Already outside: no further out than he was.
      return [v < lo ? Math.max(v, prev) : Math.min(v, prev), v < lo ? v < prev : v > prev];
    };
    const [y, hitY] = wall(b.y, was.y, 0.5, FIELD_W - 0.5);
    const [x, hitX] = wall(b.x, was.x, -10, 110);
    if (hitY) b.vy = y <= 0.5 ? Math.max(0, b.vy) : Math.min(0, b.vy);
    if (hitX) b.vx = x <= -10 ? Math.max(0, b.vx) : Math.min(0, b.vx);
    b.x = x;
    b.y = y;
  }

  /** A free defender within reach makes his play. */
  function contact(now: number) {
    const c = B[ci];
    let d = -1;
    let dd = Infinity;
    // Short of his credited spot each man gets one real try at him (call H): after it he shadows him.
    const shy = !!spot && (spot.touchdown || left() > ANCHOR);
    for (let i = 0; i < n; i++) {
      if (!defense[i] || partner[i] >= 0 || now < B[i].downUntil || now < noContest[i]) continue;
      if (shy && tried[i]) continue;
      const g = dist(B[i], c);
      if (g <= REACH && g < dd) [d, dd] = [i, g];
    }
    if (d < 0) return;
    let help = 0;
    for (let i = 0; i < n; i++)
      if (i !== d && defense[i] && partner[i] < 0 && now >= B[i].downUntil && dist(B[i], c) <= 1.5) help++;
    const sp = Math.hypot(c.vx, c.vy);
    const cos = sp > 0.3 ? ((B[d].x - c.x) * c.vx + (B[d].y - c.y) * c.vy) / (sp * (dd || 1)) : 1;
    const angle = cos > 0.5 ? 'head' : cos < -0.5 ? 'behind' : 'side';
    let room = true;
    for (let i = 0; i < n; i++)
      if (i !== d && defense[i] && partner[i] < 0 && now >= B[i].downUntil && dist(B[i], c) <= ROOM) room = false;
    const r = contest(P[ci], c, P[d], B[d], help, angle, start, rng, room);
    if (spot) {
      // At his spot (and no touchdown to come) this man has him, the pile carrying him the rest of the way; short of
      // it, or on his way to a touchdown, he drives through.
      if (!spot.touchdown && left() <= ANCHOR) return tackleBy(d, Math.max(0, left()), sp);
      tried[d] = 1;
      // His try would have had him: short of the spot he's held off, no miss (the tackle is the spot's).
      if (r.out === 'tackle') return;
    }
    if (r.out === 'tackle') return tackleBy(d, r.afterContact, sp);
    misses.push({
      by: P[d].id,
      how: r.out === 'broken' ? 'size' : 'move',
      t: now,
      ...(r.move ? { move: r.move } : {}),
    });
    B[d].downUntil = now + DOWN_FOR;
    noContest[d] = now + RECONTEST;
    if (r.out === 'broken') {
      c.vx *= 0.6;
      c.vy *= 0.6;
    }
    move = r.program;
    if (move) moveUntil = now + move.dur;
  }
}
