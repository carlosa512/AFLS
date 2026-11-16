import { describe, expect, it } from 'vitest';
import { buildContract, isExpired, lastSeason } from '../finance/contract';
import { leagueMarket, marketApy } from '../finance/market';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { teamPlayers } from '../roster';
import type { League, Player, Team } from '../types';
import { beginOffseason } from './index';
import { SPRING_CUT, springCuts, twoYearRoom } from './ai';
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
