import { describe, expect, it } from 'vitest';
import { capFor, capSheet, capSpace, restructureOptions } from '../finance/cap';
import { capHit, isExpired, lastSeason } from '../finance/contract';
import { marketApy, leagueMarket } from '../finance/market';
import { createLeague } from '../generate';
import { simToEndOfSeason } from '../league';
import { playerOvr } from '../positions';
import { Rng } from '../rng';
import { teamPlayers } from '../roster';
import type { League, Player } from '../types';
import {
  aiCapCompliance,
  aiResignWindow,
  expiringPlayers,
  inPlans,
  nextYearCeiling,
  nextYearNeeds,
  resignCall,
  restructurePlan,
  spendable,
  winNow,
} from './ai';
import { ageShift } from '../aging';
import { beginOffseason } from './index';

/** A league at its re-sign window, after one season. */
const window = (() => {
  const l = createLeague({ seed: 'make-room' });
  simToEndOfSeason(l);
  beginOffseason(l);
  return JSON.stringify(l);
})();

/**
 * A club with a keeper it can't fit: the AI club with the most it could save by restructuring, its best expiring
 * player it wants to keep (loyal, so he doesn't test the market), and its room taken down to `room` × his market.
 */
function squeezed(room: number, capAggression: number) {
  const l: League = JSON.parse(window);
  const saves = (t: number) =>
    teamPlayers(l, t)
      .filter((p) => p.contract && !isExpired(p.contract, l.season))
      .map((p) => restructureOptions(l, p).savings)
      .sort((a, b) => b - a)
      .slice(0, 4)
      .reduce((a, b) => a + b, 0);
  const keepers = (t: number) =>
    expiringPlayers(l, t).filter((p) => playerOvr(p) >= 12 && resignCall(l, t, p).call === 'keep');
  const team = l.teams
    .filter((t) => t.id !== l.userTeamId && keepers(t.id).length)
    .sort((a, b) => saves(b.id) - saves(a.id))[0];
  const p: Player = keepers(team.id)[0];
  p.personality.loyalty = 1;
  team.gm.capAggression = capAggression;
  const market = marketApy(leagueMarket(l), p);
  team.deadMoney.push({
    season: l.season,
    amount: Math.round(spendable(l, team.id) - room * market),
    playerId: -1,
    note: 'test',
  });
  return { l, team, p };
}
const restructures = (l: League, teamId: number) =>
  l.transactions.filter((m) => m.kind === 'restructure' && m.teamIds.includes(teamId) && m.season === l.season).length;
/** What a club's restructures this league year add to next year's cap: each converted amount's share of a later year. */
const borrowed = (l: League, teamId: number) =>
  teamPlayers(l, teamId)
    .flatMap((x) => x.contract?.bonuses ?? [])
    .filter((b) => b.source === 'restructure' && b.start === l.season)
    .reduce((a, b) => a + b.amount / b.years, 0);

describe('GMs make room to keep their core', () => {
  it('restructures to re-sign a keeper it can’t fit, and stays under the cap', () => {
    const { l, team, p } = squeezed(0, 0.6);
    // Next year with room to borrow against, its own needs and his new deal counted.
    team.deadMoney.push({
      season: l.season + 1,
      amount: -Math.round(0.4 * capFor(l, l.season + 1)),
      playerId: -1,
      note: 'test',
    });
    aiResignWindow(l, team, new Rng('room'));
    expect(p.teamId).toBe(team.id);
    expect(isExpired(p.contract!, l.season)).toBe(false);
    expect(restructures(l, team.id)).toBeGreaterThan(0);
    expect(capSpace(l, team.id)).toBeGreaterThanOrEqual(0);
  });

  it('pushes more into next year for a bold GM than a cautious one', () => {
    const cautious = squeezed(-0.6, 0);
    const bold = squeezed(-0.6, 1);
    // Next year with room for both to borrow against (each GM's ceiling is what differs).
    for (const x of [cautious, bold])
      x.team.deadMoney.push({
        season: x.l.season + 1,
        amount: -Math.round(0.4 * capFor(x.l, x.l.season + 1)),
        playerId: -1,
        note: 'test',
      });
    aiResignWindow(cautious.l, cautious.team, new Rng('room'));
    aiResignWindow(bold.l, bold.team, new Rng('room'));
    // Caution is next year's headroom: a cautious GM leaves more of it free than a bold one.
    const next = (x: typeof cautious) => capSheet(x.l, x.team.id, x.l.season + 1).used;
    expect(next(cautious)).toBeLessThan(next(bold));
    expect(restructures(bold.l, bold.team.id)).toBeGreaterThanOrEqual(restructures(cautious.l, cautious.team.id));
  });

  it('never cuts a better player than the one it keeps', () => {
    const { l, team, p } = squeezed(-0.6, 0.2);
    const before = new Set(teamPlayers(l, team.id).map((x) => x.id));
    aiResignWindow(l, team, new Rng('room'));
    const cut = [...before]
      .map((id) => l.players[id])
      .filter((x) => x.teamId === null && x.left?.some((d) => d.how === 'cut'));
    for (const x of cut) expect(playerOvr(x)).toBeLessThan(playerOvr(p));
  });

  it('restructures only a player it plans to keep starting', () => {
    // The club's biggest restructure, washed up (a 34-year-old past his position's clock, rated like a backup): where
    // he's headed he no longer starts, so the money pushed forward would land as dead money when he goes. The GM leaves
    // his deal alone. (An old starter with nobody behind him still starts, and stays in its plans.)
    const { l, team } = squeezed(0, 1);
    const biggest = teamPlayers(l, team.id)
      .filter((x) => x.contract && !isExpired(x.contract, l.season))
      .sort((a, b) => restructureOptions(l, b).savings - restructureOptions(l, a).savings)[0];
    biggest.age = ageShift(biggest.position) + 34;
    for (const k of Object.keys(biggest.ratings) as (keyof typeof biggest.ratings)[]) biggest.ratings[k] = 4;
    expect(inPlans(l, team, biggest)).toBe(false);
    const before = biggest.contract!.bonuses.length;
    aiResignWindow(l, team, new Rng('room'));
    expect(biggest.contract?.bonuses.length ?? before).toBe(before);
  });

  it('reads a club’s own starters as in its plans', () => {
    const l: League = JSON.parse(window);
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    const qb = team.depthChart.QB.map((id) => l.players[id]).find(
      (x) => x.contract && !isExpired(x.contract, l.season),
    )!;
    expect(inPlans(l, team, qb)).toBe(true);
  });
});

describe('the bill comes later, within next year’s books', () => {
  it('never restructures next year’s books past their ceiling', () => {
    // Under the cap (so the window's own compliance pass has nothing to do), with next year's books half a million
    // under their ceiling: the deals already running and next year's dead money, new deals signed in the window aside.
    const { l, team } = squeezed(0, 1);
    const ceiling = nextYearCeiling(team.gm, winNow(l, team)) * capFor(l, l.season + 1);
    const running = teamPlayers(l, team.id).filter((x) => x.contract && !isExpired(x.contract, l.season));
    const books = () =>
      running.filter((x) => x.teamId === team.id).reduce((a, x) => a + capHit(x.contract!, l.season + 1), 0) +
      team.deadMoney.filter((d) => d.season === l.season + 1).reduce((a, d) => a + d.amount, 0);
    const others = capSheet(l, team.id, l.season + 1).used - books();
    team.deadMoney.push({
      season: l.season + 1,
      amount: Math.round(ceiling - others - books() - 500),
      playerId: -1,
      note: 'test',
    });
    aiResignWindow(l, team, new Rng('room'));
    expect(books() + others).toBeLessThanOrEqual(ceiling + 1);
  });
});

describe('GMs plan next year first', () => {
  /** An AI club's players whose deals end after this league year and that it plans to keep. */
  const nextKeepers = (l: League, teamId: number) =>
    teamPlayers(l, teamId).filter(
      (x) => x.contract && lastSeason(x.contract) === l.season && inPlans(l, l.teams[teamId], x),
    );

  it('counts next year’s planned keepers and next year’s draft class', () => {
    const l: League = JSON.parse(window);
    const team = l.teams.find((t) => t.id !== l.userTeamId && nextKeepers(l, t.id).length)!;
    const market = leagueMarket(l);
    const keepers = nextKeepers(l, team.id);
    const base = nextYearNeeds(l, team);
    expect(base).toBeGreaterThanOrEqual(keepers.reduce((a, x) => a + marketApy(market, x), 0) - 1);
    // Another club's pick for next year, now his: next year's class costs more.
    const pick = l.draftPicks.find((d) => d.season === l.season + 1 && d.ownerId !== team.id)!;
    pick.ownerId = team.id;
    const withPick = nextYearNeeds(l, team);
    expect(withPick).toBeGreaterThan(base);
    // A keeper whose deal runs a year past next year's window isn't a need yet.
    const k = keepers[0];
    const last = k.contract!.years.find((y) => y.season === l.season)!;
    k.contract!.years.push({ ...last, season: l.season + 1 });
    expect(nextYearNeeds(l, team)).toBeCloseTo(withPick - marketApy(market, k), 0);
  });

  it('counts the injury cushion once: in the ceiling, not in the needs', () => {
    // No keeper's deal ends next year and no pick next year: nothing is owed (the ceiling's room under the cap is the
    // cushion for in-season injuries).
    const l: League = JSON.parse(window);
    const team = l.teams.find((t) => t.id !== l.userTeamId)!;
    const other = l.teams.find((t) => t.id !== team.id)!;
    for (const d of l.draftPicks) if (d.season === l.season + 1 && d.ownerId === team.id) d.ownerId = other.id;
    for (const k of nextKeepers(l, team.id)) {
      const last = k.contract!.years.find((y) => y.season === l.season)!;
      k.contract!.years.push({ ...last, season: l.season + 1 });
    }
    expect(nextYearNeeds(l, team)).toBe(0);
  });

  /** `squeezed`, with next year's books plus next year's needs set right at the GM's ceiling. */
  const fullNextYear = () => {
    const x = squeezed(0, 1);
    const { l, team } = x;
    const ceiling = nextYearCeiling(team.gm, winNow(l, team)) * capFor(l, l.season + 1);
    const used = capSheet(l, team.id, l.season + 1).used;
    team.deadMoney.push({
      season: l.season + 1,
      amount: Math.round(ceiling - used - nextYearNeeds(l, team)),
      playerId: -1,
      note: 'test',
    });
    return x;
  };

  it('borrows less when next year’s keepers already fill next year', () => {
    // The same club, next year roomy or full once its needs are counted. (Full, it may still cut a lesser veteran, which
    // frees next year too, and borrow against that.)
    const full = fullNextYear();
    const roomy = squeezed(0, 1);
    roomy.team.deadMoney.push({
      season: roomy.l.season + 1,
      amount: -Math.round(0.2 * capFor(roomy.l, roomy.l.season + 1)),
      playerId: -1,
      note: 'test',
    });
    aiResignWindow(full.l, full.team, new Rng('room'));
    aiResignWindow(roomy.l, roomy.team, new Rng('room'));
    expect(restructures(full.l, full.team.id)).toBeLessThan(restructures(roomy.l, roomy.team.id));
  });

  it('stays legal when next year’s needs leave no room, cutting rather than borrowing', () => {
    const { l, team } = fullNextYear();
    team.deadMoney.push({
      season: l.season,
      amount: Math.round(capSpace(l, team.id) + 0.03 * l.caps[l.season]),
      playerId: -1,
      note: 'test',
    });
    aiCapCompliance(l, team);
    expect(capSpace(l, team.id)).toBeGreaterThanOrEqual(0);
    // Next year owes its own keepers: the room comes from a cut this year, not from next year's books.
    expect(restructures(l, team.id)).toBe(0);
  });
});

describe('a GM makes the room he plans, or none', () => {
  /** `squeezed`'s keeper the only deal running out, next year set `room` (a share of his market) under the ceiling. */
  const alone = (room: number) => {
    const x = squeezed(0, 1);
    const { l, team, p } = x;
    for (const e of expiringPlayers(l, team.id)) if (e !== p) e.teamId = null;
    const cap = capFor(l, l.season + 1);
    const ceiling = nextYearCeiling(team.gm, winNow(l, team)) * cap;
    const used = capSheet(l, team.id, l.season + 1).used;
    const market = marketApy(leagueMarket(l), p);
    team.deadMoney.push({
      season: l.season + 1,
      amount: Math.round(ceiling - used - nextYearNeeds(l, team) - room * market),
      playerId: -1,
      note: 'test',
    });
    return { ...x, ceiling, market };
  };
  const cutBy = (l: League, teamId: number) =>
    Object.values(l.players).filter((x) =>
      x.left?.some((d) => d.teamId === teamId && d.how === 'cut' && d.season === l.season),
    ).length;

  it('plans exactly the room it makes', () => {
    const { l, team } = squeezed(0, 1);
    team.deadMoney.push({
      season: l.season + 1,
      amount: -Math.round(0.2 * capFor(l, l.season + 1)),
      playerId: -1,
      note: 'test',
    });
    const plan = restructurePlan(l, team, 0.05 * l.caps[l.season]);
    expect(plan.steps.length).toBeGreaterThan(0);
    const before = capSpace(l, team.id);
    aiCapCompliance(l, team, before + plan.saved);
    expect(capSpace(l, team.id) - before).toBeCloseTo(plan.saved, -1);
  });

  it('borrows nothing for a keeper whose own new deal next year wouldn’t fit', () => {
    // Next year has half his price of room after its needs: making room now would push his new deal past the ceiling.
    // The club's tag is spent, so it's his new deal or nothing (making room for a tag doesn't count next year's price
    // for him yet: a follow-up in docs/MVP.md).
    const { l, team, p } = alone(0.5);
    team.taggedId = teamPlayers(l, team.id).find((x) => x !== p)!.id;
    aiResignWindow(l, team, new Rng('room'));
    expect(restructures(l, team.id)).toBe(0);
  });

  it('cuts nobody when the cut can’t close the gap', () => {
    // No room to borrow next year: a cut alone would have to cover his whole price, and a lesser veteran's doesn't.
    const { l, team } = alone(-1);
    const before = cutBy(l, team.id);
    aiResignWindow(l, team, new Rng('room'));
    expect(cutBy(l, team.id)).toBe(before);
  });
});

describe('contenders borrow, rebuilders keep next year’s room', () => {
  /** `squeezed` with next year's room to borrow against, the GM all-in (1) or rebuilding (0). */
  const club = (wn: number) => {
    const x = squeezed(-0.6, 1);
    x.team.gm.winNow = wn;
    x.team.deadMoney.push({
      season: x.l.season + 1,
      amount: -Math.round(0.2 * capFor(x.l, x.l.season + 1)),
      playerId: -1,
      note: 'test',
    });
    return x;
  };

  it('a rebuilding club borrows less of next year than a contender', () => {
    const rebuild = club(0);
    const contend = club(1);
    aiResignWindow(rebuild.l, rebuild.team, new Rng('room'));
    aiResignWindow(contend.l, contend.team, new Rng('room'));
    // What its restructures push onto next year, not next year's books (a win-now GM also pays more in his re-signs) or
    // how many it makes (several small ones can borrow less than a few big ones).
    expect(borrowed(rebuild.l, rebuild.team.id)).toBeLessThan(borrowed(contend.l, contend.team.id));
  });

  it('a rebuilding club over the cap still gets under it', () => {
    const { l, team } = club(0);
    team.deadMoney.push({
      season: l.season,
      amount: Math.round(capSpace(l, team.id) + 0.03 * l.caps[l.season]),
      playerId: -1,
      note: 'test',
    });
    aiCapCompliance(l, team);
    expect(capSpace(l, team.id)).toBeGreaterThanOrEqual(0);
  });
});

describe('a club over the cap gets under it the way it makes room', () => {
  it('restructures only players it plans to keep, then cuts the one it can best spare', () => {
    // A bold GM over the cap, his biggest deal on a washed-up veteran: the cap is the law, but the money it pushes
    // forward goes on players it keeps, never on one it would cut (the old pass restructured the biggest deal first).
    const { l, team } = squeezed(0, 1);
    const biggest = teamPlayers(l, team.id)
      .filter((x) => x.contract && !isExpired(x.contract, l.season))
      .sort((a, b) => restructureOptions(l, b).savings - restructureOptions(l, a).savings)[0];
    biggest.age = ageShift(biggest.position) + 34;
    for (const k of Object.keys(biggest.ratings) as (keyof typeof biggest.ratings)[]) biggest.ratings[k] = 4;
    const before = biggest.contract!.bonuses.length;
    const over = capSpace(l, team.id) + 0.03 * l.caps[l.season];
    team.deadMoney.push({ season: l.season, amount: Math.round(over), playerId: -1, note: 'test' });
    expect(capSpace(l, team.id)).toBeLessThan(0);
    aiCapCompliance(l, team);
    expect(capSpace(l, team.id)).toBeGreaterThanOrEqual(0);
    expect(biggest.teamId === team.id ? biggest.contract!.bonuses.length : before).toBe(before);
  });
});
