import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Rng } from '../rng';
import { man, startOf, pinKnobs } from './fixtures';
import { FIELD_W, MID } from './geometry';
import { runField } from './run';

describe("the carrier's read", () => {
  let restore: () => void;
  beforeAll(() => {
    restore = pinKnobs();
  });
  afterAll(() => restore());

  it('takes the open lane', () => {
    // A wall to his left (low y), nothing to his right.
    const players = [
      man(1, 0, 'RB', 50, MID, { vx: 6 }),
      ...[2, 4, 6, 8, 10].map((k, i) => man(30 + i, 1, 'LB', 57, MID - k)),
    ];
    let right = 0;
    for (let i = 0; i < 40; i++) {
      const r = runField(startOf({ players }), new Rng(`lane:${i}`));
      const y = r.frames[(10 * players.length + 0) * 2 + 1];
      if (y > MID + 0.5) right++;
    }
    expect(right).toBeGreaterThanOrEqual(36);
  });

  it('keeps off the sideline unless the clock wants him out, goes out when cornered, and stays in when told', () => {
    // Open field, near the sideline, the goal 30 yards on: he scores in bounds.
    const open = [man(1, 0, 'RB', 70, 5, { vx: 7 }), man(30, 1, 'CB', 40, 40)];
    for (let i = 0; i < 20; i++) {
      const r = runField(startOf({ players: open }), new Rng(`open:${i}`));
      expect(r.touchdown).toBe(true);
      expect(r.outOfBounds).toBe(false);
    }
    // A defender coming 8 yards ahead and the hurry-up on: he gets out.
    const chased = [man(1, 0, 'RB', 50, 8, { vx: 7 }), man(30, 1, 'S', 58, 14)];
    let out = 0;
    for (let i = 0; i < 20; i++)
      if (
        runField(startOf({ players: chased, clock: { outOfBounds: true, stayIn: false } }), new Rng(`hurry:${i}`))
          .outOfBounds
      )
        out++;
    expect(out).toBeGreaterThanOrEqual(16);
    // Cornered on the sideline: out, unless milking the clock.
    const cornered = [
      man(1, 0, 'RB', 50, 2, { vx: 1 }),
      man(30, 1, 'CB', 53.5, 1.5),
      man(31, 1, 'LB', 53.5, 4),
      man(32, 1, 'LB', 52.5, 6),
      man(33, 1, 'S', 50.5, 6.5),
      man(34, 1, 'LB', 48.5, 6),
    ];
    let gone = 0;
    for (let i = 0; i < 20; i++) {
      if (runField(startOf({ players: cornered }), new Rng(`corner:${i}`)).outOfBounds) gone++;
      const kept = runField(
        startOf({ players: cornered, clock: { outOfBounds: false, stayIn: true } }),
        new Rng(`in:${i}`),
      );
      expect(kept.outOfBounds).toBe(false);
    }
    expect(gone).toBeGreaterThanOrEqual(12);
    expect(FIELD_W).toBeGreaterThan(53);
  });

  it('steps out rather than take a hit when the sideline is near, and takes it when milking the clock', () => {
    // A lane upfield, but a safety about to arrive and the sideline three yards off.
    const players = [man(1, 0, 'RB', 50, 3.5, { vx: 5 }), man(30, 1, 'S', 57, 9, { vx: -3, vy: -3 })];
    let out = 0;
    for (let i = 0; i < 20; i++) {
      if (runField(startOf({ players }), new Rng(`step:${i}`)).outOfBounds) out++;
      expect(
        runField(startOf({ players, clock: { outOfBounds: false, stayIn: true } }), new Rng(`stay:${i}`)).outOfBounds,
      ).toBe(false);
    }
    expect(out).toBeGreaterThanOrEqual(14);
  });

  it('stretches an outside run toward the play side before he turns up', () => {
    const players = [man(1, 0, 'RB', 50, MID, { vx: 5 }), man(30, 1, 'LB', 58, MID - 3), man(31, 1, 'S', 65, MID + 2)];
    let wide = 0;
    let plain = 0;
    for (let i = 0; i < 40; i++) {
      const y = (stretch?: 1) =>
        runField(startOf({ players, ...(stretch ? { stretch } : {}) }), new Rng(`stretch:${i}`)).frames[16 * 3 * 2 + 1];
      wide += y(1) - MID;
      plain += y() - MID;
    }
    expect(wide / 40).toBeGreaterThan(plain / 40 + 0.5);
  });
});
