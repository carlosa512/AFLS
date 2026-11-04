/**
 * A spatial play's replay (spec §4): the approach staged again from the log, then the open field's own frames, re-run
 * from the game's snapshot on the play's stream, the same every time. A lost fumble, or a play the snapshot can't
 * start, is staged as drawn; so is a game played on another version of the field (`FIELD_VERSION`).
 */
import { Rng } from '../rng';
import type { FieldRecord, PlayLogEntry } from '../types';
import { approach, fieldStart } from './approach';
import { composePocket, pocketFrom, pocketMomentOf, pocketStage, scrambleStart } from './pocketMoment';
import { moveDuration } from './contest';
import { momentOf } from './moment';
import { runField } from './run';
import { skillsAt } from './snapshot';
import { asRan, type StagedPlay } from './stage';
import type { FieldResult } from './types';
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
  const skillsOf = (id: number) => skillsAt(snap, id, index);
  // A dropback the pocket played: the pocket from the snap, composed into the staging the open field (if any) starts from.
  const pm = e.field.pk ? pocketMomentOf(plays[index], record, index) : null;
  let composed: StagedPlay | undefined;
  let pocket: ReturnType<typeof pocketFrom> = null;
  if (pm) {
    const staged = pocketStage(pm, record, homeId, snap.seed);
    pocket = staged && pocketFrom(pm, staged, skillsOf, snap.seed);
    if (!staged || !pocket) return null;
    composed = composePocket(staged, pocket);
  }
  let a: { staged: StagedPlay; k0: number; t0: number; carrier: number } | null = null;
  let result: FieldResult | null = null;
  if (pm && pocket && composed && pm.kind === 'scramble') {
    const start = scrambleStart(composed, pocket, pm, skillsOf);
    if (start) {
      result = runField(start, new Rng(`${snap.seed}:field:${index}`));
      a = { staged: composed, k0: pocket.result.breakout!, t0: start.t0, carrier: start.carrier };
    }
  } else {
    const m = momentOf(plays[index], record, index, homeId);
    const ap = m && (m.facts.to !== undefined || !pm) ? approach(m, record, homeId, snap.seed, composed) : null;
    const start = ap && m ? fieldStart(ap, m, skillsOf, new Rng(`${snap.seed}:field:${index}:hold`)) : null;
    if (ap && start) {
      result = runField(start, new Rng(`${snap.seed}:field:${index}`));
      a = ap;
    }
  }
  // The pocket alone (a sack, an incompletion, a throwaway, a catch the field didn't run on): its frames from the snap.
  if (!a || !result)
    return composed && pocket
      ? { ...composed, spatial: { k0: 0, tackler: null, moved: pocket.start.players.map((p) => p.id) } }
      : null;

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
