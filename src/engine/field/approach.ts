/**
 * The approach: the snap to the moment of possession, staged blind to the result. It's All-22's own staging (formations,
 * blocking by the call, routes, the pocket, coverage, the kick's flight) run on the moment alone (`momentEntry`), cut
 * where the carrier has the ball in space; then `fieldStart` reads the open field's start off its last frames.
 */
import { CALL_CHAR } from '../playActors';
import type { Rng } from '../rng';
import type { FieldRecord, PlayLogEntry } from '../types';
import { momentEntry, type FieldMoment } from './moment';
import { stagePlay, type StagedPlay } from './stage';
import { KNOBS, STEP } from './tuning';
import type { FieldPlayer, FieldSkills, FieldStart } from './types';

export interface Approach {
  /** The blind staging from the snap (its frames past `k0` are not the play's). */
  staged: StagedPlay;
  /** The step, and the time from the snap, the carrier has the ball in space. */
  k0: number;
  t0: number;
  carrier: number;
  /** The carrier's direction. */
  dir: 1 | -1;
  /** The field x his yards count from: the line of scrimmage, or a return's catch. */
  yardLine: number;
  /** The run's line blocks (blocker, defender), by the call. */
  lineBlocks: [number, number][];
}

/** A line block still on at possession: the two this close (yards). */
const STILL_ON = 2;
/** A man in front of a blocker and this close to him (yards) at possession is engaged with him. */
const ENGAGED = 1.2;
/** The second level a clean hole holds: free men this close to the back at possession (yards). */
const LATE_REACH = 12;
/** A lineman climbs to a linebacker this close (yards). */
const CLIMB_REACH = 7;
/** The spread of a line block's hold (seconds). */
const HOLD_SD = 0.25;

/** The record with this play's defensive call written in, as the log will write it. */
export function withCall(record: FieldRecord, m: Pick<FieldMoment, 'call' | 'index'>): FieldRecord {
  const ch = m.call === 'base' ? '.' : CALL_CHAR[m.call];
  const calls = (record.calls ?? '').padEnd(m.index + 1, '.');
  return { ...record, calls: calls.slice(0, m.index) + ch + calls.slice(m.index + 1) };
}

/**
 * `pocketStaged`: a dropback's staging with the pocket already composed into it (`composePocket`): the open field starts
 * from the pocket's frames rather than staging its own.
 */
export function approach(
  m: FieldMoment,
  record: FieldRecord,
  homeId: number,
  gameSeed: string,
  pocketStaged?: StagedPlay,
): Approach | null {
  const plays: PlayLogEntry[] = [];
  plays[m.index] = momentEntry(m, homeId);
  let staged: StagedPlay;
  if (pocketStaged) staged = pocketStaged;
  else
    try {
      staged = stagePlay({
        plays,
        index: m.index,
        record: withCall(record, m),
        homeId,
        seed: `${gameSeed}:field:${m.index}:approach`,
        snapY: m.facts.y,
        blind: true,
      });
    } catch {
      return null;
    }
  const n = staged.ids.length;
  const offense = staged.offense.filter(Boolean).length;
  if (offense < 11 || n - offense < 11) return null;
  const carrier =
    m.kind === 'return' ? staged.ids[staged.roles.indexOf('RET')] : m.kind === 'turnover' ? m.take : m.ball;
  const k = carrier === undefined ? -1 : staged.ids.indexOf(carrier);
  if (k < 0 || carrier === undefined) return null;
  if (m.kind !== 'return' && !staged.roles.includes('QB')) return null;
  const x = (st: number) => staged.pos[(st * n + k) * 2];
  let k0: number;
  if (m.kind === 'run') {
    // The first step past the line after the handoff.
    const from = Math.ceil(staged.release / STEP);
    k0 = -1;
    for (let st = Math.max(1, from); st < staged.steps; st++)
      if ((x(st) - m.from) * staged.dir > 0) {
        k0 = st;
        break;
      }
    if (k0 < 0) return null;
  } else if (m.lost === 'sack') {
    // A strip-sack's: the loose ball settles in his hands.
    if (!staged.loose || staged.loose.by !== carrier) return null;
    k0 = Math.min(staged.steps - 1, Math.round(staged.loose.settle / STEP));
  } else {
    if (staged.arrive === null) return null;
    k0 = Math.min(staged.steps - 1, Math.round(staged.arrive / STEP));
  }
  // A return, or a turnover, runs back the other way.
  const dir = m.kind === 'return' || m.kind === 'turnover' ? (-staged.dir as 1 | -1) : staged.dir;
  return {
    staged,
    k0,
    t0: k0 * STEP,
    carrier,
    dir,
    yardLine: m.kind === 'return' || m.kind === 'turnover' ? (m.air ?? x(k0)) : m.from,
    lineBlocks: staged.run?.on ?? [],
  };
}

/** The open field's start: everyone where the approach left him, moving as he was, with the blocks still on. */
export function fieldStart(
  a: Approach,
  m: FieldMoment,
  skillsOf: (id: number) => FieldSkills | undefined,
  hold: Rng,
): FieldStart | null {
  const { staged, k0 } = a;
  const n = staged.ids.length;
  const ck = staged.ids.indexOf(a.carrier);
  const ours = staged.offense[ck];
  const players: FieldPlayer[] = [];
  for (let k = 0; k < n; k++) {
    const id = staged.ids[k];
    const s = skillsOf(id);
    if (!s) return null;
    const x = staged.pos[(k0 * n + k) * 2];
    const y = staged.pos[(k0 * n + k) * 2 + 1];
    const px = staged.pos[((k0 - 1) * n + k) * 2];
    const py = staged.pos[((k0 - 1) * n + k) * 2 + 1];
    players.push({
      id,
      side: staged.offense[k] === ours ? 0 : 1,
      role: staged.roles[k],
      x,
      y,
      vx: (x - px) / STEP,
      vy: (y - py) / STEP,
      s,
    });
  }
  const at = new Map(players.map((p) => [p.id, p]));
  const blocks: FieldStart['blocks'] = [];
  const taken = new Set<number>();
  const z = m.facts.z ?? 0;
  // The line as the roll left it (spec §1): a clean hole keeps its blocks and holds them longer; a stuffed one has
  // front men already off theirs at the hole.
  const holds = (k = 1) => KNOBS.hold * Math.exp(KNOBS.line * z) * k;
  const sig = (x: number) => 1 / (1 + Math.exp(-x));
  const freed = new Set<number>();
  for (const [b, d] of a.lineBlocks) {
    // Every block's draws are taken, kept or not, so one block never shifts another's.
    const spread = hold.normal(0, HOLD_SD);
    const kept = hold.next() < sig(KNOBS.line * (z + 1));
    const pb = at.get(b);
    const pd = at.get(d);
    // Off his block at the hole: nobody picks him up again at possession.
    if (!kept && pd) freed.add(pd.id);
    if (!kept || !pb || !pd || pb.side !== 0 || pd.side !== 1 || taken.has(b) || taken.has(d)) continue;
    if (Math.hypot(pb.x - pd.x, pb.y - pd.y) > STILL_ON) continue;
    const preacher = pb.s.habits?.includes('pancakePreacher') ? 0.3 : 0;
    blocks.push({ blocker: b, defender: d, holdFor: Math.max(0, holds() + spread) + preacher });
    taken.add(b).add(d);
  }
  // On a clean roll a lineman gets up to the second level: a linebacker near him is walled off.
  if (m.kind === 'run')
    for (const lb of players.filter((p) => p.side === 1 && p.role === 'LB')) {
      const climbs = hold.next() < sig(KNOBS.line * (z - 1));
      if (!climbs || taken.has(lb.id)) continue;
      let ol: FieldPlayer | undefined;
      let od = CLIMB_REACH;
      for (const p of players)
        if (p.side === 0 && p.role === 'OL' && !taken.has(p.id)) {
          const g = Math.hypot(p.x - lb.x, p.y - lb.y);
          if (g < od) [ol, od] = [p, g];
        }
      if (!ol) continue;
      blocks.push({ blocker: ol.id, defender: lb.id, holdFor: holds(0.5) });
      taken.add(ol.id).add(lb.id);
    }
  // Anyone else locked up at possession: a defender in front of a blocker and on him. Not at a change of possession:
  // the men face to face then were the old offense's blocks (the pocket's), and they end as the ball changes hands.
  for (const pd of m.kind === 'turnover' ? [] : players) {
    if (pd.side !== 1 || taken.has(pd.id) || freed.has(pd.id)) continue;
    let best: FieldPlayer | undefined;
    let bd = ENGAGED;
    for (const pb of players) {
      if (pb.side !== 0 || pb.id === a.carrier || taken.has(pb.id)) continue;
      if ((pd.x - pb.x) * a.dir < 0) continue;
      const g = Math.hypot(pd.x - pb.x, pd.y - pb.y);
      if (g <= bd) [best, bd] = [pb, g];
    }
    if (best) {
      blocks.push({ blocker: best.id, defender: pd.id, holdFor: 0 });
      taken.add(best.id).add(pd.id);
    }
  }
  const carrier = at.get(a.carrier)!;
  // Credited short of the goal line he already stands on or past (a catch the blind staging made in the end zone): the
  // field could only put him back by a jump, so the play keeps today's film.
  if (m.facts.to !== undefined && !m.facts.td && (carrier.x - (a.dir === 1 ? 100 : 0)) * a.dir >= 0) return null;
  // On a clean roll the second level is a beat late to it: the first free man meets the back further past the line.
  const late: { id: number; until: number }[] = [];
  if (m.kind === 'run' && z > 0)
    for (const p of players)
      if (
        p.side === 1 &&
        (p.role === 'LB' || p.role === 'CB' || p.role === 'S') &&
        !taken.has(p.id) &&
        Math.hypot(p.x - carrier.x, p.y - carrier.y) <= LATE_REACH
      )
        late.push({ id: p.id, until: KNOBS.meet * z });
  return {
    kind: m.kind,
    ...(m.kick ? { kick: m.kick } : {}),
    t0: a.t0,
    dir: a.dir,
    yardLine: a.yardLine,
    carrier: a.carrier,
    players,
    blocks,
    clock: { outOfBounds: !!m.facts.out, stayIn: !!m.facts.stay },
    edge: m.facts.edge ?? 0,
    tired: !!m.facts.tired,
    ...(m.facts.to !== undefined
      ? {
          target: {
            x: a.yardLine + m.facts.to * a.dir,
            touchdown: !!m.facts.td,
            ...(m.facts.oob ? { out: true, ...(m.facts.oob === 2 ? { stepped: true } : {}) } : {}),
            ...(m.facts.ow ? { why: m.facts.ow } : {}),
          },
        }
      : {}),
    ...(late.length ? { late } : {}),
    ...(m.kind === 'run' && staged.run?.call === 'outsideZone'
      ? { stretch: (staged.dir * staged.run.side) as 1 | -1 }
      : {}),
  };
}
