import { describe, expect, it } from 'vitest';
import { capFor, capSheet, capSpace, restructureOptions } from '../finance/cap';
import { capHit, isExpired } from '../finance/contract';
import { marketApy, leagueMarket } from '../finance/market';
import { createLeague, NEXT_YEAR_CEILING } from '../generate';
import { simToEndOfSeason } from '../league';
import { playerOvr } from '../positions';
import { Rng } from '../rng';
import { teamPlayers } from '../roster';
import type { League, Player } from '../types';
import { aiResignWindow, expiringPlayers, resignCall, spendable } from './ai';
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

describe('GMs make room to keep their core', () => {
  it('restructures to re-sign a keeper it can’t fit, and stays under the cap', () => {
    const { l, team, p } = squeezed(0, 0.6);
    aiResignWindow(l, team, new Rng('room'));
    expect(p.teamId).toBe(team.id);
    expect(isExpired(p.contract!, l.season)).toBe(false);
    expect(restructures(l, team.id)).toBeGreaterThan(0);
    expect(capSpace(l, team.id)).toBeGreaterThanOrEqual(0);
  });

  it('goes further for an aggressive GM than a cautious one', () => {
    const cautious = squeezed(-0.6, 0);
    const bold = squeezed(-0.6, 1);
    aiResignWindow(cautious.l, cautious.team, new Rng('room'));
    aiResignWindow(bold.l, bold.team, new Rng('room'));
    expect(restructures(cautious.l, cautious.team.id)).toBeLessThanOrEqual(1);
    expect(restructures(bold.l, bold.team.id)).toBeGreaterThan(restructures(cautious.l, cautious.team.id));
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
});

describe('the bill comes later, within next year’s books', () => {
  it('never restructures next year’s books past their ceiling', () => {
    // Under the cap (so the window's own compliance pass has nothing to do), with next year's books half a million
    // under their ceiling: the deals already running and next year's dead money, new deals signed in the window aside.
    const { l, team } = squeezed(0, 1);
    const ceiling = NEXT_YEAR_CEILING * capFor(l, l.season + 1);
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
