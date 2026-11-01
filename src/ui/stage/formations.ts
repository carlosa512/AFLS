/**
 * Where everyone lines up before the snap. Spots are (back, across) from the ball for the offense and (depth, across)
 * for the defense, in yards; `dir` is 1 when the offense attacks toward x = 100, and "across" is from the offense's
 * view, so its right hand is +dir in y (as `buildPath` reads a play's lane).
 */
import type { Rng } from '../../engine/rng';
import { actorsIn } from '../../engine/playActors';
import { COVERAGES } from '../../engine/schemes';
import type { FieldScheme, PlayLogEntry } from '../../engine/types';
import { FIELD_W, MID } from './ballPath';
import type { Cast, CastMember, Role } from './cast';

export interface Pt {
  x: number;
  y: number;
}

/** How far a spot may wander from the book, so two formations from the same call never look stamped out. */
const JITTER = 0.3;
const EDGE = 3;
/** A punt's gunners, split this far from the ball. */
const GUNNER = 16;

const of = (side: CastMember[], role: Role) => side.filter((m) => m.role === role);

/** `n` spots `gap` yards apart, centred on 0. */
const spread = (n: number, gap: number) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);

/** Under center on early downs at a normal distance, outside either two-minute window; the shotgun otherwise. */
function underCenter(e: PlayLogEntry): boolean {
  // The victory formation, and the spike: the quarterback takes the snap under center.
  if (e.kind === 'kneel' || e.kind === 'spike') return true;
  const twoMinute = (e.quarter === 2 || e.quarter >= 4) && e.clock <= 120;
  return (e.down === 1 || e.down === 2) && e.distance <= 10 && !twoMinute;
}

export function lineUp(
  e: PlayLogEntry,
  cast: Cast,
  off: FieldScheme,
  def: FieldScheme,
  ballX: number,
  ballY: number,
  dir: 1 | -1,
  rng: Rng,
): Map<number, Pt> {
  const spots = new Map<number, Pt>();
  const jit = () => (rng.next() * 2 - 1) * JITTER;
  // Offense behind the ball, defense beyond it; `across` from the offense's view.
  const place = (id: number, x: number, across: number) =>
    spots.set(id, {
      // Inside the end lines: a long punt's returner waits at the back of his end zone, not beyond it.
      x: Math.max(-9, Math.min(109, x)),
      y: Math.max(EDGE, Math.min(FIELD_W - EDGE, ballY + dir * (across + jit()))),
    });
  const put: Put = (id, back, across) => place(id, ballX - dir * Math.max(0.5, back + jit() * 0.5), across);
  const face: Put = (id, depth, across) => place(id, ballX + dir * Math.max(0.6, depth + jit() * 0.5), across);

  const lane = e.lane ?? 0;
  const strong: 1 | -1 = Math.abs(lane) > 0.3 ? (lane > 0 ? 1 : -1) : rng.next() < 0.5 ? 1 : -1;

  if (e.kind === 'kickoff') kickoff(cast, put, face, ballY);
  else if (e.kind === 'punt') punt(e, cast, put, face, ballX);
  else if (e.kind === 'fg' || e.kind === 'xp') fieldGoal(cast, put, face);
  else {
    scrimmage(e, cast, off, def, put, face, strong);
    coverTheTarget(e, cast, spots);
    tacklerNear(e, cast, spots, ballY, dir);
  }
  return spots;
}

/**
 * The engine names the man who covered the target, so the target lines up across from him. Defenders keep their
 * sides (a left corner stays the left corner); the receiver trades spots with whichever receiver the formation put
 * nearest that defender, as receivers swap sides between formations.
 */
function coverTheTarget(e: PlayLogEntry, cast: Cast, spots: Map<number, Pt>) {
  const who = actorsIn(e);
  const cover = who.cover === undefined ? undefined : spots.get(who.cover);
  const target = who.ball;
  if (!cover || target === undefined || !spots.has(target)) return;
  const receivers = cast.offense.filter((m) => m.role === 'WR' || m.role === 'TE' || m.role === 'RB');
  let over: number | undefined;
  let gap = Infinity;
  for (const m of receivers) {
    const d = Math.abs(spots.get(m.id)!.y - cover.y);
    if (d < gap) [gap, over] = [d, m.id];
  }
  if (over === undefined || over === target) return;
  const a = spots.get(target)!;
  spots.set(target, spots.get(over)!);
  spots.set(over, a);
}

/** How far across the field a play goes, at full lane (`buildPath`: the lane times this, from the snap). */
const LANE_YARDS = 16;

/** Who can trade spots with whom: the defensive backs among themselves, the linebackers, the line. */
const GROUP: Partial<Record<string, string>> = { CB: 'DB', S: 'DB', LB: 'LB', DT: 'DL', EDGE: 'DL' };

/**
 * The man the engine says made the tackle lines up where he can: in the spot of whoever in his group (the defensive
 * backs, the linebackers, the line) the formation put nearest where the play ends, so he isn't running down a play on
 * the far side of the field. The man in coverage keeps his spot.
 */
function tacklerNear(e: PlayLogEntry, cast: Cast, spots: Map<number, Pt>, ballY: number, dir: 1 | -1) {
  const who = actorsIn(e);
  const tackler = who.tackle;
  // The man in coverage who made the tackle lines up over his receiver (`coverTheTarget`).
  if (tackler === undefined || tackler === who.cover || e.to === undefined || !spots.has(tackler)) return;
  const group = GROUP[cast.defense.find((m) => m.id === tackler)?.role ?? ''];
  if (!group) return;
  const end = { x: e.to, y: ballY + dir * (e.lane ?? 0) * LANE_YARDS };
  const far = (id: number) => Math.hypot(spots.get(id)!.x - end.x, spots.get(id)!.y - end.y);
  // The ends and the outside corners keep their sides (play after play, as on Sundays): they trade only on their own.
  const fixed = (m: Cast['defense'][number]) => m.role === 'EDGE' || (m.role === 'CB' && m.slot <= 1);
  const sideOf = (id: number) => Math.sign(spots.get(id)!.y - ballY);
  const me = cast.defense.find((m) => m.id === tackler)!;
  let best = tackler;
  for (const m of cast.defense) {
    if (GROUP[m.role] !== group || m.id === who.cover || far(m.id) >= far(best)) continue;
    if ((fixed(m) || fixed(me)) && sideOf(m.id) !== sideOf(tackler)) continue;
    best = m.id;
  }
  if (best === tackler) return;
  const a = spots.get(tackler)!;
  spots.set(tackler, spots.get(best)!);
  spots.set(best, a);
}

type Put = (id: number, back: number, across: number) => void;

function scrimmage(e: PlayLogEntry, cast: Cast, off: FieldScheme, def: FieldScheme, put: Put, face: Put, s: 1 | -1) {
  const o = cast.offense;
  spread(5, 2).forEach((across, i) => {
    const m = of(o, 'OL')[i];
    if (m) put(m.id, 0.8, across);
  });
  const gun = !underCenter(e) || off.personnel === '10';
  for (const m of of(o, 'QB')) put(m.id, gun ? 5 : 2, 0);
  for (const m of of(o, 'RB')) put(m.id, gun ? 5 : 6.5, gun ? -s * 1.5 : 0);

  // Tight ends on the line, the first on the strong side; receivers split wide, slots inside them on the side with fewer.
  const tes = of(o, 'TE');
  tes.forEach((m, i) => put(m.id, 0.8, (i % 2 === 0 ? s : -s) * (6 + Math.floor(i / 2) * 1.5)));
  const wrs = of(o, 'WR');
  const outside: number[] = [];
  const count = { [s]: tes.filter((_, i) => i % 2 === 0).length, [-s]: tes.filter((_, i) => i % 2 === 1).length };
  wrs.forEach((m, i) => {
    let across: number;
    if (i < 2) across = (i === 0 ? s : -s) * 20;
    else {
      const side: 1 | -1 = count[s] <= count[-s] ? s : (-s as 1 | -1);
      const already = wrs.slice(2, i).filter((_, k) => k % 2 === (i - 2) % 2).length;
      across = side * (10 + already * 3.5);
    }
    count[Math.sign(across)] = (count[Math.sign(across)] ?? 0) + 1;
    outside.push(across);
    put(m.id, 1, across);
  });

  const d = cast.defense;
  const cov = def.coverage ? COVERAGES[def.coverage] : null;
  const man = !!cov?.man;
  const twoHigh = cov?.twoHigh ?? true;
  const dts = of(d, 'DT');
  spread(dts.length, 3).forEach((across, i) => face(dts[i].id, 1, across));
  const edgeWidth = def.front === 'wide9' ? 7.5 : 5.5;
  // Fixed sides, never flipped by the offense's strength: the first end lines up over the left tackle (he's the one
  // the engine charges him against), the second over the right.
  of(d, 'EDGE').forEach((m, i) => face(m.id, 1, (i % 2 === 0 ? -1 : 1) * (edgeWidth + Math.floor(i / 2) * 2)));
  const lbs = of(d, 'LB');
  const lbSpots = lbs.length === 1 ? [0] : lbs.length === 2 ? [-2.5, 2.5] : spread(lbs.length, 4);
  lbs.forEach((m, i) => face(m.id, 4.5, lbSpots[i]));
  // Corners over the widest receiver each side, a third over a slot.
  const widest = [Math.min(...outside, -12), Math.max(...outside, 12)];
  const slot = outside.find((a) => Math.abs(a) < 15) ?? s * 10;
  of(d, 'CB').forEach((m, i) => {
    if (i < 2) face(m.id, man ? 1 : 6, widest[i]);
    else face(m.id, 5, slot + (i - 2) * 2);
  });
  of(d, 'S').forEach((m, i) => {
    if (twoHigh) face(m.id, 12, (i === 0 ? -1 : 1) * 9);
    else face(m.id, i === 0 ? 13 : 6, i === 0 ? 0 : s * 4);
  });
}

/**
 * Today's kickoff (the NFL's from 2024, which the engine plays: touchbacks to the 35, a short kick out at the 40). The
 * kicker alone behind the ball; his ten a yard short of the receiving 40, five each side; the receiving side's setup
 * zone, its 35 to its 30, with seven on the front line; up to two returners deep in the landing zone. Nobody but the
 * kicker and the returners moves until the ball comes down (`steer.ts`).
 */
function kickoff(cast: Cast, put: Put, face: Put, ballY: number) {
  // Across is from the kicking side's view; the ball sits in the middle of the field.
  const k = cast.offense.find((m) => m.role === 'K');
  const cover = cast.offense.filter((m) => m !== k);
  if (k) put(k.id, 7, 0);
  const lanes = [4, 9, 14, 19, 23];
  cover.forEach((m, i) => face(m.id, 24, (i % 2 === 0 ? -1 : 1) * lanes[Math.floor(i / 2) % 5] + (MID - ballY)));
  const ret = cast.defense.find((m) => m.role === 'RET');
  const rest = cast.defense.filter((m) => m !== ret);
  if (ret) face(ret.id, 60, -3);
  const front = rest.slice(0, 7);
  const back = rest.slice(7, 9);
  spread(front.length, 6).forEach((a, i) => face(front[i].id, 30, a));
  back.forEach((m, i) => face(m.id, 34, (i === 0 ? -1 : 1) * 8));
  // The second returner, beside the first.
  rest.slice(9).forEach((m, i) => face(m.id, 57, 6 + i * 4));
}

/**
 * The spread punt: a line of five with wide splits, a wing angled back off each end, a gunner split wide on each side,
 * the personal protector (the "upback" every NFL punt team has: he calls the protection and picks up a free rusher)
 * and the punter fifteen yards deep. The return team: six on the line, a pair of jammers on each gunner, the returner.
 */
function punt(e: PlayLogEntry, cast: Cast, put: Put, face: Put, ballX: number) {
  const p = cast.offense.find((m) => m.role === 'P');
  const rest = cast.offense.filter((m) => m !== p);
  if (p) put(p.id, 14, 0);
  const line = [-3.4, -1.7, 0, 1.7, 3.4];
  rest.forEach((m, i) => {
    if (i < 5) put(m.id, 0.8, line[i]);
    else if (i < 7) put(m.id, 1.7, (i === 5 ? -1 : 1) * 4.9);
    else if (i < 9) put(m.id, 1, (i === 7 ? -1 : 1) * GUNNER);
    else put(m.id, 6, 0.8);
  });
  const ret = cast.defense.find((m) => m.role === 'RET');
  const def = cast.defense.filter((m) => m !== ret);
  const land = e.air !== undefined ? Math.abs(e.air - ballX) : 40;
  if (ret) face(ret.id, Math.max(25, Math.min(60, land)), 0);
  const front = [-5, -3, -1, 1, 3, 5];
  // The vise: one jammer inside each gunner, one outside.
  const vise = [-GUNNER + 1.6, GUNNER - 1.6, -GUNNER - 1.6, GUNNER + 1.6];
  def.forEach((m, i) => {
    if (i < 6) face(m.id, 1, front[i] + 0.5);
    else face(m.id, 1.6, vise[(i - 6) % 4]);
  });
}

/**
 * Field goals and extra points: the protection shoulder to shoulder, its ends' wings angled back (the line bends
 * round the holder), the holder seven yards deep and the kicker off his hip. The block unit: ten on the line, five
 * each side of the snapper and the widest off the edge, and one man back for a fake or a short miss.
 */
function fieldGoal(cast: Cast, put: Put, face: Put) {
  const k = cast.offense.find((m) => m.role === 'K');
  const holder = cast.offense.find((m) => m.role === 'P');
  const line = cast.offense.filter((m) => m !== k && m !== holder);
  if (holder) put(holder.id, 7, 0);
  if (k) put(k.id, 9.5, -1.5);
  line.forEach((m, i) => {
    if (i < 7) put(m.id, 0.8, (i - 3) * 1.45);
    else put(m.id, 1.8, (i === 7 ? -1 : 1) * 5.6);
  });
  const d = cast.defense;
  const rush = [1, 2.45, 3.9, 5.35, 7];
  d.forEach((m, i) => {
    if (i < 10) face(m.id, 1, (i % 2 === 0 ? -1 : 1) * rush[Math.floor(i / 2)]);
    else face(m.id, 9, 0);
  });
}
