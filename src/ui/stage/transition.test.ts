import { describe, expect, it } from 'vitest';
import { FIELD_W } from './ballPath';
import { BENCH, JOG, transition, type Mark } from './transition';

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
