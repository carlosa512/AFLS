import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simulateGame } from '../match/gameSim';
import { activeQuirks } from '../quirks';
import { Rng } from '../rng';
import type { FieldRecord, PlayLogEntry } from '../types';
import { approach, fieldStart } from './approach';
import { MID } from './geometry';
import { momentOf, type FieldMoment } from './moment';
import { fieldSkills } from './skills';
import { SPEED } from './speed';
import { KNOBS, STEP } from './tuning';

const league = createLeague({ seed: 'approach' });
const games = league.games.filter((g) => g.week === 1).slice(0, 6);
interface Seen {
  e: PlayLogEntry;
  index: number;
  record: FieldRecord;
  homeId: number;
  m: FieldMoment;
}
const seen: Seen[] = [];
for (const g of games) {
  const r = simulateGame(league, g, { keepPlays: true });
  r.plays!.forEach((e0, index) => {
    const returned = /returns (to|the|\d)/.test(e0.text) && (e0.kind === 'kickoff' || e0.kind === 'punt');
    if (e0.kind !== 'run' && e0.kind !== 'pass' && !returned) return;
    const e = { ...e0, field: { y: MID } };
    const m = momentOf(e, r.field!, index, g.homeId);
    if (m) seen.push({ e, index, record: r.field!, homeId: g.homeId, m });
  });
}
const skillsOf = (id: number) => {
  const p = league.players[id];
  return p ? fieldSkills(p, activeQuirks) : undefined;
};
const of = (kind: FieldMoment['kind']) => seen.filter((s) => s.m.kind === kind);

describe('the approach: the snap to possession, blind', () => {
  it('builds the moment from what the play knew before possession, never its result', () => {
    for (const s of seen.slice(0, 80)) {
      const changed: PlayLogEntry = {
        ...s.e,
        to: (s.e.to ?? 0) + 7,
        text: `${s.e.text} and then some`,
        who: s.e.who ? [s.e.who[0], 424242, ...s.e.who.slice(2)] : s.e.who,
      };
      expect(momentOf(changed, s.record, s.index, s.homeId)).toEqual(s.m);
    }
    for (const k of ['to', 'yards', 'tackle', 'text'])
      for (const s of seen.slice(0, 20)) expect(Object.keys(s.m)).not.toContain(k);
  });

  it('puts the back at the hole at speed about 2.8 s after the snap', () => {
    const runs = of('run').filter((s) => {
      const role = s.record.units[0].rb === s.m.ball || s.record.units[1].rb === s.m.ball;
      return role;
    });
    expect(runs.length).toBeGreaterThan(80);
    for (const s of runs) {
      const a = approach(s.m, s.record, s.homeId, 'seed')!;
      expect(a, `play ${s.index}`).not.toBeNull();
      expect(a.t0).toBeGreaterThanOrEqual(2.3);
      expect(a.t0).toBeLessThanOrEqual(3.5);
      const k = a.staged.ids.indexOf(a.carrier);
      const n = a.staged.ids.length;
      const at = (st: number) => ({ x: a.staged.pos[(st * n + k) * 2], y: a.staged.pos[(st * n + k) * 2 + 1] });
      const hole = a.staged.run!.hole;
      expect(Math.hypot(at(a.k0).x - hole.x, at(a.k0).y - hole.y)).toBeLessThanOrEqual(1.5);
      const v = Math.hypot(at(a.k0).x - at(a.k0 - 1).x, at(a.k0).y - at(a.k0 - 1).y) / STEP;
      // Through the hole, cutting as he reads it: moving, if not yet at speed.
      expect(v).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('puts the target at the catch with his cover man about the separation off', () => {
    const catches = of('catch');
    expect(catches.length).toBeGreaterThan(80);
    for (const s of catches) {
      const a = approach(s.m, s.record, s.homeId, 'seed');
      if (!a) continue;
      const n = a.staged.ids.length;
      const at = (id: number) => {
        const k = a.staged.ids.indexOf(id);
        return { x: a.staged.pos[(a.k0 * n + k) * 2], y: a.staged.pos[(a.k0 * n + k) * 2 + 1] };
      };
      const ball = { x: a.staged.ball[a.k0 * 3], y: a.staged.ball[a.k0 * 3 + 1] };
      expect(Math.hypot(at(a.carrier).x - ball.x, at(a.carrier).y - ball.y), `play ${s.index}`).toBeLessThanOrEqual(1);
      if (s.m.cover !== undefined && a.staged.ids.includes(s.m.cover)) {
        const d = Math.hypot(at(s.m.cover).x - at(a.carrier).x, at(s.m.cover).y - at(a.carrier).y);
        expect(d).toBeGreaterThanOrEqual(1.5);
        expect(d).toBeLessThanOrEqual(12);
      }
    }
  });

  it("puts the returner under the ball, the kickoff coverage held to the ball's landing", () => {
    const returns = of('return');
    expect(returns.length).toBeGreaterThan(10);
    for (const s of returns) {
      const a = approach(s.m, s.record, s.homeId, 'seed')!;
      expect(a, `play ${s.index}`).not.toBeNull();
      const n = a.staged.ids.length;
      const k = a.staged.ids.indexOf(a.carrier);
      expect(a.staged.roles[k]).toBe('RET');
      const at = { x: a.staged.pos[(a.k0 * n + k) * 2], y: a.staged.pos[(a.k0 * n + k) * 2 + 1] };
      expect(Math.hypot(at.x - s.m.air!, at.y - (s.m.kick === 'kickoff' ? MID : at.y))).toBeLessThanOrEqual(2);
      if (s.m.kick === 'kickoff')
        a.staged.ids.forEach((_, j) => {
          if (!a.staged.offense[j] || a.staged.roles[j] === 'K') return;
          expect((a.staged.pos[(a.k0 * n + j) * 2] - s.m.from) * a.staged.dir).toBeLessThanOrEqual(26);
        });
    }
  });

  it('keeps every man under his legs from the snap to possession', () => {
    for (const s of seen.slice(0, 150)) {
      const a = approach(s.m, s.record, s.homeId, 'seed');
      if (!a) continue;
      const n = a.staged.ids.length;
      for (let st = 1; st <= a.k0; st++)
        for (let k = 0; k < n; k++) {
          const v =
            Math.hypot(
              a.staged.pos[(st * n + k) * 2] - a.staged.pos[((st - 1) * n + k) * 2],
              a.staged.pos[(st * n + k) * 2 + 1] - a.staged.pos[((st - 1) * n + k) * 2 + 1],
            ) / STEP;
          expect(v, `play ${s.index} man ${k}`).toBeLessThanOrEqual(SPEED[a.staged.roles[k]] + 1.1 + 1e-3);
        }
    }
  });

  it("can't start a field with a man it has no skills for", () => {
    // (The cast always lines up the play's ball carrier, so the start is where a missing man shows.)
    const s = of('catch')[0];
    const a = approach(s.m, s.record, s.homeId, 'seed')!;
    const missing = a.staged.ids[3];
    expect(fieldStart(a, s.m, (id) => (id === missing ? undefined : skillsOf(id)), new Rng('h'))).toBeNull();
  });

  it('stages the same approach twice', () => {
    const s = of('run')[3];
    expect(approach(s.m, s.record, s.homeId, 'x')).toEqual(approach(s.m, s.record, s.homeId, 'x'));
  });

  it('starts the open field where the approach leaves it, his line block held longer by a pancake preacher', () => {
    const s = of('run')[0];
    const a = approach(s.m, s.record, s.homeId, 'seed')!;
    const start = fieldStart(a, { ...s.m, facts: { ...s.m.facts, z: 0 } }, skillsOf, new Rng('hold'))!;
    expect(start.players).toHaveLength(22);
    expect(start.carrier).toBe(a.carrier);
    expect(start.t0).toBe(a.t0);
    const lineBlock = start.blocks.find((b) => a.lineBlocks.some(([x, y]) => x === b.blocker && y === b.defender))!;
    expect(lineBlock).toBeDefined();
    const preacher = (id: number) => {
      const sk = skillsOf(id)!;
      return id === lineBlock.blocker ? { ...sk, habits: ['pancakePreacher' as const] } : { ...sk, habits: [] };
    };
    const plain = (id: number) => ({ ...skillsOf(id)!, habits: [] });
    const withIt = fieldStart(a, { ...s.m, facts: { ...s.m.facts, z: 0 } }, preacher, new Rng('hold'))!;
    const without = fieldStart(a, { ...s.m, facts: { ...s.m.facts, z: 0 } }, plain, new Rng('hold'))!;
    const hold = (st: typeof withIt) => st.blocks.find((b) => b.blocker === lineBlock.blocker)!.holdFor;
    expect(hold(withIt) - hold(without)).toBeCloseTo(0.3, 6);
  });

  it('frees the front at the hole on a stuffed roll, and climbs to the linebackers on a clean one', () => {
    const runs = of('run').slice(0, 60);
    let heldLow = 0;
    let heldHigh = 0;
    let lbLow = 0;
    let lbHigh = 0;
    for (const s of runs) {
      const a = approach(s.m, s.record, s.homeId, 'seed')!;
      const at = (z: number) =>
        fieldStart(a, { ...s.m, facts: { ...s.m.facts, z } }, skillsOf, new Rng(`z:${s.index}`))!;
      const low = at(-1);
      const high = at(2);
      const lb = (st: typeof low) =>
        st.blocks.filter((b) => st.players.find((p) => p.id === b.defender)!.role === 'LB').length;
      const line = (st: typeof low) =>
        st.blocks.filter((b) => a.lineBlocks.some(([x, y]) => x === b.blocker && y === b.defender));
      heldLow += line(low).length;
      heldHigh += line(high).length;
      lbLow += lb(low);
      lbHigh += lb(high);
    }
    expect(heldHigh).toBeGreaterThan(heldLow * 1.5);
    expect(lbHigh).toBeGreaterThan(lbLow);
  });

  it('holds the free second level a beat on a clean roll, and not on an average one', () => {
    let held = 0;
    for (const s of of('run').slice(0, 40)) {
      const a = approach(s.m, s.record, s.homeId, 'seed')!;
      const at = (z: number) =>
        fieldStart(a, { ...s.m, facts: { ...s.m.facts, z } }, skillsOf, new Rng(`m:${s.index}`))!;
      expect(at(0).late ?? []).toHaveLength(0);
      expect(at(-1).late ?? []).toHaveLength(0);
      const clean = at(2);
      for (const l of clean.late ?? []) {
        const p = clean.players.find((x) => x.id === l.id)!;
        expect(p.side).toBe(1);
        expect(['LB', 'CB', 'S']).toContain(p.role);
        expect(l.until).toBeCloseTo(2 * KNOBS.meet, 6);
        expect(clean.blocks.some((b) => b.defender === l.id)).toBe(false);
      }
      held += clean.late?.length ?? 0;
    }
    expect(held).toBeGreaterThan(40);
  });
});
