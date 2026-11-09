import { beforeEach, describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { aiGm } from '../gmHabits';
import { appointGm, endGmAppointment } from '../gm';
import { standingWith } from '../gmMemory';
import type { League, TradeOffer } from '../types';
import { acceptOffer, counterOffer, declineOffer, proposeTrade } from '.';
import { expireOffers } from './offers';
import { emptyMarket } from './execute';

let l: League;
const AI = 1;
const picksOf = (teamId: number) =>
  l.draftPicks.filter((p) => p.ownerId === teamId && p.season >= l.season).sort((a, b) => a.round - b.round);
const sides = (hisPicks: number[], yourPicks: number[]): TradeOffer['sides'] => [
  { teamId: AI, players: [], picks: hisPicks },
  { teamId: l.userTeamId, players: [], picks: yourPicks },
];
/** His seventh for your first: he takes it at close, and it is picks only so no physical holds it. */
const lopsided = () => sides([picksOf(AI).at(-1)!.id], [picksOf(l.userTeamId)[0].id]);
function file(over: Partial<TradeOffer> & { sides?: TradeOffer['sides'] }): TradeOffer {
  const market = (l.market ??= emptyMarket());
  const offer: TradeOffer = {
    id: market.nextOfferId++,
    teamId: AI,
    sides: over.sides ?? lopsided(),
    kind: 'user',
    reason: 'bid',
    season: l.season,
    phase: l.phase,
    week: l.week,
    moment: market.moment,
    status: 'pending',
    patience: 2,
    worth: 0,
    ...over,
  };
  market.offers.push(offer);
  return offer;
}
const withYou = (teamId = AI) => aiGm(l, l.teams[teamId])?.withYou ?? [];

beforeEach(() => {
  l = createLeague({ seed: 'you-moments' });
});

describe('moments where deals close', () => {
  it('notes a closed trade once, with what he got and gave and how it looked at close', () => {
    const [his, yours] = lopsided();
    const r = proposeTrade(l, { sides: [yours, his] });
    expect(r.accepted).toBe(true);
    const ms = withYou();
    expect(ms).toHaveLength(1);
    expect(ms[0]).toMatchObject({ kind: 'trade', got: { picks: yours.picks }, gave: { picks: his.picks } });
    expect(['paidUp', 'fair', 'squeezed']).toContain(ms[0].atClose);
    expect(ms[0].big).toBe(true);
  });

  it('notes taking his offer at his price, not a counter of yours he took', () => {
    const o = file({});
    expect(acceptOffer(l, o.id).ok).toBe(true);
    expect(withYou().map((m) => m.kind)).toEqual(['trade', 'tookOffer']);

    const l2 = createLeague({ seed: 'you-moments' });
    l = l2;
    const o2 = file({ sides: sides([picksOf(AI).at(-1)!.id], [picksOf(l.userTeamId)[0].id]) });
    const [his, yours] = o2.sides;
    const r = counterOffer(l, o2.id, { sides: [yours, { ...his, picks: [picksOf(AI).at(-2)!.id] }] });
    expect(r.result).toBe('accepted');
    expect(withYou().map((m) => m.kind)).toEqual(['trade']);
  });
});

describe('moments where threads end', () => {
  it('a straight no notes nothing', () => {
    declineOffer(l, file({}).id);
    expect(withYou()).toEqual([]);
    // He hears a proposal and rejects it.
    const hers = picksOf(AI)[0].id;
    const yours = picksOf(l.userTeamId).at(-1)!.id;
    expect(proposeTrade(l, { sides: [sides([hers], [yours])[1], sides([hers], [yours])[0]] }).accepted).toBe(false);
    expect(withYou()).toEqual([]);
    // An offer left to lapse when the market moves on is no answer at all.
    const lapsing = file({ final: true });
    expireOffers(l);
    expect(lapsing.status).toBe('expired');
    expect(withYou()).toEqual([]);
  });

  it('declining a bid you asked for is still a straight no', () => {
    // The bid an enquiry of his drew when you asked for an offer replies to it; turning it down is still a plain no.
    const enq = file({ kind: 'enquiry', reason: 'enquiry' });
    enq.status = 'answered';
    declineOffer(l, file({ replyTo: enq.id }).id);
    expect(withYou()).toEqual([]);
  });

  it('declining his counter after yours is being led on; his final offer is a final no', () => {
    declineOffer(l, file({ reason: 'counter' }).id);
    expect(withYou().map((m) => m.kind)).toEqual(['ledOn']);
    declineOffer(l, file({ reason: 'counter', final: true }).id);
    declineOffer(l, file({ final: true }).id);
    expect(withYou().map((m) => m.kind)).toEqual(['ledOn', 'finalNo', 'finalNo']);
  });

  it('a counter that makes him walk at his final offer is a final no', () => {
    const o = file({ final: true });
    const hers = picksOf(AI)[0].id;
    const yours = picksOf(l.userTeamId).at(-1)!.id;
    const r = counterOffer(l, o.id, { sides: [sides([hers], [yours])[1], sides([hers], [yours])[0]] });
    expect(r.result).toBe('walked');
    expect(withYou().map((m) => m.kind)).toEqual(['finalNo']);
  });
});

describe('whose record it goes on', () => {
  it('goes to the GM in the chair when you act, and to nobody when it is empty', () => {
    const o = file({ final: true });
    const old = aiGm(l, l.teams[AI])!;
    endGmAppointment(l, old.id, 'dismissed');
    const spare = l.teams[3].gmId!;
    endGmAppointment(l, spare, 'dismissed');
    const fresh = l.gms[spare];
    appointGm(l, AI, fresh.id, { through: l.season + 3 });
    declineOffer(l, o.id);
    expect(fresh.withYou?.map((m) => m.kind)).toEqual(['finalNo']);
    expect(old.withYou ?? []).toEqual([]);

    const o2 = file({ final: true });
    l.teams[AI].gmId = null;
    expect(() => declineOffer(l, o2.id)).not.toThrow();
    expect(fresh.withYou).toHaveLength(1);
  });

  it('follows the people', () => {
    const gm = aiGm(l, l.teams[AI])!;
    gm.withYou = [{ kind: 'trade', season: l.season, phase: l.phase, verdict: 'youWon' }];
    const before = standingWith(l, gm);
    expect(before).toBeLessThan(0);
    endGmAppointment(l, gm.id, 'dismissed');
    endGmAppointment(l, l.teams[2].gmId!, 'dismissed');
    appointGm(l, 2, gm.id, { through: l.season + 3 });
    expect(standingWith(l, gm)).toBe(before);
    // Your GM changing club doesn't touch it either.
    l.gms[l.userGmId].teamId = 5;
    expect(standingWith(l, gm)).toBe(before);
  });
});
