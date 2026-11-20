import { describe, expect, it } from 'vitest';
import { capSpace } from './finance/cap';
import { minSalary } from './finance/market';
import { createLeague } from './generate';
import { deliverMail, mailSubject, needsYou } from './inbox';
import { simToEndOfSeason } from './league';
import { advanceOffseason, beginOffseason } from './offseason/index';
import { askOffer, demand, freeAgents, offerValue, type Offer } from './offseason/negotiation';
import { letGo, pendingWarnings, placeUserOffer, raceWarningOpen } from './offseason/race';
import { raceView } from './offseason/raceView';
import type { InboxMessage, League, Player } from './types';

/** Free agency's first day, run by you: the agents' warnings stop the game. */
const world = (() => {
  const l = createLeague({ seed: 'front-office-b' });
  simToEndOfSeason(l);
  beginOffseason(l);
  while (l.phase !== 'resign') advanceOffseason(l, { autoUser: true });
  advanceOffseason(l, { autoUser: false });
  expect(l.phase).toBe('freeAgency');
  return JSON.stringify(l);
})();
const fresh = (): League => JSON.parse(world);
const you = (l: League) => l.userTeamId;

function setSpace(l: League, space: number): void {
  const t = l.teams[you(l)];
  t.carryover += space - capSpace(l, t.id);
}
const askAt = (l: League, p: Player, apy: number): Offer => ({
  ...askOffer(demand(l, p, you(l))),
  apy: Math.round(apy),
});
/** The least a year, in the shape of his ask, he'd take from you (his value is linear in the money). */
function floorApy(l: League, p: Player): number {
  const d = demand(l, p, you(l));
  const ask = askOffer(d);
  const per = offerValue(l, p, you(l), ask, d) / ask.apy;
  return Math.max(minSalary(p.experience, l.caps[l.season]), Math.ceil(d.walkAway / per) + 1);
}
const atFloor = (l: League, p: Player) => askAt(l, p, floorApy(l, p));
const rivals = (l: League, p: Player) => (l.faRace!.offers[p.id] ?? []).filter((o) => o.teamId !== you(l));
const contested = (l: League) => freeAgents(l).filter((p) => rivals(l, p).length >= 1 && !p.injury);

/** Offers at the floor on contested players, room to spare. Their ids. */
function trailEverywhere(l: League): number[] {
  setSpace(l, 500_000);
  return contested(l)
    .filter((p) => placeUserOffer(l, p, atFloor(l, p)).status === 'standing')
    .map((p) => p.id);
}

const racePosts = (l: League) => (l.inbox ?? []).filter((m) => /^race:\d+:\d+:/.test(m.id));
const suffix = (m: InboxMessage) => m.id.split(':')[3];
const playerOf = (m: InboxMessage) => Number(m.id.split(':')[2]);

describe("the agent's warning", () => {
  it('files once, asks for an answer until it is given, and names the leader and the rounded number', () => {
    const l = fresh();
    trailEverywhere(l);
    advanceOffseason(l);
    const warned = pendingWarnings(l);
    expect(warned.length).toBeGreaterThan(0);
    deliverMail(l);
    deliverMail(l);
    const letters = racePosts(l).filter((m) => /^\d+$/.test(suffix(m)));
    expect(letters.every((m) => mailSubject(m)?.kind === 'faRace')).toBe(true);
    for (const id of warned) {
      const mine = letters.filter((m) => playerOf(m) === id);
      expect(mine).toHaveLength(1);
      const m = mine[0];
      const v = raceView(l, id)!;
      const p = l.players[id];
      expect(m.body.startsWith(`${p.firstName} ${p.lastName}'s agent called.`)).toBe(true);
      expect(m.body).toContain(`${l.teams[v.leader!].city} is ahead of us at about $${v.leaderApy! / 1000}M a year`);
      expect(m.from).toContain('Director of scouting');
      expect(needsYou(l, m)).toBe(true);
    }
    // Answered, it asks nothing more, and it is not filed again.
    const id = warned[0];
    const m = letters.find((x) => playerOf(x) === id)!;
    letGo(l, id);
    expect(raceWarningOpen(l, id)).toBe(false);
    expect(needsYou(l, m)).toBe(false);
    const count = racePosts(l).length;
    deliverMail(l);
    expect(racePosts(l)).toHaveLength(count);
  });
});

describe('where he signed', () => {
  it('files one result for each player we had an offer on, and none for the rest', () => {
    const l = fresh();
    const bid = new Set(trailEverywhere(l));
    expect(bid.size).toBeGreaterThan(5);
    // Raise on each warning (or let him go when we can't), until free agency closes.
    while (l.phase === 'freeAgency') {
      for (const id of pendingWarnings(l)) {
        const mine = l.faRace!.offers[id].find((o) => o.teamId === you(l))!;
        const raised = placeUserOffer(l, l.players[id], { ...mine.offer, apy: Math.ceil(mine.offer.apy * 1.03) });
        if (raised.status !== 'standing') letGo(l, id);
      }
      advanceOffseason(l);
      deliverMail(l);
    }
    deliverMail(l);
    deliverMail(l);
    const done = racePosts(l).filter((m) => suffix(m) === 'done');
    const ids = done.map(playerOf);
    expect(new Set(ids).size).toBe(ids.length);
    const results = l.faRace!.results.filter((r) => r.userPlace !== null || r.userDropped);
    expect([...ids].sort()).toEqual(results.map((r) => r.playerId).sort());
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(bid.has(id)).toBe(true);
    for (const m of done) {
      const r = results.find((x) => x.playerId === playerOf(m))!;
      const p = l.players[r.playerId];
      const where = r.teamId === you(l) ? 'us' : l.teams[r.teamId].city;
      expect(m.subject).toBe(`${p.firstName} ${p.lastName} signed with ${where}`);
      expect(m.body.startsWith(m.subject)).toBe(true);
      expect(needsYou(l, m)).toBe(false);
      expect(mailSubject(m)).toMatchObject({ kind: 'faRace', playerId: r.playerId, day: null });
    }
  });

  it('tells a dropped offer the day it happens, in its own words, and the result when he signs', () => {
    const l = fresh();
    setSpace(l, 500_000);
    const placed = freeAgents(l)
      .filter((p) => rivals(l, p).length >= 2 && !p.injury)
      .slice(0, 6)
      .filter((p) => {
        const top = Math.max(...rivals(l, p).map((o) => o.offer.apy));
        return placeUserOffer(l, p, askAt(l, p, Math.max(top, floorApy(l, p)) * 1.5)).status === 'standing';
      });
    expect(placed.length).toBeGreaterThan(0);
    // A release's dead money: none of them fits any more.
    l.teams[you(l)].deadMoney.push({
      season: l.season,
      amount: capSpace(l, you(l)),
      playerId: placed[0].id,
      note: 'test',
    });
    advanceOffseason(l);
    deliverMail(l);
    deliverMail(l);
    const dropped = l.faRace!.dropped ?? [];
    const resulted = l.faRace!.results.filter((r) => r.userDropped);
    expect(dropped.length + resulted.length).toBeGreaterThan(0);
    for (const id of dropped) {
      const m = racePosts(l).filter((x) => x.id === `race:${l.season}:${id}:dropped`);
      expect(m).toHaveLength(1);
      expect(mailSubject(m[0])).toMatchObject({ kind: 'faRace', playerId: id, day: null, dropped: true });
      expect(m[0].body).toContain('cap room or our roster');
      expect(needsYou(l, m[0])).toBe(false);
    }
    // Signed the same day, his result tells it instead.
    for (const r of resulted) {
      expect(racePosts(l).some((x) => x.id === `race:${l.season}:${r.playerId}:dropped`)).toBe(false);
      expect(racePosts(l).filter((x) => x.id === `race:${l.season}:${r.playerId}:done`)).toHaveLength(1);
    }
  });
});
