import { describe, expect, it, vi } from 'vitest';
import type { League } from './types';

// Morale reads the league and draws nothing: a season with it switched off must play out the same, game for game. G2
// gives moods their effects, read only through `moodScale.ts`; held at zero here, so what this checks is
// that the moods themselves still draw nothing (`moraleEffects.test.ts` shows the effects, switched on, change a game).
const on = vi.hoisted(() => ({ value: true }));
vi.mock('./morale', async (load) => {
  const real = await load<typeof import('./morale')>();
  return {
    ...real,
    moraleWeek: (l: Parameters<typeof real.moraleWeek>[0]) => on.value && real.moraleWeek(l),
    moraleStep: (l: Parameters<typeof real.moraleStep>[0]) => on.value && real.moraleStep(l),
  };
});

// Every effect at zero: the scale they all read, mocked in its own module so no import order can slip past it.
vi.mock('./moodScale', () => ({ moodLean: () => 0, moodPull: () => 0 }));

// The staff edge on Sunday (L4) is fed by moods too (a sour lawyer's bad-game doubt, how meetings land): held at zero.
vi.mock('./staffEdge', async (load) => {
  const real = await load<typeof import('./staffEdge')>();
  return { ...real, staffEdgeOf: () => null };
});

// Relieving a coordinator in season (L4) reads the room's belief, which a sour lawyer's mood wears down, and a meeting's
// broken "on notice" (meetings follow moods): both held. On main it passed by timing (no relief landed in the season);
// 0.4.4's dice put one in week 16.
vi.mock('./relieve', async (load) => {
  const real = await load<typeof import('./relieve')>();
  return { ...real, aiRelieve: () => undefined, aiRelieveNow: () => false };
});

// And what moods do (G4): disputes and the AI keeping its promises move rosters and games, so they're off here too.
vi.mock('./disputeRead', async (load) => {
  const real = await load<typeof import('./disputeRead')>();
  real.MOOD_ACTS.on = false;
  return real;
});

const { createLeague } = await import('./generate');
const { playWeek } = await import('./league');
const { beginOffseason, advanceOffseason } = await import('./offseason');

/** A turn for the test worker: two seasons' worth in one stretch kept it from reporting for over a minute (an RPC timeout
 * that failed CI's test-2 on main with every test passing). */
const tick = () => new Promise((r) => setTimeout(r, 0));

async function play(withMorale: boolean) {
  on.value = withMorale;
  const l = createLeague({ seed: 'morale-rng' });
  // The same calls simToEndOfSeason makes, a week at a time with a yield between.
  while (l.phase !== 'complete') {
    playWeek(l);
    await tick();
  }
  beginOffseason(l);
  while ((l.phase as League['phase']) !== 'regular') {
    advanceOffseason(l, { autoUser: true });
    await tick();
  }
  return {
    games: l.games.map((g) => [g.id, g.result?.homeScore, g.result?.awayScore]),
    rosters: Object.values(l.players).map((p) => [p.id, p.teamId, p.contract?.apy ?? null]),
    rng: l.rngState,
    moods: Object.values(l.players).filter((p) => p.morale).length,
    talks: Object.values(l.players).filter((p) => p.morale?.talk?.answered).length,
  };
}

describe('morale draws nothing', () => {
  it('plays a season and an offseason the same with it and without it', async () => {
    const a = await play(true);
    const b = await play(false);
    expect(a.moods).toBeGreaterThan(1000);
    // Switched off, the draft class never got a mood: the switch did switch.
    expect(a.moods).toBeGreaterThan(b.moods);
    // Talks ran too (G3): AI clubs answered their players, and still nothing played out differently.
    expect(a.talks).toBeGreaterThan(0);
    expect(a.games).toEqual(b.games);
    expect(a.rosters).toEqual(b.rosters);
    expect(a.rng).toEqual(b.rng);
  }, 120_000);
});
