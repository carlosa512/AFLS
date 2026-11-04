import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simulateGame } from '../match/gameSim';
import { activeQuirks } from '../quirks';
import { approach } from './approach';
import { bodyOf } from './body';
import { momentOf } from './moment';
import {
  composePocket,
  pocketCast,
  pocketEntry,
  pocketFrom,
  pocketMomentOf,
  pocketStage,
  type PocketMoment,
} from './pocketMoment';
import { fieldSkills } from './skills';
import { STEP } from './tuning';
import type { FieldRecord, PlayLogEntry } from '../types';

const league = createLeague({ seed: 'pocket-moment' });
const g = league.games.filter((x) => x.week === 1)[0];
const r = simulateGame(league, g, { field: true });
const plays = r.plays!;
const record = r.field as FieldRecord;
const seed = `${league.seed}:${g.season}:${g.id}`;
const skillsOf = (id: number) => {
  const p = league.players[id];
  return p ? fieldSkills(p, activeQuirks) : undefined;
};
/** Every catch the field played, read back as a pocket (a clean one) on the same facts. */
const catches = plays.flatMap((e, index) => {
  if (e.kind !== 'pass' || !e.field) return [];
  const withPk: PlayLogEntry = { ...e, field: { ...e.field, pk: 'clean' } };
  const pm = pocketMomentOf(withPk, record, index);
  const fm = momentOf(e, record, index, g.homeId);
  return pm && fm ? [{ index, e: withPk, pm, fm }] : [];
});

describe("the pocket's moment", () => {
  it('reads a dropback back into the moment its entry was built from', () => {
    expect(catches.length).toBeGreaterThan(5);
    for (const { pm } of catches) {
      const back = pocketMomentOf({ ...pocketEntry(pm), field: pm.facts }, record, pm.index) as PocketMoment;
      expect(back).toEqual(pm);
    }
  });

  it("keeps today's film for a dropback without a full line", () => {
    const { pm } = catches[0];
    const staged = pocketStage(pm, record, g.homeId, seed)!;
    expect(pocketCast(staged, pm)).not.toBeNull();
    const short = {
      ...staged,
      roles: staged.roles.map((role, k) => (role === 'OL' && k === staged.roles.indexOf('OL') ? 'TE' : role)),
    };
    expect(pocketCast(short, pm)).toBeNull();
  });

  it('hands the pocket to the open field without a jump', () => {
    let n = 0;
    for (const { pm, fm } of catches) {
      const staged = pocketStage(pm, record, g.homeId, seed);
      const pocket = staged && pocketFrom(pm, staged, skillsOf, seed);
      if (!staged || !pocket) continue;
      const composed = composePocket(staged, pocket);
      const a = approach(fm, record, g.homeId, seed, composed);
      if (!a) continue;
      n++;
      const men = composed.ids.length;
      composed.ids.forEach((id, k) => {
        const s = skillsOf(id);
        if (!s) return;
        const top = bodyOf({ id, side: 0, role: composed.roles[k], x: 0, y: 0, vx: 0, vy: 0, s }, false).top;
        for (let st = 1; st <= a.k0; st++) {
          const d = Math.hypot(
            composed.pos[(st * men + k) * 2] - composed.pos[((st - 1) * men + k) * 2],
            composed.pos[(st * men + k) * 2 + 1] - composed.pos[((st - 1) * men + k) * 2 + 1],
          );
          expect(d, `play ${pm.index} man ${id} step ${st}`).toBeLessThanOrEqual(top * STEP + 0.05);
        }
      });
    }
    expect(n).toBeGreaterThan(5);
  });

  it('throws the ball from where the quarterback is', () => {
    for (const { pm } of catches) {
      const staged = pocketStage(pm, record, g.homeId, seed);
      const pocket = staged && pocketFrom(pm, staged, skillsOf, seed);
      if (!staged || !pocket) continue;
      const composed = composePocket(staged, pocket);
      const st = Math.round(pocket.start.throwAt / STEP);
      const qk = composed.ids.indexOf(pocket.start.qb);
      const men = composed.ids.length;
      const qx = composed.pos[(st * men + qk) * 2];
      const qy = composed.pos[(st * men + qk) * 2 + 1];
      expect(
        Math.hypot(composed.ball[st * 3] - qx, composed.ball[st * 3 + 1] - qy),
        `play ${pm.index}`,
      ).toBeLessThanOrEqual(0.5);
    }
  });
});
