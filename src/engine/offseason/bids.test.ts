import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { leagueMarket, marketApy } from '../finance/market';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { Rng } from '../rng';
import type { League, Phase } from '../types';
import { bidPass, bidsFor, poolOf, raiseTo, skips } from './bids';
import { advanceOffseason, beginOffseason } from './index';

/** The league's free-agency outcome as one hash: every transaction and every club's cap space. */
const outcome = (l: League) =>
  createHash('sha256')
    .update(JSON.stringify(l.transactions))
    .update(JSON.stringify(l.teams.map((t) => capSpace(l, t.id))))
    .digest('hex');

describe('the bid builder', () => {
  it('the split pass signs exactly as before', () => {
    const l = createLeague({ seed: 'front-office-b' });
    simToEndOfSeason(l);
    beginOffseason(l);
    while (l.phase !== 'draft') advanceOffseason(l, { autoUser: true });
    const atDraft = outcome(l);
    // On through the draft's pass, the last call and camp's passes (the swap and the stars-only pass).
    while ((l.phase as Phase) !== 'regular') advanceOffseason(l, { autoUser: true });
    const atKickoff = outcome(l);
    // Moved by the free-agency race (`race.ts`): only the free-agency phase's entries differ at the draft.
    expect([atDraft, atKickoff]).toEqual([
      'a488de4c707151cdf0ffcab6659f0c0fc0d32e2eb0de20cd60c8f9965ce61297',
      'ba8f99027c78af2e2d45b3efd51e08cc57dd4d4a7ba60a98e9ac26423381f7db',
    ]);
  });

  it('raiseTo stops at what the team would pay', () => {
    const l = createLeague({ seed: 'front-office-b' });
    simToEndOfSeason(l);
    beginOffseason(l);
    while (l.phase !== 'freeAgency') advanceOffseason(l, { autoUser: true });
    const pass = bidPass(l, new Rng('raise'));
    const market = leagueMarket(l);
    const made = poolOf(pass)
      .filter((p) => !skips(pass, p))
      .flatMap((p) => bidsFor(pass, p).bids.map((bid) => ({ p, bid })));
    expect(made.length).toBeGreaterThan(0);
    // A raise draws nothing: the stream is where the bids left it.
    const drawn = pass.rng.getState().join();
    // The scene: a bid its club would still make 5% higher but not at three times his market (a rich club short at his
    // spot would pay that too: its upgrade bar, books and room are all a raise answers to).
    const scene = made.find(
      ({ p, bid }) => raiseTo(pass, p, bid, bid.offer.apy * 1.05) && !raiseTo(pass, p, bid, 3 * marketApy(market, p)),
    );
    expect(scene).toBeDefined();
    const { p, bid } = scene!;
    const up = raiseTo(pass, p, bid, bid.offer.apy * 1.05)!;
    expect(up.team).toBe(bid.team);
    expect(up.offer.apy).toBe(bid.offer.apy * 1.05);
    expect(up.offer.years).toBe(bid.offer.years);
    expect(up.value).toBeGreaterThan(bid.value);
    expect(raiseTo(pass, p, bid, 3 * marketApy(market, p))).toBeNull();
    expect(pass.rng.getState().join()).toBe(drawn);
  });
});
