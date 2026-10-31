import { describe, expect, it } from 'vitest';
import { FIELD_W } from './ballPath';
import type { PlayLogEntry } from '../../engine/types';
import { BENCH, celebrates, JOG, SPRINT, transition, type Mark } from './transition';

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
    expect(move(1).arrive).toBeGreaterThan(10 / (JOG * 1.25));
    expect(move(1).arrive).toBeLessThan(10 / (JOG * 0.75));
    expect(tr.duration).toBeGreaterThanOrEqual(move(1).arrive + 0.6);
    const mid = tr.at(move(1), tr.beat + move(1).delay + move(1).arrive / 2);
    expect(mid.x).toBeGreaterThan(30);
    expect(mid.x).toBeLessThan(40);
  });

  it('never moves a man faster than a jog unless the field is changing over', () => {
    // Men going off hustle off (a twelfth man at the snap is a flag): everyone else jogs.
    for (const m of tr.moves.filter((x) => !x.leave)) {
      const d = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
      // Each man has his own pace about a jog: a lineman ambles, a corner trots a touch quicker.
      expect(d / Math.max(m.arrive, 1e-6)).toBeLessThanOrEqual(JOG * 1.25 + 1e-6);
    }
  });

  it('brings a sub on from his own sideline and sends the man coming off to his', () => {
    const on = move(4);
    expect(on.enter).toBe(true);
    expect(on.from.y).toBe(FIELD_W + BENCH); // away bench
    // In full view on his sideline, then on at a jog.
    expect(tr.at(on, 0).opacity).toBe(1);
    expect(tr.at(on, 0).y).toBe(FIELD_W + BENCH);
    expect(tr.at(on, tr.duration).opacity).toBe(1);
    const off = move(3);
    expect(off.leave).toBe(true);
    expect(off.to.y).toBe(FIELD_W + BENCH);
    expect(tr.at(off, tr.duration).opacity).toBe(0);
  });

  it('runs a full change of units at a sprint at most, in the time it takes', () => {
    const far = new Map<number, Mark>(Array.from({ length: 22 }, (_, i) => [i, mark(10, 3 + i * 2, i < 11)]));
    const units = {
      ids: Array.from({ length: 22 }, (_, i) => i),
      home: Array.from({ length: 22 }, (_, i) => i < 11),
      pos: new Float32Array(44).map((_, k) => (k % 2 === 0 ? 75 : 3 + (k / 2) * 2)),
    };
    const t = transition(far, units);
    // Sixty-five yards: at a sprint, never faster (a man covers it in the time it takes, no blur across the field).
    for (const m of t.moves) {
      const d = Math.hypot(m.to.x - m.from.x, m.to.y - m.from.y);
      expect(d / m.arrive).toBeLessThanOrEqual(SPRINT * 1.25);
    }
    expect(t.duration - t.beat).toBeLessThanOrEqual(65 / (SPRINT * 0.8) + 3);
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
    const party = transition(prev, next, { party: { x: 100, y: 20, home: true } });
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

describe('huddles', () => {
  // Offense (home) and defense (away), five a side, ten yards from where they ended up.
  const prev = new Map<number, Mark>([
    ...Array.from({ length: 5 }, (_, i): [number, Mark] => [i, mark(40 + i, 10 + i * 6, true)]),
    ...Array.from({ length: 5 }, (_, i): [number, Mark] => [10 + i, mark(45 + i, 12 + i * 6, false)]),
  ]);
  const ids = [...prev.keys()];
  const next = {
    ids,
    home: ids.map((id) => id < 10),
    pos: new Float32Array(ids.flatMap((id) => (id < 10 ? [49, 20 + (id % 10) * 3] : [51, 20 + (id % 10) * 3]))),
  };
  const huddle = { offense: { x: 42, y: 26 }, defense: { x: 55, y: 26 }, offenseHome: true, qb: 2, caller: 12 };
  const tr = transition(prev, next, { huddle });
  const at = (id: number, t: number) => tr.at(tr.moves.find((m) => m.id === id)!, t);

  it('gathers each side in its huddle before breaking to the line', () => {
    expect(tr.huddle).toBeGreaterThan(1);
    const t = tr.huddle - 0.1;
    for (const id of ids) {
      const c = id < 10 ? huddle.offense : huddle.defense;
      const p = at(id, t);
      expect(Math.hypot(p.x - c.x, p.y - c.y), `player ${id}`).toBeLessThan(4);
    }
  });

  it('puts the quarterback and the play-caller at the front of their huddles, toward the ball', () => {
    const t = tr.huddle - 0.1;
    const qb = at(2, t);
    const others = ids.filter((id) => id < 10 && id !== 2).map((id) => at(id, t).x);
    expect(qb.x).toBeGreaterThanOrEqual(Math.max(...others) - 0.01); // the ball is at higher x
    const caller = at(12, t);
    const defenders = ids.filter((id) => id >= 10 && id !== 12).map((id) => at(id, t).x);
    expect(caller.x).toBeLessThanOrEqual(Math.min(...defenders) + 0.01);
  });

  it('breaks the huddle and ends everyone on his spot', () => {
    for (const id of ids) {
      const k = ids.indexOf(id);
      const end = at(id, tr.duration);
      expect([end.x, end.y]).toEqual([next.pos[k * 2], next.pos[k * 2 + 1]]);
    }
  });

  it('has no huddle when none is asked for (two-minute drill, kicks)', () => {
    expect(transition(prev, next).huddle).toBe(0);
  });
});

describe('the clock', () => {
  const prev = new Map<number, Mark>([
    [1, mark(30, 20)],
    [2, mark(30, 30)],
  ]);
  // Player 3 comes on from the far bench, thirty-odd yards away.
  const next = { ids: [1, 2, 3], home: [true, true, true], pos: new Float32Array([40, 20, 40, 30, 40, 26]) };
  const speed = (t: ReturnType<typeof transition>, id: number) => {
    const m = t.moves.find((x) => x.id === id)!;
    return Math.hypot(m.to.x - m.hud.x, m.to.y - m.hud.y) / m.arrive;
  };

  it('jogs a sub on when there is no hurry, however far he comes', () => {
    const t = transition(prev, next);
    expect(speed(t, 3)).toBeLessThanOrEqual(JOG * 1.25);
  });

  it('sprints everyone into place in a hurry-up', () => {
    const calm = transition(prev, next);
    const hurry = transition(prev, next, { hurry: true });
    expect(speed(hurry, 1)).toBeGreaterThan(JOG * 1.25);
    expect(speed(hurry, 3)).toBeGreaterThan(JOG * 1.25);
    expect(speed(hurry, 3)).toBeLessThanOrEqual(SPRINT * 1.25);
    expect(hurry.duration).toBeLessThan(calm.duration);
  });
});

describe('no two alike', () => {
  // A whole offense and defense, eleven a side, jogging from one spot to the next.
  const prev = new Map<number, Mark>(
    Array.from({ length: 22 }, (_, i): [number, Mark] => [i, mark(30 + (i % 5) * 3, 5 + (i % 11) * 4, i < 11)]),
  );
  const next = {
    ids: [...prev.keys()],
    home: [...prev.keys()].map((i) => i < 11),
    pos: new Float32Array(
      [...prev.keys()].flatMap((i) => [45 + (i < 11 ? -1 : 1) * (1 + (i % 3)), 8 + (i % 11) * 3.5]),
    ),
  };
  const tr = transition(prev, next, { seed: 'g1' });

  it('starts each man in his own time, at his own pace', () => {
    const starts = tr.moves.map((m) => m.delay);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(0.25);
    const paces = tr.moves.map((m) => Math.hypot(m.to.x - m.hud.x, m.to.y - m.hud.y) / m.arrive);
    expect(Math.max(...paces) / Math.min(...paces)).toBeGreaterThan(1.15);
  });

  it('runs no one on a ruler-straight line over any distance (a short step stays straight: no circling)', () => {
    let bent = 0;
    const long = tr.moves.filter((m) => Math.hypot(m.to.x - m.hud.x, m.to.y - m.hud.y) > 12);
    for (const m of long) {
      const half = tr.at(m, tr.beat + m.delay + m.arrive / 2);
      const line = { x: (m.hud.x + m.to.x) / 2, y: (m.hud.y + m.to.y) / 2 };
      if (Math.hypot(half.x - line.x, half.y - line.y) > 0.3) bent++;
    }
    expect(long.length).toBeGreaterThan(4);
    expect(bent).toBeGreaterThan(long.length / 2);
  });

  it('still ends every man on his spot, and plays the same way every time', () => {
    for (const m of tr.moves) {
      const end = tr.at(m, tr.duration);
      expect(Math.hypot(end.x - m.to.x, end.y - m.to.y)).toBeLessThan(1e-6);
    }
    const again = transition(prev, next, { seed: 'g1' });
    expect(again.moves.map((m) => [m.delay, m.arrive])).toEqual(tr.moves.map((m) => [m.delay, m.arrive]));
  });

  it('sends the men coming off toward their bench area, not straight across in a row', () => {
    const off = transition(prev, { ids: [], home: [], pos: new Float32Array() }, { seed: 'g1' });
    const xs = off.moves.map((m) => m.to.x - m.from.x);
    expect(Math.max(...xs) - Math.min(...xs)).toBeGreaterThan(2);
  });
});

describe('the change-over before a kickoff', () => {
  // The offense that just scored, in the end zone, and the defense round it; the kick units are mostly other men.
  const prev = new Map<number, Mark>(
    Array.from({ length: 22 }, (_, i) => [i, mark(90 + (i % 5), 10 + (i % 11) * 3, i < 11)]),
  );
  // Ids 0–4 and 11–15 are in both units; 30–41 come on.
  const ids = [...[0, 1, 2, 3, 4, 11, 12, 13, 14, 15], ...Array.from({ length: 12 }, (_, i) => 30 + i)];
  const next = {
    ids,
    home: ids.map((id) => id < 11 || (id >= 30 && id < 36)),
    pos: new Float32Array(ids.flatMap((_, i) => [i % 2 ? 60 : 65, 5 + (i % 11) * 4])),
  };
  const tr = transition(prev, next, { seed: 'k1', change: true });
  const move = (id: number) => tr.moves.find((m) => m.id === id)!;

  it('takes the men going off to their own sideline, and a man in both units straight to his new spot', () => {
    for (const id of [5, 6, 16, 17]) {
      const m = move(id);
      expect(m.leave).toBe(true);
      expect(m.to.y).toBe(m.home ? -BENCH : FIELD_W + BENCH);
    }
    for (const id of [0, 1, 11, 12]) {
      const m = move(id);
      // Never off the field on the way: no trip to the sideline and back.
      for (let t = 0; t <= tr.duration; t += 0.2) {
        const p = tr.at(m, t);
        expect(p.y).toBeGreaterThan(-0.5);
        expect(p.y).toBeLessThan(FIELD_W + 0.5);
      }
    }
  });

  it('brings the kick units on as the field clears, each in his own time, and sets them at their spots', () => {
    const on = ids.filter((id) => id >= 30).map(move);
    const starts = on.map((m) => m.start);
    expect(Math.min(...starts)).toBeGreaterThan(1);
    expect(Math.max(...starts) - Math.min(...starts)).toBeGreaterThan(0.5);
    for (const m of tr.moves.filter((x) => !x.leave)) {
      const end = tr.at(m, tr.duration);
      expect(Math.hypot(end.x - m.to.x, end.y - m.to.y)).toBeLessThan(1e-6);
    }
  });

  it('spreads the men waiting to come on along their team area, and where the men going off head, never on one spot', () => {
    for (const enter of [true, false])
      for (const home of [true, false]) {
        const spots = tr.moves
          .filter((m) => m.home === home && (enter ? m.enter : m.leave))
          .map((m) => (enter ? m.from.x : m.to.x))
          .sort((a, b) => a - b);
        for (let i = 1; i < spots.length; i++) expect(spots[i] - spots[i - 1]).toBeGreaterThan(2.3);
      }
    // The units coming on wait in their team area, between the 32-yard lines (give or take the spacing).
    for (const m of tr.moves.filter((x) => x.enter)) {
      expect(m.from.x).toBeGreaterThan(25);
      expect(m.from.x).toBeLessThan(75);
    }
  });

  it('never jumps anyone: every path is continuous, with a huddle or without, change-over or not', () => {
    const huddle = { offense: { x: 55, y: 26 }, defense: { x: 70, y: 26 }, offenseHome: true, qb: 0 };
    for (const opts of [
      { seed: 'c1', change: true },
      { seed: 'c2', change: true, huddle },
      { seed: 'c3', huddle },
      { seed: 'c4' },
      // A celebration first: teammates run to him, they don't arrive in a blink.
      { seed: 'c5', change: true, party: { x: 92, y: 20, home: true } },
    ]) {
      const t = transition(prev, next, opts);
      for (const m of t.moves) {
        let was = t.at(m, 0);
        for (let s = 0.05; s <= t.duration; s += 0.05) {
          const now = t.at(m, s);
          // Never faster than a sprint: 11 yards a second at the very most, a little over half a yard a step.
          expect(Math.hypot(now.x - was.x, now.y - was.y), `${opts.seed} ${m.id} at ${s.toFixed(2)}`).toBeLessThan(
            0.55,
          );
          was = now;
        }
      }
    }
  });

  it('gives the moment a beat, but not forever', () => {
    expect(tr.duration).toBeGreaterThan(6);
    expect(tr.duration).toBeLessThan(20);
  });
});
