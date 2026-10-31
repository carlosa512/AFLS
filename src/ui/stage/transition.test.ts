import { describe, expect, it } from 'vitest';
import { FIELD_W } from './ballPath';
import type { PlayLogEntry } from '../../engine/types';
import { BENCH, celebrates, JOG, transition, type Mark } from './transition';

const mark = (x: number, y: number, home = true): Mark => ({ x, y, home });

describe('between plays', () => {
  const prev = new Map<number, Mark>([
    [1, mark(30, 20)], // stays on, moves 10 yards
    [2, mark(30, 30)], // stays on, stands still
    [3, mark(40, 25, false)], // goes off
  ]);
  const next = { ids: [1, 2, 4], home: [true, true, false], pos: new Float32Array([40, 20, 30, 30, 50, 26]) };
  const tr = transition(prev, next);
  const move = (id: number) => tr.moves.find((m) => m.id === id)!;

  it('jogs everyone to his spot, then holds the formation before the snap', () => {
    const a = tr.at(move(1), tr.duration);
    expect([a.x, a.y]).toEqual([40, 20]);
    expect(move(1).arrive).toBeCloseTo(10 / JOG, 1);
    expect(tr.duration).toBeGreaterThanOrEqual(move(1).arrive + 0.6);
    const mid = tr.at(move(1), move(1).arrive / 2);
    expect(mid.x).toBeGreaterThan(30);
    expect(mid.x).toBeLessThan(40);
  });

  it('never moves a man faster than a jog unless the field is changing over', () => {
    for (const m of tr.moves) {
      const d = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
      expect(d / Math.max(m.arrive, 1e-6)).toBeLessThanOrEqual(JOG + 1e-6);
    }
  });

  it('brings a sub on from his own sideline and sends the man coming off to his', () => {
    const on = move(4);
    expect(on.enter).toBe(true);
    expect(on.from.y).toBe(FIELD_W + BENCH); // away bench
    expect(tr.at(on, 0).opacity).toBeLessThan(1);
    expect(tr.at(on, tr.duration).opacity).toBe(1);
    const off = move(3);
    expect(off.leave).toBe(true);
    expect(off.to.y).toBe(FIELD_W + BENCH);
    expect(tr.at(off, tr.duration).opacity).toBe(0);
  });

  it('fits a full change of units (after a kick) into a few seconds', () => {
    const far = new Map<number, Mark>(Array.from({ length: 22 }, (_, i) => [i, mark(10, 3 + i * 2, i < 11)]));
    const units = {
      ids: Array.from({ length: 22 }, (_, i) => i),
      home: Array.from({ length: 22 }, (_, i) => i < 11),
      pos: new Float32Array(44).map((_, k) => (k % 2 === 0 ? 75 : 3 + (k / 2) * 2)),
    };
    const t = transition(far, units);
    expect(t.duration).toBeLessThanOrEqual(7.5);
  });
});

describe('celebrations', () => {
  const e = (x: Partial<PlayLogEntry>): PlayLogEntry => ({
    quarter: 1,
    clock: 600,
    offense: 1,
    down: 1,
    distance: 10,
    yardLine: 50,
    text: '',
    homeScore: 0,
    awayScore: 0,
    kind: 'pass',
    from: 50,
    to: 55,
    ...x,
  });
  it('celebrates only the big ones: a long touchdown, a return score, a pick, a fumble lost', () => {
    expect(celebrates([e({ text: 'pass, TOUCHDOWN', from: 60, to: 102 })], 0, 1)).toBe(true);
    expect(celebrates([e({ text: 'pass, TOUCHDOWN', from: 95, to: 102 })], 0, 1)).toBe(false);
    expect(celebrates([e({ kind: 'kickoff', text: 'returns the kickoff 97 yards for a TOUCHDOWN!' })], 0, 1)).toBe(
      true,
    );
    expect(celebrates([e({ kind: 'int' })], 0, 1)).toBe(true);
    expect(celebrates([e({ text: 'run. FUMBLE, recovered by J.Smith' }), e({ offense: 2 })], 0, 1)).toBe(true);
    expect(celebrates([e({ text: 'run. FUMBLE, recovered by J.Smith' }), e({ offense: 1 })], 0, 1)).toBe(false);
    expect(celebrates([e({})], 0, 1)).toBe(false);
  });

  it("gathers the scorer's teammates round him for a moment, then everyone jogs to his spot", () => {
    const prev = new Map<number, Mark>([
      [1, mark(100, 20)], // the scorer
      [2, mark(90, 25)], // a teammate nearby
      [3, mark(40, 30)], // a teammate far away
      [4, mark(95, 22, false)], // a defender
    ]);
    const next = {
      ids: [1, 2, 3, 4],
      home: [true, true, true, false],
      pos: new Float32Array([35, 26, 35, 20, 35, 30, 45, 26]),
    };
    const plain = transition(prev, next);
    const party = transition(prev, next, { x: 100, y: 20, home: true });
    expect(party.duration).toBeGreaterThan(plain.duration + 1);
    const at = (id: number, t: number) => party.at(party.moves.find((m) => m.id === id)!, t);
    const gathered = at(2, party.celebrate);
    expect(Math.hypot(gathered.x - 100, gathered.y - 20)).toBeLessThan(3);
    expect(Math.hypot(at(3, party.celebrate).x - 40, at(3, party.celebrate).y - 30)).toBeLessThan(1); // too far to join
    expect(Math.hypot(at(4, party.celebrate).x - 95, at(4, party.celebrate).y - 22)).toBeLessThan(1); // not his team
    for (const id of [1, 2, 3, 4]) {
      const end = at(id, party.duration);
      const k = next.ids.indexOf(id);
      expect([end.x, end.y]).toEqual([next.pos[k * 2], next.pos[k * 2 + 1]]);
    }
  });
});
