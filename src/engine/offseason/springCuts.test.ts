import { describe, expect, it } from 'vitest';
import { buildContract, isExpired, lastSeason } from '../finance/contract';
import { leagueMarket, marketApy } from '../finance/market';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { teamPlayers } from '../roster';
import type { League, Player, Team } from '../types';
import { beginOffseason } from './index';
import { cutPaysOff, designateFor, SPRING_CUT, springCuts, twoYearRoom } from './ai';
import { POST_JUNE1_LIMIT } from '../finance/cap';
import { STARTERS } from '../positions';

/** A new league year, and an AI club. */
function scene(): { l: League; team: Team } {
  const l = createLeague({ seed: 'spring-cuts' });
  simToEndOfSeason(l);
  beginOffseason(l);
  return { l, team: l.teams.find((t) => t.id !== l.userTeamId)! };
}

/** Give `p` a deal paying `times` his market price for three more years, signed two seasons ago. */
function overpay(l: League, p: Player, times: number): void {
  const apy = Math.round(times * marketApy(leagueMarket(l), p));
  p.contract = buildContract(
    { years: 5, total: apy * 5, signingBonus: 0, guaranteedBase: 0, voidYears: 0 },
    l.season - 2,
    'veteran',
    900,
  );
  p.contract.signedSeason = l.season - 2;
}

/** As `overpay`, with a signing bonus of `bonusYears` times the pay prorated over the five years: dead money if cut. */
function overpayWithBonus(l: League, p: Player, times: number, bonusYears: number): void {
  const apy = Math.round(times * marketApy(leagueMarket(l), p));
  p.contract = buildContract(
    { years: 5, total: apy * 5, signingBonus: Math.round(bonusYears * apy), guaranteedBase: 0, voidYears: 0 },
    l.season - 2,
    'veteran',
    900,
  );
  p.contract.signedSeason = l.season - 2;
}

/** A veteran under contract at a position the club holds well past its floor (counted as `springCuts` counts). */
function veteran(l: League, team: Team): Player {
  const under = teamPlayers(l, team.id).filter((p) => p.contract && !isExpired(p.contract, l.season));
  const deep = under.find(
    (p) =>
      p.age >= 26 && p.age <= 33 && under.filter((x) => x.position === p.position).length > STARTERS[p.position] + 1,
  );
  expect(deep).toBeDefined();
  return deep!;
}

describe('AI clubs cut overpaid veterans in the spring (market and exits)', () => {
  it('cuts a veteran whose charge runs well past what the club reads him worth', () => {
    const { l, team } = scene();
    const p = veteran(l, team);
    overpay(l, p, 1 + SPRING_CUT.margin + 1.5);
    expect(lastSeason(p.contract!)).toBeGreaterThan(l.season);
    const room = twoYearRoom(l, p);
    expect(room.now).toBeGreaterThan(0);
    const cut = springCuts(l, team);
    expect(cut.map((x) => x.id)).toContain(p.id);
    expect(l.players[p.id].teamId).toBeNull();
  });

  it('never cuts a player signed this league year', () => {
    const { l, team } = scene();
    const p = veteran(l, team);
    overpay(l, p, 1 + SPRING_CUT.margin + 1.5);
    p.contract!.signedSeason = l.season;
    expect(springCuts(l, team).map((x) => x.id)).not.toContain(p.id);
  });

  it('never leaves a position short of its starters under contract', () => {
    const { l, team } = scene();
    const p = veteran(l, team);
    overpay(l, p, 1 + SPRING_CUT.margin + 1.5);
    const mates = teamPlayers(l, team.id).filter(
      (x) => x.position === p.position && x.id !== p.id && x.contract && !isExpired(x.contract, l.season),
    );
    for (const x of mates.slice(STARTERS[p.position] - 1)) x.contract = null;
    expect(springCuts(l, team).map((x) => x.id)).not.toContain(p.id);
  });

  it('never cuts anyone on your team', () => {
    const { l } = scene();
    const mine = l.teams[l.userTeamId];
    const p = veteran(l, mine);
    overpay(l, p, 1 + SPRING_CUT.margin + 1.5);
    expect(springCuts(l, mine)).toEqual([]);
  });
});

describe('spring cuts use June 1 and weigh their dead money (cap room, 2026-11-16)', () => {
  it('designates a spring cut post-June 1 while the team has designations left', () => {
    const { l, team } = scene();
    const p = veteran(l, team);
    overpayWithBonus(l, p, 1 + SPRING_CUT.margin + 1.5, 1);
    expect(designateFor(l, p)).toBe(true);
    expect(springCuts(l, team).map((x) => x.id)).toContain(p.id);
    expect(team.postJune1Used).toBeGreaterThanOrEqual(1);
    expect(team.deadMoney.some((d) => d.playerId === p.id && d.season === l.season + 1)).toBe(true);
  });

  it('never designates past the limit', () => {
    const { l, team } = scene();
    team.postJune1Used = POST_JUNE1_LIMIT;
    const p = veteran(l, team);
    overpayWithBonus(l, p, 1 + SPRING_CUT.margin + 1.5, 1);
    expect(designateFor(l, p)).toBe(false);
    springCuts(l, team);
    expect(team.deadMoney.some((d) => d.playerId === p.id && d.season === l.season + 1)).toBe(false);
    expect(team.postJune1Used).toBe(POST_JUNE1_LIMIT);
  });

  it('spends no designation on a cut with no money to move', () => {
    const { l, team } = scene();
    const p = veteran(l, team);
    overpay(l, p, 1 + SPRING_CUT.margin + 1.5);
    expect(designateFor(l, p)).toBe(false);
  });

  it('skips a cut whose dead money runs past deadShare of what it saves', () => {
    const { l, team } = scene();
    const p = veteran(l, team);
    overpayWithBonus(l, p, 1 + SPRING_CUT.margin + 1.5, 4);
    expect(SPRING_CUT.deadShare).toBeGreaterThan(0);
    expect(cutPaysOff(l, p)).toBe(false);
    expect(springCuts(l, team).map((x) => x.id)).not.toContain(p.id);
  });

  it('a whole spring: no AI team past two designations, yours untouched', () => {
    const { l } = scene();
    for (const t of l.teams) expect(t.postJune1Used).toBeLessThanOrEqual(POST_JUNE1_LIMIT);
    expect(l.teams[l.userTeamId].postJune1Used).toBe(0);
    expect(l.teams.some((t) => t.id !== l.userTeamId && t.postJune1Used > 0)).toBe(true);
  });
});
