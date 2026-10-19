/**
 * Cap-ledger regressions found in the PR #2 review: every salary and bonus dollar must land on
 * exactly one team's cap, whatever happens to the player mid-season or between seasons.
 */
import { describe, expect, it } from 'vitest';
import { createLeague } from '../generate';
import { playWeek, simToEndOfSeason } from '../league';
import { advanceOffseason, beginOffseason } from '../offseason';
import { applyFranchiseTag, expiringPlayers, tagBlocker, tagValue } from '../offseason/ai';
import { makeOffer, offerProblem, signPlayer, freeAgents, type Offer } from '../offseason/negotiation';
import { teamPlayers } from '../roster';
import { executeTrade } from '../trade';
import type { League } from '../types';
import { accelerateProration, capSheet, releasePlayer, releasePreview } from './cap';
import { buildContract, lastSeason, remainingProration, yearOf } from './contract';

const deadFor = (l: League, teamId: number, playerId: number, season: number) =>
  l.teams[teamId].deadMoney.filter((d) => d.playerId === playerId && d.season === season).reduce((s, d) => s + d.amount, 0);
const toWeek = (l: League, week: number) => {
  while (l.week < week) playWeek(l);
};
const plain = (years: number, apy: number): Offer => ({ years, apy, bonusPct: 0, gtdPct: 0, voidYears: 0 });

// These play into the season: 30 s, so a busy machine doesn't time them out.
describe('salary paid mid-season', { timeout: 30_000 }, () => {
  it('a player signed in week 10 and cut in week 12 only books the checks he was paid', () => {
    const l = createLeague({ seed: 'ledger-sign' });
    toWeek(l, 10);
    const team = l.userTeamId;
    releasePlayer(l, teamPlayers(l, team).find((p) => p.position === 'WR' && p.contract!.kind !== 'veteran')!);
    const fa = freeAgents(l)[0];
    signPlayer(l, fa, team, plain(1, 18_000));
    const base = yearOf(fa.contract!, l.season)!.base; // 18,000 × 9/18 left = 9,000
    expect(base).toBe(9_000);
    toWeek(l, 12); // two of his nine checks paid
    const pre = releasePreview(l, fa);
    expect(pre.thisYear).toBeCloseTo(2_000, 0);
    expect(pre.savings).toBeCloseTo(7_000, 0);
  });

  it('salary is conserved across two trades: every team books exactly the weeks it paid', () => {
    const l = createLeague({ seed: 'ledger-trade' });
    const [a, b, c] = [3, 9, 20];
    const p = teamPlayers(l, a).find((x) => x.contract!.kind === 'veteran' && yearOf(x.contract!, l.season)!.base > 3_000)!;
    const full = yearOf(p.contract!, l.season)!.base;
    toWeek(l, 4); // 3 weeks paid by A
    executeTrade(l, { sides: [{ teamId: a, players: [p.id], picks: [] }, { teamId: b, players: [], picks: [] }] });
    toWeek(l, 8); // 4 more weeks paid by B
    executeTrade(l, { sides: [{ teamId: b, players: [p.id], picks: [] }, { teamId: c, players: [], picks: [] }] });
    // Salary only: any bonus proration is booked separately as 'Traded'.
    const salary = (team: number) => l.teams[team].deadMoney.filter((d) => d.playerId === p.id && d.note === 'Salary paid before trade').reduce((s, d) => s + d.amount, 0);
    const byA = salary(a);
    const byB = salary(b);
    const byC = yearOf(p.contract!, l.season)!.base;
    expect(byA).toBeCloseTo((full * 3) / 18, -1);
    expect(byB).toBeCloseTo((full * 4) / 18, -1);
    expect(byA + byB + byC).toBeCloseTo(full, -1);
  });

  it('a mid-season extension keeps the old salary already paid on the cap', () => {
    const l = createLeague({ seed: 'ledger-ext' });
    toWeek(l, 10);
    const team = l.userTeamId;
    const p = teamPlayers(l, team).find((x) => x.contract!.kind === 'veteran' && lastSeason(x.contract!) === l.season)!;
    const oldBase = yearOf(p.contract!, l.season)!.base;
    const before = capSheet(l, team).used;
    const ask: Offer = { years: 3, apy: Math.round(p.contract!.apy * 1.3), bonusPct: 0, gtdPct: 0, voidYears: 0 };
    expect(offerProblem(l, p, team, ask)).toBeNull();
    signPlayer(l, p, team, ask);
    expect(deadFor(l, team, p.id, l.season)).toBeCloseTo((oldBase * 9) / 18, -1);
    // Cap used = paid old salary + new deal's remaining weeks; never less than what's been paid.
    expect(capSheet(l, team).used).toBeGreaterThan(before - oldBase * (9 / 18) - 1);
  });
});

describe('bonus money when a deal ends', () => {
  it('retirements and expiries book every remaining bonus dollar', () => {
    const l = createLeague({ seed: 'ledger-retire' });
    simToEndOfSeason(l);
    const next = l.season + 1;
    // What each rostered player's bonuses still owe from next season on, and what next season already
    // carries for him (a team that released him earlier and signed him back still owes that deal's money).
    const owed = new Map(
      Object.values(l.players)
        .filter((p) => p.teamId !== null && p.contract)
        .map((p) => [p.id, { team: p.teamId!, amount: remainingProration(p.contract!, next), booked: deadFor(l, p.teamId!, p.id, next) }]),
    );
    const deadBefore = l.teams.map((t) => t.deadMoney.length);
    beginOffseason(l);
    for (const [id, { team, amount, booked }] of owed) {
      const p = l.players[id];
      if (p.retired) expect(deadFor(l, team, id, l.season) - booked).toBeCloseTo(amount, -1);
    }
    expect(l.teams.some((t, i) => t.deadMoney.length > deadBefore[i])).toBe(true);
  });

  it('an extension shorter than the old bonus schedule leaves no orphaned proration', () => {
    const l = createLeague({ seed: 'ledger-orphan' });
    const p = teamPlayers(l, 0)[0];
    // Two real years, bonus spread over five: three years of proration outlive the deal.
    p.contract = buildContract({ years: 2, total: 20_000, signingBonus: 10_000, guaranteedBase: 0, voidYears: 0 }, l.season, 'veteran', 900);
    p.contract.bonuses[0].years = 5;
    l.season += 2; // the deal has run out
    const owed = remainingProration(p.contract, l.season);
    expect(owed).toBeCloseTo(6_000);
    accelerateProration(l, p, 0);
    expect(deadFor(l, 0, p.id, l.season)).toBeCloseTo(6_000, -1);
  });
});

describe('franchise tags', () => {
  const offseason = () => {
    const l = createLeague({ seed: 'ledger-tags' });
    simToEndOfSeason(l);
    beginOffseason(l);
    return l;
  };

  it('prices a tag off the prior salary floor (120%)', () => {
    const l = offseason();
    const p = expiringPlayers(l, l.userTeamId)[0];
    const finalYear = yearOf(p.contract!, lastSeason(p.contract!))!;
    finalYear.base = 60_000;
    expect(tagValue(l, p)).toBeGreaterThanOrEqual(72_000);
  });

  it('counts accelerating bonus money in the cap check', () => {
    const l = offseason();
    const p = expiringPlayers(l, l.userTeamId)[0];
    // Give the expired deal a big void-year bonus that will accelerate on tagging.
    p.contract!.years.push({ season: l.season, base: 0, guaranteed: 0, void: true }, { season: l.season + 1, base: 0, guaranteed: 0, void: true });
    p.contract!.bonuses.push({ amount: 300_000, start: l.season, years: 2, source: 'signing' });
    expect(tagBlocker(l, p)).toMatch(/cap room/);
  });

  it('resets the consecutive-tag count when the player signs a real deal', () => {
    const l = offseason();
    const p = expiringPlayers(l, l.userTeamId)[0];
    l.teams[l.userTeamId].carryover = 500_000; // plenty of room: the reset is what's under test
    expect(tagBlocker(l, p)).toBeNull();
    applyFranchiseTag(l, p);
    expect(p.tagCount).toBe(1);
    signPlayer(l, p, l.userTeamId, plain(3, p.contract!.apy));
    expect(p.tagCount).toBe(0);
  });
});

describe('determinism', () => {
  it('AI free agency is the same whether or not the save was reloaded after the user acted', () => {
    const l = createLeague({ seed: 'ledger-determinism' });
    simToEndOfSeason(l);
    beginOffseason(l);
    advanceOffseason(l); // free agency day 1
    // The user signs three free agents (the UI reads contender scores while doing so).
    const fas = freeAgents(l).slice(5, 8);
    for (const p of fas) makeOffer(l, p, l.userTeamId, { years: 2, apy: Math.round((p.contract?.apy ?? 3_000) * 3), bonusPct: 0.2, gtdPct: 0.4, voidYears: 0 });
    const reloaded: League = JSON.parse(JSON.stringify(l));
    advanceOffseason(l);
    advanceOffseason(reloaded);
    expect(l.transactions.map((t) => t.text)).toEqual(reloaded.transactions.map((t) => t.text));
    expect(l.rngState).toEqual(reloaded.rngState);
  }, 30_000);
});
