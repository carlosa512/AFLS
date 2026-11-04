import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { man, randomStart, startOf, pinKnobs } from './fixtures';
import { FIELD_W, MID } from './geometry';
import { laneMatch, runField } from './run';
import { aimAt } from './chase';
import { bodyOf } from './body';
import { KNOBS, MAX_FIELD, STEP } from './tuning';
import type { FieldStart } from './types';

/** Where man `k` is at step `s`. */
const at = (start: FieldStart, frames: Float32Array, s: number, k: number) => {
  const n = start.players.length;
  return { x: frames[(s * n + k) * 2], y: frames[(s * n + k) * 2 + 1] };
};

describe('the open field', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = pinKnobs();
  });
  afterAll(() => restore());

  it('lets a blocked man go only after his hold, and a weak blocker sooner', () => {
    const shedTime = (shed: number, seed: string, hold = 0) => {
      const players = [
        man(1, 0, 'RB', 48, MID + 4, { vx: 6 }),
        man(10, 0, 'OL', 50, MID),
        man(30, 1, 'DT', 50.9, MID, { s: { shed } }),
        man(31, 1, 'S', 80, MID + 10),
      ];
      const start = startOf({ players, blocks: [{ blocker: 10, defender: 30, holdFor: hold }] });
      const r = runField(start, new Rng(seed));
      const steps = r.frames.length / (players.length * 2);
      for (let s = 0; s < steps; s++) {
        const b = at(start, r.frames, s, 1);
        const d = at(start, r.frames, s, 2);
        if (Math.hypot(b.x - d.x, b.y - d.y) > 2) return s * STEP;
      }
      return Infinity;
    };
    for (let i = 0; i < 50; i++) expect(shedTime(20, `hold:${i}`, 1)).toBeGreaterThanOrEqual(1);
    const mean = (shed: number) => {
      let t = 0;
      let n = 0;
      for (let i = 0; i < 200; i++) {
        const x = shedTime(shed, `shed:${i}`);
        if (Number.isFinite(x)) {
          t += x;
          n++;
        }
      }
      return t / n;
    };
    expect(mean(18)).toBeLessThan(mean(12));
  });

  it('keeps a deep man in front of the carrier', () => {
    for (let i = 0; i < 100; i++) {
      const players = [man(1, 0, 'RB', 40, MID, { vx: 7 }), man(30, 1, 'S', 55, MID)];
      const r = runField(startOf({ players }), new Rng(`deep:${i}`));
      // He may beat him with a move or break his tackle, but never get by untouched.
      if (r.touchdown)
        expect(
          r.misses.some((m) => m.by === 30),
          `seed ${i}`,
        ).toBe(true);
    }
  });

  it('closes sooner with a better angle', () => {
    const contact = (pursuit: number) => {
      let t = 0;
      for (let i = 0; i < 200; i++) {
        const players = [man(1, 0, 'RB', 30, MID - 10, { vx: 7 }), man(30, 1, 'LB', 40, MID + 6, { s: { pursuit } })];
        const r = runField(startOf({ players }), new Rng(`angle:${i}`));
        t += r.duration;
      }
      return t / 200;
    };
    expect(contact(18)).toBeLessThan(contact(6));
  });

  it('ends on a touchdown, out of bounds or a tackle, never at the time limit', () => {
    for (let i = 0; i < 2000; i++) {
      const r = runField(randomStart(`end:${i}`), new Rng(`end:${i}`));
      const ends = [r.touchdown, r.outOfBounds, r.tackler !== null].filter(Boolean).length;
      expect(ends, `seed ${i}`).toBe(1);
      expect(r.duration).toBeLessThan(MAX_FIELD);
      expect(Number.isFinite(r.yards)).toBe(true);
    }
    const alone = [man(1, 0, 'RB', 80, MID, { vx: 6 }), man(30, 1, 'LB', 20, MID)];
    expect(runField(startOf({ players: alone }), new Rng('alone')).touchdown).toBe(true);
  });

  it("handles the field's edges", () => {
    const cases: FieldStart[] = [
      startOf({ players: [man(1, 0, 'RB', 99, MID, { vx: 3 }), man(30, 1, 'LB', 100.5, MID + 3)] }),
      startOf({ players: [man(1, 0, 'WR', 50, 0.6, { vx: 6 }), man(30, 1, 'CB', 56, 3)] }),
      startOf({ dir: -1, players: [man(1, 0, 'RB', 2, MID, { vx: -2 }), man(30, 1, 'LB', -1, MID)] }),
    ];
    for (const [i, s] of cases.entries()) {
      const r = runField(s, new Rng(`edge:${i}`));
      expect(r.frames.every((v) => Number.isFinite(v))).toBe(true);
      expect([r.touchdown, r.outOfBounds, r.tackler !== null].filter(Boolean)).toHaveLength(1);
      expect(r.yards * s.dir + s.yardLine).toBeLessThanOrEqual(100);
    }
  });

  it('gives the same frames for the same start and seed', () => {
    const a = runField(randomStart('same'), new Rng('same'));
    const b = runField(randomStart('same'), new Rng('same'));
    expect(b).toEqual(a);
  });

  it("holds a return's blocks downfield as long as retHold says", () => {
    const was = KNOBS.retHold;
    KNOBS.retHold = 1.5;
    // A returner, his blocker a step in front, a cover man coming: the blocker takes him and holds at least 1.5 s.
    const players = [
      man(1, 0, 'RET', 20, MID, { vx: 6 }),
      man(10, 0, 'ST', 24, MID, { vx: 4 }),
      man(30, 1, 'ST', 30, MID + 1, { vx: -6 }),
      man(31, 1, 'ST', 60, MID + 15),
    ];
    const start = startOf({ players, kind: 'return' });
    const r = runField(start, new Rng('ret-hold'));
    KNOBS.retHold = was;
    const n = players.length;
    let engaged = -1;
    for (let s = 0; s < r.frames.length / (n * 2); s++) {
      const gap = Math.hypot(
        r.frames[(s * n + 1) * 2] - r.frames[(s * n + 2) * 2],
        r.frames[(s * n + 1) * 2 + 1] - r.frames[(s * n + 2) * 2 + 1],
      );
      if (engaged < 0 && gap <= 1.05) engaged = s;
      if (engaged >= 0 && (s - engaged) * STEP < 1.4 && s * STEP < r.duration)
        expect(gap, `step ${s}`).toBeLessThanOrEqual(2);
    }
    expect(engaged).toBeGreaterThanOrEqual(0);
  });

  it('cuts off a carrier angling for the sideline at it, not past it', () => {
    let caught = 0;
    for (let i = 0; i < 40; i++) {
      // He angles for the sideline and stays in; the corner, inside and ahead, meets him at it.
      const players = [
        man(1, 0, 'WR', 40, 14, { vx: 6, vy: -5 }),
        man(30, 1, 'CB', 47, 17, { vx: 2, vy: -3 }),
        man(31, 1, 'S', 95, 45),
      ];
      const r = runField(startOf({ players, clock: { outOfBounds: false, stayIn: true } }), new Rng(`side:${i}`));
      if (r.tackler === 30 || r.misses.some((m) => m.by === 30)) caught++;
    }
    expect(caught).toBeGreaterThanOrEqual(32);
  });

  it('never aims a defender at a spot off the field', () => {
    const d = bodyOf(man(30, 1, 'CB', 50, 12), false);
    // A carrier at the 3-yard line across the field, running hard for the sideline: the meeting point is cut off at it.
    for (const q of [0.6, 1, 1.4]) {
      const { aim } = aimAt(d, {
        seen: { x: 44, y: 3 },
        vx: 4,
        vy: -8,
        q,
        deep: false,
        dir: 1,
        eased: false,
        react: 0.3,
      });
      expect(aim.y).toBeGreaterThanOrEqual(1);
    }
  });

  it('keeps a man who reacts late flat-footed until then, and the back goes further', () => {
    const players = [man(1, 0, 'RB', 40, MID, { vx: 5 }), man(30, 1, 'LB', 47, MID + 1), man(31, 1, 'S', 60, MID - 3)];
    let late = 0;
    let onTime = 0;
    for (let i = 0; i < 100; i++) {
      const held = startOf({ players, late: [{ id: 30, until: 0.8 }] });
      const r = runField(held, new Rng(`late:${i}`));
      // He hasn't moved toward the back before 0.8 s.
      const k = Math.round(0.7 / STEP);
      expect(Math.hypot(r.frames[(k * 3 + 1) * 2] - 47, r.frames[(k * 3 + 1) * 2 + 1] - (MID + 1))).toBeLessThan(0.3);
      late += r.yards;
      onTime += runField(startOf({ players }), new Rng(`late:${i}`)).yards;
    }
    expect(late / 100).toBeGreaterThan(onTime / 100 + 0.5);
  });

  it('plays to the credited spot: tackled there, by a defender, and only a touchdown spot scores', () => {
    let near = 0;
    let total = 0;
    for (let i = 0; i < 400; i++) {
      const start = randomStart(`anchor:${i}`);
      const yards = Math.round(new Rng(`y:${i}`).float(-1, 12));
      const own = start.dir === 1 ? start.yardLine : 100 - start.yardLine;
      if (own + yards >= 99 || own + yards <= 1) continue;
      // A spot he can stop at from the speed he has (real moments start at the line or the catch).
      const c = start.players.find((p) => p.id === start.carrier)!;
      if (yards < (c.vx * c.vx + c.vy * c.vy) / 24 + 1) continue;
      const anchored = { ...start, target: { x: start.yardLine + yards * start.dir, touchdown: false } };
      const r = runField(anchored, new Rng(`anchor:${i}`));
      total++;
      expect(r.touchdown, `start ${i}`).toBe(false);
      if (r.tackler !== null) expect(anchored.players.find((p) => p.id === r.tackler)!.side).toBe(1);
      if (Math.abs(r.yards - yards) <= 1.5) near++;
    }
    expect(near / total).toBeGreaterThanOrEqual(0.95);
    // A touchdown spot: he scores, whoever's there.
    for (let i = 0; i < 50; i++) {
      const start = randomStart(`td:${i}`);
      const r = runField({ ...start, target: { x: start.dir === 1 ? 100 : 0, touchdown: true } }, new Rng(`td:${i}`));
      expect(r.touchdown, `td ${i}`).toBe(true);
    }
  });

  it('counts only real broken and missed tackles on the way to the credited spot', () => {
    let misses = 0;
    let runs = 0;
    for (let i = 0; i < 300; i++) {
      const start = randomStart(`count:${i}`);
      const c = start.players.find((p) => p.id === start.carrier)!;
      const own = start.dir === 1 ? start.yardLine : 100 - start.yardLine;
      const yards = 8;
      if (own + yards >= 99 || yards < (c.vx * c.vx + c.vy * c.vy) / 24 + 1) continue;
      const r = runField(
        { ...start, target: { x: start.yardLine + yards * start.dir, touchdown: false } },
        new Rng(`count:${i}`),
      );
      misses += r.misses.length;
      runs++;
      // No man misses him twice.
      expect(new Set(r.misses.map((m) => m.by)).size).toBe(r.misses.length);
    }
    expect(misses / runs).toBeLessThan(0.6);
  });

  it('gives the tackle at the credited spot to the man in front of him, not one trailing', () => {
    let front = 0;
    for (let i = 0; i < 60; i++) {
      // A lineman a step behind him and a safety three yards ahead: at his spot the safety has him.
      const players = [
        man(1, 0, 'RB', 50, MID, { vx: 4 }),
        man(30, 1, 'DT', 49, MID + 0.6, { vx: 4 }),
        man(31, 1, 'S', 55.5, MID + 1.5, { vx: -1 }),
      ];
      const r = runField(startOf({ players, target: { x: 54, touchdown: false } }), new Rng(`front:${i}`));
      if (r.tackler === 31) front++;
    }
    expect(front).toBeGreaterThanOrEqual(48);
  });

  it('takes a man credited out of bounds out at his spot, nobody credited, a defender chasing or in front', () => {
    // From the 30 in the middle, credited ten yards and out of bounds: a man on his heels and one waiting downfield.
    for (const seed of ['oob-1', 'oob-2', 'oob-3', 'oob-4']) {
      const players = [
        man(1, 0, 'RB', 30, MID, { vx: 6 }),
        man(30, 1, 'LB', 27, MID + 2, { vx: 6 }),
        man(31, 1, 'S', 48, MID + 6),
      ];
      const start = startOf({ players, target: { x: 40, touchdown: false, out: true } });
      const r = runField(start, new Rng(seed));
      expect(r.outOfBounds, seed).toBe(true);
      expect(r.tackler, seed).toBeNull();
      expect(Math.abs(r.yards - 10), seed).toBeLessThanOrEqual(1.5);
      // In bounds until he's nearly there.
      const steps = r.frames.length / (players.length * 2);
      for (let s = 0; s < steps; s++) {
        const c = at(start, r.frames, s, 0);
        if (c.x < 37) expect(c.y > 0 && c.y < FIELD_W, `${seed} step ${s}`).toBe(true);
      }
    }
  });

  it('chases a man credited out of bounds out: the defender who can get there closes on him, not left alone', () => {
    // A tight end near the sideline, credited fifteen yards and out; the only defender a safety eight yards inside.
    for (const seed of ['out-1', 'out-2', 'out-3', 'out-4']) {
      const players = [man(1, 0, 'TE', 30, 10, { vx: 6 }), man(31, 1, 'S', 32, 18, { vx: 2 })];
      const start = startOf({ players, target: { x: 45, touchdown: false, out: true } });
      const r = runField(start, new Rng(seed));
      expect(r.outOfBounds, seed).toBe(true);
      expect(r.tackler, seed).toBeNull();
      const steps = r.frames.length / (players.length * 2);
      let s = 0;
      while (s < steps - 1 && at(start, r.frames, s, 0).y > 0) s++;
      // Chased out, not left alone: he's closed on him by the time he steps out (no set distance, only not alone).
      const gap = (k: number) => {
        const c = at(start, r.frames, k, 0);
        const d = at(start, r.frames, k, 1);
        return Math.hypot(c.x - d.x, c.y - d.y);
      };
      expect(gap(s), seed).toBeLessThan(gap(0));
      expect(gap(s), seed).toBeLessThan(5);
    }
  });

  it('lets a sliding quarterback go down at his spot, nobody credited', () => {
    for (const seed of ['slide-1', 'slide-2', 'slide-3']) {
      const players = [
        man(1, 0, 'QB', 40, MID, { vx: 6 }),
        man(30, 1, 'LB', 37, MID + 2, { vx: 6 }),
        man(31, 1, 'S', 52, MID + 4),
      ];
      const start = startOf({ players, target: { x: 46, touchdown: false, slide: true } });
      const r = runField(start, new Rng(seed));
      expect(r.tackler, seed).toBeNull();
      expect(r.outOfBounds, seed).toBe(false);
      expect(Math.abs(r.yards - 6), seed).toBeLessThanOrEqual(1.5);
    }
  });

  describe('a kickoff return (the NFL from 2024: coverage at the 40, the setup zone at the 30 to the 35)', () => {
    // The returner catches at the 5 and is credited to the 28. Ten cover men in five lanes a side at the 40, just off
    // the line now the ball is down; seven blockers across the 30 and two at the 34; the kicker behind them.
    const LANES = [4, 9, 14, 19, 23];
    const kickoffStart = (): FieldStart => {
      const players = [man(1, 0, 'RET', 5, MID)];
      [-18, -12, -6, 0, 6, 12, 18].forEach((y, k) => players.push(man(10 + k, 0, 'ST', 30, MID + y)));
      [-8, 8].forEach((y, k) => players.push(man(17 + k, 0, 'ST', 34, MID + y)));
      LANES.flatMap((y) => [-y, y]).forEach((y, k) => players.push(man(30 + k, 1, 'ST', 40, MID + y, { vx: -3 })));
      players.push(man(40, 1, 'K', 47, MID));
      return startOf({ players, kind: 'return', kick: 'kickoff', target: { x: 28, touchdown: false } });
    };
    const cover = (st: FieldStart) => st.players.flatMap((p, k) => (p.side === 1 && p.role === 'ST' ? [k] : []));
    const blockers = (st: FieldStart) => st.players.flatMap((p, k) => (p.side === 0 && p.role === 'ST' ? [k] : []));

    it('covers in lanes: no two cover men bunch while they are still well short of him', () => {
      for (const seed of ['ko-1', 'ko-2', 'ko-3', 'ko-4']) {
        const st = kickoffStart();
        const r = runField(st, new Rng(seed));
        // He's down at his spot well inside the field's limit (a slide that stops short of it ends the play too).
        expect(r.duration, seed).toBeLessThan(MAX_FIELD - 1);
        expect(r.yards, seed).toBeGreaterThan(21);
        const steps = r.frames.length / (st.players.length * 2);
        const cs = cover(st);
        for (let s = 0; s < steps; s++) {
          const c = at(st, r.frames, s, 0);
          // Free men in their lanes: well short of him and not in a block (no blocker within 2 yards).
          const bl = blockers(st).map((k) => at(st, r.frames, s, k));
          const far = cs
            .map((k) => at(st, r.frames, s, k))
            .filter(
              (p) => Math.hypot(p.x - c.x, p.y - c.y) > 10 && bl.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 2),
            );
          for (let a = 0; a < far.length; a++)
            for (let b = a + 1; b < far.length; b++)
              expect(Math.hypot(far[a].x - far[b].x, far[a].y - far[b].y), `${seed} step ${s}`).toBeGreaterThan(1.5);
        }
        // A second into it, the coverage still spans most of the field's width.
        const ys = cs.map((k) => at(st, r.frames, 20, k).y);
        expect(Math.max(...ys) - Math.min(...ys), seed).toBeGreaterThan(30);
      }
    });

    it('blocks by lane: each blocker meets the cover man across from him', () => {
      for (const seed of ['ko-1', 'ko-2', 'ko-3', 'ko-4']) {
        const st = kickoffStart();
        const r = runField(st, new Rng(seed));
        const steps = r.frames.length / (st.players.length * 2);
        // The man across from each blocker: blockers and cover men in order across the field, one cover man left over.
        const bs = blockers(st).sort((a, b) => st.players[a].y - st.players[b].y);
        const cs = cover(st).sort((a, b) => st.players[a].y - st.players[b].y);
        const best = laneMatch(bs, cs, (k) => st.players[k].y);
        // In order: no two blocks cross.
        for (let k = 1; k < best.length; k++) expect(st.players[best[k]].y).toBeGreaterThan(st.players[best[k - 1]].y);
        let met = 0;
        bs.forEach((b, k) => {
          let closest = Infinity;
          for (let s = 0; s < steps; s++) {
            const p = at(st, r.frames, s, b);
            const d = at(st, r.frames, s, best[k]);
            closest = Math.min(closest, Math.hypot(p.x - d.x, p.y - d.y));
          }
          if (closest <= 1.1) met++;
        });
        expect(met, seed).toBeGreaterThanOrEqual(7);
      }
    });
  });
});
