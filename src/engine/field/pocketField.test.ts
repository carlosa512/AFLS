import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { bodyOf } from './body';
import { man, pinKnobs, pocketStartOf } from './fixtures';
import { MID } from './geometry';
import { pairUp, runPocket, type PocketStart } from './pocketField';
import { STEP } from './tuning';

/** Where man `k` is at step `s`. */
const at = (start: PocketStart, frames: Float32Array, s: number, k: number) => {
  const n = start.players.length;
  return { x: frames[(s * n + k) * 2], y: frames[(s * n + k) * 2 + 1] };
};
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('the pocket', () => {
  let restore: () => void;
  beforeAll(() => {
    restore = pinKnobs();
  });
  afterAll(() => restore());

  it('pairs by alignment: the ends on the tackles, the tackles on the guards, a spare blocker doubling inside', () => {
    const { pairs, doubles, free } = pairUp(pocketStartOf());
    const on = new Map(pairs.map(([b, r]) => [r, b]));
    expect(on.get(30)).toBe(10);
    expect(on.get(33)).toBe(14);
    expect(on.get(31)).toBe(11);
    expect(on.get(32)).toBe(13);
    expect(doubles).toHaveLength(1);
    expect(doubles[0][0]).toBe(12);
    expect([31, 32]).toContain(doubles[0][1]);
    expect(free).toEqual([]);
  });

  it('leaves a sixth rusher free when the back is out', () => {
    const start = pocketStartOf({
      extra: [man(40, 1, 'LB', 45, MID - 3), man(41, 1, 'LB', 45, MID + 3)],
      blitz: true,
    });
    const { free, doubles } = pairUp(start);
    expect(free).toHaveLength(1);
    expect(doubles).toHaveLength(0);
  });

  it('lets a better rusher win sooner', () => {
    const homeAt = (rush: number, pro: number) => {
      const times: number[] = [];
      for (let k = 0; k < 40; k++) {
        const start = pocketStartOf({ outcome: 'pressure', end: 6, throwAt: 5.5, s: { 30: { rush }, 10: { pro } } });
        const r = runPocket(start, new Rng(`better:${rush}:${k}`));
        times.push(r.rusher === 30 && r.at !== null ? r.at : 6);
      }
      return mean(times);
    };
    expect(homeAt(18, 8)).toBeLessThan(homeAt(12, 12));
  });

  it('gives the same frames for the same start and seed', () => {
    const a = runPocket(pocketStartOf({ outcome: 'pressure' }), new Rng('same'));
    const b = runPocket(pocketStartOf({ outcome: 'pressure' }), new Rng('same'));
    expect(b).toEqual(a);
  });

  it('moves nobody faster than his legs, and no rusher through his blocker', () => {
    for (let k = 0; k < 30; k++) {
      const outcome = (['clean', 'pressure', 'hit', 'sack'] as const)[k % 4];
      const start = pocketStartOf({ outcome, end: 4, throwAt: 2.6 + (k % 5) * 0.2, sackX: 33 });
      const r = runPocket(start, new Rng(`legs:${k}`));
      const steps = r.frames.length / (start.players.length * 2);
      const { pairs } = pairUp(start);
      start.players.forEach((p, i) => {
        const top = bodyOf(p, false).top;
        for (let s = 1; s < steps; s++) {
          const a = at(start, r.frames, s - 1, i);
          const b = at(start, r.frames, s, i);
          expect(Math.hypot(b.x - a.x, b.y - a.y), `${outcome} man ${p.id} step ${s}`).toBeLessThanOrEqual(
            top * STEP + 0.05,
          );
        }
      });
      const index = new Map(start.players.map((p, i) => [p.id, i]));
      for (const [b, rr] of pairs)
        for (let s = 0; s < steps; s++) {
          const pb = at(start, r.frames, s, index.get(b)!);
          const pr = at(start, r.frames, s, index.get(rr)!);
          expect(Math.hypot(pb.x - pr.x, pb.y - pr.y), `${outcome} pair ${b}-${rr} step ${s}`).toBeGreaterThanOrEqual(
            0.5,
          );
        }
    }
  });

  describe("today's outcome steers it", () => {
    const qbAt = (st: PocketStart, r: { frames: Float32Array }, s: number) =>
      at(
        st,
        r.frames,
        s,
        st.players.findIndex((p) => p.id === st.qb),
      );
    const manAt = (st: PocketStart, r: { frames: Float32Array }, s: number, id: number) =>
      at(
        st,
        r.frames,
        s,
        st.players.findIndex((p) => p.id === id),
      );
    const stepOf = (t: number) => Math.round(t / STEP);

    it('holds a clean pocket to the throw, even with a free blitzer', () => {
      for (let k = 0; k < 20; k++) {
        const st = pocketStartOf({
          outcome: 'clean',
          blitz: true,
          extra: [man(40, 1, 'LB', 44, MID - 1), man(41, 1, 'LB', 44, MID + 1)],
        });
        const r = runPocket(st, new Rng(`clean:${k}`));
        expect(r.rusher, `seed ${k}`).toBeNull();
        for (let s = 0; s <= stepOf(st.throwAt); s++) {
          const q = qbAt(st, r, s);
          for (const id of st.rushers) {
            const m = manAt(st, r, s, id);
            expect(Math.hypot(m.x - q.x, m.y - q.y), `seed ${k} rusher ${id} step ${s}`).toBeGreaterThan(1);
          }
        }
      }
    });

    it('gets a hit to him as he throws, and a hurry a step short', () => {
      for (let k = 0; k < 20; k++)
        for (const outcome of ['hit', 'pressure'] as const) {
          const st = pocketStartOf({ outcome });
          const r = runPocket(st, new Rng(`press:${outcome}:${k}`));
          expect(r.rusher, `${outcome} ${k}`).not.toBeNull();
          const q = qbAt(st, r, stepOf(st.throwAt));
          const m = manAt(st, r, stepOf(st.throwAt), r.rusher!);
          const g = Math.hypot(m.x - q.x, m.y - q.y);
          if (outcome === 'hit') expect(g, `${outcome} ${k}`).toBeLessThanOrEqual(1.2);
          else {
            expect(g, `${outcome} ${k}`).toBeGreaterThan(1.2);
            expect(g, `${outcome} ${k}`).toBeLessThanOrEqual(3);
          }
        }
    });

    it('lands a sack at its time, the quarterback at the spot', () => {
      for (let k = 0; k < 20; k++) {
        const st = pocketStartOf({ outcome: 'sack', throwAt: 2.4 + (k % 4) * 0.3, sackX: 32, end: 4.5 });
        const r = runPocket(st, new Rng(`sack:${k}`));
        expect(Math.abs(r.at! - st.throwAt), `seed ${k}`).toBeLessThanOrEqual(0.3);
        const last = r.frames.length / (st.players.length * 2) - 1;
        expect(Math.abs(qbAt(st, r, last).x - 32), `seed ${k}`).toBeLessThanOrEqual(1);
        // Unblamed: the NFL's sack times already hold the coverage sacks; nobody up front is charged.
        const free = pocketStartOf({ outcome: 'sack', throwAt: 2.6, sackX: 32, end: 5, blamed: false });
        const u = runPocket(free, new Rng(`unblamed:${k}`));
        expect(u.beat).toBeNull();
        expect(Math.abs(u.at! - 2.6), `seed ${k}`).toBeLessThanOrEqual(0.3);
      }
    });

    it('breaks a scramble out away from the pressure', () => {
      for (let k = 0; k < 20; k++) {
        const st = pocketStartOf({ outcome: 'scramble', throwAt: 2.8, end: 6 });
        const r = runPocket(st, new Rng(`scr:${k}`));
        expect(r.breakout, `seed ${k}`).not.toBeNull();
        expect(qbAt(st, r, r.breakout!).x, `seed ${k}`).toBeGreaterThanOrEqual(st.los);
        // At the break he heads away from the rusher who got to him.
        const b = stepOf(st.throwAt);
        const q0 = qbAt(st, r, b);
        const q1 = qbAt(st, r, b + 6);
        const m = manAt(st, r, b, r.rusher!);
        expect(Math.sign(q1.y - q0.y), `seed ${k}`).toBe(Math.sign(q0.y - m.y) || Math.sign(q1.y - q0.y));
        const esc = pocketStartOf({ outcome: 'escape', throwAt: 3.6, end: 7 });
        const e = runPocket(esc, new Rng(`esc:${k}`));
        expect(e.breakout, `seed ${k}`).not.toBeNull();
        const qe = qbAt(esc, e, stepOf(esc.throwAt));
        for (const id of esc.rushers) {
          const m2 = manAt(esc, e, stepOf(esc.throwAt), id);
          expect(Math.hypot(m2.x - qe.x, m2.y - qe.y), `seed ${k} rusher ${id}`).toBeGreaterThan(2);
        }
      }
    });

    it('slides away from an edge rusher and steps up into a clean pocket', () => {
      const clean = pocketStartOf({ outcome: 'clean', throwAt: 3.2, end: 3.2 });
      const rc = runPocket(clean, new Rng('up'));
      const set = clean.los - clean.setDepth;
      expect(qbAt(clean, rc, stepOf(3.2)).x).toBeGreaterThan(set + 0.4);
      let away = 0;
      for (let k = 0; k < 20; k++) {
        const st = pocketStartOf({
          outcome: 'pressure',
          throwAt: 3.4,
          end: 3.4,
          s: { 30: { rush: 20 }, 10: { pro: 4 } },
        });
        const r = runPocket(st, new Rng(`slide:${k}`));
        if (r.rusher !== 30) continue;
        const q = qbAt(st, r, stepOf(3.4));
        if (q.y > MID + 0.3) away++;
      }
      expect(away).toBeGreaterThanOrEqual(10);
    });

    it('moves each habit the right way', () => {
      const share = (o: Parameters<typeof pocketStartOf>[0], id: number, tag: string) => {
        let n = 0;
        for (let k = 0; k < 60; k++)
          if (
            runPocket(pocketStartOf({ outcome: 'pressure', throwAt: 3.2, end: 3.2, ...o }), new Rng(`${tag}:${k}`))
              .rusher === id
          )
            n++;
        return n;
      };
      expect(share({ s: { 30: { habits: ['bendsArc'] } } }, 30, 'bend')).toBeGreaterThan(share({}, 30, 'bend'));
      expect(share({ s: { 10: { habits: ['heavyPunch'] } } }, 30, 'punch')).toBeLessThan(share({}, 30, 'punch'));
      const breakAt = (habits: 'bailsEarly'[]) => {
        const st = pocketStartOf({ outcome: 'escape', throwAt: 3.6, end: 7, s: { 1: { habits } } });
        return runPocket(st, new Rng('bail')).breakout!;
      };
      expect(breakAt(['bailsEarly'])).toBeLessThan(breakAt([]));
    });
  });

  describe('slide, chip, the delayed rusher and the late win', () => {
    it('slides the center to the side the play calls, and chips the edge away from it', () => {
      for (const slide of [-1, 1] as const) {
        const st = pocketStartOf({ slide, extra: [man(5, 0, 'RB', 34, MID + 1)], chip: 5 });
        const { doubles } = pairUp(st);
        const center = doubles.find(([b]) => b === 12)!;
        expect(center[1], `slide ${slide}`).toBe(slide === -1 ? 31 : 32);
        const back = doubles.find(([b]) => b === 5)!;
        expect(back[1], `slide ${slide}`).toBe(slide === -1 ? 33 : 30);
      }
    });

    it('holds a delayed rusher a beat, then sends him, and he can get home', () => {
      let home = 0;
      for (let k = 0; k < 30; k++) {
        const st = pocketStartOf({
          outcome: 'pressure',
          throwAt: 3.4,
          end: 3.4,
          extra: [man(40, 1, 'LB', 45, MID)],
          delayed: [40],
        });
        const r = runPocket(st, new Rng(`delay:${k}`));
        const j = st.players.findIndex((p) => p.id === 40);
        const s0 = at(st, r.frames, 0, j);
        const s15 = at(st, r.frames, 15, j);
        expect(Math.hypot(s15.x - s0.x, s15.y - s0.y), `seed ${k}`).toBeLessThan(0.3);
        if (r.rusher === 40) home++;
      }
      expect(home).toBeGreaterThan(0);
    });

    it('picks a late win by its odds, not always the best rusher', () => {
      const won = new Set<number | null>();
      for (let k = 0; k < 40; k++) {
        // Nobody wins on his own in time: the late win is drawn among the reps by their odds.
        const st = pocketStartOf({
          outcome: 'pressure',
          throwAt: 2.6,
          end: 2.6,
          s: { 30: { rush: 13 }, 10: { pro: 12 } },
        });
        won.add(runPocket(st, new Rng(`late:${k}`)).rusher);
      }
      expect(won.size).toBeGreaterThan(1);
    });

    it("anchors who gets home to today's group, and who lost him to today's spot", () => {
      for (let k = 0; k < 30; k++) {
        const outcome = (['pressure', 'hit', 'sack'] as const)[k % 3];
        // Today's credit: an interior man, beaten at center (the field picks which tackle and how).
        const st = pocketStartOf({
          outcome,
          throwAt: 2.4 + (k % 4) * 0.3,
          end: 3.6,
          sackX: 33,
          want: { rushers: [31, 32], blockers: [12] },
        });
        const r = runPocket(st, new Rng(`anchor:${k}`));
        expect([31, 32], `${outcome} ${k}`).toContain(r.rusher);
        expect(r.beat, `${outcome} ${k}`).toBe(12);
      }
    });
  });
});
