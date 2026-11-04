import { describe, expect, it, vi } from 'vitest';

// The field can't start any play (a short-handed cast, a man with no skills): every play keeps today's result.
vi.mock('./approach', async (original) => ({
  ...(await original<typeof import('./approach')>()),
  approach: () => null,
}));

const { createLeague } = await import('../generate');
const { simulateGame } = await import('../match/gameSim');

describe("a play the field can't start", () => {
  it("keeps today's result, with no field facts", () => {
    const league = createLeague({ seed: 'field-fallback' });
    const g = league.games.find((x) => x.week === 1)!;
    const off = simulateGame(league, g, { keepPlays: true });
    const on = simulateGame(league, g, { keepPlays: true, field: true });
    expect(on.plays!.some((e) => e.field)).toBe(false);
    expect(on.playerStats).toEqual(off.playerStats);
    expect(on.homeScore).toBe(off.homeScore);
    expect(on.plays).toEqual(off.plays);
  });
});
