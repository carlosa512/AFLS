import { describe, expect, it } from 'vitest';
import { Rng } from '../../engine/rng';
import type { PlayLogEntry } from '../../engine/types';
import { FIELD_W } from './ballPath';
import { pocketPath, pocketPlan, sackTime, type Drop, type PocketContext } from './pocket';

const play = (over: Partial<PlayLogEntry> = {}): PlayLogEntry => ({
  quarter: 1,
  clock: 600,
  offense: 0,
  down: 1,
  distance: 10,
  yardLine: 30,
  text: 'A.Passer pass short right to W.Out for 8 yards (C.Corner)',
  homeScore: 0,
  awayScore: 0,
  kind: 'pass',
  from: 30,
  air: 38,
  to: 38,
  ...over,
});
const ctx = (over: Partial<PocketContext> = {}): PocketContext => ({
  gun: false,
  hurry: false,
  air: 8,
  minThrow: 0,
  ...over,
});
const ball = { x: 30, y: 26.65 };

describe('the pocket', () => {
  it('drops deeper for deeper throws: the air yards off each drop rise with it', () => {
    for (const gun of [false, true]) {
      const by = new Map<Drop, number[]>();
      const rng = new Rng(`drops:${gun}`);
      for (let i = 0; i < 4000; i++) {
        const air = Math.round(rng.normal(8, 9));
        const plan = pocketPlan(play(), ctx({ gun, air }), rng);
        by.set(plan.drop, [...(by.get(plan.drop) ?? []), air]);
      }
      const mean = (d: Drop) => by.get(d)!.reduce((a, b) => a + b, 0) / by.get(d)!.length;
      expect(mean(1)).toBeLessThan(mean(3));
      expect(mean(3)).toBeLessThan(mean(5));
      expect(mean(5)).toBeLessThan(mean(7));
    }
  });

  it('fakes to the back on early downs, almost never later, and never in the two-minute drill', () => {
    const share = (e: PlayLogEntry, c: PocketContext) => {
      const rng = new Rng('pa');
      let n = 0;
      for (let i = 0; i < 2000; i++) if (pocketPlan(e, c, rng).playAction) n++;
      return n / 2000;
    };
    expect(share(play({ down: 1 }), ctx())).toBeGreaterThan(0.25);
    expect(share(play({ down: 3 }), ctx())).toBeLessThan(0.08);
    expect(share(play({ down: 1 }), ctx({ hurry: true }))).toBe(0);
    expect(share(play({ down: 1 }), ctx({ air: -3 }))).toBe(0);
  });

  it('throws no earlier than the route allows, and later under pressure', () => {
    const rng = new Rng('throw');
    for (let i = 0; i < 500; i++)
      expect(pocketPlan(play(), ctx({ minThrow: 3.1 }), rng).throwAt).toBeGreaterThanOrEqual(3.1);
    const at = (c: PocketContext) => {
      const r = new Rng('same');
      let sum = 0;
      for (let i = 0; i < 2000; i++) sum += pocketPlan(play({ down: 3 }), c, r).throwAt;
      return sum / 2000;
    };
    expect(at(ctx({ rusher: { role: 'EDGE', across: 6 } })) - at(ctx())).toBeGreaterThan(0.5);
  });

  it('moves away from the rush: across from an inside rusher, up from an edge one', () => {
    let inside = 0;
    let edge = 0;
    for (let i = 0; i < 300; i++) {
      const rng = new Rng(`away:${i}`);
      const left = pocketPlan(play({ down: 3 }), ctx({ rusher: { role: 'DT', across: 1 } }), rng);
      if (left.pressure !== 'inside' || left.roll) continue;
      const keys = pocketPath(left, { ball, qb: { x: 28, y: ball.y }, dir: 1, rusher: { x: 31, y: ball.y - 1 } });
      // The rusher came from his left (lower y): he ends further right than he set.
      const set = keys.find((k) => k.t >= keys[keys.length - 1].t - 0.7)!;
      expect(keys[keys.length - 1].y).toBeGreaterThan(set.y);
      inside++;
    }
    for (let i = 0; i < 300; i++) {
      const rng = new Rng(`climb:${i}`);
      const plan = pocketPlan(play({ down: 3 }), ctx({ rusher: { role: 'EDGE', across: 7 } }), rng);
      if (plan.roll) continue;
      const keys = pocketPath(plan, { ball, qb: { x: 28, y: ball.y }, dir: 1, rusher: { x: 31, y: ball.y + 7 } });
      const deepest = Math.min(...keys.map((k) => k.x));
      // He climbs: the throw comes from shallower than where he set, or (off a quick drop) from the front of the
      // pocket already.
      const last = keys[keys.length - 1].x;
      expect(last > deepest + 1 || ball.x - last <= 4.01).toBe(true);
      edge++;
    }
    expect(inside).toBeGreaterThan(50);
    expect(edge).toBeGreaterThan(50);
  });

  it('a pressured scramble breaks away from the rusher; one with nothing open goes after a long look', () => {
    const rng = new Rng('scramble');
    for (let i = 0; i < 200; i++) {
      const open = pocketPlan(play({ kind: 'scramble', down: 3, air: undefined }), ctx({ air: null }), rng);
      expect(open.throwAt).toBeGreaterThanOrEqual(3.2);
      const chased = pocketPlan(
        play({ kind: 'scramble', down: 3, air: undefined }),
        ctx({ air: null, rusher: { role: 'DT', across: 1 } }),
        rng,
      );
      expect(chased.throwAt).toBeLessThan(open.throwAt + 1.5);
      const keys = pocketPath(chased, { ball, qb: { x: 28, y: ball.y }, dir: 1, rusher: { x: 31, y: ball.y - 1 } });
      expect(keys[keys.length - 1].y).toBeGreaterThanOrEqual(ball.y);
    }
  });

  it('never drops behind the end line or out of bounds, nor crosses the line before the throw', () => {
    for (let i = 0; i < 400; i++) {
      const rng = new Rng(`edge:${i}`);
      const deep = i % 2 === 0;
      const b = { x: deep ? 1 : 99, y: [1.5, 26.65, 51.8][i % 3] };
      const dir = deep ? 1 : -1;
      const plan = pocketPlan(
        play({ air: undefined, down: 1 + (i % 3) }),
        ctx({ gun: i % 4 < 2, air: (i % 30) - 5 }),
        rng,
      );
      const keys = pocketPath(plan, {
        ball: b,
        qb: { x: b.x - dir * (plan.gun ? 5 : 2), y: b.y },
        dir,
        back: { x: b.x - dir * 6, y: b.y + 1 },
      });
      for (const k of keys) {
        expect(k.x).toBeGreaterThanOrEqual(-10);
        expect(k.x).toBeLessThanOrEqual(110);
        expect(k.y).toBeGreaterThanOrEqual(1);
        expect(k.y).toBeLessThanOrEqual(FIELD_W - 1);
        expect((b.x - k.x) * dir).toBeGreaterThan(0.5);
      }
      for (let j = 1; j < keys.length; j++) expect(keys[j].t).toBeGreaterThan(keys[j - 1].t);
    }
  });

  it("spreads sacks like the NFL's: a median near three seconds, a long tail, quicker against a blitz", () => {
    const rng = new Rng('sacks');
    const ts = Array.from({ length: 5000 }, () => sackTime(false, rng)).sort((a, b) => a - b);
    const mean = ts.reduce((a, b) => a + b, 0) / ts.length;
    expect(mean).toBeGreaterThan(3);
    expect(mean).toBeLessThan(3.7);
    expect(ts[Math.floor(ts.length * 0.1)]).toBeLessThanOrEqual(2.4);
    expect(ts[Math.floor(ts.length * 0.9)]).toBeGreaterThanOrEqual(4.5);
    const blitz = Array.from({ length: 5000 }, () => sackTime(true, rng));
    expect(blitz.reduce((a, b) => a + b, 0) / blitz.length).toBeLessThan(mean);
  });
});
