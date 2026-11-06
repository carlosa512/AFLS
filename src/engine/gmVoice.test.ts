import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { HABITS, HABIT_IDS, aiGm, type HabitId } from './gmHabits';
import { ago, directorTip, habitFacts, noticed, patternLine, reputation } from './gmVoice';
import { ARCHETYPE_ACTIVITY } from './gmTraits';
import type { GeneralManager, League, Team, TradeSide } from './types';

function setup(): { l: League; team: Team; gm: GeneralManager } {
  const l = createLeague({ seed: 'gm-voice' });
  const team = l.teams.find((t) => t.id !== l.userTeamId)!;
  return { l, team, gm: aiGm(l, team)! };
}
const anyPlayer = (l: League) => Number(Object.keys(l.players)[0]);

describe('gmVoice', () => {
  it('reads a reputation from the two most distinctive dials, shared phrases possible', () => {
    const { l, team, gm } = setup();
    team.gm = { ...team.gm, archetype: 'Hard-Liner', stubbornness: 0.9, winNow: 0.5, loyalty: 0.5, capAggression: 0.5 };
    const s = reputation(l, gm);
    expect(s).toMatch(/hard bargain|an inch/);
    expect(s.startsWith("He's ")).toBe(true);
    expect(s.endsWith('.')).toBe(true);
    team.gm = { ...team.gm, archetype: 'Balanced', stubbornness: 0.5, winNow: 0.5, loyalty: 0.5, capAggression: 0.5 };
    expect(reputation(l, gm)).toBe('Hard to pin down.');
    expect(reputation(l, gm, 'fragment')).toBe('hard to pin down');
    team.gm = { ...team.gm, archetype: 'Balanced', stubbornness: 0.95, winNow: 0.5, loyalty: 0.5, capAggression: 0.5 };
    expect(reputation(l, gm, 'fragment')).not.toContain(';');
    team.gm = { ...team.gm, stubbornness: 0.95, winNow: 0.05, loyalty: 0.5, capAggression: 0.5 };
    expect(reputation(l, gm)).toMatch(/^He's .+, and .+\.$/);
    expect(reputation(l, gm, 'fragment')).toContain('; ');
  });

  it('groups the log into facts by evidence and age', () => {
    const { l, gm } = setup();
    const id = anyPlayer(l);
    l.season = 2030;
    gm.habitLog = [
      { habit: 'swaps', season: 2030, teamId: 1, playerId: id },
      { habit: 'swaps', season: 2028, teamId: 1, playerId: id },
      { habit: 'bpa', season: 2029, teamId: 1, playerId: id },
      { habit: 'hisGuys', season: 2020, teamId: 1, playerId: id },
      { habit: 'gunShy', season: 2029, teamId: 1, playerId: id, pos: 'QB' },
    ];
    const f = habitFacts(l, gm);
    const by = (h: HabitId) => f.find((x) => x.habit === h)!;
    expect(by('swaps')).toMatchObject({ evidence: 'habit', count: 2, ago: 0 });
    expect(by('bpa')).toMatchObject({ evidence: 'once', ago: 1 });
    expect(by('hisGuys')).toMatchObject({ evidence: 'faded', count: 0 });
    expect(by('gunShy').pos).toBe('QB');
    expect(f.map((x) => x.ago)).toEqual([...f.map((x) => x.ago)].sort((a, b) => a - b));
  });

  it('says once, habit and faded differently, steady within a season', () => {
    const { l, gm } = setup();
    const id = anyPlayer(l);
    const log = (seasons: number[]) =>
      (gm.habitLog = seasons.map((season) => ({ habit: 'bridgeQb', season, teamId: 1, playerId: id })));
    l.season = 2030;
    log([2030]);
    const once = noticed(l, gm);
    expect(noticed(l, gm)).toEqual(once);
    log([2030, 2029]);
    const habit = noticed(l, gm);
    log([2020]);
    const faded = noticed(l, gm);
    expect(new Set([once[0], habit[0], faded[0]]).size).toBe(3);
    expect(once.length).toBeLessThanOrEqual(2);
  });

  it('never names a habit or an archetype', () => {
    const { l, gm } = setup();
    const id = anyPlayer(l);
    const bad = [...HABIT_IDS.map((h) => HABITS[h].label), ...Object.keys(ARCHETYPE_ACTIVITY)];
    for (const season of [2030, 2029, 2020]) {
      for (const habit of HABIT_IDS) {
        l.season = 2030;
        gm.habitLog = [{ habit, season, teamId: 1, playerId: id, pos: 'QB' }];
        const lines = [...noticed(l, gm), reputation(l, gm)];
        for (const t of lines) {
          for (const b of bad) expect(t).not.toContain(b);
          expect(t).not.toMatch(/\b(19|20)\d\d\b/);
          expect(t).not.toMatch(/[{}]/);
        }
      }
    }
    const e = { ...gm.habitLog![0] };
    for (const habit of ['firstsForStars', 'swaps', 'sellsEarly', 'hisGuys']) {
      const t = patternLine(l, gm, { ...e, habit, season: 2030 }, { ...e, habit, season: 2027 });
      expect(t).not.toMatch(/[{}]/);
      expect(t).not.toMatch(/\b(19|20)\d\d\b/);
      expect(t).toContain(gm.lastName);
    }
    expect(
      patternLine(l, gm, { ...e, habit: 'swaps', season: 2030 }, { ...e, habit: 'swaps', season: 2027 }),
    ).toContain('three years');
  });

  it('skips a fact whose player is gone', () => {
    const { l, gm } = setup();
    gm.habitLog = [{ habit: 'swaps', season: l.season, teamId: 1, playerId: 99999999 }];
    expect(habitFacts(l, gm)).toEqual([]);
    expect(noticed(l, gm)).toEqual([]);
  });

  it('writes ago in plain words', () => {
    expect(ago(0)).toBe('this year');
    expect(ago(1)).toBe('last year');
    expect(ago(2)).toBe('two years ago');
    expect(ago(2, 'draft')).toBe('two drafts ago');
    expect(ago(5)).toBe('a few years back');
  });

  it('tips only from facts the deal bears on', () => {
    const { l, team, gm } = setup();
    const mine = l.teams.find((t) => t.id === l.userTeamId)!;
    const p = Object.values(l.players).find((x) => x.teamId === mine.id)!;
    const sides = [
      { teamId: mine.id, players: [p.id], picks: [] },
      { teamId: team.id, players: [], picks: [] },
    ] as [TradeSide, TradeSide];
    gm.habitLog = [];
    expect(directorTip(l, team, sides)).toBeNull();
    // a straight swap needs players both ways and a swaps fact
    const q = Object.values(l.players).find((x) => x.teamId === team.id)!;
    const swap = [
      { teamId: mine.id, players: [p.id], picks: [] },
      { teamId: team.id, players: [q.id], picks: [] },
    ] as [TradeSide, TradeSide];
    gm.habitLog = [{ habit: 'swaps', season: l.season, teamId: team.id, playerId: p.id }];
    expect(directorTip(l, team, swap)).toContain('straight swap');
    expect(directorTip(l, team, sides)).toBeNull();
    gm.habitLog = [{ habit: 'bpa', season: l.season, teamId: team.id, playerId: p.id }];
    expect(directorTip(l, team, swap)).toBeNull();
  });
});
