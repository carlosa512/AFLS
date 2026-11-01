import { describe, expect, it } from 'vitest';
import { createLeague } from '../../engine/generate';
import { simulateGame } from '../../engine/match/gameSim';
import type { PlayLogEntry } from '../../engine/types';
import { buildPath } from './ballPath';

describe('the ball path', () => {
  it('draws the same path for one play of each kind as before the move', () => {
    const league = createLeague({ seed: 'ball-path' });
    const g = league.games[0];
    const plays = simulateGame(league, g, { keepPlays: true, seed: 'bp' }).plays!;
    const one = new Map<string, PlayLogEntry>();
    for (const e of plays) if (e.kind && !one.has(e.kind)) one.set(e.kind, e);
    const paths = Object.fromEntries([...one].map(([k, e]) => [k, buildPath(e, g.homeId, 26.65)]));
    expect(Object.keys(paths).length).toBeGreaterThan(8);
    expect(paths).toMatchSnapshot();
  });
});
