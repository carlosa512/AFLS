import { beforeAll, describe, expect, it } from 'vitest';
import { createLeague } from './generate';
import { gamesInWeek, playWeek } from './league';
import {
  buildEdition,
  byeCandidate,
  cutEdition,
  gameCandidates,
  rankCandidates,
  runCandidates,
  starOutCandidates,
  type Candidate,
} from './snnWeek';
import type { League } from './types';

const ID = 'snn:2026:w9';
/** A hand-built candidate: a game between clubs `a` and `b` about club `a`, unless told otherwise. */
const c = (key: string, tier: Candidate['tier'], stakes: number, over: Partial<Candidate> = {}): Candidate => ({
  key,
  kind: 'game',
  angle: 'result',
  tier,
  stakes,
  clubId: 10,
  teams: [10, 11],
  ...over,
});
const USER = 1;
const yours = (tier: Candidate['tier'], stakes = 1) =>
  c('game:yours', tier, stakes, { clubId: USER, teams: [USER, 2] });

describe('ranking the week', () => {
  it('ranks by tier, then stakes, then a stable hash', () => {
    const r = rankCandidates([c('a', 5, 1.2), c('b', 3, 0.6), c('c', 3, 1.1)], ID);
    expect(r.map((x) => x.key)).toEqual(['c', 'b', 'a']);
  });

  it('breaks a dead heat the same way whatever order they came in', () => {
    const one = rankCandidates([c('x', 4, 1), c('y', 4, 1), c('z', 4, 1)], ID).map((x) => x.key);
    const two = rankCandidates([c('z', 4, 1), c('y', 4, 1), c('x', 4, 1)], ID).map((x) => x.key);
    expect(one).toEqual(two);
    // Another edition is free to order them differently, but it is always the same for that edition.
    expect(rankCandidates([c('x', 4, 1), c('y', 4, 1), c('z', 4, 1)], ID).map((x) => x.key)).toEqual(one);
  });
});

describe('cutting the week to the edition', () => {
  const others = [
    c('game:1', 2, 1.4, { clubId: 20, teams: [20, 21], angle: 'unbeatenFalls' }),
    c('game:2', 3, 1.2, { clubId: 22, teams: [22, 23], angle: 'upset' }),
    c('game:3', 4, 1.1, { clubId: 24, teams: [24, 25], angle: 'day' }),
    c('game:4', 4, 1.0, { clubId: 26, teams: [26, 27], angle: 'comeback' }),
    c('game:5', 5, 0.9, { clubId: 28, teams: [28, 29], angle: 'rout' }),
  ];

  it('keeps the user’s game for Your club, and leads with the rest of the league', () => {
    const e = cutEdition(rankCandidates([...others, yours(5)], ID), USER)!;
    expect(e.lead.key).toBe('game:1');
    expect(e.leadYours).toBe(false);
    expect(e.club?.key).toBe('game:yours');
    expect(e.tiles.map((x) => x.key)).toEqual(['game:2', 'game:3', 'game:4']);
  });

  it('leads with the user’s game when it is the week’s biggest, and runs a fourth tile', () => {
    const e = cutEdition(rankCandidates([...others, yours(1)], ID), USER)!;
    expect(e.lead.key).toBe('game:yours');
    expect(e.leadYours).toBe(true);
    expect(e.club).toBeUndefined();
    expect(e.tiles).toHaveLength(4);
  });

  it('gives one story a club across the edition', () => {
    const again = c('run:20', 3, 1.3, { kind: 'run', angle: 'streak', clubId: 20, teams: [20] });
    const e = cutEdition(rankCandidates([...others, again, yours(5)], ID), USER)!;
    const clubs = [e.lead, ...e.tiles].map((x) => x.clubId);
    expect(new Set(clubs).size).toBe(clubs.length);
    expect([e.lead, ...e.tiles].map((x) => x.key)).not.toContain('run:20');
  });

  it('folds the biggest other thing about the user’s club into its story, and never a tile', () => {
    const hurt = c('starOut:7:9', 3, 1, { kind: 'starOut', angle: 'starOut', clubId: USER, teams: [USER] });
    const e = cutEdition(rankCandidates([...others, hurt, yours(5)], ID), USER)!;
    expect(e.clubExtra?.key).toBe('starOut:7:9');
    expect(e.tiles.map((x) => x.key)).not.toContain('starOut:7:9');
  });

  it('gives the biggest other news about the user’s club a tile by right, one a week, beside a star out in its story', () => {
    const mine = (key: string, kind: Candidate['kind'], tier: Candidate['tier']) =>
      c(key, tier, 1, { kind, angle: kind, clubId: USER, teams: [USER] });
    const hurt = mine('starOut:7:9', 'starOut', 3);
    const first = mine('division:2026:9:1', 'division', 2);
    const speak = mine('speak:2026:7:traded', 'speak', 4);
    const e = cutEdition(rankCandidates([...others, speak, hurt, first, yours(5)], ID), USER)!;
    expect(e.clubExtra?.key).toBe(hurt.key);
    const keys = e.tiles.map((x) => x.key);
    expect(keys).toContain(first.key);
    expect(keys).not.toContain(speak.key);
    expect(keys).not.toContain(hurt.key);
    // It never leads, and the page keeps its three tiles.
    expect(e.lead.key).toBe('game:1');
    expect(e.tiles).toHaveLength(3);
    // With nothing bigger about his club, the man who spoke out gets the tile.
    const quiet = cutEdition(rankCandidates([...others, speak, yours(5)], ID), USER)!;
    expect(quiet.clubExtra).toBeUndefined();
    expect(quiet.tiles.map((x) => x.key)).toContain(speak.key);
  });

  it('tells one angle twice at most among the lead and the tiles', () => {
    const day = (n: number) =>
      c(`game:d${n}`, 4, 2 - n / 10, { clubId: 50 + n, teams: [50 + n, 60 + n], angle: 'day' });
    const e = cutEdition(rankCandidates([day(1), day(2), day(3), day(4), others[4]], ID), null)!;
    const angles = [e.lead, ...e.tiles].map((x) => x.angle);
    expect(angles.filter((x) => x === 'day')).toHaveLength(2);
    expect(angles).toContain('rout');
  });

  it('runs one trade tile unless a second is the top tier', () => {
    const trade = (key: string, tier: Candidate['tier'], clubId: number) =>
      c(key, tier, 1, { kind: 'trade', angle: 'sale', clubId, teams: [clubId] });
    const two = cutEdition(rankCandidates([others[0], trade('t1', 5, 40), trade('t2', 5, 41), others[4]], ID), null)!;
    expect(two.tiles.filter((x) => x.kind === 'trade')).toHaveLength(1);
    const star = cutEdition(rankCandidates([others[1], trade('t1', 5, 40), trade('t2', 1, 41)], ID), null)!;
    expect(star.lead.key).toBe('t2');
    expect(star.tiles.map((x) => x.key)).toContain('t1');
  });

  it('gives a club on a bye its slot, and a GM between jobs none', () => {
    const bye = c('bye:1:9', 5, 0, { angle: 'bye', clubId: USER, teams: [USER] });
    expect(cutEdition(rankCandidates([...others, bye], ID), USER)!.club?.angle).toBe('bye');
    const jobless = cutEdition(rankCandidates(others, ID), null)!;
    expect(jobless.club).toBeUndefined();
    expect(jobless.leadYours).toBe(false);
  });

  it('runs fewer tiles in a thin week, and nothing from nothing', () => {
    const thin = cutEdition(rankCandidates([others[0], others[1]], ID), null)!;
    expect(thin.lead.key).toBe('game:1');
    expect(thin.tiles.map((x) => x.key)).toEqual(['game:2']);
    expect(cutEdition([], USER)).toBeNull();
  });
});

describe('the week’s candidates from a played league', () => {
  let l: League;
  const seen = new Map<string, number>();
  const runs: Candidate[] = [];
  let weekOne: Candidate[] = [];
  let weekNine: Candidate[] = [];
  beforeAll(() => {
    l = createLeague({ seed: 'snn-candidates' });
    for (let week = 1; week <= 9; week++) {
      playWeek(l);
      const games = gameCandidates(l, week);
      if (week === 1) weekOne = games;
      if (week === 9) weekNine = games;
      for (const r of runCandidates(l, week)) {
        runs.push(r);
        seen.set(r.key, (seen.get(r.key) ?? 0) + 1);
      }
    }
  }, 120_000);

  it('has one candidate a game, about one of its two clubs', () => {
    const games = gamesInWeek(l, 9).filter((g) => g.result);
    expect(weekNine).toHaveLength(games.length);
    for (const x of weekNine) {
      expect(x.key).toMatch(/^game:\d+$/);
      expect(x.teams).toContain(x.clubId);
      expect(x.game).toBeDefined();
      expect(x.tier).toBe({ result: 5, rout: 5, overtime: 5 }[x.angle] ?? x.tier);
    }
  });

  it('has no record to judge week 1 by', () => {
    expect(weekOne.every((x) => x.tier >= 4)).toBe(true);
  });

  it('tells a run once, the week it reaches six', () => {
    for (const n of seen.values()) expect(n).toBe(1);
    for (const r of runs.filter((x) => x.angle === 'streak')) expect(Math.abs(r.run!.length)).toBe(6);
  });

  it('gives the user a bye candidate only in his bye week', () => {
    const user = l.userTeamId;
    for (let week = 1; week <= 9; week++) {
      const played = l.games.some(
        (g) => g.season === l.season && g.week === week && (g.homeId === user || g.awayId === user),
      );
      expect(byeCandidate(l, week, user) === null).toBe(played);
    }
  });

  it('builds the race from the reader’s division and the game of the week from next week', () => {
    const e = buildEdition(l, 9)!;
    const division = l.teams.filter((t) => t.division === l.teams[l.userTeamId].division).map((t) => t.id);
    expect(e.race!.division).toBe(l.divisions[l.teams[l.userTeamId].division].name);
    expect(e.race!.rows.map((r) => r.teamId).sort()).toEqual(division.sort());
    for (const r of e.race!.rows) {
      expect(r.w + r.l + r.t).toBeGreaterThan(0);
      expect(r.last).toMatch(/^(W|L|T) \d+–\d+$|^bye$/);
      expect(r.next).toMatch(/^(at )?[A-Z]{2,3}$|^bye$/);
    }
    // First place first.
    const pct = (r: { w: number; l: number; t: number }) => (r.w + r.t / 2) / (r.w + r.l + r.t);
    expect(pct(e.race!.rows[0])).toBeGreaterThanOrEqual(pct(e.race!.rows.at(-1)!));
    expect(e.next).toBeDefined();
    const next = l.games.find((g) => g.id === e.next!.gameId)!;
    expect(next.week).toBe(10);
    expect(next.result).toBeUndefined();
    expect(e.next!.home).toMatch(/^\d+–\d+(–\d+)?$/);
    expect(e.bracket).toBeUndefined();
  });

  it('calls a man a star only on public production, and out only for the season', () => {
    for (let week = 1; week <= 9; week++)
      for (const x of starOutCandidates(l, week)) {
        expect(x.tier).toBe(3);
        expect(x.kind).toBe('starOut');
        const hurt = gamesInWeek(l, week)
          .flatMap((g) => g.result?.injuries ?? [])
          .find((i) => i.playerId === x.out!.playerId)!;
        expect(hurt.estimate[0]).toBeGreaterThanOrEqual(18 - week);
      }
  });
});
