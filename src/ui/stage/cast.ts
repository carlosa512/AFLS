/**
 * Who is on the field for one play, read off the game's field record (`GameResult.field`): the eleven each way on a
 * snap, the kick units on a kick. A player the play was about who isn't among the eleven (a back spelling the
 * starter, a rotation rusher) takes the spot of the man in his group for that snap.
 */
import { actorsIn } from '../../engine/playActors';
import type { FieldRecord, FieldUnits, PlayLogEntry } from '../../engine/types';

export type Role = 'QB' | 'OL' | 'RB' | 'WR' | 'TE' | 'DT' | 'EDGE' | 'LB' | 'CB' | 'S' | 'K' | 'P' | 'RET' | 'ST';

export interface CastMember {
  id: number;
  role: Role;
  /** His place among the cast's men of the same role, in the order the field record lists them. */
  slot: number;
}

export interface Cast {
  /** The side with the ball (the kicking side on a kick). */
  offense: CastMember[];
  defense: CastMember[];
  /** The offense's side in the engine's terms: 0 home, 1 away. */
  offSide: 0 | 1;
}

/** Each side's units at a play: kickoff's, with every change up to that play applied. */
export function unitsAt(record: FieldRecord, index: number): [FieldUnits, FieldUnits] {
  const units: [FieldUnits, FieldUnits] = [record.units[0], record.units[1]];
  for (const [at, side, u] of record.changes) if (at <= index) units[side] = u;
  return units;
}

type Entry = [number, Role];

function scrimmageOffense(u: FieldUnits): Entry[] {
  return [
    [u.qb, 'QB'],
    ...u.ol.map((id): Entry => [id, 'OL']),
    [u.rb, 'RB'],
    ...u.wr.map((id): Entry => [id, 'WR']),
    ...u.te.map((id): Entry => [id, 'TE']),
  ];
}

function scrimmageDefense(u: FieldUnits): Entry[] {
  return [
    ...u.dt.map((id): Entry => [id, 'DT']),
    ...u.edge.map((id): Entry => [id, 'EDGE']),
    ...u.lb.map((id): Entry => [id, 'LB']),
    ...u.cb.map((id): Entry => [id, 'CB']),
    ...u.s.map((id): Entry => [id, 'S']),
  ];
}

/** Eleven different men: the unit as listed, topped up from `spares` in order (a man listed twice counts once). */
function eleven(unit: Entry[], spares: Entry[]): Entry[] {
  const seen = new Set<number>();
  const out: Entry[] = [];
  for (const e of [...unit, ...spares]) {
    if (out.length === 11) break;
    if (seen.has(e[0])) continue;
    seen.add(e[0]);
    out.push(e);
  }
  return out;
}

/**
 * Put a player the play was about on the field, in place of the last man of one of `roles` (tried in order) who isn't
 * himself in the play.
 */
function swapIn(side: Entry[], id: number, role: Role, keep: ReadonlySet<number>, roles: readonly Role[] = [role]) {
  if (side.some(([x]) => x === id)) return;
  for (const r of roles)
    for (let i = side.length - 1; i >= 0; i--)
      if (side[i][1] === r && !keep.has(side[i][0])) {
        side[i] = [id, role];
        return;
      }
}

function withSlots(side: Entry[]): CastMember[] {
  const seen = new Map<Role, number>();
  return side.map(([id, role]) => {
    const slot = seen.get(role) ?? 0;
    seen.set(role, slot + 1);
    return { id, role, slot };
  });
}

export function castFor(record: FieldRecord, plays: readonly PlayLogEntry[], index: number, homeId: number): Cast {
  const e = plays[index];
  const units = unitsAt(record, index);
  const offSide: 0 | 1 = e.offense === homeId ? 0 : 1;
  const off = units[offSide];
  const def = units[(1 - offSide) as 0 | 1];
  const stOf = (u: FieldUnits) => u.st.map((id): Entry => [id, 'ST']);

  let offense: Entry[];
  let defense: Entry[];
  if (e.kind === 'kickoff' || e.kind === 'punt') {
    const kick = e.kind === 'kickoff';
    // The returner is often one of the ten around him: the rest of the roster tops either unit up to eleven.
    offense = eleven([[kick ? off.k : off.p, kick ? 'K' : 'P']], [...stOf(off), ...scrimmageDefense(off)]);
    defense = eleven([[kick ? def.kr : def.pr, 'RET']], [...stOf(def), ...scrimmageOffense(def)]);
  } else if (e.kind === 'fg' || e.kind === 'xp') {
    offense = eleven(
      [...off.fg.map((id): Entry => [id, 'OL']), [off.k, 'K'], [off.p, 'P']],
      [...stOf(off), ...scrimmageOffense(off)],
    );
    defense = eleven(
      [
        ...def.dt.map((id): Entry => [id, 'DT']),
        ...def.edge.map((id): Entry => [id, 'EDGE']),
        ...def.lb.map((id): Entry => [id, 'LB']),
      ],
      scrimmageDefense(def),
    );
  } else {
    offense = scrimmageOffense(off);
    defense = scrimmageDefense(def);
    const who = actorsIn(e);
    const keep = new Set(Object.values(who));
    if (who.ball !== undefined && who.ball === off.rb2) swapIn(offense, who.ball, 'RB', keep);
    // A target the engine sent out though `units` left him off (a second tight end): he lines up as an extra tight end.
    else if (who.ball !== undefined) swapIn(offense, who.ball, 'TE', keep, ['WR', 'TE']);
    for (const id of [who.rush, who.tackle, who.cover, who.take]) {
      const rot = id === undefined ? undefined : def.rot.find(([r]) => r === id);
      if (rot) swapIn(defense, rot[0], rot[1], keep, rot[1] === 'EDGE' ? ['EDGE', 'DT'] : ['DT', 'EDGE']);
    }
  }
  return { offense: withSlots(offense), defense: withSlots(defense), offSide };
}
