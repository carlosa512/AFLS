import { describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from '../generate';
import { deliverMail, offerWords } from '../inbox';
import { simToEndOfSeason } from '../league';
import { migrateLeague } from '../migrate';
import { advanceOffseason, beginOffseason, draftForUser, draftToEnd, draftToUserPick } from '../offseason';
import {
  availableRanks,
  boardOf,
  boardScore,
  draftOrder,
  nextPick,
  picksAhead,
  positionDepth,
  simDraft,
} from '../offseason/draft';
import { clamp, Rng } from '../rng';
import type { League, TradeOffer } from '../types';
import { scoutPlayer } from '../scouting';
import { tradeContext } from './context';
import {
  boardBase,
  COVET_MAX,
  COVET_MIN,
  COVET_SCALE,
  draftCovet,
  draftTrades,
  expectedAt,
  FUTURE_TOP,
  callAhead,
  clockOffers,
  draftLine,
  LONG_JUMP,
  shopPick,
  tradeUpReason,
  WINDOW,
} from './draft';
import { emptyMarket } from './execute';
import { evaluateTrade, judge } from './judge';
import { quickValue } from './deals';
import { acceptOffer, openOffers } from './offers';
import { dealWatch, MINOR } from './market';
import { playerTradeBlocker, tradeProblem, type TradeProposal } from './rules';
import { goingRate, pickValue } from './value';

/** One league played through a season and walked to draft day, cloned per test. */
const atDraft = (() => {
  const league = createLeague({ seed: 'draft-trades-c' });
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
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.players[prospects[0].id].draft!.via).toBe(used[0].originalTeamId);
    expect(up.players[prospects[1].id].draft!.via).toBeUndefined();
  });
});

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

/** Round 1 played with trades on, every AI draft deal read as it closes. */
const roundOne = (() => {
  const l = draftDay();
  const closed: { buyer: number; seller: number; pick: number; target: number | undefined; accepts: boolean[] }[] = [];
  dealWatch.onClose = (ctx, deal, proposal) => {
    if (deal.kind !== 'draft') return;
    const clock = nextPick(ctx.league)!;
    const b = proposal.sides.find((s) => !s.picks.includes(clock.id))!.teamId;
    closed.push({
      buyer: b,
      seller: clock.ownerId,
      pick: clock.id,
      target: expectedAt(ctx.league, b, clock).best?.id,
      accepts: proposal.sides.map((side) => judge(ctx, side.teamId, proposal).accepts),
    });
  };
  try {
    simDraft(l, new Rng('round-one'), { stopAtUser: false, limit: 32 });
  } finally {
    delete dealWatch.onClose;
  }
  return { l, closed };
})();

describe('AI trades before each pick', () => {
  it('trades up only with a reason: a man likely gone, a tier break, need or premium, a short jump', () => {
    const l = draftDay();
    let checked = 0;
    for (let i = 0; i < 32; i++) {
      const clock = nextPick(l)!;
      const ranks = availableRanks(l);
      for (const pk of picksAhead(l, WINDOW)) {
        if (pk.ownerId === l.userTeamId || pk.ownerId === clock.ownerId) continue;
        const why = tradeUpReason(tradeContext(l), l.teams[pk.ownerId], pk);
        if (!why) continue;
        checked++;
        const before = pk.overall! - clock.overall!;
        expect(ranks.get(why.target.id)!).toBeLessThanOrEqual(before + 3);
        expect(why.gap).toBeGreaterThanOrEqual(COVET_MIN);
        if (before > LONG_JUMP) expect(why.target.position).toBe('QB');
        if (why.target.position === 'K' || why.target.position === 'P') expect(clock.round).toBeGreaterThanOrEqual(5);
      }
      draftTrades.off = true;
      simDraft(l, new Rng(`step-${i}`), { stopAtUser: false, limit: 1 });
      draftTrades.off = false;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('makes deals in round 1 that both sides accept, and the team that moved up takes its man', () => {
    const { l, closed } = roundOne;
    expect(closed.length).toBeGreaterThan(0);
    for (const c of closed) {
      expect(c.accepts).toEqual([true, true]);
      const pick = l.draftPicks.find((p) => p.id === c.pick)!;
      expect(pick.ownerId).toBe(c.buyer);
      expect(pick.playerId).toBe(c.target);
    }
  });

  it('never trades into your pick', () => {
    const { l } = roundOne;
    for (const r of l.market!.history.filter((x) => x.kind === 'draft'))
      expect(r.sides.map((s) => s.teamId)).not.toContain(l.userTeamId);
  });

  it('keeps who a pick came from on the player it was used on', () => {
    const { l, closed } = roundOne;
    const p = l.players[l.draftPicks.find((x) => x.id === closed[0].pick)!.playerId!];
    expect(p.draft!.via).toBeDefined();
    expect(p.draft!.deal!.from).toBe(closed[0].seller);
    expect(p.draft!.deal!.got.length).toBeGreaterThan(0);
  });

  it("doesn't count draft deals against a team's trade limits", () => {
    expect(MINOR.has('draft')).toBe(true);
  });
});

/** Draft day walked to your first pick that draws offers (the draft room's Sim to my pick makes them). */
function toOfferedPick(): League {
  const l = draftDay();
  for (let tries = 0; tries < 7; tries++) {
    draftToUserPick(l);
    if (!nextPick(l)) break;
    if (openOffers(l).some((o) => o.reason === 'draft')) return l;
    draftForUser(l);
  }
  throw new Error('No pick of yours drew an offer');
}
const onYourPick = (l: League) => openOffers(l).filter((o) => o.sides[1].picks.includes(nextPick(l)!.id));

describe('offers to you on the clock', () => {
  it('brings at most 2, one a team, each at the going rate for your pick or better', () => {
    const l = toOfferedPick();
    const offers = onYourPick(l).filter((o) => o.reason === 'draft');
    expect(offers.length).toBeGreaterThan(0);
    expect(offers.length).toBeLessThanOrEqual(2);
    expect(new Set(offers.map((o) => o.teamId)).size).toBe(offers.length);
    const ctx = tradeContext(l);
    const user = l.teams[l.userTeamId];
    for (const o of offers)
      expect(quickValue(ctx, user, o.sides[0])).toBeGreaterThanOrEqual(goingRate(l, nextPick(l)!, ctx) - 1e-6);
  });

  it('makes them once a pick, after a save and load too', () => {
    const l = toOfferedPick();
    expect(clockOffers(l)).toHaveLength(0);
    const loaded: League = JSON.parse(JSON.stringify(l));
    expect(clockOffers(loaded)).toHaveLength(0);
  });

  it('lets them lapse quietly when the rest is simmed, and makes no more', () => {
    const l = toOfferedPick();
    const ids = onYourPick(l).map((o) => o.id);
    const before = l.market!.offers.length;
    draftToEnd(l);
    for (const id of ids) {
      const o = l.market!.offers.find((x) => x.id === id)!;
      expect(o.status).toBe('expired');
      expect(o.outcome).toBe('It lapsed when you picked.');
      expect(l.market!.talks[o.teamId]?.cooldowns ?? {}).toEqual({});
    }
    expect(l.market!.offers.slice(before).filter((o) => o.reason === 'draft')).toHaveLength(0);
  });

  it('closes the other offer on your pick when you accept one', () => {
    const l = toOfferedPick();
    const pick = nextPick(l)!;
    const [first] = onYourPick(l);
    const other = l.teams.find((t) => t.id !== first.teamId && t.id !== l.userTeamId)!;
    const later = draftOrder(l).find((p) => p.ownerId === other.id && p.playerId === undefined)!;
    const second = pickOffer(l, other.id, [later.id], [pick.id], 'draft');
    expect(acceptOffer(l, first.id).ok).toBe(true);
    expect(openOffers(l).map((o) => o.id)).not.toContain(second.id);
    expect(second.status).not.toBe('pending');
  });

  it('moves on to your next pick when you hold two in a row', () => {
    const l = toOfferedPick();
    const pick = nextPick(l)!;
    const next = draftOrder(l).find((p) => p.overall === pick.overall! + 1)!;
    next.ownerId = l.userTeamId;
    const ids = onYourPick(l).map((o) => o.id);
    draftForUser(l);
    for (const id of ids) expect(l.market!.offers.find((x) => x.id === id)!.status).toBe('expired');
    expect(l.market!.clockPick).toBe(next.id);
  });

  it('says why when you have no pick to shop or call about', () => {
    const l = draftDay();
    const other = l.teams.find((t) => t.id !== l.userTeamId)!;
    for (const p of draftOrder(l)) if (p.ownerId === l.userTeamId) p.ownerId = other.id;
    expect(callAhead(l).message).toBe('You have no pick coming.');
    expect(shopPick(l).message).toBe("You're not on the clock.");
  });

  it('shops a pick once, skipping the teams already offering', () => {
    const l = toOfferedPick();
    const offering = new Set(onYourPick(l).map((o) => o.teamId));
    const shop = shopPick(l);
    for (const o of shop.offers) {
      expect(offering.has(o.teamId)).toBe(false);
      expect(o.reason).toBe('shop');
    }
    expect(shopPick(l).message).toMatch(/already shopped/);
  });

  it('calls only the teams picking before your next pick, each at a price it takes', () => {
    const l = draftDay();
    const mine = draftOrder(l).find((p) => p.ownerId === l.userTeamId && p.playerId === undefined)!;
    const res = callAhead(l);
    const ctx = tradeContext(l);
    for (const o of res.offers) {
      expect(o.reason).toBe('ask');
      const theirs = l.draftPicks.find((p) => p.id === o.sides[0].picks[0])!;
      expect(theirs.overall!).toBeLessThan(mine.overall!);
      expect(o.sides[1].picks).toContain(mine.id);
      expect(judge(ctx, o.teamId, { sides: o.sides }, { vsUser: true }).accepts).toBe(true);
    }
    expect(callAhead(l).message).toBe("You've already called around this pick.");
  });

  it('makes a team on the clock with its man on the board ask more of you', () => {
    const l = draftDay();
    const { clock } = clockAnd(l, 1);
    const mine = draftOrder(l).find((p) => p.ownerId === l.userTeamId && p.overall! > clock.overall!)!;
    const proposal: TradeProposal = {
      sides: [
        { teamId: l.userTeamId, players: [], picks: [mine.id] },
        { teamId: clock.ownerId, players: [], picks: [clock.id] },
      ],
    };
    const covet = evaluateTrade(l, proposal).shortfall;
    draftTrades.off = true;
    try {
      expect(covet).toBeGreaterThan(evaluateTrade(l, proposal).shortfall);
    } finally {
      draftTrades.off = false;
    }
  });

  it("gives your director's word from your own board", () => {
    const l = toOfferedPick();
    const [o] = onYourPick(l);
    const line = draftLine(l, o.sides)!;
    expect(line.who).toBe('scouts');
    const m = line.line.match(/^At No\. (\d+) we'd still likely get one of our top (\d+)\.$/)!;
    expect(m).not.toBeNull();
    // The best still likely there at the later pick, ranked on your own board (your scouts' read).
    const later = l.draftPicks.find((p) => p.overall === Number(m[1]) && p.season === l.season)!;
    const at = expectedAt(l, l.userTeamId, later).best!;
    const mine = (p: { id: number }) => boardOf(l, l.userTeamId, l.players[p.id]);
    expect(mine(at)).toBeDefined();
    const k = Number(m[2]);
    expect(line.tone).toBe(k <= 3 ? 'good' : k <= 8 ? 'note' : 'warn');
  });
});

describe('the cap and pick trades', () => {
  it("doesn't block a picks-only deal on draft day for a team over the cap: no salary moves", () => {
    const l = draftDay();
    const { clock, later } = clockAnd(l, 3);
    l.caps[l.season] = 1000;
    expect(tradeProblem(l, swap(clock, later))).toBeNull();
    // A player who can be traded at all (not hurt or on IR), so the cap is the only thing that can stop the deal.
    const p = Object.values(l.players).find(
      (x) => x.teamId === clock.ownerId && x.contract && !playerTradeBlocker(l, x),
    )!;
    const withPlayer: TradeProposal = {
      sides: [swap(clock, later).sides[0], { ...swap(clock, later).sides[1], players: [p.id] }],
    };
    expect(tradeProblem(l, withPlayer)).toMatch(/over the cap/);
    l.phase = 'freeAgency';
    expect(tradeProblem(l, swap(clock, later))).toMatch(/over the cap/);
  });
});

describe('your board mid-draft', () => {
  it('reads a scouting visit made during the draft', () => {
    const l = draftDay();
    const p = l.draftClass.map((id) => l.players[id]).find((x) => x.teamId === null)!;
    boardBase(l, l.userTeamId, p, 1);
    l.scoutPoints = Math.max(1, l.scoutPoints);
    scoutPlayer(l, p.id);
    const fresh = boardScore(positionDepth(l, l.userTeamId), p, boardOf(l, l.userTeamId, p), null, 1);
    expect(boardBase(l, l.userTeamId, p, 1)).toBeCloseTo(fresh, 9);
  });
});

describe('future picks on draft day', () => {
  it('go only into trade-ups into the top half of the first round, or for a first-round QB, as a last resort', () => {
    const l = draftDay();
    simDraft(l, new Rng('whole'), { stopAtUser: false });
    const pk = (id: number) => l.draftPicks.find((p) => p.id === id)!;
    const ups = l.market!.history.filter((r) => r.kind === 'draft' && r.season === l.season);
    expect(ups.length).toBeGreaterThan(0);
    for (const r of ups)
      if (r.sides[0].picks.some((id) => pk(id).season > l.season))
        if (l.players[pk(r.sides[1].picks[0]).playerId!].position !== 'QB')
          expect(pk(r.sides[1].picks[0]).overall).toBeLessThanOrEqual(FUTURE_TOP);
  });
});
