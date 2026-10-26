import { describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import {
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
import { slotRate } from './trade/value';
import type { League } from './types';

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
    for (const r of rows) expect(r.teamId).toBeNull();
    expect(faTargets(l, 4, -1)).toEqual([]);
  });
});
