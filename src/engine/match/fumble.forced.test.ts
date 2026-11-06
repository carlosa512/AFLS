import { describe, expect, it, vi } from 'vitest';
import { createLeague } from '../generate';
import type { PlayLogEntry } from '../types';
import { simulateGame } from './gameSim';

// Every tackle in bounds fumbles, so a scramble's fumble and a 4th-down fumble the offense keeps both come up.
vi.mock('./fumbleOdds', async (load) => {
  const real = await load<typeof import('./fumbleOdds')>();
  return { ...real, fumbleOdds: () => 1 };
});

const league = createLeague({ seed: 'fumble-forced' });
const plays: PlayLogEntry[] = league.games
  .filter((g) => !g.playoffRound)
  .slice(0, 16)
  .flatMap((g) => simulateGame(league, g, { keepPlays: true }).plays!);
const next = (i: number) => plays.slice(i + 1).find((e) => e.down > 0);

describe('fumbles everywhere', () => {
  it('a scramble’s lost fumble turns the ball over', () => {
    // (One run back for a touchdown is the defense's score: the snap after the kickoff is the offense's again.)
    const lost = plays.flatMap((e, i) =>
      e.kind === 'scramble' && /FUMBLE, recovered by/.test(e.text) && !/TOUCHDOWN/.test(plays[i + 1]?.text ?? '')
        ? [[e, next(i)] as const]
        : [],
    );
    expect(lost.length).toBeGreaterThan(0);
    for (const [e, n] of lost) if (n && n.quarter === e.quarter) expect(n.offense, e.text).not.toBe(e.offense);
  });

  it('a 4th-down fumble the offense keeps short of the sticks turns it over on downs', () => {
    const kept = plays.flatMap((e, i) => {
      // (A snap a flag wiped out is no play: the down is replayed.)
      if (e.down !== 4 || e.kind === 'penalty' || !/Fumble, recovered by the offense/.test(e.text)) return [];
      const m = /for (-?\d+) yard|for no gain/.exec(e.text);
      const gain = m ? (m[1] ? Number(m[1]) : 0) : 0;
      return gain < e.distance ? [[e, next(i)] as const] : [];
    });
    expect(kept.length).toBeGreaterThan(0);
    for (const [e, n] of kept) if (n && n.quarter === e.quarter) expect(n.offense, e.text).not.toBe(e.offense);
  });
});
