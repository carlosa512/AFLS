import { describe, expect, it } from 'vitest';
import { CHEM, chemistryOf, chemistryWeek, moodPart, seasonsTogether, wordOf, type ChemRoom } from './chemistry';
import { createLeague } from './generate';
import { playWeek } from './league';
import { starters } from './roster';
import type { League } from './types';

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
