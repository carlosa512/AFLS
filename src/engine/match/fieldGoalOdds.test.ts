import { describe, expect, it } from 'vitest';
import { fieldGoalOdds, KICK_FLOOR, kickNow } from './coach';
import type { Situation } from './coach';

describe('a field goal as the coaches read it', () => {
  it('reads a kicker of 12 at 95% from 35, 85% from 45 and 71% from 52 on a typical day', () => {
    expect(fieldGoalOdds(35, 12, 0)).toBeCloseTo(0.947, 2);
    expect(fieldGoalOdds(45, 12, 0)).toBeCloseTo(0.846, 2);
    expect(fieldGoalOdds(52, 12, 0)).toBeCloseTo(0.707, 2);
  });

  it('plays a kick longer into the weather, and gives up on one far past his range', () => {
    expect(fieldGoalOdds(52, 12, 8)).toBeLessThan(fieldGoalOdds(52, 12, 0));
    // A 52-yarder for a kicker of 10 into a 32 mph wind (about 17 yards longer): a fifth of a chance.
    expect(fieldGoalOdds(52, 10, 16.8)).toBeCloseTo(0.203, 2);
    expect(fieldGoalOdds(52, 10, 16.8)).toBeLessThan(KICK_FLOOR);
    expect(fieldGoalOdds(75, 12, 0)).toBe(0);
  });

  it('kicks at the gun only when the kick clears the floor', () => {
    const s = { quarter: 4, overtime: false, scoreDiff: -3, clock: 3, down: 3, offTimeouts: 0 } as Situation;
    expect(kickNow({ ...s, fgMakeProb: KICK_FLOOR })).toBe(true);
    expect(kickNow({ ...s, fgMakeProb: KICK_FLOOR - 0.01 })).toBe(false);
  });
});
