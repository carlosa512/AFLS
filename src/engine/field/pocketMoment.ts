/**
 * The pocket's moment (spec §1, §3): a dropback as the pocket reads it, blind to who got home; its staging (the stager's,
 * from the snap); the pocket's start read off that staging; and its frames composed back into the staged play, for the
 * replay and for the open field that follows a catch, a pick or a scramble.
 */
import type { DefenseCall } from '../match/coach';
import { actorsIn, defenseCallAt, packActors } from '../playActors';
import { clamp, Rng } from '../rng';
import { FIELD_W } from './geometry';
import type { FieldRecord, PlayLogEntry } from '../types';
import { withCall } from './approach';
import type { FieldFacts } from './moment';
import { SCRAMBLE_OPEN, SCRAMBLE_PRESSURED } from './pocket';
import { runPocket, type PocketOutcome, type PocketResult, type PocketStart } from './pocketField';
import { asRan, stagePlay, type StagedPlay } from './stage';
import { BRAKE, KNOBS, STEP } from './tuning';
import type { FieldPlayer, FieldSkills, FieldStart } from './types';

type DropKind = 'pass' | 'incomplete' | 'int' | 'sack' | 'scramble';
const DROPS: ReadonlySet<string> = new Set<DropKind>(['pass', 'incomplete', 'int', 'sack', 'scramble']);

export interface PocketMoment {
  index: number;
  offense: number;
  quarter: number;
  clock: number;
  down: number;
  distance: number;
  yardLine: number;
  kind: DropKind;
  /** Field x of the snap; a throw's air; a sack's spot. */
  from: number;
  air?: number;
  to?: number;
  lane: number;
  /** The target, the man on him and a pick's interceptor: the routes need them; the rush is the pocket's own. */
  ball?: number;
  cover?: number;
  take?: number;
  call: DefenseCall;
  shot?: 1;
  facts: FieldFacts;
}

/** A sack's pocket runs this far past the sack, a throwaway's past the throw, a scramble's past the break (seconds). */
/** After his moment: a sack's fall, a throwaway's rush braking to a stop (a second from flat out), a run's start. */
const AFTER = { sack: 0.6, away: 1, run: 1 };
/** A throwaway leaves his hand later than a throw: he gives up on the play only once it's dead (NFL 4.3 s to a throw's
 * 2.6, FTN and NGS 2023–25). */
const AWAY_HOLD = 1.2;
/** A grounded ball's flight, in steps (half a second). */
const GROUNDED_FLIGHT = 10;
/** Thrown away from any of its shapes. */
const AWAY: readonly PocketOutcome[] = ['away', 'awayClean', 'awayOut'];

/** The blind dropback: the play to the snap and the routes, nobody named for the rush. */
export function pocketEntry(m: PocketMoment): PlayLogEntry {
  const who = packActors({ ball: m.ball, cover: m.cover, take: m.take });
  const away =
    m.facts.pk === 'awayOut'
      ? 'rolls out and throws it away'
      : m.facts.pk && AWAY.includes(m.facts.pk)
        ? 'throws it away'
        : '';
  return {
    quarter: m.quarter,
    clock: m.clock,
    offense: m.offense,
    down: m.down,
    distance: m.distance,
    yardLine: m.yardLine,
    text: `${m.shot ? 'Designed shot: ' : ''}${away}`,
    homeScore: 0,
    awayScore: 0,
    kind: m.kind,
    from: m.from,
    ...(m.air !== undefined ? { air: m.air } : {}),
    to: m.kind === 'sack' ? (m.to ?? m.from) : m.kind === 'scramble' ? m.from : (m.air ?? m.from),
    lane: m.lane,
    ...(who ? { who } : {}),
  };
}

/** The moment a logged dropback was played from (a flagged snap's as it ran), or null for one the pocket didn't play. */
export function pocketMomentOf(e0: PlayLogEntry, record: FieldRecord, index: number): PocketMoment | null {
  // A flagged snap: the play as it ran.
  const e = asRan(e0);
  const facts = e.field;
  if (!facts?.pk || !e.kind || !DROPS.has(e.kind) || e.from === undefined) return null;
  const kind = e.kind as DropKind;
  const who = actorsIn(e);
  const m: PocketMoment = {
    index,
    offense: e.offense,
    quarter: e.quarter,
    clock: e.clock,
    down: e.down,
    distance: e.distance,
    yardLine: e.yardLine,
    kind,
    from: e.from,
    lane: e.lane ?? 0,
    call: defenseCallAt(record, index),
    facts,
  };
  if (e.air !== undefined && kind !== 'sack' && kind !== 'scramble') m.air = e.air;
  if (kind === 'sack' && e.to !== undefined) m.to = e.to;
  if (kind !== 'sack' && kind !== 'scramble') {
    if (who.ball !== undefined) m.ball = who.ball;
    if (who.cover !== undefined) m.cover = who.cover;
  }
  if (kind === 'int' && who.take !== undefined) m.take = who.take;
  if (/^Designed shot:/.test(e.text)) m.shot = 1;
  return m;
}

/** The dropback staged blind from the snap (the stager's: formations, the drop, the routes), or null. */
export function pocketStage(m: PocketMoment, record: FieldRecord, homeId: number, gameSeed: string): StagedPlay | null {
  const plays: PlayLogEntry[] = [];
  plays[m.index] = pocketEntry(m);
  try {
    const staged = stagePlay({
      plays,
      index: m.index,
      record: withCall(record, m),
      homeId,
      seed: `${gameSeed}:field:${m.index}:approach`,
      snapY: m.facts.y,
      blind: true,
    });
    return staged.pocket ? staged : null;
  } catch {
    return null;
  }
}

/** Who the pocket moves: the quarterback, his blockers and the rush; null on a screen or without five linemen. */
export function pocketCast(
  staged: StagedPlay,
  m: Pick<PocketMoment, 'air' | 'from' | 'ball' | 'take'>,
): { qb: number; blockers: number[]; rushers: number[] } | null {
  if (m.air !== undefined && (m.air - m.from) * staged.dir < 0) return null;
  const ofRole = (role: string, offense: boolean) =>
    staged.ids.filter((_, k) => staged.roles[k] === role && staged.offense[k] === offense);
  const qb = ofRole('QB', true)[0];
  const ol = ofRole('OL', true);
  if (qb === undefined || ol.length < 5) return null;
  const blitz = staged.call === 'blitz' && staged.blitz.length > 0;
  // The target and an interceptor run their routes (the play is about them), never the pocket.
  const back = blitz ? ofRole('RB', true).slice(0, 1) : [];
  const front = [...ofRole('DT', false), ...ofRole('EDGE', false)];
  const rushers = [...new Set([...front, ...staged.blitz])].filter((id) => id !== m.take);
  return { qb, blockers: [...ol, ...back].filter((id) => id !== m.ball), rushers };
}

/** The pocket's start off the staging at the snap, and the pocket played on the play's own stream; null if it can't. */
export function pocketFrom(
  m: PocketMoment,
  staged: StagedPlay,
  skillsOf: (id: number) => FieldSkills | undefined,
  gameSeed: string,
): { start: PocketStart; result: PocketResult } | null {
  const cast = pocketCast(staged, m);
  const plan = staged.pocket;
  const outcome = m.facts.pk;
  if (!cast || !plan || !outcome) return null;
  // The protection's call on its own stream: the slide's side.
  const side = new Rng(`${gameSeed}:field:${m.index}:slide`).next() < 0.5 ? -1 : 1;
  const straight = staged.call !== 'blitz';
  const ofRole = (role: string, offense: boolean) =>
    staged.ids.filter(
      (id, k) => staged.roles[k] === role && staged.offense[k] === offense && id !== m.ball && id !== m.take,
    );
  const yOf = (id: number) => staged.pos[staged.ids.indexOf(id) * 2 + 1];
  const qbY = yOf(cast.qb);
  const nearest = (ids: number[]) =>
    ids.reduce<number | undefined>(
      (b, id) => (b === undefined || Math.abs(yOf(id) - qbY) < Math.abs(yOf(b) - qbY) ? id : b),
      undefined,
    );
  // A back may stay in to chip; today's credit on a back or tight end keeps one in, and on a linebacker or a defensive
  // back sends one (late, on a straight rush) when the play has none coming.
  const { rg, bs, bb } = m.facts;
  const roleOf = (id: number) => staged.roles[staged.ids.indexOf(id)];
  const keptIn = (ids: number[]) => ids.filter((id) => !cast.blockers.includes(id));
  // Today's charged man a back or tight end on the field the pocket hadn't kept in (a tight end chipping an edge,
  // today's 12%): he stays in, so the man charged is the man who lost. The chip's draw is taken either way.
  const chipDraw = new Rng(`${gameSeed}:field:${m.index}:chip`).next();
  const charged =
    bb !== undefined &&
    !cast.blockers.includes(bb) &&
    bb !== m.ball &&
    bb !== m.take &&
    staged.offense[staged.ids.indexOf(bb)] &&
    (roleOf(bb) === 'RB' || roleOf(bb) === 'TE')
      ? bb
      : undefined;
  let chip = charged ?? (straight && chipDraw < KNOBS.chip ? nearest(keptIn(ofRole('RB', true))) : undefined);
  if (bs === 'b' && chip === undefined && cast.blockers.every((id) => roleOf(id) === 'OL'))
    chip = nearest(keptIn(ofRole('RB', true))) ?? nearest(keptIn(ofRole('TE', true)));
  if (chip !== undefined) cast.blockers.push(chip);
  const groupRoles = rg === 'l' ? ['LB'] : rg === 'd' ? ['S', 'CB'] : rg === 'e' ? ['EDGE'] : rg === 'i' ? ['DT'] : [];
  let late: number | undefined;
  if ((rg === 'l' || rg === 'd') && !cast.rushers.some((id) => groupRoles.includes(roleOf(id))))
    late = nearest(groupRoles.flatMap((r) => ofRole(r, false)).filter((id) => !cast.rushers.includes(id)));
  if (late !== undefined) cast.rushers.push(late);
  // The anchor: today's group may get home, today's spot may lose him (across the line by where they stand: the ends
  // are the tackles, then the guards, the middle man the center).
  const line = cast.blockers.filter((id) => roleOf(id) === 'OL').sort((a, b) => yOf(a) - yOf(b));
  const spot = (id: number) => {
    const k = line.indexOf(id);
    if (k < 0) return 'b';
    return k === 0 || k === line.length - 1 ? 't' : k === 1 || k === line.length - 2 ? 'g' : 'c';
  };
  const want: PocketStart['want'] = {
    ...(rg ? { rushers: cast.rushers.filter((id) => groupRoles.includes(roleOf(id))) } : {}),
    ...(bb !== undefined && cast.blockers.includes(bb)
      ? { blockers: [bb] }
      : bs
        ? { blockers: cast.blockers.filter((id) => spot(id) === bs) }
        : {}),
  };
  const players: FieldPlayer[] = [];
  for (const id of [cast.qb, ...cast.blockers, ...cast.rushers]) {
    const k = staged.ids.indexOf(id);
    const s = skillsOf(id);
    if (k < 0 || !s) return null;
    players.push({
      id,
      side: staged.offense[k] ? 0 : 1,
      role: staged.roles[k],
      x: staged.pos[k * 2],
      y: staged.pos[k * 2 + 1],
      vx: 0,
      vy: 0,
      s,
    });
  }
  const rng = new Rng(`${gameSeed}:field:${m.index}:pocket`);
  const runs = outcome === 'scramble' || outcome === 'escape';
  const [lo, hi] = outcome === 'scramble' ? SCRAMBLE_PRESSURED : SCRAMBLE_OPEN;
  const throwAt = runs ? rng.float(lo, hi) : plan.throwAt + (AWAY.includes(outcome) ? AWAY_HOLD : 0);
  const blamed = !m.facts.nb;
  const end =
    outcome === 'sack'
      ? throwAt + AFTER.sack
      : AWAY.includes(outcome)
        ? throwAt + AFTER.away
        : runs
          ? throwAt + AFTER.run
          : Math.max(throwAt + STEP, staged.arrive ?? throwAt + 0.5);
  const start: PocketStart = {
    dir: staged.dir,
    los: m.from,
    qb: cast.qb,
    players,
    blockers: cast.blockers,
    rushers: cast.rushers,
    outcome,
    blamed,
    blitz: staged.call === 'blitz',
    slide: side,
    ...(chip !== undefined ? { chip } : {}),
    ...(late !== undefined ? { delayed: [late] } : {}),
    ...(rg || bs ? { want } : {}),
    setDepth: plan.setDepth,
    throwAt,
    end,
    ...(m.facts.gr ? { grounded: true } : {}),
    ...(m.facts.cq ? { clean: true } : {}),
    ...(m.kind === 'sack' && m.to !== undefined ? { sackX: m.to } : {}),
  };
  return { start, result: runPocket(start, rng) };
}

/**
 * The staged play with the pocket's men on the pocket's frames from the snap (held where it left them after), and the
 * ball in the quarterback's hands until the throw, then flying from where he is to where the staging caught it.
 */
export function composePocket(staged: StagedPlay, pocket: { start: PocketStart; result: PocketResult }): StagedPlay {
  const n = staged.ids.length;
  const pn = pocket.start.players.length;
  const pSteps = pocket.result.frames.length / (pn * 2);
  const steps = Math.max(staged.steps, pSteps);
  const pos = new Float32Array(steps * n * 2);
  const ball = new Float32Array(steps * 3);
  for (let s = 0; s < steps; s++) {
    const from = Math.min(s, staged.steps - 1);
    pos.set(staged.pos.subarray(from * n * 2, (from + 1) * n * 2), s * n * 2);
    ball.set(staged.ball.subarray(from * 3, from * 3 + 3), s * 3);
  }
  // The pocket can outlast the drawn routes (a throwaway's hold): a man the pocket doesn't move coasts on from his last
  // drawn step, braking as a body does, rather than stopping dead where his route ended.
  const last = staged.steps - 1;
  if (steps > staged.steps && last >= 1)
    for (let k = 0; k < n; k++) {
      let vx = (staged.pos[(last * n + k) * 2] - staged.pos[((last - 1) * n + k) * 2]) / STEP;
      let vy = (staged.pos[(last * n + k) * 2 + 1] - staged.pos[((last - 1) * n + k) * 2 + 1]) / STEP;
      let x = staged.pos[(last * n + k) * 2];
      let y = staged.pos[(last * n + k) * 2 + 1];
      for (let s = staged.steps; s < steps; s++) {
        const sp = Math.hypot(vx, vy);
        const slower = Math.max(0, sp - BRAKE * STEP);
        if (sp > 0) {
          vx *= slower / sp;
          vy *= slower / sp;
        }
        x += vx * STEP;
        y += vy * STEP;
        pos[(s * n + k) * 2] = x;
        pos[(s * n + k) * 2 + 1] = y;
      }
    }
  const at = (s: number, j: number) => {
    const f = Math.min(s, pSteps - 1);
    return [pocket.result.frames[(f * pn + j) * 2], pocket.result.frames[(f * pn + j) * 2 + 1]];
  };
  pocket.start.players.forEach((p, j) => {
    const k = staged.ids.indexOf(p.id);
    if (k < 0) return;
    for (let s = 0; s < steps; s++) {
      const [x, y] = at(s, j);
      pos[(s * n + k) * 2] = x;
      pos[(s * n + k) * 2 + 1] = y;
    }
  });
  const qj = pocket.start.players.findIndex((p) => p.id === pocket.start.qb);
  const outcome = pocket.start.outcome;
  const throws = outcome === 'clean' || outcome === 'pressure' || outcome === 'hit' || AWAY.includes(outcome);
  const held = throws ? Math.min(steps - 1, Math.round(pocket.start.throwAt / STEP)) : pSteps - 1;
  for (let s = 0; s <= held; s++) {
    const [x, y] = at(s, qj);
    ball[s * 3] = x;
    ball[s * 3 + 1] = y;
  }
  if (throws && pocket.start.grounded) {
    // Grounded: thrown into open grass a few yards off, wherever no receiver is near when it lands.
    const land = Math.min(steps - 1, held + GROUNDED_FLIGHT);
    const [x0, y0] = at(held, qj);
    const eligible = staged.ids.flatMap((id, k) =>
      staged.offense[k] && id !== pocket.start.qb && staged.roles[k] !== 'OL' ? [k] : [],
    );
    const room = (x: number, y: number) =>
      Math.min(...eligible.map((k) => Math.hypot(pos[(land * n + k) * 2] - x, pos[(land * n + k) * 2 + 1] - y)));
    let best = { x: x0, y: y0, room: -1 };
    for (const ahead of [2, 5, 8])
      for (const across of [-12, -8, -4, 0, 4, 8, 12]) {
        const x = x0 + pocket.start.dir * ahead;
        const y = clamp(y0 + across, 1, FIELD_W - 1);
        const r = room(x, y);
        if (r > best.room) best = { x, y, room: r };
      }
    for (let s = held + 1; s < steps; s++) {
      const k = Math.min(1, (s - held) / (land - held));
      ball[s * 3] = x0 + (best.x - x0) * k;
      ball[s * 3 + 1] = y0 + (best.y - y0) * k;
      ball[s * 3 + 2] = s >= land ? 0 : ball[s * 3 + 2];
    }
  } else if (throws && staged.arrive !== null) {
    const land = Math.min(steps - 1, Math.round(staged.arrive / STEP));
    const [x0, y0] = at(held, qj);
    const x1 = ball[land * 3];
    const y1 = ball[land * 3 + 1];
    for (let s = held + 1; s < land; s++) {
      const k = (s - held) / (land - held);
      ball[s * 3] = x0 + (x1 - x0) * k;
      ball[s * 3 + 1] = y0 + (y1 - y0) * k;
    }
  }
  return { ...staged, steps, pos, ball };
}

/**
 * A scramble's open field: everyone where the pocket (and the routes) left him as the quarterback crosses the line,
 * moving as he was, today's yards his spot (out of bounds or a slide as today called it). Null before he's across.
 */
export function scrambleStart(
  composed: StagedPlay,
  pocket: { start: PocketStart; result: PocketResult },
  m: PocketMoment,
  skillsOf: (id: number) => FieldSkills | undefined,
): FieldStart | null {
  const k = pocket.result.breakout;
  if (k === null || k < 1 || k >= composed.steps || m.facts.to === undefined) return null;
  const n = composed.ids.length;
  const players: FieldPlayer[] = [];
  for (let i = 0; i < n; i++) {
    const s = skillsOf(composed.ids[i]);
    if (!s) return null;
    const x = composed.pos[(k * n + i) * 2];
    const y = composed.pos[(k * n + i) * 2 + 1];
    players.push({
      id: composed.ids[i],
      side: composed.offense[i] ? 0 : 1,
      role: composed.roles[i],
      x,
      y,
      vx: (x - composed.pos[((k - 1) * n + i) * 2]) / STEP,
      vy: (y - composed.pos[((k - 1) * n + i) * 2 + 1]) / STEP,
      s,
    });
  }
  const f = m.facts;
  return {
    kind: 'run',
    t0: k * STEP,
    dir: composed.dir,
    yardLine: m.from,
    carrier: pocket.start.qb,
    players,
    blocks: [],
    clock: { outOfBounds: !!f.out, stayIn: !!f.stay },
    edge: 0,
    tired: !!f.tired,
    target: {
      x: m.from + f.to! * composed.dir,
      touchdown: !!f.td,
      ...(f.oob ? { out: true, ...(f.oob === 2 ? { stepped: true } : {}) } : {}),
      ...(f.sl ? { slide: true } : {}),
    },
  };
}
