import { describe, expect, it } from 'vitest';
import { chairOf, coachMarket, hireCoach, releaseCoach, sameChair, teamCoaches } from '../coaching';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { beginOffseason } from '../offseason';
import type { Coach } from '../types';
import {
  credibilityOf,
  credibilityRead,
  credibilityTick,
  credibilityWeek,
  shiftCredibility,
  startHeadCoach,
} from './credibility';

describe("a head coach's credibility", () => {
  it('reads in words at the spec thresholds', () => {
    for (const [v, r] of [
      [0.4, 'believes'],
      [0, 'steady'],
      [-0.2, 'heardBefore'],
      [-0.5, 'wornThin'],
    ] as const) {
      const c = { credibility: v } as Coach;
      expect(credibilityRead(c)).toBe(r);
    }
    expect(credibilityRead({} as Coach)).toBe('steady');
  });

  it('drifts toward the middle and moves with a streak', () => {
    const calm = { credibility: 0.5 } as Coach;
    credibilityTick(calm, '');
    expect(credibilityOf(calm)).toBeCloseTo(0.485, 6);
    const losing = { credibility: 0.5 } as Coach;
    credibilityTick(losing, 'L3');
    expect(credibilityOf(losing)).toBeLessThan(credibilityOf(calm));
    const winning = { credibility: 0.5 } as Coach;
    credibilityTick(winning, 'W4');
    expect(credibilityOf(winning)).toBeGreaterThan(credibilityOf(calm));
    // Two in a row is no streak.
    const two = { credibility: 0.5 } as Coach;
    credibilityTick(two, 'L2');
    expect(credibilityOf(two)).toBeCloseTo(0.485, 6);
  });

  it("the league's week drifts every head coach in a chair", () => {
    const l = createLeague({ seed: 'cred-week' });
    const hc = teamCoaches(l, 3).find((c) => c.role === 'headCoach')!;
    hc.credibility = 0.5;
    credibilityWeek(l);
    expect(credibilityOf(hc)).toBeCloseTo(0.485, 6);
  });

  it('a new head coach starts at 0 with two new-voice meetings', () => {
    const c = { credibility: -0.8 } as Coach;
    startHeadCoach(c);
    expect(c.credibility).toBe(0);
    expect(c.newVoice).toBe(2);
  });

  it('clamps to −1…1', () => {
    const c = {} as Coach;
    shiftCredibility(c, -5);
    expect(credibilityOf(c)).toBe(-1);
    shiftCredibility(c, 9);
    expect(credibilityOf(c)).toBe(1);
  });

  it('firing a head coach and hiring another starts the new one fresh', () => {
    const l = createLeague({ seed: 'cred-fire' });
    simToEndOfSeason(l);
    beginOffseason(l);
    const user = l.userTeamId;
    l.teams[user].staffBudgetMult = 3;
    const old = teamCoaches(l, user).find((c) => c.role === 'headCoach')!;
    const chair = chairOf(old);
    releaseCoach(l, user, old.id);
    const next = coachMarket(l).find((c) => sameChair(chairOf(c), chair) && c.id !== old.id)!;
    next.credibility = -0.7;
    hireCoach(l, user, next.id, 2);
    expect(next.credibility).toBe(0);
    expect(next.newVoice).toBe(2);
  });
});
