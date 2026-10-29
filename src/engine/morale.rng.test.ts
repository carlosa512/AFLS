import { describe, expect, it, vi } from 'vitest';

// Morale reads the league and draws nothing: a season with it switched off must play out the same, game for game.
const on = vi.hoisted(() => ({ value: true }));
vi.mock('./morale', async (load) => {
  const real = await load<typeof import('./morale')>();
  return {
    ...real,
    moraleWeek: (l: Parameters<typeof real.moraleWeek>[0]) => on.value && real.moraleWeek(l),
    moraleStep: (l: Parameters<typeof real.moraleStep>[0]) => on.value && real.moraleStep(l),
  };
});

const { createLeague } = await import('./generate');
const { simToEndOfSeason } = await import('./league');
const { beginOffseason, advanceOffseason } = await import('./offseason');

function play(withMorale: boolean) {
  on.value = withMorale;
  const l = createLeague({ seed: 'morale-rng' });
  simToEndOfSeason(l);
  beginOffseason(l);
  while (l.phase !== 'regular') advanceOffseason(l, { autoUser: true });
  return {
    games: l.games.map((g) => [g.id, g.result?.homeScore, g.result?.awayScore]),
    rosters: Object.values(l.players).map((p) => [p.id, p.teamId, p.contract?.apy ?? null]),
    rng: l.rngState,
    moods: Object.values(l.players).filter((p) => p.morale).length,
  };
}

describe('morale draws nothing', () => {
  it('plays a season and an offseason the same with it and without it', () => {
    const a = play(true);
    const b = play(false);
    expect(a.moods).toBeGreaterThan(1000);
    // Switched off, the draft class never got a mood: the switch did switch.
    expect(a.moods).toBeGreaterThan(b.moods);
    expect(a.games).toEqual(b.games);
    expect(a.rosters).toEqual(b.rosters);
    expect(a.rng).toEqual(b.rng);
  }, 120_000);
});
