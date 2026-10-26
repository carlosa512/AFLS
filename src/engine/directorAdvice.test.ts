import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { endGmAppointment } from './gm';
import {
  adviceFor,
  adviceLean,
  adviceNeeds,
  buyTargets,
  expiringTargets,
  faTargets,
  pickRoundFor,
  raceFor,
  sellCandidates,
} from './directorAdvice';
import { isExpired, yearsLeft } from './finance/contract';
import { perceive } from './scouting';
import { teamPlayers } from './roster';
import { computeRecords } from './season/standings';
import { emptyMarket } from './trade/execute';
import { tradeContext } from './trade/context';
import { demand } from './offseason/negotiation';
import { marketValue, slotRate } from './trade/value';
import type { League, Player } from './types';

const world = () => createLeague({ seed: 'director-advice' });
/** Every club 5–3; ours as given. */
function standings(l: League, w: number, lo: number) {
  const records = computeRecords(l);
  for (const r of records.values()) Object.assign(r, { w: 5, l: 3, t: 0 });
  Object.assign(records.get(l.userTeamId)!, { w, l: lo });
  return records;
}

describe('the director’s lean', () => {
  it('leans from the playoff race', () => {
    expect(adviceLean(0)).toBe('buy');
    expect(adviceLean(1)).toBe('buy');
    expect(adviceLean(2)).toBe('targeted');
    expect(adviceLean(3)).toBe('targeted');
    expect(adviceLean(3.5)).toBe('sell');
  });
  it('measures games back from the last seed', () => {
    const l = world();
    expect(raceFor(l, standings(l, 3, 5)).gamesBack).toBe(2);
    expect(raceFor(l, standings(l, 1, 7)).gamesBack).toBe(4);
    const top = raceFor(l, standings(l, 8, 0));
    expect(top.gamesBack).toBe(0);
    expect(top.seed).toBe(1);
  });
  it('prices in rounds', () => {
    const l = world();
    expect(pickRoundFor(l, slotRate(16) * 1.6)).toBe('a 1st and more');
    expect(pickRoundFor(l, slotRate(16))).toBe('likely a 1st');
    expect(pickRoundFor(l, slotRate(48))).toBe('likely a 2nd');
    expect(pickRoundFor(l, slotRate(208))).toBe('likely a 7th');
    expect(pickRoundFor(l, 0.01)).toBe('a late-round pick');
  });
});

describe('the director’s picks', () => {
  /** Week 6, every club a contender until a test says otherwise. */
  function midseason() {
    const l = world();
    l.phase = 'regular';
    l.week = 6;
    for (const t of l.teams) t.stance = { mode: 'contend', since: 0 };
    l.market = emptyMarket();
    return l;
  }
  /** The best players at our top need on three other clubs, by our read; we know them well. */
  function targets(l: League) {
    const pos = adviceNeeds(l)[0].position;
    const seen = new Set<number>();
    const best = Object.values(l.players)
      .filter((p) => p.position === pos && p.teamId !== null && p.teamId !== l.userTeamId && !p.retired)
      .sort((a, b) => perceive(l, l.userTeamId, b).ovr - perceive(l, l.userTeamId, a).ovr)
      .filter((p) => !seen.has(p.teamId!) && seen.add(p.teamId!))
      .slice(0, 3);
    for (const p of best) l.knowledge[p.id] = 1;
    return best;
  }
  it('buys only what is public: a seller’s player or one named in a shopping rumor', () => {
    const l = midseason();
    const [a, b] = targets(l);
    const buys = () => buyTargets(l, { rentals: true, max: 4, room: 1e9 }).map((r) => r.playerId);
    // A contender's player that nobody is shopping is never suggested.
    expect(buys()).not.toContain(a.id);
    expect(buys()).not.toContain(b.id);
    l.teams[a.teamId!].stance = { mode: 'rebuild', since: 0 };
    expect(buys()).toContain(a.id);
    l.teams[a.teamId!].stance = { mode: 'contend', since: 0 };
    l.market!.rumors.push({
      id: 'r1',
      season: l.season,
      phase: 'regular',
      week: 5,
      kind: 'shopping',
      teamIds: [b.teamId!],
      playerId: b.id,
      text: 'shopping',
    });
    expect(buys()).toContain(b.id);
    expect(buys()).not.toContain(a.id);
  });
  it('skips what we cannot afford, and rentals unless we are buying', () => {
    const l = midseason();
    const [a] = targets(l);
    l.teams[a.teamId!].stance = { mode: 'rebuild', since: 0 };
    expect(buyTargets(l, { rentals: true, max: 4, room: 0 })).toEqual([]);
    const rows = buyTargets(l, { rentals: false, max: 4, room: 1e9 });
    for (const r of rows) expect(yearsLeft(l.players[r.playerId].contract!, l.season)).toBeGreaterThan(1);
    for (const r of rows) expect(r.why).not.toMatch(/Rental/);
  });
  it('sells a player clubs asked about first, and says who asked', () => {
    const l = midseason();
    const ours = teamPlayers(l, l.userTeamId).find((p) => p.position === 'WR')!;
    const club = (l.userTeamId + 3) % 32;
    l.market!.offers.push({
      id: 900,
      teamId: club,
      sides: [
        { teamId: club, players: [], picks: [] },
        { teamId: l.userTeamId, players: [ours.id], picks: [] },
      ],
      kind: 'enquiry',
      reason: 'enquiry',
      season: l.season,
      phase: 'regular',
      week: 5,
      moment: 0,
      status: 'declined',
      patience: 0,
      worth: 0,
    });
    const [first] = sellCandidates(l, 'sell', 3);
    expect(first.playerId).toBe(ours.id);
    expect(first.kind).toBe('sell');
    expect(first.why).toMatch(/asked about him/);
    expect(first.partnerId).toBe(club);
  });
  it('never suggests selling a player we marked Untouchable', () => {
    const l = midseason();
    const ours = teamPlayers(l, l.userTeamId).find((p) => p.position === 'WR')!;
    const club = (l.userTeamId + 3) % 32;
    l.market!.offers.push({
      id: 901,
      teamId: club,
      sides: [
        { teamId: club, players: [], picks: [] },
        { teamId: l.userTeamId, players: [ours.id], picks: [] },
      ],
      kind: 'enquiry',
      reason: 'enquiry',
      season: l.season,
      phase: 'regular',
      week: 5,
      moment: 0,
      status: 'declined',
      patience: 0,
      worth: 0,
    });
    l.market!.status[ours.id] = 'untouchable';
    expect(sellCandidates(l, 'sell', 3).map((r) => r.playerId)).not.toContain(ours.id);
  });
  it('counts only clubs that asked us, not rumors about a player’s old club', () => {
    const l = midseason();
    const ours = teamPlayers(l, l.userTeamId)[0];
    l.market!.rumors.push({
      id: 'i1',
      season: l.season,
      phase: 'regular',
      week: 4,
      kind: 'interest',
      teamIds: [(l.userTeamId + 5) % 32],
      playerId: ours.id,
      text: 'interest',
    });
    expect(sellCandidates(l, 'sell', 3).some((r) => /asked about/.test(r.why))).toBe(false);
  });
  it('prices a sale on our read and offers it to a club outside our division', () => {
    const l = midseason();
    const rows = sellCandidates(l, 'sell', 3);
    expect(rows.length).toBeGreaterThan(0);
    const ctx = tradeContext(l);
    for (const r of rows) {
      expect(r.price).toBe(pickRoundFor(l, marketValue(ctx, l.teams[l.userTeamId], l.players[r.playerId])));
      expect(l.teams[r.partnerId!].division).not.toBe(l.teams[l.userTeamId].division);
    }
  });
  it('prefers a target outside our division, and takes a rival only when nothing else clears the bar', () => {
    const l = midseason();
    const pos = adviceNeeds(l)[0].position;
    const division = l.teams[l.userTeamId].division;
    const read = (p: Player) => perceive(l, l.userTeamId, p).ovr;
    const atPos = Object.values(l.players)
      .filter((p) => p.position === pos && p.teamId !== null && p.teamId !== l.userTeamId)
      .sort((a, b) => read(b) - read(a));
    const rival = atPos.find((p) => l.teams[p.teamId!].division === division)!;
    const other = atPos.find((p) => l.teams[p.teamId!].division !== division && read(p) < read(rival))!;
    for (const p of [rival, other]) {
      l.knowledge[p.id] = 1;
      l.teams[p.teamId!].stance = { mode: 'rebuild', since: 0 };
    }
    const at = () => buyTargets(l, { rentals: true, max: 4, room: 1e9 }).find((r) => r.position === pos)?.playerId;
    if (read(other) - read(rival) > -0.01) return; // the world's reads tie: nothing to show
    expect(at()).toBe(other.id);
    l.teams[other.teamId!].stance = { mode: 'contend', since: 0 };
    // Now only the rival's club sells at that spot: one of its players is the pick.
    expect(l.players[at()!].teamId).toBe(rival.teamId);
  });
  it('only ever sells our own players', () => {
    const l = midseason();
    for (const lean of ['sell', 'targeted'] as const)
      for (const r of sellCandidates(l, lean, 3)) expect(l.players[r.playerId].teamId).toBe(l.userTeamId);
  });
  it('names other clubs’ players whose deals have run out', () => {
    const l = world();
    l.season += 1;
    l.caps[l.season] ??= l.caps[l.season - 1]; // the offseason sets the new cap; this skips straight to it
    l.phase = 'resign';
    const rows = expiringTargets(l, 2);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      const p = l.players[r.playerId];
      expect(p.teamId).not.toBe(l.userTeamId);
      expect(isExpired(p.contract!, l.season)).toBe(true);
      expect(r.price).toMatch(/^about \$[\d.]+M a year$/);
    }
  });
  it('signs only free agents our cap can carry', () => {
    const l = world();
    l.phase = 'freeAgency';
    // A new league has no free agents yet: let our top need's best players go.
    const pos = adviceNeeds(l)[0].position;
    for (const p of Object.values(l.players)
      .filter((p) => p.position === pos && p.teamId !== null && p.teamId !== l.userTeamId)
      .slice(0, 6)) {
      p.teamId = null;
      l.knowledge[p.id] = 1;
    }
    const rows = faTargets(l, 4, 1e9);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.teamId).toBeNull();
      const ask = demand(l, l.players[r.playerId], l.userTeamId).askApy;
      expect(r.price).toBe(`asking about $${(ask / 1000).toFixed(1)}M a year`);
      // Room for the market rate but not his ask: not a fit.
      const market = demand(l, l.players[r.playerId], l.userTeamId).market;
      if (ask > market) expect(faTargets(l, 4, ask - 1).some((x) => x.playerId === r.playerId)).toBe(false);
    }
    expect(faTargets(l, 4, -1)).toEqual([]);
  });
});

describe('the director’s mail', () => {
  const at = (week: number) => {
    const l = world();
    l.phase = 'regular';
    l.week = week;
    l.market = emptyMarket();
    return l;
  };
  it('files at week 6 and deadline week only, never late', () => {
    expect(adviceFor(at(6))!.moment).toBe('w6');
    expect(adviceFor(at(9))!.moment).toBe('w9');
    for (const w of [5, 7, 8, 10]) expect(adviceFor(at(w))).toBeNull();
  });
  it('says we hold when nothing clears the bar', () => {
    const l = at(9);
    for (const t of l.teams) t.stance = { mode: 'contend', since: 0 };
    const a = adviceFor(l)!;
    expect(a.lean).toBe('buy'); // nobody has played: every club is level
    expect(a.rows).toEqual([]);
    expect(a.subject).toBe('Deadline week: we hold');
    expect(a.body).toContain('Nothing worth chasing; we hold.');
    expect(a.body).not.toMatch(/time to add|I'd sell|we can spare/);
  });
  it('opens with where we stand and says when the deadline is', () => {
    const a = adviceFor(at(6))!;
    expect(a.body).toMatch(/^(We're|At) /);
    expect(a.body).toContain('The deadline is the day after week 9.');
  });
  it('stays quiet while we have no job', () => {
    const l = at(6);
    endGmAppointment(l, l.userGmId, 'dismissed');
    expect(adviceFor(l)).toBeNull();
  });
  it('files the offseason mails only when there is someone to recommend', () => {
    const l = world();
    l.phase = 'freeAgency';
    l.faDay = 1;
    expect(adviceFor(l)).toBeNull(); // a new league has no free agents
    const pos = adviceNeeds(l)[0].position;
    for (const p of Object.values(l.players)
      .filter((p) => p.position === pos && p.teamId !== null && p.teamId !== l.userTeamId)
      .slice(0, 6)) {
      p.teamId = null;
      l.knowledge[p.id] = 1;
    }
    const a = adviceFor(l, 1e9)!;
    expect(a.moment).toBe('fa');
    expect(a.rows.length).toBeGreaterThan(0);
    expect(a.subject).toMatch(/^Free agency: (one fit|\w+ fits)$/);
    l.faDay = 2;
    expect(adviceFor(l, 1e9)).toBeNull();
  });
});
