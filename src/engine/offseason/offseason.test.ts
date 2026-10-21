import { describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { capHit, isExpired } from '../finance/contract';
import { leagueMarket, marketApy, maxBonusShare, minSalary, rookieApy } from '../finance/market';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { playerOvr, STARTERS } from '../positions';
import { activeRoster, teamPlayers } from '../roster';
import type { League } from '../types';
import { POSITIONS } from '../types';
import { advanceOffseason, beginOffseason, draftNextPick, FA_DAYS, offseasonBlockers, simOffseason } from '.';
import { aiOffer, applyFranchiseTag, expiringPlayers, IN_SEASON_RESERVE, signMinimum, tagBlocker } from './ai';
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

  it("keeps last season's box scores and scoring plays and drops their full replays", () => {
    const league = fresh();
    const mine = league.games.find((g) => g.homeId === league.userTeamId && g.result)!;
    expect(mine.result!.plays!.some((p) => !p.scoring)).toBe(true);
    beginOffseason(league);
    const last = league.games.filter((g) => g.season === league.season - 1);
    expect(last.length).toBeGreaterThan(0);
    for (const g of last) expect(g.result?.plays?.every((p) => p.scoring) ?? true).toBe(true);
    // The scoring plays stay, not nothing: a game's replay is trimmed, not dropped.
    expect(mine.result!.plays?.length ?? 0).toBeGreaterThan(0);
    expect(mine.result!.home).toBeDefined();
    expect(league.games.some((g) => g.season === league.season && !g.result)).toBe(true);
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
      // Injured reserve doesn't count toward the 53.
      const roster = activeRoster(league, team.id);
      expect(roster.length).toBeLessThanOrEqual(53);
      expect(roster.length).toBeGreaterThanOrEqual(46);
      for (const pos of POSITIONS)
        expect(roster.filter((p) => p.position === pos).length).toBeGreaterThanOrEqual(STARTERS[pos]);
      expect(capSpace(league, team.id)).toBeGreaterThanOrEqual(0);
      for (const p of roster) expect(isExpired(p.contract!, league.season)).toBe(false);
    }
    expect(league.draftClass).toEqual([]);
    expect(league.draftPicks.some((p) => p.season === league.season + 3)).toBe(true);
  });

  it('opens the season with the room AI front offices planned to keep for it', () => {
    const league = fresh();
    beginOffseason(league);
    while (league.phase !== 'regular') advanceOffseason(league, { autoUser: true });
    const cap = league.caps[league.season];
    const ai = league.teams.filter((t) => t.id !== league.userTeamId);
    const space = ai.map((t) => capSpace(league, t.id)).sort((a, b) => a - b);
    // About the reserve the median GM plans (3% of the cap), not above it: a league paid like a settled one opens
    // its second season with the median team at it (2.97% on this seed; 3.8% when the opening league left next year
    // under-committed), as a settled league's kickoffs do (median room 2-3%).
    expect(space[ai.length >> 1]).toBeGreaterThanOrEqual(0.9 * IN_SEASON_RESERVE * cap);
    // A reserve is room kept, never a man short: a team under 53 has no room for a minimum deal (short rosters
    // without room are a known issue of their own, flagged by the offseason audit).
    for (const t of ai)
      if (activeRoster(league, t.id).length < 53) expect(capSpace(league, t.id)).toBeLessThan(minSalary(1, cap));
  });

  it('is deterministic for a seed', () => {
    const a = fresh();
    const b = fresh();
    simOffseason(a);
    simOffseason(b);
    expect(a.transactions.map((t) => t.text)).toEqual(b.transactions.map((t) => t.text));
  });
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
    for (let i = 0; i < 4 && last.negotiation.status === 'open'; i++)
      last = makeOffer(league, player, league.userTeamId, insult);
    expect(last.negotiation.status).toBe('broken');
    expect(makeOffer(league, player, league.userTeamId, askOffer(d)).accepted).toBe(false);
  });

  it('refuses offers that break the cap', () => {
    const league = fresh();
    beginOffseason(league);
    const player = expiringPlayers(league, league.userTeamId)[0];
    const r = makeOffer(league, player, league.userTeamId, {
      years: 1,
      apy: league.caps[league.season] * 2,
      bonusPct: 0,
      gtdPct: 0,
      voidYears: 0,
    });
    expect(r.accepted).toBe(false);
    expect(r.message).toMatch(/cap room/);
  });

  it("keeps an AI offer's signing bonus inside the GM's share of the deal, and inside its guarantee", () => {
    const league = fresh();
    beginOffseason(league);
    const team = league.teams[1];
    const rng = new Rng('bonus-share');
    const others = Object.values(league.players).filter((p) => p.teamId !== null && p.teamId !== team.id);
    const sample = others.filter((_, i) => i % 4 === 0);
    // A cap-aggressive GM pushes the most money into bonus, so the cap is what holds him; a conservative one
    // is held by his cap too. Neither may put more into the bonus than the deal guarantees (an agent's ask is
    // never below 10%, so a zero-guarantee offer is out of reach, but the bonus can never exceed the guarantee).
    for (const capAggression of [0.9, 0]) {
      team.gm.capAggression = capAggression;
      const offers = sample.map((p) => aiOffer(league, team, p, rng, 2));
      for (const o of offers) {
        expect(o.bonusPct).toBeLessThanOrEqual(maxBonusShare(capAggression));
        expect(o.bonusPct).toBeLessThanOrEqual(o.gtdPct);
      }
      // The cap does bind: agents ask up to 70% guaranteed, which the style alone would put 40-80% into bonus.
      expect(offers.some((o) => o.bonusPct === maxBonusShare(capAggression))).toBe(true);
    }
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
    expect(prospect.draft).toMatchObject({ round: pick.round, pick: pick.overall, rank: pick.consRank });
  });

  it('steps one pick at a time and waits on the user', () => {
    const league = fresh();
    beginOffseason(league);
    while (league.phase !== 'draft') advanceOffseason(league);
    const first = nextPick(league)!;
    if (first.ownerId === league.userTeamId) draftPlayer(league, first, availableProspects(league)[0]);
    const before = nextPick(league)!.overall!;
    draftNextPick(league);
    expect(nextPick(league)!.overall).toBe(before + 1);
    while (nextPick(league)!.ownerId !== league.userTeamId) draftNextPick(league);
    const waiting = nextPick(league)!.overall;
    draftNextPick(league);
    expect(nextPick(league)!.overall).toBe(waiting);
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

describe('camp signings', () => {
  /** Walk to the preseason and put a team's best player on the market, the way an unsigned star sits there. */
  const unsignedStar = () => {
    const league = fresh();
    beginOffseason(league);
    while (league.phase !== 'preseason') advanceOffseason(league);
    const star = teamPlayers(league, 5).sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    star.teamId = null;
    star.contract = null;
    return { league, star };
  };

  it("doesn't sign a player at the minimum he wouldn't take", () => {
    const { league, star } = unsignedStar();
    const team = league.teams.find((t) => t.id !== 5 && t.id !== league.userTeamId)!;
    expect(demand(league, star, team.id).walkAway).toBeGreaterThan(
      minSalary(star.experience, league.caps[league.season]),
    );
    signMinimum(league, team, new Rng('camp'), star.position);
    expect(star.teamId).toBeNull();
  });

  it('camp signs no one at the minimum the market values well above it', () => {
    const { league, star } = unsignedStar();
    // Camp can still make a street free agent when the pool runs dry: he's new, and takes what's offered.
    const before = league.nextPlayerId;
    advanceOffseason(league);
    expect(league.phase).toBe('regular');
    const market = leagueMarket(league);
    const cheap = Object.values(league.players).filter(
      (p) =>
        p.teamId !== null &&
        p.id < before &&
        p.contract?.kind === 'minimum' &&
        p.contract.signedSeason === league.season &&
        marketApy(market, p) > p.contract.apy * 3,
    );
    expect(cheap.map((p) => `${p.position} ${p.firstName} ${p.lastName}`)).toEqual([]);
    expect(star.teamId).toBeNull();
  });
});
