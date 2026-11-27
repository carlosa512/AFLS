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

/**
 * The league's free-agency outcome as one hash: every transaction and every club's cap space. A transaction's `from` and
 * `apy` (the compensatory record, `comp.ts`) are left out: they only record a signing, so the hash stays what it was.
 */
const outcome = (l: League) =>
  createHash('sha256')
    .update(JSON.stringify(l.transactions.map((t) => ({ ...t, from: undefined, apy: undefined }))))
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
    // Moved by the free-agency race (`race.ts`) and its tuning (`RACE`, 0.4.55): the free-agency phase's entries differ. Moved again by `yearOne` rounding as the contract does (a fit to the dollar). Moved again by a wider camp through the prime (0.4.56, `CAMP.prime`): who starts moves, and so what a club needs and bids. Moved again by discipline (0.5.0, 2026-11-24): a player thrown out or suspended in the season changes who plays, so what a club needs and bids. Moved again by the final review fixes (0.5.0, 2026-11-25): suspensions are served and reviewed before the injury week and a team's sitting ends with the year, so the season's games, and what each club needs and bids, differ. Moved again by discipline's final words (0.5.0, 2026-11-26): no trouble is drawn for a team whose season is over, so who is suspended or sat in the last weeks, who plays and what each club needs and bids differ.
    expect([atDraft, atKickoff]).toEqual([
      '7dba685dfb63df59fa323a16be9599e8dfe44534d55a70549776cbdfab1e4a47',
      '0ef126cb8c6b72c158b8a07fca95a82ccc942b300243a34555888f50549d285d',
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
