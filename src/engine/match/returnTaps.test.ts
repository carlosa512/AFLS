import { describe, expect, it, vi } from 'vitest';
import { createLeague } from '../generate';
import { simulateGame, type SituationTap } from './gameSim';

// Every return goes the distance, so a flag on one is a touchdown called back.
vi.mock('./returns', async (load) => {
  const real = await load<typeof import('./returns')>();
  return { ...real, returnYards: (f: { from: number }) => f.from };
});

describe('a return touchdown a flag called back (0.4.14)', () => {
  it('taps as no touchdown: the taps match the touchdowns in the log', () => {
    const league = createLeague({ seed: 'return-taps' });
    let taps = 0;
    let logged = 0;
    let flagged = 0;
    for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 4)) {
      const r = simulateGame(league, g, {
        keepPlays: true,
        situationTap: (t: SituationTap) => {
          if (t.kind === 'return' && t.td) taps++;
        },
      });
      for (const e of r.plays!) {
        if (/returns the (kickoff|punt) .* for a TOUCHDOWN/.test(e.text)) logged++;
        if ((e.kind === 'kickoff' || e.kind === 'punt') && /returns to the .* PENALTY/.test(e.text)) flagged++;
      }
    }
    expect(flagged).toBeGreaterThan(0);
    expect(taps).toBe(logged);
  });
});
