import { describe, expect, it } from 'vitest';
import { kneelOdds, meanSeconds, playSeconds, playsSafe, type PlayTimeFacts, type PlayTimeKind } from './playTime';

const KINDS: PlayTimeKind[] = ['incomplete', 'catch', 'run', 'scramble', 'return', 'punt', 'fairCatch', 'kickoff'];
const half = (over: Partial<Parameters<typeof kneelOdds>[0]> = {}) =>
  kneelOdds({ clock: 30, yardLine: 25, timeouts: 2, appetite: 0, ...over });

describe("a play's time", () => {
  it('takes longer the deeper an incompletion was thrown', () => {
    const at = (air: number) => meanSeconds({ kind: 'incomplete', yards: 0, air });
    expect(at(-3)).toBeLessThan(at(5));
    expect(at(5)).toBeLessThan(at(15));
    expect(at(15)).toBeLessThan(at(30));
    expect(Math.abs(at(30) - 5.73)).toBeLessThan(0.3);
  });

  it('grows with the yards on catches and runs', () => {
    for (const kind of ['catch', 'run'] as const) {
      const ys = [2.5, 7, 14.5, 29.5, 55].map((yards) => meanSeconds({ kind, yards }));
      for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThan(ys[i - 1]);
    }
    expect(Math.abs(meanSeconds({ kind: 'run', yards: 55 }) - 9.55)).toBeLessThan(0.4);
  });

  it('reads the NFL out of bounds late on its own table', () => {
    expect(Math.abs(meanSeconds({ kind: 'run', yards: 7, outOfBounds: true }) - 5.78)).toBeLessThan(0.4);
    expect(Math.abs(meanSeconds({ kind: 'catch', yards: 7, outOfBounds: true }) - 4.93)).toBeLessThan(0.3);
    expect(meanSeconds({ kind: 'run', yards: 7, outOfBounds: true })).toBeGreaterThan(
      meanSeconds({ kind: 'run', yards: 7 }),
    );
  });

  it('times kicks: a returned punt outlasts a fair catch', () => {
    expect(Math.abs(meanSeconds({ kind: 'punt', yards: 9.5 }) - 10.91)).toBeLessThan(0.3);
    expect(meanSeconds({ kind: 'punt', yards: 9.5 })).toBeGreaterThan(meanSeconds({ kind: 'fairCatch', yards: 0 }));
    expect(Math.abs(meanSeconds({ kind: 'kickoff', yards: 26 }) - 5.74)).toBeLessThan(0.3);
  });

  it('draws whole seconds, at least one, centred on the mean', () => {
    for (const kind of KINDS) {
      const f: PlayTimeFacts = { kind, yards: kind === 'run' ? -3 : 0, air: -5 };
      expect(playSeconds(f, 0)).toBeGreaterThanOrEqual(1);
      let sum = 0;
      for (let i = 0; i < 500; i++) {
        const s = playSeconds({ kind, yards: 10, air: 10 }, (i + 0.5) / 500);
        expect(Number.isInteger(s)).toBe(true);
        sum += s;
      }
      expect(Math.abs(sum / 500 - meanSeconds({ kind, yards: 10, air: 10 }))).toBeLessThan(0.5);
    }
  });
});

describe("the half's last possession", () => {
  it('never kneels past midfield', () => {
    expect(half({ yardLine: 50 })).toBe(0);
    expect(half({ yardLine: 70, clock: 5 })).toBe(0);
  });

  it('kneels less with each timeout and more as the clock runs', () => {
    expect(half({ timeouts: 0 })).toBeGreaterThan(half({ timeouts: 1 }));
    expect(half({ timeouts: 1 })).toBeGreaterThan(half({ timeouts: 3 }));
    expect(half({ clock: 60 })).toBeLessThan(half({ clock: 30 }));
    expect(half({ clock: 30 })).toBeLessThan(half({ clock: 15 }));
    expect(half({ clock: 15, timeouts: 1 })).toBeGreaterThan(0.6);
    expect(half({ clock: 30, timeouts: 3 })).toBeLessThan(0.12);
  });

  it('leans on the head coach: an aggressive one tries more', () => {
    expect(half({ appetite: 1 })).toBeLessThan(half());
    const cautious = half({ appetite: -1 }) - half();
    expect(cautious).toBeGreaterThan(0.03);
    expect(cautious).toBeLessThan(0.08);
  });
});

describe('playing it safe from deep (0.4.14)', () => {
  it('throws short only while a trying drive is inside its own 35', () => {
    expect(playsSafe(true, 20)).toBe(true);
    expect(playsSafe(true, 34)).toBe(true);
    expect(playsSafe(true, 35)).toBe(false);
    expect(playsSafe(true, 40)).toBe(false);
    expect(playsSafe(false, 20)).toBe(false);
  });
});
