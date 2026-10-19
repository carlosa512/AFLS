import { describe, expect, it } from 'vitest';
import { lastSeason } from './finance/contract';
import { createLeague } from './generate';
import { aiFifthYearOptions, needGain, upgradeBar } from './offseason/ai';
import { futureWeight, outlookOf } from './outlook';
import { playerOvr, STARTERS } from './positions';
import { teamPlayers } from './roster';
import type { Player, Position } from './types';
import { ATTRIBUTES, POSITIONS } from './types';

describe('outlook', () => {
  it('sees a young player climbing and a veteran fading', () => {
    expect(outlookOf('QB', 23, 14, 2)).toBeGreaterThan(14.5);
    expect(outlookOf('RB', 30, 15, 0)).toBeLessThan(14);
    expect(outlookOf('WR', 31, 15, 0)).toBeLessThan(outlookOf('WR', 26, 14.5, 0));
    // A quarterback's arm and reads hold: at 28 he's where he is.
    expect(outlookOf('QB', 28, 15, 0)).toBeCloseTo(15, 0);
  });

  it('marks down a body that breaks down', () => {
    expect(outlookOf('EDGE', 27, 15, 0, 'High')).toBeLessThan(outlookOf('EDGE', 27, 15, 0, 'Medium'));
    expect(outlookOf('EDGE', 27, 15, 0, 'Low')).toBeGreaterThan(outlookOf('EDGE', 27, 15, 0, 'Medium'));
  });

  it('lets an All-In GM weigh the years ahead less than a rebuilder', () => {
    const vet = (wn: number) => outlookOf('WR', 31, 15, 0, 'Medium', futureWeight(wn));
    expect(vet(0.95)).toBeGreaterThan(vet(0.2));
  });
});

describe('front offices invest on outlook', () => {
  it("won't pay a veteran quarterback top money to replace a young one level with him (Houston, 2029)", () => {
    const league = createLeague({ seed: 'outlook-hou' });
    const team = league.teams.find((t) => t.id !== league.userTeamId)!;
    // The young starter: 15, still with a little room to grow.
    const young = outlookOf('QB', 23, 15.05, 0.1);
    const depth = Object.fromEntries(POSITIONS.map((p) => [p, [] as number[]])) as Record<Position, number[]>;
    depth.QB = [young, 11];
    const vet = { position: 'QB' } as Player;
    const gain = needGain(depth, vet, outlookOf('QB', 28, 15.2, 0));
    // A fifth of the cap a year: the price Houston paid.
    expect(gain).toBeLessThan(upgradeBar(league, team, 0.2 * league.caps[league.season]));
    // A real upgrade at that price still gets made.
    depth.QB = [outlookOf('QB', 31, 12.5, 0), 11];
    expect(needGain(depth, vet, outlookOf('QB', 28, 15.2, 0))).toBeGreaterThan(upgradeBar(league, team, 0.2 * league.caps[league.season]));
  });

  /** A team's best quarterback made option-eligible this year, and a teammate set `delta` points better on every rating. */
  function optionCase(delta: number, tight: boolean) {
    const league = createLeague({ seed: 'outlook-option' });
    // The club with the league's best quarterback: paid like a starter, so the option is in play.
    const best = Object.values(league.players)
      .filter((x) => x.position === 'QB' && x.teamId !== null && x.teamId !== league.userTeamId)
      .sort((a, b) => playerOvr(b) - playerOvr(a))[0];
    const team = league.teams[best.teamId!];
    const qbs = teamPlayers(league, team.id)
      .filter((p) => p.position === 'QB')
      .sort((a, b) => playerOvr(b) - playerOvr(a));
    const [p, q] = qbs;
    // p: a rookie deal ending this year with the option open.
    p.age = 24;
    p.contract = { kind: 'rookie', signedSeason: league.season - 3, signedWeek: 0, apy: 10000, length: 4, years: [{ season: league.season, base: 10000, guaranteed: 10000 }], bonuses: [], fifthYearOption: 'eligible' };
    // q: the same game moved by `delta`, signed long-term, paid enough next year to fill the cap if `tight`.
    q.age = 27;
    for (const a of ATTRIBUTES) q.ratings[a] = Math.max(1, Math.min(20, p.ratings[a] + delta));
    const next = tight ? league.caps[league.season] * 1.2 : 20000;
    q.contract = { kind: 'veteran', signedSeason: league.season, signedWeek: 0, apy: next, length: 3, years: [0, 1, 2].map((i) => ({ season: league.season + i, base: i ? next : 20000, guaranteed: 0 })), bonuses: [] };
    expect(lastSeason(p.contract)).toBe(league.season);
    expect(STARTERS.QB).toBe(1);
    aiFifthYearOptions(league, team);
    return p.contract.fifthYearOption;
  }

  it('declines the option on a quarterback who will back up on a full cap', () => {
    expect(optionCase(2, true)).toBe('declined');
  });

  it('exercises it when he starts, or when the club can carry him anyway', () => {
    expect(optionCase(-2, true)).toBe('exercised');
    expect(optionCase(2, false)).toBe('exercised');
  });
});
