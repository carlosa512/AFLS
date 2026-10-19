import { describe, expect, it } from 'vitest';
import { seasonAwards } from './awards';
import { coachTitle, isCoachExpiring, teamCoaches } from './coaching';
import { logTransaction } from './finance/cap';
import { createLeague } from './generate';
import { archiveMail, archiveRead, deadlineDayTrades, deleteMail, deliverMail, draftClassOf, freeAgencyMoves, headCoachChanges, mailSubject, marketRumors, marketTrades, markAllRead, needsYou, threadLabel, threads, unreadCount } from './inbox';
import { isMedicExpiring, teamMedics } from './medical';
import { playWeek, simToEndOfRegularSeason, simToEndOfSeason } from './league';
import { advanceOffseason, beginOffseason } from './offseason';
import { expiringPlayers } from './offseason/ai';
import { teamPlayers } from './roster';
import { computeRecords, conferenceSeeds } from './season/standings';
import { isExpiring, teamStaff } from './staff';
import { TRADE_DEADLINE_WEEK } from './trade';

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
    // Make the MVP's team the user's, so there is an award to announce.
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
    // Once for the trade above (as an AI team, the MVP's may have traded in season too).
    expect(league.inbox!.filter((m) => m.id.startsWith('trades:') && m.id.endsWith(':AAA traded QB A to BBB for QB B'))).toHaveLength(1);
    // Every award message is about the user's team.
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
    const kinds: Record<string, string[]> = { matchup: ['matchup', 'recap'], medical: ['injury', 'cleared'], awards: ['award'], trades: ['trade', 'deadline', 'market', 'marketRecap'], league: ['race'] };
    for (const m of league.inbox!) {
      const s = mailSubject(m)!;
      expect(kinds[m.category]).toContain(s.kind);
      expect(s.season).toBe(m.season);
      if (s.kind === 'award') expect(m.actions).toContainEqual({ kind: 'player', playerId: s.playerId });
    }
    const trade = league.inbox!.find((m) => m.id.startsWith('trades:') && m.id.endsWith(':AAA traded QB A to BBB for QB B'))!;
    expect(mailSubject(trade)).toMatchObject({ kind: 'trade', text: 'AAA traded QB A to BBB for QB B' });
  });

  it("opens the league year with the owner's letter and our staff deals", () => {
    simToEndOfSeason(league);
    beginOffseason(league);
    deliverMail(league);
    const owner = league.inbox!.find((m) => m.id === `owner:${league.season}`)!;
    expect(owner.category).toBe('staff');
    expect(owner.body).toContain(`budgets for ${league.season}`);
    expect(mailSubject(owner)).toEqual({ kind: 'owner', season: league.season });
    const user = league.userTeamId;
    const people = [
      ...teamCoaches(league, user).filter((c) => isCoachExpiring(league, c)).map((c) => ({ kind: 'coach', id: c.id })),
      ...teamStaff(league, user).filter((x) => isExpiring(league, x)).map((x) => ({ kind: 'scout', id: x.id })),
      ...teamMedics(league, user).filter((m) => isMedicExpiring(league, m)).map((m) => ({ kind: 'medic', id: m.id })),
    ];
    const deals = league.inbox!.filter((m) => m.id.startsWith(`staff:${league.season}:deals`));
    expect(deals).toHaveLength(people.length ? 1 : 0);
    for (const m of deals) {
      expect(mailSubject(m)).toEqual({ kind: 'staffDeals', season: league.season, people });
      expect(needsYou(league, m)).toBe(true);
    }
    deliverMail(league);
    expect(league.inbox!.filter((m) => m.id.startsWith('owner:') || m.id.startsWith('staff:'))).toHaveLength(1 + deals.length);
  }, 30_000);

  it('folds a day of agents\' letters into one, and leaves other mail as it is', () => {
    const all = [...league.inbox!].reverse();
    const letters = all.filter((m) => m.id.startsWith(`contracts:${league.season}:`));
    const list = threads(all);
    const folded = list.find((t) => t.kind === 'contract')!;
    expect(folded.messages).toEqual(letters);
    if (letters.length > 1) expect(threadLabel(folded).subject).toBe(`${letters.length} contracts are up`);
    // Every message is in exactly one thread, and kinds that don't fold stand alone.
    expect(list.flatMap((t) => t.messages)).toHaveLength(all.length);
    for (const t of list) if (t.kind === 'owner' || t.kind === 'matchup' || t.kind === 'recap') expect(t.messages).toHaveLength(1);
  });

  it('archives and deletes, with an undo, and never files a deleted message again', () => {
    const l = copy(league);
    const [first, second] = l.inbox!.filter((m) => m.id.startsWith(`contracts:${l.season}:`));
    archiveMail(l, [first.id]);
    expect(l.inbox!.find((m) => m.id === first.id)).toMatchObject({ archived: true, read: true });
    // Archived mail is out of the inbox's unread count.
    archiveMail(l, l.inbox!.map((m) => m.id));
    expect(unreadCount(l)).toBe(0);
    archiveMail(l, l.inbox!.map((m) => m.id).filter((id) => id !== first.id), false);
    archiveMail(l, [first.id], false);
    expect(l.inbox!.find((m) => m.id === first.id)!.archived).toBeUndefined();
    deleteMail(l, [second.id]);
    const before = l.inbox!.length;
    deliverMail(l);
    expect(l.inbox!.length).toBe(before);
    expect(l.inbox!.find((m) => m.id === second.id)!.deleted).toBe(true);
    // Archive read files away only what's read and no longer asks anything.
    markAllRead(l);
    archiveRead(l);
    for (const m of l.inbox!) if (!m.deleted) expect(!!m.archived).toBe(!needsYou(l, m));
  });

  it('opens the league year with expiring deals and retirements, and the combine with free agency', () => {
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

  it('reports the coaching carousel, and a coach hired away until his chair is filled', () => {
    const changes = headCoachChanges(league);
    expect(league.inbox!.some((m) => m.id === `league:${league.season}:carousel`)).toBe(changes.length > 0);
    for (const x of changes) {
      expect(x.coach.role).toBe('headCoach');
      expect(x.coach.teamId).toBe(x.teamId);
      expect(x.replaced).not.toBe(x.coach);
    }
    // Staged: another team promotes our coordinator to head coach (copies rebuild the coach index).
    const staged = copy(league);
    const user = staged.userTeamId;
    const coordinator = Object.values(staged.coaches).find((c) => c.teamId === user && (c.role === 'offCoord' || c.role === 'defCoord'))!;
    const chair = { role: coordinator.role };
    const was = coachTitle(coordinator).toLowerCase();
    const hirer = staged.teams.find((t) => t.id !== user)!;
    for (const c of Object.values(staged.coaches)) if (c.teamId === hirer.id && c.role === 'headCoach') c.teamId = null;
    Object.assign(coordinator, { teamId: hirer.id, role: 'headCoach' });
    logTransaction(staged, 'coach', [hirer.id, user], `${hirer.abbrev} hired ${staged.teams[user].abbrev} ${was} ${coordinator.firstName} ${coordinator.lastName} as head coach`);
    const world = copy(staged);
    deliverMail(world);
    const gone = world.inbox!.find((m) => m.id.startsWith(`staff:${world.season}:gone:${coordinator.id}:`))!;
    expect(mailSubject(gone)).toEqual({ kind: 'poached', season: world.season, coachId: coordinator.id, chair });
    expect(gone.body).toContain(`our ${was}, as their head coach`);
    expect(gone.body).toContain('promote from within');
    expect(needsYou(world, gone)).toBe(true);
    // A new man in the chair answers it.
    Object.values(world.coaches).find((c) => c.teamId === null && c.role === chair.role)!.teamId = user;
    expect(needsYou(copy(world), gone)).toBe(false);
    // A head coach who sat last season out: his last chair is two seasons back, not "new to the league".
    const rested = copy(league);
    const hc = Object.values(rested.coaches).find((c) => c.teamId !== null && c.role === 'headCoach' && c.career?.some((x) => x.season === rested.season - 1 && x.teamId === c.teamId))!;
    const elsewhere = (hc.teamId! + 1) % rested.teams.length;
    hc.career = [{ season: rested.season - 2, teamId: elsewhere, role: 'headCoach' }];
    const change = headCoachChanges(copy(rested)).find((x) => x.coach.id === hc.id)!;
    expect(change.from).toMatchObject({ season: rested.season - 2, teamId: elsewhere, title: 'Head coach' });
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

  it('sums up free agency once it closes, with our signings and the players who left', () => {
    const wrap = league.inbox!.find((m) => m.id === `fa:${league.season}`)!;
    expect(wrap.phase).toBe('draft');
    expect(wrap.body).toMatch(/^Free agency is over\. /);
    expect(mailSubject(wrap)).toEqual({ kind: 'faWrap', season: league.season });
    const fa = freeAgencyMoves(league);
    for (const d of fa.signed) expect(d.teamId).toBe(league.userTeamId);
    for (const d of fa.walked) {
      expect(d.teamId).not.toBe(league.userTeamId);
      expect(d.player.statTeams?.[league.season - 1]?.at(-1)).toBe(league.userTeamId);
    }
    expect(fa.biggest.length).toBeGreaterThan(0);
    for (const m of league.inbox!) expect(needsYou(league, m) && m.category === 'staff').toBe(false);
  });

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

describe('mail through a season', () => {
  const league = createLeague({ seed: 'inbox-season' });
  const user = league.userTeamId;
  const needsAt = new Map<string, boolean[]>();

  it('files a recap after each of our games, naming the player of the game', () => {
    deliverMail(league);
    while (league.phase === 'regular' || league.phase === 'playoffs') {
      playWeek(league);
      deliverMail(league);
      for (const m of league.inbox!) if (m.id.startsWith('deadline:')) needsAt.set(m.id, [...(needsAt.get(m.id) ?? []), needsYou(league, m)]);
    }
    const ours = league.games.filter((g) => g.season === league.season && g.result && (g.homeId === user || g.awayId === user));
    const recaps = league.inbox!.filter((m) => m.id.startsWith('recap:'));
    expect(recaps).toHaveLength(ours.length);
    for (const m of recaps) {
      const s = mailSubject(m)!;
      expect(s.kind).toBe('recap');
      expect(m.body).toMatch(/^We (beat|lost to|tied) the /);
      expect(m.body).toContain('was the player of the game');
      expect(m.actions).toEqual([{ kind: 'game', gameId: s.kind === 'recap' ? s.gameId : -1 }]);
      expect(needsYou(league, m)).toBe(false);
    }
  }, 30_000);

  it('reminds us of the trade deadline the week before, the week of and on deadline day, until it passes', () => {
    const before = league.inbox!.find((m) => m.id === `deadline:${league.season}:1`)!;
    const now = league.inbox!.find((m) => m.id === `deadline:${league.season}:0`)!;
    const day = league.inbox!.find((m) => m.id === `deadline:${league.season}:day`)!;
    expect(before.week).toBe(TRADE_DEADLINE_WEEK - 1);
    expect(now.week).toBe(TRADE_DEADLINE_WEEK);
    // Deadline day is the day after the deadline week: trades are still open.
    expect(day.week).toBe(TRADE_DEADLINE_WEEK + 1);
    expect(mailSubject(day)).toEqual({ kind: 'deadline', season: league.season, weeksLeft: 'day' });
    expect(day.body).toContain(`Once week ${TRADE_DEADLINE_WEEK + 1} is played`);
    // Each needs you until deadline day has gone by: the week-of reminder still does on deadline day.
    for (const m of [now, day]) {
      expect(needsAt.get(m.id)![0]).toBe(true);
      expect(needsAt.get(m.id)!.at(-1)).toBe(false);
    }
    expect(needsAt.get(now.id)!.filter(Boolean)).toHaveLength(2);
  });

  it('sends the director\'s market report weekly up to the deadline, then a recap once it has passed', () => {
    const reports = league.inbox!.filter((m) => m.id.startsWith(`market:${league.season}:regular:`));
    expect(reports.length).toBeGreaterThan(0);
    for (const m of reports) {
      const s = mailSubject(m)!;
      if (s.kind !== 'market') throw new Error(m.id);
      expect(s.week).toBeGreaterThanOrEqual(5);
      expect(s.week).toBeLessThanOrEqual(TRADE_DEADLINE_WEEK);
      // It reports what the market did the week before, never our own trades.
      const trades = marketTrades(league, s.season, s.phase, s.week);
      expect(trades.length + marketRumors(league, s.season, s.phase, s.week).length).toBeGreaterThan(0);
      for (const t of trades) expect(t.teamIds).not.toContain(user);
      expect(m.from).toContain('Director of scouting');
    }
    const recap = league.inbox!.find((m) => m.id === `market:${league.season}:recap`)!;
    expect(recap.week).toBeGreaterThan(TRADE_DEADLINE_WEEK + 1);
    expect(mailSubject(recap)).toEqual({ kind: 'marketRecap', season: league.season });
    const all = league.transactions.filter((t) => t.kind === 'trade' && t.season === league.season && t.phase === 'regular').length;
    expect(recap.body).toContain(`went through this season`);
    expect(recap.body.toLowerCase()).toContain(all < 10 ? ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'][all] : String(all));
    expect(deadlineDayTrades(league).length).toBeLessThanOrEqual(all);
  });

  it('clears a player we wrote about once he is healthy, and only him', () => {
    const cleared = league.inbox!.filter((m) => m.id.startsWith('cleared:'));
    expect(cleared.length).toBeGreaterThan(0);
    for (const m of cleared) expect(league.inbox!.some((x) => x.id === m.id.replace('cleared:', 'medical:'))).toBe(true);
  });

  it('calls our playoff fate the way the final standings bear out, once per level', () => {
    const seed = conferenceSeeds(league, league.teams[user].conference, computeRecords(league)).indexOf(user);
    const race = league.inbox!.filter((m) => m.category === 'league' && m.id.startsWith('race:'));
    expect(race.length).toBeGreaterThan(0);
    expect(new Set(race.map((m) => m.id)).size).toBe(race.length);
    for (const m of race) {
      const s = mailSubject(m)!;
      if (s.kind !== 'race') throw new Error(m.id);
      if (s.level === 'out') expect(seed).toBe(-1);
      else expect(seed).toBeGreaterThanOrEqual(0);
      if (s.level === 'division') expect(seed).toBeLessThan(4);
      if (s.level === 'bye') expect(seed).toBe(0);
    }
  });
});
