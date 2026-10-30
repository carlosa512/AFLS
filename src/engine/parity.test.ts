import { describe, expect, it, vi } from 'vitest';

// Every lineup the sim builds, with the team and the day it was handed: the rebuild after an injury must get the
// kickoff's.
const calls = vi.hoisted(() => [] as [number, number | undefined][]);
vi.mock('./match/lineup', async (load) => {
  const real = await load<typeof import('./match/lineup')>();
  return {
    ...real,
    buildLineup: (...args: Parameters<typeof real.buildLineup>) => {
      calls.push([args[1].id, args[5]]);
      return real.buildLineup(...args);
    },
  };
});

const { skill, useKnocks } = await import('./attributes');
const { knockFor } = await import('./familiarity');
const { createLeague } = await import('./generate');
const { buildLineup, DAY_SD, teamDay } = await import('./match/lineup');
const { simulateGame } = await import('./match/gameSim');
type Lineup = import('./match/lineup').Lineup;

/** The men a lineup lines up at its positions (the ones `buildLineup` reads knocks for). */
const slotted = (l: Lineup) => [
  ...new Set([
    l.qb,
    ...l.rbs,
    ...l.wrs,
    ...(l.wr4 ? [l.wr4] : []),
    ...l.tes,
    ...l.ol,
    ...l.dt,
    ...l.edge,
    ...l.lb,
    ...l.cb,
    ...l.s,
    ...l.rushRotation,
    l.k,
    l.p,
  ]),
];

describe("a team's day (parity)", () => {
  it('is drawn from the game seed and the team alone', () => {
    expect(teamDay('s:2026:7', 3)).toBe(teamDay('s:2026:7', 3));
    expect(teamDay('s:2026:7', 3)).not.toBe(teamDay('s:2026:7', 4));
    expect(teamDay('s:2026:7', 3)).not.toBe(teamDay('s:2026:8', 3));
  });

  it('averages zero, DAY_SD either side', () => {
    const d = Array.from({ length: 4000 }, (_, i) => teamDay(`p:${i}`, i % 32));
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    const sd = Math.sqrt(d.reduce((a, b) => a + (b - mean) ** 2, 0) / d.length);
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(sd / DAY_SD).toBeGreaterThan(0.95);
    expect(sd / DAY_SD).toBeLessThan(1.05);
  });

  it('lifts every man in the lineup, a fill-in on top of his position knock', () => {
    const l = createLeague({ seed: 'parity-day' });
    const team = l.teams[0];
    // A safety at corner, so one man plays out of position.
    const fill = l.players[team.depthChart.S[0]];
    team.depthChart.CB = [fill.id, ...team.depthChart.CB.filter((id) => id !== fill.id)];
    const plain = buildLineup(l, team);
    const day = buildLineup(l, team, new Set(), undefined, undefined, 1);
    expect(day.cb).toContain(fill);
    for (const p of slotted(day)) expect(day.knocks.get(p.id)).toBeCloseTo((plain.knocks.get(p.id) ?? 0) - 1, 9);
    expect(day.knocks.get(fill.id)).toBeCloseTo(knockFor(fill, 'CB') - 1, 9);
    const qb = day.qb;
    const base = skill(qb, 'pocketPresence');
    const prev = useKnocks(day.knocks);
    const up = skill(qb, 'pocketPresence');
    useKnocks(prev);
    expect(up - base).toBeCloseTo(1, 9);
  });

  it('is no edge when no day is passed', () => {
    const l = createLeague({ seed: 'parity-day' });
    const team = l.teams[0];
    expect([...buildLineup(l, team, new Set(), undefined, undefined, 0).knocks]).toEqual([
      ...buildLineup(l, team).knocks,
    ]);
  });

  it('decides some games: a sharp home day against a flat road day moves the margin', () => {
    const l = createLeague({ seed: 'parity-day' });
    const margin = (days: [number, number]) => {
      let sum = 0;
      for (let i = 0; i < 40; i++) {
        const r = simulateGame(l, l.games[0], { seed: `m:${i}`, days });
        sum += r.homeScore - r.awayScore;
      }
      return sum / 40;
    };
    expect(margin([0.5, -0.5]) - margin([0, 0])).toBeGreaterThan(3);
  }, 120_000);

  it('hands each lineup its own day, the rebuild after an injury too, and replays it from the seed', () => {
    const l = createLeague({ seed: 'parity-day' });
    let rebuilt = 0;
    for (const g of l.games.filter((x) => x.week <= 3)) {
      calls.length = 0;
      const base = `${l.seed}:${g.season}:${g.id}`;
      simulateGame(l, g);
      expect(calls.length).toBeGreaterThanOrEqual(2);
      for (const [teamId, day] of calls) expect(day).toBe(teamDay(base, teamId));
      if (calls.length > 2) rebuilt++;
    }
    expect(rebuilt).toBeGreaterThan(0);
    const g = l.games[0];
    expect(simulateGame(l, g, { seed: 'again' })).toEqual(simulateGame(l, g, { seed: 'again' }));
  }, 60_000);
});
