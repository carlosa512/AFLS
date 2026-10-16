import { describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { capHit, isExpired } from '../finance/contract';
import { rookieApy } from '../finance/market';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { STARTERS } from '../positions';
import { teamPlayers } from '../roster';
import type { League } from '../types';
import { POSITIONS } from '../types';
import { advanceOffseason, beginOffseason, FA_DAYS, offseasonBlockers, simOffseason } from '.';
import { applyFranchiseTag, expiringPlayers, tagBlocker } from './ai';
import { availableProspects, draftOrder, draftPlayer, nextPick, simDraft } from './draft';
import { askOffer, demand, freeAgents, makeOffer } from './negotiation';
import { Rng } from '../rng';

/** One league played to the end of its first season, then cloned per test (JSON keeps it cheap). */
const base = (() => {
  const league = createLeague({ seed: 'offseason-tests' });
  simToEndOfSeason(league);
  return JSON.stringify(league);
})();
const fresh = (): League => JSON.parse(base);

describe('offseason calendar', () => {
  it('opens the new league year with a draft order and class', () => {
    const league = fresh();
    beginOffseason(league);
    expect(league.season).toBe(2027);
    expect(league.phase).toBe('resign');
    expect(league.caps[2027]).toBeGreaterThan(league.caps[2026] * 0.88);
    const order = draftOrder(league);
    expect(order).toHaveLength(224);
    expect(order.map((p) => p.overall)).toEqual(Array.from({ length: 224 }, (_, i) => i + 1));
    // The champion picks last in every round.
    expect(order[31].originalTeamId).toBe(league.history[0].championId);
    expect(availableProspects(league).length).toBe(260);
  });

  it('walks every phase and ends with legal, cap-compliant rosters', () => {
    const league = fresh();
    beginOffseason(league);
    const seen: string[] = [];
    while (league.phase !== 'regular') {
      seen.push(league.phase);
      advanceOffseason(league, { autoUser: true });
    }
    expect(seen).toEqual(['resign', ...Array(FA_DAYS).fill('freeAgency'), 'draft', 'preseason']);
    for (const team of league.teams) {
      const roster = teamPlayers(league, team.id);
      expect(roster.length).toBeLessThanOrEqual(53);
      expect(roster.length).toBeGreaterThanOrEqual(46);
      for (const pos of POSITIONS) expect(roster.filter((p) => p.position === pos).length).toBeGreaterThanOrEqual(STARTERS[pos]);
      expect(capSpace(league, team.id)).toBeGreaterThanOrEqual(0);
      for (const p of roster) expect(isExpired(p.contract!, league.season)).toBe(false);
    }
    expect(league.draftClass).toEqual([]);
    expect(league.draftPicks.some((p) => p.season === league.season + 3)).toBe(true);
  });

  it('is deterministic for a seed', () => {
    const a = fresh();
    const b = fresh();
    simOffseason(a);
    simOffseason(b);
    expect(a.transactions.map((t) => t.text)).toEqual(b.transactions.map((t) => t.text));
  }, 30_000);
});

describe('negotiation', () => {
  it("signs a player who gets his ask, and doesn't raise the ask after a lowball", () => {
    const league = fresh();
    beginOffseason(league);
    const player = expiringPlayers(league, league.userTeamId)[0];
    const d = demand(league, player, league.userTeamId);
    const low = makeOffer(league, player, league.userTeamId, { ...askOffer(d), apy: Math.round(d.market * 0.8) });
    expect(low.accepted).toBe(false);
    expect(demand(league, player, league.userTeamId).askApy).toBe(d.askApy);
    const ok = makeOffer(league, player, league.userTeamId, askOffer(d));
    expect(ok.accepted).toBe(true);
    expect(isExpired(player.contract!, league.season)).toBe(false);
    expect(player.contract!.apy).toBe(d.askApy);
  });

  it('ends talks after too many lowballs; insults cost double', () => {
    const league = fresh();
    beginOffseason(league);
    const player = expiringPlayers(league, league.userTeamId)[0];
    const d = demand(league, player, league.userTeamId);
    const insult = { ...askOffer(d), apy: Math.max(1_000, Math.round(d.market * 0.5)) };
    const first = makeOffer(league, player, league.userTeamId, insult);
    expect(first.negotiation.patience).toBe(d.patience - 2);
    let last = first;
    for (let i = 0; i < 4 && last.negotiation.status === 'open'; i++) last = makeOffer(league, player, league.userTeamId, insult);
    expect(last.negotiation.status).toBe('broken');
    expect(makeOffer(league, player, league.userTeamId, askOffer(d)).accepted).toBe(false);
  });

  it('refuses offers that break the cap', () => {
    const league = fresh();
    beginOffseason(league);
    const player = expiringPlayers(league, league.userTeamId)[0];
    const r = makeOffer(league, player, league.userTeamId, { years: 1, apy: league.caps[league.season] * 2, bonusPct: 0, gtdPct: 0, voidYears: 0 });
    expect(r.accepted).toBe(false);
    expect(r.message).toMatch(/cap room/);
  });

  it('moves unsigned expiring players into free agency, keeping a tagged one', () => {
    const league = fresh();
    beginOffseason(league);
    const [star, ...rest] = expiringPlayers(league, league.userTeamId);
    expect(tagBlocker(league, star)).toBeNull();
    applyFranchiseTag(league, star);
    expect(star.contract!.kind).toBe('tag');
    expect(tagBlocker(league, rest[0])).toMatch(/already used/);
    advanceOffseason(league);
    expect(star.teamId).toBe(league.userTeamId);
    expect(capHit(star.contract!, league.season)).toBe(star.contract!.apy);
    expect(rest.filter((p) => p.teamId === league.userTeamId)).toHaveLength(0);
    expect(freeAgents(league).length).toBeGreaterThan(100);
  });
});

describe('draft', () => {
  it("stops at the user's pick and slots rookie contracts by pick", () => {
    const league = fresh();
    beginOffseason(league);
    while (league.phase !== 'draft') advanceOffseason(league);
    const rng = new Rng('draft-test');
    simDraft(league, rng, { stopAtUser: true });
    const pick = nextPick(league)!;
    expect(pick.ownerId).toBe(league.userTeamId);
    const prospect = availableProspects(league)[0];
    draftPlayer(league, pick, prospect);
    expect(prospect.teamId).toBe(league.userTeamId);
    expect(prospect.contract!.kind).toBe('rookie');
    expect(prospect.contract!.apy).toBeCloseTo(rookieApy(pick.overall!, league.caps[league.season]), -2);
    expect(prospect.draft).toMatchObject({ round: pick.round, pick: pick.overall });
  });

  it('blocks the season until the user cuts down to 53', () => {
    const league = fresh();
    beginOffseason(league);
    while (league.phase !== 'preseason') advanceOffseason(league);
    const roster = teamPlayers(league, league.userTeamId);
    if (roster.length > 53) expect(offseasonBlockers(league).join(' ')).toMatch(/Cut down to 53/);
    else expect(offseasonBlockers(league).filter((b) => /Cut down/.test(b))).toEqual([]);
  });
});
