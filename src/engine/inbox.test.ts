import { describe, expect, it } from 'vitest';
import { seasonAwards } from './awards';
import { logTransaction } from './finance/cap';
import { createLeague } from './generate';
import { deliverMail, unreadCount } from './inbox';
import { simToEndOfRegularSeason, simToEndOfSeason } from './league';
import { beginOffseason } from './offseason';
import { expiringPlayers } from './offseason/ai';
import { teamPlayers } from './roster';

const copy = <T>(x: T): T => JSON.parse(JSON.stringify(x));

describe('inbox', () => {
  const league = createLeague({ seed: 'inbox' });

  it('files one opposition report a week, however often it is delivered', () => {
    deliverMail(league);
    deliverMail(league);
    expect(league.inbox!.map((m) => m.id)).toEqual([`matchup:${league.season}:1`]);
    expect(unreadCount(league)).toBe(1);
  });

  it('tells the user about their own award winners and trades, once', () => {
    simToEndOfRegularSeason(league);
    // Make the MVP's club the user's, so there is an award to announce.
    const mvp = seasonAwards(league, league.season)!.winners.mvp!;
    league.userTeamId = mvp.teamId!;
    logTransaction(league, 'trade', [league.userTeamId, (league.userTeamId + 1) % 32], 'AAA traded QB A to BBB for QB B');
    deliverMail(league);
    const before = league.inbox!.length;
    deliverMail(league);
    expect(league.inbox!.length).toBe(before);
    const award = league.inbox!.find((m) => m.id === `awards:${league.season}:year:${mvp.playerId}`)!;
    expect(award.subject).toContain('Most Valuable Player');
    expect(award.actions).toEqual([{ kind: 'player', playerId: mvp.playerId }]);
    expect(league.inbox!.filter((m) => m.category === 'trades')).toHaveLength(1);
    // Every award message is about the user's club.
    for (const m of league.inbox!.filter((x) => x.category === 'awards')) expect(m.actions[0].kind).toBe('player');
    // One year-end message per player, however many season honors he won.
    const yearEnd = league.inbox!.filter((m) => m.id.startsWith(`awards:${league.season}:year:`)).map((m) => m.id);
    expect(new Set(yearEnd).size).toBe(yearEnd.length);
  });

  it('passes on the doctor\'s word about our injured players, with his estimate', () => {
    const hurt = league.inbox!.filter((m) => m.category === 'medical');
    const out = teamPlayers(league, league.userTeamId).filter((p) => p.injury && p.injury.estimate[1] >= 1);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) expect(hurt.some((m) => m.actions.some((a) => a.kind === 'player' && a.playerId === p.id))).toBe(true);
    for (const m of hurt) expect(m.actions.map((a) => a.kind)).toEqual(['player', 'medical']);
  });

  it('opens the league year with expiring deals, retirements and the combine', () => {
    simToEndOfSeason(league);
    beginOffseason(league);
    deliverMail(league);
    const year = league.inbox!.filter((m) => m.season === league.season && m.phase === 'resign');
    expect(year.filter((m) => m.category === 'contracts')).toHaveLength(expiringPlayers(league, league.userTeamId).length);
    expect(year.some((m) => m.id === `scouting:${league.season}:combine`)).toBe(true);
    const retired = Object.values(league.players).filter((p) => p.retired && p.statTeams?.[league.season - 1]?.at(-1) === league.userTeamId);
    expect(year.filter((m) => m.category === 'retirement')).toHaveLength(retired.length);
  });

  it('keeps read state through save and load', () => {
    league.inbox![0].read = true;
    const loaded = copy(league);
    deliverMail(loaded);
    expect(loaded.inbox).toEqual(league.inbox);
    expect(unreadCount(loaded)).toBe(unreadCount(league));
  });

  it('files an older save’s history as already read', () => {
    const old = copy(league);
    delete old.inbox;
    deliverMail(old);
    expect(old.inbox!.length).toBeGreaterThan(0);
    expect(unreadCount(old)).toBe(0);
  });
});
