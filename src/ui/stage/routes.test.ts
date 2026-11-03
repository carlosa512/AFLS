import { describe, expect, it } from 'vitest';
import { Rng } from '../../engine/rng';
import { ROUTES, routeFor, routeKeys, routeTime, type RouteId, type Spot } from './routes';

const from = { x: 30, y: 6 };
const speed = (keys: { t: number; x: number; y: number }[], a: { x: number; y: number }) => {
  let prev = { t: 0, ...a };
  const out: number[] = [];
  for (const k of keys) {
    out.push(Math.hypot(k.x - prev.x, k.y - prev.y) / (k.t - prev.t));
    prev = k;
  }
  return out;
};

describe('routes', () => {
  it('runs a route that fits the catch: deep is never a curl, behind the line is a screen or a swing, a slant goes inside', () => {
    const rng = new Rng('fit');
    for (let i = 0; i < 3000; i++) {
      const spot = (['WIDE', 'SLOT', 'TE', 'RB'] as Spot[])[i % 4];
      const air = rng.float(-6, 45);
      const across = rng.float(-12, 12);
      const r = routeFor({ air, across, spot }, rng);
      expect(ROUTES[r].spots, `${spot} ${r}`).toContain(spot);
      if (air >= 20) expect(['curl', 'hitch', 'stick', 'slant', 'drag', 'flat', 'quickOut']).not.toContain(r);
      if (air < -1) expect(['screen', 'swing', 'flat']).toContain(r);
      if (r === 'slant') expect(across).toBeGreaterThan(0);
    }
  });

  it("averages each route's air yards near the NFL's over a game's spread of catches", () => {
    const rng = new Rng('means');
    const by = new Map<RouteId, number[]>();
    for (let i = 0; i < 20000; i++) {
      const air = Math.max(-6, Math.round(rng.normal(8, 9)));
      const across = rng.float(-10, 10);
      const spot = (['WIDE', 'WIDE', 'SLOT', 'TE', 'RB'] as Spot[])[i % 5];
      const r = routeFor({ air, across, spot }, rng);
      by.set(r, [...(by.get(r) ?? []), air]);
    }
    const nfl: [RouteId, number, number][] = [
      ['slant', 6.1, 3],
      ['curl', 7.4, 3],
      ['out', 7.3, 3],
      ['dig', 10.6, 3],
      ['post', 21, 5],
      ['corner', 21.3, 5],
      ['go', 23.4, 5],
    ];
    for (const [r, mean, within] of nfl) {
      const xs = by.get(r)!;
      expect(xs.length, r).toBeGreaterThan(50);
      expect(Math.abs(xs.reduce((a, b) => a + b, 0) / xs.length - mean), r).toBeLessThan(within);
    }
  });

  it('reaches the catch as the ball does, never past top speed, slower through the plant than up the stem', () => {
    for (const r of Object.keys(ROUTES) as RouteId[]) {
      const air = Math.max(ROUTES[r].air[0], Math.min(ROUTES[r].air[1], ROUTES[r].mean));
      const to = {
        x: from.x + air,
        y: from.y + (ROUTES[r].way.includes('in') ? 6 : ROUTES[r].way.includes('out') ? -4 : 0),
      };
      const toIn = { x: to.x, y: Math.max(1, to.y) };
      const t = routeTime(r, from, toIn, 1, 1, 9);
      const keys = routeKeys(r, from, toIn, t + 0.4, 1, 1, 9);
      const last = keys[keys.length - 1];
      expect(last.t, r).toBeCloseTo(t + 0.4, 6);
      expect(Math.hypot(last.x - toIn.x, last.y - toIn.y), r).toBeLessThan(1e-6);
      for (const v of speed(keys, from)) expect(v, r).toBeLessThanOrEqual(9 + 1e-6);
    }
    // A dig: the stem's pace, then slower into the plant.
    const dig = routeKeys('dig', from, { x: 42, y: 14 }, 2.4, 1, 1, 9);
    const v = speed(dig, from);
    expect(Math.min(...v.slice(1, -1))).toBeLessThan(Math.max(...v) * 0.8);
  });

  it('keeps every route inside the sidelines, even for a catch at one', () => {
    const rng = new Rng('lines');
    for (let i = 0; i < 2000; i++) {
      const y = i % 2 ? 1 : 52.3;
      const start = { x: 40, y: i % 2 ? 3 : 50.3 };
      const inward: 1 | -1 = i % 2 ? 1 : -1;
      const air = rng.float(-3, 35);
      const spot = (['WIDE', 'SLOT', 'TE', 'RB'] as Spot[])[i % 4];
      const r = routeFor({ air, across: (y - start.y) * inward, spot }, rng);
      for (const k of routeKeys(r, start, { x: 40 + air, y }, 3, 1, inward, 9)) {
        expect(k.y).toBeGreaterThanOrEqual(0.5);
        expect(k.y).toBeLessThanOrEqual(52.8);
      }
    }
  });
});
