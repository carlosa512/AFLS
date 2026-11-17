import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { simToEndOfSeason } from './league';
import { advanceOffseason, beginOffseason } from './offseason/index';
import { RETIRED_KEEP } from './roster';
import type { League, Player } from './types';

/** Every retired player reduced to what he keeps (`RETIRED_KEEP`), as `slimRetired` and the save upgrade leave him. */
export function slimAll(league: League): void {
  for (const p of Object.values(league.players))
    if (p.retired)
      for (const k of Object.keys(p))
        if (!RETIRED_KEEP.includes(k as keyof Player)) delete (p as unknown as Record<string, unknown>)[k];
}

const season = (l: League) => {
  simToEndOfSeason(l);
  beginOffseason(l);
  while (l.phase !== 'regular') advanceOffseason(l, { autoUser: true });
};

describe('the census: a league plays on with its retired players slimmed (2026-11-17)', () => {
  // Practice squads on: the most code that walks players. Two seasons retire a class; one more plays every step over it.
  it('plays a season and its offseason over slimmed retirees', () => {
    const l = createLeague({ seed: 'census', personnel: true });
    for (let s = 0; s < 2; s++) season(l);
    expect(Object.values(l.players).filter((p) => p.retired).length).toBeGreaterThan(100);
    slimAll(l);
    season(l);
  }, 600_000);
});
