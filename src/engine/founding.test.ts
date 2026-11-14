import { afterEach, describe, expect, it } from 'vitest';
import { createLeague, FOUNDING, FOUNDING_GROWTH, foundingLean } from './generate';
import { growsUntil } from './development';
import { playerOvr, STARTERS } from './positions';
import { POSITIONS } from './types';
import type { League } from './types';

/** Overall below his position's mean starter, pooled over the long- and short-prime positions, at the given ages. */
function below(l: League, ages: number[]): number {
  const starters = l.teams.flatMap((t) =>
    POSITIONS.flatMap((pos) => t.depthChart[pos].slice(0, STARTERS[pos]).map((id) => l.players[id])),
  );
  const bar = new Map(
    POSITIONS.map((pos) => {
      const xs = starters.filter((p) => p.position === pos).map(playerOvr);
      return [pos, xs.reduce((a, b) => a + b, 0) / xs.length];
    }),
  );
  const xs = Object.values(l.players)
    .filter((p) => ages.includes(p.age) && !['QB', 'K', 'P'].includes(p.position))
    .map((p) => playerOvr(p) - bar.get(p.position)!);
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

afterEach(() => {
  FOUNDING.on = true;
});

describe('a new league built as a settled one carries its players (A2)', () => {
  it("leans players' ratings by age without moving a draw: the same men, ages, names, positions and numbers", () => {
    FOUNDING.on = false;
    const today = createLeague({ seed: 'found-draws' });
    FOUNDING.on = true;
    const settled = createLeague({ seed: 'found-draws' });
    const who = (l: typeof today) =>
      Object.values(l.players).map((p) => [p.id, p.age, p.firstName, p.lastName, p.position, p.jersey, p.teamId]);
    expect(who(settled)).toEqual(who(today));
    // And the lean is real: some founding players are rated differently.
    const moved = Object.values(settled.players).filter(
      (p) => playerOvr(p) !== playerOvr(today.players[p.id]) || p.potential !== today.players[p.id].potential,
    );
    expect(moved.length).toBeGreaterThan(Object.keys(settled.players).length / 4);
  });

  it('leaves kickers and punters, and every player once the switch is off, as they were', () => {
    expect(foundingLean('K', 34)).toBe(0);
    expect(foundingLean('P', 36)).toBe(0);
    FOUNDING.on = false;
    expect(foundingLean('RB', 33)).toBe(0);
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

  it('rates its young players and its veterans against their starters as a settled league does', () => {
    // A settled league (`npm run careers`, seasons 11-20, 2026-11-14): 22-23 about 3.0 below a starter, 33-34 about 2.3.
    // A new league's starters stand about 0.3 further above everyone (its depth, not its ages), so the bar is 0.5.
    const settled = createLeague({ seed: 'found-ages' });
    expect(Math.abs(below(settled, [22, 23]) - -3.0)).toBeLessThan(0.5);
    expect(Math.abs(below(settled, [33, 34]) - -2.3)).toBeLessThan(0.5);
    // Rolled as before, a new league's veterans were as good as its starters.
    FOUNDING.on = false;
    expect(below(createLeague({ seed: 'found-ages' }), [33, 34])).toBeGreaterThan(-1.3);
  });
});
