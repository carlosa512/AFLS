import { describe, expect, it, vi } from 'vitest';

// Draft trades switched on, but every phone call comes to nothing: the draft must pick exactly as it does with them off.
// What this guards is the trade machinery leaving no trace on a draft where no deal is made (the boards it reads up
// front, the context it keeps), whatever the league's history: no pinned list to re-take when play changes.
vi.mock('./draft', async (load) => {
  const real = await load<typeof import('./draft')>();
  return { ...real, draftCalls: () => null };
});

const { createLeague } = await import('../generate');
const { simToEndOfSeason } = await import('../league');
const { advanceOffseason, beginOffseason } = await import('../offseason');
const { draftOrder, simDraft } = await import('../offseason/draft');
const { draftTrades } = await import('./draft');
const { Rng } = await import('../rng');
type League = import('../types').League;

const atDraft = (() => {
  const league = createLeague({ seed: 'draft-quiet' });
  simToEndOfSeason(league);
  beginOffseason(league);
  while (league.phase !== 'draft') advanceOffseason(league, { autoUser: true });
  return JSON.stringify(league);
})();

/** The first round, picked from the same draft-day league with draft trades on or off. */
function firstRound(off: boolean): number[] {
  const l: League = JSON.parse(atDraft);
  draftTrades.off = off;
  try {
    simDraft(l, new Rng('quiet'), { stopAtUser: false, limit: 32 });
  } finally {
    draftTrades.off = false;
  }
  return draftOrder(l)
    .slice(0, 32)
    .map((p) => p.playerId!);
}

describe('a draft where no trade happens', () => {
  it('picks the same players, in the same order, with draft trades on or off', () => {
    const off = firstRound(true);
    expect(off.every((id) => id !== undefined)).toBe(true);
    expect(firstRound(false)).toEqual(off);
  });
});
