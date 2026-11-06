import { afterEach, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { aiGm, habitsForce } from './gmHabits';
import { habitsNewYear } from './gmHabitsYear';
import { simToEndOfSeason } from './league';
import { beginOffseason } from './offseason';
import type { League } from './types';

const ai = (l: League) => Object.values(l.gms).filter((g) => g.id !== l.userGmId);

afterEach(() => {
  habitsForce.all = null;
  habitsForce.off = false;
});

describe('habits at the new league year', () => {
  it('a new league’s AI GMs start on one active habit; yours never', () => {
    const l = createLeague({ seed: 'hy-start' });
    for (const g of ai(l)) expect(Object.keys(g.habits ?? {})).toHaveLength(1);
    expect(l.gms[l.userGmId].habits).toBeUndefined();
  });

  it('fades an unused habit and draws only for employed GMs; a GM between jobs keeps his marbles', () => {
    const l = createLeague({ seed: 'hy-fade' });
    const [a, b] = l.teams.filter((t) => t.id !== l.userTeamId).map((t) => aiGm(l, t)!);
    a.habitMarbles = { gunShy: 2 };
    b.habitMarbles = { gunShy: 2 };
    const grip = JSON.stringify(b.habits);
    b.teamId = null;
    b.traits = l.teams[l.userTeamId].gm;
    habitsNewYear(l);
    expect(b.habitMarbles.gunShy).toBe(2);
    expect(b.habitMarbles['fade:' + Object.keys(b.habits!)[0]]).toBe(1);
    expect(JSON.stringify(b.habits)).toBe(grip);
    expect(a.habitMarbles).toBeUndefined();
  });

  it('draws at the new league year through beginOffseason and replays identically', () => {
    const run = () => {
      const l = createLeague({ seed: 'hy-replay' });
      for (const g of ai(l)) g.habitMarbles = { gunShy: 1 };
      simToEndOfSeason(l);
      beginOffseason(l);
      return l;
    };
    const a = run();
    const b = run();
    expect(JSON.stringify(a.gms)).toBe(JSON.stringify(b.gms));
    expect(
      ai(a)
        .filter((g) => g.teamId !== null)
        .every((g) => !g.habitMarbles?.gunShy),
    ).toBe(true);
  }, 300_000);

  it('draws nothing while habitsForce is set', () => {
    const l = createLeague({ seed: 'hy-force' });
    const g = aiGm(l, l.teams.find((t) => t.id !== l.userTeamId)!)!;
    g.habitMarbles = { gunShy: 2 };
    habitsForce.off = true;
    habitsNewYear(l);
    expect(g.habitMarbles.gunShy).toBe(2);
  });
});
