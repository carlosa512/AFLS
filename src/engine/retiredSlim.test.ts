import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { simToEndOfSeason } from './league';
import { advanceOffseason, beginOffseason } from './offseason/index';
import { pickMark } from './draftGrade';
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

describe('retirement slims a player (2026-11-17)', () => {
  it('after an offseason every retired player keeps only what he keeps', () => {
    const l = createLeague({ seed: 'slim-at-retirement', personnel: true });
    season(l);
    season(l);
    const retired = Object.values(l.players).filter((p) => p.retired);
    expect(retired.length).toBeGreaterThan(50);
    for (const p of retired)
      expect(
        Object.keys(p).filter((k) => !RETIRED_KEEP.includes(k as keyof Player)),
        `${p.id}`,
      ).toEqual([]);
  }, 600_000);
});

describe("a retired pick's draft grade (2026-11-17)", () => {
  it('locks when he retires, before slimming, and his card reads it after', () => {
    const l = createLeague({ seed: 'slim-at-retirement', personnel: true });
    season(l);
    season(l);
    // Picks from this league's own drafts (a founding veteran's draft line is made up and never graded).
    const first = createLeague({ seed: 'slim-at-retirement', personnel: true }).season;
    const early = Object.values(l.players).filter((p) => p.retired && p.draft && p.draft.season > first);
    expect(early.length).toBeGreaterThan(0);
    // A pick who never played is graded by nobody (`pickMark`), retired or not.
    for (const p of early.filter((x) => x.experience > 0)) {
      expect(p.draft!.verdict, `${p.id}`).toBeDefined();
      expect(pickMark(l, p)).toEqual({ verdict: p.draft!.verdict, locked: true });
    }
  }, 600_000);
});
