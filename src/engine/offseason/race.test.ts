import { afterEach, describe, expect, it } from 'vitest';
import { capSpace } from '../finance/cap';
import { minSalary } from '../finance/market';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { activeRoster } from '../roster';
import { tradeCapImpact, tradeProblem, playerTradeBlocker, type TradeProposal } from '../trade/rules';
import type { League, Phase, Player, RaceOffer } from '../types';
import { payable, raiseTo, teamMoney, type BidPass } from './bids';
import { advanceOffseason, beginOffseason, FA_DAYS } from './index';
import {
  askOffer,
  demand,
  freeAgents,
  negotiationFor,
  offerCharge,
  offerProblem,
  offerValue,
  rosterLimit,
  signPlayer,
  type Offer,
} from './negotiation';
import {
  bidderCap,
  decides,
  inRace,
  letGo,
  pendingWarnings,
  placeUserOffer,
  pullUserOffer,
  raceWarningOpen,
  raceWatch,
  rankOffers,
  RACE,
  standingFitProblem,
  type DecideOpts,
  type RankedOffer,
} from './race';

/** A ranked offer worth `value` to him at `apy` a year. */
const offer = (teamId: number, value: number, apy = 1): RankedOffer => ({
  teamId,
  offer: { years: 3, apy, bonusPct: 0, gtdPct: 0.3, voidYears: 0 },
  value,
  floor: 0.5,
});

/** Nobody waited, an average patience, not the last day, an ask no offer reaches. */
const fresh = { waited: 0, patience: 0.5, lastDay: false, askApy: Infinity };

describe('when he decides', () => {
  it('needs an offer', () => {
    expect(decides([], fresh)).toBe(false);
    expect(decides([], { ...fresh, lastDay: true })).toBe(false);
  });

  it('takes a lone offer: nobody to beat', () => {
    expect(decides([offer(1, 1)], fresh)).toBe(true);
  });

  it('takes a best offer that stands out by the lead', () => {
    expect(decides([offer(1, 1.1), offer(2, 1)], fresh)).toBe(true);
    expect(decides([offer(1, 1.05), offer(2, 1)], fresh)).toBe(false);
  });

  it('takes his best once he has waited long enough, longer when patient', () => {
    const close = [offer(1, 1.05), offer(2, 1)];
    expect(decides(close, { ...fresh, waited: 2, patience: 0 })).toBe(true);
    expect(decides(close, { ...fresh, waited: 2, patience: 1 })).toBe(false);
  });

  it('needs half the lead for an offer at his full ask', () => {
    expect(RACE.lead).toBe(0.06);
    expect(decides([offer(1, 1.04, 10), offer(2, 1)], { ...fresh, askApy: 10 })).toBe(true);
    expect(decides([offer(1, 1.02, 10), offer(2, 1)], { ...fresh, askApy: 10 })).toBe(false);
    expect(decides([offer(1, 1.05, 9), offer(2, 1)], { ...fresh, askApy: 10 })).toBe(false);
  });

  it('settles on the last day with any offer', () => {
    expect(decides([offer(1, 1.01), offer(2, 1), offer(3, 1)], { ...fresh, lastDay: true })).toBe(true);
  });
});

/** A league at the re-sign window after one season: the next step opens free agency. */
const atResign = (() => {
  const l = createLeague({ seed: 'front-office-b' });
  simToEndOfSeason(l);
  beginOffseason(l);
  while (l.phase !== 'resign') advanceOffseason(l, { autoUser: true });
  return JSON.stringify(l);
})();

/** A copy of the world on free agency's day `day`, its staff running your team unless `autoUser` is false. */
function onDay(day: number, autoUser = true): League {
  const l: League = JSON.parse(atResign);
  advanceOffseason(l, { autoUser });
  expect(l.phase).toBe('freeAgency');
  while (l.faDay < day) advanceOffseason(l, { autoUser });
  return l;
}

/**
 * What the race judged for a player: his offers that day, the ones he would sign, best first, and what else he weighed
 * (the last time he was judged), and how many he would sign the first time, before any stepped aside (`weighed`).
 */
type Judged = { offers: RaceOffer[]; ranked: RankedOffer[]; o: DecideOpts; weighed: number };

/**
 * The next advance, staff-run unless `autoUser` is false, with what the race judged for each player (`check` sees each
 * in the day's own pass).
 */
function advanceWatched(
  l: League,
  check?: (pass: BidPass, j: Judged, playerId: number) => void,
  autoUser = true,
): Map<number, Judged> {
  const seen = new Map<number, Judged>();
  raceWatch.onJudge = (pass, p, offers, ranked, o) => {
    const weighed = seen.get(p.id)?.weighed ?? ranked.length;
    const j = { offers: structuredClone([...offers]), ranked: structuredClone([...ranked]), o: { ...o }, weighed };
    seen.set(p.id, j);
    check?.(pass, j, p.id);
  };
  advanceOffseason(l, { autoUser });
  delete raceWatch.onJudge;
  return seen;
}

/** Free-agency signings this league year. */
const faSignings = (l: League) =>
  l.transactions.filter((t) => t.kind === 'sign' && t.season === l.season && t.phase === 'freeAgency');

describe('the race for AI teams', () => {
  afterEach(() => {
    delete raceWatch.onJudge;
    delete raceWatch.onFit;
    delete raceWatch.onStepAside;
  });

  it('opening offers are in and nobody signs', () => {
    const l = onDay(1);
    const race = l.faRace!;
    expect(race.season).toBe(l.season);
    expect(Object.keys(race.offers).length).toBeGreaterThanOrEqual(10);
    expect(faSignings(l)).toHaveLength(0);
    // Only an offer at his walk-away stands, and every one is the team's opening price.
    for (const [id, offers] of Object.entries(race.offers)) {
      expect(rankOffers(l, l.players[+id], offers)).toHaveLength(offers.length);
      for (const o of offers) expect(o.first).toBe(o.offer.apy);
      expect(race.since[+id]).toBe(1);
    }
    expect(race.results).toEqual([]);
  });

  it('a clear leader signs, a close race waits', () => {
    const l = onDay(1);
    // Day 1: a player whose best doesn't stand out yet waits with his offers standing.
    let day = l.faDay;
    let seen = advanceWatched(l);
    const waiting = [...seen].filter(([, j]) => j.ranked.length >= 2 && !decides(j.ranked, j.o));
    expect(waiting.length).toBeGreaterThan(0);
    for (const [id, j] of waiting) {
      expect(l.players[id].teamId).toBeNull();
      expect(l.faRace!.offers[id].map((o) => o.teamId).sort()).toEqual(j.ranked.map((r) => r.teamId).sort());
    }
    // Every day, whoever signs in the race decided that day, for his best offer.
    let results = 0;
    for (;;) {
      for (const r of l.faRace!.results.filter((x) => x.day === day)) {
        const j = seen.get(r.playerId)!;
        expect(decides(j.ranked, j.o)).toBe(true);
        expect(r).toMatchObject({ teamId: j.ranked[0].teamId, offers: j.weighed });
        expect(l.players[r.playerId].teamId).toBe(r.teamId);
        results++;
      }
      if (l.phase !== 'freeAgency') break;
      day = l.faDay;
      seen = advanceWatched(l);
    }
    expect(results).toBeGreaterThan(0);
  });

  it("AI raises stop at the team's limit", () => {
    const l = onDay(1);
    let offers = 0;
    let raised = 0;
    // As a team sets its offers, it would still make each at its price.
    raceWatch.onFit = (pass, teamId, made) => {
      for (const { p, bid } of made) {
        expect(bid.team.id).toBe(teamId);
        expect(raiseTo(pass, p, bid, bid.offer.apy)).not.toBeNull();
      }
    };
    while (l.phase === 'freeAgency')
      advanceWatched(l, (pass, j) => {
        const ai = new Set(pass.teams.map((t) => t.id));
        for (const o of j.offers) {
          if (!ai.has(o.teamId)) continue;
          offers++;
          if (o.offer.apy > o.first) raised++;
          expect(o.offer.apy).toBeLessThanOrEqual(o.first * RACE.ceiling);
        }
      });
    expect(offers).toBeGreaterThan(0);
    expect(raised).toBeGreaterThan(0);
  });

  /** The AI offers each player has in a day's pass, with his place in the pool (read as the offers are set). */
  function watchBidders(): Map<number, { n: number; order: number }> {
    const seen = new Map<number, { n: number; order: number }>();
    raceWatch.onFit = (pass, teamId, made) => {
      for (const { p } of made) {
        if (teamId === pass.league.userTeamId) continue;
        const was = seen.get(p.id);
        seen.set(p.id, { n: (was?.n ?? 0) + 1, order: pass.pool.indexOf(p) });
      }
    };
    return seen;
  }

  it('the opening offers keep the most interested teams, by his tier', () => {
    const l: League = JSON.parse(atResign);
    const seen = watchBidders();
    advanceOffseason(l, { autoUser: true });
    expect(l.phase).toBe('freeAgency');
    for (const { n, order } of seen.values()) expect(n).toBeLessThanOrEqual(bidderCap(order));
    // The cap is by tier, not flat: a player at the top of the market draws more than the rest can.
    const top = [...seen.values()].filter((v) => v.order < RACE.bidders.top);
    expect(Math.max(...top.map((v) => v.n))).toBeGreaterThan(RACE.bidders.restMax);
    expect(bidderCap(0)).toBe(RACE.bidders.topMax);
    expect(bidderCap(RACE.bidders.top)).toBe(RACE.bidders.nextMax);
    expect(bidderCap(RACE.bidders.top + RACE.bidders.next)).toBe(RACE.bidders.restMax);
  });

  it('a later day adds no bidder past his tier, and keeps a standing offer', () => {
    const l = onDay(2);
    const before = new Map(Object.entries(l.faRace!.offers).map(([id, o]) => [+id, o.map((x) => x.teamId)]));
    const seen = watchBidders();
    advanceOffseason(l, { autoUser: true });
    for (const [id, { n, order }] of seen)
      expect(n).toBeLessThanOrEqual(Math.max(bidderCap(order), before.get(id)?.length ?? 0));
    // Nobody who stood the day before drops only for being outranked: any still unsigned keeps every team that could fit it.
    const signed = new Set(faSignings(l).map((t) => t.playerId));
    let kept = 0;
    for (const [id, teams] of before) {
      if (signed.has(id)) continue;
      const now = (l.faRace!.offers[id] ?? []).map((o) => o.teamId);
      kept += teams.filter((t) => now.includes(t)).length;
    }
    expect(kept).toBeGreaterThan(0);
  });

  it('your offer is never trimmed and never counts against the cap', () => {
    const l = (() => {
      const w: League = JSON.parse(atResign);
      advanceOffseason(w, { autoUser: false });
      return w;
    })();
    const you = l.userTeamId;
    // The player with the most AI offers: at his tier's cap already.
    const p = freeAgents(l).sort(
      (a, b) => (l.faRace!.offers[b.id]?.length ?? 0) - (l.faRace!.offers[a.id]?.length ?? 0),
    )[0];
    const rivals = l.faRace!.offers[p.id].length;
    expect(rivals).toBeGreaterThan(RACE.bidders.restMax);
    l.teams[you].carryover += 500_000_000;
    const d = demand(l, p, you);
    const ask = askOffer(d);
    const low = { ...ask, apy: Math.round(ask.apy * 0.8) };
    const res = placeUserOffer(l, p, low);
    if (res.status !== 'standing') return;
    const seen = watchBidders();
    advanceOffseason(l, { autoUser: false });
    expect(seen.get(p.id)?.n ?? 0).toBeLessThanOrEqual(Math.max(RACE.bidders.topMax, rivals));
    if (p.teamId === null) expect(l.faRace!.offers[p.id].some((o) => o.teamId === you)).toBe(true);
  });

  it("a team's offers fit its money", () => {
    const l: League = JSON.parse(atResign);
    let teams = 0;
    raceWatch.onFit = (pass, teamId, made) => {
      teams++;
      const bids = made.map((m) => m.bid);
      const m = teamMoney(pass, teamId);
      // What each would add to its cap this year as a contract, less the room the one restructure it may plan would make.
      const total = made.reduce(
        (a, { p, bid }) => a + offerCharge(pass.league, p, teamId, bid.offer) - (bid.plan?.saved ?? 0),
        0,
      );
      expect(total).toBeLessThanOrEqual(RACE.overcommit * (m.budget + m.back * Math.min(bids.length, m.spots)));
      expect(bids.length).toBeLessThanOrEqual(RACE.overcommit * m.room);
      expect(bids.filter((b) => b.plan).length).toBeLessThanOrEqual(1);
    };
    // The opening offers, then each day's.
    do advanceOffseason(l, { autoUser: true });
    while (l.phase === 'freeAgency');
    expect(teams).toBeGreaterThan(5 * 20);
  });

  it("a team that can't afford him steps aside", () => {
    const l = onDay(1);
    let asides = 0;
    let day: BidPass | undefined;
    const morning = new Map<number, number>();
    let aside: { playerId: number; teamId: number }[] = [];
    raceWatch.onStepAside = (pass, p, bid) => {
      asides++;
      aside.push({ playerId: p.id, teamId: bid.team.id });
      // It can't sign him now: no spot, no signing left today, or not the money for this offer.
      const m = teamMoney(pass, bid.team.id);
      const offer = payable(pass, p, bid)?.offer;
      const same =
        !!offer &&
        (['years', 'apy', 'bonusPct', 'gtdPct', 'voidYears'] as const).every((k) => offer[k] === bid.offer[k]);
      expect(m.room < 1 || m.signingsLeft < 1 || !same).toBe(true);
    };
    while (l.phase === 'freeAgency') {
      aside = [];
      day = undefined;
      advanceWatched(l, (pass) => {
        // The first player judged comes before any signing: what each team had to spend that morning.
        if (day) return;
        day = pass;
        for (const t of pass.teams) morning.set(t.id, teamMoney(pass, t.id).budget);
      });
      // No team signed past what it could: today's limit, its roster and its money (a team already short signs nobody).
      for (const t of day!.teams) {
        const m = teamMoney(day!, t.id);
        expect(m.signingsLeft).toBeGreaterThanOrEqual(0);
        expect(m.room).toBeGreaterThanOrEqual(0);
        // A thousand of slack: a deal fitted to the dollar can land a rounding past the budget (a fraction of a thousand).
        expect(m.budget).toBeGreaterThanOrEqual(Math.min(0, morning.get(t.id)!) - 1);
      }
      // A team that stepped aside didn't sign him that day.
      for (const { playerId, teamId } of aside) expect(l.players[playerId].teamId).not.toBe(teamId);
    }
    expect(asides).toBeGreaterThan(0);
  });

  it('no raises on the last day', () => {
    const l = onDay(FA_DAYS);
    const before = structuredClone(l.faRace!.offers);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    const seen = advanceWatched(l);
    let compared = 0;
    for (const [id, offers] of Object.entries(before)) {
      const today = seen.get(+id)?.offers ?? [];
      for (const o of offers) {
        const now = today.find((t) => t.teamId === o.teamId);
        if (!now) continue;
        compared++;
        expect(now.offer.apy).toBeLessThanOrEqual(o.offer.apy);
      }
    }
    expect(compared).toBeGreaterThan(0);
  });

  it('the last day settles everyone with a valid offer', () => {
    const l = onDay(FA_DAYS);
    const seen = advanceWatched(l);
    expect(l.phase as Phase).toBe('draft');
    const race = l.faRace!;
    expect(race.offers).toEqual({});
    let settled = 0;
    for (const [id, j] of seen) {
      if (!j.ranked.length) continue;
      settled++;
      expect(l.players[id].teamId).toBe(j.ranked[0].teamId);
      expect(race.results.find((r) => r.playerId === id)).toMatchObject({ day: FA_DAYS, teamId: j.ranked[0].teamId });
    }
    expect(settled).toBeGreaterThan(0);
  });

  it('a staff-run team bids like an AI team', () => {
    const offersFrom = (l: League, teamId: number) =>
      Object.values(l.faRace!.offers).filter((offers) => offers.some((o) => o.teamId === teamId)).length;
    const staff = onDay(1);
    expect(offersFrom(staff, staff.userTeamId)).toBeGreaterThan(0);
    const yours = onDay(1, false);
    expect(offersFrom(yours, yours.userTeamId)).toBe(0);
  });

  it('a player left with no offer is no longer counted as waiting', () => {
    const l = onDay(1);
    let lost = 0;
    while (l.phase === 'freeAgency') {
      const before = structuredClone(l.faRace!.offers);
      advanceOffseason(l, { autoUser: true });
      const race = l.faRace!;
      // Every day he has waited is counted from his first offer still standing: none, no count.
      for (const id of Object.keys(race.since)) expect(race.offers[+id]?.length).toBeGreaterThan(0);
      for (const id of Object.keys(before)) if (l.players[+id].teamId === null && !race.offers[+id]) lost++;
    }
    expect(lost).toBeGreaterThan(0);
  });

  it('a save from before the race', () => {
    const l = onDay(2);
    delete l.faRace;
    const signed = faSignings(l).length;
    advanceOffseason(l, { autoUser: true });
    expect(l.faDay).toBe(3);
    expect(Object.keys(l.faRace!.offers).length).toBeGreaterThan(0);
    expect(l.faRace!.results).toEqual([]);
    expect(faSignings(l)).toHaveLength(signed);
  });
});

/** Your team's free-agency day `day`, run by you (the warnings stop the game), as a cached world. */
const yours = (() => {
  const cache = new Map<number, string>();
  return (day: number): League => {
    if (!cache.has(day)) cache.set(day, JSON.stringify(onDay(day, false)));
    return JSON.parse(cache.get(day)!);
  };
})();

const you = (l: League) => l.userTeamId;

/** Your room on the cap set to `space` ($K), through the carryover. */
function setSpace(l: League, space: number): void {
  const t = l.teams[you(l)];
  t.carryover += space - capSpace(l, t.id);
}

/** His ask from you, at `apy` a year. */
const askAt = (l: League, p: Player, apy: number): Offer => ({
  ...askOffer(demand(l, p, you(l))),
  apy: Math.round(apy),
});

/** The least a year, in the shape of his ask, he'd take from you: his walk-away (his value is linear in the money). */
function floorApy(l: League, p: Player): number {
  const d = demand(l, p, you(l));
  const ask = askOffer(d);
  const per = offerValue(l, p, you(l), ask, d) / ask.apy;
  return Math.max(minSalary(p.experience, l.caps[l.season]), Math.ceil(d.walkAway / per) + 1);
}

/** An offer at his walk-away from you, which stands but trails anyone who pays more. */
const atFloor = (l: League, p: Player) => askAt(l, p, floorApy(l, p));

/** Half again over the best other offer for him: he'd take it clearly. */
function overTop(l: League, p: Player): Offer {
  const top = Math.max(...l.faRace!.offers[p.id].filter((o) => o.teamId !== you(l)).map((o) => o.offer.apy));
  return askAt(l, p, Math.max(top, floorApy(l, p)) * 1.5);
}

/** Free agents another team has an offer in for, best market first, and the ones with two or more such offers. */
const contested = (l: League, rivals = 1) =>
  freeAgents(l).filter(
    (p) => (l.faRace!.offers[p.id] ?? []).filter((o) => o.teamId !== you(l)).length >= rivals && !p.injury,
  );

/** Your place among the offers he'd sign. */
const placeOf = (l: League, p: Player) =>
  rankOffers(l, p, l.faRace!.offers[p.id] ?? []).findIndex((r) => r.teamId === you(l)) + 1;

/** Your roster filled to `open` spots short of the limit with minimum free agents nobody else bid on. */
function fillRoster(l: League, open: number): void {
  const pool = freeAgents(l).filter((p) => !l.faRace!.offers[p.id]);
  while (activeRoster(l, you(l)).length < rosterLimit(l) - open) {
    const p = pool.shift()!;
    const apy = minSalary(p.experience, l.caps[l.season]);
    signPlayer(l, p, you(l), { years: 1, apy, bonusPct: 0, gtdPct: 0, voidYears: 0 });
  }
}

/** Offers at the floor on as many contested players as the roster takes, room to spare. Their ids. */
function trailEverywhere(l: League): number[] {
  setSpace(l, 500_000);
  const placed: number[] = [];
  for (const p of contested(l)) {
    if (placeUserOffer(l, p, atFloor(l, p)).status === 'standing') placed.push(p.id);
  }
  return placed;
}

/** The next advance, run by you, with the last judging of each player. */
const judged = (l: League): Map<number, Judged> => advanceWatched(l, undefined, false);

describe('your offers', () => {
  afterEach(() => {
    delete raceWatch.onJudge;
  });

  it('uncontested: signs on the spot', () => {
    const l = yours(1);
    const p = freeAgents(l)
      .filter((x) => !l.faRace!.offers[x.id] && !x.injury)
      .find((x) => {
        const d = demand(l, x, you(l));
        const ask = askOffer(d);
        return offerValue(l, x, you(l), ask, d) >= d.walkAway && !offerProblem(l, x, you(l), ask);
      })!;
    expect(inRace(l, p.id)).toBe(false);
    expect(placeUserOffer(l, p, askOffer(demand(l, p, you(l))))).toMatchObject({ status: 'signed' });
    expect(p.teamId).toBe(you(l));
  });

  it('contested: your offer stands', () => {
    const l = yours(1);
    const p = contested(l)[0];
    expect(inRace(l, p.id)).toBe(true);
    const offer = atFloor(l, p);
    expect(placeUserOffer(l, p, offer).status).toBe('standing');
    expect(p.teamId).toBeNull();
    expect(l.faRace!.offers[p.id].find((o) => o.teamId === you(l))).toMatchObject({ offer, first: offer.apy });
  });

  it("every rival drops out: yours at day's end", () => {
    const l = yours(1);
    const p = contested(l)[0];
    expect(placeUserOffer(l, p, atFloor(l, p)).status).toBe('standing');
    // Nobody else can spend a dollar: every other offer is gone by the morning.
    for (const t of l.teams)
      if (t.id !== you(l)) t.deadMoney.push({ season: l.season, amount: 10_000_000, playerId: p.id, note: 'test' });
    l.faRace!.offers[p.id] = l.faRace!.offers[p.id].filter((o) => o.teamId === you(l));
    expect(p.teamId).toBeNull();
    advanceOffseason(l);
    expect(p.teamId).toBe(you(l));
    expect(l.faRace!.results.find((r) => r.playerId === p.id)).toMatchObject({ teamId: you(l), userPlace: 1 });
  });

  it('under his floor: refused, patience spent', () => {
    const l = yours(1);
    const p = contested(l).find((x) => {
      const apy = Math.round(floorApy(l, x) * 0.95);
      return apy >= minSalary(x.experience, l.caps[l.season]) && apy >= demand(l, x, you(l)).market * 0.8;
    })!;
    const patience = negotiationFor(l, p, you(l)).patience;
    const reply = placeUserOffer(l, p, askAt(l, p, floorApy(l, p) * 0.95));
    expect(reply.status).toBe('refused');
    expect(l.negotiations[p.id].patience).toBe(patience - 1);
    expect(l.faRace!.offers[p.id].some((o) => o.teamId === you(l))).toBe(false);
    expect(p.teamId).toBeNull();
  });

  it('offers must fit together', () => {
    // The cap: each fits alone, the two together don't.
    let l = yours(1);
    let [a, b] = contested(l);
    const [oa, ob] = [atFloor(l, a), atFloor(l, b)];
    setSpace(l, offerCharge(l, a, you(l), oa) + offerCharge(l, b, you(l), ob) - 1);
    expect(offerProblem(l, b, you(l), ob)).toBeNull();
    expect(placeUserOffer(l, a, oa).status).toBe('standing');
    const reply = placeUserOffer(l, b, ob);
    expect(reply.status).toBe('refused');
    expect(reply.message).toContain('cap room');
    expect(b.teamId).toBeNull();
    // The roster: one open spot takes one offer, not two.
    l = yours(1);
    [a, b] = contested(l);
    fillRoster(l, 1);
    setSpace(l, 500_000);
    expect(placeUserOffer(l, a, atFloor(l, a)).status).toBe('standing');
    expect(offerProblem(l, b, you(l), atFloor(l, b))).toBeNull();
    const full = placeUserOffer(l, b, atFloor(l, b));
    expect(full.status).toBe('refused');
    expect(full.message).toContain(`${rosterLimit(l)}`);
    expect(standingFitProblem(l, you(l))).toBeNull();
  });

  it('lowering is refused', () => {
    const l = yours(1);
    const p = contested(l)[0];
    const floor = floorApy(l, p);
    expect(placeUserOffer(l, p, askAt(l, p, floor * 1.05)).status).toBe('standing');
    expect(placeUserOffer(l, p, askAt(l, p, floor * 1.02))).toEqual({
      status: 'refused',
      message: 'You can raise your offer or pull it.',
    });
    expect(l.faRace!.offers[p.id].find((o) => o.teamId === you(l))!.offer.apy).toBe(Math.round(floor * 1.05));
    // A raise stands, and keeps the first price.
    expect(placeUserOffer(l, p, askAt(l, p, floor * 1.1)).status).toBe('standing');
    expect(l.faRace!.offers[p.id].find((o) => o.teamId === you(l))!.first).toBe(Math.round(floor * 1.05));
  });

  it('pulling a leading offer ends talks', () => {
    const l = yours(1);
    setSpace(l, 500_000);
    const [lead, ...rest] = contested(l);
    expect(placeUserOffer(l, lead, overTop(l, lead)).status).toBe('standing');
    expect(placeOf(l, lead)).toBe(1);
    pullUserOffer(l, lead.id);
    expect(l.negotiations[lead.id]).toMatchObject({ status: 'broken', brokenPhase: 'freeAgency' });
    expect(l.faRace!.offers[lead.id].some((o) => o.teamId === you(l))).toBe(false);
    expect(placeUserOffer(l, lead, overTop(l, lead)).status).toBe('broken');
    // Third or further back: free.
    const third = rest.find((p) => {
      if (rankOffers(l, p, l.faRace!.offers[p.id]).length < 2) return false;
      if (placeUserOffer(l, p, atFloor(l, p)).status !== 'standing') return false;
      if (placeOf(l, p) >= 3) return true;
      pullUserOffer(l, p.id);
      return false;
    })!;
    pullUserOffer(l, third.id);
    expect(l.negotiations[third.id]?.status).not.toBe('broken');
    expect(l.faRace!.offers[third.id].some((o) => o.teamId === you(l))).toBe(false);
  });

  it('letting him go with no warning open is a pull', () => {
    const l = yours(1);
    setSpace(l, 500_000);
    const p = contested(l)[0];
    expect(placeUserOffer(l, p, overTop(l, p)).status).toBe('standing');
    expect(raceWarningOpen(l, p.id)).toBe(false);
    letGo(l, p.id);
    expect(l.negotiations[p.id]).toMatchObject({ status: 'broken', brokenPhase: 'freeAgency' });
    expect(l.faRace!.offers[p.id].some((o) => o.teamId === you(l))).toBe(false);
    // So leading, walking away and coming back lower can't happen.
    expect(placeUserOffer(l, p, atFloor(l, p)).status).toBe('broken');
  });

  it('the warning', () => {
    const l = yours(1);
    const placed = trailEverywhere(l);
    expect(placed.length).toBeGreaterThan(5);
    const seen = judged(l);
    const warned = pendingWarnings(l);
    expect(warned.length).toBeGreaterThan(0);
    for (const id of warned) {
      // He'd have signed with the team ahead of you: he waits a day instead, your offer still in.
      const j = seen.get(id)!;
      expect(decides(j.ranked, j.o)).toBe(true);
      expect(j.ranked[0].teamId).not.toBe(you(l));
      expect(l.players[id].teamId).toBeNull();
      expect(raceWarningOpen(l, id)).toBe(true);
      expect(l.faRace!.offers[id].some((o) => o.teamId === you(l))).toBe(true);
    }
    const saved = JSON.stringify(l);
    expect(() => advanceOffseason(l)).toThrow('Answer the agents first.');
    // Refused, the advance changed nothing.
    expect(JSON.stringify(l)).toBe(saved);
    // Let him go: the offer is pulled, no hard feelings.
    const id = warned[0];
    letGo(l, id);
    expect(raceWarningOpen(l, id)).toBe(false);
    expect(l.negotiations[id]?.status).not.toBe('broken');
    expect(l.faRace!.offers[id].some((o) => o.teamId === you(l))).toBe(false);
    // Or raise: any raise answers it.
    const r: League = JSON.parse(saved);
    const p = r.players[id];
    const mine = r.faRace!.offers[id].find((o) => o.teamId === you(r))!;
    expect(placeUserOffer(r, p, { ...mine.offer, apy: mine.offer.apy + 1 }).status).toBe('standing');
    expect(raceWarningOpen(r, id)).toBe(false);
    expect(pendingWarnings(r)).not.toContain(id);
  });

  it('warned once per lost lead', () => {
    const l = yours(1);
    trailEverywhere(l);
    advanceOffseason(l);
    const warned = pendingWarnings(l);
    expect(warned.length).toBeGreaterThan(0);
    // A raise that still trails answers each.
    for (const id of warned) {
      const mine = l.faRace!.offers[id].find((o) => o.teamId === you(l))!;
      expect(placeUserOffer(l, l.players[id], { ...mine.offer, apy: mine.offer.apy + 1 }).status).toBe('standing');
      expect(placeOf(l, l.players[id])).toBeGreaterThan(1);
    }
    const seen = judged(l);
    let elsewhere = 0;
    for (const id of warned) {
      expect(pendingWarnings(l)).not.toContain(id);
      const j = seen.get(id)!;
      if (decides(j.ranked, j.o) && j.ranked[0].teamId !== you(l)) {
        expect(l.players[id].teamId).toBe(j.ranked[0].teamId);
        elsewhere++;
      }
    }
    expect(elsewhere).toBeGreaterThan(0);
  });

  it('a warning answered by taking the lead: losing it again brings a fresh warning', () => {
    const l = yours(1);
    trailEverywhere(l);
    advanceOffseason(l);
    let rewarned = 0;
    while (l.phase === 'freeAgency' && l.faDay < FA_DAYS) {
      // Each warning answered by a narrow lead: just over the best offer he has.
      const led: number[] = [];
      for (const id of pendingWarnings(l)) {
        const p = l.players[id];
        const d = demand(l, p, you(l));
        const ask = askOffer(d);
        const per = offerValue(l, p, you(l), ask, d) / ask.apy;
        const top = Math.max(...l.faRace!.offers[id].map((o) => offerValue(l, p, o.teamId, o.offer)));
        const reply = placeUserOffer(l, p, askAt(l, p, Math.max(floorApy(l, p), Math.ceil((top * 1.01) / per))));
        if (reply.status === 'standing' && placeOf(l, p) === 1) led.push(id);
      }
      for (const id of pendingWarnings(l)) letGo(l, id);
      const before = new Set(l.faRace!.warnings.map((w) => `${w.playerId}:${w.day}`));
      advanceOffseason(l);
      for (const id of led) {
        // An AI raise overnight may take the lead back: he waits and his agent calls again, never signs elsewhere.
        expect([null, you(l)]).toContain(l.players[id].teamId);
        if ((l.faRace?.warnings ?? []).some((w) => w.playerId === id && !before.has(`${w.playerId}:${w.day}`)))
          rewarned++;
      }
    }
    expect(rewarned).toBeGreaterThan(0);
  });

  it('the eve of the last day warns everyone you trail', () => {
    const l = yours(FA_DAYS - 1);
    trailEverywhere(l);
    const seen = judged(l);
    expect(l.faDay).toBe(FA_DAYS);
    let trailing = 0;
    let undecided = 0;
    for (const [id, j] of seen) {
      const place = j.ranked.findIndex((r) => r.teamId === you(l));
      if (place < 1) continue;
      trailing++;
      if (!decides(j.ranked, j.o)) undecided++;
      expect(pendingWarnings(l)).toContain(id);
      expect(l.players[id].teamId).toBeNull();
    }
    expect(trailing).toBeGreaterThan(0);
    expect(undecided).toBeGreaterThan(0);
  });

  it('the last day: only the teams in at the eve, at no more', () => {
    // Most of the market has signed by the eve: a fuller race, day 2's, played as the eve, every player's wait
    // starting now, so that only a lead decides him.
    const l = yours(2);
    l.faDay = FA_DAYS - 1;
    for (const id of Object.keys(l.faRace!.since)) l.faRace!.since[+id] = l.faDay;
    setSpace(l, 500_000);
    // A narrow lead on every contested player the roster takes: just over the best offer he has.
    for (const p of contested(l)) {
      const d = demand(l, p, you(l));
      const ask = askOffer(d);
      const per = offerValue(l, p, you(l), ask, d) / ask.apy;
      const top = Math.max(...l.faRace!.offers[p.id].map((o) => offerValue(l, p, o.teamId, o.offer)));
      placeUserOffer(l, p, askAt(l, p, Math.max(floorApy(l, p), Math.ceil((top * 1.003) / per))));
    }
    const eve = judged(l);
    // The eve's warnings answered by letting those players go: what's left you led as the eve ended.
    for (const id of pendingWarnings(l)) letGo(l, id);
    const standing = structuredClone(l.faRace!.offers);
    const led = [...eve]
      .filter(([id, j]) => j.ranked[0]?.teamId === you(l) && standing[id]?.some((o) => o.teamId === you(l)))
      .map(([id]) => id);
    expect(led.length).toBeGreaterThan(0);
    const last = judged(l);
    let rivals = 0;
    for (const [id, j] of last) {
      if (!j.offers.some((o) => o.teamId === you(l))) continue;
      const p = l.players[id];
      for (const o of j.offers) {
        if (o.teamId === you(l)) continue;
        // Every rival stood at the eve, and offers him no more than it did.
        const then = standing[id]?.find((x) => x.teamId === o.teamId);
        expect(then).toBeDefined();
        expect(offerValue(l, p, o.teamId, o.offer)).toBeLessThanOrEqual(offerValue(l, p, o.teamId, then!.offer));
        rivals++;
      }
    }
    expect(rivals).toBeGreaterThan(0);
    for (const id of led) expect(l.players[id].teamId).toBe(you(l));
  });

  it('the last day keeps no lead you did not hold at the eve', () => {
    /**
     * The last day judged: each player's first ranking (before any team stepped aside) as the judging made it, and his
     * offers ranked as they stand.
     */
    const lastDay = (l: League) => {
      const first = new Map<number, { judged: RankedOffer[]; natural: RankedOffer[] }>();
      advanceWatched(
        l,
        (pass, j, id) => {
          if (first.has(id)) return;
          first.set(id, { judged: j.ranked, natural: rankOffers(pass.league, pass.league.players[id], j.offers) });
        },
        false,
      );
      return first;
    };
    /** Those who trail as the offers stand were judged that way (yours not kept first). How many trailed. */
    const notKept = (l: League, ids: number[], last: ReturnType<typeof lastDay>): number => {
      let trailed = 0;
      for (const id of ids) {
        const j = last.get(id);
        if (!j?.natural.some((r) => r.teamId === you(l)) || j.natural[0].teamId === you(l)) continue;
        trailed++;
        expect(j.judged.map((r) => r.teamId)).toEqual(j.natural.map((r) => r.teamId));
      }
      return trailed;
    };
    // Warned before the eve and answered by a raise that still trails, then trailing as the eve ended (no second
    // warning: he hasn't led since): on the last day he weighs the offers as they are.
    let l = yours(FA_DAYS - 2);
    trailEverywhere(l);
    judged(l);
    const answered: number[] = [];
    for (const id of pendingWarnings(l)) {
      const p = l.players[id];
      const mine = l.faRace!.offers[id].find((o) => o.teamId === you(l))!;
      // A raise that closes in on the best rival without passing it: still trailing, but by less than he needs to sign.
      const d = demand(l, p, you(l));
      const per = offerValue(l, p, you(l), mine.offer, d) / mine.offer.apy;
      const top = Math.max(
        ...l.faRace!.offers[id].filter((o) => o.teamId !== you(l)).map((o) => offerValue(l, p, o.teamId, o.offer)),
      );
      const apy = Math.max(mine.offer.apy + 1, Math.floor((top * 0.97) / per));
      expect(placeUserOffer(l, p, { ...mine.offer, apy }).status).toBe('standing');
      if (placeOf(l, p) > 1) answered.push(id);
    }
    // His wait starts over with the raise, so that only a lead decides him on the eve.
    for (const id of answered) l.faRace!.since[id] = l.faDay;
    const eve = judged(l);
    for (const id of pendingWarnings(l)) letGo(l, id);
    const warned = answered.filter((id) => eve.get(id)?.ranked[0]?.teamId !== you(l) && !l.players[id].teamId);
    expect(warned.length).toBeGreaterThan(0);
    expect(notKept(l, warned, lastDay(l))).toBeGreaterThan(0);
    // An offer first placed on the last day, trailing: it was not first when placed, so nothing is kept for it.
    l = yours(FA_DAYS);
    const placed = trailEverywhere(l);
    expect(notKept(l, placed, lastDay(l))).toBeGreaterThan(0);
  });

  it('the last day keeps an offer that led when you placed it', () => {
    const l = yours(FA_DAYS);
    setSpace(l, 500_000);
    // A narrow lead placed on the last day, over the best offer he has: judged when placed, never lost unwarned.
    const led: number[] = [];
    for (const p of contested(l)) {
      const d = demand(l, p, you(l));
      const ask = askOffer(d);
      const per = offerValue(l, p, you(l), ask, d) / ask.apy;
      const top = Math.max(...l.faRace!.offers[p.id].map((o) => offerValue(l, p, o.teamId, o.offer)));
      const offer = askAt(l, p, Math.max(floorApy(l, p), Math.ceil((top * 1.003) / per)));
      if (placeUserOffer(l, p, offer).status === 'standing' && placeOf(l, p) === 1) led.push(p.id);
    }
    expect(led.length).toBeGreaterThan(0);
    // The night moves what the rivals are worth to him (their rosters change): their standing offers rise past yours.
    for (const id of led)
      for (const o of l.faRace!.offers[id])
        if (o.teamId !== you(l)) o.offer = { ...o.offer, apy: Math.round(o.offer.apy * 1.3) };
    const first = new Map<number, RankedOffer[]>();
    advanceWatched(
      l,
      (_pass, j, id) => {
        if (!first.has(id)) first.set(id, j.ranked);
      },
      false,
    );
    for (const id of led) expect(first.get(id)![0].teamId).toBe(you(l));
  });

  it('two wins the same day fit', () => {
    const l = yours(1);
    const [a, b] = contested(l);
    fillRoster(l, 2);
    setSpace(l, 500_000);
    const [oa, ob] = [overTop(l, a), overTop(l, b)];
    // Just the room for both.
    setSpace(l, Math.ceil(offerCharge(l, a, you(l), oa) + offerCharge(l, b, you(l), ob)) + 1);
    expect(placeUserOffer(l, a, oa).status).toBe('standing');
    expect(placeUserOffer(l, b, ob).status).toBe('standing');
    advanceOffseason(l);
    expect(a.teamId).toBe(you(l));
    expect(b.teamId).toBe(you(l));
    expect(capSpace(l, you(l))).toBeGreaterThanOrEqual(0);
    expect(activeRoster(l, you(l)).length).toBeLessThanOrEqual(rosterLimit(l));
  });

  it('an offer that no longer fits is dropped', () => {
    const l = yours(FA_DAYS);
    setSpace(l, 500_000);
    // Every player the roster takes with two teams in for him: some of them sign elsewhere today.
    const placed = contested(l, 2).filter((p) => placeUserOffer(l, p, overTop(l, p)).status === 'standing');
    expect(placed.length).toBeGreaterThan(0);
    // A release's dead money: none of them fits any more.
    l.teams[you(l)].deadMoney.push({
      season: l.season,
      amount: capSpace(l, you(l)),
      playerId: placed[0].id,
      note: 'test',
    });
    for (const p of placed) expect(offerProblem(l, p, you(l), overTop(l, p))).not.toBeNull();
    advanceOffseason(l);
    let told = 0;
    for (const p of placed) {
      expect(p.teamId).not.toBe(you(l));
      const result = l.faRace!.results.find((r) => r.playerId === p.id);
      if (!result) continue;
      expect(result.userDropped).toBe(true);
      told++;
    }
    expect(told).toBeGreaterThan(0);
  });

  it('a trade that breaks your offers is refused', () => {
    const l = yours(1);
    setSpace(l, 500_000);
    const offered = contested(l)
      .slice(0, 2)
      .map((p) => {
        const offer = atFloor(l, p);
        expect(placeUserOffer(l, p, offer).status).toBe('standing');
        return offerCharge(l, p, you(l), offer);
      });
    const charges = offered.reduce((a, b) => a + b, 0);
    const pick = l.draftPicks.find((d) => d.ownerId === you(l) && d.playerId === undefined)!;
    const star = Object.values(l.players).find(
      (p) =>
        p.teamId !== null &&
        p.teamId !== you(l) &&
        p.contract &&
        !playerTradeBlocker(l, p) &&
        capSpace(l, you(l)) -
          tradeCapImpact(l, {
            sides: [
              { teamId: you(l), players: [], picks: [pick.id] },
              { teamId: p.teamId, players: [p.id], picks: [] },
            ],
          })[0].space >
          charges,
    )!;
    const proposal: TradeProposal = {
      sides: [
        { teamId: you(l), players: [], picks: [pick.id] },
        { teamId: star.teamId!, players: [star.id], picks: [] },
      ],
    };
    // Room for him, but not for him and your offers.
    const cost = capSpace(l, you(l)) - tradeCapImpact(l, proposal)[0].space;
    setSpace(l, cost + Math.floor(charges / 2));
    const space = tradeCapImpact(l, proposal)[0].space;
    expect(space).toBeGreaterThanOrEqual(0);
    const problem = standingFitProblem(l, you(l), { space });
    expect(problem).toContain('cap room');
    expect(tradeProblem(l, proposal)).toBe(problem);
    // Your staff's offers, while you are out of a job, are the AI's: held to its own books.
    const gm = l.gms[l.userGmId].teamId;
    l.gms[l.userGmId].teamId = null;
    expect(tradeProblem(l, proposal)).toBeNull();
    l.gms[l.userGmId].teamId = gm;
    for (const id of Object.keys(l.faRace!.offers)) pullUserOffer(l, +id);
    expect(tradeProblem(l, proposal)).toBeNull();
  });

  it('a trade that brings in more players than it sends counts them beside your offers', () => {
    const l = yours(1);
    setSpace(l, 500_000);
    const [p] = contested(l);
    expect(placeUserOffer(l, p, atFloor(l, p)).status).toBe('standing');
    // Your roster and your one offer fill it.
    fillRoster(l, 1);
    setSpace(l, 500_000);
    const pick = l.draftPicks.find((d) => d.ownerId === you(l) && d.playerId === undefined)!;
    const star = Object.values(l.players).find(
      (x) => x.teamId !== null && x.teamId !== you(l) && x.contract && !playerTradeBlocker(l, x),
    )!;
    const proposal: TradeProposal = {
      sides: [
        { teamId: you(l), players: [], picks: [pick.id] },
        { teamId: star.teamId!, players: [star.id], picks: [] },
      ],
    };
    expect(standingFitProblem(l, you(l))).toBeNull();
    const problem = standingFitProblem(l, you(l), { roster: 1 });
    expect(problem).toContain('roster');
    expect(tradeProblem(l, proposal)).toBe(problem);
  });

  it('spectating: no warnings', () => {
    const l: League = JSON.parse(atResign);
    l.gms[l.userGmId].teamId = null;
    advanceOffseason(l);
    expect(l.phase).toBe('freeAgency');
    while (l.phase === 'freeAgency') {
      advanceOffseason(l);
      expect(pendingWarnings(l)).toEqual([]);
    }
    expect(l.faRace!.results.length).toBeGreaterThan(0);
  });
});
