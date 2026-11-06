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

/** The first catch the pocket can cast: a throw behind the line (a screen) never has a pocket to play. */
const castable = () => catches.find(({ pm }) => pocketCast(pocketStage(pm, record, g.homeId, seed)!, pm))!;

describe("the pocket's anchor", () => {
  it("keeps today's charged tight end or back in to block, so the man charged is the man who lost", () => {
    let n = 0;
    for (const { pm } of catches) {
      const staged = pocketStage(pm, record, g.homeId, seed);
      const cast = staged && pocketCast(staged, pm);
      if (!staged || !cast) continue;
      // A tight end out on a route (today's credit blames one on 12% of an edge's sacks): it blames him.
      const back = staged.ids.find(
        (id, k) => staged.offense[k] && staged.roles[k] === 'TE' && !cast.blockers.includes(id) && id !== pm.ball,
      );
      if (back === undefined) continue;
      const sacked = {
        ...pm,
        facts: { ...pm.facts, pk: 'sack' as const, rg: 'e' as const, bs: 'b' as const, bb: back },
      };
      const pocket = pocketFrom(sacked, staged, skillsOf, seed);
      if (!pocket) continue;
      expect(pocket.start.blockers).toContain(back);
      expect(pocket.start.want?.blockers).toEqual([back]);
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });
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
    const { pm } = castable();
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

  it('leaves the target and an interceptor to their routes, never the pocket', () => {
    const { pm } = castable();
    const staged = pocketStage(pm, record, g.homeId, seed)!;
    const cast = pocketCast(staged, pm)!;
    const rusher = cast.rushers[0];
    const picked = pocketCast(staged, { ...pm, take: rusher })!;
    expect(picked.rushers).not.toContain(rusher);
    expect(pocketCast(staged, { ...pm, ball: cast.blockers[0] })!.blockers).not.toContain(cast.blockers[0]);
  });
});

describe('a throwaway in the pocket', () => {
  /** Each castable catch read back as a throwaway of one shape (and grounded or not). */
  const asAway = (pk: 'away' | 'awayClean' | 'awayOut', gr = false, cq = false) =>
    catches.flatMap(({ e, index }) => {
      const field = { ...e.field!, pk, ...(gr ? { gr: 1 as const } : {}), ...(cq ? { cq: 1 as const } : {}) };
      const pm = pocketMomentOf({ ...e, field }, record, index);
      const staged = pm && pocketStage(pm, record, g.homeId, seed);
      const pocket = staged && pocketFrom(pm, staged, skillsOf, seed);
      return pm && staged && pocket ? [{ pm, staged, pocket, composed: composePocket(staged, pocket) }] : [];
    });
  const qbAt = (c: ReturnType<typeof asAway>[number], s: number) => {
    const men = c.composed.ids.length;
    const k = c.composed.ids.indexOf(c.pocket.start.qb);
    return { x: c.composed.pos[(s * men + k) * 2], y: c.composed.pos[(s * men + k) * 2 + 1] };
  };

  it('holds it longer than a throw before he gives up on it', () => {
    const clean = asAway('awayClean');
    expect(clean.length).toBeGreaterThan(3);
    for (const c of clean) {
      const thrown = pocketFrom({ ...c.pm, facts: { ...c.pm.facts, pk: 'clean' } }, c.staged, skillsOf, seed)!;
      expect(c.pocket.start.throwAt).toBeGreaterThan(thrown.start.throwAt + 0.5);
    }
  });

  it('from a clean pocket, nobody gets to him first', () => {
    for (const c of asAway('awayClean')) {
      const st = Math.round(c.pocket.start.throwAt / STEP);
      const q = qbAt(c, st);
      const men = c.composed.ids.length;
      c.composed.ids.forEach((id, k) => {
        if (c.composed.offense[k]) return;
        const d = Math.hypot(c.composed.pos[(st * men + k) * 2] - q.x, c.composed.pos[(st * men + k) * 2 + 1] - q.y);
        expect(d, `play ${c.pm.index}: ${id}`).toBeGreaterThan(1.5);
      });
    }
  });

  it('rolled out of a clean pocket, nobody gets to him first either', () => {
    const out = asAway('awayOut', false, true);
    expect(out.length).toBeGreaterThan(3);
    for (const c of out) {
      const st = Math.round(c.pocket.start.throwAt / STEP);
      const q = qbAt(c, st);
      const men = c.composed.ids.length;
      c.composed.ids.forEach((id, k) => {
        if (c.composed.offense[k]) return;
        const d = Math.hypot(c.composed.pos[(st * men + k) * 2] - q.x, c.composed.pos[(st * men + k) * 2 + 1] - q.y);
        expect(d, `play ${c.pm.index}: ${id}`).toBeGreaterThan(1.5);
      });
      expect(c.pocket.result.rusher, `play ${c.pm.index}`).toBeNull();
    }
  });

  it('rolled out, he throws it from outside the tackle box', () => {
    const out = asAway('awayOut');
    expect(out.length).toBeGreaterThan(3);
    for (const c of out) {
      const st = Math.round(c.pocket.start.throwAt / STEP);
      expect(Math.abs(qbAt(c, st).y - qbAt(c, 0).y), `play ${c.pm.index}`).toBeGreaterThanOrEqual(4);
    }
  });

  it('a grounded ball lands in open grass, away from every receiver', () => {
    const grounded = asAway('away', true);
    expect(grounded.length).toBeGreaterThan(3);
    for (const c of grounded) {
      const { composed } = c;
      const men = composed.ids.length;
      const last = composed.steps - 1;
      const bx = composed.ball[last * 3];
      const by = composed.ball[last * 3 + 1];
      const qb = c.pocket.start.qb;
      composed.ids.forEach((id, k) => {
        if (!composed.offense[k] || id === qb || composed.roles[k] === 'OL') return;
        const d = Math.hypot(composed.pos[(last * men + k) * 2] - bx, composed.pos[(last * men + k) * 2 + 1] - by);
        expect(d, `play ${c.pm.index}: ${id}`).toBeGreaterThanOrEqual(5);
      });
    }
  });
});
