/**
 * A spatial play's replay (spec §4): the approach staged again from the log, then the open field's own frames, re-run
 * from the game's snapshot on the play's stream, the same every time. A lost fumble, or a play the snapshot can't
 * start, is staged as drawn; so is a game played on another version of the field (`FIELD_VERSION`).
 */
import { Rng } from '../rng';
import type { FieldRecord, PlayLogEntry } from '../types';
import { approach, fieldStart } from './approach';
import { moveDuration } from './contest';
import { momentOf } from './moment';
import { runField } from './run';
import { skillsAt } from './snapshot';
import { asRan, type StagedPlay } from './stage';
import { FIELD_VERSION, STEP } from './tuning';

export function stageField(args: {
  plays: readonly PlayLogEntry[];
  index: number;
  record: FieldRecord;
  homeId: number;
}): StagedPlay | null {
  const { plays, index, record, homeId } = args;
  const snap = record.snap;
  const e = asRan(plays[index]);
  // A lost fumble after a carry is drawn (the field played the carry, not the return); a strip-sack's is the field's.
  if (!snap || snap.v !== FIELD_VERSION || !e.field || (e.loose !== undefined && e.kind !== 'sack')) return null;
  const m = momentOf(plays[index], record, index, homeId);
  if (!m) return null;
  const a = approach(m, record, homeId, snap.seed);
  if (!a) return null;
  const start = fieldStart(a, m, (id) => skillsAt(snap, id, index), new Rng(`${snap.seed}:field:${index}:hold`));
  if (!start) return null;
  const result = runField(start, new Rng(`${snap.seed}:field:${index}`));

  const s = a.staged;
  const n = s.ids.length;
  const fieldSteps = result.frames.length / (n * 2);
  const steps = a.k0 + fieldSteps;
  const pos = new Float32Array(steps * n * 2);
  pos.set(s.pos.subarray(0, a.k0 * n * 2));
  pos.set(result.frames, a.k0 * n * 2);
  // The ball rides the carrier from possession on.
  const ball = new Float32Array(steps * 3);
  ball.set(s.ball.subarray(0, a.k0 * 3));
  const ck = s.ids.indexOf(a.carrier);
  for (let st = a.k0; st < steps; st++) ball.set([pos[(st * n + ck) * 2], pos[(st * n + ck) * 2 + 1], 0], st * 3);

  // Rings: the approach's men, then the tackler at the tackle and each man who missed at his miss.
  const keys = [...s.keys];
  const reveal = [...s.reveal];
  const until = [...s.until];
  const ring = (id: number, t: number, end: number) => {
    const i = keys.indexOf(id);
    if (i >= 0) {
      reveal[i] = Math.min(reveal[i], t);
      until[i] = Math.max(until[i], end);
    } else {
      keys.push(id);
      reveal.push(t);
      until.push(end);
    }
  };
  if (!keys.includes(a.carrier)) ring(a.carrier, a.t0, Infinity);
  for (const miss of result.misses) ring(miss.by, a.t0 + miss.t, a.t0 + miss.t + 1);
  if (result.tackler !== null) ring(result.tackler, a.t0 + result.duration, Infinity);
  const first = result.misses[0];
  const kind = first ? (first.move ?? (first.how === 'size' ? 'runThrough' : 'juke')) : undefined;

  return {
    ...s,
    steps,
    pos,
    ball,
    keys,
    reveal,
    until,
    carrier: a.carrier,
    kind: e.kind,
    ...(first && kind ? { move: { kind, t: a.t0 + first.t, dur: moveDuration(kind), by: first.by } } : {}),
    spatial: { k0: a.k0, tackler: result.tackler },
  };
}

/** Steps from possession to the whistle: the film's length past the approach. */
export const fieldSeconds = (p: StagedPlay) => (p.spatial ? (p.steps - p.spatial.k0) * STEP : 0);
