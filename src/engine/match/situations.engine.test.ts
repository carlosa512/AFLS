import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import type { PlayLogEntry } from '../types';
import { simulateGame, type SituationTap } from './gameSim';

const league = createLeague({ seed: 'situations-engine' });
const taps: (SituationTap & { game: number })[] = [];
const games: { plays: PlayLogEntry[]; homeId: number }[] = [];
for (const g of league.games.filter((x) => !x.playoffRound).slice(0, 24)) {
  const r = simulateGame(league, g, { keepPlays: true, situationTap: (t) => taps.push({ ...t, game: g.id }) });
  games.push({ plays: r.plays!, homeId: g.homeId });
}
const of = <K extends SituationTap['kind']>(kind: K) =>
  taps.filter((t): t is Extract<SituationTap, { kind: K }> & { game: number } => t.kind === kind);

describe("a play's time, in the engine", () => {
  it('times every play at a second or more, incompletions as the NFL does', () => {
    const time = of('time');
    expect(time.length).toBeGreaterThan(24 * 100);
    for (const t of time) expect(t.seconds).toBeGreaterThanOrEqual(1);
    const inc = time.filter((t) => t.play === 'incomplete');
    expect(Math.abs(inc.reduce((a, t) => a + t.seconds, 0) / inc.length - 4.73)).toBeLessThan(0.6);
    // AI games: the field times nothing.
    expect(time.some((t) => t.field)).toBe(false);
  });
});

describe("the half's last possession, in the engine", () => {
  it('decides once a drive, never kneels past midfield, and sometimes tries from deep', () => {
    const half = of('half');
    expect(half.length).toBeGreaterThan(5);
    for (const t of half) {
      expect(t.clock).toBeLessThanOrEqual(75);
      if (t.kneeled) expect(t.yardLine).toBeLessThan(50);
    }
    // One a drive: within a game, each next decision comes later in the half.
    for (const g of new Set(half.map((t) => t.game))) {
      const clocks = half.filter((t) => t.game === g).map((t) => t.clock);
      for (let i = 1; i < clocks.length; i++) expect(clocks[i]).toBeLessThan(clocks[i - 1]);
    }
    expect(half.some((t) => !t.kneeled && t.yardLine <= 35)).toBe(true);
  });

  it('plays a two-minute drill when it tries: a timeout inside a minute from its own end', () => {
    const early = games.some(({ plays }) =>
      // The timeout's own entry carries the ball's spot when it was called, for the side with the ball.
      plays.some((e) => e.quarter === 2 && e.clock <= 60 && e.clock > 0 && /^Timeout /.test(e.text) && e.yardLine < 45),
    );
    expect(early).toBe(true);
  });
});
