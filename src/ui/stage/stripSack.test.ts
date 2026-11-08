import { describe, expect, it } from 'vitest';
import { buildPath } from '../../engine/field/ballPath';
import { HOP_PEAK } from '../../engine/field/fumble';
import type { PlayLogEntry } from '../../engine/types';

describe('a strip-sack at the line (0.4.14)', () => {
  it('has the ball come out at the sack spot: the carry never passes the line', () => {
    // Offense 0 is home: it drives toward higher x, and a sack for 0 yards is down on the line at 30.
    for (let clock = 1; clock <= 120; clock++) {
      const e = {
        quarter: 2,
        clock,
        offense: 0,
        down: 2,
        distance: 7,
        yardLine: 30,
        text: 'A.Passer SACKED by B.Rush for 0 yards. FUMBLE, recovered by C.Line',
        homeScore: 0,
        awayScore: 0,
        kind: 'sack',
        from: 30,
        to: 30,
        loose: 30,
      } as PlayLogEntry;
      const segs = buildPath(e, 0, 26.65);
      const hop = segs.findIndex((s) => s.peak > 0 && s.peak <= HOP_PEAK);
      expect(hop).toBeGreaterThan(0);
      for (const s of segs.slice(0, hop)) expect(Math.max(s.x0, s.x1), `clock ${clock}`).toBeLessThanOrEqual(30 + 1e-9);
    }
  });
});
