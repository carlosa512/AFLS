import { describe, expect, it } from 'vitest';
import { contractDecision, contractMail, openContracts } from '../contractMail';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import type { League, Player } from '../types';
import { advanceOffseason, beginOffseason } from './index';
import { askOffer, demand, makeOffer, USER_TESTS_MARKET, wantsMarket } from './negotiation';
import { expiringPlayers } from './ai';
import { promisedDeal } from '../disputeRead';

/** The re-sign window of a league whose user has an expiring player who wants to test the market. */
function scene(): { l: League; p: Player } {
  for (let i = 0; i < 40; i++) {
    const l = createLeague({ seed: `tests-market-${i}` });
    simToEndOfSeason(l);
    beginOffseason(l);
    while (l.phase !== 'resign') advanceOffseason(l, { autoUser: true });
    const p = expiringPlayers(l, l.userTeamId).find((x) => wantsMarket(l, x));
    if (p) return { l, p };
  }
  throw new Error('no world with a player who wants to test the market');
}

describe('your player may want to test the market (market and exits)', () => {
  const { l, p } = scene();

  it('the chance is low but not zero', () => {
    expect(USER_TESTS_MARKET).toBeGreaterThan(0);
    expect(USER_TESTS_MARKET).toBeLessThan(0.2);
  });

  it('the draw is the same every time it is read', () => {
    for (let i = 0; i < 5; i++) expect(wantsMarket(l, p)).toBe(true);
    expect(wantsMarket(structuredClone(l), structuredClone(p))).toBe(true);
  });

  it('a promised player never wants to test the market', () => {
    const q = structuredClone(p);
    q.morale = {
      ...(q.morale ?? {}),
      talk: { ...(q.morale?.talk ?? {}), club: q.teamId, promise: { kind: 'deal' } },
    } as unknown as Player['morale'];
    expect(promisedDeal(q)).toBe(true);
    expect(wantsMarket(l, q)).toBe(false);
  });

  it('he refuses before free agency, with that reason', () => {
    const w = structuredClone(l);
    const q = w.players[p.id];
    const r = makeOffer(w, q, w.userTeamId, askOffer(demand(w, q, w.userTeamId)));
    expect(r.accepted).toBe(false);
    expect(r.message).toBe('He wants to see what the market says first.');
  });

  it("doesn't hold up the window: decided as testing, and his letter row says so", () => {
    expect(contractDecision(l, p.id)).toBe('testing');
    expect(openContracts(l).map((x) => x.id)).not.toContain(p.id);
    const [m] = contractMail(l, new Set());
    const row = m?.sections?.flatMap((s) => s.rows).find((r) => r.playerId === p.id);
    expect(row?.cells.at(-1)).toBe('Testing the market');
  });

  it('signs with you once free agency opens', () => {
    const w = structuredClone(l);
    while (w.phase !== 'freeAgency') advanceOffseason(w, { autoUser: true });
    const q = w.players[p.id];
    if (q.teamId === null) {
      const d = demand(w, q, w.userTeamId);
      const r = makeOffer(w, q, w.userTeamId, { ...askOffer(d), apy: Math.round(d.askApy * 1.1) });
      expect(r.message).not.toBe('He wants to see what the market says first.');
    }
  });
});
