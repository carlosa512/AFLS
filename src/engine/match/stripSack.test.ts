import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import type { GameResult, PlayLogEntry } from '../types';
import { simulateGame, type ContactTap, type StripTap } from './gameSim';

const league = createLeague({ seed: 'strip-t' });
const strips: StripTap[] = [];
const contacts: ContactTap[] = [];
const results: GameResult[] = [];
for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 40))
  results.push(
    simulateGame(league, g, {
      keepPlays: true,
      stripTap: (t) => strips.push(t),
      contactTap: (t) => contacts.push(t),
    }),
  );
// A two-point try's snap books nothing and taps nothing (`twoPointTry`).
const plays: PlayLogEntry[] = results.flatMap((r) => r.plays!.filter((e) => !/^Two-point try: /.test(e.text)));
const sacks = plays.filter((e) => (e.kind === 'penalty' ? e.ran?.kind : e.kind) === 'sack' && e.down > 0);

describe('the strip-sack and the loose ball in a game', () => {
  it('taps every sack once, and every fumble with who got it', () => {
    expect(strips.length).toBe(sacks.length);
    expect(strips.filter((t) => t.fumbled).length).toBeGreaterThan(10);
    for (const t of [...strips, ...contacts]) if (t.fumbled) expect(t.recovery, JSON.stringify(t)).toBeDefined();
  });

  it('credits a forced fumble only when a defender forced it, and his recovery when he fell on it', () => {
    const credited = results.reduce(
      (n, r) => n + Object.values(r.playerStats).reduce((m, s) => m + (s.forcedFum ?? 0), 0),
      0,
    );
    const forced = [...strips, ...contacts].filter((t) => t.fumbled && t.forced).length;
    // (A flag can wipe out a play's stats, never its tap: the taps are an upper bound.)
    expect(credited).toBeLessThanOrEqual(forced);
    expect(credited).toBeGreaterThan(forced * 0.8);
    for (const t of [...strips, ...contacts])
      if (t.fumbled && !t.forced) expect(t.recovery!.forcerRecovered).toBe(false);
  });

  it('names a sack fumble the quarterback lost himself', () => {
    const own = strips.filter((t) => t.fumbled && !t.forced).length;
    const logged = sacks.filter((e) => /SACKED.*, puts it on the ground/.test(e.text)).length;
    expect(logged).toBe(own);
  });
});
