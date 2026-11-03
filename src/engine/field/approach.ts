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
/** The spread of a line block's hold (seconds). */
const HOLD_SD = 0.25;

/** The record with this play's defensive call written in, as the log will write it. */
function withCall(record: FieldRecord, m: FieldMoment): FieldRecord {
  const ch = m.call === 'base' ? '.' : CALL_CHAR[m.call];
  const calls = (record.calls ?? '').padEnd(m.index + 1, '.');
  return { ...record, calls: calls.slice(0, m.index) + ch + calls.slice(m.index + 1) };
}

export function approach(m: FieldMoment, record: FieldRecord, homeId: number, gameSeed: string): Approach | null {
  const plays: PlayLogEntry[] = [];
  plays[m.index] = momentEntry(m, homeId);
  let staged: StagedPlay;
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
  const carrier = m.kind === 'return' ? staged.ids[staged.roles.indexOf('RET')] : m.ball;
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
  } else {
    if (staged.arrive === null) return null;
    k0 = Math.min(staged.steps - 1, Math.round(staged.arrive / STEP));
  }
  const dir = m.kind === 'return' ? (-staged.dir as 1 | -1) : staged.dir;
  return {
    staged,
    k0,
    t0: k0 * STEP,
    carrier,
    dir,
    yardLine: m.kind === 'return' ? (m.air ?? x(k0)) : m.from,
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
  for (const [b, d] of a.lineBlocks) {
    // Every hold is drawn, kept or not, so one block never shifts another's.
    const spread = hold.normal(0, HOLD_SD);
    const pb = at.get(b);
    const pd = at.get(d);
    if (!pb || !pd || pb.side !== 0 || pd.side !== 1 || taken.has(b) || taken.has(d)) continue;
    if (Math.hypot(pb.x - pd.x, pb.y - pd.y) > STILL_ON) continue;
    const preacher = pb.s.habits?.includes('pancakePreacher') ? 0.3 : 0;
    blocks.push({ blocker: b, defender: d, holdFor: Math.max(0, KNOBS.hold * (1 + 0.5 * z) + spread) + preacher });
    taken.add(b).add(d);
  }
  // Anyone else locked up at possession: a defender in front of a blocker and on him.
  for (const pd of players) {
    if (pd.side !== 1 || taken.has(pd.id)) continue;
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
  return {
    kind: m.kind,
    t0: a.t0,
    dir: a.dir,
    yardLine: a.yardLine,
    carrier: a.carrier,
    players,
    blocks,
    clock: { outOfBounds: !!m.facts.out, stayIn: !!m.facts.stay },
    edge: m.facts.edge ?? 0,
    tired: !!m.facts.tired,
  };
}
