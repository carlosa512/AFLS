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
        // Attempts and sacks are dropbacks; spikes aren't, scrambles are (on top of attempts and sacks).
        expect(ts.adv!.dropbacks - (ts.passAtt + ts.sacked)).toBeGreaterThanOrEqual(-3);
        // Saved to three decimals: a game's EPA is a measure, not a fortune.
        expect(Math.round(ts.adv!.epa * 1000) / 1000).toBe(ts.adv!.epa);
      }
  });
  it('credits EPA and dropbacks to passers and rushers so they sum to the team', () => {
    for (const x of played)
      for (const [ts, teamId] of sides(x)) {
        const mine = Object.keys(x.r.playerStats)
          .map(Number)
          .filter((id) => x.r.playerTeams[id] === teamId);
        const sum = (key: 'epa' | 'dropbacks') => mine.reduce((a, id) => a + (x.r.playerStats[id][key] ?? 0), 0);
        expect(sum('epa')).toBeCloseTo(ts.adv!.epa, 1);
        expect(sum('dropbacks')).toBe(ts.adv!.dropbacks);
      }
  });
  it('counts pass-rush snaps for defenders on dropbacks only', () => {
    for (const x of played) {
      const lines = Object.entries(x.r.playerStats);
      expect(lines.reduce((a, [, s]) => a + (s.rushSnaps ?? 0), 0)).toBeGreaterThan(0);
      for (const [id, s] of lines) {
        // A rusher can't rush more often than the other side dropped back (scrambles included, spikes not).
        const faced = x.r.playerTeams[Number(id)] === x.g.homeId ? x.r.away.adv! : x.r.home.adv!;
        expect(s.rushSnaps ?? 0).toBeLessThanOrEqual(faced.dropbacks);
      }
    }
  });
});
