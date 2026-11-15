import { afterEach, describe, expect, it } from 'vitest';
import { createLeague, FOUNDING, FOUNDING_GROWTH } from './generate';
import { growsUntil } from './development';
import { playerOvr } from './positions';

afterEach(() => {
  FOUNDING.on = true;
});

describe('a new league built as a settled one carries its players (A2)', () => {
  it("scales young founding players' growth without moving a draw: the same men, ratings, names, positions and numbers", () => {
    FOUNDING.on = false;
    const today = createLeague({ seed: 'found-draws' });
    FOUNDING.on = true;
    const settled = createLeague({ seed: 'found-draws' });
    const who = (l: typeof today) =>
      Object.values(l.players).map((p) => [
        p.id,
        p.age,
        p.firstName,
        p.lastName,
        p.position,
        p.jersey,
        p.teamId,
        playerOvr(p),
      ]);
    expect(who(settled)).toEqual(who(today));
    // Only their ceilings move: some founding players have less growth ahead of them.
    const moved = Object.values(settled.players).filter((p) => p.potential !== today.players[p.id].potential);
    expect(moved.length).toBeGreaterThan(Object.keys(settled.players).length / 4);
  });

  it("gives a young founding player a settled league's growth still ahead of him", () => {
    const l = createLeague({ seed: 'found-growth' });
    const ahead = new Map<number, number[]>();
    for (const p of Object.values(l.players)) {
      const left = growsUntil(p.position) - p.age;
      if (FOUNDING_GROWTH[left] === undefined) continue;
      ahead.set(left, [...(ahead.get(left) ?? []), p.potential - playerOvr(p)]);
    }
    expect(ahead.size).toBeGreaterThan(0);
    for (const [left, xs] of ahead) {
      if (xs.length < 40) continue;
      const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
      // The ceiling is clamped at his overall and at 20, so a mean lands a little off its target.
      expect(Math.abs(mean - FOUNDING_GROWTH[left]!)).toBeLessThan(0.35);
    }
  });
});
