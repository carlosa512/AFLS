import { describe, expect, it } from 'vitest';
import { seasonAwards } from './awards';
import { logTransaction } from './finance/cap';
import { createLeague } from './generate';
import { deliverMail, draftClassOf, mailSubject, markAllRead, needsYou, unreadCount } from './inbox';
import { playWeek, simToEndOfRegularSeason, simToEndOfSeason } from './league';
import { advanceOffseason, beginOffseason } from './offseason';
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

  it('needs you for the report until the game is played', () => {
    const report = league.inbox![0];
    expect(mailSubject(report)).toEqual({ kind: 'matchup', season: league.season, week: 1 });
    expect(needsYou(league, report)).toBe(true);
    const played = copy(league);
    playWeek(played);
    expect(needsYou(played, report)).toBe(false);
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
  }, 30_000);

  it('passes on the doctor\'s word about our injured players, with his estimate', () => {
    const hurt = league.inbox!.filter((m) => m.category === 'medical');
    const out = teamPlayers(league, league.userTeamId).filter((p) => p.injury && p.injury.estimate[1] >= 1);
    expect(out.length).toBeGreaterThan(0);
    for (const p of out) expect(hurt.some((m) => m.actions.some((a) => a.kind === 'player' && a.playerId === p.id))).toBe(true);
    for (const m of hurt) expect(m.actions.map((a) => a.kind)).toEqual(['player', 'medical']);
  });

  it('says "are" for the units that are plural', () => {
    for (const m of league.inbox!.filter((x) => x.category === 'matchup')) expect(m.body).not.toMatch(/linebackers is/);
  });

  it('reads back what every message is about', () => {
    const kinds: Record<string, string[]> = { matchup: ['matchup'], medical: ['injury'], awards: ['award'], trades: ['trade'] };
    for (const m of league.inbox!) {
      const s = mailSubject(m)!;
      expect(kinds[m.category]).toContain(s.kind);
      expect(s.season).toBe(m.season);
      if (s.kind === 'award') expect(m.actions).toContainEqual({ kind: 'player', playerId: s.playerId });
    }
    const trade = league.inbox!.find((m) => m.category === 'trades')!;
    expect(mailSubject(trade)).toMatchObject({ kind: 'trade', text: 'AAA traded QB A to BBB for QB B' });
  });

  it('opens the league year with expiring deals and retirements, and the combine with free agency', () => {
    simToEndOfSeason(league);
    beginOffseason(league);
    deliverMail(league);
    const year = league.inbox!.filter((m) => m.season === league.season && m.phase === 'resign');
    const deals = year.filter((m) => m.category === 'contracts');
    expect(deals).toHaveLength(expiringPlayers(league, league.userTeamId).length);
    for (const m of deals) expect(needsYou(league, m)).toBe(true);
    const retired = Object.values(league.players).filter((p) => p.retired && p.statTeams?.[league.season - 1]?.at(-1) === league.userTeamId);
    expect(year.filter((m) => m.category === 'retirement')).toHaveLength(retired.length);
    // The NFL's combine wraps up just before free agency opens: not yet.
    expect(league.inbox!.some((m) => m.id === `scouting:${league.season}:combine`)).toBe(false);
    advanceOffseason(league);
    deliverMail(league);
    const combine = league.inbox!.find((m) => m.id === `scouting:${league.season}:combine`)!;
    expect(combine.phase).toBe('freeAgency');
    expect(needsYou(league, combine)).toBe(league.scoutPoints > 0);
    // Free agency closes the re-sign window: the agents' letters no longer ask anything.
    for (const m of deals) expect(needsYou(league, m)).toBe(false);
  }, 30_000);

  it('reports our draft class once the draft is done', () => {
    while (league.phase === 'freeAgency') advanceOffseason(league);
    deliverMail(league);
    const day = league.inbox!.find((m) => m.id === `scouting:${league.season}:draft`)!;
    expect(needsYou(league, day)).toBe(true);
    expect(league.inbox!.some((m) => m.id === `scouting:${league.season}:class`)).toBe(false);
    advanceOffseason(league);
    deliverMail(league);
    expect(needsYou(league, day)).toBe(false);
    const picks = draftClassOf(league, league.season);
    expect(picks.length).toBeGreaterThan(0);
    const report = league.inbox!.find((m) => m.id === `scouting:${league.season}:class`)!;
    expect(report.body).toContain(`We made ${picks.length} pick`);
    expect(mailSubject(report)).toEqual({ kind: 'draftClass', season: league.season });
  }, 30_000);

  it('marks everything read in one go', () => {
    const all = copy(league);
    markAllRead(all);
    expect(unreadCount(all)).toBe(0);
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
