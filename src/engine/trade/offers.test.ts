import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague, SAVE_VERSION } from '../generate';
import { playWeek } from '../league';
import { deliverMail, needsYou } from '../inbox';
import { migrateLeague } from '../migrate';
import { rosterLimit } from '../offseason/negotiation';
import { playerOvr } from '../positions';
import { activeRoster } from '../roster';
import type { League, TradeOffer } from '../types';
import { acceptOffer, answerEnquiry, ASKS, askPrice, counterOffer, declineOffer, openOffers, proposeTrade, setTradeStatus, shopPlayer, tradeContext, untouchables } from '.';
import type { TradeProposal } from './rules';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));
let base = '';
const fresh = (): League => JSON.parse(base);
const packaged = (l: League) => openOffers(l).filter((o) => o.kind !== 'enquiry');

beforeAll(() => {
  // Play on until offers are on the desk.
  const l = createLeague({ seed: 'trades-0' });
  while (l.week <= 9 && packaged(l).length === 0) playWeek(l);
  base = JSON.stringify(l);
}, 60_000);

describe('offers to you', () => {
  it('arrive on autopilot and lapse when you play on, never accepted for you', () => {
    const l = fresh();
    const open = packaged(l);
    expect(open.length).toBeGreaterThan(0);
    const roster = activeRoster(l, l.userTeamId).map((p) => p.id).sort();
    playWeek(l);
    for (const o of open) expect(l.market!.offers.find((x) => x.id === o.id)!.status).toBe('expired');
    // Nothing of yours moved because of them.
    expect(open.every((o) => o.sides[1].players.every((id) => l.players[id].teamId === l.userTeamId))).toBe(true);
    expect(roster.length).toBeGreaterThan(0);
  }, 30_000);

  it('never asks for an Untouchable', () => {
    const l = fresh();
    const ids = activeRoster(l, l.userTeamId).map((p) => p.id);
    for (const id of ids) setTradeStatus(l, id, 'untouchable');
    for (let w = 0; w < 3; w++) playWeek(l);
    const asked = openOffers(l).flatMap((o) => o.sides[1].players);
    expect(asked.filter((id) => ids.includes(id))).toEqual([]);
    expect(untouchables(tradeContext(l), l.teams[l.userTeamId]).size).toBe(ids.filter((id) => l.players[id].teamId === l.userTeamId).length);
  }, 30_000);

  it('accepts as offered, re-checked, and leaves both rosters legal', () => {
    const l = fresh();
    const offer = packaged(l)[0];
    let result = acceptOffer(l, offer.id);
    if (!result.ok && result.release) result = acceptOffer(l, offer.id, result.release.map((p) => p.id));
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

  it("keeps a team away from a player you turned down, unless it comes back clearly better", () => {
    const l = fresh();
    const offer = packaged(l)[0];
    declineOffer(l, offer.id);
    const cooldown = l.market!.talks[offer.teamId].cooldowns;
    for (const id of [...offer.sides[0].players, ...offer.sides[1].players]) expect(cooldown[id]).toMatchObject({ until: l.market!.moment + 3, worth: offer.worth });
    playWeek(l);
    const again = openOffers(l).filter((o) => o.teamId === offer.teamId && o.sides[1].players.some((id) => offer.sides[1].players.includes(id)));
    for (const o of again) expect(o.worth).toBeGreaterThanOrEqual(offer.worth * 1.1);
  }, 30_000);

  it('runs out of patience: a counter he refuses at his final offer ends talks', () => {
    const l = fresh();
    let offer: TradeOffer | undefined = packaged(l)[0];
    // A counter he can't take: ask for everything back and give nothing.
    const lowball = (o: TradeOffer): TradeProposal => ({ sides: [{ teamId: l.userTeamId, players: [], picks: [] }, { teamId: o.teamId, players: o.sides[0].players, picks: [...o.sides[0].picks] }] });
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
    // A legal lowball: your worst player for his best.
    const byOvr = (teamId: number) => activeRoster(l, teamId).sort((a, b) => playerOvr(b) - playerOvr(a));
    const junk: TradeProposal = { sides: [{ teamId: l.userTeamId, players: [byOvr(l.userTeamId).at(-1)!.id], picks: [] }, { teamId: ai.id, players: [byOvr(ai.id)[0].id], picks: [] }] };
    const answers = Array.from({ length: 20 }, () => proposeTrade(l, junk).message);
    expect(answers.slice(ASKS)).toEqual(Array(20 - ASKS).fill("We're done talking this week."));
    expect(answers.some((m) => /\d/.test(m))).toBe(false);
  });

  it('shops a player once a moment and puts him on the block', () => {
    const l = fresh();
    const p = activeRoster(l, l.userTeamId).sort((a, b) => (b.contract?.years.length ?? 0) - (a.contract?.years.length ?? 0))[0];
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
    answerEnquiry(l, enquiry.id, 'notForSale');
    const pid = enquiry.sides[1].players[0];
    expect(l.market!.talks[enquiry.teamId].cooldowns[pid].until).toBe(l.market!.moment + 6);
  }, 60_000);

  it('files a message for each open offer that needs you until it lapses', () => {
    const l = fresh();
    deliverMail(l);
    const offer = packaged(l)[0];
    const mail = l.inbox!.find((m) => m.id === `offer:${offer.season}:${offer.id}`)!;
    expect(mail).toBeDefined();
    expect(needsYou(l, mail)).toBe(true);
    expect(mail.body).not.toMatch(/\d+\.\d/);
    playWeek(l);
    expect(needsYou(l, mail)).toBe(false);
  }, 30_000);

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
