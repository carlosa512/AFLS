import { describe, expect, it, vi } from 'vitest';
import { createLeague } from '../generate';
import type { PlayLogEntry } from '../types';
import { simulateGame } from './gameSim';

// Every dropback past the sack is thrown away from inside the pocket and flagged, so the rule's corners (4th down, the
// end zone, a flag declined) all come up within a few games.
vi.mock('./pocketChoice', async (load) => {
  const real = await load<typeof import('./pocketChoice')>();
  return {
    ...real,
    pocketOdds: () => ({ throw: 0, away: 1, run: 0 }),
    outsideOdds: () => 0,
    groundingOdds: () => 1,
  };
});

const league = createLeague({ seed: 'grounding-t' });
const games = league.games.filter((g) => !g.playoffRound).slice(0, 12);
const results = games.map((g) => simulateGame(league, g, { keepPlays: true }));
const plays: PlayLogEntry[] = results.flatMap((r) => r.plays!);
const grounded = (e: PlayLogEntry) => /Intentional grounding/.test(e.text);
/** The entry after each grounding, with the grounding. */
const nextSnap = (i: number) => plays.slice(i + 1).find((e) => e.down > 0);
const pairs = plays.flatMap((e, i) => (grounded(e) && !/declined/.test(e.text) ? [[e, nextSnap(i)!] as const] : []));

describe('intentional grounding in a game', () => {
  it('is called', () => {
    expect(pairs.length).toBeGreaterThan(20);
  });

  it('stands as an incompletion: the down is lost and the ball goes back', () => {
    const mid = pairs.filter(([e, next]) => e.down < 4 && next && next.offense === e.offense && e.yardLine > 20);
    expect(mid.length).toBeGreaterThan(5);
    for (const [e, next] of mid) {
      if (next.quarter !== e.quarter && (e.quarter === 2 || e.quarter === 4)) continue;
      expect(next.down).toBe(e.down + 1);
      expect(e.yardLine - next.yardLine).toBeGreaterThanOrEqual(10);
    }
  });

  it('counts the attempt in the box score', () => {
    for (const r of results) {
      for (const side of [r.home, r.away]) expect(side.passAtt).toBeGreaterThan(0);
    }
    const attempts = results.reduce((s, r) => s + r.home.passAtt + r.away.passAtt, 0);
    expect(attempts).toBeGreaterThanOrEqual(pairs.length);
  });

  it('on 4th down turns the ball over on downs', () => {
    const fourth = pairs.filter(([e, next]) => e.down === 4 && e.yardLine > 20 && next?.quarter === e.quarter);
    expect(fourth.length).toBeGreaterThan(0);
    // The other side has the ball next, and the log says why.
    for (const [e, next] of fourth) {
      expect(next.offense).not.toBe(e.offense);
      expect(plays[plays.indexOf(e) + 1].text).toMatch(/Turnover on downs/);
    }
  });

  it('from the end zone is a safety', () => {
    expect(plays.some((e) => grounded(e) && /safety/i.test(e.text))).toBe(true);
  });

  it('can be declined, and the incompletion stands', () => {
    expect(plays.some((e) => /Intentional grounding on .*declined/.test(e.text))).toBe(true);
  });
});
