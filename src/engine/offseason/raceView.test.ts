import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { clubFeeling } from '../relationships';
import { characterRead, seasonRole } from '../scouting';
import type { League, Player } from '../types';
import { FA_DAYS } from '../types';
import { advanceOffseason, beginOffseason } from './index';
import { decides, rankOffers } from './race';
import { barOf, raceView, roundApy, STATUS_WORDS, wantsLine } from './raceView';

/** Free agency's first day, run by you: every team's opening offers stand. */
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

const offered = (l: League) =>
  Object.keys(l.faRace!.offers)
    .map((id) => l.players[+id])
    .filter((p) => p.teamId === null && l.faRace!.offers[p.id].length);

/** Every key in an object, however deep. */
const keysOf = (x: unknown): string[] =>
  x && typeof x === 'object' ? Object.entries(x).flatMap(([k, v]) => [k, ...keysOf(v)]) : [];

describe('the race as a screen reads it', () => {
  it('bars are tenths of the leader, at least a tenth', () => {
    expect([1.0, 0.84, 0.61].map((v) => barOf(v, 1))).toEqual([1, 0.8, 0.6]);
    expect(barOf(0.01, 1)).toBe(0.1);
  });

  it("the leader's number rounds to the nearest half million", () => {
    expect(roundApy(12_840)).toBe(13_000);
    expect(roundApy(12_740)).toBe(12_500);
  });

  it('reads a free agent with offers in: bars, place, status, leader', () => {
    const l = fresh();
    const ps = offered(l);
    expect(ps.length).toBeGreaterThan(5);
    let weighing = 0;
    for (const p of ps) {
      const v = raceView(l, p.id)!;
      const ranked = rankOffers(l, p, l.faRace!.offers[p.id]);
      expect(v.of).toBe(ranked.length);
      expect(v.teams.map((t) => t.teamId)).toEqual(ranked.map((r) => r.teamId));
      if (!ranked.length) continue;
      expect(v.teams[0].bar).toBe(1);
      for (const t of v.teams) {
        expect(t.bar).toBeGreaterThanOrEqual(0.1);
        expect(Math.round(t.bar * 10)).toBeCloseTo(t.bar * 10, 9);
      }
      expect(v.leader).toBe(ranked[0].teamId);
      expect(v.leaderApy! % 500).toBe(0);
      expect(Math.abs(v.leaderApy! - ranked[0].offer.apy)).toBeLessThanOrEqual(250);
      expect(v.place).toBeNull();
      expect(v.yours).toBeNull();
      expect(v.warned).toBe(false);
      if (v.status === 'weighing') weighing++;
      expect(v.status === 'close' || ranked.length < 2 || v.status === 'weighing').toBe(true);
      expect(STATUS_WORDS[v.status]).toBeTruthy();
    }
    expect(weighing).toBeGreaterThan(0);
  });

  it("'close' is exactly when he would sign now", () => {
    const l = fresh();
    for (const p of offered(l)) {
      const ranked = rankOffers(l, p, l.faRace!.offers[p.id]);
      const v = raceView(l, p.id)!;
      const would = decides(ranked, {
        waited: l.faDay - (l.faRace!.since[p.id] ?? l.faDay),
        patience: p.personality.patience,
        lastDay: l.faDay >= FA_DAYS,
        askApy: Infinity,
      });
      // His ask can only make a lead easier to take, so what he'd sign without it he signs with it.
      if (would) expect(v.status).toBe('close');
      if (v.status === 'waiting') expect(ranked.length < 2 || !would).toBe(true);
      if (ranked.length < 2 && ranked.length) expect(v.status).toBe('close');
      if (!ranked.length) expect(v.status).toBe('waiting');
    }
  });

  it('your standing offer: place and yours', () => {
    const l = fresh();
    const p = offered(l).find((x) => l.faRace!.offers[x.id].length >= 2)!;
    const mine = { teamId: l.userTeamId, offer: { ...l.faRace!.offers[p.id][0].offer }, day: l.faDay, first: 1 };
    l.faRace!.offers[p.id].push(mine);
    const v = raceView(l, p.id)!;
    const ranked = rankOffers(l, p, l.faRace!.offers[p.id]);
    expect(v.place).toBe(ranked.findIndex((r) => r.teamId === l.userTeamId) + 1);
    expect(v.of).toBe(ranked.length);
    expect(v.yours).toEqual(mine.offer);
    expect(v.teams.filter((t) => t.you)).toHaveLength(1);
    l.faRace!.warnings.push({ playerId: p.id, day: l.faDay, answered: false });
    expect(raceView(l, p.id)!.warned).toBe(true);
  });

  it('is null outside the race', () => {
    const l = fresh();
    const rostered = Object.values(l.players).find((p) => p.teamId !== null && !p.retired)!;
    expect(raceView(l, rostered.id)).toBeNull();
    l.phase = 'draft';
    expect(raceView(l, offered(l)[0].id)).toBeNull();
  });

  it("carries no value, no personality and no other team's offer", () => {
    const l = fresh();
    const p = offered(l).find((x) => l.faRace!.offers[x.id].length >= 2)!;
    const v = raceView(l, p.id)!;
    const keys = keysOf(v);
    for (const bad of ['value', 'floor', 'greed', 'loyalty', 'winning', 'patience', 'walkAway', 'offers', 'first'])
      expect(keys).not.toContain(bad);
    // No Offer in it: yours is null with no offer of yours standing.
    expect(v.yours).toBeNull();
    expect(keys).not.toContain('apy');
  });
});

describe('what he wants', () => {
  /** A free agent the user's scouts have read, with an offer in. */
  const scene = (l: League): Player | undefined =>
    offered(l).find((p) => characterRead(l, l.userTeamId, p) && !p.left?.length);

  it('is null while the scouts have not read him', () => {
    const l = fresh();
    const p = offered(l).find((x) => !characterRead(l, l.userTeamId, x));
    if (!p) return;
    expect(wantsLine(l, l.userTeamId, p)).toBeNull();
  });

  it('leads with the bigger of money and a winner', () => {
    const l = fresh();
    const p = scene(l) ?? offered(l).find((x) => characterRead(l, l.userTeamId, x))!;
    p.left = [];
    l.faRace!.offers[p.id] = l.faRace!.offers[p.id].filter((o) => o.teamId !== p.statTeams?.[l.season - 1]?.at(-1));
    const set = (greed: number, winning: number, loyalty = 0) => {
      p.personality.greed = greed;
      p.personality.winning = winning;
      p.personality.loyalty = loyalty;
      // An exact read, so the numbers above are what the scouts see.
      l.knowledge[p.id] = 1;
      return wantsLine(l, l.userTeamId, p);
    };
    expect(set(1, 0.2)).toBe('Money first, then a winner');
    expect(set(0.2, 1)).toBe('A winner first, then money');
  });

  it('puts home first when a team in for him is one he walked away from', () => {
    const l = fresh();
    // A player who played last season, walking away from a team that has an offer in for him.
    const p = offered(l).find((x) => ['starter', 'rotation'].includes(seasonRole(l, x)?.role ?? ''))!;
    expect(p).toBeDefined();
    const team = l.faRace!.offers[p.id][0].teamId;
    p.left = [{ teamId: team, how: 'walked', season: l.season }];
    expect(clubFeeling(l, p, team)).toBe('home');
    l.knowledge[p.id] = 1;
    p.personality.greed = 1;
    p.personality.winning = 0.2;
    expect(wantsLine(l, l.userTeamId, p)).toBe('Home first, then money');
    p.personality.greed = 0.2;
    p.personality.winning = 1;
    expect(wantsLine(l, l.userTeamId, p)).toBe('Home first, then a winner');
  });

  it('counts staying with his old team only when that team has an offer in', () => {
    const l = fresh();
    const p = offered(l).find((x) => x.statTeams?.[l.season - 1]?.at(-1) !== undefined)!;
    const old = p.statTeams![l.season - 1].at(-1)!;
    p.left = [];
    l.knowledge[p.id] = 1;
    p.personality.greed = 0.2;
    p.personality.winning = 0.1;
    p.personality.loyalty = 1;
    l.faRace!.offers[p.id] = l.faRace!.offers[p.id].filter((o) => o.teamId !== old);
    expect(wantsLine(l, l.userTeamId, p)).toBe('Money first, then a winner');
    l.faRace!.offers[p.id].push({
      teamId: old,
      offer: { years: 1, apy: 1, bonusPct: 0, gtdPct: 0, voidYears: 0 },
      day: l.faDay,
      first: 1,
    });
    expect(wantsLine(l, l.userTeamId, p)).toBe('Staying with his old team first, then money');
  });
});
