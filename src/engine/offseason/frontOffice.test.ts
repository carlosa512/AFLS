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
    // Far enough under for the rest that no single cut could cover a deal.
    const want = t.id === clubId ? room * min : -100_000;
    t.deadMoney.push({ season: l.season, amount: Math.round(spendable(l, t.id) - want), playerId: -1, note: 'test' });
  }
  return { l, p, min };
}

describe('the market clears by camp', () => {
  it('signs a free agent for what a club can fit on the last call, never below his walk-away before', () => {
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
      // Before camp he takes less than his walk-away from nobody (a club may still cut to pay it).
      const early = lateVeteran(t.id, 1.5);
      const walkAway = demand(early.l, early.p, t.id).walkAway;
      expect(1.5 * early.min).toBeLessThan(walkAway);
      aiFreeAgencyDay(early.l, new Rng('camp'), { rosterMax: OFFSEASON_ROSTER_MAX });
      const e = early.l.players[early.p.id];
      if (e.teamId !== null) expect(capHit(e.contract!, early.l.season)).toBeGreaterThanOrEqual(walkAway * 0.9);
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

describe('a GM upgrades by cutting', () => {
  /** Players a club cut this league year, from their departures. */
  const cutBy = (l: League, teamId: number) =>
    Object.values(l.players).filter((x) =>
      x.left?.some((d) => d.teamId === teamId && d.how === 'cut' && d.season === l.season),
    );

  it('cuts a lesser, pricier player to sign a better free agent it couldn’t otherwise fit', () => {
    const l0: League = JSON.parse(afterFreeAgency);
    let found = false;
    for (const t of l0.teams) {
      if (t.id === l0.userTeamId) continue;
      // Half a minimum of room: no deal fits without a cut.
      const { l, p } = lateVeteran(t.id, 0.5);
      const before = new Set(cutBy(l, t.id).map((x) => x.id));
      aiFreeAgencyDay(l, new Rng('cut'), { rosterMax: OFFSEASON_ROSTER_MAX });
      if (l.players[p.id].teamId !== t.id) continue;
      found = true;
      const cut = cutBy(l, t.id).filter((x) => !before.has(x.id));
      expect(cut.length).toBe(1);
      expect(playerOvr(cut[0])).toBeLessThan(playerOvr(l.players[p.id]));
      break;
    }
    expect(found).toBe(true);
  }, 180_000);

  it('never cuts a better player, and cuts at most once a pass', () => {
    const l0: League = JSON.parse(afterFreeAgency);
    for (const t of l0.teams.filter((x) => x.id !== l0.userTeamId).slice(0, 6)) {
      const { l } = lateVeteran(t.id, 0.5);
      // A second good starter loose, so the club wants two.
      const second = Object.values(l.players).find(
        (x) =>
          x.teamId !== null &&
          x.teamId !== t.id &&
          x.teamId !== l.userTeamId &&
          x.contract &&
          playerOvr(x) >= 12.5 &&
          x.age <= 29,
      )!;
      releasePlayer(l, second);
      const before = new Set(cutBy(l, t.id).map((x) => x.id));
      aiFreeAgencyDay(l, new Rng('cut'), { rosterMax: OFFSEASON_ROSTER_MAX });
      const cut = cutBy(l, t.id).filter((x) => !before.has(x.id));
      expect(cut.length).toBeLessThanOrEqual(1);
      const signed = Object.values(l.players).filter(
        (x) => x.teamId === t.id && x.contract?.signedSeason === l.season && x.contract.length === 1,
      );
      for (const c of cut) expect(signed.some((s) => playerOvr(s) > playerOvr(c))).toBe(true);
    }
  }, 300_000);
});
