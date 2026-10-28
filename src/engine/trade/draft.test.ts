import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { deliverMail, offerWords } from '../inbox';
import { simToEndOfSeason } from '../league';
import { migrateLeague } from '../migrate';
import { advanceOffseason, beginOffseason } from '../offseason';
import { boardOf, boardScore, draftOrder, nextPick, positionDepth, simDraft } from '../offseason/draft';
import { clamp, Rng } from '../rng';
import type { League, TradeOffer } from '../types';
import { tradeContext } from './context';
import { COVET_MAX, COVET_SCALE, draftCovet, draftTrades, expectedAt } from './draft';
import { emptyMarket } from './execute';
import { judge } from './judge';
import type { TradeProposal } from './rules';
import { pickValue } from './value';

/** One league played through a season and walked to draft day, cloned per test. */
const atDraft = (() => {
  const league = createLeague({ seed: 'draft-trades' });
  simToEndOfSeason(league);
  beginOffseason(league);
  while (league.phase !== 'draft') advanceOffseason(league, { autoUser: true });
  return JSON.stringify(league);
})();
const draftDay = (): League => JSON.parse(atDraft);

/** An offer to you from `teamId`: his picks for yours. */
function pickOffer(league: League, teamId: number, his: number[], yours: number[], reason: TradeOffer['reason']) {
  const market = (league.market ??= emptyMarket());
  const offer: TradeOffer = {
    id: market.nextOfferId++,
    teamId,
    sides: [
      { teamId, players: [], picks: his },
      { teamId: league.userTeamId, players: [], picks: yours },
    ],
    kind: 'draft',
    reason,
    season: league.season,
    phase: league.phase,
    week: league.week,
    moment: market.moment,
    status: 'pending',
    patience: 1,
    worth: 0,
  };
  market.offers.push(offer);
  return offer;
}

/** The first pick of yours and two later picks of another team, in this draft. */
function picksFor(league: League) {
  const order = draftOrder(league);
  const mine = order.find((p) => p.ownerId === league.userTeamId)!;
  const other = order.find((p) => p.ownerId !== league.userTeamId && p.overall! > mine.overall!)!;
  const theirs = order.filter((p) => p.ownerId === other.ownerId && p.overall! > mine.overall!).slice(0, 2);
  return { mine, team: league.teams[other.ownerId], theirs };
}

describe('draft-day offers in words', () => {
  it('reads a draft offer as a move up for your pick', () => {
    const l = draftDay();
    const { mine, team, theirs } = picksFor(l);
    const o = pickOffer(
      l,
      team.id,
      theirs.map((p) => p.id),
      [mine.id],
      'draft',
    );
    const words = offerWords(l, o);
    expect(words.subject).toBe(`The ${team.name} want to move up to No. ${mine.overall}`);
    expect(words.body).toContain(`No. ${theirs[0].overall}`);
    expect(words.body).toContain('now');
  });

  it('reads a shop answer about a pick', () => {
    const l = draftDay();
    const { mine, team, theirs } = picksFor(l);
    const o = pickOffer(l, team.id, [theirs[0].id], [mine.id], 'shop');
    expect(offerWords(l, o).subject).toBe(`The ${team.name} answer your call about No. ${mine.overall}`);
  });

  it("reads an ask as that team's price for its pick", () => {
    const l = draftDay();
    const { mine, team, theirs } = picksFor(l);
    const o = pickOffer(l, team.id, [theirs[0].id], [mine.id], 'ask');
    expect(offerWords(l, o).subject).toBe(`The ${team.name}' price for No. ${theirs[0].overall}`);
  });

  it('files no mail for draft offers or asks: they end with the pick', () => {
    const l = draftDay();
    const { mine, team, theirs } = picksFor(l);
    const ids = [
      pickOffer(l, team.id, [theirs[0].id], [mine.id], 'draft'),
      pickOffer(l, team.id, [theirs[1].id], [mine.id], 'ask'),
    ].map((o) => `offer:${o.season}:${o.id}`);
    deliverMail(l);
    expect((l.inbox ?? []).filter((m) => ids.some((id) => m.id.startsWith(id)))).toHaveLength(0);
  });
});

describe('save v60', () => {
  it('fills draft.via from the picks still kept', () => {
    const l = draftDay();
    const { mine, team } = picksFor(l);
    // A drafted pick that came from another team, and one that never moved.
    const used = draftOrder(l)
      .filter((p) => p.ownerId !== l.userTeamId)
      .slice(0, 2);
    const prospects = l.draftClass.map((id) => l.players[id]).slice(0, 2);
    used.forEach((pk, i) => {
      pk.playerId = prospects[i].id;
      prospects[i].teamId = pk.ownerId;
      prospects[i].draft = { season: l.season, round: pk.round, pick: pk.overall!, teamId: pk.ownerId };
    });
    used[0].originalTeamId = team.id === used[0].ownerId ? mine.ownerId : team.id;
    const old = JSON.parse(JSON.stringify(l)) as League;
    old.version = 59;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(60);
    expect(up.players[prospects[0].id].draft!.via).toBe(used[0].originalTeamId);
    expect(up.players[prospects[1].id].draft!.via).toBeUndefined();
  });
});

/** The first 32 picks of seed 'draft-trades' on main before draft-day trades (`simDraft`, rng 'baseline'). */
const BASELINE = [
  1805, 1775, 1803, 1770, 1771, 1802, 1781, 1799, 1776, 1786, 1842, 1772, 1782, 1773, 1791, 1831, 1796, 1774, 1809,
  1844, 1834, 1828, 1778, 1795, 1787, 1793, 1806, 1797, 1813, 1839, 1919, 1798,
];

/** The pick on the clock (an AI team's) and another AI team's pick `ahead` slots later. */
function clockAnd(league: League, ahead: number) {
  const order = draftOrder(league).filter((p) => p.playerId === undefined);
  const clock = order.find((p) => p.ownerId !== league.userTeamId)!;
  const later = order.find(
    (p) => p.overall! >= clock.overall! + ahead && p.ownerId !== clock.ownerId && p.ownerId !== league.userTeamId,
  )!;
  // Make the clock pick the next one: earlier picks are used up.
  for (const p of order) if (p.overall! < clock.overall!) p.playerId = -1;
  return { clock, later };
}
const swap = (clock: { id: number; ownerId: number }, later: { id: number; ownerId: number }): TradeProposal => ({
  sides: [
    { teamId: later.ownerId, players: [], picks: [later.id] },
    { teamId: clock.ownerId, players: [], picks: [clock.id] },
  ],
});

describe('covet', () => {
  it('boardScore with no rng adds no noise', () => {
    const l = draftDay();
    const p = l.draftClass.map((id) => l.players[id])[0];
    const t = l.teams[1];
    const board = boardOf(l, t.id, p);
    const depth = positionDepth(l, t.id);
    const noisy = boardScore(depth, p, board, new Rng('same'), 1);
    const clean = boardScore(depth, p, board, null, 1);
    expect(noisy - clean).toBeCloseTo(new Rng('same').normal(0, 0.6), 9);
  });

  it('leaves the draft as it was when no trade happens', () => {
    const l = draftDay();
    draftTrades.off = true;
    try {
      simDraft(l, new Rng('baseline'), { stopAtUser: false, limit: 32 });
    } finally {
      draftTrades.off = false;
    }
    expect(
      draftOrder(l)
        .slice(0, 32)
        .map((p) => p.playerId),
    ).toEqual(BASELINE);
  });

  it('is zero outside the draft and for you', () => {
    const l = draftDay();
    const { clock, later } = clockAnd(l, 6);
    const ctx = tradeContext(l);
    const userSide: TradeProposal = {
      sides: [
        { teamId: l.userTeamId, players: [], picks: [] },
        { teamId: clock.ownerId, players: [], picks: [clock.id] },
      ],
    };
    expect(draftCovet(ctx, l.userTeamId, userSide)).toEqual({ get: 0, give: 0 });
    l.phase = 'preseason';
    expect(draftCovet(tradeContext(l), clock.ownerId, swap(clock, later))).toEqual({ get: 0, give: 0 });
  });

  it('makes the team on the clock want more the further it would slide', () => {
    const l = draftDay();
    const { clock, later: near } = clockAnd(l, 1);
    const far = draftOrder(l).find((p) => p.overall! >= clock.overall! + 25 && p.ownerId !== clock.ownerId)!;
    const ctx = tradeContext(l);
    const give = (pk: typeof near) => draftCovet(ctx, clock.ownerId, swap(clock, pk)).give;
    expect(give(far)).toBeGreaterThan(0);
    expect(give(near)).toBeLessThanOrEqual(give(far));
  });

  it("is what judge adds to each side's stakes", () => {
    const l = draftDay();
    const { clock, later } = clockAnd(l, 8);
    const ctx = tradeContext(l);
    const deal = swap(clock, later);
    const on = judge(ctx, clock.ownerId, deal);
    const covet = draftCovet(ctx, clock.ownerId, deal);
    draftTrades.off = true;
    try {
      const off = judge(tradeContext(l), clock.ownerId, deal);
      expect(on.give - off.give).toBeCloseTo(covet.give, 6);
      expect(on.get - off.get).toBeCloseTo(covet.get, 6);
    } finally {
      draftTrades.off = false;
    }
  });

  it('gives a buyer the gap between its man now and its best at its own pick, on its own chart', () => {
    const l = draftDay();
    const { clock, later } = clockAnd(l, 8);
    const buyer = l.teams[later.ownerId];
    buyer.gm.archetype = 'Balanced';
    const ctx = tradeContext(l);
    const gap = expectedAt(l, buyer.id, clock).score - expectedAt(l, buyer.id, later).score;
    const want = pickValue(l, clock, buyer.gm, ctx) * clamp(gap / COVET_SCALE, 0, COVET_MAX);
    expect(draftCovet(ctx, buyer.id, swap(clock, later)).get).toBeGreaterThanOrEqual(want - 1e-6);
    expect(nextPick(l)!.id).toBe(clock.id);
  });

  it('makes a Pick Hoarder value picks coming in more', () => {
    const l = draftDay();
    const { clock, later } = clockAnd(l, 8);
    const seller = l.teams[clock.ownerId];
    seller.gm.archetype = 'Balanced';
    const balanced = draftCovet(tradeContext(l), seller.id, swap(clock, later)).get;
    seller.gm.archetype = 'Pick Hoarder';
    expect(draftCovet(tradeContext(l), seller.id, swap(clock, later)).get).toBeGreaterThan(balanced);
  });
});
