/**
 * Where everyone lines up before the snap. Spots are (back, across) from the ball for the offense and (depth, across)
 * for the defense, in yards; `dir` is 1 when the offense attacks toward x = 100, and "across" is from the offense's
 * view, so its right hand is +dir in y (as `buildPath` reads a play's lane).
 */
import type { Rng } from '../../engine/rng';
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

const of = (side: CastMember[], role: Role) => side.filter((m) => m.role === role);

/** `n` spots `gap` yards apart, centred on 0. */
const spread = (n: number, gap: number) => Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * gap);

/** Under center on early downs at a normal distance, outside either two-minute window; the shotgun otherwise. */
function underCenter(e: PlayLogEntry): boolean {
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
    spots.set(id, { x, y: Math.max(EDGE, Math.min(FIELD_W - EDGE, ballY + dir * (across + jit()))) });
  const put: Put = (id, back, across) => place(id, ballX - dir * Math.max(0.5, back + jit() * 0.5), across);
  const face: Put = (id, depth, across) => place(id, ballX + dir * Math.max(0.6, depth + jit() * 0.5), across);

  const lane = e.lane ?? 0;
  const strong: 1 | -1 = Math.abs(lane) > 0.3 ? (lane > 0 ? 1 : -1) : rng.next() < 0.5 ? 1 : -1;

  if (e.kind === 'kickoff') kickoff(cast, put, face, ballY);
  else if (e.kind === 'punt') punt(e, cast, put, face, ballX);
  else if (e.kind === 'fg' || e.kind === 'xp') fieldGoal(cast, put, face);
  else scrimmage(e, cast, off, def, put, face, strong);
  return spots;
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
  of(d, 'EDGE').forEach((m, i) => face(m.id, 1, (i % 2 === 0 ? -s : s) * (edgeWidth + Math.floor(i / 2) * 2)));
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

function kickoff(cast: Cast, put: Put, face: Put, ballY: number) {
  // Across is from the kicking side's view; the field is 53 wide and the ball sits in the middle.
  const room = (n: number) => spread(n, Math.min(4.6, (FIELD_W - 2 * EDGE - 2) / Math.max(1, n - 1)));
  const k = cast.offense.find((m) => m.role === 'K');
  const cover = cast.offense.filter((m) => m !== k);
  if (k) put(k.id, 7, 0);
  room(cover.length).forEach((a, i) => put(cover[i].id, 1, a + (MID - ballY)));
  const ret = cast.defense.find((m) => m.role === 'RET');
  const rest = cast.defense.filter((m) => m !== ret);
  if (ret) face(ret.id, 60, 0);
  const front = rest.slice(0, 5);
  const back = rest.slice(5);
  room(front.length).forEach((a, i) => face(front[i].id, 12, a));
  room(back.length).forEach((a, i) => face(back[i].id, 25, a * 0.8));
}

function punt(e: PlayLogEntry, cast: Cast, put: Put, face: Put, ballX: number) {
  const p = cast.offense.find((m) => m.role === 'P');
  const rest = cast.offense.filter((m) => m !== p);
  if (p) put(p.id, 13, 0);
  // A line of seven, two gunners split wide, a personal protector in front of the punter.
  const line = [-6, -4, -2, 0, 2, 4, 6];
  rest.forEach((m, i) => {
    if (i < 7) put(m.id, 0.8, line[i]);
    else if (i < 9) put(m.id, 1, (i === 7 ? -1 : 1) * 20);
    else put(m.id, 5, 0);
  });
  const ret = cast.defense.find((m) => m.role === 'RET');
  const def = cast.defense.filter((m) => m !== ret);
  const land = e.air !== undefined ? Math.abs(e.air - ballX) : 40;
  if (ret) face(ret.id, Math.max(25, Math.min(60, land)), 0);
  def.forEach((m, i) => {
    if (i < 7) face(m.id, 1, line[i] + 0.5);
    else if (i < 9) face(m.id, 1.5, (i === 7 ? -1 : 1) * 18);
    else face(m.id, 8, 0);
  });
}

function fieldGoal(cast: Cast, put: Put, face: Put) {
  const k = cast.offense.find((m) => m.role === 'K');
  const holder = cast.offense.find((m) => m.role === 'P');
  const line = cast.offense.filter((m) => m !== k && m !== holder);
  if (holder) put(holder.id, 7, 0);
  if (k) put(k.id, 9.5, -1.5);
  spread(line.length, 1.8).forEach((a, i) => put(line[i].id, 0.8, a));
  const d = cast.defense;
  spread(Math.min(d.length, 8), 1.8).forEach((a, i) => face(d[i].id, 1, a + 0.4));
  d.slice(8).forEach((m, i) => face(m.id, 6, (i - 1) * 6));
}
