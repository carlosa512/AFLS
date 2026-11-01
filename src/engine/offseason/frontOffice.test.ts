import { describe, expect, it } from 'vitest';
import { capHit } from '../finance/contract';
import { releasePlayer } from '../finance/cap';
import { leagueMarket, marketApy, minSalary } from '../finance/market';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { playerOvr } from '../positions';
import { Rng } from '../rng';
import type { League, Player } from '../types';
import { aiFreeAgencyDay, spendable } from './ai';
import { advanceOffseason, beginOffseason } from './index';
import { demand, OFFSEASON_ROSTER_MAX } from './negotiation';

/** A league at the draft step after one season: free agency's five days are done. */
const afterFreeAgency = (() => {
  const l = createLeague({ seed: 'front-office' });
  simToEndOfSeason(l);
  beginOffseason(l);
  while (l.phase !== 'draft') advanceOffseason(l, { autoUser: true });
  return JSON.stringify(l);
})();

/**
 * A good starter cut loose after free agency (rated 12.5–14, 29 or younger, his market four times his minimum), every
 * AI club's room taken away but `clubId`'s, which gets `room` × his minimum.
 */
function lateVeteran(clubId: number, room: number) {
  const l: League = JSON.parse(afterFreeAgency);
  const cap = l.caps[l.season];
  const market = leagueMarket(l);
  const p: Player = Object.values(l.players).find(
    (x) =>
      x.teamId !== null &&
      x.teamId !== l.userTeamId &&
      x.teamId !== clubId &&
      x.contract &&
      !x.injury &&
      x.age <= 29 &&
      playerOvr(x) >= 12.5 &&
      playerOvr(x) <= 14 &&
      marketApy(market, x) >= 4 * minSalary(x.experience, cap),
  )!;
  releasePlayer(l, p);
  const min = minSalary(p.experience, cap);
  for (const t of l.teams) {
    if (t.id === l.userTeamId) continue;
    const want = t.id === clubId ? room * min : -1_000;
    t.deadMoney.push({ season: l.season, amount: Math.round(spendable(l, t.id) - want), playerId: -1, note: 'test' });
  }
  return { l, p, min };
}

describe('the market clears by camp', () => {
  it('signs a free agent for what a club can fit on the last call, and not on an earlier pass', () => {
    const l0: League = JSON.parse(afterFreeAgency);
    let found = false;
    for (const t of l0.teams) {
      if (t.id === l0.userTeamId) continue;
      const last = lateVeteran(t.id, 1.5);
      aiFreeAgencyDay(last.l, new Rng('camp'), { rosterMax: OFFSEASON_ROSTER_MAX, lastCall: true });
      if (last.l.players[last.p.id].teamId !== t.id) continue;
      found = true;
      const signed = last.l.players[last.p.id];
      expect(signed.contract!.length).toBe(1);
      expect(capHit(signed.contract!, last.l.season)).toBeLessThanOrEqual(1.5 * last.min + 1);
      const early = lateVeteran(t.id, 1.5);
      aiFreeAgencyDay(early.l, new Rng('camp'), { rosterMax: OFFSEASON_ROSTER_MAX });
      expect(early.l.players[early.p.id].teamId).toBeNull();
      break;
    }
    expect(found).toBe(true);
  }, 180_000);

  it('leaves a player with a club as he was', () => {
    const l: League = JSON.parse(afterFreeAgency);
    const p = Object.values(l.players).find((x) => x.teamId !== null && x.teamId !== l.userTeamId && x.contract)!;
    const before = demand(l, p, p.teamId!).walkAway;
    aiFreeAgencyDay(l, new Rng('camp'), { rosterMax: OFFSEASON_ROSTER_MAX, lastCall: true });
    expect(demand(l, p, p.teamId!).walkAway).toBe(before);
  }, 60_000);
});
