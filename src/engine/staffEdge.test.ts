import { describe, expect, it } from 'vitest';
import { shiftBelief, runnerOf } from './belief';
import { NO_CHEM } from './chemistry';
import { teamCoaches } from './coaching';
import { createLeague } from './generate';
import { playWeek } from './league';
import { simulateGame } from './match/gameSim';
import { STAFF, STAFF_ON, staffEdgeOf, staffWeek, sideValue } from './staffEdge';
import type { GameResult, League } from './types';

const base = (() => {
  const l = createLeague({ seed: 'staff-edge' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);
const ROOMS = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB'] as const;

describe('staff edge: the parts', () => {
  it('a great coordinator his rooms believe in gives the whole part, a doubted one little', () => {
    const l = fresh();
    const oc = runnerOf(l, 0, 'OL')!;
    const at = (value: number, belief: number) => {
      oc.youth = value;
      oc.veterans = value;
      oc.belief = { OL: belief };
      return staffEdgeOf(fresh2(l), 0, 'OL')!.coord;
    };
    expect(at(13.5, 1)).toBeCloseTo(STAFF.coord, 9);
    expect(at(13.5, -1)).toBeCloseTo(STAFF.coord * 0.2, 9);
    expect(at(10.5, -1)).toBeCloseTo(STAFF.coord * -0.4, 9);
    expect(at(7.5, -1)).toBeCloseTo(-STAFF.coord, 9);
  });

  it('the head coach counts for all seven rooms at half the reach', () => {
    const l = fresh();
    for (const t of l.teams) {
      const heads = ROOMS.map((r) => staffEdgeOf(l, t.id, r)!.head);
      for (const h of heads) {
        expect(Math.abs(h)).toBeLessThanOrEqual(STAFF.head + 1e-9);
        expect(h).toBeCloseTo(heads[0], 9);
      }
    }
  });

  it('is centred on the league and inside its cap', () => {
    const l = fresh();
    shiftBelief(runnerOf(l, 3, 'DB')!, 'DB', -0.8);
    const week = staffWeek(l);
    for (const r of ROOMS) {
      const edges = l.teams.map((t) => week.get(`${t.id}:${r}`)!.edge);
      expect(Math.abs(edges.reduce((a, b) => a + b, 0) / edges.length)).toBeLessThan(0.01);
    }
    for (const e of week.values()) expect(Math.abs(e.edge)).toBeLessThanOrEqual(STAFF.coord + STAFF.head + 1e-9);
  });

  it('reads a vacant side as a replacement and never throws', () => {
    const l = fresh();
    const dc = runnerOf(l, 0, 'DB')!;
    dc.teamId = null;
    const hc = teamCoaches(l, 0).find((c) => c.role === 'headCoach')!;
    hc.coverOff = ['defCoord'];
    l.coaches = { ...l.coaches };
    expect(sideValue(l, 0, 'defCoord')).toBe(6);
    expect(staffEdgeOf(l, 0, 'DB')!.coord).toBeCloseTo(STAFF.coord * -STAFF.quality, 9);
    hc.teamId = null;
    l.coaches = { ...l.coaches };
    for (const r of ROOMS) expect(Number.isFinite(staffEdgeOf(l, 0, r)!.edge)).toBe(true);
  });
});

/** The same league object with its week's read dropped (a coach changed by hand). */
function fresh2(l: League): League {
  l.coaches = { ...l.coaches };
  l.moraleAt = (l.moraleAt ?? 0) + 0.0001;
  return l;
}

describe('staff edge: the switch a check can turn off', () => {
  it('reads no edge while it is off, and comes back on', () => {
    const l = fresh();
    STAFF_ON.on = false;
    try {
      expect(staffEdgeOf(l, 0, 'OL')).toBeNull();
    } finally {
      STAFF_ON.on = true;
    }
    expect(staffEdgeOf(l, 0, 'OL')).not.toBeNull();
  });
});

describe('staff edge: game day', () => {
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const replay = (l: League, staff: [Record<string, number>, Record<string, number>], n = 200) =>
    Array.from({ length: n }, (_, i) =>
      simulateGame(l, l.games[0], { seed: `s:${i}`, days: [0, 0], chemistry: [NO_CHEM, NO_CHEM], staff }),
    );
  const off = (x: number) => ({ QB: x, RB: x, WR: x, OL: x });
  const def = (x: number) => ({ DL: x, LB: x, DB: x });

  it('an offense whose staff is at its best scores and gains more', () => {
    const l = fresh();
    const up = replay(l, [off(0.5), {}]);
    const down = replay(l, [off(-0.5), {}]);
    const pts = (rs: GameResult[]) => avg(rs.map((r) => r.homeScore));
    const yds = (rs: GameResult[]) => avg(rs.map((r) => r.home.totalYds));
    expect(pts(up)).toBeGreaterThan(pts(down));
    expect(yds(up)).toBeGreaterThan(yds(down));
  }, 240_000);

  it('a defense whose staff is at its best gives up fewer yards', () => {
    const l = fresh();
    const yds = (rs: GameResult[]) => avg(rs.map((r) => r.home.totalYds));
    expect(yds(replay(l, [{}, def(0.5)]))).toBeLessThan(yds(replay(l, [{}, def(-0.5)])));
  }, 240_000);

  it('plays the same game twice with staff edges on', () => {
    const a = simulateGame(fresh(), fresh().games[0]);
    const l = fresh();
    const b = simulateGame(l, l.games[0]);
    expect([b.homeScore, b.awayScore, b.home.totalYds]).toEqual([a.homeScore, a.awayScore, a.home.totalYds]);
  }, 60_000);
});
