import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { simulateGame } from './match/gameSim';
import type { GameResult, TeamGameStats } from './types';

const league = createLeague({ seed: 'analytics-engine' });
/** One seeded week: each game with its result, and each side with its club. */
const played = league.games
  .filter((g) => g.season === league.season && g.week === 1)
  .map((g) => ({ g, r: simulateGame(league, g) }));
const sides = ({ g, r }: { g: (typeof played)[number]['g']; r: GameResult }): [TeamGameStats, number][] => [
  [r.home, g.homeId],
  [r.away, g.awayId],
];

describe('counting the advanced numbers', () => {
  it('counts the plays that counted, as dropbacks or rushes', () => {
    for (const x of played)
      for (const [ts] of sides(x)) {
        expect(ts.adv).toBeDefined();
        // Kneels and spikes are plays, but not advanced plays.
        expect(ts.adv!.plays).toBeLessThanOrEqual(ts.plays);
        expect(ts.adv!.plays).toBeGreaterThan(ts.plays - 10);
        expect(ts.adv!.dropbacks + ts.adv!.rushes).toBe(ts.adv!.plays);
        expect(ts.adv!.success).toBeLessThanOrEqual(ts.adv!.plays);
        expect(ts.adv!.pressured).toBeLessThanOrEqual(ts.adv!.dropbacks);
        expect(ts.adv!.dropbacks).toBeGreaterThanOrEqual(ts.sacked);
      }
  });
  it('credits EPA and dropbacks to passers and rushers so they sum to the team', () => {
    for (const x of played)
      for (const [ts, teamId] of sides(x)) {
        const mine = Object.keys(x.r.playerStats)
          .map(Number)
          .filter((id) => x.r.playerTeams[id] === teamId);
        const sum = (key: 'epa' | 'dropbacks') => mine.reduce((a, id) => a + (x.r.playerStats[id][key] ?? 0), 0);
        expect(sum('epa')).toBeCloseTo(ts.adv!.epa, 6);
        expect(sum('dropbacks')).toBe(ts.adv!.dropbacks);
      }
  });
  it('counts pass-rush snaps for defenders on dropbacks only', () => {
    for (const x of played) {
      const lines = Object.values(x.r.playerStats);
      expect(lines.reduce((a, s) => a + (s.rushSnaps ?? 0), 0)).toBeGreaterThan(0);
      for (const s of lines) expect(s.rushSnaps ?? 0).toBeLessThanOrEqual(s.snaps ?? 0);
    }
  });
});
