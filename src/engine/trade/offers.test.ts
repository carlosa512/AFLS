import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from '../generate';
import { playWeek, simToEndOfSeason } from '../league';
import { advanceOffseason, beginOffseason } from '../offseason';
import { deliverMail, needsYou, offerMailId } from '../inbox';
import { migrateLeague } from '../migrate';
import { rosterLimit } from '../offseason/negotiation';
import { playerOvr } from '../positions';
import { yearsLeft } from '../finance/contract';
import { activeRoster } from '../roster';
import type { League, TradeOffer } from '../types';
import {
  acceptOffer,
  answerEnquiry,
  ASKS,
  askPrice,
  capRoom,
  counterOffer,
  declineOffer,
  judge,
  keepToFit,
  maxRetain,
  openOffers,
  playerTradeBlocker,
  proposeTrade,
  resolveExam,
  salaryToTake,
  setTradeStatus,
  shopPlayer,
  teamNeeds,
  tradeContext,
  untouchables,
} from '.';
import { quickValue } from './deals';
import { bidFor, recheckOffers, yourListings } from './offers';
import { interestIn, isBuyer, updateInterest, wanted } from './plans';
import { POINTS_PER_K } from './value';
import type { TradeProposal } from './rules';
import { talksOf } from './talks';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
let base = '';
const fresh = (): League => JSON.parse(base);
const packaged = (l: League) => openOffers(l).filter((o) => o.kind !== 'enquiry');

/**
 * Enquiries are rare (about one a league a season reaches you), and any change to generation or play re-rolls who
 * asks when, so the enquiry tests look across a few fixed-seed leagues for them, as the refusal tests loop seeds.
 * `look` sees each week's open enquiries and returns true to stop there; otherwise the search ends with the first
 * league that showed any. Returns the league it stopped in, or null if none showed one.
 */
const ENQUIRY_SEEDS = ['trades-0', 'trades-1', 'trades-2', 'trades-3', 'trades-4', 'trades-5'];
function findEnquiries(weeks: number, look: (l: League, enquiries: TradeOffer[]) => boolean): League | null {
  for (const seed of ENQUIRY_SEEDS) {
    const l = createLeague({ seed });
    let seen = false;
    for (let w = 0; w < weeks && l.phase === 'regular'; w++) {
      const enquiries = openOffers(l).filter((o) => o.kind === 'enquiry');
      if (enquiries.length) {
        seen = true;
        if (look(l, enquiries)) return l;
      }
      playWeek(l);
    }
    if (seen) return l;
  }
  return null;
}

beforeAll(() => {
  // Play on until offers are on the desk.
  const l = createLeague({ seed: 'trades-0' });
  while (l.week <= 9 && packaged(l).length === 0) playWeek(l);
  base = JSON.stringify(l);
});

describe('offers to you', () => {
  it('arrive on autopilot and lapse when you play on, never accepted for you', () => {
    const l = fresh();
    const open = packaged(l);
    expect(open.length).toBeGreaterThan(0);
    const roster = activeRoster(l, l.userTeamId)
      .map((p) => p.id)
      .sort();
    playWeek(l);
    for (const o of open) expect(l.market!.offers.find((x) => x.id === o.id)!.status).toBe('expired');
    // Nothing of yours moved because of them.
    expect(open.every((o) => o.sides[1].players.every((id) => l.players[id].teamId === l.userTeamId))).toBe(true);
    expect(roster.length).toBeGreaterThan(0);
  });

  it('draws an offer for any of your three best prime-age non-specialists some team needs, priced in firsts or not', () => {
    // The trades audit's listing (`listingDraws`): your best players at a position an AI team needs, signed 2+ more
    // years. Shopped, a young cornerback draws a crowd, and the bidders' premium puts a buyer's price past every
    // package he'd sign off on (each first past the second costs him more than the going rate): he must offer the
    // best he'd pay under it, not nothing.
    const l = fresh();
    const ctx = tradeContext(l);
    const ai = l.teams.filter((t) => t.id !== l.userTeamId);
    const needed = new Set(ai.flatMap((t) => teamNeeds(ctx, t).map((n) => n.position)));
    const shop = activeRoster(l, l.userTeamId)
      .filter((p) => needed.has(p.position) && yearsLeft(p.contract!, l.season) >= 2 && !playerTradeBlocker(l, p))
      // Kickers and punters aren't traded for picks (the price audit leaves them out too), nor is a lineman of 34
      // with years left on his deal: the bug is a young starter priced in firsts, so prime-age players only (30 or
      // under, as the price audit's quality starters).
      .filter((p) => p.position !== 'K' && p.position !== 'P' && p.age <= 30)
      .sort((a, b) => playerOvr(b) - playerOvr(a))
      .slice(0, 3);
    for (const star of shop) {
      const x = fresh();
      setTradeStatus(x, star.id, 'listed');
      const before = x.market!.nextOfferId;
      for (let w = 0; w < 2; w++) playWeek(x);
      const named = x.market!.offers.filter((o) => o.id >= before && o.sides[1].players.includes(star.id));
      expect(named.length, `${star.position} ${star.age}`).toBeGreaterThan(0);
    }
  });

  it('bids for your player from a team short of room, with you keeping what it can’t fit, and pays for it', () => {
    // As between AI teams (`dealFor`) and when you buy (`askFor`): a buyer that can't fit his salary bids if you keep
    // paying the difference, and his price counts the money you keep. Without it, a listed starter on a big deal drew
    // bids only from the few teams with room for all of it.
    const l = fresh();
    const ctx = tradeContext(l);
    const ai = l.teams.filter((t) => t.id !== l.userTeamId);
    const cases: { player: number; buyer: number; paid: number }[] = [];
    for (const p of activeRoster(l, l.userTeamId)) {
      if (cases.length >= 8) break;
      if (!p.contract || playerTradeBlocker(l, p) || p.position === 'K' || p.position === 'P') continue;
      // Paid well past the minimum, so his team can keep a third of what's left.
      if (maxRetain(l, p) < 0.5 * salaryToTake(l, p)) continue;
      for (const t of ai) {
        if (capRoom(ctx, t.id) < salaryToTake(l, p) + 2000) continue;
        const bid = bidFor(ctx, t, p);
        if (!bid) continue;
        cases.push({ player: p.id, buyer: t.id, paid: quickValue(ctx, t, bid.sides[0]) });
        break;
      }
    }
    expect(cases.length, 'players a roomy team bids for').toBeGreaterThanOrEqual(4);
    let bids = 0;
    for (const c of cases) {
      // The same buyer squeezed so it fits only about two-thirds of what's left of his salary.
      const m = fresh();
      const p = m.players[c.player];
      const owed = salaryToTake(m, p);
      const room = capRoom(tradeContext(m), c.buyer);
      // Next year's room squeezed alike: a buyer with room to spare next year weighs money as a rich team does,
      // at as little as half (`salaryWeight` reads both years).
      const next = capRoom(tradeContext(m), c.buyer, m.season + 1);
      m.teams[c.buyer].deadMoney.push(
        { season: m.season, amount: Math.round(room - 0.67 * owed), playerId: -1, note: 'Test' },
        { season: m.season + 1, amount: Math.max(0, Math.round(next - room)), playerId: -1, note: 'Test' },
      );
      const mctx = tradeContext(m);
      const kept = keepToFit(m, p, capRoom(mctx, c.buyer));
      expect(kept).toBeGreaterThan(0);
      const bid = bidFor(mctx, m.teams[c.buyer], p);
      if (!bid) continue;
      bids++;
      expect(bid.sides[1].retain?.[p.id]).toBe(kept);
      // Most of the money comes back to you in picks, on top of what he'd pay with room for all of it.
      expect(quickValue(mctx, m.teams[c.buyer], bid.sides[0]) - c.paid).toBeGreaterThan(0.5 * POINTS_PER_K * kept!);
    }
    expect(bids, `bids from squeezed buyers, of ${cases.length}`).toBeGreaterThanOrEqual(cases.length / 2);
  });

  it('never shows you an offer its own team would already refuse', () => {
    let shown = 0;
    // trades-4 files a camp bid that its own team refuses by week 1 without the recheck.
    for (const seed of ['trades-4']) {
      const l = createLeague({ seed });
      for (let w = 0; w < 9; w++) {
        playWeek(l);
        const ctx = tradeContext(l);
        for (const o of packaged(l)) {
          shown++;
          expect(judge(ctx, o.teamId, { sides: o.sides }, { rosterCuts: true }).accepts).toBe(true);
        }
      }
    }
    // The loop really looked at offers.
    expect(shown).toBeGreaterThan(0);
  });

  it('only asks about a player it could bid for', () => {
    let asked = 0;
    // Every enquiry the first league with any shows in its first 12 weeks, each checked the week it's open.
    findEnquiries(12, (l, enquiries) => {
      for (const e of enquiries) {
        asked++;
        const p = l.players[e.sides[1].players[0]];
        expect(bidFor(tradeContext(l), l.teams[e.teamId], p)).not.toBeNull();
      }
      return false;
    });
    expect(asked).toBeGreaterThan(0);
  }, 120_000);

  it('says why every offer ended', () => {
    const l = fresh();
    const a = packaged(l)[0];
    // A second one on the desk, so one is turned down and one is left to lapse.
    const b: TradeOffer = { ...copy(a), id: l.market!.nextOfferId++ };
    l.market!.offers.push(b);
    declineOffer(l, a.id);
    expect(a.outcome).toMatch(/turned/i);
    playWeek(l);
    expect(b.outcome).toMatch(/lapsed/i);
    for (const o of l.market!.offers.filter((x) => x.status !== 'pending')) expect(o.outcome).toBeTruthy();
  });

  it('a counter leaves the original pointing at the reply', () => {
    const l = fresh();
    const original = packaged(l)[0];
    // Your roster stays the same size (a body for each he sends), but he is to throw in every pick he
    // owns: legal, and never worth it to him.
    const filler = activeRoster(l, l.userTeamId)
      .filter((p) => !original.sides[1].players.includes(p.id))
      .sort((a, b) => playerOvr(a) - playerOvr(b))
      .slice(0, original.sides[0].players.length)
      .map((p) => p.id);
    const greedy: TradeProposal = {
      sides: [
        { ...original.sides[1], players: [...original.sides[1].players, ...filler] },
        {
          ...original.sides[0],
          picks: l.draftPicks.filter((p) => p.ownerId === original.teamId).map((p) => p.id),
        },
      ],
    };
    const r = counterOffer(l, original.id, greedy);
    expect(['countered', 'walked'], r.message).toContain(r.result);
    if (r.result === 'countered') {
      expect(original.status).toBe('answered');
      expect(original.outcome).toMatch(/countered/i);
      expect(r.offer!.replyTo).toBe(original.id);
    } else {
      expect(original.status).toBe('declined');
      expect(original.outcome).toMatch(/walked away/i);
    }
  });

  it('pulls an offer or enquiry its team would now refuse, and leaves the sound ones', () => {
    const l = fresh();
    const market = l.market!;
    const sound = packaged(l)[0];
    // The same ask, but the team would now give away every pick it owns for it: it would refuse.
    const spoiled: TradeOffer = { ...copy(sound), id: market.nextOfferId++ };
    spoiled.sides[0].picks = l.draftPicks.filter((p) => p.ownerId === spoiled.teamId).map((p) => p.id);
    market.offers.push(spoiled);
    // An enquiry about a player its team has no number for.
    const ctx = tradeContext(l);
    let pair: { team: number; player: number } | undefined;
    for (const p of activeRoster(l, l.userTeamId)) {
      const team = l.teams.find((t) => t.id !== l.userTeamId && !bidFor(ctx, t, p));
      if (team) {
        pair = { team: team.id, player: p.id };
        break;
      }
    }
    expect(pair).toBeDefined();
    const enq: TradeOffer = {
      ...copy(spoiled),
      id: market.nextOfferId++,
      teamId: pair!.team,
      kind: 'enquiry',
      reason: 'enquiry',
      sides: [
        { teamId: pair!.team, players: [], picks: [] },
        { teamId: l.userTeamId, players: [pair!.player], picks: [] },
      ],
      status: 'pending',
      outcome: undefined,
    };
    market.offers.push(enq);
    recheckOffers(l);
    expect(spoiled.status).toBe('withdrawn');
    expect(spoiled.outcome).toMatch(/pulled it/i);
    expect(enq.status).toBe('withdrawn');
    expect(enq.outcome).toMatch(/pulled it/i);
    expect(sound.status).toBe('pending');
  });

  it('never asks for an Untouchable', () => {
    const l = fresh();
    const ids = activeRoster(l, l.userTeamId).map((p) => p.id);
    for (const id of ids) setTradeStatus(l, id, 'untouchable');
    for (let w = 0; w < 3; w++) playWeek(l);
    const asked = openOffers(l).flatMap((o) => o.sides[1].players);
    expect(asked.filter((id) => ids.includes(id))).toEqual([]);
    expect(untouchables(tradeContext(l), l.teams[l.userTeamId]).size).toBe(
      ids.filter((id) => l.players[id].teamId === l.userTeamId).length,
    );
  });

  it('accepts as offered, re-checked, and leaves both rosters legal', () => {
    const l = fresh();
    const offer = packaged(l)[0];
    let result = acceptOffer(l, offer.id);
    if (!result.ok && result.release)
      result = acceptOffer(
        l,
        offer.id,
        result.release.map((p) => p.id),
      );
    // A physical with concerns is still the offer as made: taking him anyway leaves the risk with you.
    if (!result.ok && result.exam) result = resolveExam(l, 'anyway');
    expect(result.ok).toBe(true);
    expect(l.market!.offers.find((o) => o.id === offer.id)!.status).toBe('accepted');
    for (const id of offer.sides[0].players) expect(l.players[id].teamId).toBe(l.userTeamId);
    expect(activeRoster(l, l.userTeamId).length).toBeLessThanOrEqual(rosterLimit(l));
    expect(activeRoster(l, offer.teamId).length).toBeLessThanOrEqual(rosterLimit(l));
  });

  it('withdraws an offer whose players have moved', () => {
    const l = fresh();
    const offer = packaged(l).find((o) => o.sides.some((s) => s.players.length))!;
    l.players[[...offer.sides[0].players, ...offer.sides[1].players][0]].teamId = null;
    expect(acceptOffer(l, offer.id).ok).toBe(false);
    expect(l.market!.offers.find((o) => o.id === offer.id)!.status).toBe('withdrawn');
  });

  it('tells every buyer that wants a player you list, even one that would rather have another of yours', () => {
    // Each buyer watches the one of your players it wants most; a listing has to reach the others that want him too,
    // or a shopped starter hears only from the teams whose first choice he already was.
    const l = fresh();
    const ai = l.teams.filter((t) => t.id !== l.userTeamId);
    let reached = 0;
    for (const star of activeRoster(l, l.userTeamId).sort((a, b) => playerOvr(b) - playerOvr(a))) {
      const x = fresh();
      setTradeStatus(x, star.id, 'listed');
      const ctx = tradeContext(x);
      const yours = yourListings(ctx);
      const listed = yours.filter((y) => y.entry.playerId === star.id);
      // Buyers that want him, but want another of yours more.
      const second = ai.filter((t) => {
        const team = x.teams[t.id];
        return isBuyer(team) && wanted(ctx, team, listed).length && wanted(ctx, team, yours)[0].player.id !== star.id;
      });
      if (!second.length) continue;
      updateInterest(ctx, x.market!, x.teams, [], yours);
      for (const t of second)
        expect(interestIn(x.market!, t.id, star.id), x.teams[t.id].abbrev).toBeGreaterThanOrEqual(2);
      if (++reached >= 3) break;
    }
    expect(reached, 'listings with a buyer that wanted another of yours more').toBeGreaterThan(0);
  });

  it('lets a team whose bid you let lapse call again once you list the player, but not one you turned down', () => {
    // A bid left to lapse keeps its team off him for two moments; putting him on the block answers it, and the
    // listing's call is "always made". A bid you declined keeps its wait.
    const l = fresh();
    // This tests the response to pending bids, not their random arrival frequency. Build two
    // real packages using the normal buyer/pricing rules; game outcomes need not make them arrive together.
    const ctx = tradeContext(l);
    const bids: TradeOffer[] = [];
    for (const player of activeRoster(l, l.userTeamId)) {
      for (const buyer of l.teams) {
        if (buyer.id === l.userTeamId || bids.some((o) => o.teamId === buyer.id)) continue;
        const proposal = bidFor(ctx, buyer, player);
        if (!proposal) continue;
        bids.push({
          id: l.market!.nextOfferId++,
          teamId: buyer.id,
          sides: proposal.sides,
          kind: 'user',
          reason: 'bid',
          season: l.season,
          phase: l.phase,
          week: l.week,
          moment: l.market!.moment,
          status: 'pending',
          patience: 2,
          worth: quickValue(ctx, buyer, proposal.sides[0]),
        });
        break;
      }
      if (bids.length === 2) break;
    }
    expect(bids, 'two valid buyer packages for different players and teams').toHaveLength(2);
    const [lapsed, declined] = bids;
    l.market!.offers = bids;
    const desk = JSON.stringify(l);
    declineOffer(l, declined.id);
    playWeek(l);
    const wait = (o: TradeOffer) => l.market!.talks[o.teamId].cooldowns[o.sides[1].players[0]];
    expect(wait(lapsed)).toBeDefined();
    expect(wait(declined)).toBeDefined();
    setTradeStatus(l, lapsed.sides[1].players[0], 'listed');
    setTradeStatus(l, declined.sides[1].players[0], 'listed');
    expect(wait(lapsed)).toBeUndefined();
    expect(wait(declined)).toBeDefined();
    // Listed while the bid is still on the desk: it lapses with no wait.
    const m: League = JSON.parse(desk);
    expect(m.market!.offers.find((o) => o.id === lapsed.id)?.status).toBe('pending');
    setTradeStatus(m, lapsed.sides[1].players[0], 'listed');
    playWeek(m);
    expect(m.market!.talks[lapsed.teamId]?.cooldowns[lapsed.sides[1].players[0]]).toBeUndefined();
  });

  it('keeps a team away from a player you turned down, unless it comes back clearly better', () => {
    const l = fresh();
    const offer = packaged(l)[0];
    declineOffer(l, offer.id);
    const cooldown = l.market!.talks[offer.teamId].cooldowns;
    for (const id of [...offer.sides[0].players, ...offer.sides[1].players])
      expect(cooldown[id]).toMatchObject({ until: l.market!.moment + 3, worth: offer.worth });
    playWeek(l);
    const again = openOffers(l).filter(
      (o) => o.teamId === offer.teamId && o.sides[1].players.some((id) => offer.sides[1].players.includes(id)),
    );
    for (const o of again) expect(o.worth).toBeGreaterThanOrEqual(offer.worth * 1.1);
  });

  it('runs out of patience: a counter he refuses at his final offer ends talks', () => {
    const l = fresh();
    let offer: TradeOffer | undefined = packaged(l)[0];
    // A counter he can't take: ask for everything back and give nothing.
    const lowball = (o: TradeOffer): TradeProposal => ({
      sides: [
        { teamId: l.userTeamId, players: [], picks: [] },
        { teamId: o.teamId, players: o.sides[0].players, picks: [...o.sides[0].picks] },
      ],
    });
    const seen: string[] = [];
    for (let round = 0; round < 5 && offer; round++) {
      const r = counterOffer(l, offer.id, lowball(offer));
      seen.push(r.result);
      offer = r.offer;
    }
    expect(seen.at(-1)).toMatch(/walked|refused/);
    expect(seen.filter((r) => r === 'countered').length).toBeLessThanOrEqual(3);
  });

  it('hears about four proposals a moment from you, then is done talking', () => {
    const l = fresh();
    const ai = l.teams.find((t) => t.id !== l.userTeamId)!;
    // A legal lowball: your worst player for his best, both tradeable (a hurt one fails the physical first) and
    // neither a kicker or punter (a team can't be left without one), with room under your cap for his salary (a trade
    // the cap forbids is a league rule, which costs no patience).
    l.teams[l.userTeamId].carryover = l.caps[l.season];
    const byOvr = (teamId: number) =>
      activeRoster(l, teamId)
        .filter((p) => !playerTradeBlocker(l, p) && p.position !== 'K' && p.position !== 'P')
        .sort((a, b) => playerOvr(b) - playerOvr(a));
    const junk: TradeProposal = {
      sides: [
        { teamId: l.userTeamId, players: [byOvr(l.userTeamId).at(-1)!.id], picks: [] },
        { teamId: ai.id, players: [byOvr(ai.id)[0].id], picks: [] },
      ],
    };
    const answers = Array.from({ length: 20 }, () => proposeTrade(l, junk).message);
    expect(answers.slice(ASKS)).toEqual(Array(20 - ASKS).fill("We're done talking this week."));
    expect(answers.some((m) => /\d/.test(m))).toBe(false);
  });

  it('shops a player once a moment and puts him on the block', () => {
    const l = fresh();
    const p = activeRoster(l, l.userTeamId).sort(
      (a, b) => (b.contract?.years.length ?? 0) - (a.contract?.years.length ?? 0),
    )[0];
    const first = shopPlayer(l, p.id);
    expect(l.market!.status[p.id]).toBe('listed');
    expect(first.offers.length).toBeLessThanOrEqual(3);
    for (const o of first.offers) expect(o.sides[1].players).toContain(p.id);
    expect(shopPlayer(l, p.id).message).toMatch(/already shopped/);
  });

  it('asks a price that never includes your Untouchables', () => {
    const l = fresh();
    for (const p of activeRoster(l, l.userTeamId)) setTradeStatus(l, p.id, 'untouchable');
    const target = Object.values(l.players).find((p) => p.teamId !== null && p.teamId !== l.userTeamId && p.contract)!;
    const { proposal, message } = askPrice(l, target.id);
    if (proposal) expect(proposal.sides[0].players).toEqual([]);
    else expect(message).toMatch(/can't make this work|won't discuss/);
  });

  it('stops a team asking after "Not for sale"', () => {
    const l = fresh();
    let enquiry = openOffers(l).find((o) => o.kind === 'enquiry');
    for (let w = 0; w < 4 && !enquiry; w++) {
      playWeek(l);
      enquiry = openOffers(l).find((o) => o.kind === 'enquiry');
    }
    if (!enquiry) return;
    const { offer } = answerEnquiry(l, enquiry.id, 'notForSale');
    expect(offer).toBeNull();
    expect(enquiry.status).toBe('declined');
    expect(enquiry.outcome).toMatch(/not for sale/i);
    const pid = enquiry.sides[1].players[0];
    expect(l.market!.talks[enquiry.teamId].cooldowns[pid].until).toBe(l.market!.moment + 6);
  });

  it('treats "Make me an offer" as an answer, and the bid replies to the enquiry', () => {
    const l = fresh();
    let enquiry = openOffers(l).find((o) => o.kind === 'enquiry');
    for (let w = 0; w < 6 && !enquiry; w++) {
      playWeek(l);
      enquiry = openOffers(l).find((o) => o.kind === 'enquiry');
    }
    if (!enquiry) return;
    const { offer: bid, message } = answerEnquiry(l, enquiry.id, 'offer');
    expect(enquiry.status).toBe('answered');
    expect(enquiry.outcome).toBe(message);
    if (bid) {
      expect(bid.replyTo).toBe(enquiry.id);
      expect(bid.status).toBe('pending');
    }
  });

  it('treats an enquiry whose team has no number as answered, not turned down', () => {
    let enquiry: TradeOffer | undefined;
    const l = findEnquiries(12, (_, enquiries) => !!(enquiry = enquiries[0]));
    expect(enquiry, 'an enquiry on the desk').toBeDefined();
    // Talks are off with this team this moment, so no bid can be filed.
    talksOf(l!.market!, enquiry!.teamId).offUntil = l!.market!.moment;
    const { offer } = answerEnquiry(l!, enquiry!.id, 'offer');
    expect(offer).toBeNull();
    expect(enquiry!.status).toBe('answered');
    expect(enquiry!.outcome).toMatch(/couldn't make the numbers work/);
  }, 120_000);

  it('never leaves a camp offer its own team would refuse by the time you can accept it', () => {
    let seen = 0;
    // trades-4 files a camp bid that its own team refuses by week 1 without the recheck.
    for (const seed of ['trades-4']) {
      const l = createLeague({ seed });
      simToEndOfSeason(l);
      beginOffseason(l);
      while (l.phase !== 'regular') {
        const before = l.market?.offers.length ?? 0;
        advanceOffseason(l, { autoUser: true });
        // Count every offer filed along the way (withdrawn ones too), so the check can't pass for lack of any.
        seen += (l.market?.offers.length ?? 0) - before;
      }
      const ctx = tradeContext(l);
      for (const o of openOffers(l)) {
        if (o.kind === 'enquiry') {
          expect(
            bidFor(ctx, l.teams[o.teamId], l.players[o.sides[1].players[0]]),
            `${seed} enquiry ${o.id}`,
          ).not.toBeNull();
        } else {
          expect(judge(ctx, o.teamId, { sides: o.sides }, { rosterCuts: true }).accepts, `${seed} offer ${o.id}`).toBe(
            true,
          );
        }
      }
    }
    expect(seen, 'offers seen across the seeds').toBeGreaterThan(0);
  }, 120_000);

  it('files a message for each open offer that needs you until it lapses', () => {
    const l = fresh();
    deliverMail(l);
    const offer = packaged(l)[0];
    const mail = l.inbox!.find((m) => m.id === offerMailId(l, offer))!;
    expect(mail).toBeDefined();
    expect(needsYou(l, mail)).toBe(true);
    expect(mail.body).not.toMatch(/\d+\.\d/);
    playWeek(l);
    expect(needsYou(l, mail)).toBe(false);
  });

  it('loads a save from before offers', () => {
    const old = copy(fresh()) as League;
    old.version = 24;
    const m = old.market as Partial<NonNullable<League['market']>>;
    delete m.offers;
    delete m.status;
    delete m.talks;
    delete m.shopped;
    delete m.nextOfferId;
    const up = migrateLeague(old)!;
    expect(up.version).toBe(SAVE_VERSION);
    expect(up.market).toMatchObject({ offers: [], status: {}, talks: {}, shopped: {}, nextOfferId: 1 });
  });
});
