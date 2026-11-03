import { describe, expect, it } from 'vitest';
import {
  CHEM,
  chemistryOf,
  complacent,
  COMPLACENCY,
  chemistryWeek,
  moodPart,
  seasonsTogether,
  wordOf,
  type ChemRoom,
  freshChemistry,
} from './chemistry';
import { createLeague } from './generate';
import { playWeek } from './league';
import { buildLineup } from './match/lineup';
import { simulateGame, type SimOptions } from './match/gameSim';
import { starters } from './roster';
import type { GameResult, League } from './types';

const ROOMS: ChemRoom[] = ['QB', 'RB', 'WR', 'OL', 'DL', 'LB', 'DB'];
const base = (() => {
  const l = createLeague({ seed: 'chemistry' });
  playWeek(l);
  playWeek(l);
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(base);

describe('chemistry: time together', () => {
  it('counts shared past seasons and part of this one, at most three, and none without a record', () => {
    const l = fresh();
    const [a, b] = starters(l, l.teams[0], 'OL');
    const t = l.teams[0].id;
    a.statTeams = { [l.season - 2]: [t], [l.season - 1]: [t], [l.season]: [t] };
    b.statTeams = { [l.season - 2]: [t], [l.season - 1]: [t, 9], [l.season]: [t] };
    const part = seasonsTogether(l, a, b, t);
    expect(part).toBeGreaterThan(2);
    expect(part).toBeLessThan(3);
    a.statTeams = { ...a.statTeams, [l.season - 3]: [t], [l.season - 4]: [t] };
    b.statTeams = { ...b.statTeams, [l.season - 3]: [t], [l.season - 4]: [t] };
    expect(seasonsTogether(l, a, b, t)).toBe(CHEM.maxSeasons);
    delete b.statTeams;
    expect(seasonsTogether(l, a, b, t)).toBe(0);
  });

  it('a room short of men has no time part, and still an edge', () => {
    const l = fresh();
    const team = l.teams[0];
    // One lineman left on the chart: no pair to read.
    team.depthChart.OL = team.depthChart.OL.slice(0, 1);
    const c = chemistryOf(l, team.id, 'OL')!;
    expect(c.together).toBeNull();
    expect(Number.isFinite(c.edge)).toBe(true);
  });

  it('a new league reads no time together anywhere, and nobody is still learning each other for it', () => {
    const l = createLeague({ seed: 'chemistry-new' });
    for (const c of chemistryWeek(l).values()) {
      if (c.together !== null) expect(c.together).toBe(0);
      expect(c.word).not.toBe('Still learning each other');
    }
  });
});

describe('chemistry: the week', () => {
  it('reads time together only for the line, the secondary and the passing game', () => {
    const l = fresh();
    const week = chemistryWeek(l);
    for (const t of l.teams)
      for (const r of ROOMS) {
        const c = week.get(`${t.id}:${r}`)!;
        if (r === 'RB' || r === 'DL' || r === 'LB') expect(c.together).toBeNull();
        else expect(c.together).not.toBeNull();
      }
  });

  it('is centred on the league and inside its caps', () => {
    const l = fresh();
    const week = chemistryWeek(l);
    for (const r of ROOMS) {
      const edges = l.teams.map((t) => week.get(`${t.id}:${r}`)!.edge);
      expect(Math.abs(edges.reduce((a, b) => a + b, 0) / edges.length)).toBeLessThan(0.01);
    }
    for (const c of week.values()) {
      expect(Math.abs(c.edge)).toBeLessThanOrEqual(CHEM.cap + 1e-9);
      expect(Math.abs(c.mood)).toBeLessThanOrEqual(CHEM.mood + 1e-9);
      if (c.together !== null) expect(Math.abs(c.together)).toBeLessThanOrEqual(CHEM.together + 1e-9);
    }
  });

  it('a divided room plays worse than its average says', () => {
    expect(moodPart(0.5, 0, true)).toBeCloseTo(moodPart(0.5, 0, false) - CHEM.split, 9);
    expect(moodPart(-9, 0, true)).toBe(-CHEM.mood);
    expect(moodPart(9, 0, false)).toBe(CHEM.mood);
  });

  it('names the word from the edge and the time part', () => {
    expect(wordOf(0.15, 0)).toBe('Clicking');
    expect(wordOf(0.149, 0)).toBe('Gelling');
    expect(wordOf(-0.15, 0)).toBe('Out of sync');
    expect(wordOf(0, -0.06)).toBe('Still learning each other');
    expect(wordOf(0, null)).toBe('Gelling');
  });
});

describe('chemistry: game day', () => {
  const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const replay = (l: League, chemistry: NonNullable<SimOptions['chemistry']>, n = 40) =>
    Array.from({ length: n }, (_, i) => simulateGame(l, l.games[0], { seed: `c:${i}`, days: [0, 0], chemistry }));

  // Three tests, not one: each plays hundreds of games, and one long test can starve the test worker.
  it('a line forced to each end allows fewer sacks and gains more a carry at its best', () => {
    const l = fresh();
    const lineUp = replay(l, [{ OL: 0.3 }, {}], 200);
    const lineDown = replay(l, [{ OL: -0.3 }, {}], 200);
    const sackRate = (rs: GameResult[]) =>
      avg(rs.map((r) => r.home.sacked / Math.max(1, r.home.passAtt + r.home.sacked)));
    const ypc = (rs: GameResult[]) => avg(rs.map((r) => r.home.rushYds / Math.max(1, r.home.rushAtt)));
    expect(sackRate(lineUp)).toBeLessThan(sackRate(lineDown));
    expect(ypc(lineUp)).toBeGreaterThan(ypc(lineDown));
  }, 240_000);

  it('a secondary at its best allows fewer yards a pass', () => {
    const l = fresh();
    const ypa = (rs: GameResult[]) => avg(rs.map((r) => r.home.passYds / Math.max(1, r.home.passAtt)));
    expect(ypa(replay(l, [{}, { DB: 0.3 }]))).toBeLessThan(ypa(replay(l, [{}, { DB: -0.3 }])));
  }, 240_000);

  it('a passing game at its best completes more', () => {
    const l = fresh();
    const cmp = (rs: GameResult[]) => avg(rs.map((r) => r.home.passCmp / Math.max(1, r.home.passAtt)));
    expect(cmp(replay(l, [{ QB: 0.3, WR: 0.3 }, {}], 200))).toBeGreaterThan(
      cmp(replay(l, [{ QB: -0.3, WR: -0.3 }, {}], 200)),
    );
  }, 240_000);

  it('plays the same game twice with chemistry on', () => {
    const a = simulateGame(fresh(), fresh().games[0]);
    const l = fresh();
    const b = simulateGame(l, l.games[0]);
    expect([b.homeScore, b.awayScore, b.home.totalYds]).toEqual([a.homeScore, a.awayScore, a.home.totalYds]);
  }, 60_000);

  it('reads the depth chart as it is now', () => {
    const l = fresh();
    const team = l.teams[0];
    const before = chemistryOf(l, team.id, 'OL')!;
    expect(chemistryWeek(l).size).toBeGreaterThan(0);
    // A rookie with no history replaces a starter after the week is cached: the line's time together drops.
    const chart = team.depthChart.OL;
    const sixth = l.players[chart[5]];
    sixth.statTeams = {};
    [chart[0], chart[5]] = [chart[5], chart[0]];
    for (const id of chart.slice(0, 5)) if (id !== sixth.id) l.players[id].statTeams ??= {};
    const after = chemistryOf(l, team.id, 'OL')!;
    expect(after.newStarters).toBeGreaterThanOrEqual(before.newStarters);
    expect(after.years!).toBeLessThanOrEqual(before.years!);
  });

  it('gives no edge outside a game', () => {
    const l = fresh();
    const team = l.teams[0];
    expect([...buildLineup(l, team).knocks]).toEqual([
      ...buildLineup(l, team, new Set(), undefined, undefined, 0).knocks,
    ]);
    const inGame = buildLineup(l, team, new Set(), l.games[0], 0, 0, { OL: 0.3 });
    const ol = starters(l, team, 'OL')[0];
    expect(inGame.knocks.get(ol.id) ?? 0).toBeLessThan(
      buildLineup(l, team, new Set(), l.games[0], 0, 0, { OL: 0 }).knocks.get(ol.id) ?? 0,
    );
  });
});

describe('chemistry: complacency', () => {
  it("a winning club's happy room loses part of its edge; a .500 club's keeps it", () => {
    expect(complacent(0.4, 0.5, false)).toBe(0.4);
    expect(complacent(0.4, 0.8, false)).toBeCloseTo(0.4 * (1 - COMPLACENCY.max), 9);
    const partway = complacent(0.4, 0.65, false);
    expect(partway).toBeLessThan(0.4);
    expect(partway).toBeGreaterThan(0.4 * (1 - COMPLACENCY.max));
  });

  it('never softens a bad mood, and a driven voice keeps a room hungry', () => {
    expect(complacent(-0.4, 0.9, false)).toBe(-0.4);
    expect(complacent(0.4, 0.9, true)).toBe(0.4);
  });

  it('marks a room comfortable only when winning took something off it', () => {
    const l = fresh();
    for (const c of chemistryWeek(l).values()) if (c.comfortable) expect(c.mood).toBeGreaterThanOrEqual(0);
  });
});

describe('chemistry: the review’s fixes', () => {
  it('a mood changed after the week was read reaches Sunday', () => {
    const l = fresh();
    const before = chemistryOf(l, l.userTeamId, 'OL')!.mood;
    for (const id of l.teams[l.userTeamId].depthChart.OL) {
      const p = l.players[id];
      if (p.teamId === l.userTeamId) p.morale = { level: -9, jolts: [] };
    }
    // Game day reads the league fresh (playWeek and a live game's kickoff call this).
    freshChemistry(l);
    expect(chemistryOf(l, l.userTeamId, 'OL')!.mood).toBeLessThan(before);
  });

  it('this week’s results don’t change this week’s read', () => {
    const l = fresh();
    for (let i = 0; i < 3; i++) playWeek(l);
    const a = chemistryWeek(l);
    const b: League = JSON.parse(JSON.stringify(l));
    const g = b.games.find((x) => x.season === b.season && x.week === b.week && !x.result)!;
    g.result = { ...b.games.find((x) => x.result)!.result!, homeScore: 60, awayScore: 0 };
    const edges = (m: Map<string, { edge: number }>) => [...m.values()].map((c) => c.edge.toFixed(9));
    expect(edges(chemistryWeek(b))).toEqual(edges(a));
  });
});
